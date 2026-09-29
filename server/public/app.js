// Tela Radmin — frontend puro (sem build step).
// Lobby: hospeda ou entra numa sala descoberta na rede local via UDP broadcast.
// Sala: relay WebSocket só troca presença + sinalização WebRTC; o vídeo em si
// vai direto (P2P) de quem compartilha pra cada espectador.
//
// Tela e câmera são duas "fontes" (source) independentes: cada pessoa pode
// ligar uma, outra, ou as duas ao mesmo tempo — cada uma vira seu próprio
// RTCPeerConnection por espectador e seu próprio quadro na grade, identificado
// pela chave composta `${participanteId}:${source}`.
'use strict';

const DEFAULT_AVATAR =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
      '<rect width="64" height="64" rx="32" fill="#2c313c"/>' +
      '<circle cx="32" cy="24" r="12" fill="#5b8cff"/>' +
      '<path d="M12 56c0-12 9-20 20-20s20 8 20 20" fill="#5b8cff"/>' +
      '</svg>',
  );

const isElectron = typeof window.telaNative !== 'undefined';

// Ícones em SVG (sem dependência externa) — usados nos lugares onde o botão
// precisa trocar de estado (mutar/desmutar, tela/câmera compartilhando).
const ICON_ATTRS = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const ICONS = {
  mic: `<svg ${ICON_ATTRS}><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`,
  micOff: `<svg ${ICON_ATTRS}><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 4.24 2.73M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`,
  volume: `<svg ${ICON_ATTRS}><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`,
  volumeMute: `<svg ${ICON_ATTRS}><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>`,
  maximize: `<svg ${ICON_ATTRS}><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>`,
  monitor: `<svg ${ICON_ATTRS}><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`,
  camera: `<svg ${ICON_ATTRS}><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>`,
  check: `<svg ${ICON_ATTRS}><polyline points="20 6 9 17 4 12"/></svg>`,
  pip: `<svg ${ICON_ATTRS}><rect x="2" y="4" width="20" height="16" rx="2"/><rect x="12" y="12" width="8" height="6" rx="1"/></svg>`,
};

const els = {
  lobby: document.getElementById('lobby'),
  room: document.getElementById('room'),
  nameInput: document.getElementById('nameInput'),
  avatarPreview: document.getElementById('avatarPreview'),
  openProfileBtn: document.getElementById('openProfileBtn'),
  profileModal: document.getElementById('profileModal'),
  profileModalCard: document.getElementById('profileModalCard'),
  profileModalClose: document.getElementById('profileModalClose'),
  bannerLabel: document.getElementById('bannerLabel'),
  profileBanner: document.getElementById('profileBanner'),
  bannerInput: document.getElementById('bannerInput'),
  modalAvatarPreview: document.getElementById('modalAvatarPreview'),
  modalAvatarInput: document.getElementById('modalAvatarInput'),
  profileModalName: document.getElementById('profileModalName'),
  bioInput: document.getElementById('bioInput'),
  profileHistorySection: document.getElementById('profileHistorySection'),
  profileHistoryList: document.getElementById('profileHistoryList'),
  hostBtn: document.getElementById('hostBtn'),
  roomList: document.getElementById('roomList'),
  manualHost: document.getElementById('manualHost'),
  manualPort: document.getElementById('manualPort'),
  manualJoinBtn: document.getElementById('manualJoinBtn'),
  roomInfo: document.getElementById('roomInfo'),
  peopleCount: document.getElementById('peopleCount'),
  peopleBar: document.getElementById('peopleBar'),
  micCheckWrap: document.getElementById('micCheckWrap'),
  micCheck: document.getElementById('micCheck'),
  micMuteBtn: document.getElementById('micMuteBtn'),
  cameraBtn: document.getElementById('cameraBtn'),
  shareBtn: document.getElementById('shareBtn'),
  leaveBtn: document.getElementById('leaveBtn'),
  inviteBtn: document.getElementById('inviteBtn'),
  toast: document.getElementById('toast'),
  focusBar: document.getElementById('focusBar'),
  focusCount: document.getElementById('focusCount'),
  focusBtn: document.getElementById('focusBtn'),
  grid: document.getElementById('grid'),
  emptyHint: document.getElementById('emptyHint'),
  appAudioPanel: document.getElementById('appAudioPanel'),
  appAudioList: document.getElementById('appAudioList'),
  leaveCallBtn: document.getElementById('leaveCallBtn'),
  appAudioToggle: document.getElementById('appAudioToggle'),
  appAudioBody: document.getElementById('appAudioBody'),
  refreshAppsBtn: document.getElementById('refreshAppsBtn'),
  sidebar: document.getElementById('sidebar'),
  peopleToggleBtn: document.getElementById('peopleToggleBtn'),
  settingsBtn: document.getElementById('settingsBtn'),
  settingsPanel: document.getElementById('settingsPanel'),
  resolutionSelect: document.getElementById('resolutionSelect'),
  fpsSelect: document.getElementById('fpsSelect'),
  noiseSuppressionCheck: document.getElementById('noiseSuppressionCheck'),
  modeTabLan: document.getElementById('modeTabLan'),
  modeTabInternet: document.getElementById('modeTabInternet'),
  lanModeSection: document.getElementById('lanModeSection'),
  internetModeSection: document.getElementById('internetModeSection'),
  createCodeRoomBtn: document.getElementById('createCodeRoomBtn'),
  joinCodeInput: document.getElementById('joinCodeInput'),
  joinCodeBtn: document.getElementById('joinCodeBtn'),
  internetModeStatus: document.getElementById('internetModeStatus'),
};

// STUN públicos (gratuitos) — deixam duas máquinas em redes diferentes se
// conectarem direto pela internet sem precisar de Radmin/VPN nenhuma. Não
// atrapalha o modo rede local: só dá mais opções de caminho de conexão pro
// WebRTC escolher, ele prefere o caminho direto (LAN) quando existe.
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

const NAME_KEY = 'tela-radmin:name';
const AVATAR_KEY = 'tela-radmin:avatar';
const BANNER_KEY = 'tela-radmin:banner';
const BIO_KEY = 'tela-radmin:bio';
const HISTORY_KEY = 'tela-radmin:app-history';
els.nameInput.value = localStorage.getItem(NAME_KEY) || '';

let myAvatar = localStorage.getItem(AVATAR_KEY) || null;
let myBanner = localStorage.getItem(BANNER_KEY) || null;
let myBio = localStorage.getItem(BIO_KEY) || '';
els.avatarPreview.src = myAvatar || DEFAULT_AVATAR;

let appHistory = new Set();
try {
  appHistory = new Set(JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'));
} catch {
  /* dado corrompido, começa vazio */
}
function saveAppHistory() {
  localStorage.setItem(HISTORY_KEY, JSON.stringify([...appHistory]));
}
function rememberAppsInHistory(apps) {
  let changed = false;
  for (const app of apps) {
    if (!appHistory.has(app.name)) {
      appHistory.add(app.name);
      changed = true;
    }
  }
  if (changed) saveAppHistory();
}

function resizeImageToDataUrl(file, width, height) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      const scale = Math.max(width / img.width, height / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      ctx.drawImage(img, (width - w) / 2, (height - h) / 2, w, h);
      URL.revokeObjectURL(img.src);
      resolve(canvas.toDataURL('image/jpeg', 0.7));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

/* ---------------- modal de perfil (editar o seu / ver o de alguém) ---------------- */

function renderProfileBanner(el, banner) {
  el.style.backgroundImage = banner ? `url(${banner})` : '';
}

function renderProfileHistory() {
  if (!appHistory.size) {
    els.profileHistoryList.innerHTML = '<p class="hint">Nenhum ainda — aparece depois que você compartilhar a tela.</p>';
    return;
  }
  els.profileHistoryList.innerHTML = '';
  for (const name of [...appHistory].sort()) {
    const chip = document.createElement('span');
    chip.className = 'history-chip';
    chip.textContent = name;
    els.profileHistoryList.appendChild(chip);
  }
}

function openProfileModal({ readOnly, name, avatar, banner, bio }) {
  els.profileModal.classList.toggle('readonly', readOnly);
  els.profileModal.classList.remove('hidden');
  els.profileModalName.textContent = name || 'Convidado';
  els.modalAvatarPreview.src = avatar || DEFAULT_AVATAR;
  renderProfileBanner(els.profileBanner, banner);
  els.bioInput.value = bio || '';
  els.bioInput.readOnly = !!readOnly;
  els.bioInput.placeholder = readOnly ? 'Essa pessoa não escreveu uma bio.' : 'Fale um pouco sobre você...';
  if (!readOnly) renderProfileHistory();
}

function closeProfileModal() {
  els.profileModal.classList.add('hidden');
}

function openOwnProfile() {
  openProfileModal({
    readOnly: false,
    name: (els.nameInput.value || 'Convidado').trim() || 'Convidado',
    avatar: myAvatar,
    banner: myBanner,
    bio: myBio,
  });
}

els.openProfileBtn.addEventListener('click', openOwnProfile);
els.profileModalClose.addEventListener('click', closeProfileModal);
els.profileModal.addEventListener('click', (ev) => {
  if (ev.target === els.profileModal) closeProfileModal();
});

els.modalAvatarInput.addEventListener('change', async (ev) => {
  const file = ev.target.files[0];
  if (!file) return;
  try {
    const dataUrl = await resizeImageToDataUrl(file, 96, 96);
    myAvatar = dataUrl;
    localStorage.setItem(AVATAR_KEY, dataUrl);
    els.avatarPreview.src = dataUrl;
    els.modalAvatarPreview.src = dataUrl;
  } catch {
    /* imagem inválida, ignora */
  }
});

els.bannerInput.addEventListener('change', async (ev) => {
  const file = ev.target.files[0];
  if (!file) return;
  try {
    const dataUrl = await resizeImageToDataUrl(file, 600, 180);
    myBanner = dataUrl;
    localStorage.setItem(BANNER_KEY, dataUrl);
    renderProfileBanner(els.profileBanner, dataUrl);
  } catch {
    /* imagem inválida, ignora */
  }
});

els.bioInput.addEventListener('input', () => {
  if (els.bioInput.readOnly) return;
  myBio = els.bioInput.value;
  localStorage.setItem(BIO_KEY, myBio);
});

let ctlWs = null;
let lanInfo = null;

function tileKey(id, source) {
  return `${id}:${source}`;
}

const SETTINGS_KEY = 'tela-radmin:settings';
function loadSettings() {
  const defaults = { resolution: '1920x1080', fps: 30, noiseSuppression: true };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...defaults, ...JSON.parse(raw) };
  } catch {
    /* configuração corrompida, usa o padrão */
  }
  return defaults;
}
function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
}

const state = {
  transport: null,
  roomMode: null, // 'lan' | 'internet'
  roomAddr: '', // usado no modo lan (host:porta)
  roomCode: null, // usado no modo internet
  myId: null,
  myName: '',
  settings: loadSettings(),
  watchPcs: new Map(), // `${transmissorId}:${source}` -> RTCPeerConnection (eu assistindo)
  broadcastPcs: new Map(), // `${espectadorId}:${source}` -> RTCPeerConnection (eu transmitindo pra ele)
  tiles: new Map(), // mesma chave -> { root, video, isSelf }
  pinned: new Set(), // chaves marcadas pra entrar juntas na tela cheia
  focusOverlay: null,
  focusIds: null,
  screen: { sharing: false, displayStream: null, micStream: null, micTrack: null, localTracks: [] },
  camera: { sharing: false, camStream: null, localTracks: [] },
};

/* ---------------- configurações de transmissão (resolução/fps/ruído) ---------------- */

els.resolutionSelect.value = state.settings.resolution;
els.fpsSelect.value = String(state.settings.fps);
els.noiseSuppressionCheck.checked = state.settings.noiseSuppression;

els.resolutionSelect.addEventListener('change', () => {
  state.settings.resolution = els.resolutionSelect.value;
  saveSettings();
});
els.fpsSelect.addEventListener('change', () => {
  state.settings.fps = Number(els.fpsSelect.value);
  saveSettings();
});
els.noiseSuppressionCheck.addEventListener('change', () => {
  state.settings.noiseSuppression = els.noiseSuppressionCheck.checked;
  saveSettings();
});

els.settingsBtn.addEventListener('click', () => {
  els.settingsPanel.classList.toggle('hidden');
});
document.addEventListener('click', (ev) => {
  if (els.settingsPanel.classList.contains('hidden')) return;
  if (els.settingsPanel.contains(ev.target) || els.settingsBtn.contains(ev.target)) return;
  els.settingsPanel.classList.add('hidden');
});

function screenVideoConstraints() {
  const video = { frameRate: { ideal: state.settings.fps, max: state.settings.fps } };
  if (state.settings.resolution !== 'native') {
    const [w, h] = state.settings.resolution.split('x').map(Number);
    video.width = { ideal: w };
    video.height = { ideal: h };
  }
  return video;
}

function micConstraints() {
  return {
    audio: {
      noiseSuppression: state.settings.noiseSuppression,
      echoCancellation: true,
      autoGainControl: true,
    },
  };
}

// Prioriza H264 (que costuma ter aceleração por hardware — NVENC/QuickSync/
// AMD VCE) em vez do VP8/VP9 padrão do Chromium pra tela, que geralmente só
// tem encoder por software. Isso tira carga da CPU durante a transmissão —
// é a causa mais comum de queda de FPS em jogos leves enquanto transmite.
function preferH264(pc) {
  if (typeof RTCRtpSender === 'undefined' || !RTCRtpSender.getCapabilities) return;
  const capabilities = RTCRtpSender.getCapabilities('video');
  if (!capabilities) return;
  const h264 = capabilities.codecs.filter((c) => c.mimeType.toLowerCase() === 'video/h264');
  if (!h264.length) return; // sem suporte a H264 nesse PC, deixa o padrão do navegador
  const others = capabilities.codecs.filter((c) => c.mimeType.toLowerCase() !== 'video/h264');
  const preferred = [...h264, ...others];
  for (const transceiver of pc.getTransceivers()) {
    const track = transceiver.sender && transceiver.sender.track;
    if (track && track.kind === 'video' && transceiver.setCodecPreferences) {
      try {
        transceiver.setCodecPreferences(preferred);
      } catch {
        /* alguns navegadores recusam certas combinações; segue com o padrão */
      }
    }
  }
}

const PRESENCE_FIELD = { screen: 'sharingScreen', camera: 'sharingCamera' };

/* ---------------- áudio por app (mixagem via Web Audio, só no Electron) ----------------
   Cada app vira sua própria captura nativa (PCM cru); aqui a gente agenda os
   pedaços de PCM como AudioBufferSource tocando em sequência (técnica comum
   de streaming de PCM pelo Web Audio) e liga cada um num GainNode próprio —
   mutar um app é só zerar o gain dele, sem afetar os outros. Isso só vale
   pra transmissão de TELA (a câmera não carrega áudio do sistema). */

// Agrupado por NOME do processo, não por PID individual: navegadores
// baseados em Chromium (Brave, Edge, o próprio Chrome) rodam cada aba num
// processo separado, então "Brave" pode aparecer com vários PIDs distintos
// ao mesmo tempo. Mutar por PID deixava outras abas do mesmo navegador
// tocando sem querer — agrupando por nome, mutar "Brave" muta todos os
// processos dele, inclusive os que aparecerem depois na mesma transmissão.
const appAudio = {
  ctx: null,
  destination: null,
  micSource: null,
  micGain: null,
  groups: new Map(), // nome -> { muted, pids: Map(pid -> { gainNode, nextTime, handle }) }
};
let audioChunkUnsub = null;

function ensureAudioGraph() {
  if (!appAudio.ctx) {
    appAudio.ctx = new AudioContext({ sampleRate: 48000 });
    appAudio.destination = appAudio.ctx.createMediaStreamDestination();
  }
}

function findPidEntry(pid) {
  for (const group of appAudio.groups.values()) {
    const entry = group.pids.get(pid);
    if (entry) return entry;
  }
  return null;
}

function initAudioChunkRouter() {
  if (audioChunkUnsub || !isElectron) return;
  audioChunkUnsub = window.telaNative.onAudioChunk(({ pid, buffer }) => {
    const entry = findPidEntry(pid);
    if (entry) playPcmChunk(entry, buffer);
  });
}

function playPcmChunk(entry, rawBuffer) {
  const floats = new Float32Array(rawBuffer.buffer, rawBuffer.byteOffset, rawBuffer.byteLength / 4);
  const frameCount = Math.floor(floats.length / 2); // estéreo intercalado
  if (frameCount <= 0) return;
  const audioBuffer = appAudio.ctx.createBuffer(2, frameCount, 48000);
  const left = audioBuffer.getChannelData(0);
  const right = audioBuffer.getChannelData(1);
  for (let i = 0; i < frameCount; i++) {
    left[i] = floats[i * 2];
    right[i] = floats[i * 2 + 1];
  }
  const source = appAudio.ctx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(entry.gainNode);
  const now = appAudio.ctx.currentTime;
  if (entry.nextTime < now + 0.02) entry.nextTime = now + 0.05;
  source.start(entry.nextTime);
  entry.nextTime += frameCount / 48000;
}

function startCapturingApp(pid, name) {
  ensureAudioGraph();
  let group = appAudio.groups.get(name);
  if (!group) {
    group = { muted: false, pids: new Map() };
    appAudio.groups.set(name, group);
  }
  const gainNode = appAudio.ctx.createGain();
  gainNode.connect(appAudio.destination);
  const entry = { gainNode, nextTime: 0, handle: null };
  group.pids.set(pid, entry);
  // Se o grupo (nome) já estava mutado, nem começa a captura nativa — muted
  // não é só "gain zero", é a captura de fato parada (economiza CPU: sem
  // thread WASAPI, sem IPC de PCM, sem agendamento no Web Audio pra esse pid).
  if (!group.muted) {
    window.telaNative.startCapture(pid).then((handle) => { entry.handle = handle; });
  }
}

async function refreshAppList() {
  if (!isElectron || !state.screen.sharing) return;
  const available = await window.telaNative.available();
  if (!available) {
    els.appAudioList.innerHTML = '<p class="hint">Módulo nativo de áudio por app ainda não compilado neste PC.</p>';
    return;
  }
  const apps = await window.telaNative.listApps();
  renderAppMuteList(apps);
  rememberAppsInHistory(apps);
  for (const app of apps) {
    const group = appAudio.groups.get(app.name);
    if (!group || !group.pids.has(app.pid)) startCapturingApp(app.pid, app.name);
  }
  // processos que sumiram da lista (app fechado/aba fechada) -> para a captura deles
  const seenPids = new Set(apps.map((a) => a.pid));
  for (const [name, group] of [...appAudio.groups]) {
    for (const [pid, entry] of [...group.pids]) {
      if (seenPids.has(pid)) continue;
      if (entry.handle != null) window.telaNative.stopCapture(entry.handle);
      entry.gainNode.disconnect();
      group.pids.delete(pid);
    }
    if (group.pids.size === 0) appAudio.groups.delete(name);
  }
}

function renderAppMuteList(apps) {
  if (!apps.length) {
    els.appAudioList.innerHTML = '<p class="hint">Nenhum app com áudio ativo encontrado agora.</p>';
    return;
  }
  const names = [...new Set(apps.map((a) => a.name))];
  els.appAudioList.innerHTML = '';
  for (const name of names) {
    const group = appAudio.groups.get(name);
    const muted = group ? group.muted : false;
    const row = document.createElement('div');
    row.className = 'app-audio-row';
    row.innerHTML = `<span>${escapeHtml(name)}</span>`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ghost icon-btn';
    btn.innerHTML = muted ? ICONS.volumeMute : ICONS.volume;
    btn.addEventListener('click', () => toggleAppMute(name, btn));
    row.appendChild(btn);
    els.appAudioList.appendChild(row);
  }
}

function toggleAppMute(name, btn) {
  const group = appAudio.groups.get(name);
  if (!group) return;
  group.muted = !group.muted;
  for (const [pid, entry] of group.pids) {
    if (group.muted) {
      if (entry.handle != null) {
        window.telaNative.stopCapture(entry.handle);
        entry.handle = null;
      }
    } else if (entry.handle == null) {
      window.telaNative.startCapture(pid).then((handle) => { entry.handle = handle; });
    }
  }
  btn.innerHTML = group.muted ? ICONS.volumeMute : ICONS.volume;
}

function teardownAppAudio() {
  for (const group of appAudio.groups.values()) {
    for (const entry of group.pids.values()) {
      if (entry.handle != null) window.telaNative.stopCapture(entry.handle);
      entry.gainNode.disconnect();
    }
  }
  appAudio.groups.clear();
  if (appAudio.micSource) { appAudio.micSource.disconnect(); appAudio.micSource = null; }
  if (appAudio.micGain) { appAudio.micGain.disconnect(); appAudio.micGain = null; }
  if (appAudio.ctx) { appAudio.ctx.close(); appAudio.ctx = null; appAudio.destination = null; }
  els.appAudioPanel.classList.add('hidden');
  els.appAudioList.innerHTML = '';
}

els.refreshAppsBtn.addEventListener('click', refreshAppList);

/* ---------------- lobby: descoberta de salas ---------------- */

fetch('/lan/info').then((r) => r.json()).then((info) => { lanInfo = info; });

function connectCtl() {
  ctlWs = new WebSocket(`ws://${location.host}/lan/ctl`);
  ctlWs.addEventListener('open', () => {
    ctlWs.send(JSON.stringify({ type: 'discover:start' }));
  });
  ctlWs.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'rooms') renderRoomList(msg.rooms);
  });
}
connectCtl();

function renderRoomList(rooms) {
  if (!rooms.length) {
    els.roomList.innerHTML = '<p class="hint">Nenhuma sala encontrada na rede ainda.</p>';
    return;
  }
  els.roomList.innerHTML = '';
  for (const r of rooms) {
    const item = document.createElement('div');
    item.className = 'room-item';
    item.innerHTML = `
      <div>
        <div class="name">${escapeHtml(r.name)}</div>
        <div class="meta">${r.host}:${r.port} · ${r.people} na sala</div>
      </div>
    `;
    const btn = document.createElement('button');
    btn.className = 'primary';
    btn.textContent = 'Entrar';
    btn.addEventListener('click', () => joinRoom(r.host, r.port));
    item.appendChild(btn);
    els.roomList.appendChild(item);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------------- abas de modo: rede local (Radmin) vs internet ---------------- */

els.modeTabLan.addEventListener('click', () => {
  els.modeTabLan.classList.add('active');
  els.modeTabInternet.classList.remove('active');
  els.lanModeSection.classList.remove('hidden');
  els.internetModeSection.classList.add('hidden');
});
els.modeTabInternet.addEventListener('click', () => {
  els.modeTabInternet.classList.add('active');
  els.modeTabLan.classList.remove('active');
  els.internetModeSection.classList.remove('hidden');
  els.lanModeSection.classList.add('hidden');
});

els.hostBtn.addEventListener('click', () => {
  const name = (els.nameInput.value || 'Convidado').trim() || 'Convidado';
  localStorage.setItem(NAME_KEY, name);
  ctlWs.send(JSON.stringify({ type: 'host:start', name: `Sala de ${name}` }));
  joinLanRoom(lanInfo ? lanInfo.localIp : location.hostname, lanInfo ? lanInfo.port : location.port);
});

els.manualJoinBtn.addEventListener('click', () => {
  const host = els.manualHost.value.trim();
  const port = els.manualPort.value.trim() || '47400';
  if (!host) return;
  joinLanRoom(host, port);
});

/* ---------------- transporte: uma "sala" pode rodar sobre WebSocket (rede
   local, servidor já existe em server/main.cjs) OU sobre PeerJS (internet,
   sem Radmin — usa o corretor público gratuito só pra combinar quem quer
   falar com quem; depois disso é WebRTC direto igual sempre foi). O resto
   do app (presença, sinalização de vídeo) não sabe nem precisa saber qual
   dos dois está por baixo — só chama state.transport.send(objeto). ---------------- */

function handleTransportMessage(msg) {
  if (msg.type === 'welcome') {
    state.myId = msg.id;
  } else if (msg.type === 'presence') {
    onPresence(msg.clients);
  } else if (msg.type === 'signal') {
    onSignal(msg.from, msg.data);
  }
}

function joinLanRoom(host, port) {
  const name = (els.nameInput.value || 'Convidado').trim() || 'Convidado';
  localStorage.setItem(NAME_KEY, name);
  state.myName = name;
  state.roomMode = 'lan';
  state.roomAddr = `${host}:${port}`;

  const ws = new WebSocket(`ws://${host}:${port}/relay`);
  state.transport = {
    send(obj) { ws.send(JSON.stringify(obj)); },
    close() { ws.close(); },
  };

  ws.addEventListener('open', () => {
    state.transport.send({ type: 'hello', name, avatar: myAvatar, banner: myBanner, bio: myBio });
  });
  ws.addEventListener('message', (ev) => handleTransportMessage(JSON.parse(ev.data)));
  ws.addEventListener('close', () => leaveRoom());
  ws.addEventListener('error', () => {}); // 'close' já cuida de avisar/limpar

  enterRoomScreen(`Sala em ${host}`);
}

/* ---------------- modo internet: código de sala via PeerJS (sem Radmin) ----------------
   Quem "cria a sala" vira o ponto central (mesmo papel que o host tem no
   modo rede local): os outros conectam DIRETO nele por WebRTC (o PeerJS só
   serviu de intermediário pra combinar essa conexão), e ele repassa
   presença/sinalização pros demais — não tem servidor nenhum rodando 24h,
   só enquanto quem criou a sala estiver com o app aberto. */

const ROOM_CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sem 0/O/1/I/L pra não confundir
function makeRoomCode() {
  let code = '';
  for (let i = 0; i < 6; i++) code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
  return code;
}

function setInternetStatus(text) {
  els.internetModeStatus.textContent = text;
  els.internetModeStatus.classList.toggle('hidden', !text);
}

function hostInternetRoom() {
  const name = (els.nameInput.value || 'Convidado').trim() || 'Convidado';
  localStorage.setItem(NAME_KEY, name);
  state.myName = name;
  state.roomMode = 'internet';

  const code = makeRoomCode();
  const peer = new Peer(`svj-${code}`);
  const members = new Map(); // id -> { conn: DataConnection|null (null = eu mesmo), ...dados... }
  let selfId = null;

  function deliver(id, msg) {
    const m = members.get(id);
    if (!m) return;
    if (m.conn === null) handleTransportMessage(msg);
    else if (m.conn.open) m.conn.send(msg);
  }

  function broadcastPresence() {
    const list = [...members.entries()].map(([id, m]) => ({
      id, name: m.name, avatar: m.avatar, banner: m.banner, bio: m.bio,
      sharingScreen: m.sharingScreen, sharingCamera: m.sharingCamera,
    }));
    for (const id of members.keys()) deliver(id, { type: 'presence', clients: list });
  }

  function handleIncoming(fromId, msg) {
    const m = members.get(fromId);
    if (!m || !msg || !msg.type) return;
    if (msg.type === 'hello') {
      m.name = String(msg.name || 'Convidado').slice(0, 30);
      if (typeof msg.avatar === 'string' && msg.avatar.startsWith('data:image/')) m.avatar = msg.avatar.slice(0, 60000);
      if (typeof msg.banner === 'string' && msg.banner.startsWith('data:image/')) m.banner = msg.banner.slice(0, 120000);
      if (typeof msg.bio === 'string') m.bio = msg.bio.slice(0, 190);
      broadcastPresence();
    } else if (msg.type === 'share:start') {
      if (msg.source === 'camera') m.sharingCamera = true; else m.sharingScreen = true;
      broadcastPresence();
    } else if (msg.type === 'share:stop') {
      if (msg.source === 'camera') m.sharingCamera = false; else m.sharingScreen = false;
      broadcastPresence();
    } else if (msg.type === 'signal' && msg.to) {
      deliver(msg.to, { type: 'signal', from: fromId, data: msg.data });
    }
  }

  peer.on('open', (id) => {
    selfId = id;
    members.set(id, { conn: null, name, avatar: myAvatar, banner: myBanner, bio: myBio, sharingScreen: false, sharingCamera: false });
    state.transport = {
      send(obj) { handleIncoming(selfId, obj); },
      close() { peer.destroy(); },
    };
    handleTransportMessage({ type: 'welcome', id });
    enterRoomScreen('Sala pela internet', code);
  });

  peer.on('connection', (conn) => {
    const id = conn.peer;
    members.set(id, { conn, name: 'Convidado', avatar: null, banner: null, bio: '', sharingScreen: false, sharingCamera: false });
    conn.on('data', (msg) => handleIncoming(id, msg));
    conn.on('close', () => { members.delete(id); broadcastPresence(); });
  });

  peer.on('error', (err) => {
    console.warn('[internet] erro no peer host:', err.type || err.message);
    if (err.type === 'unavailable-id') setInternetStatus('Esse código já está em uso, tenta de novo.');
    else setInternetStatus('Não deu pra criar a sala pela internet agora. Confere sua conexão.');
  });
}

function joinInternetRoom(code) {
  const name = (els.nameInput.value || 'Convidado').trim() || 'Convidado';
  localStorage.setItem(NAME_KEY, name);
  state.myName = name;
  state.roomMode = 'internet';
  setInternetStatus('Conectando…');

  const peer = new Peer();
  peer.on('open', () => {
    const conn = peer.connect(`svj-${code}`, { reliable: true });
    conn.on('open', () => {
      state.transport = {
        send(obj) { if (conn.open) conn.send(obj); },
        close() { peer.destroy(); },
      };
      handleTransportMessage({ type: 'welcome', id: peer.id });
      enterRoomScreen('Sala pela internet', code);
      state.transport.send({ type: 'hello', name, avatar: myAvatar, banner: myBanner, bio: myBio });
    });
    conn.on('data', (msg) => handleTransportMessage(msg));
    conn.on('close', () => leaveRoom());
    conn.on('error', (err) => setInternetStatus(`Não deu pra entrar: ${err.message || err.type}`));
  });
  peer.on('error', (err) => {
    console.warn('[internet] erro no peer:', err.type || err.message);
    if (err.type === 'peer-unavailable') setInternetStatus('Código não encontrado — confere se está certo e se quem criou a sala ainda está com o app aberto.');
    else setInternetStatus('Não deu pra conectar agora. Confere sua conexão com a internet.');
  });
}

els.createCodeRoomBtn.addEventListener('click', hostInternetRoom);
els.joinCodeBtn.addEventListener('click', () => {
  const code = els.joinCodeInput.value.trim().toUpperCase();
  if (code.length < 4) {
    setInternetStatus('Digita o código completo que te passaram.');
    return;
  }
  joinInternetRoom(code);
});

function enterRoomScreen(label, roomCode) {
  els.lobby.classList.add('hidden');
  els.room.classList.remove('hidden');
  els.roomInfo.textContent = roomCode ? `${label} · código ${roomCode}` : label;
  state.roomCode = roomCode || null;
}

els.leaveBtn.addEventListener('click', () => {
  if (state.transport) state.transport.close();
  leaveRoom();
});
els.leaveCallBtn.addEventListener('click', () => {
  if (state.transport) state.transport.close();
  leaveRoom();
});

let toastTimer = null;
function showToast(message) {
  els.toast.innerHTML = `${ICONS.check}<span>${message}</span>`;
  els.toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.add('hidden'), 2500);
}

els.peopleToggleBtn.addEventListener('click', () => {
  els.sidebar.classList.toggle('hidden');
});

els.appAudioToggle.addEventListener('click', () => {
  els.appAudioBody.classList.toggle('collapsed');
  els.appAudioToggle.classList.toggle('open', !els.appAudioBody.classList.contains('collapsed'));
});

els.inviteBtn.addEventListener('click', async () => {
  const value = state.roomMode === 'internet' ? state.roomCode : state.roomAddr;
  const label = state.roomMode === 'internet' ? 'Código copiado' : 'Endereço copiado';
  try {
    await navigator.clipboard.writeText(value);
    showToast(`${label}: ${value}`);
  } catch {
    showToast(`${state.roomMode === 'internet' ? 'Código' : 'Endereço'} da sala: ${value}`);
  }
});

function leaveRoom() {
  stopScreenShare();
  stopCameraShare();
  for (const key of [...state.watchPcs.keys()]) {
    const sep = key.lastIndexOf(':');
    teardownWatch(key.slice(0, sep), key.slice(sep + 1));
  }
  exitFocusIfActive();
  state.transport = null;
  state.myId = null;
  state.roomMode = null;
  state.roomCode = null;
  els.room.classList.add('hidden');
  els.lobby.classList.remove('hidden');
  setInternetStatus('');
}

/* ---------------- presença: quem está na sala e quem compartilha ---------------- */

function onPresence(list) {
  els.peopleCount.textContent = `· ${list.length} na sala`;
  renderPeopleBar(list);

  const currentIds = new Set(list.map((c) => c.id));
  const infoById = new Map(list.map((c) => [c.id, c]));

  for (const source of ['screen', 'camera']) {
    const field = PRESENCE_FIELD[source];
    const sharingIds = new Set(list.filter((c) => c[field] && c.id !== state.myId).map((c) => c.id));

    // parou de compartilhar essa fonte ou saiu -> derruba a tela de quem eu assistia
    for (const key of [...state.watchPcs.keys()]) {
      if (!key.endsWith(`:${source}`)) continue;
      const id = key.slice(0, key.lastIndexOf(':'));
      if (!sharingIds.has(id)) teardownWatch(id, source);
    }
    // gente nova compartilhando essa fonte -> peço pra assistir
    for (const id of sharingIds) {
      if (!state.watchPcs.has(tileKey(id, source))) {
        const info = infoById.get(id) || {};
        requestWatch(id, source, info.name || 'Convidado', info.avatar || null);
      }
    }
  }

  // espectador que saiu da sala -> derruba minhas transmissões (qualquer fonte) pra ele
  for (const key of [...state.broadcastPcs.keys()]) {
    const viewerId = key.slice(0, key.lastIndexOf(':'));
    if (!currentIds.has(viewerId)) teardownBroadcast(key);
  }

  updateEmptyHint();
}

function renderPeopleBar(list) {
  els.peopleBar.innerHTML = '';
  for (const c of list) {
    const row = document.createElement('div');
    const isSharing = c.sharingScreen || c.sharingCamera;
    row.className = 'people-list-row' + (isSharing ? ' sharing' : '');
    row.title = 'Ver perfil';
    const isMe = c.id === state.myId;
    let badges = '';
    if (c.sharingScreen) badges += `<span class="chip-badge">${ICONS.monitor}</span>`;
    if (c.sharingCamera) badges += `<span class="chip-badge">${ICONS.camera}</span>`;
    row.innerHTML = `<img src="${c.avatar || DEFAULT_AVATAR}" alt="" /><span class="name">${escapeHtml(c.name)}${isMe ? ' (você)' : ''}</span><span class="badges">${badges}</span>`;
    row.addEventListener('click', () => {
      if (isMe) openOwnProfile();
      else openProfileModal({ readOnly: true, name: c.name, avatar: c.avatar, banner: c.banner, bio: c.bio });
    });
    els.peopleBar.appendChild(row);
  }
}

function updateEmptyHint() {
  els.emptyHint.classList.toggle('hidden', state.tiles.size > 0);
}

/* ---------------- sinalização ---------------- */

function sendSignal(to, data) {
  state.transport.send({ type: 'signal', to, data });
}

function onSignal(from, data) {
  const source = data.source || 'screen';
  const key = tileKey(from, source);
  if (data.kind === 'watch-request') {
    createBroadcastPeer(from, source);
  } else if (data.kind === 'offer') {
    handleOffer(from, source, data.sdp);
  } else if (data.kind === 'answer') {
    const pc = state.broadcastPcs.get(key);
    if (pc) pc.setRemoteDescription(data.sdp);
  } else if (data.kind === 'ice') {
    const pc = state.broadcastPcs.get(key) || state.watchPcs.get(key);
    if (pc && data.candidate) pc.addIceCandidate(data.candidate).catch(() => {});
  }
}

/* ---------------- lado de quem assiste ---------------- */

function requestWatch(id, source, name, avatar) {
  const key = tileKey(id, source);
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  state.watchPcs.set(key, pc);

  pc.addEventListener('icecandidate', (ev) => {
    // .toJSON() vira um objeto simples — o transporte por PeerJS (modo
    // internet) não sabe serializar a classe nativa RTCIceCandidate direto,
    // só objetos comuns.
    if (ev.candidate) sendSignal(id, { kind: 'ice', candidate: ev.candidate.toJSON(), source });
  });
  pc.addEventListener('track', (ev) => {
    addOrUpdateTile(key, name, avatar, ev.streams[0], false, source);
  });
  pc.addEventListener('connectionstatechange', () => {
    if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) teardownWatch(id, source);
  });

  sendSignal(id, { kind: 'watch-request', source });
}

async function handleOffer(from, source, sdp) {
  const key = tileKey(from, source);
  const pc = state.watchPcs.get(key);
  if (!pc) return;
  await pc.setRemoteDescription(sdp);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  sendSignal(from, { kind: 'answer', sdp: answer, source });
}

function teardownWatch(id, source) {
  const key = tileKey(id, source);
  const pc = state.watchPcs.get(key);
  if (pc) pc.close();
  state.watchPcs.delete(key);
  removeTile(key);
  updateEmptyHint();
}

/* ---------------- lado de quem transmite: tela ---------------- */

els.shareBtn.addEventListener('click', () => {
  if (state.screen.sharing) stopScreenShare();
  else startScreenShare();
});

async function startScreenShare() {
  let display;
  try {
    // No Electron o vídeo passa pelo seletor próprio (electron/picker.html);
    // o áudio do sistema NÃO vem por aqui — vem da mixagem por app abaixo.
    display = await navigator.mediaDevices.getDisplayMedia({
      video: screenVideoConstraints(),
      audio: !isElectron,
    });
  } catch {
    return; // usuário cancelou o seletor de tela
  }
  state.screen.displayStream = display;
  // Precisa vir antes do bloco abaixo: refreshAppList() só roda se
  // state.screen.sharing já for true (senão o painel de áudio por app fica
  // vazio até alguém clicar em "Atualizar lista" manualmente).
  state.screen.sharing = true;

  let hasMic = false;

  if (isElectron) {
    ensureAudioGraph();
    initAudioChunkRouter();

    if (els.micCheck.checked) {
      try {
        const mic = await navigator.mediaDevices.getUserMedia(micConstraints());
        state.screen.micStream = mic;
        appAudio.micSource = appAudio.ctx.createMediaStreamSource(mic);
        appAudio.micGain = appAudio.ctx.createGain();
        appAudio.micSource.connect(appAudio.micGain).connect(appAudio.destination);
        hasMic = true;
      } catch {
        /* usuário negou o microfone; segue só com a tela */
      }
    }

    els.appAudioPanel.classList.remove('hidden');
    await refreshAppList();

    const mixedAudioTrack = appAudio.destination.stream.getAudioTracks()[0];
    state.screen.localTracks = [...display.getVideoTracks(), mixedAudioTrack];
  } else {
    let micTrack = null;
    if (els.micCheck.checked) {
      try {
        const mic = await navigator.mediaDevices.getUserMedia(micConstraints());
        state.screen.micStream = mic;
        micTrack = mic.getAudioTracks()[0];
        hasMic = true;
      } catch {
        /* usuário negou o microfone; segue só com a tela */
      }
    }
    state.screen.micTrack = micTrack;
    state.screen.localTracks = [...display.getTracks(), ...(micTrack ? [micTrack] : [])];
  }

  setBtnLabel(els.shareBtn, 'Parar de compartilhar');
  els.shareBtn.classList.remove('primary');
  els.shareBtn.classList.add('danger');
  els.micCheckWrap.classList.add('hidden');
  els.settingsBtn.classList.add('hidden');
  els.settingsPanel.classList.add('hidden');
  if (hasMic) {
    els.micMuteBtn.classList.remove('hidden');
    setMicMuteBtn(false);
  }

  display.getVideoTracks()[0].addEventListener('ended', stopScreenShare);

  addOrUpdateTile(tileKey(state.myId, 'screen'), `${state.myName} (você)`, myAvatar, display, true, 'screen');
  updateEmptyHint();
  state.transport.send({ type: 'share:start', source: 'screen' });
}

function setBtnLabel(btn, text) {
  const span = btn.querySelector('span');
  if (span) span.textContent = text;
  btn.title = text; // a barra agora é só ícones — o texto vira dica ao passar o mouse
}

function setMicMuteBtn(muted) {
  const text = muted ? 'Microfone mutado' : 'Mutar microfone';
  els.micMuteBtn.innerHTML = `${muted ? ICONS.micOff : ICONS.mic}<span>${text}</span>`;
  els.micMuteBtn.title = text;
  els.micMuteBtn.classList.toggle('danger', muted);
}

els.micMuteBtn.addEventListener('click', () => {
  if (isElectron) {
    if (!appAudio.micGain) return;
    const wasMuted = appAudio.micGain.gain.value === 0;
    appAudio.micGain.gain.value = wasMuted ? 1 : 0;
    setMicMuteBtn(!wasMuted);
  } else {
    if (!state.screen.micTrack) return;
    state.screen.micTrack.enabled = !state.screen.micTrack.enabled;
    setMicMuteBtn(!state.screen.micTrack.enabled);
  }
});

function stopScreenShare() {
  if (!state.screen.sharing) return;
  state.screen.sharing = false;
  setBtnLabel(els.shareBtn, 'Compartilhar tela');
  els.shareBtn.classList.remove('danger');
  els.shareBtn.classList.add('primary');
  els.micCheckWrap.classList.remove('hidden');
  els.micMuteBtn.classList.add('hidden');
  els.settingsBtn.classList.remove('hidden');

  if (state.screen.displayStream) {
    for (const t of state.screen.displayStream.getTracks()) t.stop();
    state.screen.displayStream = null;
  }
  if (state.screen.micStream) {
    for (const t of state.screen.micStream.getTracks()) t.stop();
    state.screen.micStream = null;
  }
  state.screen.micTrack = null;
  state.screen.localTracks = [];
  if (isElectron) teardownAppAudio();

  for (const key of [...state.broadcastPcs.keys()]) {
    if (key.endsWith(':screen')) teardownBroadcast(key);
  }
  removeTile(tileKey(state.myId, 'screen'));
  updateEmptyHint();

  if (state.transport) {
    state.transport.send({ type: 'share:stop', source: 'screen' });
  }
}

/* ---------------- lado de quem transmite: câmera ---------------- */

els.cameraBtn.addEventListener('click', () => {
  if (state.camera.sharing) stopCameraShare();
  else startCameraShare();
});

async function startCameraShare() {
  let cam;
  try {
    cam = await navigator.mediaDevices.getUserMedia({ video: true });
  } catch {
    return; // sem câmera ou permissão negada
  }
  state.camera.camStream = cam;
  state.camera.localTracks = cam.getVideoTracks();
  state.camera.sharing = true;

  setBtnLabel(els.cameraBtn, 'Desligar câmera');
  els.cameraBtn.classList.add('danger');

  cam.getVideoTracks()[0].addEventListener('ended', stopCameraShare);

  addOrUpdateTile(tileKey(state.myId, 'camera'), `${state.myName} (você)`, myAvatar, cam, true, 'camera');
  updateEmptyHint();
  state.transport.send({ type: 'share:start', source: 'camera' });
}

function stopCameraShare() {
  if (!state.camera.sharing) return;
  state.camera.sharing = false;
  setBtnLabel(els.cameraBtn, 'Câmera');
  els.cameraBtn.classList.remove('danger');

  if (state.camera.camStream) {
    for (const t of state.camera.camStream.getTracks()) t.stop();
    state.camera.camStream = null;
  }
  state.camera.localTracks = [];

  for (const key of [...state.broadcastPcs.keys()]) {
    if (key.endsWith(':camera')) teardownBroadcast(key);
  }
  removeTile(tileKey(state.myId, 'camera'));
  updateEmptyHint();

  if (state.transport) {
    state.transport.send({ type: 'share:stop', source: 'camera' });
  }
}

/* ---------------- transmissão genérica (comum às duas fontes) ---------------- */

async function createBroadcastPeer(viewerId, source) {
  const localTracks = source === 'camera' ? state.camera.localTracks : state.screen.localTracks;
  if (!localTracks.length) return; // pedido chegou depois que eu já parei essa fonte
  const key = tileKey(viewerId, source);
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  state.broadcastPcs.set(key, pc);

  const combined = new MediaStream(localTracks);
  for (const track of localTracks) pc.addTrack(track, combined);
  preferH264(pc);

  pc.addEventListener('icecandidate', (ev) => {
    if (ev.candidate) sendSignal(viewerId, { kind: 'ice', candidate: ev.candidate.toJSON(), source });
  });

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  sendSignal(viewerId, { kind: 'offer', sdp: offer, source });
}

function teardownBroadcast(key) {
  const pc = state.broadcastPcs.get(key);
  if (pc) pc.close();
  state.broadcastPcs.delete(key);
}

/* ---------------- grade de vídeos ---------------- */

function addOrUpdateTile(key, name, avatar, stream, isSelf, source) {
  let tile = state.tiles.get(key);
  if (!tile) {
    const root = document.createElement('div');
    root.className = 'tile' + (isSelf ? ' self' : '');
    root.dataset.key = key;
    const badge = source === 'camera' ? ICONS.camera : ICONS.monitor;
    // Controles vivem em overlays por cima do vídeo e só aparecem no hover
    // (ver .tile-top-overlay/.tile-bottom-overlay no CSS) — mantém a grade
    // limpa quando você só está assistindo.
    root.innerHTML = `
      <div class="tile-video-wrap">
        <video autoplay playsinline ${isSelf ? 'muted' : ''}></video>
        <div class="tile-top-overlay">
          <label class="pin-check" title="Selecionar pra tela cheia">
            <input type="checkbox" class="pin-input" />
            <span class="pin-box"></span>
          </label>
          <div class="tile-top-actions">
            <button type="button" class="btn-pip icon-btn" title="Janela flutuante (Picture-in-Picture)">${ICONS.pip}</button>
            <button type="button" class="btn-fullscreen icon-btn" title="Tela cheia">${ICONS.maximize}</button>
          </div>
        </div>
        <div class="tile-bottom-overlay">
          <div class="tile-identity">
            <img alt="" />
            <span class="tile-badge">${badge}</span>
            <strong></strong>
          </div>
          <div class="tile-audio">
            <button type="button" class="btn-mute icon-btn" title="Silenciar">${ICONS.volume}</button>
            <input type="range" class="vol-slider" min="0" max="100" value="100" title="Volume" />
          </div>
        </div>
      </div>
    `;
    const video = root.querySelector('video');
    const btnMute = root.querySelector('.btn-mute');
    const volSlider = root.querySelector('.vol-slider');
    const btnFullscreen = root.querySelector('.btn-fullscreen');
    const btnPip = root.querySelector('.btn-pip');
    const pinInput = root.querySelector('.pin-input');

    if (!document.pictureInPictureEnabled) {
      btnPip.classList.add('hidden');
    } else {
      btnPip.addEventListener('click', () => {
        if (document.pictureInPictureElement === video) {
          document.exitPictureInPicture().catch(() => {});
        } else {
          video.requestPictureInPicture().catch(() => {});
        }
      });
    }

    btnMute.addEventListener('click', () => {
      video.muted = !video.muted;
      btnMute.innerHTML = video.muted ? ICONS.volumeMute : ICONS.volume;
    });
    volSlider.addEventListener('input', (ev) => {
      video.volume = Number(ev.target.value) / 100;
      if (video.volume > 0 && video.muted) {
        video.muted = false;
        btnMute.innerHTML = ICONS.volume;
      }
    });
    btnFullscreen.addEventListener('click', () => enterFocusFullscreen([key]));
    pinInput.addEventListener('change', () => {
      if (pinInput.checked) state.pinned.add(key);
      else state.pinned.delete(key);
      updateFocusBar();
    });

    els.grid.appendChild(root);
    tile = { root, video, isSelf };
    state.tiles.set(key, tile);
  }
  tile.root.querySelector('.tile-identity strong').textContent = name;
  tile.root.querySelector('.tile-identity img').src = avatar || DEFAULT_AVATAR;
  if (tile.video.srcObject !== stream) tile.video.srcObject = stream;
}

function removeTile(key) {
  const tile = state.tiles.get(key);
  if (!tile) return;
  state.pinned.delete(key);
  if (state.focusIds && state.focusIds.includes(key)) exitFocusIfActive();
  tile.root.remove();
  state.tiles.delete(key);
  updateFocusBar();
}

/* ---------------- tela cheia (uma ou várias transmissões juntas) ---------------- */

function updateFocusBar() {
  const n = state.pinned.size;
  els.focusBar.classList.toggle('hidden', n < 1);
  els.focusCount.textContent = n === 1 ? '1 transmissão selecionada' : `${n} transmissões selecionadas`;
}

els.focusBtn.addEventListener('click', () => {
  if (state.pinned.size < 1) return;
  enterFocusFullscreen([...state.pinned]);
});

function enterFocusFullscreen(keys) {
  const valid = keys.filter((key) => state.tiles.has(key));
  if (!valid.length) return;

  const overlay = document.createElement('div');
  overlay.className = 'focus-overlay';
  for (const key of valid) {
    overlay.appendChild(state.tiles.get(key).root);
  }
  const exitBtn = document.createElement('button');
  exitBtn.className = 'focus-exit-btn primary';
  exitBtn.textContent = '✕ Sair da tela cheia';
  exitBtn.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else exitFocusIfActive();
  });
  overlay.appendChild(exitBtn);

  document.body.appendChild(overlay);
  state.focusOverlay = overlay;
  state.focusIds = valid;

  overlay.requestFullscreen().catch(() => {
    /* alguns navegadores exigem gesto do usuário; o botão de clique já garante isso */
  });
}

function exitFocusIfActive() {
  if (!state.focusOverlay) return;
  for (const key of state.focusIds) {
    const tile = state.tiles.get(key);
    if (tile) els.grid.appendChild(tile.root);
  }
  state.focusOverlay.remove();
  state.focusOverlay = null;
  state.focusIds = null;
  // Se a transmissão acabou (ex: você parou de compartilhar) enquanto ainda
  // estava em tela cheia, o elemento que estava em fullscreen acabou de ser
  // apagado do DOM sem o navegador ser avisado — sem isso aqui, ele fica
  // preso mostrando uma "tela cheia fantasma" (tela preta travada).
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  }
}

document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && state.focusOverlay) exitFocusIfActive();
});
