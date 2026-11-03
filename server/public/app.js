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
  crown: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M2.5 19h19l-1.4-9-4.8 4-3.3-6.5-3.3 6.5-4.8-4-1.4 9z"/></svg>`,
  pencil: `<svg ${ICON_ATTRS}><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/></svg>`,
  trash: `<svg ${ICON_ATTRS}><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
  soundboard: `<svg ${ICON_ATTRS}><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M7 15V9M12 17V7M17 13v-2"/></svg>`,
  file: `<svg ${ICON_ATTRS}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
  close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  stop: `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>`,
  message: `<svg ${ICON_ATTRS}><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>`,
};

const els = {
  authScreen: document.getElementById('authScreen'),
  authForm: document.getElementById('authForm'),
  authDisplayNameInput: document.getElementById('authDisplayNameInput'),
  authError: document.getElementById('authError'),
  authSubmitBtn: document.getElementById('authSubmitBtn'),
  lobby: document.getElementById('lobby'),
  welcomePanel: document.getElementById('welcomePanel'),
  userBarAvatar: document.getElementById('userBarAvatar'),
  userBarName: document.getElementById('userBarName'),
  userBarLogoutBtn: document.getElementById('userBarLogoutBtn'),
  userBarSettingsBtn: document.getElementById('userBarSettingsBtn'),
  memberSidebar: document.getElementById('memberSidebar'),
  memberList: document.getElementById('memberList'),
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
  serverRail: document.getElementById('serverRail'),
  addServerBtn: document.getElementById('addServerBtn'),
  activeServerName: document.getElementById('activeServerName'),
  copyInviteBtn: document.getElementById('copyInviteBtn'),
  roomGrid: document.getElementById('roomGrid'),
  serverModal: document.getElementById('serverModal'),
  serverModalClose: document.getElementById('serverModalClose'),
  serverTabCreate: document.getElementById('serverTabCreate'),
  serverTabJoin: document.getElementById('serverTabJoin'),
  serverCreatePanel: document.getElementById('serverCreatePanel'),
  serverJoinPanel: document.getElementById('serverJoinPanel'),
  serverNameInput: document.getElementById('serverNameInput'),
  serverCreateBtn: document.getElementById('serverCreateBtn'),
  serverJoinCodeInput: document.getElementById('serverJoinCodeInput'),
  serverJoinBtn: document.getElementById('serverJoinBtn'),
  serverModalError: document.getElementById('serverModalError'),
  textChannel: document.getElementById('textChannel'),
  textChannelName: document.getElementById('textChannelName'),
  textChannelMessages: document.getElementById('textChannelMessages'),
  textChannelForm: document.getElementById('textChannelForm'),
  textChannelTextInput: document.getElementById('textChannelTextInput'),
  roomInfo: document.getElementById('roomInfo'),
  peopleCount: document.getElementById('peopleCount'),
  chatNotificationsCheck: document.getElementById('chatNotificationsCheck'),
  dmModal: document.getElementById('dmModal'),
  dmModalClose: document.getElementById('dmModalClose'),
  dmPeerName: document.getElementById('dmPeerName'),
  dmMessages: document.getElementById('dmMessages'),
  dmPendingAttachments: document.getElementById('dmPendingAttachments'),
  dmForm: document.getElementById('dmForm'),
  dmAttachBtn: document.getElementById('dmAttachBtn'),
  dmFileInput: document.getElementById('dmFileInput'),
  dmTextInput: document.getElementById('dmTextInput'),
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
  settingsBtn: document.getElementById('settingsBtn'),
  settingsModal: document.getElementById('settingsModal'),
  settingsModalClose: document.getElementById('settingsModalClose'),
  settingsTabs: document.querySelectorAll('.settings-tab'),
  settingsTabPanels: document.querySelectorAll('.settings-tab-panel'),
  autoMicCheck: document.getElementById('autoMicCheck'),
  refreshPermMuteBtn: document.getElementById('refreshPermMuteBtn'),
  permMuteList: document.getElementById('permMuteList'),
  soundboardBtn: document.getElementById('soundboardBtn'),
  soundboardModal: document.getElementById('soundboardModal'),
  soundboardModalClose: document.getElementById('soundboardModalClose'),
  soundboardVolumeSlider: document.getElementById('soundboardVolumeSlider'),
  addSoundBtn: document.getElementById('addSoundBtn'),
  soundFileInput: document.getElementById('soundFileInput'),
  soundboardList: document.getElementById('soundboardList'),
  overlayPreview: document.getElementById('overlayPreview'),
  overlayEmptyHint: document.getElementById('overlayEmptyHint'),
  overlayAddBtn: document.getElementById('overlayAddBtn'),
  overlayRemoveBtn: document.getElementById('overlayRemoveBtn'),
  overlayFileInput: document.getElementById('overlayFileInput'),
  overlayEnabledCheck: document.getElementById('overlayEnabledCheck'),
  resolutionSelect: document.getElementById('resolutionSelect'),
  fpsSelect: document.getElementById('fpsSelect'),
  bandwidthSelect: document.getElementById('bandwidthSelect'),
  hideCursorCheck: document.getElementById('hideCursorCheck'),
  micDeviceSelect: document.getElementById('micDeviceSelect'),
  camDeviceSelect: document.getElementById('camDeviceSelect'),
  speakerDeviceSelect: document.getElementById('speakerDeviceSelect'),
  noiseSuppressionCheck: document.getElementById('noiseSuppressionCheck'),
  whatsNewModal: document.getElementById('whatsNewModal'),
  whatsNewClose: document.getElementById('whatsNewClose'),
  whatsNewVersion: document.getElementById('whatsNewVersion'),
  whatsNewList: document.getElementById('whatsNewList'),
  whatsNewOkBtn: document.getElementById('whatsNewOkBtn'),
  updateReadyModal: document.getElementById('updateReadyModal'),
  updateReadyVersion: document.getElementById('updateReadyVersion'),
  updateReadyLaterBtn: document.getElementById('updateReadyLaterBtn'),
  updateReadyRestartBtn: document.getElementById('updateReadyRestartBtn'),
};

/* ---------------- autenticação (Supabase) ----------------
   Gate de login: a tela de lobby só aparece depois de autenticado.
   onAuthStateChange dispara sozinho com a sessão restaurada ao carregar
   a página (evento INITIAL_SESSION), então cobre tanto o boot quanto
   login/logout feitos na hora. */

let currentUser = null; // auth.users (via sessão)
let currentProfile = null; // public.profiles

function showAuthScreen() {
  els.authScreen.classList.remove('hidden');
  els.lobby.classList.add('hidden');
  els.textChannel.classList.add('hidden');
  if (textChannelRealtime) {
    window.supabaseClient.removeChannel(textChannelRealtime);
    textChannelRealtime = null;
  }
  activeTextChannel = null;
  if (serverPresenceChannel) {
    window.supabaseClient.removeChannel(serverPresenceChannel);
    serverPresenceChannel = null;
  }
  serverMembersCache = [];
  myServers = [];
  activeServerId = null;
  activeChannels = [];
}

async function fetchMyProfile(userId) {
  const { data, error } = await window.supabaseClient
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  if (error) {
    console.error('Erro ao buscar perfil:', error);
    return null;
  }
  return data;
}

function showLobbyScreen() {
  els.authScreen.classList.add('hidden');
  els.lobby.classList.remove('hidden');
  showMainPanel('welcome');
  if (currentProfile) {
    els.nameInput.value = currentProfile.display_name || '';
    els.userBarName.textContent = currentProfile.display_name || 'Convidado';
    els.userBarAvatar.src = currentProfile.avatar_url || DEFAULT_AVATAR;
  }
  fetchMyServers();
}

els.authForm.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const displayName = els.authDisplayNameInput.value.trim();
  if (!displayName) return;
  els.authError.classList.add('hidden');
  els.authSubmitBtn.disabled = true;
  try {
    const { error } = await window.supabaseClient.auth.signInAnonymously({
      options: { data: { display_name: displayName } },
    });
    if (error) throw error;
    // onAuthStateChange cuida do resto (busca o perfil, mostra o lobby).
  } catch (err) {
    els.authError.textContent = err.message || 'Erro ao entrar.';
    els.authError.classList.remove('hidden');
  } finally {
    els.authSubmitBtn.disabled = false;
  }
});

els.userBarLogoutBtn.addEventListener('click', async () => {
  await window.supabaseClient.auth.signOut();
});
els.userBarSettingsBtn.addEventListener('click', () => openSettingsModal());

window.supabaseClient.auth.onAuthStateChange(async (_event, session) => {
  if (session && session.user) {
    currentUser = session.user;
    currentProfile = await fetchMyProfile(currentUser.id);
    showLobbyScreen();
  } else {
    currentUser = null;
    currentProfile = null;
    showAuthScreen();
  }
});

// STUN públicos (gratuitos) — resolvem o caso em que os dois lados
// conseguem ser alcançados direto (a maioria das redes domésticas). Sem um
// servidor TURN ainda (pendente: VM Oracle Cloud + coturn, self-hosted),
// NATs mais restritos (ex: CGNAT, bloqueio de dupla-NAT, redes corporativas)
// não conseguem conectar — isso entra como complemento aqui depois.
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
  const defaults = {
    resolution: '1920x1080',
    fps: 30,
    noiseSuppression: true,
    bandwidthKbps: null,
    hideCursor: true,
    micDeviceId: '',
    camDeviceId: '',
    speakerDeviceId: '',
    autoMic: true,
    permanentlyMutedApps: [],
    micMuted: false,
    soundboardVolume: 70,
    cameraOverlayEnabled: false,
    chatNotifications: true,
  };
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
  hostingRoomLabel: null, // preenchido quando EU virei anfitrião automático de uma Sala N (pra saber se devo host:stop ao sair)
  settings: loadSettings(),
  watchPcs: new Map(), // `${transmissorId}:${source}` -> RTCPeerConnection (eu assistindo)
  broadcastPcs: new Map(), // `${espectadorId}:${source}` -> RTCPeerConnection (eu transmitindo pra ele)
  tiles: new Map(), // mesma chave -> { root, video, isSelf }
  pinned: new Set(), // chaves marcadas pra entrar juntas na tela cheia
  focusOverlay: null,
  focusIds: null,
  screen: { sharing: false, displayStream: null, localTracks: [], blackFrameStop: null },
  camera: { sharing: false, camStream: null, localTracks: [] },
  mic: { sharing: false, micStream: null, localTracks: [] },
  dmPeer: null, // {id, deviceId, name, host, port, room} — com quem a conversa de mensagem direta aberta agora é
};

/* ---------------- configurações de transmissão (resolução/fps/ruído) ---------------- */

els.resolutionSelect.value = state.settings.resolution;
els.fpsSelect.value = String(state.settings.fps);
els.noiseSuppressionCheck.checked = state.settings.noiseSuppression;
els.bandwidthSelect.value = state.settings.bandwidthKbps ? String(state.settings.bandwidthKbps) : 'auto';
els.hideCursorCheck.checked = state.settings.hideCursor;
els.autoMicCheck.checked = state.settings.autoMic;
els.chatNotificationsCheck.checked = state.settings.chatNotifications;

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
els.hideCursorCheck.addEventListener('change', () => {
  state.settings.hideCursor = els.hideCursorCheck.checked;
  saveSettings();
  // só vale pra próxima vez que compartilhar — o getDisplayMedia já em
  // andamento não aceita trocar esse parâmetro no meio da transmissão.
});
els.autoMicCheck.addEventListener('change', () => {
  state.settings.autoMic = els.autoMicCheck.checked;
  saveSettings();
  // só vale pra próxima sala que entrar — não liga/desliga o mic no meio da atual sozinho
});
els.refreshPermMuteBtn.addEventListener('click', renderPermMuteList);
els.chatNotificationsCheck.addEventListener('change', () => {
  state.settings.chatNotifications = els.chatNotificationsCheck.checked;
  saveSettings();
});

/* ---------------- escolha de dispositivos (microfone / câmera / saída de áudio) ----------------
   Os rótulos de dispositivo (device.label) só vêm preenchidos depois que o
   navegador já teve permissão de mic/câmera concedida alguma vez — antes
   disso vêm como string vazia, daí o fallback "Microfone 1"/"Câmera 2" etc.
   Reconstrói as 3 listas toda vez que o painel de configurações abre, e
   também quando o SO avisa que algo mudou (plugou/desplugou fone, etc). */

function fillDeviceSelect(select, devices, kind, savedId) {
  const current = select.value || savedId || '';
  select.innerHTML = '<option value="">Padrão do sistema</option>';
  devices.forEach((d, i) => {
    const opt = document.createElement('option');
    opt.value = d.deviceId;
    opt.textContent = d.label || `${kind} ${i + 1}`;
    select.appendChild(opt);
  });
  // só mantém selecionado se o dispositivo salvo ainda existir na lista atual
  if (current && devices.some((d) => d.deviceId === current)) select.value = current;
  else select.value = '';
}

async function populateDeviceSelects() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    fillDeviceSelect(els.micDeviceSelect, devices.filter((d) => d.kind === 'audioinput'), 'Microfone', state.settings.micDeviceId);
    fillDeviceSelect(els.camDeviceSelect, devices.filter((d) => d.kind === 'videoinput'), 'Câmera', state.settings.camDeviceId);
    fillDeviceSelect(els.speakerDeviceSelect, devices.filter((d) => d.kind === 'audiooutput'), 'Saída de áudio', state.settings.speakerDeviceId);
  } catch {
    /* enumerateDevices não suportado ou sem permissão nenhuma ainda — fica só com "Padrão do sistema" */
  }
}

if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
  navigator.mediaDevices.addEventListener('devicechange', populateDeviceSelects);
}

els.micDeviceSelect.addEventListener('change', () => {
  state.settings.micDeviceId = els.micDeviceSelect.value;
  saveSettings();
  // só vale pra próxima vez que ligar o mic — trocar ao vivo exigiria
  // reabrir a captura de áudio no meio de uma transmissão em andamento.
});

els.camDeviceSelect.addEventListener('change', async () => {
  state.settings.camDeviceId = els.camDeviceSelect.value;
  saveSettings();
  // câmera é a mais provável de precisar de troca na hora (testar qual
  // dispositivo resolve um problema tipo "câmera toda amarela") — reinicia
  // sozinho se já estiver ligada, em vez de exigir desligar/ligar na mão.
  if (state.camera.sharing) {
    stopCameraShare();
    await startCameraShare();
  }
});

function applySpeakerDevice(video) {
  if (typeof video.setSinkId !== 'function') return;
  video.setSinkId(state.settings.speakerDeviceId || '').catch(() => {
    /* dispositivo pode ter sumido (desplugado) desde a última vez — ignora, volta pro padrão */
  });
}

els.speakerDeviceSelect.addEventListener('change', () => {
  state.settings.speakerDeviceId = els.speakerDeviceSelect.value;
  saveSettings();
  // esse aplica na hora, pra todo mundo que já está na grade — não precisa de restart
  for (const tile of state.tiles.values()) {
    if (!tile.isSelf) applySpeakerDevice(tile.video);
  }
});
els.bandwidthSelect.addEventListener('change', () => {
  const v = els.bandwidthSelect.value;
  state.settings.bandwidthKbps = v === 'auto' ? null : Number(v);
  saveSettings();
  // reaplica já nas transmissões em andamento, sem precisar recompartilhar
  for (const pc of state.broadcastPcs.values()) applyBandwidthLimit(pc);
});

function openSettingsModal() {
  els.settingsModal.classList.remove('hidden');
  populateDeviceSelects();
  renderPermMuteList();
}
function closeSettingsModal() {
  els.settingsModal.classList.add('hidden');
}
els.settingsBtn.addEventListener('click', openSettingsModal);
els.settingsModalClose.addEventListener('click', closeSettingsModal);
els.settingsModal.addEventListener('click', (ev) => {
  if (ev.target === els.settingsModal) closeSettingsModal();
});
els.settingsTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    const name = tab.dataset.tab;
    els.settingsTabs.forEach((t) => t.classList.toggle('active', t === tab));
    els.settingsTabPanels.forEach((p) => p.classList.toggle('active', p.dataset.panel === name));
  });
});

function screenVideoConstraints() {
  const video = { frameRate: { ideal: state.settings.fps, max: state.settings.fps } };
  if (state.settings.resolution !== 'native') {
    const [w, h] = state.settings.resolution.split('x').map(Number);
    video.width = { ideal: w };
    video.height = { ideal: h };
  }
  // "cursor" é um campo não-padrão aceito pelo getDisplayMedia do Chromium
  // (fora do mandatory antigo, então é seguro passar mesmo onde não tem
  // suporte — ele é ignorado, não dá erro). "never" desliga de vez a
  // composição do cursor pelo capturador, que é o jeito de resolver o
  // cursor "fantasma" fixo em jogos que escondem o cursor de verdade (ex:
  // mira fixa de FPS) — o Windows manda a posição/forma do cursor separado
  // do quadro de vídeo, e o capturador às vezes desenha ele por cima mesmo
  // quando o jogo pediu pra esconder. "never" evita essa composição de vez.
  video.cursor = state.settings.hideCursor ? 'never' : 'always';
  return video;
}

function micConstraints() {
  const audio = {
    noiseSuppression: state.settings.noiseSuppression,
    echoCancellation: true,
    autoGainControl: true,
  };
  if (state.settings.micDeviceId) audio.deviceId = { exact: state.settings.micDeviceId };
  return { audio };
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

// Limita o bitrate máximo de upload por transmissão (cada espectador tem
// sua própria RTCPeerConnection, então isso é por-espectador, não total).
// Sem isso, o WebRTC tenta empurrar o máximo que o codec permite — em VPN
// tunelada (Radmin) ou internet com upload fraco/instável, isso é a causa
// mais comum de travamento/engasgo do lado de quem assiste, bem mais do que
// a resolução/fps em si. "Automático" (padrão) mantém o comportamento de
// sempre, sem limite artificial.
function applyBandwidthLimit(pc) {
  const kbps = state.settings.bandwidthKbps;
  for (const sender of pc.getSenders()) {
    if (!sender.track || sender.track.kind !== 'video') continue;
    const params = sender.getParameters();
    if (!params.encodings || !params.encodings.length) params.encodings = [{}];
    for (const enc of params.encodings) {
      if (kbps) enc.maxBitrate = kbps * 1000;
      else delete enc.maxBitrate;
    }
    sender.setParameters(params).catch(() => {
      /* alguns navegadores recusam mudar parâmetros antes da negociação terminar; a próxima chamada tenta de novo */
    });
  }
}

const PRESENCE_FIELD = { screen: 'sharingScreen', camera: 'sharingCamera', mic: 'sharingMic' };

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
    group = { muted: state.settings.permanentlyMutedApps.includes(name), pids: new Map() };
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

function setAppMuted(name, muted) {
  const group = appAudio.groups.get(name);
  if (!group) return;
  group.muted = muted;
  for (const [pid, entry] of group.pids) {
    if (muted) {
      if (entry.handle != null) {
        window.telaNative.stopCapture(entry.handle);
        entry.handle = null;
      }
    } else if (entry.handle == null) {
      window.telaNative.startCapture(pid).then((handle) => { entry.handle = handle; });
    }
  }
}

function toggleAppMute(name, btn) {
  const group = appAudio.groups.get(name);
  if (!group) return;
  setAppMuted(name, !group.muted);
  btn.innerHTML = group.muted ? ICONS.volumeMute : ICONS.volume;
}

// Lista de "sempre mutar" — vive na aba "Apps mutados" das configurações,
// separada do painel de mute da sessão na barra lateral (que só existe
// enquanto a tela está sendo compartilhada). Essa funciona a qualquer
// momento (não precisa estar compartilhando) e persiste entre sessões —
// resolve o pedido de "mutei o Discord uma vez, quero que já comece mutado
// da próxima vez".
async function renderPermMuteList() {
  if (!isElectron) {
    els.permMuteList.innerHTML = '<p class="hint">Esse recurso só existe na versão instalada do app.</p>';
    return;
  }
  const available = await window.telaNative.available();
  if (!available) {
    els.permMuteList.innerHTML = '<p class="hint">Módulo nativo de áudio por app ainda não compilado neste PC.</p>';
    return;
  }
  const apps = await window.telaNative.listApps();
  if (!apps.length) {
    els.permMuteList.innerHTML = '<p class="hint">Nenhum app com áudio ativo agora. Toca algo num app e clica em "Atualizar lista".</p>';
    return;
  }
  const names = [...new Set(apps.map((a) => a.name))];
  els.permMuteList.innerHTML = '';
  for (const name of names) {
    const row = document.createElement('label');
    row.className = 'app-audio-row app-audio-row-check';
    const checked = state.settings.permanentlyMutedApps.includes(name);
    row.innerHTML = `<input type="checkbox" ${checked ? 'checked' : ''} /><span>${escapeHtml(name)}</span>`;
    row.querySelector('input').addEventListener('change', (ev) => {
      const list = state.settings.permanentlyMutedApps;
      const idx = list.indexOf(name);
      if (ev.target.checked && idx === -1) list.push(name);
      else if (!ev.target.checked && idx !== -1) list.splice(idx, 1);
      saveSettings();
      if (appAudio.groups.has(name)) setAppMuted(name, ev.target.checked);
    });
    els.permMuteList.appendChild(row);
  }
}

function teardownAppAudio() {
  for (const group of appAudio.groups.values()) {
    for (const entry of group.pids.values()) {
      if (entry.handle != null) window.telaNative.stopCapture(entry.handle);
      entry.gainNode.disconnect();
    }
  }
  appAudio.groups.clear();
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
    ctlWs.send(JSON.stringify({ type: 'presence:name', name: (els.nameInput.value || 'Convidado').trim() || 'Convidado' }));
    if (myAvatar) ctlWs.send(JSON.stringify({ type: 'presence:avatar', avatar: myAvatar }));
  });
  ctlWs.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'dm:history') {
      if (state.dmPeer && state.dmPeer.deviceId === msg.deviceId) {
        els.dmMessages.innerHTML = '';
        for (const entry of msg.messages || []) renderDmEntry(entry, { skipNotify: true });
      }
    } else if (msg.type === 'dm:sent') {
      if (state.dmPeer && state.dmPeer.deviceId === msg.deviceId) {
        renderDmEntry(msg.entry, { skipNotify: true });
      }
    } else if (msg.type === 'dm:incoming') {
      const dmOpenForThisPeer = state.dmPeer && state.dmPeer.deviceId === msg.deviceId && !els.dmModal.classList.contains('hidden');
      if (dmOpenForThisPeer) {
        renderDmEntry(msg.entry, {});
      } else {
        if (state.settings.chatNotifications) notifyChatMessage(msg.entry);
        showToast(`Mensagem de ${msg.entry.name || 'alguém'}`, 4000);
      }
    }
  });
}
connectCtl();

els.nameInput.addEventListener('change', () => {
  const name = (els.nameInput.value || 'Convidado').trim() || 'Convidado';
  localStorage.setItem(NAME_KEY, name);
  if (ctlWs && ctlWs.readyState === ctlWs.OPEN) {
    ctlWs.send(JSON.stringify({ type: 'presence:name', name }));
  }
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------------- lobby: servidores e canais (Supabase) ----------------
   Trilho de servidores à esquerda + lista de canais (texto/voz) do servidor
   selecionado, igual Discord. Abrir um canal de verdade (texto na Fase 3,
   voz na Fase 4) ainda não existe — por enquanto só mostra um aviso. */

let myServers = [];
let activeServerId = null;
let activeChannels = [];

async function fetchMyServers() {
  const { data, error } = await window.supabaseClient
    .from('servers')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) {
    console.error('Erro ao buscar servidores:', error);
    return;
  }
  myServers = data || [];
  renderServerRail();
  if (myServers.length && !myServers.some((s) => s.id === activeServerId)) {
    selectServer(myServers[0].id);
  } else if (!myServers.length) {
    activeServerId = null;
    activeChannels = [];
    els.activeServerName.textContent = 'Seus servidores';
    els.copyInviteBtn.classList.add('hidden');
    els.roomGrid.innerHTML = '<p class="hint">Crie ou entre num servidor pra ver os canais aqui.</p>';
  }
}

function renderServerRail() {
  els.serverRail.innerHTML = '';
  for (const server of myServers) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'server-rail-btn' + (server.id === activeServerId ? ' active' : '');
    btn.title = server.name;
    btn.innerHTML = server.icon_url
      ? `<img src="${escapeHtml(server.icon_url)}" alt="" />`
      : escapeHtml((server.name || '?').trim().slice(0, 2).toUpperCase());
    btn.addEventListener('click', () => selectServer(server.id));
    els.serverRail.appendChild(btn);
  }
}

async function selectServer(serverId) {
  activeServerId = serverId;
  renderServerRail();
  const server = myServers.find((s) => s.id === serverId);
  els.activeServerName.textContent = server ? server.name : '';
  els.copyInviteBtn.classList.toggle('hidden', !server);
  await fetchChannels(serverId);
  joinServerPresence(serverId);
}

/* ---------------- lista de membros do servidor (barra lateral direita) ----------------
   Realtime Presence por servidor (`server:<id>`) - cada cliente so' avisa
   "estou olhando esse servidor agora", sem precisar estar numa chamada de
   voz. Mostra quem ta online (nessa sessao) separado de quem ta offline,
   igual Discord. Serve tambem de base pra sinalizacao de transferencia de
   arquivo P2P mais pra frente. */

let serverPresenceChannel = null;
let serverMembersCache = [];

function joinServerPresence(serverId) {
  if (serverPresenceChannel) {
    window.supabaseClient.removeChannel(serverPresenceChannel);
    serverPresenceChannel = null;
  }
  const myId = currentUser.id;
  const rt = window.supabaseClient.channel(`server:${serverId}`, {
    config: { presence: { key: myId } },
  });
  rt.on('presence', { event: 'sync' }, () => renderMemberSidebar());
  rt.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      rt.track({
        name: currentProfile ? currentProfile.display_name : 'Convidado',
        avatar: currentProfile ? currentProfile.avatar_url : null,
      });
    }
  });
  serverPresenceChannel = rt;
  fetchServerMembers(serverId);
}

async function fetchServerMembers(serverId) {
  const { data, error } = await window.supabaseClient
    .from('server_members')
    .select('user_id, profiles(display_name, avatar_url)')
    .eq('server_id', serverId);
  serverMembersCache = error ? [] : (data || []);
  renderMemberSidebar();
}

function renderMemberSidebar() {
  if (!activeServerId) {
    els.memberSidebar.classList.add('hidden');
    return;
  }
  els.memberSidebar.classList.remove('hidden');
  const onlineIds = serverPresenceChannel
    ? new Set(Object.keys(serverPresenceChannel.presenceState()))
    : new Set();

  const online = [];
  const offline = [];
  for (const m of serverMembersCache) {
    const profile = m.profiles || {};
    const entry = { id: m.user_id, name: profile.display_name || 'Convidado', avatar: profile.avatar_url };
    (onlineIds.has(m.user_id) ? online : offline).push(entry);
  }

  els.memberList.innerHTML = '';
  const addGroup = (title, members) => {
    if (!members.length) return;
    const groupTitle = document.createElement('div');
    groupTitle.className = 'channel-group-title';
    groupTitle.textContent = `${title} — ${members.length}`;
    els.memberList.appendChild(groupTitle);
    for (const member of members) {
      const row = document.createElement('div');
      row.className = 'people-list-row' + (title === 'Online' ? ' sharing' : '');
      row.innerHTML = `
        <div class="avatar-status-wrap">
          <img src="${member.avatar || DEFAULT_AVATAR}" alt="" />
          ${title === 'Online' ? '<span class="status-dot"></span>' : ''}
        </div>
        <div class="person-info"><div class="name-row"><span class="name">${escapeHtml(member.name)}</span></div></div>
      `;
      if (title !== 'Online') row.style.opacity = '0.5';
      els.memberList.appendChild(row);
    }
  };
  addGroup('Online', online);
  addGroup('Offline', offline);
}

async function fetchChannels(serverId) {
  const { data, error } = await window.supabaseClient
    .from('channels')
    .select('*')
    .eq('server_id', serverId)
    .order('position', { ascending: true });
  activeChannels = error ? [] : (data || []);
  if (error) console.error('Erro ao buscar canais:', error);
  renderChannelList();
}

function renderChannelList() {
  els.roomGrid.innerHTML = '';
  if (!activeChannels.length) {
    els.roomGrid.innerHTML = '<p class="hint">Esse servidor ainda não tem canais.</p>';
    return;
  }
  const groups = [
    { title: 'Texto', icon: ICONS.message, channels: activeChannels.filter((c) => c.type === 'text') },
    { title: 'Voz', icon: ICONS.volume, channels: activeChannels.filter((c) => c.type === 'voice') },
  ];
  for (const group of groups) {
    if (!group.channels.length) continue;
    const title = document.createElement('div');
    title.className = 'channel-group-title';
    title.textContent = group.title;
    els.roomGrid.appendChild(title);
    for (const channel of group.channels) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'channel-row';
      row.innerHTML = `${group.icon}<span>${escapeHtml(channel.name)}</span>`;
      row.addEventListener('click', () => openChannel(channel));
      els.roomGrid.appendChild(row);
    }
  }
}

// A barra de servidores/canais fica sempre visível (igual Discord) - só o
// conteúdo principal troca entre o painel de boas-vindas, o canal de texto
// e a sala de voz. Entrar num canal de texto NÃO sai de uma chamada de voz
// em andamento (ela continua rodando em segundo plano, só escondida).
function showMainPanel(panel) {
  els.welcomePanel.classList.toggle('hidden', panel !== 'welcome');
  els.textChannel.classList.toggle('hidden', panel !== 'text');
  els.room.classList.toggle('hidden', panel !== 'voice');
}

function openChannel(channel) {
  if (channel.type === 'text') openTextChannel(channel);
  else joinVoiceChannel(channel);
}

/* ---------------- canal de texto: mensagens persistidas (Supabase) ----------------
   Historico vem de uma tabela de verdade (nao mais memoria/disco local do
   host) e atualiza em tempo real via postgres_changes - todo mundo que
   tiver o canal aberto ve a mensagem nova sem precisar recarregar. */

let activeTextChannel = null;
let textChannelRealtime = null;
const profileCache = new Map(); // userId -> {display_name, avatar_url}

async function getProfileCached(userId) {
  if (profileCache.has(userId)) return profileCache.get(userId);
  const { data } = await window.supabaseClient
    .from('profiles')
    .select('display_name, avatar_url')
    .eq('id', userId)
    .single();
  const profile = data || { display_name: 'Convidado', avatar_url: null };
  profileCache.set(userId, profile);
  return profile;
}

function renderTextChannelMessage(row, authorProfile) {
  const isSelf = row.author_id === currentUser.id;
  const name = authorProfile ? authorProfile.display_name : 'Convidado';
  const avatar = authorProfile && authorProfile.avatar_url ? authorProfile.avatar_url : DEFAULT_AVATAR;
  const time = new Date(row.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  const wrap = document.createElement('div');
  wrap.className = 'chat-msg' + (isSelf ? ' self' : '');
  wrap.innerHTML = `
    <img class="chat-msg-avatar" src="${avatar}" alt="" />
    <div class="chat-msg-body">
      <div class="chat-msg-meta">
        <span class="chat-msg-name">${escapeHtml(name)}</span>
        <span class="chat-msg-time">${time}</span>
      </div>
      ${row.content ? `<div class="chat-msg-text">${escapeHtml(row.content)}</div>` : ''}
    </div>
  `;
  els.textChannelMessages.appendChild(wrap);
  els.textChannelMessages.scrollTop = els.textChannelMessages.scrollHeight;

  if (!isSelf && state.settings.chatNotifications) {
    notifyChatMessage({ name, avatar, text: row.content });
  }
}

async function openTextChannel(channel) {
  activeTextChannel = channel;
  els.textChannelName.textContent = channel.name;
  els.textChannelMessages.innerHTML = '';
  showMainPanel('text');

  const { data, error } = await window.supabaseClient
    .from('messages')
    .select('*')
    .eq('channel_id', channel.id)
    .order('created_at', { ascending: true })
    .limit(200);
  if (error) {
    console.error('Erro ao buscar mensagens:', error);
  } else {
    for (const row of data) {
      const profile = await getProfileCached(row.author_id);
      renderTextChannelMessage(row, profile);
    }
  }

  if (textChannelRealtime) window.supabaseClient.removeChannel(textChannelRealtime);
  textChannelRealtime = window.supabaseClient
    .channel(`messages:${channel.id}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `channel_id=eq.${channel.id}` },
      async (payload) => {
        const profile = await getProfileCached(payload.new.author_id);
        renderTextChannelMessage(payload.new, profile);
      },
    )
    .subscribe();
}

function closeTextChannel() {
  if (textChannelRealtime) {
    window.supabaseClient.removeChannel(textChannelRealtime);
    textChannelRealtime = null;
  }
  activeTextChannel = null;
}

els.textChannelForm.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const content = els.textChannelTextInput.value.trim();
  if (!content || !activeTextChannel) return;
  els.textChannelTextInput.value = '';
  const { error } = await window.supabaseClient
    .from('messages')
    .insert({ channel_id: activeTextChannel.id, author_id: currentUser.id, content });
  if (error) {
    console.error('Erro ao enviar mensagem:', error);
    showToast('Não deu pra enviar a mensagem.', 2500);
  }
  // a propria mensagem some renderizada pela assinatura postgres_changes,
  // igual pra todo mundo - nao precisa desenhar localmente aqui.
});

/* ---------------- modal: criar servidor / entrar com código de convite ---------------- */

function setServerModalTab(tab) {
  els.serverTabCreate.classList.toggle('active', tab === 'create');
  els.serverTabJoin.classList.toggle('active', tab === 'join');
  els.serverCreatePanel.classList.toggle('hidden', tab !== 'create');
  els.serverJoinPanel.classList.toggle('hidden', tab !== 'join');
  els.serverModalError.classList.add('hidden');
}
els.serverTabCreate.addEventListener('click', () => setServerModalTab('create'));
els.serverTabJoin.addEventListener('click', () => setServerModalTab('join'));

function openServerModal() {
  setServerModalTab('create');
  els.serverNameInput.value = '';
  els.serverJoinCodeInput.value = '';
  els.serverModal.classList.remove('hidden');
}
function closeServerModal() {
  els.serverModal.classList.add('hidden');
}
els.addServerBtn.addEventListener('click', openServerModal);
els.serverModalClose.addEventListener('click', closeServerModal);

function showServerModalError(text) {
  els.serverModalError.textContent = text;
  els.serverModalError.classList.remove('hidden');
}

els.serverCreateBtn.addEventListener('click', async () => {
  const name = els.serverNameInput.value.trim();
  if (!name) { showServerModalError('Dá um nome pro servidor.'); return; }
  els.serverCreateBtn.disabled = true;
  try {
    const { data, error } = await window.supabaseClient
      .from('servers')
      .insert({ name, owner_id: currentUser.id })
      .select()
      .single();
    if (error) throw error;
    closeServerModal();
    await fetchMyServers();
    selectServer(data.id);
  } catch (err) {
    showServerModalError(err.message || 'Não deu pra criar o servidor.');
  } finally {
    els.serverCreateBtn.disabled = false;
  }
});

els.serverJoinBtn.addEventListener('click', async () => {
  const code = els.serverJoinCodeInput.value.trim().toLowerCase();
  if (!code) { showServerModalError('Digita o código de convite.'); return; }
  els.serverJoinBtn.disabled = true;
  try {
    const { data: serverId, error } = await window.supabaseClient.rpc('join_server_by_code', { code });
    if (error) throw error;
    closeServerModal();
    await fetchMyServers();
    selectServer(serverId);
  } catch (err) {
    showServerModalError(err.message || 'Código inválido.');
  } finally {
    els.serverJoinBtn.disabled = false;
  }
});

els.copyInviteBtn.addEventListener('click', async () => {
  const server = myServers.find((s) => s.id === activeServerId);
  if (!server) return;
  try {
    await navigator.clipboard.writeText(server.invite_code);
    showToast('Código de convite copiado!', 2000);
  } catch {
    showToast(`Código: ${server.invite_code}`, 4000);
  }
});

/* ---------------- transporte: canal de voz via Supabase Realtime ----------------
   Cada canal de voz vira um Realtime Channel proprio (`voice:<channelId>`):
   Presence cobre "quem esta no canal agora" (substitui a presenca por
   WebSocket/PeerJS de antes) e Broadcast carrega a sinalizacao WebRTC
   (offer/answer/ICE) entre os participantes. O resto do app (onPresence/
   onSignal/createBroadcastPeer/etc.) nao muda nada - so fala com
   state.transport.send(objeto), igual sempre falou com os transportes
   antigos (LAN/PeerJS, ambos removidos daqui pra ficar so' esse). */

function joinVoiceChannel(channel) {
  const myId = currentUser.id;
  const presenceMeta = {
    name: currentProfile ? currentProfile.display_name : 'Convidado',
    avatar: currentProfile ? currentProfile.avatar_url : null,
    sharingScreen: false,
    sharingCamera: false,
    sharingMic: false,
  };

  const rt = window.supabaseClient.channel(`voice:${channel.id}`, {
    config: { presence: { key: myId }, broadcast: { self: false } },
  });

  rt.on('presence', { event: 'sync' }, () => {
    const presenceState = rt.presenceState();
    const clients = Object.entries(presenceState).map(([id, metas]) => ({ id, ...metas[0] }));
    onPresence(clients);
  });

  rt.on('broadcast', { event: 'signal' }, ({ payload }) => {
    if (payload.to !== myId) return; // broadcast chega pra todo mundo no canal, cada um filtra o que e' seu
    onSignal(payload.from, payload.data);
  });

  state.transport = {
    send(obj) {
      if (obj.type === 'signal') {
        rt.send({ type: 'broadcast', event: 'signal', payload: { from: myId, to: obj.to, data: obj.data } });
      } else if (obj.type === 'share:start' || obj.type === 'share:stop') {
        const field = PRESENCE_FIELD[obj.source];
        if (field) presenceMeta[field] = obj.type === 'share:start';
        rt.track(presenceMeta);
      }
    },
    close() { window.supabaseClient.removeChannel(rt); },
  };

  rt.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      state.myId = myId;
      rt.track(presenceMeta);
      enterRoomScreen(channel.name);
    }
  });
}

function enterRoomScreen(label) {
  showMainPanel('voice');
  els.roomInfo.textContent = label;
  if (state.settings.autoMic) startMicShare();
}

els.leaveBtn.addEventListener('click', leaveRoom);
els.leaveCallBtn.addEventListener('click', leaveRoom);

let toastTimer = null;
function showToast(message, duration = 2500) {
  els.toast.innerHTML = `${ICONS.check}<span>${message}</span>`;
  els.toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.add('hidden'), duration);
}

els.appAudioToggle.addEventListener('click', () => {
  els.appAudioBody.classList.toggle('collapsed');
  els.appAudioToggle.classList.toggle('open', !els.appAudioBody.classList.contains('collapsed'));
});

els.inviteBtn.addEventListener('click', async () => {
  const server = myServers.find((s) => s.id === activeServerId);
  if (!server) return;
  try {
    await navigator.clipboard.writeText(server.invite_code);
    showToast(`Código de convite copiado: ${server.invite_code}`);
  } catch {
    showToast(`Código de convite: ${server.invite_code}`);
  }
});

function leaveRoom() {
  stopScreenShare();
  stopCameraShare();
  stopMicShare();
  for (const key of [...state.watchPcs.keys()]) {
    const sep = key.lastIndexOf(':');
    teardownWatch(key.slice(0, sep), key.slice(sep + 1));
  }
  exitFocusIfActive();
  // fecha o transporte só DEPOIS de mandar os "parei de compartilhar" acima
  // (stopScreenShare/stopCameraShare/stopMicShare) — fechar antes fazia o
  // `.send()` deles cair num canal já fechado, gerando erro no console.
  if (state.transport) state.transport.close();
  state.transport = null;
  state.myId = null;
  showMainPanel('welcome');
}

/* ---------------- presença: quem está na sala e quem compartilha ---------------- */

function onPresence(list) {
  els.peopleCount.textContent = `· ${list.length} na sala`;

  const currentIds = new Set(list.map((c) => c.id));
  const infoById = new Map(list.map((c) => [c.id, c]));

  for (const source of ['screen', 'camera', 'mic']) {
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


function updateEmptyHint() {
  let visibleTiles = 0;
  for (const tile of state.tiles.values()) if (!tile.audioOnly) visibleTiles++;
  els.emptyHint.classList.toggle('hidden', visibleTiles > 0);
}

/* ---------------- chat da sala ----------------
   Passa pelo MESMO canal de presença/sinalização que já existe (WebSocket
   do relay no modo LAN, PeerJS no modo Internet) — por isso, no modo LAN
   (Radmin), o chat já nasce privado só pra quem está naquela rede, de
   graça: o relay nem é alcançável por quem não está nela, então não tem
   "vazamento" possível sem precisar de nenhum código extra de permissão.
   O servidor é quem retransmite pra todo mundo (igual já faz com a
   presença) — o remetente só vê a própria mensagem quando ela volta pelo
   mesmo caminho, não é desenhada localmente antes, pra evitar qualquer
   duplicação ou mensagem "fantasma" se o envio falhar no meio do caminho. */

// No modo LAN o anexo vai por upload HTTP de verdade (streamed pro disco do
// anfitrião, servidor que já existe) — por isso aguenta até 500MB. No modo
// Internet não tem servidor compartilhado nenhum alcançável entre as
// pessoas (cada um só tem o próprio `localhost`), então o anexo continua
// embutido em base64 dentro da própria mensagem — por isso fica no limite
// antigo de 25MB, bem mais conservador.
const CHAT_MAX_ATTACHMENTS = 4;
const CHAT_FILE_MAX_BYTES_LAN = 500 * 1024 * 1024;
const CHAT_FILE_MAX_BYTES_INTERNET = 25 * 1024 * 1024;
const CHAT_TOTAL_MAX_BYTES_LAN = 1200 * 1024 * 1024;
const CHAT_TOTAL_MAX_BYTES_INTERNET = 50 * 1024 * 1024;
function currentChatFileMaxBytes() {
  return state.roomMode === 'lan' ? CHAT_FILE_MAX_BYTES_LAN : CHAT_FILE_MAX_BYTES_INTERNET;
}
function currentChatTotalMaxBytes() {
  return state.roomMode === 'lan' ? CHAT_TOTAL_MAX_BYTES_LAN : CHAT_TOTAL_MAX_BYTES_INTERNET;
}
let pendingChatFiles = [];

// Mesma validação que o relay LAN (`server/main.cjs`) faz — duplicada aqui
// porque o modo Internet retransmite pelo PRÓPRIO navegador de quem
// hospedou a sala (`hostInternetRoom`), não pelo servidor Node.
const CHAT_ATTACHMENT_DATAURL_MAX = 34 * 1024 * 1024;
function sanitizeChatAttachment(a) {
  const dataUrl = a && typeof a.dataUrl === 'string' && a.dataUrl.startsWith('data:') ? a.dataUrl.slice(0, CHAT_ATTACHMENT_DATAURL_MAX) : '';
  return {
    name: String((a && a.name) || 'arquivo').slice(0, 120),
    type: String((a && a.type) || '').slice(0, 100),
    size: Number(a && a.size) || 0,
    dataUrl,
  };
}

function formatFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// Upload de verdade (streamed, não base64) pro servidor de quem vai ficar
// com o arquivo — pro chat da sala, é `roomAddr` (servidor de quem
// hospedou); pra mensagem direta, é o MEU próprio servidor (`lanInfo`), já
// que não tem "sala" nenhuma, cada lado guarda a própria cópia da
// conversa. É sempre uma origem DIFERENTE da página atual (cada um carrega
// a própria página via localhost) — o servidor já libera CORS pra essas
// rotas especificamente por causa disso (ver `/chat/` em main.cjs).
function uploadFileTo(baseAddr, file, onProgress) {
  return new Promise((resolve, reject) => {
    const url = `http://${baseAddr}/chat/upload?name=${encodeURIComponent(file.name)}&type=${encodeURIComponent(file.type || 'application/octet-stream')}`;
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.upload.addEventListener('progress', (ev) => {
      if (ev.lengthComputable && onProgress) onProgress(ev.loaded / ev.total);
    });
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch (err) {
          reject(err);
        }
      } else {
        reject(new Error(`upload falhou (status ${xhr.status})`));
      }
    });
    xhr.addEventListener('error', () => reject(new Error('erro de rede no upload')));
    xhr.send(file);
  });
}

function chatFileUrl(fileId) {
  return `http://${state.roomAddr}/chat/files/${fileId}`;
}

function renderPendingAttachments() {
  if (!pendingChatFiles.length) {
    els.chatPendingAttachments.classList.add('hidden');
    els.chatPendingAttachments.innerHTML = '';
    return;
  }
  els.chatPendingAttachments.classList.remove('hidden');
  els.chatPendingAttachments.innerHTML = '';
  pendingChatFiles.forEach((file, idx) => {
    const chip = document.createElement('div');
    chip.className = 'chat-pending-chip';
    chip.innerHTML = `<span>${escapeHtml(file.name)} <span class="chat-pending-size">(${formatFileSize(file.size)})</span></span><button type="button" class="chat-pending-remove">${ICONS.close}</button>`;
    chip.querySelector('button').addEventListener('click', () => {
      pendingChatFiles.splice(idx, 1);
      renderPendingAttachments();
    });
    els.chatPendingAttachments.appendChild(chip);
  });
}

// Mostra "Enviando arquivo.zip... 42%" no lugar da lista de pendentes
// enquanto o upload HTTP de um anexo grande está rolando — sem isso, uma
// transferência de centenas de MB fica sem feedback nenhum de progresso.
function setChatSendingStatus(text) {
  if (!text) {
    renderPendingAttachments();
    return;
  }
  els.chatPendingAttachments.classList.remove('hidden');
  els.chatPendingAttachments.innerHTML = `<div class="chat-sending-status">${escapeHtml(text)}</div>`;
}

// A antiga sala (#room) tinha um chat embutido na barra lateral, ligado ao
// state.transport LAN/PeerJS antigo. Esse transporte nao existe mais (ver
// joinVoiceChannel) e comunicacao por texto agora vive nos canais de texto
// de verdade (Fase 3) - entao os listeners de #chatForm/#chatAttachBtn/
// #chatFileInput saem daqui (os elementos nem existem mais no HTML).
// As funcoes abaixo (uploadFileTo/onChatMessage/etc.) ficam orfas, ainda
// usadas pelo codigo (tambem morto) de Mensagem Direta - removidas de vez
// na faxina da Fase 5.

function onChatMessage(msg, opts) {
  const isSelf = msg.from === state.myId;
  const row = document.createElement('div');
  row.className = 'chat-msg' + (isSelf ? ' self' : '');
  const time = new Date(msg.ts || Date.now()).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  let attachmentsHtml = '';
  for (const att of msg.attachments || []) {
    const url = att.fileId ? chatFileUrl(att.fileId) : att.dataUrl;
    if (!url) continue;
    if (att.type && att.type.startsWith('image/')) {
      attachmentsHtml += `<a href="${url}" target="_blank" rel="noopener"><img class="chat-attachment-img" src="${url}" alt="${escapeHtml(att.name)}" /></a>`;
    } else {
      attachmentsHtml += `<a class="chat-attachment-file" href="${url}" download="${escapeHtml(att.name)}">${ICONS.file}<span>${escapeHtml(att.name)}</span><span class="chat-attachment-size">${formatFileSize(att.size)}</span></a>`;
    }
  }

  row.innerHTML = `
    <img class="chat-msg-avatar" src="${msg.avatar || DEFAULT_AVATAR}" alt="" />
    <div class="chat-msg-body">
      <div class="chat-msg-meta">
        <span class="chat-msg-name">${escapeHtml(msg.name || 'Convidado')}</span>
        <span class="chat-msg-time">${time}</span>
      </div>
      ${msg.text ? `<div class="chat-msg-text">${escapeHtml(msg.text)}</div>` : ''}
      ${attachmentsHtml ? `<div class="chat-msg-attachments">${attachmentsHtml}</div>` : ''}
    </div>
  `;
  els.chatMessages.appendChild(row);
  els.chatMessages.scrollTop = els.chatMessages.scrollHeight;

  const skipNotify = opts && opts.skipNotify;
  if (!isSelf && !skipNotify && state.settings.chatNotifications) {
    notifyChatMessage(msg);
  }
}

function notifyChatMessage(msg) {
  if (!('Notification' in window)) return;
  // não incomoda se a pessoa já está com o app em foco olhando pro chat —
  // notificação é só pra quando ela não ia ver a mensagem de outro jeito
  if (document.hasFocus() && !document.hidden) return;
  const body = msg.text
    ? msg.text.slice(0, 120)
    : msg.attachments && msg.attachments.length
      ? `enviou ${msg.attachments.length > 1 ? `${msg.attachments.length} arquivos` : 'um arquivo'}`
      : '';
  const show = () => {
    try {
      const notif = new Notification(msg.name || 'Convidado', { body, icon: msg.avatar || undefined });
      notif.onclick = () => {
        window.focus();
        notif.close();
      };
    } catch {
      /* alguns ambientes (ex: sem foco de SO nenhum) recusam o construtor — ignora */
    }
  };
  if (Notification.permission === 'granted') show();
  else if (Notification.permission !== 'denied') {
    Notification.requestPermission().then((perm) => {
      if (perm === 'granted') show();
    });
  }
}

function clearChat() {
  els.chatMessages.innerHTML = '';
  pendingChatFiles = [];
  renderPendingAttachments();
}

/* ---------------- mensagem direta (DM) ----------------
   Clicar em alguém "online" na página inicial abre essa conversa com ela —
   não precisa dos dois estarem na mesma sala. Por baixo, é o MEU servidor
   (não a renderer) que gerencia a conexão de verdade com o servidor da
   outra pessoa; aqui só pede as coisas pelo canal de controle local
   (`ctlWs`) que já existe — ver bloco de DM em `server/main.cjs`. */

let dmPendingFiles = [];

function openDmModal(peer) {
  state.dmPeer = peer;
  els.dmPeerName.textContent = peer.name || 'Convidado';
  els.dmMessages.innerHTML = '';
  dmPendingFiles = [];
  renderDmPendingAttachments();
  els.dmModal.classList.remove('hidden');
  if (ctlWs && ctlWs.readyState === ctlWs.OPEN) {
    ctlWs.send(JSON.stringify({ type: 'dm:get-history', deviceId: peer.deviceId }));
  }
}

function closeDmModal() {
  els.dmModal.classList.add('hidden');
  state.dmPeer = null;
}

els.dmModalClose.addEventListener('click', closeDmModal);
els.dmModal.addEventListener('click', (ev) => {
  if (ev.target === els.dmModal) closeDmModal();
});

function dmFileUrl(att) {
  if (att.fileId) {
    const host = att.fileHost || (state.dmPeer && state.dmPeer.host);
    const port = att.filePort || (state.dmPeer && state.dmPeer.port);
    return `http://${host}:${port}/chat/files/${att.fileId}`;
  }
  return att.dataUrl || '';
}

function renderDmEntry(entry, opts) {
  const isSelf = entry.from === 'me';
  const row = document.createElement('div');
  row.className = 'chat-msg' + (isSelf ? ' self' : '');
  const time = new Date(entry.ts || Date.now()).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  let attachmentsHtml = '';
  for (const att of entry.attachments || []) {
    const url = dmFileUrl(att);
    if (!url) continue;
    if (att.type && att.type.startsWith('image/')) {
      attachmentsHtml += `<a href="${url}" target="_blank" rel="noopener"><img class="chat-attachment-img" src="${url}" alt="${escapeHtml(att.name)}" /></a>`;
    } else {
      attachmentsHtml += `<a class="chat-attachment-file" href="${url}" download="${escapeHtml(att.name)}">${ICONS.file}<span>${escapeHtml(att.name)}</span><span class="chat-attachment-size">${formatFileSize(att.size)}</span></a>`;
    }
  }

  row.innerHTML = `
    <img class="chat-msg-avatar" src="${entry.avatar || DEFAULT_AVATAR}" alt="" />
    <div class="chat-msg-body">
      <div class="chat-msg-meta">
        <span class="chat-msg-name">${escapeHtml(isSelf ? 'Você' : entry.name || 'Convidado')}</span>
        <span class="chat-msg-time">${time}</span>
      </div>
      ${entry.text ? `<div class="chat-msg-text">${escapeHtml(entry.text)}</div>` : ''}
      ${attachmentsHtml ? `<div class="chat-msg-attachments">${attachmentsHtml}</div>` : ''}
    </div>
  `;
  els.dmMessages.appendChild(row);
  els.dmMessages.scrollTop = els.dmMessages.scrollHeight;

  if (!isSelf && !(opts && opts.skipNotify) && state.settings.chatNotifications) {
    notifyChatMessage(entry);
  }
}

function renderDmPendingAttachments() {
  if (!dmPendingFiles.length) {
    els.dmPendingAttachments.classList.add('hidden');
    els.dmPendingAttachments.innerHTML = '';
    return;
  }
  els.dmPendingAttachments.classList.remove('hidden');
  els.dmPendingAttachments.innerHTML = '';
  dmPendingFiles.forEach((file, idx) => {
    const chip = document.createElement('div');
    chip.className = 'chat-pending-chip';
    chip.innerHTML = `<span>${escapeHtml(file.name)} <span class="chat-pending-size">(${formatFileSize(file.size)})</span></span><button type="button" class="chat-pending-remove">${ICONS.close}</button>`;
    chip.querySelector('button').addEventListener('click', () => {
      dmPendingFiles.splice(idx, 1);
      renderDmPendingAttachments();
    });
    els.dmPendingAttachments.appendChild(chip);
  });
}

function setDmSendingStatus(text) {
  if (!text) {
    renderDmPendingAttachments();
    return;
  }
  els.dmPendingAttachments.classList.remove('hidden');
  els.dmPendingAttachments.innerHTML = `<div class="chat-sending-status">${escapeHtml(text)}</div>`;
}

els.dmAttachBtn.addEventListener('click', () => els.dmFileInput.click());
els.dmFileInput.addEventListener('change', () => {
  const files = [...els.dmFileInput.files];
  els.dmFileInput.value = '';
  const maxMb = Math.round(CHAT_FILE_MAX_BYTES_LAN / (1024 * 1024));
  let pendingTotal = dmPendingFiles.reduce((sum, f) => sum + f.size, 0);
  for (const file of files) {
    if (dmPendingFiles.length >= CHAT_MAX_ATTACHMENTS) {
      showToast(`Máximo de ${CHAT_MAX_ATTACHMENTS} anexos por mensagem.`, 3000);
      break;
    }
    if (file.size > CHAT_FILE_MAX_BYTES_LAN) {
      showToast(`"${file.name}" é maior que ${maxMb}MB — escolhe um arquivo menor.`, 3500);
      continue;
    }
    if (pendingTotal + file.size > CHAT_TOTAL_MAX_BYTES_LAN) {
      showToast(`Isso passaria de ${Math.round(CHAT_TOTAL_MAX_BYTES_LAN / (1024 * 1024))}MB somando os anexos — manda em mensagens separadas.`, 4000);
      continue;
    }
    dmPendingFiles.push(file);
    pendingTotal += file.size;
  }
  renderDmPendingAttachments();
});

els.dmForm.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  if (!state.dmPeer || !ctlWs || ctlWs.readyState !== ctlWs.OPEN) return;
  const text = els.dmTextInput.value.trim().slice(0, 2000);
  const files = dmPendingFiles;
  dmPendingFiles = [];
  if (!text && !files.length) {
    renderDmPendingAttachments();
    return;
  }
  els.dmTextInput.value = '';

  const attachments = [];
  const myAddr = lanInfo ? `${lanInfo.localIp}:${lanInfo.port}` : `${location.hostname}:${location.port}`;
  for (const file of files) {
    try {
      setDmSendingStatus(`Enviando "${file.name}"... 0%`);
      const uploaded = await uploadFileTo(myAddr, file, (frac) => {
        setDmSendingStatus(`Enviando "${file.name}"... ${Math.round(frac * 100)}%`);
      });
      attachments.push({
        name: uploaded.name,
        type: uploaded.type,
        size: uploaded.size,
        fileId: uploaded.id,
        fileHost: lanInfo ? lanInfo.localIp : location.hostname,
        filePort: lanInfo ? lanInfo.port : Number(location.port),
      });
    } catch {
      showToast(`Não consegui enviar "${file.name}".`, 3500);
    }
  }
  setDmSendingStatus(null);
  ctlWs.send(
    JSON.stringify({
      type: 'dm:send',
      deviceId: state.dmPeer.deviceId,
      host: state.dmPeer.host,
      port: state.dmPeer.port,
      text,
      attachments,
    }),
  );
});

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

// Amostra o próprio vídeo da tela (só o meu lado, não mexe no que chega pra
// quem assiste) pra avisar SE a captura estiver saindo toda preta — causa
// mais comum: jogo em tela cheia exclusiva (não "janela sem borda") ou
// conteúdo com DRM de vídeo (Netflix etc.) — em ambos os casos o Windows
// entrega frame preto pra qualquer captura de tela, não só a nossa.
function watchForBlackFrames(track) {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = new MediaStream([track]);
  video.play().catch(() => {});
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 18;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let blackStreak = 0;
  let warned = false;
  const timer = setInterval(() => {
    if (track.readyState !== 'live' || video.readyState < 2) return;
    try {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      let sum = 0;
      for (let i = 0; i < data.length; i += 4) sum += data[i] + data[i + 1] + data[i + 2];
      const avg = sum / ((data.length / 4) * 3);
      if (avg < 4) {
        blackStreak++;
        if (blackStreak >= 3 && !warned) {
          warned = true;
          showToast(
            'Sua tela compartilhada parece estar toda preta pros outros. Se for um jogo em tela cheia, troca pro modo "janela sem borda" nas configs gráficas dele — tela cheia exclusiva e vídeo com DRM (Netflix etc.) sempre saem pretos em qualquer captura de tela.',
            9000,
          );
        }
      } else {
        blackStreak = 0;
        warned = false; // se normalizou, pode avisar de novo se ficar preto de novo depois
      }
    } catch {
      /* drawImage pode falhar num frame isolado (ex: troca de resolução); ignora e tenta no próximo */
    }
  }, 4000);
  return () => {
    clearInterval(timer);
    video.pause();
    video.srcObject = null;
  };
}

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

  // O microfone NÃO é mais capturado aqui — ele é uma fonte independente
  // (ver startMicShare), ligada assim que você entra na sala, pra dar pra
  // conversar com os outros sem precisar compartilhar tela/câmera. Aqui só
  // sobra o áudio dos OUTROS apps do seu PC (mixagem por app, Electron) ou o
  // áudio da própria aba/tela (getDisplayMedia com audio, fora do Electron).
  if (isElectron) {
    ensureAudioGraph();
    initAudioChunkRouter();
    els.appAudioPanel.classList.remove('hidden');
    await refreshAppList();
    const mixedAudioTrack = appAudio.destination.stream.getAudioTracks()[0];
    state.screen.localTracks = [...display.getVideoTracks(), mixedAudioTrack];
  } else {
    state.screen.localTracks = [...display.getTracks()];
  }

  setBtnLabel(els.shareBtn, 'Parar de compartilhar');
  els.shareBtn.classList.remove('primary');
  els.shareBtn.classList.add('danger');

  display.getVideoTracks()[0].addEventListener('ended', stopScreenShare);
  state.screen.blackFrameStop = watchForBlackFrames(display.getVideoTracks()[0]);

  addOrUpdateTile(tileKey(state.myId, 'screen'), `${state.myName} (você)`, myAvatar, display, true, 'screen');
  updateEmptyHint();
  state.transport.send({ type: 'share:start', source: 'screen' });
}

function setBtnLabel(btn, text) {
  const span = btn.querySelector('span');
  if (span) span.textContent = text;
  btn.title = text; // a barra agora é só ícones — o texto vira dica ao passar o mouse
}

/* ---------------- voz: microfone independente de tela/câmera ----------------
   Liga sozinho assim que você entra na sala (se "autoMic" estiver ativo nas
   configurações) — dá pra conversar com quem está na sala igual uma chamada
   de voz normal, sem precisar compartilhar nada.

   O mic passa por um grafo Web Audio (em vez de ir direto, cru, pro
   RTCPeerConnection) só por causa do soundboard: precisa de um ponto comum
   onde misturar "minha voz" + "o som que cliquei pra tocar" antes de virar a
   track que vai pros outros. Mutar é zerar o gain do mic nesse grafo (não
   `track.enabled`) — dá no mesmo resultado, mas agora o mic de verdade é a
   entrada do grafo, não a track que sai pro RTCPeerConnection. */

const micMix = { ctx: null, destination: null, micSource: null, micGain: null };

async function startMicShare() {
  if (state.mic.sharing || !state.transport) return;
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(micConstraints());
  } catch {
    return; // sem microfone ou permissão negada — segue sem voz, só texto/tela
  }
  state.mic.micStream = stream;

  micMix.ctx = new AudioContext();
  micMix.destination = micMix.ctx.createMediaStreamDestination();
  micMix.micSource = micMix.ctx.createMediaStreamSource(stream);
  micMix.micGain = micMix.ctx.createGain();
  // lembra se você tinha mutado antes de sair — o mic já liga mutado de
  // novo na próxima vez, não importa quanto tempo passou (preferência
  // persistida, não um estado de sessão que reseta a cada entrada na sala).
  micMix.micGain.gain.value = state.settings.micMuted ? 0 : 1;
  micMix.micSource.connect(micMix.micGain).connect(micMix.destination);

  state.mic.localTracks = micMix.destination.stream.getAudioTracks();
  state.mic.sharing = true;
  stream.getAudioTracks()[0].addEventListener('ended', stopMicShare);
  els.micMuteBtn.classList.remove('hidden');
  setMicMuteBtn(state.settings.micMuted);
  state.transport.send({ type: 'share:start', source: 'mic' });
}

function stopMicShare() {
  if (!state.mic.sharing) return;
  state.mic.sharing = false;
  if (state.mic.micStream) {
    for (const t of state.mic.micStream.getTracks()) t.stop();
    state.mic.micStream = null;
  }
  state.mic.localTracks = [];
  if (micMix.micSource) { micMix.micSource.disconnect(); micMix.micSource = null; }
  if (micMix.micGain) { micMix.micGain.disconnect(); micMix.micGain = null; }
  if (micMix.ctx) { micMix.ctx.close(); micMix.ctx = null; micMix.destination = null; }
  // qualquer som do soundboard que estivesse tocando nesse contexto morreu
  // junto com ele — limpa as referências pra não ficar lixo apontando pra
  // nós de um AudioContext já fechado.
  playingSounds.clear();
  soundMonitorGain.mix = null;
  for (const key of [...state.broadcastPcs.keys()]) {
    if (key.endsWith(':mic')) teardownBroadcast(key);
  }
  els.micMuteBtn.classList.add('hidden');
  if (state.transport) state.transport.send({ type: 'share:stop', source: 'mic' });
}

function setMicMuteBtn(muted) {
  const text = muted ? 'Microfone mutado' : 'Mutar microfone';
  els.micMuteBtn.innerHTML = `${muted ? ICONS.micOff : ICONS.mic}<span>${text}</span>`;
  els.micMuteBtn.title = text;
  els.micMuteBtn.classList.toggle('danger', muted);
}

els.micMuteBtn.addEventListener('click', () => {
  if (!micMix.micGain) return;
  const nowMuted = micMix.micGain.gain.value !== 0;
  micMix.micGain.gain.value = nowMuted ? 0 : 1;
  state.settings.micMuted = nowMuted;
  saveSettings();
  setMicMuteBtn(nowMuted);
});

/* ---------------- soundboard ----------------
   Sons curtos salvos no próprio PC (IndexedDB — blobs de áudio não cabem
   direito no localStorage) que tocam DENTRO da call (misturados no grafo de
   voz acima) quando você clica. O volume configurável é só o quanto VOCÊ
   escuta de volta, não o que os outros recebem (isso mandamos num nível
   fixo, senão a pessoa que clica no som também controlaria sem querer o
   volume que sai pros outros). Funciona mesmo sem a voz ligada — nesse caso
   só toca localmente (pra testar o som), sem mandar pra ninguém. */

const SOUND_DB_NAME = 'tela-radmin-sounds';
const SOUND_STORE = 'sounds';
const soundBufferCache = new Map(); // id -> AudioBuffer decodado (evita redecodificar a cada clique)
let previewCtx = null;

function openSoundDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(SOUND_DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(SOUND_STORE, { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbAddSound(name, blob) {
  const db = await openSoundDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SOUND_STORE, 'readwrite');
    const req = tx.objectStore(SOUND_STORE).add({ name, blob, createdAt: Date.now() });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbListSounds() {
  const db = await openSoundDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(SOUND_STORE, 'readonly').objectStore(SOUND_STORE).getAll();
    req.onsuccess = () => resolve(req.result.sort((a, b) => a.createdAt - b.createdAt));
    req.onerror = () => reject(req.error);
  });
}

async function dbDeleteSound(id) {
  const db = await openSoundDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SOUND_STORE, 'readwrite');
    tx.objectStore(SOUND_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function dbRenameSound(id, name) {
  const db = await openSoundDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SOUND_STORE, 'readwrite');
    const store = tx.objectStore(SOUND_STORE);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      if (getReq.result) {
        getReq.result.name = name;
        store.put(getReq.result);
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getDecodedBuffer(sound) {
  if (soundBufferCache.has(sound.id)) return soundBufferCache.get(sound.id);
  const ctx = micMix.ctx || getPreviewCtx();
  const arrayBuffer = await sound.blob.arrayBuffer();
  const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
  soundBufferCache.set(sound.id, audioBuffer);
  return audioBuffer;
}

function getPreviewCtx() {
  if (!previewCtx) previewCtx = new AudioContext();
  return previewCtx;
}

// Um único GainNode "de monitor" por contexto, reaproveitado por TODAS as
// reproduções — é o que deixa o volume reagir na hora quando você mexe no
// slider, mesmo com um som já tocando (antes cada clique criava um GainNode
// novo, isolado, que não tinha como ser alcançado pelo slider depois —
// por isso o volume "não fazia nada": ele só valia pra reproduções futuras
// que nem chegavam a existir enquanto o mesmo som tocava).
const soundMonitorGain = { mix: null, preview: null };
function getMonitorGainFor(ctx) {
  const key = ctx === micMix.ctx ? 'mix' : 'preview';
  const current = soundMonitorGain[key];
  if (current && current.context === ctx) return current;
  const gainNode = ctx.createGain();
  gainNode.gain.value = state.settings.soundboardVolume / 100;
  gainNode.connect(ctx.destination);
  soundMonitorGain[key] = gainNode;
  return gainNode;
}

const playingSounds = new Map(); // sound.id -> AudioBufferSourceNode tocando agora

async function playSoundboardClip(sound) {
  // clicar de novo num som que já está tocando para ele — serve pra cortar
  // um áudio longo no meio sem precisar esperar acabar.
  const playing = playingSounds.get(sound.id);
  if (playing) {
    playing.stop(); // dispara 'ended' abaixo, que já limpa o map e a UI
    return;
  }

  let buffer;
  try {
    buffer = await getDecodedBuffer(sound);
  } catch {
    showToast(`Não consegui tocar "${sound.name}" — o arquivo pode estar corrompido.`, 3500);
    return;
  }

  const ctx = micMix.ctx || getPreviewCtx();
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  if (micMix.ctx) {
    // voz ligada: além de tocar pra você, manda pros outros também (nível fixo)
    const sendGain = ctx.createGain();
    sendGain.gain.value = 0.9;
    source.connect(sendGain).connect(micMix.destination);
  }
  source.connect(getMonitorGainFor(ctx));
  source.addEventListener('ended', () => {
    playingSounds.delete(sound.id);
    updateSoundboardRowPlaying(sound.id, false);
  });
  playingSounds.set(sound.id, source);
  source.start();
  updateSoundboardRowPlaying(sound.id, true);
}

function updateSoundboardRowPlaying(id, isPlaying) {
  const row = els.soundboardList.querySelector(`[data-id="${id}"]`);
  if (!row) return;
  row.classList.toggle('playing', isPlaying);
  row.querySelector('.soundboard-row-play').innerHTML = isPlaying ? ICONS.stop : ICONS.volume;
  row.title = isPlaying ? 'Parar' : 'Tocar';
}

async function renderSoundboardList() {
  let sounds;
  try {
    sounds = await dbListSounds();
  } catch {
    els.soundboardList.innerHTML = '<p class="hint">Não consegui carregar seus sons salvos.</p>';
    return;
  }
  if (!sounds.length) {
    els.soundboardList.innerHTML = '<p class="hint">Nenhum som ainda. Clica em "Adicionar som" pra importar um arquivo de áudio.</p>';
    return;
  }
  els.soundboardList.innerHTML = '';
  for (const sound of sounds) {
    const isPlaying = playingSounds.has(sound.id);
    const row = document.createElement('div');
    row.className = 'soundboard-row' + (isPlaying ? ' playing' : '');
    row.dataset.id = sound.id;
    row.title = isPlaying ? 'Parar' : 'Tocar';
    row.innerHTML = `
      <span class="soundboard-row-play">${isPlaying ? ICONS.stop : ICONS.volume}</span>
      <span class="soundboard-row-name">${escapeHtml(sound.name)}</span>
      <span class="soundboard-row-actions">
        <button type="button" class="icon-btn ghost soundboard-rename" title="Renomear">${ICONS.pencil}</button>
        <button type="button" class="icon-btn ghost danger-hover soundboard-delete" title="Remover">${ICONS.trash}</button>
      </span>
    `;
    row.addEventListener('click', () => playSoundboardClip(sound));
    row.querySelector('.soundboard-rename').addEventListener('click', (ev) => {
      ev.stopPropagation();
      startSoundRename(row, sound);
    });
    row.querySelector('.soundboard-delete').addEventListener('click', async (ev) => {
      ev.stopPropagation();
      if (playingSounds.has(sound.id)) playingSounds.get(sound.id).stop();
      await dbDeleteSound(sound.id);
      soundBufferCache.delete(sound.id);
      renderSoundboardList();
    });
    els.soundboardList.appendChild(row);
  }
}

function startSoundRename(row, sound) {
  const nameEl = row.querySelector('.soundboard-row-name');
  const input = document.createElement('input');
  input.type = 'text';
  input.value = sound.name;
  input.maxLength = 40;
  input.className = 'soundboard-rename-input';
  input.addEventListener('click', (ev) => ev.stopPropagation());
  nameEl.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const commit = async () => {
    if (done) return;
    done = true;
    const newName = input.value.trim() || sound.name;
    await dbRenameSound(sound.id, newName);
    renderSoundboardList();
  };
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') input.blur();
    if (ev.key === 'Escape') { done = true; renderSoundboardList(); }
  });
  input.addEventListener('blur', commit);
}

els.soundboardBtn.addEventListener('click', () => {
  els.soundboardModal.classList.remove('hidden');
  els.soundboardVolumeSlider.value = String(state.settings.soundboardVolume);
  renderSoundboardList();
});
els.soundboardModalClose.addEventListener('click', () => els.soundboardModal.classList.add('hidden'));
els.soundboardModal.addEventListener('click', (ev) => {
  if (ev.target === els.soundboardModal) els.soundboardModal.classList.add('hidden');
});
els.soundboardVolumeSlider.addEventListener('input', () => {
  state.settings.soundboardVolume = Number(els.soundboardVolumeSlider.value);
  saveSettings();
  const vol = state.settings.soundboardVolume / 100;
  // aplica na hora em quem já estiver tocando agora, não só nas próximas vezes
  if (soundMonitorGain.mix) soundMonitorGain.mix.gain.value = vol;
  if (soundMonitorGain.preview) soundMonitorGain.preview.gain.value = vol;
});
els.addSoundBtn.addEventListener('click', () => els.soundFileInput.click());
els.soundFileInput.addEventListener('change', async () => {
  const file = els.soundFileInput.files[0];
  els.soundFileInput.value = '';
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) {
    showToast('Esse arquivo é maior que 10MB — escolhe um som mais curto.', 3500);
    return;
  }
  const name = file.name.replace(/\.[^.]+$/, '').slice(0, 40) || 'Som sem nome';
  await dbAddSound(name, file);
  renderSoundboardList();
});

function stopScreenShare() {
  if (!state.screen.sharing) return;
  state.screen.sharing = false;
  setBtnLabel(els.shareBtn, 'Compartilhar tela');
  els.shareBtn.classList.remove('danger');
  els.shareBtn.classList.add('primary');

  if (state.screen.blackFrameStop) {
    state.screen.blackFrameStop();
    state.screen.blackFrameStop = null;
  }
  if (state.screen.displayStream) {
    for (const t of state.screen.displayStream.getTracks()) t.stop();
    state.screen.displayStream = null;
  }
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

/* ---------------- overlay da câmera ----------------
   Imagem (PNG com transparência, tipicamente exportada do Outro Lado da
   Mesa com a arte/moldura do personagem) desenhada por cima do vídeo da
   câmera antes de sair pra transmissão. Guardada no IndexedDB (igual o
   soundboard — uma imagem de alguns MB não cabe direito no localStorage),
   só 1 overlay por vez (chave fixa). Implementado compondo câmera + overlay
   num <canvas> a cada quadro e mandando `canvas.captureStream()` em vez do
   vídeo cru da câmera — por isso o botão/checkbox de ativar funciona AO
   VIVO, sem precisar desligar/religar a câmera: o loop de desenho já está
   rodando o tempo todo enquanto a câmera está ligada, só decide a cada
   quadro se desenha o overlay por cima ou não. */

const OVERLAY_DB_NAME = 'tela-radmin-overlay';
const OVERLAY_STORE = 'overlay';
const OVERLAY_KEY = 'camera';
const cameraOverlay = { bitmap: null, previewUrl: null };

function openOverlayDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(OVERLAY_DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(OVERLAY_STORE, { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbSetOverlay(blob) {
  const db = await openOverlayDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OVERLAY_STORE, 'readwrite');
    tx.objectStore(OVERLAY_STORE).put({ key: OVERLAY_KEY, blob });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function dbGetOverlay() {
  const db = await openOverlayDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(OVERLAY_STORE, 'readonly').objectStore(OVERLAY_STORE).get(OVERLAY_KEY);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function dbClearOverlay() {
  const db = await openOverlayDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OVERLAY_STORE, 'readwrite');
    tx.objectStore(OVERLAY_STORE).delete(OVERLAY_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadCameraOverlayBitmap() {
  if (cameraOverlay.previewUrl) {
    URL.revokeObjectURL(cameraOverlay.previewUrl);
    cameraOverlay.previewUrl = null;
  }
  try {
    const record = await dbGetOverlay();
    if (record) {
      cameraOverlay.bitmap = await createImageBitmap(record.blob);
      cameraOverlay.previewUrl = URL.createObjectURL(record.blob);
    } else {
      cameraOverlay.bitmap = null;
    }
  } catch {
    cameraOverlay.bitmap = null;
  }
  renderOverlayUI();
}

function renderOverlayUI() {
  const has = !!cameraOverlay.previewUrl;
  els.overlayPreview.src = cameraOverlay.previewUrl || '';
  els.overlayPreview.classList.toggle('hidden', !has);
  els.overlayRemoveBtn.classList.toggle('hidden', !has);
  els.overlayEmptyHint.classList.toggle('hidden', has);
  els.overlayEnabledCheck.disabled = !has;
}

const cameraCompositor = { rafId: null, video: null, canvas: null, ctx: null };

function startCameraCompositor(camStream) {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = camStream;
  video.play().catch(() => {});

  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 480;
  const ctx = canvas.getContext('2d');

  function draw() {
    const w = video.videoWidth || canvas.width;
    const h = video.videoHeight || canvas.height;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    if (video.readyState >= 2) ctx.drawImage(video, 0, 0, w, h);
    if (state.settings.cameraOverlayEnabled && cameraOverlay.bitmap) {
      ctx.drawImage(cameraOverlay.bitmap, 0, 0, w, h);
    }
    cameraCompositor.rafId = requestAnimationFrame(draw);
  }
  draw();

  cameraCompositor.video = video;
  cameraCompositor.canvas = canvas;
  cameraCompositor.ctx = ctx;
  return canvas.captureStream(30);
}

function stopCameraCompositor() {
  if (cameraCompositor.rafId) cancelAnimationFrame(cameraCompositor.rafId);
  cameraCompositor.rafId = null;
  if (cameraCompositor.video) {
    cameraCompositor.video.srcObject = null;
    cameraCompositor.video = null;
  }
  cameraCompositor.canvas = null;
  cameraCompositor.ctx = null;
}

loadCameraOverlayBitmap();
els.overlayEnabledCheck.checked = state.settings.cameraOverlayEnabled;

els.overlayAddBtn.addEventListener('click', () => els.overlayFileInput.click());
els.overlayFileInput.addEventListener('change', async () => {
  const file = els.overlayFileInput.files[0];
  els.overlayFileInput.value = '';
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) {
    showToast('Essa imagem é maior que 10MB — escolhe um arquivo menor.', 3500);
    return;
  }
  await dbSetOverlay(file);
  await loadCameraOverlayBitmap();
  if (!state.settings.cameraOverlayEnabled) {
    // escolher uma imagem pela primeira vez já liga o overlay sozinho —
    // sem isso a pessoa escolhe a imagem e "não acontece nada", porque o
    // checkbox continua desmarcado.
    state.settings.cameraOverlayEnabled = true;
    els.overlayEnabledCheck.checked = true;
    saveSettings();
  }
});
els.overlayRemoveBtn.addEventListener('click', async () => {
  await dbClearOverlay();
  await loadCameraOverlayBitmap();
  state.settings.cameraOverlayEnabled = false;
  els.overlayEnabledCheck.checked = false;
  saveSettings();
});
els.overlayEnabledCheck.addEventListener('change', () => {
  state.settings.cameraOverlayEnabled = els.overlayEnabledCheck.checked;
  saveSettings();
});

/* ---------------- lado de quem transmite: câmera ---------------- */

els.cameraBtn.addEventListener('click', () => {
  if (state.camera.sharing) stopCameraShare();
  else startCameraShare();
});

async function startCameraShare() {
  let cam;
  const video = state.settings.camDeviceId ? { deviceId: { exact: state.settings.camDeviceId } } : true;
  try {
    cam = await navigator.mediaDevices.getUserMedia({ video });
  } catch {
    return; // sem câmera ou permissão negada
  }
  state.camera.camStream = cam;
  // o vídeo que sai pros outros é o do <canvas> (câmera + overlay desenhados
  // juntos a cada quadro), não a track crua da câmera — é o que permite
  // ligar/desligar o overlay ao vivo sem reiniciar a câmera.
  const composited = startCameraCompositor(cam);
  state.camera.localTracks = composited.getVideoTracks();
  state.camera.sharing = true;

  setBtnLabel(els.cameraBtn, 'Desligar câmera');
  els.cameraBtn.classList.add('danger');

  cam.getVideoTracks()[0].addEventListener('ended', stopCameraShare);

  addOrUpdateTile(tileKey(state.myId, 'camera'), `${state.myName} (você)`, myAvatar, composited, true, 'camera');
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
  for (const t of state.camera.localTracks) t.stop(); // track do <canvas>, não da câmera
  state.camera.localTracks = [];
  stopCameraCompositor();

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
  const localTracks =
    source === 'camera' ? state.camera.localTracks : source === 'mic' ? state.mic.localTracks : state.screen.localTracks;
  if (!localTracks.length) return; // pedido chegou depois que eu já parei essa fonte
  const key = tileKey(viewerId, source);
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  state.broadcastPcs.set(key, pc);

  const combined = new MediaStream(localTracks);
  for (const track of localTracks) pc.addTrack(track, combined);
  preferH264(pc);
  applyBandwidthLimit(pc);

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
  // Mic não tem vídeo — é só áudio tocando em segundo plano, sem quadro na
  // grade (senão a tela ficava cheia de "quadros vazios" só de gente
  // conversando, igual uma chamada de voz normal não mostra nada visual).
  if (source === 'mic') {
    let micTile = state.tiles.get(key);
    if (!micTile) {
      const audio = document.createElement('audio');
      audio.autoplay = true;
      document.body.appendChild(audio);
      applySpeakerDevice(audio);
      micTile = { root: audio, video: audio, isSelf, audioOnly: true };
      state.tiles.set(key, micTile);
    }
    if (micTile.video.srcObject !== stream) micTile.video.srcObject = stream;
    return;
  }

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

    if (!isSelf) applySpeakerDevice(video);

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

/* ---------------- "novidades desta versão" ----------------
   Toda vez que sobe uma versão nova (ver CHANGELOG.md / lembrete no fluxo
   de publish), acrescenta uma entrada aqui. Quando o app abre numa versão
   diferente da última vista (guardada no localStorage), mostra um modal
   com o que mudou desde então — sem precisar de internet nem depender do
   corpo da release no GitHub. */

const CHANGELOG = {
  '2.3.0': [
    'HUD redesenhado: visual mais "gaming" no lobby e na sala, com pill de conexão e botões com brilho.',
    'Coroa de anfitrião e status "Online" na lista de pessoas da sala.',
  ],
  '2.3.1': [
    'Link direto pra baixar "O Outro Lado da Mesa" no rodapé do lobby.',
  ],
  '2.4.0': [
    'Sidebar de salas numeradas ("Sala 1", "Sala 2"...), estilo canal de voz do Discord — clique numa vazia pra virar anfitrião na hora, numa ocupada pra entrar direto.',
    'Lista de "quem está online" na rede, independente de estar numa sala ou não.',
  ],
  '2.5.0': [
    'Esse aviso de novidades aqui — a partir de agora, toda atualização mostra o que mudou.',
  ],
  '2.6.0': [
    'Limite de banda da transmissão nas configurações — se a transmissão andar travando pros seus amigos, escolher "Rede fraca" ajuda mais do que baixar a resolução.',
    'Aviso automático pra quem está compartilhando se a tela sair toda preta pros outros (jogo em tela cheia exclusiva ou vídeo com DRM tipo Netflix).',
  ],
  '2.7.0': [
    'A tela de "atualização pronta" agora tem a cara do app, em vez da caixinha genérica do Windows.',
  ],
  '2.8.0': [
    'Corrigido bug de sala/pessoa duplicada na descoberta de rede quando outra VPN (ex: Cloudflare WARP) está ligada junto com o Radmin.',
    'Corrigido bug de nenhuma sala/pessoa aparecer usando só o Radmin — a descoberta agora é enviada direto pelo adaptador de rede certo, em vez de arriscar sair pelo adaptador errado.',
  ],
  '2.9.0': [
    'Nova opção "Esconder o cursor do mouse na transmissão" (configurações, ligada por padrão) — evita o cursor aparecer fixo/fantasma em jogos que escondem a mira de verdade (ex: Valorant) ou continuar visível depois que ele some da tela assistindo vídeo.',
  ],
  '2.10.0': [
    'Agora dá pra escolher microfone, câmera e saída de áudio (fone/caixa) nas configurações, em vez de usar sempre o padrão do sistema.',
    'Se a câmera aparecer com cor estranha (tipo tudo amarelo), geralmente é o dispositivo errado selecionado — agora dá pra trocar e testar direto ali.',
  ],
  '2.11.0': [
    'Configurações virou uma janela própria com abas (Dispositivos/Voz/Transmissão/Apps mutados), em vez de um painel pequeno que cortava conteúdo fora da tela.',
    'Microfone agora é independente — liga sozinho assim que você entra na sala, dá pra conversar com todo mundo sem precisar compartilhar tela ou câmera (igual uma chamada de voz). O botão de mutar fica sempre visível na barra.',
    'Nova aba "Apps mutados": marca um app pra ele já começar mutado automaticamente toda vez que você compartilhar a tela, sem precisar mutar na mão de novo.',
  ],
  '2.12.0': [
    'Mutar o microfone agora é lembrado pra sempre — se você sair da sala mutado, volta mutado da próxima vez, não importa quanto tempo passe.',
  ],
  '2.13.0': [
    'Soundboard novo (botão ao lado do mic, na barra de baixo): adiciona sons curtos que ficam salvos no seu PC e toca eles na call com um clique — todo mundo ouve.',
    'Dá pra nomear/renomear cada som e controlar o volume que só VOCÊ escuta de volta, sem afetar o volume pros outros.',
  ],
  '2.14.0': [
    'Corrigido o volume do soundboard não fazer efeito nenhum — agora muda na hora, mesmo com um som já tocando.',
    'Clicar de novo num som do soundboard que já está tocando agora para ele — útil pra cortar um áudio longo no meio.',
  ],
  '2.15.0': [
    'Overlay da câmera (configurações → Dispositivos): escolhe uma imagem PNG transparente (ex: moldura/arte de personagem) e ela aparece por cima do seu vídeo pros outros — dá pra ligar/desligar na hora, sem precisar desligar a câmera.',
  ],
  '2.16.0': [
    'Chat de texto em cada sala, com foto e arquivo anexado — aparece na barra lateral, do lado da lista de pessoas.',
    'No modo Rede local (Radmin), o chat já é automaticamente privado só pra rede: quem não está conectado nela não consegue nem alcançar a sala, muito menos ler o chat.',
  ],
  '2.17.0': [
    'Chat agora fica salvo enquanto quem hospeda a sala mantiver o app aberto — se todo mundo sair e voltar, o histórico continua lá.',
    'Notificação do Windows quando chega mensagem nova no chat e o app não está em foco — com opção de desligar nas configurações (aba "Chat").',
    'Limite de anexo subiu de 8MB pra 25MB por arquivo (até 50MB somando os anexos de uma mensagem).',
  ],
  '2.18.0': [
    'Limite de anexo na rede local (Radmin) subiu pra 500MB por arquivo — agora vai por upload de verdade, em pedaços, com barra de progresso.',
    'Chat da sala e mensagens diretas agora ficam salvos em disco de verdade — sobrevivem a fechar e abrir o app, não só a sair/voltar da sala.',
    'Mensagem direta: clica em alguém "online" na página inicial pra conversar com ela, mesmo sem estar na mesma sala — com histórico salvo, anexo de arquivo e notificação.',
  ],
  '2.19.0': [
    'Tentativa de tirar a borda que o Windows às vezes desenha em volta de uma janela específica sendo compartilhada — teste em casa e avisa se sumiu de verdade.',
  ],
};

const LAST_SEEN_VERSION_KEY = 'tela-radmin:last-seen-version';

function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

async function fetchCurrentVersion() {
  try {
    if (isElectron) return await window.telaNative.getVersion();
    const r = await fetch('/version');
    return (await r.json()).version;
  } catch {
    return null;
  }
}

async function checkWhatsNew() {
  const currentVersion = await fetchCurrentVersion();
  if (!currentVersion) return;

  const lastSeen = localStorage.getItem(LAST_SEEN_VERSION_KEY);
  if (!lastSeen) {
    // primeira vez rodando com esse recurso — não despeja o histórico
    // inteiro em quem já usava o app, só marca o ponto de partida.
    localStorage.setItem(LAST_SEEN_VERSION_KEY, currentVersion);
    return;
  }
  if (lastSeen === currentVersion) return;
  localStorage.setItem(LAST_SEEN_VERSION_KEY, currentVersion);

  const versions = Object.keys(CHANGELOG)
    .filter((v) => compareVersions(v, lastSeen) > 0 && compareVersions(v, currentVersion) <= 0)
    .sort(compareVersions);
  if (!versions.length) return;

  els.whatsNewVersion.textContent = `Atualizado pra versão ${currentVersion}`;
  els.whatsNewList.innerHTML = versions
    .map(
      (v) => `
    <div class="whats-new-version-block">
      <span class="version-tag">v${v}</span>
      <ul>${CHANGELOG[v].map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
    </div>`,
    )
    .join('');
  els.whatsNewModal.classList.remove('hidden');
}

els.whatsNewClose.addEventListener('click', () => els.whatsNewModal.classList.add('hidden'));
els.whatsNewOkBtn.addEventListener('click', () => els.whatsNewModal.classList.add('hidden'));

checkWhatsNew();

/* ---------------- "atualização pronta" ----------------
   Substitui o dialog nativo do SO (feio, fora do padrão visual) por um
   modal com a cara do app — main.js manda o aviso por IPC assim que o
   electron-updater termina de baixar a atualização em segundo plano. */

if (isElectron && window.telaNative.onUpdateReady) {
  window.telaNative.onUpdateReady(({ version }) => {
    els.updateReadyVersion.textContent = `Versão ${version} já foi baixada`;
    els.updateReadyModal.classList.remove('hidden');
  });
}
els.updateReadyLaterBtn.addEventListener('click', () => els.updateReadyModal.classList.add('hidden'));
els.updateReadyRestartBtn.addEventListener('click', () => window.telaNative.quitAndInstall());
