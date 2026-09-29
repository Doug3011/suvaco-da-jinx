// Módulo nativo do Tela Radmin: lista processos com sessão de áudio e captura
// o áudio de UM processo por vez (loopback "por aplicativo"), usando a API do
// Windows 10 2004+ (AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK). Cada app
// vira sua própria captura independente; misturar/mutar cada uma é feito do
// lado do JavaScript (Web Audio), então aqui a gente só entrega PCM cru.
#include <napi.h>
#include <windows.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <audiopolicy.h>
#include <audioclientactivationparams.h>
#include <wrl/client.h>
#include <wrl/implements.h>
#include <psapi.h>
#include <string>
#include <thread>
#include <atomic>
#include <unordered_map>
#include <mutex>
#include <vector>

using Microsoft::WRL::ComPtr;

#pragma comment(lib, "ole32.lib")

/* ---------------- listar apps com sessão de áudio ---------------- */

struct AppInfo {
  DWORD pid;
  std::wstring name;
};

static std::wstring ProcessNameFromPid(DWORD pid) {
  HANDLE h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
  if (!h) return L"PID " + std::to_wstring(pid);
  wchar_t path[MAX_PATH];
  DWORD size = MAX_PATH;
  std::wstring name = L"PID " + std::to_wstring(pid);
  if (QueryFullProcessImageNameW(h, 0, path, &size)) {
    std::wstring full(path);
    size_t slash = full.find_last_of(L"\\");
    name = (slash == std::wstring::npos) ? full : full.substr(slash + 1);
    size_t dot = name.find_last_of(L".");
    if (dot != std::wstring::npos) name = name.substr(0, dot);
  }
  CloseHandle(h);
  return name;
}

static std::vector<AppInfo> EnumerateAudioApps() {
  std::vector<AppInfo> result;
  std::unordered_map<DWORD, bool> seen;

  // Chamado direto da thread JS do Node, que não tem COM inicializado (só a
  // thread de captura em CaptureSession::Run tinha) — sem isso, toda chamada
  // COM abaixo falha em silêncio e a lista sempre volta vazia.
  HRESULT coHr = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
  bool doUninit = (coHr == S_OK || coHr == S_FALSE);

  do {
    ComPtr<IMMDeviceEnumerator> devEnum;
    if (FAILED(CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, IID_PPV_ARGS(&devEnum)))) break;

    ComPtr<IMMDevice> device;
    if (FAILED(devEnum->GetDefaultAudioEndpoint(eRender, eConsole, &device))) break;

    ComPtr<IAudioSessionManager2> sessionManager;
    if (FAILED(device->Activate(__uuidof(IAudioSessionManager2), CLSCTX_ALL, nullptr, (void**)&sessionManager))) break;

    ComPtr<IAudioSessionEnumerator> sessionEnum;
    if (FAILED(sessionManager->GetSessionEnumerator(&sessionEnum))) break;

    int count = 0;
    sessionEnum->GetCount(&count);
    for (int i = 0; i < count; i++) {
      ComPtr<IAudioSessionControl> control;
      if (FAILED(sessionEnum->GetSession(i, &control))) continue;
      ComPtr<IAudioSessionControl2> control2;
      if (FAILED(control.As(&control2))) continue;

      if (control2->IsSystemSoundsSession() == S_OK) continue;
      DWORD pid = 0;
      if (FAILED(control2->GetProcessId(&pid)) || pid == 0) continue;
      if (seen[pid]) continue;
      seen[pid] = true;

      result.push_back({ pid, ProcessNameFromPid(pid) });
    }
  } while (false);

  if (doUninit) CoUninitialize();
  return result;
}

static std::string WideToUtf8(const std::wstring& w) {
  if (w.empty()) return std::string();
  int len = WideCharToMultiByte(CP_UTF8, 0, w.c_str(), (int)w.size(), nullptr, 0, nullptr, nullptr);
  std::string out(len, 0);
  WideCharToMultiByte(CP_UTF8, 0, w.c_str(), (int)w.size(), &out[0], len, nullptr, nullptr);
  return out;
}

Napi::Value ListAudioApps(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  auto apps = EnumerateAudioApps();
  Napi::Array arr = Napi::Array::New(env, apps.size());
  for (size_t i = 0; i < apps.size(); i++) {
    Napi::Object obj = Napi::Object::New(env);
    obj.Set("pid", Napi::Number::New(env, apps[i].pid));
    obj.Set("name", Napi::String::New(env, WideToUtf8(apps[i].name)));
    arr.Set((uint32_t)i, obj);
  }
  return arr;
}

/* ---------------- captura de loopback por processo ---------------- */
// Formato fixo: float32, estéreo, 48000 Hz — o mesmo em toda sessão de
// captura, pra simplificar a mixagem no lado do navegador (Web Audio).

constexpr int kSampleRate = 48000;
constexpr int kChannels = 2;

// Precisa herdar de FtmBase (marshaler "free-threaded") — sem isso,
// ActivateAudioInterfaceAsync falha sempre com E_ILLEGAL_METHOD_CALL, porque
// o callback de conclusão chega numa thread de outro apartment COM e o
// objeto handler precisa ser "ágil" (chamável de qualquer thread) pra isso
// funcionar. Documentado em Microsoft Learn (nf-mmdeviceapi-...).
class ActivateCompletionHandler
    : public Microsoft::WRL::RuntimeClass<
          Microsoft::WRL::RuntimeClassFlags<Microsoft::WRL::ClassicCom>,
          Microsoft::WRL::FtmBase,
          IActivateAudioInterfaceCompletionHandler> {
 public:
  ActivateCompletionHandler() { doneEvent_ = CreateEventW(nullptr, TRUE, FALSE, nullptr); }
  ~ActivateCompletionHandler() { CloseHandle(doneEvent_); }

  HRESULT STDMETHODCALLTYPE ActivateCompleted(IActivateAudioInterfaceAsyncOperation* op) override {
    HRESULT hrActivate = E_FAIL;
    op->GetActivateResult(&hrActivate, audioClient_.ReleaseAndGetAddressOf());
    result_ = hrActivate;
    SetEvent(doneEvent_);
    return S_OK;
  }

  void Wait() { WaitForSingleObject(doneEvent_, INFINITE); }
  HRESULT Result() const { return result_; }
  ComPtr<IUnknown> AudioClientUnknown() const { return audioClient_; }

 private:
  HANDLE doneEvent_;
  HRESULT result_ = E_FAIL;
  ComPtr<IUnknown> audioClient_;
};

class CaptureSession {
 public:
  CaptureSession(DWORD pid, Napi::Function jsCallback) : pid_(pid) {
    tsfn_ = Napi::ThreadSafeFunction::New(jsCallback.Env(), jsCallback, "TelaRadminAudioCapture", 0, 1);
  }

  ~CaptureSession() { Stop(); }

  bool Start() {
    running_ = true;
    thread_ = std::thread([this] { Run(); });
    return true;
  }

  void Stop() {
    if (!running_) return;
    running_ = false;
    if (thread_.joinable()) thread_.join();
    tsfn_.Release();
  }

 private:
  void Run() {
    CoInitializeEx(nullptr, COINIT_MULTITHREADED);

    AUDIOCLIENT_ACTIVATION_PARAMS params = {};
    params.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
    params.ProcessLoopbackParams.TargetProcessId = pid_;
    params.ProcessLoopbackParams.ProcessLoopbackMode = PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE;

    PROPVARIANT activateParams;
    PropVariantInit(&activateParams);
    activateParams.vt = VT_BLOB;
    activateParams.blob.cbSize = sizeof(params);
    activateParams.blob.pBlobData = reinterpret_cast<BYTE*>(&params);

    auto handler = Microsoft::WRL::Make<ActivateCompletionHandler>();
    ComPtr<IActivateAudioInterfaceAsyncOperation> asyncOp;
    HRESULT hr = ActivateAudioInterfaceAsync(
        VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, __uuidof(IAudioClient), &activateParams, handler.Get(), &asyncOp);
    if (FAILED(hr)) {
      fprintf(stderr, "[tela_native] ActivateAudioInterfaceAsync falhou: 0x%08lx\n", hr);
      CoUninitialize();
      return;
    }
    handler->Wait();
    if (FAILED(handler->Result())) {
      fprintf(stderr, "[tela_native] ActivateCompleted retornou erro: 0x%08lx\n", handler->Result());
      CoUninitialize();
      return;
    }
    ComPtr<IAudioClient> audioClient;
    HRESULT asHr = handler->AudioClientUnknown().As(&audioClient);
    if (!audioClient) {
      fprintf(stderr, "[tela_native] QueryInterface pra IAudioClient falhou: 0x%08lx\n", asHr);
      CoUninitialize();
      return;
    }

    WAVEFORMATEX wfx = {};
    wfx.wFormatTag = WAVE_FORMAT_IEEE_FLOAT;
    wfx.nChannels = kChannels;
    wfx.nSamplesPerSec = kSampleRate;
    wfx.wBitsPerSample = 32;
    wfx.nBlockAlign = (wfx.nChannels * wfx.wBitsPerSample) / 8;
    wfx.nAvgBytesPerSec = wfx.nSamplesPerSec * wfx.nBlockAlign;

    hr = audioClient->Initialize(
        AUDCLNT_SHAREMODE_SHARED,
        AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
        2000000 /* 200ms em unidades de 100ns, buffer folgado */,
        0, &wfx, nullptr);
    if (FAILED(hr)) {
      fprintf(stderr, "[tela_native] IAudioClient::Initialize falhou: 0x%08lx\n", hr);
      CoUninitialize();
      return;
    }

    HANDLE hEvent = CreateEventW(nullptr, FALSE, FALSE, nullptr);
    HRESULT setEvHr = audioClient->SetEventHandle(hEvent);
    if (FAILED(setEvHr)) fprintf(stderr, "[tela_native] SetEventHandle falhou: 0x%08lx\n", setEvHr);

    ComPtr<IAudioCaptureClient> captureClient;
    HRESULT svcHr = audioClient->GetService(IID_PPV_ARGS(&captureClient));
    if (FAILED(svcHr)) {
      fprintf(stderr, "[tela_native] GetService(IAudioCaptureClient) falhou: 0x%08lx\n", svcHr);
      CloseHandle(hEvent);
      CoUninitialize();
      return;
    }

    HRESULT startHr = audioClient->Start();
    if (FAILED(startHr)) fprintf(stderr, "[tela_native] audioClient->Start() falhou: 0x%08lx\n", startHr);

    while (running_) {
      DWORD wait = WaitForSingleObject(hEvent, 500);
      if (!running_) break;
      if (wait != WAIT_OBJECT_0) {
        fprintf(stderr, "[tela_native] WaitForSingleObject timeout/erro: %lu\n", wait);
        continue;
      }

      UINT32 packetLength = 0;
      HRESULT packHr = captureClient->GetNextPacketSize(&packetLength);
      if (FAILED(packHr)) {
        fprintf(stderr, "[tela_native] GetNextPacketSize falhou: 0x%08lx\n", packHr);
        break;
      }

      while (packetLength != 0) {
        BYTE* data = nullptr;
        UINT32 numFrames = 0;
        DWORD flags = 0;
        if (FAILED(captureClient->GetBuffer(&data, &numFrames, &flags, nullptr, nullptr))) break;

        size_t byteCount = (size_t)numFrames * kChannels * sizeof(float);
        if (byteCount > 0) {
          auto* copy = new std::vector<float>((float*)data, (float*)data + numFrames * kChannels);
          bool silent = (flags & AUDCLNT_BUFFERFLAGS_SILENT) != 0;
          if (silent) std::fill(copy->begin(), copy->end(), 0.0f);

          tsfn_.BlockingCall(copy, [](Napi::Env env, Napi::Function jsCb, std::vector<float>* buf) {
            Napi::Buffer<float> napiBuf = Napi::Buffer<float>::Copy(env, buf->data(), buf->size());
            jsCb.Call({ napiBuf });
            delete buf;
          });
        }
        captureClient->ReleaseBuffer(numFrames);
        if (FAILED(captureClient->GetNextPacketSize(&packetLength))) { packetLength = 0; break; }
      }
    }

    audioClient->Stop();
    CloseHandle(hEvent);
    CoUninitialize();
  }

  DWORD pid_;
  std::atomic<bool> running_{ false };
  std::thread thread_;
  Napi::ThreadSafeFunction tsfn_;
};

static std::unordered_map<int, CaptureSession*> g_sessions;
static std::mutex g_sessionsMutex;
static int g_nextHandle = 1;

Napi::Value StartCapture(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsFunction()) {
    Napi::TypeError::New(env, "esperado (pid, callback)").ThrowAsJavaScriptException();
    return env.Null();
  }
  DWORD pid = (DWORD)info[0].As<Napi::Number>().Uint32Value();
  Napi::Function cb = info[1].As<Napi::Function>();

  auto* session = new CaptureSession(pid, cb);
  session->Start();

  std::lock_guard<std::mutex> lock(g_sessionsMutex);
  int handle = g_nextHandle++;
  g_sessions[handle] = session;
  return Napi::Number::New(env, handle);
}

Napi::Value StopCapture(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsNumber()) return env.Undefined();
  int handle = info[0].As<Napi::Number>().Int32Value();

  CaptureSession* session = nullptr;
  {
    std::lock_guard<std::mutex> lock(g_sessionsMutex);
    auto it = g_sessions.find(handle);
    if (it != g_sessions.end()) {
      session = it->second;
      g_sessions.erase(it);
    }
  }
  if (session) {
    session->Stop();
    delete session;
  }
  return env.Undefined();
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("listAudioApps", Napi::Function::New(env, ListAudioApps));
  exports.Set("startCapture", Napi::Function::New(env, StartCapture));
  exports.Set("stopCapture", Napi::Function::New(env, StopCapture));
  exports.Set("sampleRate", Napi::Number::New(env, kSampleRate));
  exports.Set("channels", Napi::Number::New(env, kChannels));
  return exports;
}

NODE_API_MODULE(tela_native, Init)
