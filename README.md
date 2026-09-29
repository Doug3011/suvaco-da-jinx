# Suvaco da Jinx

(nome interno do projeto/pasta continua `tela-radmin`; o app se chama "Suvaco
da Jinx" — por Doug Muller Burro)

Compartilhamento de tela ao vivo entre PCs na mesma rede local (**Radmin VPN**,
Hamachi, ZeroTier, Wi-Fi da casa, etc.) — sem internet, sem conta, sem instalar
OBS ou qualquer outro programa.

App **Electron**, usando **WebRTC** pra transmitir (mesma tecnologia por trás
do compartilhamento de tela do Discord/Google Meet) e um módulo nativo em C++
pra controlar áudio no nível do Windows: mutar cada aplicativo individualmente
na sua transmissão (ex: mutar só o Discord, sem mutar o jogo).

## Funcionalidades

- Descoberta automática de sala na rede (broadcast UDP, igual "Mundo de LAN").
- Vários transmitindo ao mesmo tempo; cada um vira um quadro na grade.
- Tela cheia de uma transmissão, ou de várias juntas e divididas (seleciona
  com a caixinha "Selecionar" em cada quadro).
- Mute e volume independentes por transmissão que você está assistindo.
- Perfil com apelido + foto (aparece como ícone redondo pros outros).
- Mic: opção de incluir ao compartilhar, com **redução de ruído automática**,
  e botão de mutar seu microfone sem parar a transmissão.
- **Mute por app individual** (ex: Discord) na sua própria transmissão —
  agrupado por nome do processo (mutar "Brave" muta todas as abas dele, não
  só uma). Mutar de fato **para a captura nativa** daquele app (não só zera o
  volume) — economiza CPU.
- **Picture-in-Picture**: qualquer quadro pode virar uma janelinha flutuante
  (por cima de tudo) pra assistir enquanto mexe em outra coisa no PC.
- **Configurações de transmissão** (resolução e taxa de quadros) antes de
  compartilhar a tela — baixar a resolução/fps ajuda bastante quando for
  jogar enquanto transmite.
- Preferência por **codec H264** na transmissão de tela (usa aceleração por
  hardware quando disponível — NVENC/QuickSync/AMD VCE — em vez de só CPU).

## Como usar

1. Todos instalam o **mesmo instalador** (`dist\Suvaco da Jinx Setup 2.0.0.exe`)
   e abrem pelo atalho criado.
2. Uma pessoa clica **"Hospedar sala aqui"** — a sala aparece sozinha na tela
   dos outros.
3. Os demais clicam **"Entrar"** (ou digitam `IP:porta` manualmente).
4. Qualquer um clica **"Compartilhar minha tela"** — vários ao mesmo tempo
   funcionam.

**Se a sala não aparecer:** confirme que todos estão *conectados* na mesma
rede do Radmin VPN, e que o Firewall do Windows liberou o `Suvaco da Jinx.exe`.
Como último recurso, `ipconfig` no host, pega o IP do adaptador Radmin
(começa com `26.`) e passa `IP:47400` pros outros digitarem.

## Distribuição: instalador

`dist\Suvaco da Jinx Setup 2.0.0.exe` — cada amigo roda uma vez (não precisa ser
admin, instala só pro usuário atual), aceita criar atalho, e usa o atalho
dali pra frente. Trocado do alvo `portable` (que descompactava o app inteiro
numa pasta temporária a cada abertura — por isso ficava lento) pra um
instalador NSIS de verdade.

Otimizações de tamanho/velocidade já aplicadas:
- `asar: true` — código do app num arquivo só, menos I/O de disco pra abrir.
- Dependências de build removidas do pacote final (ficam só no repo, pra
  quando for recompilar).
- Idiomas do Electron reduzidos de 55 pra 2 (`pt-BR` + `en-US`).
- App instalado: ~321 MB. Instalador: ~98 MB (compressão máxima).

## Setup de desenvolvimento

Python 3.12 e Visual Studio Build Tools (workload C++) já estão instalados
neste PC (Build Tools em `D:\VSBuildTools`). Pra recompilar depois de mudar
código:

```bash
cd C:\Users\dougl\tela-radmin
npm install
npm run rebuild-native   # só se mexeu em native/src/addon.cpp
npm start                 # abre o app em modo dev
npm run dist               # gera dist/Suvaco da Jinx Setup 2.0.0.exe
```

## Como funciona por dentro

| Peça | Papel |
| --- | --- |
| `server/main.cjs` | Servidor HTTP (serve `server/public/`) + WebSocket de sinalização (`/relay`) + WebSocket de controle local (`/lan/ctl`) + beacon/descoberta UDP. Roda dentro do Electron. Usa `server/vendor/ws` (vendorizado, fora de `node_modules`, porque o empacotador do Electron tem uma lógica própria de inclusão de `node_modules` que ignora pacotes ali sem aviso — vendorizar evita esse problema). |
| `server/public/app.js` | Todo o front: lobby, grade de vídeos, WebRTC (`RTCPeerConnection` por par transmissor↔espectador), tela cheia, e a mixagem de áudio por app via Web Audio (`window.telaNative`, exposto pelo preload do Electron). |
| `electron/main.js` | Processo principal: sobe o mesmo `server/main.cjs`, abre a janela, faz a ponte com o seletor de tela/janela e o módulo nativo. |
| `electron/picker.html` | Seletor de tela/janela pro `getDisplayMedia` (o Electron não abre um sozinho como o Chrome faz). |
| `native/src/addon.cpp` | Módulo nativo (N-API/C++): lista processos com sessão de áudio ativa e captura o áudio de **um processo por vez** via `AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK` (API do Windows 10 2004+). Cada app vira uma captura independente — misturar e mutar cada uma é feito no JavaScript (Web Audio), não aqui. Handler de ativação precisa herdar de `Microsoft::WRL::FtmBase` (free-threaded marshaler) — sem isso `ActivateAudioInterfaceAsync` falha sempre com `E_ILLEGAL_METHOD_CALL`, [documentado no Microsoft Learn](https://learn.microsoft.com/en-us/windows/win32/api/mmdeviceapi/nf-mmdeviceapi-activateaudiointerfaceasync). |

O relay (WebSocket) nunca vê vídeo nem áudio — só mensagens pequenas
(`presence`, `offer`, `answer`, candidatos ICE). Por estarem na mesma rede
virtual do Radmin, não precisa de servidor STUN/TURN.
