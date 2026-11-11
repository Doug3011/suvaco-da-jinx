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
  soundboard: `<svg ${ICON_ATTRS}><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>`,
  signal: `<svg ${ICON_ATTRS}><line x1="4" y1="20" x2="4" y2="14"/><line x1="10" y1="20" x2="10" y2="10"/><line x1="16" y1="20" x2="16" y2="6"/><line x1="22" y1="20" x2="22" y2="3"/></svg>`,
  file: `<svg ${ICON_ATTRS}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
  close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  stop: `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>`,
  message: `<svg ${ICON_ATTRS}><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>`,
  plus: `<svg ${ICON_ATTRS}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
  gear: `<svg ${ICON_ATTRS}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
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
  userBarProfileBtn: document.getElementById('userBarProfileBtn'),
  userBarLogoutBtn: document.getElementById('userBarLogoutBtn'),
  userBarSettingsBtn: document.getElementById('userBarSettingsBtn'),
  memberSidebar: document.getElementById('memberSidebar'),
  memberList: document.getElementById('memberList'),
  room: document.getElementById('room'),
  profileModal: document.getElementById('profileModal'),
  profileModalCard: document.getElementById('profileModalCard'),
  profileModalClose: document.getElementById('profileModalClose'),
  bannerLabel: document.getElementById('bannerLabel'),
  profileBanner: document.getElementById('profileBanner'),
  bannerInput: document.getElementById('bannerInput'),
  modalAvatarPreview: document.getElementById('modalAvatarPreview'),
  modalAvatarLabel: document.getElementById('modalAvatarLabel'),
  modalAvatarInput: document.getElementById('modalAvatarInput'),
  profileModalName: document.getElementById('profileModalName'),
  profileModalHandle: document.getElementById('profileModalHandle'),
  profileNameField: document.getElementById('profileNameField'),
  profileNameInput: document.getElementById('profileNameInput'),
  bioInput: document.getElementById('bioInput'),
  profileHistorySection: document.getElementById('profileHistorySection'),
  profileHistoryList: document.getElementById('profileHistoryList'),
  profileMutualSection: document.getElementById('profileMutualSection'),
  profileMutualServers: document.getElementById('profileMutualServers'),
  profileMutualFriends: document.getElementById('profileMutualFriends'),
  profileActionsRow: document.getElementById('profileActionsRow'),
  profileAddFriendBtn: document.getElementById('profileAddFriendBtn'),
  profilePendingBtn: document.getElementById('profilePendingBtn'),
  profileAcceptFriendBtn: document.getElementById('profileAcceptFriendBtn'),
  profileMessageBtn: document.getElementById('profileMessageBtn'),
  profileRemoveFriendBtn: document.getElementById('profileRemoveFriendBtn'),
  homeBtn: document.getElementById('homeBtn'),
  friendsTabs: document.querySelectorAll('.friends-tab'),
  friendsTabPanels: document.querySelectorAll('.friends-tab-panel'),
  friendsOnlineList: document.getElementById('friendsOnlineList'),
  friendsAllList: document.getElementById('friendsAllList'),
  friendsPendingIncoming: document.getElementById('friendsPendingIncoming'),
  friendsPendingOutgoing: document.getElementById('friendsPendingOutgoing'),
  addFriendForm: document.getElementById('addFriendForm'),
  addFriendInput: document.getElementById('addFriendInput'),
  addFriendError: document.getElementById('addFriendError'),
  addFriendResults: document.getElementById('addFriendResults'),
  dmChannel: document.getElementById('dmChannel'),
  dmPeerAvatar: document.getElementById('dmPeerAvatar'),
  dmPeerName: document.getElementById('dmPeerName'),
  dmMessages: document.getElementById('dmMessages'),
  dmForm: document.getElementById('dmForm'),
  dmTextInput: document.getElementById('dmTextInput'),
  dmAttachBtn: document.getElementById('dmAttachBtn'),
  dmFileInput: document.getElementById('dmFileInput'),
  dmPendingAttachments: document.getElementById('dmPendingAttachments'),
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
  channelModal: document.getElementById('channelModal'),
  channelModalClose: document.getElementById('channelModalClose'),
  channelModalTitle: document.getElementById('channelModalTitle'),
  channelNameInput: document.getElementById('channelNameInput'),
  channelCreateBtn: document.getElementById('channelCreateBtn'),
  channelModalError: document.getElementById('channelModalError'),
  serverSettingsBtn: document.getElementById('serverSettingsBtn'),
  serverSettingsModal: document.getElementById('serverSettingsModal'),
  serverSettingsModalClose: document.getElementById('serverSettingsModalClose'),
  serverSettingsTabTitle: document.getElementById('serverSettingsTabTitle'),
  serverSettingsTabSub: document.getElementById('serverSettingsTabSub'),
  serverSettingsTabs: document.querySelectorAll('#serverSettingsTabs .settings-tab'),
  serverSettingsTabPanels: document.querySelectorAll('#serverSettingsTabBody .settings-tab-panel'),
  serverIconLabel: document.getElementById('serverIconLabel'),
  serverIconPreview: document.getElementById('serverIconPreview'),
  serverIconInput: document.getElementById('serverIconInput'),
  serverSettingsNameInput: document.getElementById('serverSettingsNameInput'),
  serverSettingsSaveBtn: document.getElementById('serverSettingsSaveBtn'),
  serverSettingsInviteCode: document.getElementById('serverSettingsInviteCode'),
  serverSettingsCopyInviteBtn: document.getElementById('serverSettingsCopyInviteBtn'),
  serverSettingsCopyInviteLinkBtn: document.getElementById('serverSettingsCopyInviteLinkBtn'),
  serverSettingsError: document.getElementById('serverSettingsError'),
  leaveServerBtn: document.getElementById('leaveServerBtn'),
  deleteServerBtn: document.getElementById('deleteServerBtn'),
  textChannel: document.getElementById('textChannel'),
  textChannelName: document.getElementById('textChannelName'),
  textChannelMessages: document.getElementById('textChannelMessages'),
  textChannelForm: document.getElementById('textChannelForm'),
  textChannelTextInput: document.getElementById('textChannelTextInput'),
  textChannelTypingIndicator: document.getElementById('textChannelTypingIndicator'),
  textChannelEmojiBtn: document.getElementById('textChannelEmojiBtn'),
  dmEmojiBtn: document.getElementById('dmEmojiBtn'),
  textChannelAttachBtn: document.getElementById('textChannelAttachBtn'),
  textChannelFileInput: document.getElementById('textChannelFileInput'),
  textChannelPendingAttachments: document.getElementById('textChannelPendingAttachments'),
  roomInfo: document.getElementById('roomInfo'),
  peopleCount: document.getElementById('peopleCount'),
  chatNotificationsCheck: document.getElementById('chatNotificationsCheck'),
  voiceConnectedPanel: document.getElementById('voiceConnectedPanel'),
  voiceConnectedDetail: document.getElementById('voiceConnectedDetail'),
  closeBehaviorSelect: document.getElementById('closeBehaviorSelect'),
  winMinimizeBtn: document.getElementById('winMinimizeBtn'),
  winMaximizeBtn: document.getElementById('winMaximizeBtn'),
  winCloseBtn: document.getElementById('winCloseBtn'),
  themePicker: document.getElementById('themePicker'),
  authEmailLoginLink: document.getElementById('authEmailLoginLink'),
  accountEmailStatus: document.getElementById('accountEmailStatus'),
  openLinkEmailBtn: document.getElementById('openLinkEmailBtn'),
  emailAuthModal: document.getElementById('emailAuthModal'),
  emailAuthClose: document.getElementById('emailAuthClose'),
  emailAuthTitle: document.getElementById('emailAuthTitle'),
  emailAuthStepEmail: document.getElementById('emailAuthStepEmail'),
  emailAuthEmailHint: document.getElementById('emailAuthEmailHint'),
  emailAuthEmailInput: document.getElementById('emailAuthEmailInput'),
  emailAuthError: document.getElementById('emailAuthError'),
  emailAuthSendBtn: document.getElementById('emailAuthSendBtn'),
  emailAuthStepCode: document.getElementById('emailAuthStepCode'),
  emailAuthEmailShown: document.getElementById('emailAuthEmailShown'),
  emailAuthCodeInput: document.getElementById('emailAuthCodeInput'),
  emailAuthCodeError: document.getElementById('emailAuthCodeError'),
  emailAuthConfirmBtn: document.getElementById('emailAuthConfirmBtn'),
  emailAuthResendBtn: document.getElementById('emailAuthResendBtn'),
  openBugReportBtn: document.getElementById('openBugReportBtn'),
  bugReportModal: document.getElementById('bugReportModal'),
  bugReportModalClose: document.getElementById('bugReportModalClose'),
  bugReportText: document.getElementById('bugReportText'),
  bugReportAttachBtn: document.getElementById('bugReportAttachBtn'),
  bugReportFileInput: document.getElementById('bugReportFileInput'),
  bugReportPreviewWrap: document.getElementById('bugReportPreviewWrap'),
  bugReportPreviewImg: document.getElementById('bugReportPreviewImg'),
  bugReportRemoveAttachBtn: document.getElementById('bugReportRemoveAttachBtn'),
  bugReportError: document.getElementById('bugReportError'),
  bugReportSendBtn: document.getElementById('bugReportSendBtn'),
  remoteAdminRow: document.getElementById('remoteAdminRow'),
  remoteAdminCheck: document.getElementById('remoteAdminCheck'),
  settingsModalTitle: document.querySelector('.settings-modal-title'),
  micMuteBtn: document.getElementById('micMuteBtn'),
  cameraBtn: document.getElementById('cameraBtn'),
  shareBtn: document.getElementById('shareBtn'),
  interactiveShareBtn: document.getElementById('interactiveShareBtn'),
  clipBtn: document.getElementById('clipBtn'),
  clipEnabledCheck: document.getElementById('clipEnabledCheck'),
  clipSaveDirInput: document.getElementById('clipSaveDirInput'),
  clipChooseDirBtn: document.getElementById('clipChooseDirBtn'),
  clipResetDirBtn: document.getElementById('clipResetDirBtn'),
  leaveBtn: document.getElementById('leaveBtn'),
  inviteBtn: document.getElementById('inviteBtn'),
  toast: document.getElementById('toast'),
  focusBar: document.getElementById('focusBar'),
  focusCount: document.getElementById('focusCount'),
  focusBtn: document.getElementById('focusBtn'),
  grid: document.getElementById('grid'),
  stageArea: document.getElementById('stageArea'),
  stageEmpty: document.getElementById('stageEmpty'),
  stageShareBtn: document.getElementById('stageShareBtn'),
  leaveCallBtn: document.getElementById('leaveCallBtn'),
  settingsBtn: document.getElementById('settingsBtn'),
  settingsModal: document.getElementById('settingsModal'),
  settingsModalClose: document.getElementById('settingsModalClose'),
  settingsDoneBtn: document.getElementById('settingsDoneBtn'),
  settingsTabTitle: document.getElementById('settingsTabTitle'),
  settingsTabSub: document.getElementById('settingsTabSub'),
  settingsTabs: document.querySelectorAll('.settings-tab'),
  settingsTabPanels: document.querySelectorAll('.settings-tab-panel'),
  micTestBtn: document.getElementById('micTestBtn'),
  micMeterFill: document.getElementById('micMeterFill'),
  cameraPreviewVideo: document.getElementById('cameraPreviewVideo'),
  cameraPreviewEmptyHint: document.getElementById('cameraPreviewEmptyHint'),
  autoMicCheck: document.getElementById('autoMicCheck'),
  pushToTalkCheck: document.getElementById('pushToTalkCheck'),
  pushToTalkBindBtn: document.getElementById('pushToTalkBindBtn'),
  autoDuckingCheck: document.getElementById('autoDuckingCheck'),
  rnnoiseCheck: document.getElementById('rnnoiseCheck'),
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
  onboardingModal: document.getElementById('onboardingModal'),
  onboardingOkBtn: document.getElementById('onboardingOkBtn'),
  settingsNotifDot: document.getElementById('settingsNotifDot'),
  generalTabNotifDot: document.getElementById('generalTabNotifDot'),
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
// marca o instante exato em que uma conta NOVA é criada (signInAnonymously
// pelo form de apelido) - é a única forma de login que cria usuário do zero,
// então é o sinal certo de "pessoa nova entrando por aqui pela primeira
// vez", independente do PC/instalação. Consumido e resetado em showLobbyScreen.
let justCreatedAccount = false;

function showAuthScreen() {
  if (activeVoiceChannel) leaveRoom(); // fecha mic/camera/tela e desconecta do Realtime antes de deslogar
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
  if (globalPresenceChannel) {
    window.supabaseClient.removeChannel(globalPresenceChannel);
    globalPresenceChannel = null;
  }
  if (attachmentSignalChannel) {
    window.supabaseClient.removeChannel(attachmentSignalChannel);
    attachmentSignalChannel = null;
  }
  for (const entry of outboundAttachChannels.values()) window.supabaseClient.removeChannel(entry.channel);
  outboundAttachChannels.clear();
  closeDm();
  friendsCache = [];
  pendingIncoming = [];
  pendingOutgoing = [];
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
  goHome();
  if (currentProfile) {
    els.userBarName.textContent = currentProfile.display_name || 'Convidado';
    els.userBarAvatar.src = currentProfile.avatar_url || DEFAULT_AVATAR;
  }
  fetchMyServers();
  joinGlobalPresence();
  joinFriendRequestsRealtime();
  joinAttachmentSignaling();
  loadIceServers();
  fetchFriends();
  startLastSeenLoop();
  if (justCreatedAccount) {
    justCreatedAccount = false;
    els.onboardingModal.classList.remove('hidden');
  }
  if (pendingInviteCode) {
    const code = pendingInviteCode;
    pendingInviteCode = null;
    joinServerByCode(code).then(() => showToast('Você entrou no servidor pelo link de convite!')).catch((err) => {
      showToast(err.message || 'Link de convite inválido.', 3500);
    });
  }
}

// "Visto há Xh" pros amigos offline: atualiza last_seen_at periodicamente
// enquanto o app estiver aberto (não só ao sair "limpo") - assim mesmo um
// fechamento abrupto (crash, Gerenciador de Tarefas) deixa um último
// horário razoavelmente fresco, só com uma margem de até 1 minuto de atraso.
let lastSeenTimer = null;
function touchLastSeen() {
  if (!currentUser) return;
  window.supabaseClient.from('profiles').update({ last_seen_at: new Date().toISOString() }).eq('id', currentUser.id).then(() => {});
}
function startLastSeenLoop() {
  if (lastSeenTimer) return;
  touchLastSeen();
  lastSeenTimer = setInterval(touchLastSeen, 60000);
}

function formatLastSeen(iso) {
  if (!iso) return 'nunca visto';
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'visto agora';
  if (mins < 60) return `visto há ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `visto há ${hours}h`;
  const days = Math.floor(hours / 24);
  return `visto há ${days}d`;
}

els.authForm.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const displayName = els.authDisplayNameInput.value.trim();
  if (!displayName) return;
  els.authError.classList.add('hidden');
  els.authSubmitBtn.disabled = true;
  try {
    justCreatedAccount = true;
    const { error } = await window.supabaseClient.auth.signInAnonymously({
      options: { data: { display_name: displayName } },
    });
    if (error) throw error;
    // onAuthStateChange cuida do resto (busca o perfil, mostra o lobby).
  } catch (err) {
    justCreatedAccount = false;
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
    // o supabase-js reemite esse evento sozinho sempre que a janela
    // recupera o foco (alt-tab, abrir um <input type=file>, etc.) pra
    // revalidar/renovar o token - NAO e' um login novo. Só faz o reset
    // de tela (showLobbyScreen -> volta pra Home, desseleciona servidor,
    // derrubava até a chamada de voz visualmente) na PRIMEIRA vez que
    // esse usuário loga nessa sessão do app.
    const isNewLogin = !currentUser || currentUser.id !== session.user.id;
    currentUser = session.user;
    currentProfile = await fetchMyProfile(currentUser.id);
    updateAccountEmailStatus();
    if (isNewLogin) {
      showLobbyScreen();
    } else if (currentProfile) {
      els.userBarName.textContent = currentProfile.display_name || 'Convidado';
      els.userBarAvatar.src = currentProfile.avatar_url || DEFAULT_AVATAR;
    }
  } else {
    currentUser = null;
    currentProfile = null;
    showAuthScreen();
  }
});

/* ---------------- entrar/vincular por e-mail (código, sem senha) ----------------
   Dois modos reaproveitando o mesmo modal:
   - 'link': vincula um e-mail à conta JÁ LOGADA (anônima vira permanente, mesmo
     id, mesmos dados) - usa updateUser({email}) + verifyOtp(type:'email_change').
   - 'login': entra numa conta que já tem e-mail vinculado, sem estar logado
     ainda - usa signInWithOtp({email, shouldCreateUser:false}) +
     verifyOtp(type:'email'). onAuthStateChange cuida de trocar de usuário.
   Os dois fluxos mandam só um CÓDIGO por e-mail (sem link) - os templates
   correspondentes no Supabase foram configurados pra isso de propósito,
   porque um link exigiria um site/redirect funcionando, que esse app não tem. */

function friendlyAuthError(message) {
  const map = {
    'Signups not allowed for otp': 'Esse e-mail ainda não tem conta vinculada aqui. Se for a primeira vez, vincula o e-mail pelas Configurações antes de tentar entrar com ele.',
    'Token has expired or is invalid': 'Código inválido ou expirado. Confere se digitou certo ou pede um novo código.',
    'User already registered': 'Esse e-mail já está vinculado a outra conta.',
  };
  return map[message] || message;
}

function updateAccountEmailStatus() {
  if (!els.accountEmailStatus) return;
  els.accountEmailStatus.textContent = currentUser && currentUser.email ? currentUser.email : 'Nenhum';
  const needsEmail = !!(currentUser && !currentUser.email);
  els.settingsNotifDot.classList.toggle('hidden', !needsEmail);
  els.generalTabNotifDot.classList.toggle('hidden', !needsEmail);
}

let emailAuthMode = 'login';
let emailAuthPendingEmail = '';

function openEmailAuthModal(mode) {
  emailAuthMode = mode;
  emailAuthPendingEmail = '';
  els.emailAuthTitle.textContent = mode === 'link' ? 'Vincular e-mail' : 'Entrar com e-mail';
  els.emailAuthEmailHint.textContent =
    mode === 'link'
      ? 'Vincula um e-mail a essa conta pra nunca mais perder seus dados.'
      : 'Entra numa conta que já tem e-mail vinculado.';
  els.emailAuthEmailInput.value = '';
  els.emailAuthCodeInput.value = '';
  els.emailAuthError.classList.add('hidden');
  els.emailAuthCodeError.classList.add('hidden');
  els.emailAuthStepEmail.classList.remove('hidden');
  els.emailAuthStepCode.classList.add('hidden');
  els.emailAuthModal.classList.remove('hidden');
  els.emailAuthEmailInput.focus();
}
function closeEmailAuthModal() {
  els.emailAuthModal.classList.add('hidden');
}
els.emailAuthClose.addEventListener('click', closeEmailAuthModal);
els.openLinkEmailBtn.addEventListener('click', () => openEmailAuthModal('link'));
els.authEmailLoginLink.addEventListener('click', () => openEmailAuthModal('login'));

async function sendEmailAuthCode(email) {
  if (emailAuthMode === 'link') {
    const { error } = await window.supabaseClient.auth.updateUser({ email });
    if (error) throw error;
  } else {
    const { error } = await window.supabaseClient.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    });
    if (error) throw error;
  }
}

els.emailAuthSendBtn.addEventListener('click', async () => {
  const email = els.emailAuthEmailInput.value.trim();
  if (!email) return;
  els.emailAuthError.classList.add('hidden');
  els.emailAuthSendBtn.disabled = true;
  try {
    await sendEmailAuthCode(email);
    emailAuthPendingEmail = email;
    els.emailAuthEmailShown.textContent = email;
    els.emailAuthStepEmail.classList.add('hidden');
    els.emailAuthStepCode.classList.remove('hidden');
    els.emailAuthCodeInput.focus();
  } catch (err) {
    els.emailAuthError.textContent = friendlyAuthError(err.message) || 'Não consegui enviar o código.';
    els.emailAuthError.classList.remove('hidden');
  } finally {
    els.emailAuthSendBtn.disabled = false;
  }
});

els.emailAuthResendBtn.addEventListener('click', async () => {
  els.emailAuthResendBtn.disabled = true;
  try {
    await sendEmailAuthCode(emailAuthPendingEmail);
    showToast('Código reenviado!', 2000);
  } catch (err) {
    els.emailAuthCodeError.textContent = friendlyAuthError(err.message) || 'Não consegui reenviar.';
    els.emailAuthCodeError.classList.remove('hidden');
  } finally {
    els.emailAuthResendBtn.disabled = false;
  }
});

els.emailAuthConfirmBtn.addEventListener('click', async () => {
  const code = els.emailAuthCodeInput.value.trim();
  if (!code) return;
  els.emailAuthCodeError.classList.add('hidden');
  els.emailAuthConfirmBtn.disabled = true;
  try {
    if (emailAuthMode === 'link') {
      const { error } = await window.supabaseClient.auth.verifyOtp({
        email: emailAuthPendingEmail,
        token: code,
        type: 'email_change',
      });
      if (error) throw error;
      showToast('E-mail vinculado com sucesso!');
      updateAccountEmailStatus();
    } else {
      const { error } = await window.supabaseClient.auth.verifyOtp({
        email: emailAuthPendingEmail,
        token: code,
        type: 'email',
      });
      if (error) throw error;
      showToast('Login feito com sucesso!');
    }
    closeEmailAuthModal();
  } catch (err) {
    els.emailAuthCodeError.textContent = friendlyAuthError(err.message) || 'Código inválido ou expirado.';
    els.emailAuthCodeError.classList.remove('hidden');
  } finally {
    els.emailAuthConfirmBtn.disabled = false;
  }
});

// STUN públicos (gratuitos) como ponto de partida/fallback — resolve o caso
// em que os dois lados conseguem ser alcançados direto (maioria das redes
// domésticas). A lista de verdade (com TURN via Metered.ca incluído) vem do
// banco (get_ice_servers(), credenciais no Vault - nunca hardcoded aqui,
// senão qualquer um lendo o repositório público conseguia gastar a cota
// grátis) assim que loadIceServers() resolver, logo após o login. Sem TURN,
// NATs mais restritos (CGNAT, wifi corporativo, 4G de operadora) não
// conseguem conectar - era a causa provável de "tela preta só pra alguns
// amigos" e "tive que sair e entrar de novo pra ver a transmissão".
let ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

async function loadIceServers() {
  try {
    const { data, error } = await window.supabaseClient.rpc('get_ice_servers');
    if (error) throw error;
    if (Array.isArray(data) && data.length) ICE_SERVERS = data;
  } catch (err) {
    console.warn('não consegui carregar o servidor TURN, usando só STUN:', err);
  }
}

const HISTORY_KEY = 'tela-radmin:app-history';

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

// falha explícita depois de N segundos em vez de ficar esperando pra
// sempre uma promise que travou (rede caiu no meio, Storage não respondeu
// etc.) - sem isso um upload travado deixava a UI "presa" sem nenhum
// aviso, parecia bug sem dar erro nenhum.
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Demorou demais (${label}) - confere sua internet e tenta de novo.`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function resizeImageToBlob(file, width, height) {
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
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Falha ao processar imagem'))), 'image/jpeg', 0.85);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

// path FIXO (sem timestamp) de propósito: upsert:true só sobrescreve de
// verdade se o caminho for sempre o mesmo - com timestamp cada troca de
// foto deixava a versão anterior pra trás pra sempre, vazando aos pouco
// o 1GB grátis do Storage. cacheControl baixo (60s, bem abaixo do padrão
// de 3600s do Supabase Storage) pra quem NÃO foi quem trocou (ex: o resto
// da galera vendo seu avatar na lista) ver a foto nova rapidinho sem
// precisar de timestamp por URL - quem trocou já vê a nova na hora de
// qualquer jeito, via o "?t=" que quem chama isso bota na própria tela.
async function uploadProfileImage(blob, folder) {
  const path = `${folder}/${currentUser.id}.jpg`;
  const { error: uploadError } = await window.supabaseClient.storage
    .from('avatars')
    .upload(path, blob, { upsert: true, contentType: 'image/jpeg', cacheControl: '60' });
  if (uploadError) throw uploadError;
  const { data } = window.supabaseClient.storage.from('avatars').getPublicUrl(path);
  return data.publicUrl;
}

/* ---------------- reportar um bug (descrição + print opcional por e-mail) ----------------
   Diferente de resizeImageToBlob (que recorta em quadrado pra avatar), aqui só limita o
   lado maior pra não mandar um print de 4K inteiro — mantém a proporção original, sem
   cortar nada, porque o print é pra servir de evidência, não de preview bonitinho. */
function resizeScreenshotToBlob(file, maxDim) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(img.src);
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Falha ao processar imagem'))), 'image/jpeg', 0.85);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

let bugReportAttachment = null;

function openBugReportModal() {
  els.bugReportText.value = '';
  bugReportAttachment = null;
  els.bugReportPreviewWrap.classList.add('hidden');
  els.bugReportError.classList.add('hidden');
  els.bugReportModal.classList.remove('hidden');
  els.bugReportText.focus();
}
function closeBugReportModal() {
  els.bugReportModal.classList.add('hidden');
}
els.openBugReportBtn.addEventListener('click', openBugReportModal);
els.bugReportModalClose.addEventListener('click', closeBugReportModal);

function setBugReportAttachment(file) {
  bugReportAttachment = file;
  els.bugReportPreviewImg.src = URL.createObjectURL(file);
  els.bugReportPreviewWrap.classList.remove('hidden');
}
els.bugReportAttachBtn.addEventListener('click', () => els.bugReportFileInput.click());
els.bugReportFileInput.addEventListener('change', () => {
  const file = els.bugReportFileInput.files[0];
  if (file) setBugReportAttachment(file);
  els.bugReportFileInput.value = '';
});
els.bugReportRemoveAttachBtn.addEventListener('click', () => {
  bugReportAttachment = null;
  els.bugReportPreviewWrap.classList.add('hidden');
});
els.bugReportText.addEventListener('paste', (ev) => {
  const items = ev.clipboardData && ev.clipboardData.items;
  if (!items) return;
  for (const item of items) {
    if (item.type && item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) {
        setBugReportAttachment(file);
        ev.preventDefault();
      }
      break;
    }
  }
});

async function notifyBugReportWebhook(reportId, screenshotPath) {
  let screenshotUrl = null;
  if (screenshotPath) {
    const { data, error } = await window.supabaseClient.storage
      .from('bug-reports')
      .createSignedUrl(screenshotPath, 60 * 60 * 24 * 7);
    if (error) console.error('não consegui gerar o link do print do bug report:', error);
    screenshotUrl = data && data.signedUrl;
  }
  // a URL do webhook do Discord fica só no banco (function notify_bug_report,
  // ver supabase/migration-bug-report-webhook-server-side.sql) - nunca no
  // client, que é servido pra qualquer um.
  const { error: rpcErr } = await window.supabaseClient.rpc('notify_bug_report', {
    report_id: reportId,
    screenshot_url: screenshotUrl,
  });
  if (rpcErr) throw rpcErr;
}

els.bugReportSendBtn.addEventListener('click', async () => {
  const description = els.bugReportText.value.trim();
  if (!description) {
    els.bugReportError.textContent = 'Descreve o que aconteceu antes de enviar.';
    els.bugReportError.classList.remove('hidden');
    return;
  }
  els.bugReportError.classList.add('hidden');
  els.bugReportSendBtn.disabled = true;
  els.bugReportSendBtn.textContent = 'Enviando...';
  try {
    let screenshotPath = null;
    if (bugReportAttachment) {
      const resized = await resizeScreenshotToBlob(bugReportAttachment, 1600).catch(() => bugReportAttachment);
      screenshotPath = `${currentUser.id}/${Date.now()}.jpg`;
      const { error: upErr } = await window.supabaseClient.storage
        .from('bug-reports')
        .upload(screenshotPath, resized, { contentType: 'image/jpeg' });
      if (upErr) throw upErr;
    }
    const appVersion = await fetchCurrentVersion();
    const { data: row, error: insertErr } = await window.supabaseClient
      .from('bug_reports')
      .insert({
        reporter_id: currentUser.id,
        reporter_name: state.myName,
        description,
        app_version: appVersion,
        platform: isElectron ? 'electron' : 'web',
        screenshot_path: screenshotPath,
      })
      .select('id')
      .single();
    if (insertErr) throw insertErr;

    // o insert já valeu (fica salvo no banco mesmo se o aviso falhar) - o
    // webhook só dispara a notificação, não é o que garante o registro.
    notifyBugReportWebhook(row.id, screenshotPath)
      .catch((err) => console.error('aviso do bug report falhou (o report já foi salvo mesmo assim):', err));

    showToast('Bug reportado, obrigado por avisar!');
    closeBugReportModal();
  } catch (err) {
    console.error('bug report falhou', err);
    els.bugReportError.textContent = 'Não consegui enviar agora. Tenta de novo em alguns segundos.';
    els.bugReportError.classList.remove('hidden');
  } finally {
    els.bugReportSendBtn.disabled = false;
    els.bugReportSendBtn.textContent = 'Enviar';
  }
});

/* ---------------- modal de perfil (editar o seu / ver o de alguém) ---------------- */

let profileModalTargetId = null;

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

function openProfileModal({ readOnly, userId, name, handle, avatar, banner, bio, mutualServers, mutualFriends, friendStatus }) {
  profileModalTargetId = readOnly ? userId : null;
  els.profileModal.classList.toggle('readonly', readOnly);
  els.profileModal.classList.remove('hidden');
  els.profileModalName.textContent = name || 'Convidado';
  els.profileModalHandle.textContent = readOnly && handle ? `· ${handle}` : '';
  els.modalAvatarPreview.src = avatar || DEFAULT_AVATAR;
  renderProfileBanner(els.profileBanner, banner);
  els.bioInput.value = bio || '';
  els.bioInput.readOnly = !!readOnly;
  els.bioInput.placeholder = readOnly ? 'Essa pessoa não escreveu uma bio.' : 'Fale um pouco sobre você...';

  if (!readOnly) {
    els.profileNameInput.value = currentProfile ? currentProfile.display_name || '' : '';
    renderProfileHistory();
    return;
  }

  const serversText = mutualServers && mutualServers.length ? `Servidores em comum: ${mutualServers.join(', ')}` : '';
  const friendsText = mutualFriends && mutualFriends.length ? `Amigos em comum: ${mutualFriends.join(', ')}` : '';
  els.profileMutualServers.textContent = serversText;
  els.profileMutualFriends.textContent = friendsText;
  els.profileMutualSection.classList.toggle('hidden', !serversText && !friendsText);

  els.profileActionsRow.classList.remove('hidden');
  els.profileAddFriendBtn.classList.toggle('hidden', friendStatus !== 'none');
  els.profilePendingBtn.classList.toggle('hidden', friendStatus !== 'pending_out');
  els.profileAcceptFriendBtn.classList.toggle('hidden', friendStatus !== 'pending_in');
  els.profileMessageBtn.classList.toggle('hidden', friendStatus !== 'friends');
  els.profileRemoveFriendBtn.classList.toggle('hidden', friendStatus !== 'friends');
}

function closeProfileModal() {
  els.profileModal.classList.add('hidden');
  profileModalTargetId = null;
}

function openOwnProfile() {
  openProfileModal({
    readOnly: false,
    name: currentProfile ? currentProfile.display_name : 'Convidado',
    avatar: currentProfile ? currentProfile.avatar_url : null,
    banner: currentProfile ? currentProfile.banner_url : null,
    bio: currentProfile ? currentProfile.bio : '',
  });
}

// busca perfil + servidores em comum + amigos em comum (RPC, ve' so' a
// intersecao - a policy de friend_requests nao deixa listar os amigos de
// outra pessoa direto) e abre o popout com os botoes certos pro estado
// atual (nenhum vinculo / pedido enviado / pedido recebido / ja' amigos).
async function openUserProfile(userId) {
  if (!userId || userId === currentUser.id) {
    openOwnProfile();
    return;
  }
  await fetchFriends();
  const { data: profile, error } = await window.supabaseClient
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  if (error || !profile) {
    console.error('Erro ao buscar perfil:', error);
    return;
  }

  let mutualServerNames = [];
  const myServerIds = myServers.map((s) => s.id);
  if (myServerIds.length) {
    const { data: sm } = await window.supabaseClient
      .from('server_members')
      .select('server_id, servers(name)')
      .eq('user_id', userId)
      .in('server_id', myServerIds);
    mutualServerNames = (sm || []).map((r) => r.servers && r.servers.name).filter(Boolean);
  }

  const { data: mutualFriendsData } = await window.supabaseClient.rpc('mutual_friends', { other: userId });

  openProfileModal({
    readOnly: true,
    userId,
    name: profile.display_name || 'Convidado',
    handle: (profile.id || '').slice(0, 8),
    avatar: profile.avatar_url,
    banner: profile.banner_url,
    bio: profile.bio,
    mutualServers: mutualServerNames,
    mutualFriends: (mutualFriendsData || []).map((p) => p.display_name).filter(Boolean),
    friendStatus: friendStatusOf(userId),
  });
}

els.userBarProfileBtn.addEventListener('click', openOwnProfile);
els.profileModalClose.addEventListener('click', closeProfileModal);
els.profileModal.addEventListener('click', (ev) => {
  if (ev.target === els.profileModal) closeProfileModal();
});

els.profileNameInput.addEventListener('change', async () => {
  const name = (els.profileNameInput.value || 'Convidado').trim() || 'Convidado';
  els.profileNameInput.value = name;
  const { error } = await window.supabaseClient.from('profiles').update({ display_name: name }).eq('id', currentUser.id);
  if (error) { console.error('Erro ao salvar apelido:', error); return; }
  currentProfile = { ...currentProfile, display_name: name };
  els.profileModalName.textContent = name;
  els.userBarName.textContent = name;
});

let avatarUploadBusy = false;
els.modalAvatarInput.addEventListener('change', async (ev) => {
  const file = ev.target.files[0];
  ev.target.value = '';
  if (!file) return;
  // trava contra clique duplo/segunda seleção enquanto a primeira ainda
  // está subindo - sem isso dava pra disparar dois uploads concorrentes
  // e o mais lento "vencer" por último, parecendo que a troca não pegou.
  if (avatarUploadBusy) {
    showToast('Já tem uma foto sendo enviada, espera terminar.', 2000);
    return;
  }
  avatarUploadBusy = true;
  els.modalAvatarLabel.classList.add('uploading');
  try {
    const blob = await resizeImageToBlob(file, 256, 256);
    const url = await withTimeout(uploadProfileImage(blob, 'profile-icons'), 20000, 'enviar foto');
    const { error } = await window.supabaseClient.from('profiles').update({ avatar_url: url }).eq('id', currentUser.id);
    if (error) throw error;
    currentProfile = { ...currentProfile, avatar_url: url };
    // "?t=" so' pra furar o cache do navegador NA SUA TELA agora - o que
    // fica salvo no banco (acima) e' a URL limpa, sem isso
    const freshUrl = `${url}?t=${Date.now()}`;
    els.modalAvatarPreview.src = freshUrl;
    els.userBarAvatar.src = freshUrl;
  } catch (err) {
    console.error('Erro ao trocar avatar:', err);
    showToast(err.message || 'Não deu pra trocar a foto.', 3500);
  } finally {
    avatarUploadBusy = false;
    els.modalAvatarLabel.classList.remove('uploading');
  }
});

els.bannerInput.addEventListener('change', async (ev) => {
  const file = ev.target.files[0];
  ev.target.value = '';
  if (!file) return;
  try {
    const blob = await resizeImageToBlob(file, 600, 180);
    const url = await uploadProfileImage(blob, 'profile-banners');
    const { error } = await window.supabaseClient.from('profiles').update({ banner_url: url }).eq('id', currentUser.id);
    if (error) throw error;
    currentProfile = { ...currentProfile, banner_url: url };
    renderProfileBanner(els.profileBanner, `${url}?t=${Date.now()}`);
  } catch (err) {
    console.error('Erro ao trocar banner:', err);
    showToast('Não deu pra trocar o banner.', 2500);
  }
});

let bioSaveTimer = null;
els.bioInput.addEventListener('input', () => {
  if (els.bioInput.readOnly) return;
  const bio = els.bioInput.value;
  clearTimeout(bioSaveTimer);
  bioSaveTimer = setTimeout(async () => {
    const { error } = await window.supabaseClient.from('profiles').update({ bio }).eq('id', currentUser.id);
    if (!error) currentProfile = { ...currentProfile, bio };
  }, 600);
});

els.profileAddFriendBtn.addEventListener('click', async () => {
  if (!profileModalTargetId) return;
  await sendFriendRequest(profileModalTargetId);
  openUserProfile(profileModalTargetId);
});
els.profileAcceptFriendBtn.addEventListener('click', async () => {
  if (!profileModalTargetId) return;
  await acceptFriendRequestWith(profileModalTargetId);
  openUserProfile(profileModalTargetId);
});
els.profileRemoveFriendBtn.addEventListener('click', async () => {
  if (!profileModalTargetId) return;
  if (!confirm('Remover essa pessoa da sua lista de amigos?')) return;
  await deleteFriendRequestWith(profileModalTargetId);
  openUserProfile(profileModalTargetId);
});
els.profileMessageBtn.addEventListener('click', () => {
  if (!profileModalTargetId) return;
  const id = profileModalTargetId;
  closeProfileModal();
  openDm(id);
});

function tileKey(id, source) {
  return `${id}:${source}`;
}

/* ---------------- chamada: LiveKit Cloud (SFU) ----------------
   Cada canal de voz vira uma Room do LiveKit (nome da sala =
   'voice-<channelId>'). O token é gerado no Postgres (RPC
   get_livekit_token, credenciais do LiveKit no Vault) e só autoriza
   entrar na sala de um canal do qual a pessoa é membro de verdade.
   Publicar uma fonte (tela/câmera/mic) = 1 publishTrack só - o SFU
   redistribui pra todo mundo, diferente da mesh antiga (1
   RTCPeerConnection por espectador por fonte, O(N²) - o FPS de quem
   transmitia caía com 3+ espectadores porque tava codificando a mesma
   tela várias vezes em paralelo).

   A sidebar "Na call"/badge "AO VIVO" continua vindo do canal
   `server:<serverId>` (serverPresenceChannel/retrackServerPresence), que
   é totalmente independente disso - não muda nada aqui.

   adaptiveStream fica DESLIGADO de propósito: ele exige chamar
   remoteTrack.attach(videoElement) pra funcionar direito (senão o vídeo
   remoto pode nunca começar a tocar) - e addOrUpdateTile/os tiles desse
   app são agnósticos à origem do stream, só fazem `video.srcObject =
   stream`, sem passar pelo attach() do SDK. dynacast continua ligado
   (reduz os layers de simulcast que ninguém tá assistindo do lado do
   servidor - é a parte que resolve o problema de FPS de origem, sem
   precisar de adaptiveStream pra isso). */

let lkRoom = null;
const remoteStreams = new Map(); // tileKey -> MediaStream (vídeo e áudio da tela chegam como 2 publishes separados, remonta aqui)
// tileKey -> Track de vídeo do LiveKit (local ou remota) pra ler estatística
// de verdade via getRTCStatsReport() - badge de resolução/fps real e o
// inspetor de conexão (ver pollTileStats) usam essa referência.
const tileVideoTracks = new Map();
const tileStatsPrev = new Map(); // tileKey -> { bytes, ts } (pra calcular kbps por delta)
const tileStatsLatest = new Map(); // tileKey -> snapshot pro painel do inspetor

function lkSourceToLocal(source) {
  const LK = window.LivekitClient;
  if (!LK) return null;
  if (source === LK.Track.Source.Camera) return 'camera';
  if (source === LK.Track.Source.Microphone) return 'mic';
  if (source === LK.Track.Source.ScreenShare || source === LK.Track.Source.ScreenShareAudio) return 'screen';
  return null;
}
function localSourceToLkSource(source) {
  const LK = window.LivekitClient;
  if (source === 'camera') return LK.Track.Source.Camera;
  if (source === 'mic') return LK.Track.Source.Microphone;
  if (source === 'screen') return LK.Track.Source.ScreenShare;
  return LK.Track.Source.Unknown;
}

function memberInfo(userId) {
  const m = serverMembersCache.find((x) => x.user_id === userId);
  const p = (m && m.profiles) || {};
  return { name: p.display_name || 'Convidado', avatar: p.avatar_url || null };
}

async function fetchLiveKitToken(channelId) {
  const { data, error } = await window.supabaseClient.rpc('get_livekit_token', { p_channel_id: channelId });
  if (error) throw error;
  return data;
}

function getOrCreateRemoteStream(key) {
  let stream = remoteStreams.get(key);
  if (!stream) {
    stream = new MediaStream();
    remoteStreams.set(key, stream);
  }
  return stream;
}

function handleTrackSubscribed(track, publication, participant) {
  const localSource = lkSourceToLocal(publication.source);
  if (!localSource) return;
  const key = tileKey(participant.identity, localSource);
  const stream = getOrCreateRemoteStream(key);
  stream.addTrack(track.mediaStreamTrack);
  if (track.kind === 'video') tileVideoTracks.set(key, track);
  const { name, avatar } = memberInfo(participant.identity);
  addOrUpdateTile(key, name, avatar, stream, false, localSource);
  if (localSource === 'screen' && !viewerClippers.has(key)) {
    const clipper = startRollingClip(stream, 30);
    if (clipper) viewerClippers.set(key, clipper);
  }
}

function handleTrackUnsubscribed(track, publication, participant) {
  const localSource = lkSourceToLocal(publication.source);
  if (!localSource) return;
  const key = tileKey(participant.identity, localSource);
  const stream = remoteStreams.get(key);
  if (stream) stream.removeTrack(track.mediaStreamTrack);
  if (track.kind === 'video' && tileVideoTracks.get(key) === track) tileVideoTracks.delete(key);
  // só derruba o tile se não sobrou nenhuma track viva pra essa fonte - a
  // tela manda vídeo e áudio como publishes separados, um pode sumir
  // antes do outro (ex: a pessoa parou só o áudio por algum motivo).
  if (!stream || stream.getTracks().length === 0) {
    const clipper = viewerClippers.get(key);
    if (clipper) { clipper.stop(); viewerClippers.delete(key); }
    removeTile(key);
    remoteStreams.delete(key);
    tileStatsPrev.delete(key);
    tileStatsLatest.delete(key);
    updateStageMode();
  }
}

function removeAllTilesFor(identity) {
  for (const source of ['screen', 'camera', 'mic']) {
    const key = tileKey(identity, source);
    const clipper = viewerClippers.get(key);
    if (clipper) { clipper.stop(); viewerClippers.delete(key); }
    removeTile(key);
    remoteStreams.delete(key);
  }
  updateStageMode();
}

function updatePeopleCount() {
  const count = lkRoom ? lkRoom.remoteParticipants.size + 1 : 0;
  els.peopleCount.textContent = `· ${count} na sala`;
}

// handshake de consentimento + input do controle remoto (modo admin) -
// registrado aqui, despachado pelo handler único de DataReceived da Room
// (ver setupLiveKitRoomEvents). Implementação completa mais abaixo, perto
// do resto do subsistema de controle remoto.
const controlHandlers = { onDataReceived: null };

function setupLiveKitRoomEvents(room) {
  const LK = window.LivekitClient;
  room.on(LK.RoomEvent.TrackSubscribed, handleTrackSubscribed);
  room.on(LK.RoomEvent.TrackUnsubscribed, handleTrackUnsubscribed);
  room.on(LK.RoomEvent.ParticipantConnected, updatePeopleCount);
  room.on(LK.RoomEvent.ParticipantDisconnected, (participant) => {
    removeAllTilesFor(participant.identity);
    updatePeopleCount();
    if (controlHandlers.onParticipantDisconnected) controlHandlers.onParticipantDisconnected(participant.identity);
  });
  room.on(LK.RoomEvent.DataReceived, (payload, participant, kind, topic) => {
    if (topic === 'control' && controlHandlers.onDataReceived) controlHandlers.onDataReceived(payload, participant);
  });
  room.on(LK.RoomEvent.ActiveSpeakersChanged, (speakers) => {
    applyActiveSpeakerDucking(speakers.map((p) => p.identity));
  });
  room.on(LK.RoomEvent.Disconnected, (reason) => {
    if (lkRoom !== room) return;
    // O LiveKit já tenta reconectar sozinho por baixo dos panos
    // (RoomEvent.Reconnecting/Reconnected) antes de disparar Disconnected -
    // chegar aqui significa que ele desistiu, ou que o motivo é definitivo
    // (identidade duplicada, expulso, sala apagada/fechada). Mesmo nesses
    // casos ainda chamamos leaveRoom() pra limpar o estado direito, mas
    // diferenciar o motivo evita um toast de pânico quando foi só queda de
    // rede - e deixa claro que não foi por engano.
    const DR = LK.DisconnectReason;
    const terminal = reason === DR.DUPLICATE_IDENTITY || reason === DR.PARTICIPANT_REMOVED ||
      reason === DR.ROOM_DELETED || reason === DR.ROOM_CLOSED;
    if (!terminal && reason !== DR.CLIENT_INITIATED) {
      showToast('A conexão da call caiu. Entra de novo quando a rede voltar.', 4000);
    }
    leaveRoom();
  });
}

const SETTINGS_KEY = 'tela-radmin:settings';
function loadSettings() {
  const defaults = {
    resolution: '1920x1080',
    fps: 30,
    noiseSuppression: true,
    rnnoiseEnabled: false,
    bandwidthKbps: null,
    hideCursor: true,
    micDeviceId: '',
    camDeviceId: '',
    speakerDeviceId: '',
    autoMic: true,
    pushToTalkEnabled: false,
    pushToTalkBind: null, // { type: 'key', code: 'KeyT', label: 'T' } ou { type: 'mouse', button: 3, label: 'Botão lateral do mouse' }
    autoDuckingEnabled: false,
    permanentlyMutedApps: [],
    micMuted: false,
    soundboardVolume: 70,
    cameraOverlayEnabled: false,
    chatNotifications: true,
    remoteAdminEnabled: false,
    theme: 'azul',
    clipEnabled: false,
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
  myId: null,
  myName: '',
  settings: loadSettings(),
  tiles: new Map(), // mesma chave -> { root, video, isSelf }
  pinned: new Set(), // chaves marcadas pra entrar juntas na tela cheia
  focusOverlay: null,
  focusIds: null,
  // `publications` guarda as LocalTrackPublication do LiveKit retornadas por
  // publishTrack - usado pra despublicar (unpublishLocalSource) e reaplicar
  // limite de banda (reapplyBandwidthLimit) sem precisar varrer PCs (não
  // existe mais 1 PC por espectador - é 1 publish só, o SFU distribui).
  screen: { sharing: false, displayStream: null, localTracks: [], publications: [], blackFrameStop: null, clipper: null, clipperDownscale: null },
  camera: { sharing: false, camStream: null, localTracks: [], publications: [] },
  mic: { sharing: false, micStream: null, localTracks: [], publications: [] },
};

/* ---------------- configurações de transmissão (resolução/fps/ruído) ---------------- */

els.resolutionSelect.value = state.settings.resolution;
els.fpsSelect.value = String(state.settings.fps);
els.noiseSuppressionCheck.checked = state.settings.noiseSuppression;
els.bandwidthSelect.value = state.settings.bandwidthKbps ? String(state.settings.bandwidthKbps) : 'auto';
els.hideCursorCheck.checked = state.settings.hideCursor;
els.autoMicCheck.checked = state.settings.autoMic;
els.pushToTalkCheck.checked = state.settings.pushToTalkEnabled;
renderPushToTalkBindBtn();
els.autoDuckingCheck.checked = state.settings.autoDuckingEnabled;
els.rnnoiseCheck.checked = state.settings.rnnoiseEnabled;
els.chatNotificationsCheck.checked = state.settings.chatNotifications;
els.remoteAdminCheck.checked = state.settings.remoteAdminEnabled;
els.clipEnabledCheck.checked = state.settings.clipEnabled;
els.clipEnabledCheck.addEventListener('change', () => {
  state.settings.clipEnabled = els.clipEnabledCheck.checked;
  saveSettings();
  updateClipBtnVisibility();
});

// pasta de destino dos clipes - só existe de verdade no Electron (web
// puro não tem acesso a pasta nenhuma, sempre cai no download do
// navegador) - os botões ficam desabilitados fora dele.
async function refreshClipSaveDirDisplay() {
  if (!isElectron || !window.telaNative.getClipSaveDir) {
    els.clipSaveDirInput.value = '(pasta de downloads do navegador)';
    els.clipChooseDirBtn.disabled = true;
    els.clipResetDirBtn.disabled = true;
    return;
  }
  els.clipSaveDirInput.value = await window.telaNative.getClipSaveDir();
}
if (els.clipChooseDirBtn) {
  els.clipChooseDirBtn.addEventListener('click', async () => {
    if (!isElectron) return;
    const dir = await window.telaNative.chooseClipSaveDir();
    els.clipSaveDirInput.value = dir;
  });
  els.clipResetDirBtn.addEventListener('click', async () => {
    if (!isElectron) return;
    const dir = await window.telaNative.resetClipSaveDir();
    els.clipSaveDirInput.value = dir;
    showToast('Voltou pra pasta padrão.', 2000);
  });
}

// Tema: aplica já no carregamento (tela de login inclusive, não só depois
// de logar) - "azul" é o padrão de sempre e não precisa de atributo
// nenhum, as variáveis base do :root já são ele.
function applyTheme(theme) {
  if (theme && theme !== 'azul') document.documentElement.setAttribute('data-theme', theme);
  else document.documentElement.removeAttribute('data-theme');
  // a faixa própria do topo é CSS puro (var(--bg) etc.) - já reage ao tema
  // sozinha, sem precisar de nada aqui.
}
applyTheme(state.settings.theme);
if (els.themePicker) {
  els.themePicker.querySelectorAll('.theme-swatch-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.themeValue === state.settings.theme);
    btn.addEventListener('click', () => {
      state.settings.theme = btn.dataset.themeValue;
      saveSettings();
      applyTheme(state.settings.theme);
      els.themePicker.querySelectorAll('.theme-swatch-btn').forEach((b) => b.classList.toggle('active', b === btn));
    });
  });
}

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
els.rnnoiseCheck.addEventListener('change', () => {
  state.settings.rnnoiseEnabled = els.rnnoiseCheck.checked;
  saveSettings();
  // só vale pra próxima vez que o mic ligar - trocar o grafo de áudio com o
  // mic já no ar seria mais um lugar pra dar bug de reconexão (mesma lição
  // dos bugs de áudio já corrigidos essa sessão); mutar/desmutar e sair/
  // entrar da call já reconstrói o grafo do zero de qualquer forma.
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

/* ---------------- push-to-talk ----------------
   Reaproveita o GainNode de mute que já existia (micMix.micGain) em vez de
   parar/começar a publicação do mic a cada aperto - well mais barato e sem
   o risco de reconectar a track toda hora. Só funciona com a janela do
   Ribbit em foco: keydown/keyup/mousedown/mouseup do DOM só chegam aqui
   quando esta janela tem o foco do sistema operacional - detectar a tecla
   com OUTRO app/jogo em foco precisaria de um hook global de teclado (uma
   dependência nativa nova, tipo uiohook-napi, que mexe com o risco de
   antivírus reclamar de "keylogger") - ficou de fora de propósito por
   enquanto. */
let pushToTalkKeyHeld = false;

function applyMicGain() {
  if (!micMix.micGain) return;
  const manualMuted = state.settings.micMuted;
  const effective = manualMuted
    ? 0
    : (state.settings.pushToTalkEnabled ? (pushToTalkKeyHeld ? 1 : 0) : 1);
  micMix.micGain.gain.value = effective;
}

function bindMatchesEvent(bind, ev) {
  if (!bind) return false;
  if (bind.type === 'key') return ev.code === bind.code;
  if (bind.type === 'mouse') return ev.button === bind.button;
  return false;
}

function renderPushToTalkBindBtn() {
  const bind = state.settings.pushToTalkBind;
  els.pushToTalkBindBtn.textContent = bind ? bind.label : 'Não definida';
}

const MOUSE_BUTTON_LABELS = { 0: 'Botão esquerdo', 1: 'Botão do meio', 2: 'Botão direito', 3: 'Botão lateral (voltar)', 4: 'Botão lateral (avançar)' };

let recordingPushToTalkBind = false;
els.pushToTalkBindBtn.addEventListener('click', () => {
  if (recordingPushToTalkBind) return;
  recordingPushToTalkBind = true;
  els.pushToTalkBindBtn.textContent = 'Aperta uma tecla ou botão do mouse…';

  const finish = (bind) => {
    recordingPushToTalkBind = false;
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('mousedown', onMouse, true);
    if (bind) {
      state.settings.pushToTalkBind = bind;
      saveSettings();
    }
    renderPushToTalkBindBtn();
  };
  const onKey = (ev) => {
    ev.preventDefault();
    if (ev.code === 'Escape') { finish(null); return; }
    finish({ type: 'key', code: ev.code, label: ev.key.length === 1 ? ev.key.toUpperCase() : ev.code });
  };
  const onMouse = (ev) => {
    // botão esquerdo (0) fecharia o próprio clique que abriu a gravação -
    // não faz sentido como bind de PTT de qualquer forma (precisa do mouse
    // livre pra jogar/usar o PC), então só aceita os outros.
    if (ev.button === 0) return;
    ev.preventDefault();
    finish({ type: 'mouse', button: ev.button, label: MOUSE_BUTTON_LABELS[ev.button] || `Botão ${ev.button}` });
  };
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('mousedown', onMouse, true);
});

els.pushToTalkCheck.addEventListener('change', () => {
  state.settings.pushToTalkEnabled = els.pushToTalkCheck.checked;
  saveSettings();
  pushToTalkKeyHeld = false;
  applyMicGain();
});

window.addEventListener('keydown', (ev) => {
  if (!state.settings.pushToTalkEnabled || pushToTalkKeyHeld) return;
  if (bindMatchesEvent(state.settings.pushToTalkBind, ev)) {
    pushToTalkKeyHeld = true;
    applyMicGain();
  }
});
window.addEventListener('keyup', (ev) => {
  if (!state.settings.pushToTalkEnabled || !pushToTalkKeyHeld) return;
  if (bindMatchesEvent(state.settings.pushToTalkBind, ev)) {
    pushToTalkKeyHeld = false;
    applyMicGain();
  }
});
window.addEventListener('mousedown', (ev) => {
  if (!state.settings.pushToTalkEnabled || pushToTalkKeyHeld) return;
  if (bindMatchesEvent(state.settings.pushToTalkBind, ev)) {
    pushToTalkKeyHeld = true;
    applyMicGain();
  }
});
window.addEventListener('mouseup', (ev) => {
  if (!state.settings.pushToTalkEnabled || !pushToTalkKeyHeld) return;
  if (bindMatchesEvent(state.settings.pushToTalkBind, ev)) {
    pushToTalkKeyHeld = false;
    applyMicGain();
  }
});
// Solta a tecla sozinho se a janela perder o foco sem passar pelo keyup
// (ex: alt-tab segurando a tecla) - sem isso o microfone ficava "preso"
// aberto, transmitindo mudo de propósito errado até alguém apertar nada.
window.addEventListener('blur', () => {
  if (pushToTalkKeyHeld) {
    pushToTalkKeyHeld = false;
    applyMicGain();
  }
});

/* ---------------- auto-ducking ----------------
   Abaixa o volume de quem NÃO está falando enquanto alguém fala, sem mexer
   no volume manual que cada um já tem (multiplica em cima do volume ATUAL
   do elemento, guarda o valor de antes pra restaurar exatamente quando a
   pessoa para de falar). Só mexe no tile de MIC de cada um - câmera não
   carrega áudio nenhum, e abaixar o áudio da tela compartilhada de alguém
   só porque ela também está falando no mic seria estranho (duck é só
   "vozes concorrendo", não a tela/jogo da pessoa). */
const DUCK_FACTOR = 0.35;
const duckedMicBaseline = new Map(); // peerId (identity) -> volume de antes de duckar

function applyActiveSpeakerDucking(speakingIdentities) {
  if (!lkRoom) return;
  const speaking = new Set(speakingIdentities);
  const anyoneSpeaking = state.settings.autoDuckingEnabled && speaking.size > 0;
  for (const participant of lkRoom.remoteParticipants.values()) {
    const peerId = participant.identity;
    const micTile = state.tiles.get(tileKey(peerId, 'mic'));
    if (!micTile || !micTile.video) continue;
    const el = micTile.video;
    const shouldDuck = anyoneSpeaking && !speaking.has(peerId);
    if (shouldDuck && !duckedMicBaseline.has(peerId)) {
      duckedMicBaseline.set(peerId, el.volume);
      el.volume = el.volume * DUCK_FACTOR;
    } else if (!shouldDuck && duckedMicBaseline.has(peerId)) {
      el.volume = duckedMicBaseline.get(peerId);
      duckedMicBaseline.delete(peerId);
    }
  }
}

function restoreAllDuckedVolumes() {
  for (const [peerId, vol] of duckedMicBaseline) {
    const micTile = state.tiles.get(tileKey(peerId, 'mic'));
    if (micTile && micTile.video) micTile.video.volume = vol;
  }
  duckedMicBaseline.clear();
}

els.autoDuckingCheck.addEventListener('change', () => {
  state.settings.autoDuckingEnabled = els.autoDuckingCheck.checked;
  saveSettings();
  if (!state.settings.autoDuckingEnabled) restoreAllDuckedVolumes();
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
  // se a prévia nas Configurações está aberta com um stream próprio (não
  // reaproveitando a câmera de uma call em andamento), reabre com o novo device
  if (cameraPreviewOwned) {
    stopCameraPreview();
    startCameraPreview();
  }
});

/* ---------------- prévia de câmera e medidor de microfone (Configurações) ----------------
   Se a câmera já está ligada numa call, reaproveita o MESMO stream (sem
   pedir o dispositivo de novo - evita "câmera ocupada" em hardware que só
   aceita um consumidor por vez). Senão, abre um stream dedicado só pra
   prévia, liberado ao trocar de aba ou fechar o modal. */

let cameraPreviewStream = null;
let cameraPreviewOwned = false;

async function startCameraPreview() {
  if (cameraPreviewStream) return;
  if (state.camera.sharing && state.camera.camStream) {
    cameraPreviewStream = state.camera.camStream;
    cameraPreviewOwned = false;
  } else {
    try {
      cameraPreviewStream = await navigator.mediaDevices.getUserMedia({
        video: state.settings.camDeviceId ? { deviceId: { exact: state.settings.camDeviceId } } : true,
      });
      cameraPreviewOwned = true;
    } catch {
      return; // sem câmera/permissão - fica só com a dica de texto
    }
  }
  els.cameraPreviewVideo.srcObject = cameraPreviewStream;
  els.cameraPreviewVideo.classList.remove('hidden');
  els.cameraPreviewEmptyHint.classList.add('hidden');
}

function stopCameraPreview() {
  if (cameraPreviewStream && cameraPreviewOwned) {
    for (const t of cameraPreviewStream.getTracks()) t.stop();
  }
  cameraPreviewStream = null;
  cameraPreviewOwned = false;
  els.cameraPreviewVideo.srcObject = null;
  els.cameraPreviewVideo.classList.add('hidden');
  els.cameraPreviewEmptyHint.classList.remove('hidden');
}

let micTestStream = null;
let micTestCtx = null;
let micTestRaf = null;

function stopMicTest() {
  if (micTestRaf) cancelAnimationFrame(micTestRaf);
  micTestRaf = null;
  if (micTestCtx) { micTestCtx.close().catch(() => {}); micTestCtx = null; }
  if (micTestStream) { for (const t of micTestStream.getTracks()) t.stop(); micTestStream = null; }
  els.micMeterFill.style.width = '0%';
  els.micTestBtn.textContent = 'Testar';
  els.micTestBtn.classList.remove('active-test');
}

async function startMicTest() {
  stopMicTest();
  try {
    micTestStream = await navigator.mediaDevices.getUserMedia({
      audio: state.settings.micDeviceId ? { deviceId: { exact: state.settings.micDeviceId } } : true,
    });
  } catch {
    return;
  }
  micTestCtx = new (window.AudioContext || window.webkitAudioContext)();
  const source = micTestCtx.createMediaStreamSource(micTestStream);
  const analyser = micTestCtx.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser); // NAO conecta no destination - evita microfonia/eco
  const data = new Uint8Array(analyser.frequencyBinCount);
  const tick = () => {
    analyser.getByteTimeDomainData(data);
    let sumSquares = 0;
    for (const v of data) { const centered = (v - 128) / 128; sumSquares += centered * centered; }
    const rms = Math.sqrt(sumSquares / data.length);
    const level = Math.min(100, Math.round(rms * 220));
    els.micMeterFill.style.width = `${level}%`;
    micTestRaf = requestAnimationFrame(tick);
  };
  tick();
  els.micTestBtn.textContent = 'Parar';
  els.micTestBtn.classList.add('active-test');
}

els.micTestBtn.addEventListener('click', () => {
  if (micTestStream) stopMicTest();
  else startMicTest();
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
  reapplyBandwidthLimit();
});

async function initCloseBehaviorSelect() {
  if (!isElectron) {
    els.closeBehaviorSelect.disabled = true;
    return;
  }
  els.closeBehaviorSelect.value = await window.telaNative.getCloseBehavior();
}
els.closeBehaviorSelect.addEventListener('change', () => {
  if (isElectron) window.telaNative.setCloseBehavior(els.closeBehaviorSelect.value);
});

/* ---------------- faixa própria do topo (frame:false tirou a nativa) ----------------
   Fora do Electron (web puro) os botões simplesmente não fazem nada -
   window.telaNative não existe, os listeners nem são registrados. */
if (isElectron && els.winMinimizeBtn) {
  els.winMinimizeBtn.addEventListener('click', () => window.telaNative.minimizeWindow());
  els.winMaximizeBtn.addEventListener('click', () => window.telaNative.maximizeToggleWindow());
  els.winCloseBtn.addEventListener('click', () => window.telaNative.closeWindow());
  if (window.telaNative.onMaximizeChanged) {
    window.telaNative.onMaximizeChanged((isMaximized) => {
      els.winMaximizeBtn.title = isMaximized ? 'Restaurar' : 'Maximizar';
      // ícone muda pra "janelas sobrepostas" quando maximizado, avisando
      // que clicar de novo restaura - mesmo padrão visual do Windows.
      els.winMaximizeBtn.innerHTML = isMaximized
        ? '<svg viewBox="0 0 12 12" width="10" height="10"><rect x="1" y="3" width="8" height="8" fill="none" stroke="currentColor" stroke-width="1"/><path d="M3 3V1.5h8v8H9.5" fill="none" stroke="currentColor" stroke-width="1"/></svg>'
        : '<svg viewBox="0 0 12 12" width="10" height="10"><rect x="1.5" y="1.5" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1"/></svg>';
    });
  }
}

function openSettingsModal() {
  els.settingsModal.classList.remove('hidden');
  populateDeviceSelects();
  renderPermMuteList();
  refreshAppList();
  initCloseBehaviorSelect();
  updateAccountEmailStatus();
  refreshClipSaveDirDisplay();
  const activeTab = document.querySelector('.settings-tab.active');
  if (activeTab && activeTab.dataset.tab === 'devices') startCameraPreview();
}
function closeSettingsModal() {
  els.settingsModal.classList.add('hidden');
  stopCameraPreview();
  stopMicTest();
}
els.settingsBtn.addEventListener('click', openSettingsModal);
els.settingsModalClose.addEventListener('click', closeSettingsModal);
els.settingsDoneBtn.addEventListener('click', closeSettingsModal);
els.settingsModal.addEventListener('click', (ev) => {
  if (ev.target === els.settingsModal) closeSettingsModal();
});
els.settingsTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    const name = tab.dataset.tab;
    els.settingsTabs.forEach((t) => t.classList.toggle('active', t === tab));
    els.settingsTabPanels.forEach((p) => p.classList.toggle('active', p.dataset.panel === name));
    els.settingsTabTitle.textContent = tab.dataset.title;
    els.settingsTabSub.textContent = tab.dataset.sub;
    if (name === 'devices') startCameraPreview();
    else { stopCameraPreview(); stopMicTest(); }
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
// AMD VCE) em vez do VP8/VP9 padrão pra tela, que geralmente só tem encoder
// por software — tira carga da CPU durante a transmissão. degradationPreference
// prioriza manter o FPS configurado em vez de degradar quadros quando a
// rede/CPU aperta — o padrão do browser é o contrário (degrada FPS
// primeiro), ruim pra quem já escolheu um FPS alvo baixo de propósito (ex:
// transmitindo jogo).

// Matriz de bitrate (kbps) por altura×fps conhecidos - pesquisada em apps
// parecidos de código aberto (LiveKit também) e ajustada pra H264. Antes,
// "Automático" caía num teto fixo de 6000kbps pra QUALQUER combinação de
// resolução/fps - 720p a 15fps ficava tão "liberado" quanto 1440p a 60fps,
// o que tanto desperdiçava banda à toa (720p15 não precisa de 6Mbps) quanto
// sufocava a qualidade (1440p60 merecia mais que isso). Agora o automático
// escala com a resolução/fps de verdade escolhidos nas Configurações.
const VIDEO_BITRATE_MATRIX = {
  720: { 15: 1500, 24: 2200, 30: 2800, 60: 4000 },
  1080: { 15: 2500, 24: 3800, 30: 4500, 60: 7000 },
  1440: { 15: 4000, 24: 6000, 30: 7000, 60: 11000 },
};
const MATRIX_HEIGHTS = Object.keys(VIDEO_BITRATE_MATRIX).map(Number);
const MATRIX_FPS = [15, 24, 30, 60];

function nearestFromList(list, value) {
  return list.reduce((best, x) => (Math.abs(x - value) < Math.abs(best - value) ? x : best));
}

// "Nativa" (ou qualquer altura capturada fora da tabela, ex: monitor 4K)
// não tem entrada direta - acha o degrau conhecido mais próximo e escala
// proporcionalmente à área do quadro (altura² aproxima isso assumindo
// mesma proporção 16:9), igual outros apps fazem pro modo "resolução
// nativa". Clampa num intervalo sensato pra nunca sair um valor absurdo
// pra uma tela muito maior/menor que qualquer degrau conhecido.
function matrixBitrateKbps(height, fps) {
  if (!height) height = 1080;
  const nearestHeight = nearestFromList(MATRIX_HEIGHTS, height);
  const nearestFps = nearestFromList(MATRIX_FPS, fps);
  const base = VIDEO_BITRATE_MATRIX[nearestHeight][nearestFps];
  const scale = (height * height) / (nearestHeight * nearestHeight);
  return Math.min(45000, Math.max(500, Math.round(base * scale)));
}

function videoPublishOptions(name, lkSource, captureHeight) {
  const manualKbps = state.settings.bandwidthKbps;
  const kbps = manualKbps || matrixBitrateKbps(captureHeight, state.settings.fps);
  return {
    name,
    source: lkSource,
    videoCodec: 'h264',
    videoEncoding: { maxBitrate: kbps * 1000, maxFramerate: state.settings.fps },
    degradationPreference: 'maintain-framerate',
  };
}

function trackLkSource(source, track) {
  const LK = window.LivekitClient;
  if (source === 'screen' && track.kind === 'audio') return LK.Track.Source.ScreenShareAudio;
  return localSourceToLkSource(source);
}

async function publishLocalSource(source) {
  if (!lkRoom) return;
  const tracks = state[source].localTracks;
  if (!tracks.length) return;
  for (const track of tracks) {
    const lkSource = trackLkSource(source, track);
    const captureHeight = track.kind === 'video' ? track.getSettings().height : null;
    const options = track.kind === 'video' ? videoPublishOptions(source, lkSource, captureHeight) : { name: source, source: lkSource };
    try {
      const pub = await lkRoom.localParticipant.publishTrack(track, options);
      state[source].publications.push(pub);
      if (track.kind === 'video') tileVideoTracks.set(tileKey(state.myId, source), pub.track);
    } catch (err) {
      console.error(`não consegui publicar ${source}:`, err);
    }
  }
}

// stopOnUnpublish:false sempre - quem chama já controla o ciclo de vida da
// track (stopScreenShare/stopCameraShare/stopMicShare já param as tracks
// deles mesmos quando é pra parar de verdade); deixar o LiveKit parar a
// track aqui quebraria reapplyBandwidthLimit, que despublica e republica a
// MESMA track pra aplicar uma config nova sem recompartilhar.
async function unpublishLocalSource(source) {
  if (!lkRoom) return;
  for (const pub of state[source].publications) {
    try {
      await lkRoom.localParticipant.unpublishTrack(pub.track, false);
    } catch {
      /* já pode ter sido despublicada (ex: a Room caiu antes) - ignora */
    }
  }
  state[source].publications = [];
  tileVideoTracks.delete(tileKey(state.myId, source));
}

// Não existe mais 1 RTCRtpSender por espectador acessível direto - reaplicar
// config nova (banda/fps) é despublicar e publicar de novo com as
// TrackPublishOptions atualizadas. Só mexe em fontes que já estão no ar.
async function reapplyBandwidthLimit() {
  if (!lkRoom) return;
  if (state.screen.sharing) { await unpublishLocalSource('screen'); await publishLocalSource('screen'); }
  if (state.camera.sharing) { await unpublishLocalSource('camera'); await publishLocalSource('camera'); }
}

/* ---------------- áudio por app (mixagem via Web Audio, só no Electron) ----------------
   Cada app vira sua própria captura nativa (PCM cru); aqui a gente agenda os
   pedaços de PCM como AudioBufferSource tocando em sequência (técnica comum
   de streaming de PCM pelo Web Audio) e liga cada um num GainNode próprio,
   um por pid, pra não afetar os outros. Mutar um app pára a captura nativa
   dele de vez (ver isAppPermanentlyMuted) — não é só zerar gain, nem chega
   a vir PCM nenhum desse pid. Isso só vale pra transmissão de TELA (a
   câmera não carrega áudio do sistema). */

// Agrupado por NOME do processo, não por PID individual: navegadores
// baseados em Chromium (Brave, Edge, o próprio Chrome) rodam cada aba num
// processo separado, então "Brave" pode aparecer com vários PIDs distintos
// ao mesmo tempo. Mutar por PID deixava outras abas do mesmo navegador
// tocando sem querer — agrupando por nome, mutar "Brave" muta todos os
// processos dele, inclusive os que aparecerem depois na mesma transmissão.
const appAudio = {
  ctx: null,
  destination: null,
  groups: new Map(), // nome -> { pids: Map(pid -> { gainNode, nextTime, handle, starting }) }
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

// Fonte única de verdade pra mute: a lista "sempre mutar" das Configurações
// (state.settings.permanentlyMutedApps). Nada de estado de mute por sessão
// guardado à parte — group.muted somando com um toggle próprio é o que
// dava pra ficar fora de sincronia com a captura de verdade. Em vez disso,
// cada reconciliação (refreshAppList, no loop abaixo) RECALCULA se cada
// grupo deveria estar mutado e ajusta a captura pra bater com isso.
function isAppPermanentlyMuted(name) {
  return state.settings.permanentlyMutedApps.includes(name);
}

function stopEntryCapture(entry) {
  if (entry.handle != null) {
    window.telaNative.stopCapture(entry.handle);
    entry.handle = null;
  }
}

function startEntryCapture(pid, name, entry) {
  if (entry.handle != null || entry.starting) return;
  entry.starting = true;
  window.telaNative.startCapture(pid).then((handle) => {
    entry.starting = false;
    const group = appAudio.groups.get(name);
    // o app pode ter fechado (pid saiu do grupo) ou entrado pra lista de
    // "sempre mutar" enquanto essa ativação (IPC pro main + WASAPI) ainda
    // estava subindo - nesse caso não guarda o handle, devolve pro native
    // na hora em vez de deixar a captura "ressuscitar" por baixo do mute.
    if (!group || !group.pids.has(pid) || isAppPermanentlyMuted(name)) {
      window.telaNative.stopCapture(handle);
      return;
    }
    entry.handle = handle;
  });
}

// Ajusta a captura de um grupo (app) pro estado atual da lista "sempre
// mutar" - chamada tanto no loop periódico (pega app que começou a tocar
// som DEPOIS de já estar compartilhando) quanto na hora de marcar/desmarcar
// o checkbox nas Configurações (feedback imediato, sem esperar o loop).
function reconcileGroupMute(name) {
  const group = appAudio.groups.get(name);
  if (!group) return;
  const muted = isAppPermanentlyMuted(name);
  for (const [pid, entry] of group.pids) {
    if (muted) stopEntryCapture(entry);
    else startEntryCapture(pid, name, entry);
  }
}

function startCapturingApp(pid, name) {
  ensureAudioGraph();
  let group = appAudio.groups.get(name);
  if (!group) {
    group = { pids: new Map() };
    appAudio.groups.set(name, group);
  }
  const gainNode = appAudio.ctx.createGain();
  gainNode.connect(appAudio.destination);
  const entry = { gainNode, nextTime: 0, handle: null, starting: false };
  group.pids.set(pid, entry);
  if (!isAppPermanentlyMuted(name)) startEntryCapture(pid, name, entry);
}

const APP_LIST_REFRESH_MS = 4000;
let appListRefreshTimer = null;
// Enquanto compartilhando, reconsulta a lista de apps com áudio periodicamente
// (não só uma vez no começo) - sem isso, um app que só passa a tocar som
// depois que a transmissão já começou (notificação do Discord, abrir um
// jogo etc.) nunca era descoberto, então nunca entrava nem pra ser mutado.
function startAppListRefreshLoop() {
  if (appListRefreshTimer) return;
  appListRefreshTimer = setInterval(refreshAppList, APP_LIST_REFRESH_MS);
}
function stopAppListRefreshLoop() {
  if (appListRefreshTimer) {
    clearInterval(appListRefreshTimer);
    appListRefreshTimer = null;
  }
}

async function refreshAppList() {
  if (!isElectron || !state.screen.sharing) return;
  const available = await window.telaNative.available();
  if (!available) return;
  const apps = await window.telaNative.listApps();
  rememberAppsInHistory(apps);
  for (const app of apps) {
    const group = appAudio.groups.get(app.name);
    if (!group || !group.pids.has(app.pid)) startCapturingApp(app.pid, app.name);
  }
  // reconcilia o mute de todo mundo já conhecido com a lista "sempre mutar"
  // atual - cobre tanto editar a lista com a tela já compartilhando quanto
  // um app que começou a tocar som depois (essa função roda em loop).
  for (const name of appAudio.groups.keys()) reconcileGroupMute(name);
  // processos que sumiram da lista (app fechado/aba fechada) -> para a captura deles
  const seenPids = new Set(apps.map((a) => a.pid));
  for (const [name, group] of [...appAudio.groups]) {
    for (const [pid, entry] of [...group.pids]) {
      if (seenPids.has(pid)) continue;
      stopEntryCapture(entry);
      entry.gainNode.disconnect();
      group.pids.delete(pid);
    }
    if (group.pids.size === 0) appAudio.groups.delete(name);
  }
}

// Lista de "sempre mutar" — única forma de mutar um app (ver
// isAppPermanentlyMuted acima). Funciona a qualquer momento (não precisa
// estar compartilhando) e persiste entre sessões — resolve o pedido de
// "mutei o Discord uma vez, quero que já comece mutado da próxima vez".
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
      reconcileGroupMute(name);
    });
    els.permMuteList.appendChild(row);
  }
}

function teardownAppAudio() {
  stopAppListRefreshLoop();
  for (const group of appAudio.groups.values()) {
    for (const entry of group.pids.values()) {
      if (entry.handle != null) window.telaNative.stopCapture(entry.handle);
      entry.gainNode.disconnect();
    }
  }
  appAudio.groups.clear();
  if (appAudio.ctx) { appAudio.ctx.close(); appAudio.ctx = null; appAudio.destination = null; }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------------- lobby: servidores e canais (Supabase) ----------------
   Trilho de servidores à esquerda + lista de canais (texto/voz) do servidor
   selecionado, igual Discord. Abrir um canal de verdade (texto na Fase 3,
   voz na Fase 4) ainda não existe — por enquanto só mostra um aviso. */

let myServers = [];
// serverId -> timestamp de quando EU troquei o ícone desse servidor nessa
// sessão - usado só pra cache-bust do meu próprio rail (ver renderServerRail).
const serverIconCacheBust = new Map();
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
  if (activeServerId && !myServers.some((s) => s.id === activeServerId)) {
    // o servidor que estava aberto foi apagado ou eu saí dele - volta pra Home
    goHome();
  } else if (activeServerId) {
    // servidor ativo continua o mesmo, mas os dados dele (nome, icone...)
    // podem ter mudado - atualiza o cabeçalho sem precisar re-selecionar
    const server = myServers.find((s) => s.id === activeServerId);
    if (server) els.activeServerName.textContent = server.name;
  }
}

function renderServerRail() {
  els.serverRail.innerHTML = '';
  for (const server of myServers) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'server-rail-btn' + (server.id === activeServerId ? ' active' : '');
    btn.title = server.name;
    const bust = serverIconCacheBust.get(server.id);
    const iconSrc = server.icon_url && bust ? `${server.icon_url}?t=${bust}` : server.icon_url;
    btn.innerHTML = iconSrc
      ? `<img src="${escapeHtml(iconSrc)}" alt="" />`
      : escapeHtml((server.name || '?').trim().slice(0, 2).toUpperCase());
    btn.addEventListener('click', () => selectServer(server.id));
    els.serverRail.appendChild(btn);
  }
}

async function selectServer(serverId) {
  activeServerId = serverId;
  renderServerRail();
  els.homeBtn.classList.remove('active');
  const server = myServers.find((s) => s.id === serverId);
  els.activeServerName.textContent = server ? server.name : '';
  els.copyInviteBtn.classList.toggle('hidden', !server);
  els.serverSettingsBtn.classList.toggle('hidden', !server);
  await fetchChannels(serverId);
  joinServerPresence(serverId);
}

/* ---------------- Home: tela de amigos + mensagens diretas ----------------
   "Home" e' um pseudo-servidor: activeServerId fica null, a lateral de
   canais vira lista de conversas de DM, e o painel principal mostra as
   abas de amigos (igual o botao com a logo do Discord abre a tela de
   amigos em vez de um servidor). */

function goHome() {
  activeServerId = null;
  renderServerRail();
  els.homeBtn.classList.add('active');
  els.activeServerName.textContent = 'Mensagens diretas';
  els.copyInviteBtn.classList.add('hidden');
  els.serverSettingsBtn.classList.add('hidden');
  if (serverPresenceChannel) {
    window.supabaseClient.removeChannel(serverPresenceChannel);
    serverPresenceChannel = null;
  }
  if (serverMembersRealtime) {
    window.supabaseClient.removeChannel(serverMembersRealtime);
    serverMembersRealtime = null;
  }
  serverMembersCache = [];
  renderMemberSidebar();
  renderDmSidebar();
  showMainPanel('friends');
}
els.homeBtn.addEventListener('click', goHome);

/* ---------------- amigos: pedir, aceitar, recusar, remover ----------------
   friend_requests tem uma linha por par (pending -> accepted); recusar,
   cancelar ou desfazer amizade e' sempre um delete dessa linha. As 3
   listas abaixo (amigos de verdade, pedidos recebidos, pedidos enviados)
   sao recalculadas toda vez que fetchFriends() roda, e alimentam tanto as
   abas da tela de amigos quanto o popout de perfil e a lista de DM. */

let friendsCache = []; // {requestId, id, name, avatar} - status accepted
let pendingIncoming = []; // alguem me pediu, status pending
let pendingOutgoing = []; // eu pedi, status pending

async function fetchFriends() {
  if (!currentUser) return;
  const { data, error } = await window.supabaseClient
    .from('friend_requests')
    .select(
      'id, requester_id, addressee_id, status, requester:requester_id(id,display_name,avatar_url,last_seen_at), addressee:addressee_id(id,display_name,avatar_url,last_seen_at)',
    )
    .or(`requester_id.eq.${currentUser.id},addressee_id.eq.${currentUser.id}`);
  if (error) {
    console.error('Erro ao buscar amigos:', error);
    return;
  }
  friendsCache = [];
  pendingIncoming = [];
  pendingOutgoing = [];
  for (const row of data || []) {
    const isRequester = row.requester_id === currentUser.id;
    const other = isRequester ? row.addressee : row.requester;
    if (!other) continue;
    const entry = {
      requestId: row.id,
      id: other.id,
      name: other.display_name || 'Convidado',
      avatar: other.avatar_url,
      lastSeenAt: other.last_seen_at,
    };
    if (row.status === 'accepted') friendsCache.push(entry);
    else if (isRequester) pendingOutgoing.push(entry);
    else pendingIncoming.push(entry);
  }
  renderFriendsPanels();
}

function friendStatusOf(otherId) {
  if (friendsCache.some((f) => f.id === otherId)) return 'friends';
  if (pendingOutgoing.some((f) => f.id === otherId)) return 'pending_out';
  if (pendingIncoming.some((f) => f.id === otherId)) return 'pending_in';
  return 'none';
}

async function sendFriendRequest(otherId) {
  const { error } = await window.supabaseClient
    .from('friend_requests')
    .insert({ requester_id: currentUser.id, addressee_id: otherId });
  if (error) {
    console.error('Erro ao mandar pedido de amizade:', error);
    showToast('Não deu pra mandar o pedido de amizade.', 2500);
    return;
  }
  await fetchFriends();
}

async function acceptFriendRequestWith(otherId) {
  const req = pendingIncoming.find((f) => f.id === otherId);
  if (!req) return;
  const { error } = await window.supabaseClient
    .from('friend_requests')
    .update({ status: 'accepted' })
    .eq('id', req.requestId);
  if (error) {
    console.error('Erro ao aceitar pedido:', error);
    showToast('Não deu pra aceitar o pedido.', 2500);
    return;
  }
  await fetchFriends();
}

// cobre recusar pedido recebido, cancelar pedido enviado e desfazer
// amizade - os tres casos sao o mesmo delete da linha em friend_requests.
async function deleteFriendRequestWith(otherId) {
  const entry =
    friendsCache.find((f) => f.id === otherId) ||
    pendingOutgoing.find((f) => f.id === otherId) ||
    pendingIncoming.find((f) => f.id === otherId);
  if (!entry) return;
  const { error } = await window.supabaseClient.from('friend_requests').delete().eq('id', entry.requestId);
  if (error) {
    console.error('Erro ao remover vínculo de amizade:', error);
    showToast('Não deu pra fazer isso agora.', 2500);
    return;
  }
  await fetchFriends();
}

// linha reutilizada em: aba de amigos (online/todos), pendentes, resultado
// de busca de "adicionar amigo" e lista de conversas de DM. Clique na
// linha (fora dos botões de ação) abre o perfil da pessoa.
function buildPersonRow(person, { online, showHandle, actions } = {}) {
  const row = document.createElement('div');
  row.className = 'people-list-row' + (online ? ' sharing' : '');
  const statusDot = online ? '<span class="status-dot"></span>' : '';
  const subText = showHandle
    ? (person.id || '').slice(0, 8)
    : !online && person.lastSeenAt
      ? formatLastSeen(person.lastSeenAt)
      : '';
  row.innerHTML = `
    <div class="avatar-status-wrap">
      <img src="${person.avatar || DEFAULT_AVATAR}" alt="" />
      ${statusDot}
    </div>
    <div class="person-info">
      <span class="name">${escapeHtml(person.name || 'Convidado')}</span>
      ${subText ? `<span class="person-sub">${escapeHtml(subText)}</span>` : ''}
    </div>
    <div class="person-actions"></div>
  `;
  row.addEventListener('click', (ev) => {
    if (ev.target.closest('.person-actions')) return;
    openUserProfile(person.id);
  });
  if (actions && actions.length) {
    const actionsEl = row.querySelector('.person-actions');
    for (const action of actions) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `btn-sm ${action.className || 'ghost'}`;
      btn.textContent = action.label;
      if (action.disabled) btn.disabled = true;
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        action.onClick();
      });
      actionsEl.appendChild(btn);
    }
  }
  return row;
}

function renderFriendsPanels() {
  const onlineIds = globalPresenceChannel ? new Set(Object.keys(globalPresenceChannel.presenceState())) : new Set();

  els.friendsOnlineList.innerHTML = '';
  const onlineFriends = friendsCache.filter((f) => onlineIds.has(f.id));
  if (!onlineFriends.length) {
    els.friendsOnlineList.innerHTML = '<p class="friends-empty-hint">Ninguém online agora.</p>';
  } else {
    for (const f of onlineFriends) {
      els.friendsOnlineList.appendChild(
        buildPersonRow(f, { online: true, actions: [{ label: 'Mensagem', onClick: () => openDm(f.id) }] }),
      );
    }
  }

  els.friendsAllList.innerHTML = '';
  if (!friendsCache.length) {
    els.friendsAllList.innerHTML =
      '<p class="friends-empty-hint">Você ainda não tem nenhum amigo. Procura alguém na aba "Adicionar amigo".</p>';
  } else {
    for (const f of friendsCache) {
      els.friendsAllList.appendChild(
        buildPersonRow(f, { online: onlineIds.has(f.id), actions: [{ label: 'Mensagem', onClick: () => openDm(f.id) }] }),
      );
    }
  }

  els.friendsPendingIncoming.innerHTML = '';
  els.friendsPendingOutgoing.innerHTML = '';
  if (pendingIncoming.length) {
    const title = document.createElement('div');
    title.className = 'people-list-section-title';
    title.textContent = `Pedidos recebidos — ${pendingIncoming.length}`;
    els.friendsPendingIncoming.appendChild(title);
    for (const f of pendingIncoming) {
      els.friendsPendingIncoming.appendChild(
        buildPersonRow(f, {
          actions: [
            { label: 'Aceitar', className: 'primary', onClick: () => acceptFriendRequestWith(f.id) },
            { label: 'Recusar', onClick: () => deleteFriendRequestWith(f.id) },
          ],
        }),
      );
    }
  }
  if (pendingOutgoing.length) {
    const title = document.createElement('div');
    title.className = 'people-list-section-title';
    title.textContent = `Pedidos enviados — ${pendingOutgoing.length}`;
    els.friendsPendingOutgoing.appendChild(title);
    for (const f of pendingOutgoing) {
      els.friendsPendingOutgoing.appendChild(
        buildPersonRow(f, { actions: [{ label: 'Cancelar', onClick: () => deleteFriendRequestWith(f.id) }] }),
      );
    }
  }
  if (!pendingIncoming.length && !pendingOutgoing.length) {
    els.friendsPendingIncoming.innerHTML = '<p class="friends-empty-hint">Nenhum pedido pendente.</p>';
  }

  renderDmSidebarIfHome();
}

els.friendsTabs.forEach((btn) => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.friendsTab;
    els.friendsTabs.forEach((b) => b.classList.toggle('active', b === btn));
    els.friendsTabPanels.forEach((p) => p.classList.toggle('active', p.dataset.friendsPanel === tab));
  });
});

els.addFriendForm.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const q = els.addFriendInput.value.trim();
  els.addFriendError.classList.add('hidden');
  if (!q) return;
  const { data, error } = await window.supabaseClient
    .from('profiles')
    .select('id, display_name, avatar_url')
    .ilike('display_name', `%${q}%`)
    .neq('id', currentUser.id)
    .limit(20);
  if (error) {
    els.addFriendError.textContent = 'Erro na busca.';
    els.addFriendError.classList.remove('hidden');
    return;
  }
  els.addFriendResults.innerHTML = '';
  if (!data || !data.length) {
    els.addFriendResults.innerHTML = '<p class="friends-empty-hint">Ninguém encontrado com esse apelido.</p>';
    return;
  }
  for (const p of data) {
    const status = friendStatusOf(p.id);
    const actions = [];
    if (status === 'none') actions.push({ label: 'Adicionar', className: 'primary', onClick: () => sendFriendRequestFromSearch(p.id) });
    else if (status === 'pending_out') actions.push({ label: 'Pedido enviado', disabled: true });
    else if (status === 'pending_in')
      actions.push({ label: 'Aceitar', className: 'primary', onClick: () => acceptFriendRequestWith(p.id) });
    else actions.push({ label: 'Já é amigo', disabled: true });
    els.addFriendResults.appendChild(
      buildPersonRow({ id: p.id, name: p.display_name, avatar: p.avatar_url }, { showHandle: true, actions }),
    );
  }
});

async function sendFriendRequestFromSearch(otherId) {
  await sendFriendRequest(otherId);
  els.addFriendForm.requestSubmit();
}

/* ---------------- presença global: quem está online no app agora ----------------
   Separado da presença por servidor (que so' conta quem esta' olhando
   aquele servidor) - essa cobre "logado no app", usada pra separar
   amigos online/offline na tela de amigos. */

let globalPresenceChannel = null;
let friendRequestsChannels = null;

function joinGlobalPresence() {
  if (globalPresenceChannel || !currentUser) return;
  const rt = window.supabaseClient.channel('presence:online', {
    config: { presence: { key: currentUser.id } },
  });
  rt.on('presence', { event: 'sync' }, () => renderFriendsPanels());
  rt.subscribe((status) => {
    if (status === 'SUBSCRIBED') { rt.track({}); return; }
    // mesmo caso do server presence (ver rejoinGlobalPresence abaixo): sem
    // isso, só o poll de 20s notava o canal caído.
    if ((status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') && globalPresenceChannel === rt) {
      rejoinGlobalPresence();
    }
  });
  globalPresenceChannel = rt;
}

// mesmo bug do retrackServerPresence (ver comentário lá): esse canal
// também pode ficar "preso" num estado diferente de 'joined' depois de uma
// reconexão, e track() nesse estado não manda nada pro servidor em
// silêncio - antes só o de servidor tinha essa recuperação, então quando
// o GLOBAL travava a pessoa sumia da lista de amigos/online pra sempre
// (e isUserOnline(), usado pelo download de anexo, também ficava errado).
function rejoinGlobalPresence() {
  if (globalPresenceChannel) {
    window.supabaseClient.removeChannel(globalPresenceChannel);
    globalPresenceChannel = null;
  }
  joinGlobalPresence();
}

// sem isso, um pedido de amizade só aparecia quando a pessoa relogava (ou
// mexia em algo que já desse fetchFriends por conta própria) - friend_requests
// envolve OU requester_id OU addressee_id ser você, e o filtro de
// postgres_changes só aceita igualdade numa coluna só, então são duas
// assinaturas (uma por coluna) em vez de uma só com "OR".
function joinFriendRequestsRealtime() {
  if (friendRequestsChannels || !currentUser) return;
  const onChange = () => fetchFriends();
  const asRequester = window.supabaseClient
    .channel(`friend-requests:requester:${currentUser.id}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'friend_requests', filter: `requester_id=eq.${currentUser.id}` }, onChange)
    .subscribe();
  const asAddressee = window.supabaseClient
    .channel(`friend-requests:addressee:${currentUser.id}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'friend_requests', filter: `addressee_id=eq.${currentUser.id}` }, onChange)
    .subscribe();
  friendRequestsChannels = [asRequester, asAddressee];
}

// Camada de segurança pro "às vezes fulano não aparece online": o socket do
// Realtime caindo e reconectando (PC voltando do sono, troca de rede, app
// minimizado na bandeja por um tempo) às vezes não re-anuncia a presença de
// verdade pros outros, mesmo com o canal tecnicamente "inscrito" de novo —
// em vez de confiar só no evento 'sync', reforça com um re-track periódico
// e reage na hora quando o socket volta a abrir.
const PRESENCE_REFRESH_MS = 20000;

function retrackGlobalPresence() {
  if (!globalPresenceChannel) return;
  if (globalPresenceChannel.state !== 'joined') {
    rejoinGlobalPresence();
    return;
  }
  globalPresenceChannel.track({});
}
function retrackServerPresence() {
  if (!serverPresenceChannel) return;
  // bug real reportado em uso: depois de uma reconexão de rede (ex: sair e
  // voltar pra call), esse canal às vezes fica "preso" num estado diferente
  // de 'joined' (closed/errored) - chamar track() nele nesse estado não dá
  // erro nenhum, mas também não manda nada pro servidor, então a pessoa
  // sumia da lista "NA CALL"/"OFFLINE" pra sempre até trocar de servidor e
  // voltar. Detecta isso e reconecta de verdade (joinServerPresence recria
  // o canal do zero) em vez de insistir num canal morto.
  if (serverPresenceChannel.state !== 'joined') {
    if (activeServerId) joinServerPresence(activeServerId);
    return;
  }
  serverPresenceChannel.track({
    name: currentProfile ? currentProfile.display_name : 'Convidado',
    avatar: currentProfile ? currentProfile.avatar_url : null,
    // deixa a lista de canais da sidebar saber quem está em qual canal de
    // voz e quem está transmitindo tela, sem precisar entrar na call pra
    // enxergar isso (diferente da presença DENTRO da call, que só quem já
    // entrou vê) - usado pelo mini-roster com badge "AO VIVO" nos canais.
    voiceChannelId: activeVoiceChannel ? activeVoiceChannel.id : null,
    sharingScreen: state.screen.sharing,
  });
}
let presenceRefreshTimer = null;
function startPresenceRefreshLoop() {
  if (presenceRefreshTimer) return;
  presenceRefreshTimer = setInterval(() => {
    retrackGlobalPresence();
    retrackServerPresence();
  }, PRESENCE_REFRESH_MS);
}
startPresenceRefreshLoop();
// Essa versão do cliente Realtime não expõe onOpen/onClose público — usa o
// próprio heartbeat do socket (dispara a cada ciclo, inclusive logo após
// reconectar) como gatilho pra reanunciar presença sem esperar o intervalo.
if (window.supabaseClient.realtime && typeof window.supabaseClient.realtime.onHeartbeat === 'function') {
  window.supabaseClient.realtime.onHeartbeat(() => {
    retrackGlobalPresence();
    retrackServerPresence();
    renderFriendsPanels();
    renderMemberSidebar();
    renderChannelList();
  });
}

/* ---------------- anexos de chat via P2P (sem Storage) ----------------
   O arquivo nunca sobe pro Supabase - só metadados leves na mensagem
   (attachment_id/name/mime/size/kind). Quem manda guarda o Blob em
   memória (localAttachments); quem recebe, ao clicar, abre um
   RTCPeerConnection ad-hoc com DataChannel direto com quem mandou,
   usando um canal de sinalização pessoal por usuário (attach-signal:<id>)
   independente de estarem na mesma call - channel/DM só precisa dos
   dois estarem logados, não na mesma sala de voz. Por isso o arquivo só
   fica disponível enquanto quem mandou está com o app aberto. */

const localAttachments = new Map(); // attachment_id -> Blob
const attachmentTransfers = new Map(); // attachment_id -> { pc, role, onError }
const ATTACH_CHUNK_SIZE = 16 * 1024;
const ATTACH_MAX_BYTES = 100 * 1024 * 1024;

let attachmentSignalChannel = null;
function joinAttachmentSignaling() {
  if (attachmentSignalChannel || !currentUser) return;
  const rt = window.supabaseClient.channel(`attach-signal:${currentUser.id}`);
  rt.on('broadcast', { event: 'signal' }, ({ payload }) => onAttachmentSignal(payload.from, payload.data));
  rt.subscribe();
  attachmentSignalChannel = rt;
}

// Um canal de saída por destinatário, reaproveitado entre chamadas (em vez
// de inscrever um canal novo a cada sinal) - resolve dois problemas: (1)
// overhead/latência de reinscrever pra cada candidato ICE, e (2) uma corrida
// real onde sinais mandados em sequência (oferta, depois vários ICE) podiam
// chegar FORA de ordem no destino (cada um inscrevendo seu próprio canal
// novo, sem garantia de qual termina de inscrever primeiro) - um ICE
// candidate chegando antes da oferta ser processada era descartado em
// silêncio (o `pc` daquela transferência ainda nem existia).
const outboundAttachChannels = new Map(); // userId -> { channel, ready, queue }
function sendAttachmentSignal(toUserId, data) {
  let entry = outboundAttachChannels.get(toUserId);
  if (!entry) {
    const channel = window.supabaseClient.channel(`attach-signal:${toUserId}`);
    entry = { channel, ready: false, queue: [] };
    outboundAttachChannels.set(toUserId, entry);
    channel.subscribe((status) => {
      if (status !== 'SUBSCRIBED') return;
      entry.ready = true;
      for (const payload of entry.queue) channel.send(payload);
      entry.queue = [];
    });
  }
  const payload = { type: 'broadcast', event: 'signal', payload: { from: currentUser.id, data } };
  if (entry.ready) entry.channel.send(payload);
  else entry.queue.push(payload);
}

function onAttachmentSignal(fromUserId, data) {
  if (data.kind === 'attach-offer') {
    const blob = localAttachments.get(data.attachmentId);
    if (!blob) {
      sendAttachmentSignal(fromUserId, { kind: 'attach-unavailable', attachmentId: data.attachmentId });
      return;
    }
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    attachmentTransfers.set(data.attachmentId, { pc, role: 'sender' });
    pc.addEventListener('icecandidate', (ev) => {
      if (ev.candidate) {
        sendAttachmentSignal(fromUserId, { kind: 'attach-ice', attachmentId: data.attachmentId, candidate: ev.candidate.toJSON(), role: 'sender' });
      }
    });
    pc.addEventListener('datachannel', (ev) => {
      const dc = ev.channel;
      dc.binaryType = 'arraybuffer';
      dc.addEventListener('open', () => sendBlobOverChannel(dc, blob, () => setTimeout(() => pc.close(), 500)));
    });
    pc.setRemoteDescription(data.sdp)
      .then(() => pc.createAnswer())
      .then((answer) => pc.setLocalDescription(answer).then(() => {
        sendAttachmentSignal(fromUserId, { kind: 'attach-answer', attachmentId: data.attachmentId, sdp: answer });
      }))
      .catch(() => attachmentTransfers.delete(data.attachmentId));
  } else if (data.kind === 'attach-answer') {
    const t = attachmentTransfers.get(data.attachmentId);
    if (t) t.pc.setRemoteDescription(data.sdp).catch(() => {});
  } else if (data.kind === 'attach-ice') {
    const t = attachmentTransfers.get(data.attachmentId);
    if (t && data.role !== t.role) t.pc.addIceCandidate(data.candidate).catch(() => {});
  } else if (data.kind === 'attach-unavailable') {
    const t = attachmentTransfers.get(data.attachmentId);
    if (t && t.onError) t.onError('indisponível');
    attachmentTransfers.delete(data.attachmentId);
  }
}

function sendBlobOverChannel(dc, blob, onDone) {
  blob.arrayBuffer().then((ab) => {
    let offset = 0;
    dc.bufferedAmountLowThreshold = 262144;
    function sendMore() {
      while (offset < ab.byteLength) {
        if (dc.bufferedAmount > 1_000_000) {
          dc.onbufferedamountlow = () => { dc.onbufferedamountlow = null; sendMore(); };
          return;
        }
        const end = Math.min(offset + ATTACH_CHUNK_SIZE, ab.byteLength);
        dc.send(ab.slice(offset, end));
        offset = end;
      }
      dc.send(JSON.stringify({ type: 'end' }));
      onDone();
    }
    sendMore();
  });
}

// requestAttachment: baixa um anexo de quem mandou (fromUserId), com
// progresso. onComplete recebe o Blob remontado; onError recebe um motivo
// (ex: 'indisponível' se quem mandou não está online/offline no meio).
function requestAttachment(attachmentId, fromUserId, mime, onProgress, onComplete, onError) {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  const dc = pc.createDataChannel(`attach:${attachmentId}`);
  dc.binaryType = 'arraybuffer';
  const chunks = [];
  let received = 0;
  const timeout = setTimeout(() => {
    attachmentTransfers.delete(attachmentId);
    pc.close();
    onError('tempo esgotado');
  }, 20000);
  dc.addEventListener('message', (ev) => {
    if (typeof ev.data === 'string') {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'end') {
          clearTimeout(timeout);
          attachmentTransfers.delete(attachmentId);
          onComplete(new Blob(chunks, { type: mime }));
          pc.close();
        }
      } catch { /* ignora mensagem de controle mal formada */ }
      return;
    }
    chunks.push(ev.data);
    received += ev.data.byteLength;
    onProgress(received);
  });
  pc.addEventListener('icecandidate', (ev) => {
    if (ev.candidate) {
      sendAttachmentSignal(fromUserId, { kind: 'attach-ice', attachmentId, candidate: ev.candidate.toJSON(), role: 'requester' });
    }
  });
  attachmentTransfers.set(attachmentId, {
    pc,
    role: 'requester',
    onError: (reason) => { clearTimeout(timeout); onError(reason); },
  });
  pc.createOffer()
    .then((offer) => pc.setLocalDescription(offer).then(() => {
      sendAttachmentSignal(fromUserId, { kind: 'attach-offer', attachmentId, sdp: offer });
    }))
    .catch(() => { clearTimeout(timeout); onError('falha ao iniciar'); });
}

function classifyAttachmentKind(mime) {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  return 'file';
}

function formatAttachmentSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// imagem de anexo: comprime preservando proporção (diferente do
// resizeImageToBlob dos avatares, que força um recorte quadrado) - só
// reduz se já for maior que o teto, pra não re-comprimir imagem pequena à toa.
function compressAttachmentImage(file, maxDim = 1600) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      if (scale === 1) { URL.revokeObjectURL(img.src); resolve(file); return; }
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(img.src);
      canvas.toBlob((blob) => resolve(blob || file), 'image/jpeg', 0.85);
    };
    img.onerror = () => resolve(file);
    img.src = URL.createObjectURL(file);
  });
}

function isUserOnline(userId) {
  return !!(globalPresenceChannel && globalPresenceChannel.presenceState()[userId]);
}

// Monta o bloco de anexo dentro de uma mensagem - placeholder clicável que
// baixa sob demanda (P2P), com prévia inline pra imagem/vídeo depois de
// baixado e link de "salvar" pra qualquer tipo.
function renderAttachmentBlock(row, senderId) {
  const wrap = document.createElement('div');
  wrap.className = 'chat-msg-attachments';
  const sizeText = row.attachment_size ? formatAttachmentSize(row.attachment_size) : '';

  function showIdle(labelOverride) {
    wrap.innerHTML = '';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chat-attachment-file';
    btn.innerHTML = `${ICONS.file}<span>${escapeHtml(row.attachment_name || 'arquivo')}</span><span class="chat-attachment-size">${labelOverride || sizeText}</span>`;
    btn.addEventListener('click', startDownload);
    wrap.appendChild(btn);
  }

  function showResult(blob) {
    wrap.innerHTML = '';
    const url = URL.createObjectURL(blob);
    if (row.attachment_kind === 'image') {
      const img = document.createElement('img');
      img.className = 'chat-attachment-img';
      img.src = url;
      img.alt = row.attachment_name || '';
      img.addEventListener('click', () => window.open(url, '_blank'));
      wrap.appendChild(img);
    } else if (row.attachment_kind === 'video') {
      const video = document.createElement('video');
      video.src = url;
      video.controls = true;
      video.style.maxWidth = '100%';
      video.style.borderRadius = 'var(--radius-sm)';
      wrap.appendChild(video);
    } else {
      const a = document.createElement('a');
      a.className = 'chat-attachment-file';
      a.href = url;
      a.download = row.attachment_name || 'arquivo';
      a.innerHTML = `${ICONS.file}<span>${escapeHtml(row.attachment_name || 'arquivo')}</span><span class="chat-attachment-size">Salvar</span>`;
      wrap.appendChild(a);
    }
  }

  function startDownload() {
    if (!isUserOnline(senderId)) {
      showIdle('indisponível — offline');
      return;
    }
    wrap.innerHTML = '';
    const status = document.createElement('div');
    status.className = 'chat-sending-status';
    status.textContent = 'Baixando... 0%';
    wrap.appendChild(status);
    requestAttachment(
      row.attachment_id,
      senderId,
      row.attachment_mime,
      (received) => {
        const pct = row.attachment_size ? Math.min(100, Math.round((received / row.attachment_size) * 100)) : 0;
        status.textContent = `Baixando... ${pct}%`;
      },
      (blob) => showResult(blob),
      () => showIdle('falha — tenta de novo'),
    );
  }

  showIdle();
  return wrap;
}

/* ---------------- mensagens diretas ----------------
   Decalque quase 1:1 do canal de texto (fetch inicial + postgres_changes),
   so' que filtrando por par de usuários em vez de channel_id. */

// Mensagens consecutivas do mesmo autor, dentro dessa janela, agrupam
// visualmente (sem repetir avatar/nome) — mesmo critério usado no chat
// de canal de texto e nas mensagens diretas.
const MESSAGE_GROUP_WINDOW_MS = 5 * 60 * 1000;

/* ---------------- reações com emoji (só canal de texto, por enquanto) ----------------
   Barra rápida de reação (hover na mensagem) com um conjunto fixo de
   emojis comuns - sem picker completo por ora. Cache em memória
   (messageId -> emoji -> Set de userId que reagiu), reconstruída ao abrir
   o canal e mantida em dia via postgres_changes na mesma subscription já
   usada pras mensagens. */
const QUICK_REACT_EMOJI = ['👍', '❤️', '😂', '🎉', '😮', '😢'];
const reactionsCache = new Map(); // messageId -> Map(emoji -> Set(userId))

function getReactionBucket(messageId, emoji) {
  let byEmoji = reactionsCache.get(messageId);
  if (!byEmoji) {
    byEmoji = new Map();
    reactionsCache.set(messageId, byEmoji);
  }
  let users = byEmoji.get(emoji);
  if (!users) {
    users = new Set();
    byEmoji.set(emoji, users);
  }
  return users;
}

async function fetchReactionsFor(messageIds) {
  if (!messageIds.length) return;
  const { data, error } = await window.supabaseClient
    .from('message_reactions')
    .select('message_id, user_id, emoji')
    .in('message_id', messageIds);
  if (error) {
    console.error('Erro ao buscar reações:', error);
    return;
  }
  for (const row of data || []) {
    getReactionBucket(row.message_id, row.emoji).add(row.user_id);
  }
}

function onReactionChange(payload) {
  const row = payload.eventType === 'DELETE' ? payload.old : payload.new;
  if (!row || !row.message_id) return;
  if (payload.eventType === 'DELETE') {
    const users = getReactionBucket(row.message_id, row.emoji);
    users.delete(row.user_id);
  } else {
    getReactionBucket(row.message_id, row.emoji).add(row.user_id);
  }
  const wrap = document.querySelector(`.chat-msg[data-message-id="${row.message_id}"] .chat-msg-reactions`);
  if (wrap) renderReactionPills(wrap, row.message_id);
}

async function toggleReaction(messageId, emoji) {
  const mine = getReactionBucket(messageId, emoji).has(currentUser.id);
  if (mine) {
    await window.supabaseClient
      .from('message_reactions')
      .delete()
      .eq('message_id', messageId)
      .eq('user_id', currentUser.id)
      .eq('emoji', emoji);
  } else {
    await window.supabaseClient
      .from('message_reactions')
      .insert({ message_id: messageId, user_id: currentUser.id, emoji });
  }
  // não espera o realtime pra se auto-atualizar - reação da própria pessoa
  // reflete na hora, o resto da galera continua chegando via postgres_changes
  const byEmoji = reactionsCache.get(messageId);
  const wrap = document.querySelector(`.chat-msg[data-message-id="${messageId}"] .chat-msg-reactions`);
  if (wrap) renderReactionPills(wrap, messageId);
}

function renderReactionPills(wrap, messageId) {
  wrap.innerHTML = '';
  const byEmoji = reactionsCache.get(messageId);
  if (!byEmoji) return;
  for (const [emoji, users] of byEmoji) {
    if (!users.size) continue;
    const mine = users.has(currentUser.id);
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'chat-msg-reaction-pill' + (mine ? ' mine' : '');
    pill.innerHTML = `<span>${emoji}</span><span class="chat-msg-reaction-count">${users.size}</span>`;
    pill.addEventListener('click', () => toggleReaction(messageId, emoji));
    wrap.appendChild(pill);
  }
}

function buildQuickReactBar(messageId) {
  const bar = document.createElement('div');
  bar.className = 'chat-msg-quick-react';
  for (const emoji of QUICK_REACT_EMOJI) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = emoji;
    btn.addEventListener('click', () => toggleReaction(messageId, emoji));
    bar.appendChild(btn);
  }
  return bar;
}

let activeDmPeerId = null;
let dmRealtime = null;
let dmLastAuthorId = null;
let dmLastAt = null;

function renderDmSidebar() {
  // o cabecalho (#activeServerName) ja' diz "Mensagens diretas" aqui -
  // nao repete o titulo dentro da lista, soh os amigos.
  els.roomGrid.innerHTML = '';
  if (!friendsCache.length) {
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = 'Adicione amigos pra poder mandar mensagem direta.';
    els.roomGrid.appendChild(hint);
    return;
  }
  for (const f of friendsCache) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'channel-row' + (activeDmPeerId === f.id ? ' active-channel' : '');
    row.innerHTML = `<img src="${f.avatar || DEFAULT_AVATAR}" alt="" /><span>${escapeHtml(f.name)}</span>`;
    row.addEventListener('click', () => openDm(f.id));
    els.roomGrid.appendChild(row);
  }
}

function renderDmSidebarIfHome() {
  if (!activeServerId) renderDmSidebar();
}

function renderDmMessage(row) {
  const isSelf = row.sender_id === currentUser.id;
  const otherId = isSelf ? row.recipient_id : row.sender_id;
  const friend = friendsCache.find((f) => f.id === otherId);
  const name = isSelf ? (currentProfile ? currentProfile.display_name : 'Você') : friend ? friend.name : 'Convidado';
  const avatar = isSelf ? currentProfile && currentProfile.avatar_url : friend && friend.avatar;
  const time = new Date(row.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const createdAt = new Date(row.created_at);
  const authorId = isSelf ? currentUser.id : otherId;
  const grouped =
    dmLastAuthorId === authorId && dmLastAt && createdAt - dmLastAt < MESSAGE_GROUP_WINDOW_MS;
  dmLastAuthorId = authorId;
  dmLastAt = createdAt;

  const wrap = document.createElement('div');
  wrap.className = 'chat-msg' + (isSelf ? ' self' : '') + (grouped ? ' chat-msg-grouped' : '');
  wrap.innerHTML = `
    <img class="chat-msg-avatar" src="${avatar || DEFAULT_AVATAR}" alt="" />
    <div class="chat-msg-body">
      <div class="chat-msg-meta">
        <span class="chat-msg-name">${escapeHtml(name)}</span>
        <span class="chat-msg-time">${time}</span>
      </div>
      ${row.content ? `<div class="chat-msg-text">${escapeHtml(row.content)}</div>` : ''}
    </div>
  `;
  if (row.attachment_id) wrap.querySelector('.chat-msg-body').appendChild(renderAttachmentBlock(row, authorId));
  els.dmMessages.appendChild(wrap);
  els.dmMessages.scrollTop = els.dmMessages.scrollHeight;

  if (!isSelf && state.settings.chatNotifications) {
    notifyChatMessage({ name, avatar, text: row.content });
  }
}

async function openDm(friendId) {
  const friend = friendsCache.find((f) => f.id === friendId);
  activeDmPeerId = friendId;
  els.dmPeerName.textContent = friend ? friend.name : 'Mensagem direta';
  els.dmPeerAvatar.src = (friend && friend.avatar) || DEFAULT_AVATAR;
  els.dmMessages.innerHTML = '';
  dmLastAuthorId = null;
  dmLastAt = null;
  renderDmSidebarIfHome();
  showMainPanel('dm');

  const { data, error } = await window.supabaseClient
    .from('direct_messages')
    .select('*')
    .or(`and(sender_id.eq.${currentUser.id},recipient_id.eq.${friendId}),and(sender_id.eq.${friendId},recipient_id.eq.${currentUser.id})`)
    .order('created_at', { ascending: true })
    .limit(200);
  if (error) {
    console.error('Erro ao buscar mensagens diretas:', error);
  } else {
    for (const row of data) renderDmMessage(row);
  }

  if (dmRealtime) window.supabaseClient.removeChannel(dmRealtime);
  dmRealtime = window.supabaseClient
    .channel(`dm:${[currentUser.id, friendId].sort().join(':')}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'direct_messages' }, (payload) => {
      const row = payload.new;
      const involvesUs =
        (row.sender_id === currentUser.id && row.recipient_id === friendId) ||
        (row.sender_id === friendId && row.recipient_id === currentUser.id);
      if (involvesUs) renderDmMessage(row);
    })
    .subscribe();
}

function closeDm() {
  if (dmRealtime) {
    window.supabaseClient.removeChannel(dmRealtime);
    dmRealtime = null;
  }
  activeDmPeerId = null;
}

let dmPendingFile = null;
function renderDmPendingAttachment() {
  els.dmPendingAttachments.classList.toggle('hidden', !dmPendingFile);
  if (!dmPendingFile) { els.dmPendingAttachments.innerHTML = ''; return; }
  els.dmPendingAttachments.innerHTML = `
    <span class="chat-pending-chip">
      <span>${escapeHtml(dmPendingFile.name)}</span>
      <span class="chat-pending-size">${formatAttachmentSize(dmPendingFile.size)}</span>
      <button type="button" class="chat-pending-remove">${ICONS.close}</button>
    </span>
  `;
  els.dmPendingAttachments.querySelector('.chat-pending-remove').addEventListener('click', () => {
    dmPendingFile = null;
    renderDmPendingAttachment();
  });
}
els.dmAttachBtn.addEventListener('click', () => els.dmFileInput.click());
els.dmFileInput.addEventListener('change', async () => {
  const file = els.dmFileInput.files[0];
  els.dmFileInput.value = '';
  if (!file) return;
  if (file.size > ATTACH_MAX_BYTES) {
    showToast('Esse arquivo é maior que 100MB — escolhe um menor.', 3000);
    return;
  }
  const kind = classifyAttachmentKind(file.type);
  const blob = kind === 'image' ? await compressAttachmentImage(file) : file;
  dmPendingFile = { id: crypto.randomUUID(), name: file.name, mime: file.type || 'application/octet-stream', size: blob.size, kind, blob };
  renderDmPendingAttachment();
});

els.dmForm.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const content = els.dmTextInput.value.trim();
  if ((!content && !dmPendingFile) || !activeDmPeerId) return;
  els.dmTextInput.value = '';
  const pending = dmPendingFile;
  dmPendingFile = null;
  renderDmPendingAttachment();
  const insertRow = { sender_id: currentUser.id, recipient_id: activeDmPeerId, content };
  if (pending) {
    localAttachments.set(pending.id, pending.blob);
    Object.assign(insertRow, {
      attachment_id: pending.id,
      attachment_name: pending.name,
      attachment_mime: pending.mime,
      attachment_size: pending.size,
      attachment_kind: pending.kind,
    });
  }
  const { error } = await window.supabaseClient.from('direct_messages').insert(insertRow);
  if (error) {
    console.error('Erro ao enviar mensagem direta:', error);
    showToast('Não deu pra enviar a mensagem.', 2500);
  }
});

/* ---------------- lista de membros do servidor (barra lateral direita) ----------------
   Realtime Presence por servidor (`server:<id>`) - cada cliente so' avisa
   "estou olhando esse servidor agora", sem precisar estar numa chamada de
   voz. Mostra quem ta online (nessa sessao) separado de quem ta offline,
   igual Discord. Serve tambem de base pra sinalizacao de transferencia de
   arquivo P2P mais pra frente. */

let serverPresenceChannel = null;
let serverMembersRealtime = null;
let serverMembersCache = [];

function joinServerPresence(serverId) {
  if (serverPresenceChannel) {
    window.supabaseClient.removeChannel(serverPresenceChannel);
    serverPresenceChannel = null;
  }
  if (serverMembersRealtime) {
    window.supabaseClient.removeChannel(serverMembersRealtime);
    serverMembersRealtime = null;
  }
  const myId = currentUser.id;
  const rt = window.supabaseClient.channel(`server:${serverId}`, {
    config: { presence: { key: myId } },
  });
  rt.on('presence', { event: 'sync' }, () => {
    renderMemberSidebar();
    renderChannelList();
  });
  serverPresenceChannel = rt;
  rt.subscribe((status) => {
    // reaproveita retrackServerPresence (já manda voiceChannelId/sharingScreen
    // junto) em vez de duplicar um track() parcial aqui - evita a pessoa
    // aparecer "fora da call" por um instante logo numa reconexão que
    // acontece enquanto ela já está dentro de uma call.
    if (status === 'SUBSCRIBED') { retrackServerPresence(); return; }
    // antes só reagia a SUBSCRIBED - quando o canal caía (CLOSED/
    // CHANNEL_ERROR/TIMED_OUT), ninguém notava até o poll de 20s
    // (PRESENCE_REFRESH_MS) rodar de novo, deixando a pessoa sumida de
    // "Na call" (caindo em "Offline") por até 20s. O SDK já avisa isso na
    // hora pelo próprio callback de subscribe - só precisava escutar.
    if ((status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') && serverPresenceChannel === rt && activeServerId) {
      joinServerPresence(activeServerId);
    }
  });
  fetchServerMembers(serverId);

  // escuta quem entra/sai de verdade no servidor (tabela server_members) -
  // sem isso, quem JÁ estava com o servidor aberto nunca descobria que
  // alguém novo entrou: a lista de membros (serverMembersCache) só era
  // buscada uma vez, no momento de abrir o servidor, e nunca mais depois
  // disso - a pessoa nova podia estar com a presença sincronizada
  // corretamente por trás e mesmo assim nunca aparecer na lista, porque o
  // cross-reference usa esse cache pra saber QUEM existe, não só quem tá
  // online. Canal separado do de presença, mesmo motivo de sempre: uma
  // falha aqui não pode derrubar a subscrição de presença junto.
  serverMembersRealtime = window.supabaseClient
    .channel(`server-members-changes:${serverId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'server_members', filter: `server_id=eq.${serverId}` },
      () => fetchServerMembers(serverId),
    )
    .subscribe();
}

async function fetchServerMembers(serverId) {
  const { data, error } = await window.supabaseClient
    .from('server_members')
    .select('user_id, profiles(display_name, avatar_url, last_seen_at)')
    .eq('server_id', serverId);
  // se o usuário já trocou de servidor enquanto essa resposta estava a
  // caminho, essa resposta é de um servidor que não é mais o selecionado -
  // aplicá-la agora sobrescreveria serverMembersCache com os membros
  // errados (caso clássico de resposta antiga chegando depois da nova).
  if (serverId !== activeServerId) return;
  serverMembersCache = error ? [] : (data || []);
  renderMemberSidebar();
}

/* ---------------- menu de contexto genérico (clique direito) ----------------
   Usado hoje só pela lista de membros (volume individual), mas escrito
   genérico (recebe uma função que monta o conteúdo) pra poder reaproveitar
   em outro lugar se precisar. Fecha sozinho ao clicar fora ou apertar Esc. */

let activeContextMenu = null;

function closeContextMenu(ev) {
  if (!activeContextMenu) return;
  // clique DENTRO do próprio menu não fecha sozinho (ex: picker de emoji,
  // que precisa ficar aberto pra mandar vários emojis seguidos) - quem
  // quer fechar ao clicar numa ação chama closeContextMenu() direto no
  // próprio handler da ação (como já faz "Ver perfil" etc.)
  if (ev && ev.target && activeContextMenu.contains(ev.target)) return;
  activeContextMenu.remove();
  activeContextMenu = null;
  document.removeEventListener('click', closeContextMenu, true);
  document.removeEventListener('keydown', onContextMenuKeydown, true);
}
function onContextMenuKeydown(ev) {
  if (ev.key === 'Escape') closeContextMenu();
}
function openContextMenu(x, y, buildContent) {
  closeContextMenu();
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  buildContent(menu);
  document.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  const left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8));
  const top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  activeContextMenu = menu;
  setTimeout(() => {
    document.addEventListener('click', closeContextMenu, true);
    document.addEventListener('keydown', onContextMenuKeydown, true);
  }, 0);
}

/* ---------------- picker de emoji (chat/DM) ----------------
   Conjunto curado fixo (não é o banco unicode inteiro) - cobre o uso
   comum sem precisar de busca nem categorias. Insere no input de onde foi
   aberto, não fecha sozinho entre cliques (dá pra mandar vários seguidos).
   Reaproveita o mesmo componente de menu de contexto genérico. */
const EMOJI_PICKER_SET = [
  '😀', '😁', '😂', '🤣', '😊', '🙂', '😉', '😍', '🥰', '😘', '😜', '🤪', '🤔', '🫡', '😎', '🥳',
  '😭', '😢', '😡', '🤬', '😱', '😨', '🥵', '🥶', '🤢', '🤯', '🙄', '😏', '😒', '😴', '🤫', '🤭',
  '👍', '👎', '👏', '🙌', '🙏', '💪', '🤝', '✌️', '👌', '🤙', '👀', '🖕', '💯', '🔥', '✨', '🎉',
  '❤️', '💔', '💀', '👻', '🤖', '🎮', '🎧', '🍕', '🍺', '☕', '🐶', '🐱', '🚀', '⭐', '🌙', '☀️',
];
function openEmojiPicker(anchorBtn, input) {
  const rect = anchorBtn.getBoundingClientRect();
  openContextMenu(rect.left, rect.top - 290, (menu) => {
    menu.classList.add('emoji-picker-menu');
    for (const emoji of EMOJI_PICKER_SET) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = emoji;
      btn.addEventListener('click', () => {
        input.value += emoji;
        input.focus();
      });
      menu.appendChild(btn);
    }
  });
}
els.textChannelEmojiBtn.addEventListener('click', () => openEmojiPicker(els.textChannelEmojiBtn, els.textChannelTextInput));
els.dmEmojiBtn.addEventListener('click', () => openEmojiPicker(els.dmEmojiBtn, els.dmTextInput));

/* ---------------- volume individual por pessoa ----------------
   So' faz sentido pra quem eu realmente estou ouvindo agora (quem tem
   tile ativo na minha chamada de voz atual - a lista de membros e' do
   servidor inteiro, nao so' de quem esta' na call). Guardado em memoria
   (nao precisa persistir no banco, e' preferencia local de quem ouve) e
   aplicado via .volume nativo dos elementos <audio>/<video>, igual o
   slider que ja existe por tile - sem precisar de GainNode/AudioContext
   novo. */

const peerVolumes = new Map(); // userId -> 0..200 (%)

function hasActiveTilesFor(peerId) {
  return ['mic', 'camera', 'screen'].some((source) => state.tiles.has(tileKey(peerId, source)));
}

// aplica o volume guardado (se tiver) num elemento de midia recem-criado;
// devolve a porcentagem aplicada (ou null se nao tinha nada guardado).
function applyStoredPeerVolume(key, mediaEl) {
  const peerId = key.slice(0, key.lastIndexOf(':'));
  if (!peerVolumes.has(peerId)) return null;
  const pct = peerVolumes.get(peerId);
  mediaEl.volume = pct / 100;
  return pct;
}

function applyPeerVolume(peerId, pct) {
  peerVolumes.set(peerId, pct);
  for (const source of ['mic', 'camera', 'screen']) {
    const tile = state.tiles.get(tileKey(peerId, source));
    if (tile && tile.video) tile.video.volume = pct / 100;
  }
}

function openMemberContextMenu(x, y, member) {
  openContextMenu(x, y, (menu) => {
    const title = document.createElement('div');
    title.className = 'context-menu-title';
    title.textContent = member.name;
    menu.appendChild(title);

    const profileBtn = document.createElement('button');
    profileBtn.type = 'button';
    profileBtn.className = 'context-menu-action';
    profileBtn.textContent = 'Ver perfil';
    profileBtn.addEventListener('click', () => {
      closeContextMenu();
      openUserProfile(member.id);
    });
    menu.appendChild(profileBtn);

    if (!hasActiveTilesFor(member.id)) {
      const hint = document.createElement('div');
      hint.className = 'context-menu-hint';
      hint.textContent = 'Entre na mesma chamada de voz pra poder ajustar o volume dessa pessoa.';
      menu.appendChild(hint);
      return;
    }

    const current = peerVolumes.has(member.id) ? peerVolumes.get(member.id) : 100;
    const row = document.createElement('div');
    row.className = 'context-menu-item';
    row.innerHTML = `<input type="range" min="0" max="200" value="${current}" /><span class="context-menu-volume-value">${current}%</span>`;
    const slider = row.querySelector('input');
    const valueLabel = row.querySelector('.context-menu-volume-value');
    slider.addEventListener('input', () => {
      const pct = Number(slider.value);
      valueLabel.textContent = `${pct}%`;
      applyPeerVolume(member.id, pct);
    });
    menu.appendChild(row);
  });
}

function renderMemberSidebar() {
  if (!activeServerId) {
    els.memberSidebar.classList.add('hidden');
    return;
  }
  els.memberSidebar.classList.remove('hidden');

  // Na sala de voz, a sidebar mostra quem está NA CALL (não só "olhando o
  // servidor") — dado diferente, vem do roster de presença por canal de
  // voz (voiceChannelOccupants, já usado no mini-roster da lista de
  // canais) em vez do online/offline genérico do servidor.
  if (currentMainPanel === 'voice' && activeVoiceChannel) {
    renderCallMemberSidebar();
    return;
  }

  const onlineIds = serverPresenceChannel
    ? new Set(Object.keys(serverPresenceChannel.presenceState()))
    : new Set();

  const online = [];
  const offline = [];
  for (const m of serverMembersCache) {
    const profile = m.profiles || {};
    const entry = { id: m.user_id, name: profile.display_name || 'Convidado', avatar: profile.avatar_url, lastSeenAt: profile.last_seen_at };
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
      const row = buildPersonRow(member, { online: title === 'Online' });
      if (title !== 'Online') row.style.opacity = '0.5';
      if (member.id !== currentUser.id) {
        row.addEventListener('contextmenu', (ev) => {
          ev.preventDefault();
          openMemberContextMenu(ev.clientX, ev.clientY, member);
        });
      }
      els.memberList.appendChild(row);
    }
  };
  addGroup('Online', online);
  addGroup('Offline', offline);
  if (online.length <= 1) {
    els.memberList.appendChild(
      buildNudgeCard('Tá meio vazio aqui', 'Manda o convite pra galera. Quem entrar já cai no servidor.'),
    );
  }
  els.memberList.appendChild(buildSupportCard());
}

// icone do card de nudge por tema sazonal - ilustracoes literais com cor
// propria fixa (nao seguem a paleta do tema), mesmos SVGs dos mockups
// originais de cada tema.
const NUDGE_THEME_ICONS = {
  halloween: `<svg aria-hidden="true" width="46" height="42" viewBox="0 0 44 40" class="nudge-theme-icon">
    <path d="M21 7c0-3 2-5 5-5" stroke="#6BAA3A" stroke-width="3" fill="none" stroke-linecap="round"></path>
    <ellipse cx="14" cy="24" rx="11" ry="14" fill="#D9600C"></ellipse>
    <ellipse cx="30" cy="24" rx="11" ry="14" fill="#D9600C"></ellipse>
    <ellipse cx="22" cy="24" rx="10" ry="15" fill="#FF7A1A"></ellipse>
    <path d="M13 19l5 4h-7zM31 19l-5 4h7z" fill="#2A1206"></path>
    <path d="M12 29q10 7 20 0l-3 1.2-2.2-2-2.4 3-2.4-3-2.4 3-2.4-3-2.2 2z" fill="#2A1206"></path>
  </svg>`,
  natal: `<svg aria-hidden="true" width="40" height="46" viewBox="0 0 40 46" class="nudge-theme-icon">
    <path d="M20 1l2.2 4.5 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5-3.6-3.5 5-.7z" fill="#F2C14E"></path>
    <path d="M20 12 9 26h6L5 38h30L25 26h6z" fill="#2E8B57"></path>
    <rect x="17" y="38" width="6" height="7" rx="1" fill="#7A4A2A"></rect>
    <circle cx="15" cy="24" r="1.8" fill="#E5484D"></circle>
    <circle cx="24" cy="30" r="1.8" fill="#F2C14E"></circle>
    <circle cx="13" cy="34" r="1.8" fill="#F2C14E"></circle>
    <circle cx="27" cy="35" r="1.8" fill="#E5484D"></circle>
  </svg>`,
  lagoa: `<svg aria-hidden="true" width="78" height="58" viewBox="0 0 78 58" class="nudge-theme-icon">
    <path d="M39 48 70 40A34 12 0 1 1 39 35z" fill="#2F9E55"></path>
    <path d="M39 48 70 40" stroke="#1E6B3A" stroke-width="1.4"></path>
    <path d="M20 44q-6 2-8 0 3-4 9-3zM58 44q6 2 8 0-3-4-9-3z" fill="#3FA85A"></path>
    <ellipse cx="39" cy="34" rx="17" ry="12" fill="#4FBF6A"></ellipse>
    <ellipse cx="39" cy="38" rx="10" ry="7" fill="#BDEB9C"></ellipse>
    <circle cx="30" cy="22" r="7" fill="#4FBF6A"></circle>
    <circle cx="48" cy="22" r="7" fill="#4FBF6A"></circle>
    <circle cx="30" cy="21" r="4.6" fill="#FFFFFF"></circle>
    <circle cx="48" cy="21" r="4.6" fill="#FFFFFF"></circle>
    <circle cx="31" cy="21.5" r="2.4" fill="#0A2010"></circle>
    <circle cx="49" cy="21.5" r="2.4" fill="#0A2010"></circle>
    <circle cx="31.8" cy="20.6" r="0.8" fill="#FFFFFF"></circle>
    <circle cx="49.8" cy="20.6" r="0.8" fill="#FFFFFF"></circle>
    <path d="M32 30q7 5 14 0" stroke="#1E6B3A" stroke-width="1.6" fill="none" stroke-linecap="round"></path>
    <path d="M27 44q-3 3 1 3h5q2-1 0-3zM51 44q3 3-1 3h-5q-2-1 0-3z" fill="#3FA85A"></path>
    <circle cx="62" cy="38" r="2.2" fill="#FF8A5B"></circle>
    <circle cx="64.5" cy="36.5" r="1.6" fill="#FFB38A"></circle>
  </svg>`,
  nevoa: `<svg aria-hidden="true" width="40" height="40" viewBox="0 0 40 40" class="nudge-theme-icon">
    <defs><linearGradient id="nv-wing-nudge" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F3EEFF"></stop><stop offset="0.45" stop-color="#A7C8FF"></stop><stop offset="1" stop-color="#FF9AD5"></stop></linearGradient></defs>
    <path d="M19 19C14 6 3 4 4 12c1 6 8 8 15 8zM21 19C26 6 37 4 36 12c-1 6-8 8-15 8z" fill="url(#nv-wing-nudge)"></path>
    <path d="M19 21C13 23 8 30 12 33c3 2 7-4 7-11zM21 21c6 2 11 9 7 12-3 2-7-4-7-11z" fill="url(#nv-wing-nudge)" opacity="0.85"></path>
    <path d="M20 13v20" stroke="#2A1A55" stroke-width="1.8" stroke-linecap="round"></path>
  </svg>`,
  sombra: `<svg aria-hidden="true" width="44" height="34" viewBox="0 0 44 34" class="nudge-theme-icon" style="filter: drop-shadow(0 0 6px rgba(46, 197, 255, 0.55))">
    <path d="M2 32c6-2 8-10 6-16 6 4 8 10 8 14 2-8 8-14 14-16-2 6 0 12 4 16 2-6 6-10 10-10-4 4-4 10-2 12z" fill="#251C40"></path>
    <path d="M22 2 24 10 32 12 24 14 22 22 20 14 12 12 20 10z" fill="#6FDFFF"></path>
  </svg>`,
};

function buildNudgeCard(title, sub) {
  const card = document.createElement('div');
  card.className = 'sidebar-nudge-card';
  const icon = NUDGE_THEME_ICONS[document.documentElement.getAttribute('data-theme')] || '';
  card.innerHTML = `
    ${icon}
    <strong>${escapeHtml(title)}</strong>
    <span>${escapeHtml(sub)}</span>
    <button type="button" class="primary">Copiar convite</button>
  `;
  card.querySelector('button').addEventListener('click', copyServerInviteCode);
  return card;
}

// chave aleatoria (EVP) - nao carrega CPF/celular/e-mail, so pra doacao
const PIX_KEY = 'ec5eca4b-d5a4-4178-b9d1-5070d2b50171';

// aparece/some em ciclo (em vez de ficar sempre visível) pra não parecer
// que tá cobrando o tempo todo - visível por 2min, some por 15min, repete.
// Controla a visibilidade de QUALQUER card já montado no DOM (não refaz o
// render), então funciona mesmo que renderMemberSidebar/renderCallMemberSidebar
// não rodem de novo nesse meio tempo.
const SUPPORT_CARD_VISIBLE_MS = 2 * 60 * 1000;
const SUPPORT_CARD_HIDDEN_MS = 15 * 60 * 1000;
let supportCardVisible = true;
function applySupportCardVisibility() {
  document.querySelectorAll('.sidebar-support-card').forEach((el) => {
    el.classList.toggle('hidden', !supportCardVisible);
  });
}
function scheduleSupportCardCycle() {
  setTimeout(() => {
    supportCardVisible = !supportCardVisible;
    applySupportCardVisibility();
    scheduleSupportCardCycle();
  }, supportCardVisible ? SUPPORT_CARD_VISIBLE_MS : SUPPORT_CARD_HIDDEN_MS);
}
scheduleSupportCardCycle();

function buildSupportCard() {
  const card = document.createElement('div');
  card.className = supportCardVisible ? 'sidebar-support-card' : 'sidebar-support-card hidden';
  card.innerHTML = `
    <strong>Ajude a manter o Ribbit no ar</strong>
    <span>Sua doação via Pix ajuda a pagar os custos do servidor.</span>
    <img src="/pix-qr.png" alt="QR code Pix pra doação" class="support-qr" />
    <button type="button" class="ghost">Copiar chave Pix</button>
  `;
  card.querySelector('button').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(PIX_KEY);
      showToast('Chave Pix copiada!', 2000);
    } catch {
      showToast(`Chave Pix: ${PIX_KEY}`, 4000);
    }
  });
  return card;
}

function renderCallMemberSidebar() {
  const occupants = voiceChannelOccupants(activeVoiceChannel.id);
  const occupantIds = new Set(occupants.map((o) => o.id));
  const onlineIds = serverPresenceChannel
    ? new Set(Object.keys(serverPresenceChannel.presenceState()))
    : new Set();
  const offline = [];
  for (const m of serverMembersCache) {
    if (occupantIds.has(m.user_id)) continue; // já aparece em "Na call"
    if (recentlyInVoiceChannel(m.user_id, activeVoiceChannel.id)) continue; // presence ainda sincronizando
    if (onlineIds.has(m.user_id)) continue;
    const profile = m.profiles || {};
    offline.push({ id: m.user_id, name: profile.display_name || 'Convidado', avatar: profile.avatar_url, lastSeenAt: profile.last_seen_at });
  }

  els.memberList.innerHTML = '';
  const addGroup = (title, members, isCallGroup) => {
    if (!members.length) return;
    const groupTitle = document.createElement('div');
    groupTitle.className = 'channel-group-title';
    groupTitle.textContent = `${title} — ${members.length}`;
    els.memberList.appendChild(groupTitle);
    for (const member of members) {
      const row = buildPersonRow(member, { online: isCallGroup });
      if (!isCallGroup) row.style.opacity = '0.5';
      else if (member.sharingScreen) {
        const badge = document.createElement('span');
        badge.className = 'voice-channel-live-badge';
        badge.textContent = 'AO VIVO';
        row.querySelector('.person-actions').appendChild(badge);
      }
      els.memberList.appendChild(row);
    }
  };
  addGroup('Na call', occupants, true);
  addGroup('Offline', offline, false);

  if (state.screen.sharing) {
    const watching = lkRoom ? lkRoom.remoteParticipants.size : 0;
    if (watching === 0) {
      els.memberList.appendChild(buildNudgeCard('Transmitindo sozinho?', 'Manda o convite e a galera já entra assistindo.'));
    }
  }
  els.memberList.appendChild(buildSupportCard());
}

async function fetchChannels(serverId) {
  const { data, error } = await window.supabaseClient
    .from('channels')
    .select('*')
    .eq('server_id', serverId)
    .order('position', { ascending: true });
  // mesmo cuidado de fetchServerMembers: descarta resposta de um servidor
  // que não é mais o selecionado (troca rápida de servidor pode fazer a
  // resposta antiga chegar depois da nova).
  if (serverId !== activeServerId) return;
  activeChannels = error ? [] : (data || []);
  if (error) console.error('Erro ao buscar canais:', error);
  renderChannelList();
}

function renderChannelList() {
  els.roomGrid.innerHTML = '';
  if (!activeServerId) return;
  const groups = [
    { type: 'text', title: 'Texto', icon: ICONS.message, channels: activeChannels.filter((c) => c.type === 'text') },
    { type: 'voice', title: 'Voz', icon: ICONS.volume, channels: activeChannels.filter((c) => c.type === 'voice') },
  ];
  for (const group of groups) {
    const title = document.createElement('div');
    title.className = 'channel-group-title';
    title.innerHTML = `<span>${group.title}</span>`;
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'channel-group-add';
    addBtn.title = `Criar canal de ${group.title.toLowerCase()}`;
    addBtn.innerHTML = ICONS.plus;
    addBtn.addEventListener('click', () => openCreateChannelModal(group.type));
    title.appendChild(addBtn);
    els.roomGrid.appendChild(title);
    for (const channel of group.channels) {
      const isActive =
        (channel.type === 'text' && activeTextChannel && activeTextChannel.id === channel.id) ||
        (channel.type === 'voice' && activeVoiceChannel && activeVoiceChannel.id === channel.id);
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'channel-row' + (isActive ? ' active-channel' : '');
      row.innerHTML = `${group.icon}<span>${escapeHtml(channel.name)}</span>`;
      row.addEventListener('click', () => openChannel(channel));

      if (channel.type === 'voice') {
        const occupants = voiceChannelOccupants(channel.id);
        const block = document.createElement('div');
        block.className = 'voice-channel-block';
        block.appendChild(row);
        if (occupants.length) {
          const roster = document.createElement('div');
          roster.className = 'voice-channel-roster';
          for (const person of occupants) {
            const personRow = document.createElement('div');
            personRow.className = 'voice-channel-person';
            personRow.innerHTML = `
              <img class="voice-channel-person-avatar" src="${person.avatar || DEFAULT_AVATAR}" alt="" />
              <span class="voice-channel-person-name">${escapeHtml(person.name || 'Convidado')}</span>
              ${person.sharingScreen ? '<span class="voice-channel-live-badge">AO VIVO</span>' : ''}
            `;
            roster.appendChild(personRow);
          }
          block.appendChild(roster);
        } else {
          row.innerHTML += '<span class="voice-channel-empty-hint">vazio</span>';
        }
        els.roomGrid.appendChild(block);
      } else {
        els.roomGrid.appendChild(row);
      }
    }
  }
}

// Quem está em qual canal de voz, pra mostrar o mini-roster com badge "AO
// VIVO" direto na lista de canais (sem precisar entrar na call pra ver) —
// lê da presença POR SERVIDOR (todo mundo olhando o servidor assina, não
// só quem já está na call), estendida com voiceChannelId/sharingScreen em
// retrackServerPresence().
// quando alguém entra numa call, o presence dos OUTROS clientes demora um
// instante pra sincronizar (round-trip pelo Supabase Realtime) - nesse
// intervalo, voiceChannelOccupants ainda não acha a pessoa, e ela cai na
// lista de "Offline" por engano (serverMembersCache não sabe de call
// nenhuma, só lista todo mundo que não está marcado como online). Guarda
// a última vez que cada um foi visto de verdade nessa call pra dar uma
// margem antes de chutar "offline" só por causa do atraso do sync.
const voiceOccupancyLastSeen = new Map(); // userId -> { channelId, ts }
const VOICE_OCCUPANCY_GRACE_MS = 4000;

function recentlyInVoiceChannel(userId, channelId) {
  const seen = voiceOccupancyLastSeen.get(userId);
  return !!seen && seen.channelId === channelId && Date.now() - seen.ts < VOICE_OCCUPANCY_GRACE_MS;
}

function voiceChannelOccupants(channelId) {
  const out = [];
  const seenIds = new Set();
  // minha própria entrada vem sempre do estado LOCAL (activeVoiceChannel/
  // state.screen.sharing), nunca do cache remoto de presença — o cache só
  // atualiza depois de um round-trip pro servidor, então logo após sair de
  // uma call (ou entrar), minha própria leitura remota fica desatualizada
  // por um instante (às vezes mais, se o sync atrasar) e eu continuava
  // aparecendo preso na call pra mim mesmo. Assim minha parte fica sempre
  // certa na hora; só o resto da galera depende do presence sincronizado.
  if (currentUser && activeVoiceChannel && activeVoiceChannel.id === channelId) {
    out.push({
      id: currentUser.id,
      name: currentProfile ? currentProfile.display_name : 'Convidado',
      avatar: currentProfile ? currentProfile.avatar_url : null,
      sharingScreen: state.screen.sharing,
    });
    seenIds.add(currentUser.id);
  }
  if (serverPresenceChannel) {
    const state_ = serverPresenceChannel.presenceState();
    for (const [userId, metas] of Object.entries(state_)) {
      if (userId === currentUser.id) continue; // já tratado acima com o estado local
      const meta = metas[0];
      if (meta && meta.voiceChannelId === channelId) {
        out.push({ id: userId, ...meta });
        seenIds.add(userId);
        voiceOccupancyLastSeen.set(userId, { channelId, ts: Date.now() });
      }
    }
  }
  // Rede de segurança: se EU estou nessa mesma call agora, o roster do
  // próprio LiveKit (lkRoom.remoteParticipants) é fonte de verdade mais
  // confiável que a presença do Supabase pra "quem está na call" - essa
  // presença depende de um canal Realtime À PARTE (server:<serverId>) que
  // pode ficar preso/atrasado (rede ruim, janela minimizada etc.) sem que a
  // pessoa tenha de fato saído da call de verdade. O LiveKit em si nunca
  // mente sobre quem está conectado na sala - usa pra completar quem o
  // presence ainda não pegou, nunca pra remover ninguém.
  if (lkRoom && activeVoiceChannel && activeVoiceChannel.id === channelId) {
    for (const participant of lkRoom.remoteParticipants.values()) {
      if (seenIds.has(participant.identity)) continue;
      const info = memberInfo(participant.identity);
      out.push({
        id: participant.identity,
        name: info.name,
        avatar: info.avatar,
        sharingScreen: participant.isScreenShareEnabled,
      });
      seenIds.add(participant.identity);
      voiceOccupancyLastSeen.set(participant.identity, { channelId, ts: Date.now() });
    }
  }
  return out;
}

/* ---------------- modal: criar canal ---------------- */

let createChannelType = 'text';

function openCreateChannelModal(type) {
  createChannelType = type;
  els.channelModalTitle.textContent = `Criar canal de ${type === 'voice' ? 'voz' : 'texto'}`;
  els.channelNameInput.value = '';
  els.channelModalError.classList.add('hidden');
  els.channelModal.classList.remove('hidden');
  els.channelNameInput.focus();
}
function closeChannelModal() {
  els.channelModal.classList.add('hidden');
}
els.channelModalClose.addEventListener('click', closeChannelModal);

els.channelCreateBtn.addEventListener('click', async () => {
  const name = els.channelNameInput.value.trim();
  if (!name) {
    els.channelModalError.textContent = 'Dá um nome pro canal.';
    els.channelModalError.classList.remove('hidden');
    return;
  }
  const samType = activeChannels.filter((c) => c.type === createChannelType);
  const nextPosition = samType.length ? Math.max(...samType.map((c) => c.position)) + 1 : 0;
  els.channelCreateBtn.disabled = true;
  try {
    const { error } = await window.supabaseClient
      .from('channels')
      .insert({ server_id: activeServerId, name, type: createChannelType, position: nextPosition });
    if (error) throw error;
    closeChannelModal();
    await fetchChannels(activeServerId);
  } catch (err) {
    els.channelModalError.textContent = err.message || 'Não deu pra criar o canal.';
    els.channelModalError.classList.remove('hidden');
  } finally {
    els.channelCreateBtn.disabled = false;
  }
});

/* ---------------- modal: configurações do servidor ---------------- */

function openServerSettingsModal() {
  const server = myServers.find((s) => s.id === activeServerId);
  if (!server) return;
  const isOwner = server.owner_id === currentUser.id;
  els.serverIconPreview.src = server.icon_url || DEFAULT_AVATAR;
  els.serverSettingsNameInput.value = server.name;
  els.serverSettingsNameInput.disabled = !isOwner;
  els.serverIconLabel.classList.toggle('hidden', !isOwner);
  els.serverSettingsSaveBtn.classList.toggle('hidden', !isOwner);
  els.serverSettingsInviteCode.value = server.invite_code;
  els.serverSettingsError.classList.add('hidden');
  els.leaveServerBtn.classList.toggle('hidden', isOwner);
  els.deleteServerBtn.classList.toggle('hidden', !isOwner);
  // sempre abre na aba "Geral" - evita abrir já em "Avançado" se foi a
  // última aba vista da vez anterior.
  els.serverSettingsTabs.forEach((t) => t.classList.toggle('active', t.dataset.serverTab === 'general'));
  els.serverSettingsTabPanels.forEach((p) => p.classList.toggle('active', p.dataset.serverPanel === 'general'));
  els.serverSettingsTabTitle.textContent = 'Geral';
  els.serverSettingsTabSub.textContent = 'Nome e ícone do servidor';
  els.serverSettingsModal.classList.remove('hidden');
}
function closeServerSettingsModal() {
  els.serverSettingsModal.classList.add('hidden');
}
els.serverSettingsBtn.addEventListener('click', openServerSettingsModal);
els.serverSettingsModalClose.addEventListener('click', closeServerSettingsModal);
els.serverSettingsTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    const name = tab.dataset.serverTab;
    els.serverSettingsTabs.forEach((t) => t.classList.toggle('active', t === tab));
    els.serverSettingsTabPanels.forEach((p) => p.classList.toggle('active', p.dataset.serverPanel === name));
    els.serverSettingsTabTitle.textContent = tab.dataset.title;
    els.serverSettingsTabSub.textContent = tab.dataset.sub;
  });
});

function showServerSettingsError(text) {
  els.serverSettingsError.textContent = text;
  els.serverSettingsError.classList.remove('hidden');
}

els.serverSettingsSaveBtn.addEventListener('click', async () => {
  const name = els.serverSettingsNameInput.value.trim();
  if (!name) { showServerSettingsError('Dá um nome pro servidor.'); return; }
  els.serverSettingsSaveBtn.disabled = true;
  try {
    const { error } = await window.supabaseClient
      .from('servers')
      .update({ name })
      .eq('id', activeServerId);
    if (error) throw error;
    closeServerSettingsModal();
    await fetchMyServers();
  } catch (err) {
    showServerSettingsError(err.message || 'Não deu pra salvar.');
  } finally {
    els.serverSettingsSaveBtn.disabled = false;
  }
});

// sem handler de clique no label de propósito: um <label> que envolve um
// <input type=file> já abre o seletor de arquivo sozinho (igual o avatar
// de perfil, que nunca teve esse handler). Um handler aqui que chamava
// manualmente .click() + preventDefault() causava um bug sutil: o clique
// sintético de .click() borbulha de volta pro label (que é ancestral do
// input), reaciona o MESMO listener, e o preventDefault() incondicional
// cancelava o próprio diálogo nativo que tinha acabado de ser disparado -
// por isso clicar em "Trocar ícone" não abria nada.
let serverIconUploadBusy = false;
els.serverIconInput.addEventListener('change', async () => {
  const file = els.serverIconInput.files[0];
  els.serverIconInput.value = '';
  if (!file) return;
  if (serverIconUploadBusy) {
    showServerSettingsError('Já tem um ícone sendo enviado, espera terminar.');
    return;
  }
  serverIconUploadBusy = true;
  els.serverSettingsError.classList.add('hidden');
  try {
    // redimensiona/comprime igual avatar/banner (ícone só aparece a
    // 42px, não faz sentido guardar/servir a foto original de alguns
    // MB) e usa path FIXO (sempre .jpg, sem timestamp) pra upsert
    // sobrescrever de verdade em vez de deixar a versão antiga pra trás
    // vazando o Storage grátis - mesma lição do avatar/banner.
    const blob = await resizeImageToBlob(file, 256, 256);
    const path = `server-icons/${activeServerId}.jpg`;
    const { error: uploadError } = await withTimeout(
      window.supabaseClient.storage.from('avatars').upload(path, blob, { upsert: true, contentType: 'image/jpeg', cacheControl: '60' }),
      20000,
      'enviar ícone',
    );
    if (uploadError) throw uploadError;
    const { data: publicUrlData } = window.supabaseClient.storage.from('avatars').getPublicUrl(path);
    const { error: updateError } = await window.supabaseClient
      .from('servers')
      .update({ icon_url: publicUrlData.publicUrl })
      .eq('id', activeServerId);
    if (updateError) throw updateError;
    els.serverIconPreview.src = `${publicUrlData.publicUrl}?t=${Date.now()}`;
    // "?t=" também aqui - sem isso o rail de servidores (renderServerRail)
    // mostra a URL crua e só atualizaria quando o cache de 60s expirasse,
    // mesmo pra quem acabou de trocar o próprio ícone agorinha.
    serverIconCacheBust.set(activeServerId, Date.now());
    await fetchMyServers();
  } catch (err) {
    showServerSettingsError(err.message || 'Não deu pra trocar o ícone.');
  } finally {
    serverIconUploadBusy = false;
  }
});

// Link em vez de código cru: clicando, a pessoa cai numa página que tenta
// abrir o app direto (se já tiver instalado) ou mostra onde baixar - sem
// precisar copiar/colar um código na mão. O código cru pasted continua
// funcionando em "Entrar com código" (extractInviteCodeFromText aceita os dois).
// repo/Pages do GitHub continuam com o nome antigo por enquanto (renomear o
// repo é uma decisão separada - afeta o updater de quem já tem o app
// instalado) - só a MARCA (nome exibido, protocolo ribbit://, e-mails) virou
// "Ribbit" nessa leva.
const INVITE_WEB_BASE = 'https://doug3011.github.io/suvaco-da-jinx/invite.html';
function buildInviteLink(code) {
  return `${INVITE_WEB_BASE}?c=${code}`;
}

els.serverSettingsCopyInviteBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(els.serverSettingsInviteCode.value);
    showToast('Código de convite copiado!', 2000);
  } catch {
    /* clipboard sem permissão - o campo já mostra o código pra copiar na mão */
  }
});
els.serverSettingsCopyInviteLinkBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(buildInviteLink(els.serverSettingsInviteCode.value));
    showToast('Link de convite copiado!', 2000);
  } catch {
    /* clipboard sem permissão - o campo já mostra o código pra copiar na mão */
  }
});

els.leaveServerBtn.addEventListener('click', async () => {
  if (!confirm('Sair desse servidor? Você vai precisar de um novo convite pra voltar.')) return;
  const { error } = await window.supabaseClient
    .from('server_members')
    .delete()
    .eq('server_id', activeServerId)
    .eq('user_id', currentUser.id);
  if (error) { showServerSettingsError(error.message); return; }
  closeServerSettingsModal();
  activeServerId = null;
  await fetchMyServers();
});

els.deleteServerBtn.addEventListener('click', async () => {
  const server = myServers.find((s) => s.id === activeServerId);
  if (!server) return;
  if (!confirm(`Apagar o servidor "${server.name}" de vez? Isso remove os canais e mensagens de todo mundo. Não tem como desfazer.`)) return;
  const { error } = await window.supabaseClient.from('servers').delete().eq('id', activeServerId);
  if (error) { showServerSettingsError(error.message); return; }
  closeServerSettingsModal();
  activeServerId = null;
  await fetchMyServers();
});

// A barra de servidores/canais fica sempre visível (igual Discord) - só o
// conteúdo principal troca entre o painel de boas-vindas, o canal de texto
// e a sala de voz. Entrar num canal de texto NÃO sai de uma chamada de voz
// em andamento (ela continua rodando em segundo plano, só escondida).
let currentMainPanel = null;
function showMainPanel(panel) {
  currentMainPanel = panel;
  els.welcomePanel.classList.toggle('hidden', panel !== 'friends');
  els.dmChannel.classList.toggle('hidden', panel !== 'dm');
  els.textChannel.classList.toggle('hidden', panel !== 'text');
  els.room.classList.toggle('hidden', panel !== 'voice');
  renderMemberSidebar();
}

function openChannel(channel) {
  if (channel.type === 'text') {
    openTextChannel(channel);
    return;
  }
  // ja estou conectado nesse MESMO canal de voz - so' volta pra tela dele
  // em vez de tentar entrar de novo (o Realtime nao deixa assinar o mesmo
  // canal duas vezes, e ficava sem voltar pra tela nenhuma).
  if (activeVoiceChannel && activeVoiceChannel.id === channel.id) {
    showMainPanel('voice');
    return;
  }
  // trocando de canal de voz enquanto ja estava em outro - sai do atual antes
  if (activeVoiceChannel) leaveRoom();
  joinVoiceChannel(channel);
}

/* ---------------- canal de texto: mensagens persistidas (Supabase) ----------------
   Historico vem de uma tabela de verdade (nao mais memoria/disco local do
   host) e atualiza em tempo real via postgres_changes - todo mundo que
   tiver o canal aberto ve a mensagem nova sem precisar recarregar. */

let activeTextChannel = null;
let textChannelRealtime = null;
let reactionsRealtime = null;
let textChannelLastAuthorId = null;
let textChannelLastAt = null;
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
  const createdAt = new Date(row.created_at);
  const grouped =
    textChannelLastAuthorId === row.author_id &&
    textChannelLastAt &&
    createdAt - textChannelLastAt < MESSAGE_GROUP_WINDOW_MS;
  textChannelLastAuthorId = row.author_id;
  textChannelLastAt = createdAt;

  const wrap = document.createElement('div');
  wrap.className = 'chat-msg' + (isSelf ? ' self' : '') + (grouped ? ' chat-msg-grouped' : '');
  wrap.dataset.messageId = row.id;
  wrap.innerHTML = `
    <img class="chat-msg-avatar" src="${avatar}" alt="" />
    <div class="chat-msg-body">
      <div class="chat-msg-meta">
        <span class="chat-msg-name">${escapeHtml(name)}</span>
        <span class="chat-msg-time">${time}</span>
      </div>
      ${row.content ? `<div class="chat-msg-text">${escapeHtml(row.content)}</div>` : ''}
      <div class="chat-msg-reactions"></div>
    </div>
  `;
  if (row.attachment_id) wrap.querySelector('.chat-msg-body').appendChild(renderAttachmentBlock(row, row.author_id));
  wrap.appendChild(buildQuickReactBar(row.id));
  renderReactionPills(wrap.querySelector('.chat-msg-reactions'), row.id);
  els.textChannelMessages.appendChild(wrap);
  els.textChannelMessages.scrollTop = els.textChannelMessages.scrollHeight;

  if (!isSelf && state.settings.chatNotifications) {
    notifyChatMessage({ name, avatar, text: row.content });
  }
}

function renderTextChannelWelcome(channel) {
  const wrap = document.createElement('div');
  wrap.className = 'channel-welcome';
  wrap.innerHTML = `
    <div class="channel-welcome-icon">#</div>
    <h2>Bem-vindo ao #${escapeHtml(channel.name)}!</h2>
    <p>Esse é o começo do canal. Chama a galera e puxa assunto.</p>
    <div class="channel-welcome-actions">
      <button type="button" class="ghost" data-action="invite">Convidar amigos</button>
      <button type="button" class="ghost" data-action="join-call">Entrar na call</button>
      <button type="button" class="ghost" data-action="share-screen">Transmitir tela</button>
    </div>
  `;
  wrap.querySelector('[data-action="invite"]').addEventListener('click', copyServerInviteCode);
  wrap.querySelector('[data-action="join-call"]').addEventListener('click', () => {
    const voiceChannel = activeChannels.find((c) => c.type === 'voice');
    if (voiceChannel) joinVoiceChannel(voiceChannel);
  });
  wrap.querySelector('[data-action="share-screen"]').addEventListener('click', () => {
    const voiceChannel = activeChannels.find((c) => c.type === 'voice');
    if (!voiceChannel) return;
    joinVoiceChannel(voiceChannel);
    setTimeout(() => startScreenShare(), 400);
  });
  return wrap;
}

async function openTextChannel(channel) {
  activeTextChannel = channel;
  renderChannelList();
  els.textChannelName.textContent = channel.name;
  els.textChannelMessages.innerHTML = '';
  els.textChannelMessages.appendChild(renderTextChannelWelcome(channel));
  textChannelLastAuthorId = null;
  textChannelLastAt = null;
  reactionsCache.clear();
  for (const p of typingPeers.values()) clearTimeout(p.timeout);
  typingPeers.clear();
  renderTypingIndicator();
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
    await fetchReactionsFor(data.map((r) => r.id));
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
    .on('broadcast', { event: 'typing' }, ({ payload }) => {
      if (payload.userId !== currentUser.id) onPeerTyping(payload.userId, payload.name);
    })
    .subscribe();

  // Canal SEPARADO do de mensagens de propósito: se a tabela message_reactions
  // não existir ainda (usuário não rodou a migração), isso falha sozinho sem
  // arriscar derrubar a subscrição de mensagens/digitando junto (confirmado
  // em teste - um .on() de postgres_changes pra tabela inexistente quebrava
  // a subscrição INTEIRA do canal que a continha, inclusive o resto).
  if (reactionsRealtime) window.supabaseClient.removeChannel(reactionsRealtime);
  reactionsRealtime = window.supabaseClient
    .channel(`reactions:${channel.id}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'message_reactions' }, (payload) => {
      // sem filtro no banco (reactions não tem channel_id direto) - só
      // aplica se a mensagem estiver realmente aberta neste canal agora.
      const row = payload.eventType === 'DELETE' ? payload.old : payload.new;
      if (row && document.querySelector(`.chat-msg[data-message-id="${row.message_id}"]`)) onReactionChange(payload);
    })
    .subscribe();
}

/* ---------------- "fulano está digitando..." (canal de texto) ----------------
   Broadcast efêmero no MESMO canal realtime das mensagens - nada
   persistido, cada evento só avisa "ainda digitando" por alguns segundos;
   sem novo evento nesse intervalo, considera que parou. */
const typingPeers = new Map(); // userId -> { name, timeout }
const TYPING_TIMEOUT_MS = 4000;
const TYPING_SEND_THROTTLE_MS = 2000;

function renderTypingIndicator() {
  const names = [...typingPeers.values()].map((p) => p.name);
  if (!names.length) {
    els.textChannelTypingIndicator.classList.add('hidden');
    return;
  }
  const text = names.length === 1 ? `${names[0]} está digitando…` : `${names.join(', ')} estão digitando…`;
  els.textChannelTypingIndicator.innerHTML = `<span class="chat-typing-dots"><span></span><span></span><span></span></span>${escapeHtml(text)}`;
  els.textChannelTypingIndicator.classList.remove('hidden');
}
function onPeerTyping(userId, name) {
  const existing = typingPeers.get(userId);
  if (existing) clearTimeout(existing.timeout);
  const timeout = setTimeout(() => {
    typingPeers.delete(userId);
    renderTypingIndicator();
  }, TYPING_TIMEOUT_MS);
  typingPeers.set(userId, { name, timeout });
  renderTypingIndicator();
}

let lastTypingSentAt = 0;
els.textChannelTextInput.addEventListener('input', () => {
  if (!activeTextChannel || !textChannelRealtime) return;
  const now = Date.now();
  if (now - lastTypingSentAt < TYPING_SEND_THROTTLE_MS) return;
  lastTypingSentAt = now;
  textChannelRealtime.send({
    type: 'broadcast',
    event: 'typing',
    payload: { userId: currentUser.id, name: currentProfile ? currentProfile.display_name : 'Convidado' },
  });
});

function closeTextChannel() {
  if (textChannelRealtime) {
    window.supabaseClient.removeChannel(textChannelRealtime);
    textChannelRealtime = null;
  }
  if (reactionsRealtime) {
    window.supabaseClient.removeChannel(reactionsRealtime);
    reactionsRealtime = null;
  }
  activeTextChannel = null;
}

let textChannelPendingFile = null;
function renderTextChannelPendingAttachment() {
  els.textChannelPendingAttachments.classList.toggle('hidden', !textChannelPendingFile);
  if (!textChannelPendingFile) { els.textChannelPendingAttachments.innerHTML = ''; return; }
  els.textChannelPendingAttachments.innerHTML = `
    <span class="chat-pending-chip">
      <span>${escapeHtml(textChannelPendingFile.name)}</span>
      <span class="chat-pending-size">${formatAttachmentSize(textChannelPendingFile.size)}</span>
      <button type="button" class="chat-pending-remove">${ICONS.close}</button>
    </span>
  `;
  els.textChannelPendingAttachments.querySelector('.chat-pending-remove').addEventListener('click', () => {
    textChannelPendingFile = null;
    renderTextChannelPendingAttachment();
  });
}
els.textChannelAttachBtn.addEventListener('click', () => els.textChannelFileInput.click());
els.textChannelFileInput.addEventListener('change', async () => {
  const file = els.textChannelFileInput.files[0];
  els.textChannelFileInput.value = '';
  if (!file) return;
  if (file.size > ATTACH_MAX_BYTES) {
    showToast('Esse arquivo é maior que 100MB — escolhe um menor.', 3000);
    return;
  }
  const kind = classifyAttachmentKind(file.type);
  const blob = kind === 'image' ? await compressAttachmentImage(file) : file;
  textChannelPendingFile = { id: crypto.randomUUID(), name: file.name, mime: file.type || 'application/octet-stream', size: blob.size, kind, blob };
  renderTextChannelPendingAttachment();
});

els.textChannelForm.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const content = els.textChannelTextInput.value.trim();
  if ((!content && !textChannelPendingFile) || !activeTextChannel) return;
  els.textChannelTextInput.value = '';
  const pending = textChannelPendingFile;
  textChannelPendingFile = null;
  renderTextChannelPendingAttachment();
  const insertRow = { channel_id: activeTextChannel.id, author_id: currentUser.id, content };
  if (pending) {
    localAttachments.set(pending.id, pending.blob);
    Object.assign(insertRow, {
      attachment_id: pending.id,
      attachment_name: pending.name,
      attachment_mime: pending.mime,
      attachment_size: pending.size,
      attachment_kind: pending.kind,
    });
  }
  const { error } = await window.supabaseClient.from('messages').insert(insertRow);
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

async function joinServerByCode(code) {
  const { data: serverId, error } = await window.supabaseClient.rpc('join_server_by_code', { code });
  if (error) throw error;
  await fetchMyServers();
  selectServer(serverId);
  return serverId;
}

els.serverJoinBtn.addEventListener('click', async () => {
  // aceita colar o link inteiro (ribbit://join/codigo ou a página
  // web de convite com ?c=codigo) em vez de só o código cru, pra não
  // confundir quem recebeu o link e tentou colar ele aqui por engano.
  const raw = els.serverJoinCodeInput.value.trim();
  const code = extractInviteCodeFromText(raw);
  if (!code) { showServerModalError('Digita o código de convite.'); return; }
  els.serverJoinBtn.disabled = true;
  try {
    await joinServerByCode(code);
    closeServerModal();
  } catch (err) {
    showServerModalError(err.message || 'Código inválido.');
  } finally {
    els.serverJoinBtn.disabled = false;
  }
});

function extractInviteCodeFromText(raw) {
  if (!raw) return '';
  // aceita os dois esquemas: ribbit:// (atual) e suvacodajinx:// (links
  // antigos que alguém ainda tenha guardado/compartilhado por aí).
  const protocolMatch = /(?:ribbit|suvacodajinx):\/\/join\/([a-zA-Z0-9]+)/.exec(raw);
  if (protocolMatch) return protocolMatch[1].toLowerCase();
  const webMatch = /[?&]c=([a-zA-Z0-9]+)/.exec(raw);
  if (webMatch) return webMatch[1].toLowerCase();
  return raw.trim().toLowerCase();
}

// link de convite (ribbit://join/<codigo>), vindo do processo
// principal (clique no link com o app já aberto, ou acabou de abrir por
// causa do link). Se ainda não tiver logado quando o link chega, guarda e
// processa assim que o login terminar.
let pendingInviteCode = null;
if (isElectron && window.telaNative.onJoinByCode) {
  window.telaNative.onJoinByCode((code) => {
    if (currentUser) {
      joinServerByCode(code).then(() => showToast('Você entrou no servidor pelo link de convite!')).catch((err) => {
        showToast(err.message || 'Link de convite inválido.', 3500);
      });
    } else {
      pendingInviteCode = code;
    }
  });
}

els.copyInviteBtn.addEventListener('click', copyServerInviteCode);

let activeVoiceChannel = null;

function connectionQualityLabel(q) {
  const LK = window.LivekitClient;
  const CQ = LK && LK.ConnectionQuality;
  if (!CQ) return '—';
  if (q === CQ.Excellent) return 'excelente';
  if (q === CQ.Good) return 'boa';
  if (q === CQ.Poor) return 'ruim';
  if (q === CQ.Lost) return 'perdida';
  return '—';
}

let voiceConnectedTimer = null;
function updateVoiceConnectedPanel() {
  if (!activeVoiceChannel) {
    els.voiceConnectedPanel.classList.add('hidden');
    return;
  }
  els.voiceConnectedPanel.classList.remove('hidden');
  const q = lkRoom ? lkRoom.localParticipant.connectionQuality : null;
  els.voiceConnectedDetail.textContent = `${activeVoiceChannel.name} · ${q != null ? connectionQualityLabel(q) : '—'}`;
}
function startVoiceConnectedLoop() {
  if (voiceConnectedTimer) return;
  voiceConnectedTimer = setInterval(updateVoiceConnectedPanel, 3000);
}
startVoiceConnectedLoop();

async function joinVoiceChannel(channel) {
  activeVoiceChannel = channel;
  renderChannelList();
  retrackServerPresence();
  updateVoiceConnectedPanel();
  const myId = currentUser.id;
  state.myName = currentProfile ? currentProfile.display_name : 'Convidado';

  const LK = window.LivekitClient;
  const room = new LK.Room({ adaptiveStream: false, dynacast: true });
  setupLiveKitRoomEvents(room);
  room.on(LK.RoomEvent.ConnectionQualityChanged, (quality, participant) => {
    if (participant.isLocal) updateVoiceConnectedPanel();
  });

  let token;
  try {
    token = await fetchLiveKitToken(channel.id);
    await room.connect('wss://ribbit-b6l1aajo.livekit.cloud', token);
  } catch (err) {
    console.error('não consegui entrar na call:', err);
    showToast('Não consegui entrar na call agora. Tenta de novo em alguns segundos.', 3500);
    activeVoiceChannel = null;
    renderChannelList();
    retrackServerPresence();
    updateVoiceConnectedPanel();
    return;
  }

  lkRoom = room;
  state.myId = myId;
  updatePeopleCount();
  enterRoomScreen(channel.name);
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

async function copyInviteLink(server) {
  try {
    await navigator.clipboard.writeText(buildInviteLink(server.invite_code));
    showToast('Link de convite copiado!');
  } catch {
    showToast(`Código de convite: ${server.invite_code}`);
  }
}
async function copyInviteCode(server) {
  try {
    await navigator.clipboard.writeText(server.invite_code);
    showToast('Código de convite copiado!');
  } catch {
    showToast(`Código de convite: ${server.invite_code}`);
  }
}

// Duas opções porque o link (via GitHub Pages) depende de internet estar
// de pé do lado de quem recebe - se algo der errado com ele, o código cru
// sempre funciona como alternativa (mesmo fluxo de sempre, "Entrar com código").
function openInviteMenu(x, y) {
  const server = myServers.find((s) => s.id === activeServerId);
  if (!server) return;
  openContextMenu(x, y, (menu) => {
    const title = document.createElement('div');
    title.className = 'context-menu-title';
    title.textContent = 'Convidar pro servidor';
    menu.appendChild(title);

    const linkBtn = document.createElement('button');
    linkBtn.type = 'button';
    linkBtn.className = 'context-menu-action';
    linkBtn.textContent = 'Copiar link de convite';
    linkBtn.addEventListener('click', () => { closeContextMenu(); copyInviteLink(server); });
    menu.appendChild(linkBtn);

    const codeBtn = document.createElement('button');
    codeBtn.type = 'button';
    codeBtn.className = 'context-menu-action';
    codeBtn.textContent = 'Copiar código de convite';
    codeBtn.addEventListener('click', () => { closeContextMenu(); copyInviteCode(server); });
    menu.appendChild(codeBtn);
  });
}

function copyServerInviteCode(ev) {
  const anchor = ev && ev.currentTarget && ev.currentTarget.getBoundingClientRect
    ? ev.currentTarget.getBoundingClientRect()
    : null;
  const x = anchor ? anchor.left : (ev ? ev.clientX : window.innerWidth / 2);
  const y = anchor ? anchor.bottom + 6 : (ev ? ev.clientY : window.innerHeight / 2);
  openInviteMenu(x, y);
}
els.inviteBtn.addEventListener('click', copyServerInviteCode);

function leaveRoom() {
  stopScreenShare();
  stopCameraShare();
  stopMicShare();
  exitFocusIfActive();
  if (lkRoom) {
    const room = lkRoom;
    lkRoom = null; // zera antes do disconnect() - o listener de RoomEvent.Disconnected só rechama leaveRoom() se lkRoom ainda apontar pra essa room
    // remove os tiles de quem eu tava assistindo explicitamente, em vez de
    // confiar que TrackUnsubscribed/ParticipantDisconnected disparam a
    // tempo durante o disconnect() - não é garantido, e tile fantasma
    // depois de sair da call seria um bug chato de perceber.
    for (const participant of room.remoteParticipants.values()) removeAllTilesFor(participant.identity);
    room.disconnect();
  }
  remoteStreams.clear();
  duckedMicBaseline.clear(); // tiles já foram removidos acima - não tem volume pra restaurar, só descarta
  state.myId = null;
  activeVoiceChannel = null;
  retrackServerPresence();
  renderChannelList();
  updateVoiceConnectedPanel();
  // volta pro canal de texto ou DM que estava aberto antes (se tinha
  // algum), senao cai na tela de amigos.
  showMainPanel(activeTextChannel ? 'text' : activeDmPeerId ? 'dm' : 'friends');
}

function updateEmptyHint() {
  updateStageMode();
}

// Visão em destaque: quando alguém (eu ou outra pessoa) está transmitindo
// tela, aquele tile vira o "palco" grande (movido pro #stageArea, sem
// recriar o <video> - reparent preserva srcObject/reprodução), e todo
// mundo mais vira uma tira pequena de bolhas abaixo. Sem transmissão
// nenhuma, o palco mostra um convite pra compartilhar e todo mundo fica
// na tira. Câmera sozinha (sem tela) nunca vira "palco" - só compartilhamento
// de tela conta, igual a referência visual que o usuário mandou.
function updateStageMode() {
  const screenEntries = [...state.tiles.entries()].filter(([, t]) => t.source === 'screen');
  let stageEntry = null;
  if (screenEntries.length) {
    stageEntry = screenEntries.find(([k]) => state.pinned && state.pinned.has(k)) || screenEntries[0];
  }
  els.grid.classList.add('strip-mode');
  for (const [key, tile] of state.tiles) {
    if (tile.audioOnly) continue;
    const isStage = stageEntry && stageEntry[0] === key;
    tile.root.classList.toggle('tile-stage', isStage);
    if (isStage) {
      els.stageArea.appendChild(tile.root);
    } else if (tile.root.parentElement !== els.grid) {
      els.grid.appendChild(tile.root);
    }
  }
  els.stageEmpty.classList.toggle('hidden', !!stageEntry);
}

els.stageShareBtn.addEventListener('click', () => {
  if (!state.screen.sharing) startScreenShare();
});

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

// sinalização WebRTC (offer/answer/ICE) não existe mais aqui - é interna ao
// SDK do LiveKit (room.connect()). O que sobra de "mensagem direcionada a
// uma pessoa só" é o handshake+input do controle remoto, que usa
// publishData/DataReceived da própria Room - ver controlHandlers acima e o
// bloco "modo admin" mais abaixo.

/* ---------------- lado de quem assiste ---------------- */

/* ---------------- clipes (buffer giratório dos últimos N segundos) ----------------
   Mesma técnica nos dois sentidos (quem assiste e quem transmite): MediaRecorder
   gravando em pedacinhos de 1s, só guarda os mais recentes (descarta o resto),
   e ao clicar em "Clipar" junta tudo num arquivo só. Zero round-trip de rede -
   grava em cima do stream que já está rodando localmente (decodificado, no
   caso de quem assiste; capturado, no caso de quem transmite).
   Nunca pesa pra quem está sendo assistido (o clipe de quem assiste roda só
   na máquina de quem assiste). Pra quem transmite, é opt-in (Configurações >
   Transmissão) e grava numa cópia reduzida (720p/30fps via <canvas>), não no
   stream de broadcast em si - um encode a mais, mas bem mais leve que gravar
   na resolução/fps cheios. */

function pickClipMimeType() {
  const candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  return candidates.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || 'video/webm';
}

function startRollingClip(stream, bufferSeconds) {
  const mimeType = pickClipMimeType();
  let recorder;
  try {
    recorder = new MediaRecorder(stream, { mimeType });
  } catch {
    return null; // stream sem track de vídeo ainda, ou codec indisponível - sem clipe, sem travar o resto
  }
  const chunks = [];
  recorder.addEventListener('dataavailable', (ev) => {
    if (!ev.data || !ev.data.size) return;
    chunks.push({ blob: ev.data, t: Date.now() });
    const cutoff = Date.now() - bufferSeconds * 1000 - 2000; // 2s de folga, pra sempre ter o período inteiro coberto
    while (chunks.length && chunks[0].t < cutoff) chunks.shift();
  });
  try {
    recorder.start(1000);
  } catch {
    return null;
  }
  return {
    mimeType,
    stop() {
      try {
        if (recorder.state !== 'inactive') recorder.stop();
      } catch {
        /* já pode ter parado sozinho (ex: track encerrada) */
      }
    },
    async save(filenameHint) {
      if (!chunks.length) {
        showToast('Ainda não gravou o suficiente pra clipar — espera uns segundos.');
        return;
      }
      const blob = new Blob(chunks.map((c) => c.blob), { type: mimeType });
      const filename = `${filenameHint}-${new Date().toISOString().replace(/[:.]/g, '-')}.webm`;

      // no Electron, salva de verdade na pasta configurada (padrão
      // Vídeos/Ribbit) via IPC - fora dele (web puro), cai no truque de
      // <a download>, que só sabe jogar na pasta de downloads do navegador.
      if (isElectron && window.telaNative.saveClipFile) {
        try {
          const buffer = await blob.arrayBuffer();
          const result = await window.telaNative.saveClipFile(filename, buffer);
          if (result && result.ok) {
            showToast(`Clipe salvo em ${result.path}`, 4000);
          } else {
            showToast('Não consegui salvar o clipe: ' + (result ? result.error : 'erro desconhecido'), 4000);
          }
        } catch (err) {
          showToast('Não consegui salvar o clipe: ' + err.message, 4000);
        }
        return;
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      showToast('Clipe salvo na pasta de downloads!');
    },
  };
}

// cria uma cópia reduzida (resolução/fps) de uma track de vídeo via <canvas> -
// usado só pro clipe de quem transmite, pra não gravar na resolução/fps
// cheios da transmissão real (mais barato de encodar).
function createDownscaledStream(sourceTrack, targetWidth, targetHeight, fps) {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = new MediaStream([sourceTrack]);
  video.play().catch(() => {});
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');
  const timer = setInterval(() => {
    if (video.readyState >= 2) {
      try {
        ctx.drawImage(video, 0, 0, targetWidth, targetHeight);
      } catch {
        /* frame isolado pode falhar numa troca de resolução - ignora, tenta no próximo */
      }
    }
  }, 1000 / fps);
  const canvasStream = canvas.captureStream(fps);
  return {
    stream: canvasStream,
    stop() {
      clearInterval(timer);
      video.pause();
      video.srcObject = null;
      for (const t of canvasStream.getTracks()) t.stop();
    },
  };
}

const viewerClippers = new Map(); // tileKey -> clipper (ver startRollingClip)

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
            'Sua tela compartilhada parece estar toda preta pros outros. Se for um jogo em tela cheia, troca pro modo "janela sem borda" nas configs gráficas dele (tela cheia exclusiva e vídeo com DRM tipo Netflix sempre saem pretos). Se não for nada disso, geralmente é a placa de vídeo enroscando com transmissão+recepção ao mesmo tempo — clica em "Parar de compartilhar" e compartilha de novo que costuma resolver.',
            11000,
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
  // 'motion' avisa o encoder do Chromium pra priorizar fluidez/FPS sobre
  // nitidez de detalhe estático — o padrão do browser pra captura de tela
  // otimiza pra texto parado, que é o oposto do que se quer transmitindo jogo.
  const screenVideoTrack = display.getVideoTracks()[0];
  if (screenVideoTrack) screenVideoTrack.contentHint = 'motion';
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
    await refreshAppList();
    startAppListRefreshLoop();
    const mixedAudioTrack = appAudio.destination.stream.getAudioTracks()[0];
    state.screen.localTracks = [...display.getVideoTracks(), mixedAudioTrack];
  } else {
    state.screen.localTracks = [...display.getTracks()];
  }

  setBtnLabel(els.shareBtn, 'Parar de compartilhar');
  els.shareBtn.classList.add('active');
  updateInteractiveShareBtnVisibility();

  if (state.settings.clipEnabled && screenVideoTrack) {
    const downscale = createDownscaledStream(screenVideoTrack, 1280, 720, 30);
    state.screen.clipperDownscale = downscale;
    state.screen.clipper = startRollingClip(downscale.stream, 60);
  }
  updateClipBtnVisibility();

  display.getVideoTracks()[0].addEventListener('ended', stopScreenShare);
  state.screen.blackFrameStop = watchForBlackFrames(display.getVideoTracks()[0]);

  addOrUpdateTile(tileKey(state.myId, 'screen'), `${state.myName} (você)`, currentProfile ? currentProfile.avatar_url : null, display, true, 'screen');
  updateEmptyHint();
  publishLocalSource('screen');
  retrackServerPresence();
  renderChannelList();
  renderMemberSidebar();
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

const micMix = { ctx: null, destination: null, micSource: null, micGain: null, rnnoiseNode: null };

// Binário do WASM é cacheado (fetch só na primeira vez que alguém liga o
// RNNoise); já o nó do worklet (RnnoiseWorkletNode) precisa ser recriado
// TODA vez que o mic liga, porque audioWorklet.addModule() é por
// AudioContext, e micMix.ctx é recriado do zero a cada startMicShare.
let rnnoiseWasmBinaryPromise = null;
function getRnnoiseWasmBinary() {
  if (!rnnoiseWasmBinaryPromise) {
    rnnoiseWasmBinaryPromise = window.NoiseSuppressor.loadRnnoise({
      url: '/vendor/noise-suppressor/rnnoise.wasm',
      simdUrl: '/vendor/noise-suppressor/rnnoise_simd.wasm',
    });
  }
  return rnnoiseWasmBinaryPromise;
}

// Conecta o RNNoise entre o gain do mic e o destino final, se estiver
// ligado nas Configurações - devolve o próprio micGainNode sem mudar nada
// se estiver desligado OU se qualquer parte do carregamento falhar
// (WASM/worklet não suportado, rede, etc.). Nunca deixa isso derrubar o
// microfone - na pior hipótese, só segue sem o filtro extra.
async function connectRnnoiseIfEnabled(ctx, micGainNode) {
  if (!state.settings.rnnoiseEnabled) return micGainNode;
  try {
    await ctx.audioWorklet.addModule('/vendor/noise-suppressor/rnnoise/workletProcessor.js');
    const wasmBinary = await getRnnoiseWasmBinary();
    const node = new window.NoiseSuppressor.RnnoiseWorkletNode(ctx, { maxChannels: 1, wasmBinary });
    micGainNode.connect(node);
    micMix.rnnoiseNode = node;
    return node;
  } catch (err) {
    console.warn('RNNoise não carregou, seguindo com o microfone sem ele:', err);
    return micGainNode;
  }
}

async function startMicShare() {
  if (state.mic.sharing || !lkRoom) return;
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(micConstraints());
  } catch {
    return; // sem microfone ou permissão negada — segue sem voz, só texto/tela
  }
  state.mic.micStream = stream;

  // RNNoise assume sample rate de 48kHz - força isso no contexto (sem essa
  // opção, o AudioContext podia nascer com o sample rate "nativo" do
  // dispositivo, que no Windows costuma ser 48000 mas não é garantido).
  micMix.ctx = new AudioContext({ sampleRate: 48000 });
  micMix.destination = micMix.ctx.createMediaStreamDestination();
  micMix.micSource = micMix.ctx.createMediaStreamSource(stream);
  micMix.micGain = micMix.ctx.createGain();
  // lembra se você tinha mutado antes de sair — o mic já liga mutado de
  // novo na próxima vez, não importa quanto tempo passou (preferência
  // persistida, não um estado de sessão que reseta a cada entrada na sala).
  // Se push-to-talk estiver ligado, começa mutado até a tecla ser
  // segurada, não importa o estado de state.settings.micMuted (ver
  // applyMicGain).
  pushToTalkKeyHeld = false;
  applyMicGain();
  micMix.micSource.connect(micMix.micGain);
  const chainOutput = await connectRnnoiseIfEnabled(micMix.ctx, micMix.micGain);
  chainOutput.connect(micMix.destination);

  state.mic.localTracks = micMix.destination.stream.getAudioTracks();
  state.mic.sharing = true;
  stream.getAudioTracks()[0].addEventListener('ended', stopMicShare);
  els.micMuteBtn.classList.remove('hidden');
  setMicMuteBtn(state.settings.micMuted);
  publishLocalSource('mic');
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
  if (micMix.rnnoiseNode) { micMix.rnnoiseNode.destroy(); micMix.rnnoiseNode.disconnect(); micMix.rnnoiseNode = null; }
  if (micMix.ctx) { micMix.ctx.close(); micMix.ctx = null; micMix.destination = null; }
  // qualquer som do soundboard que estivesse tocando nesse contexto morreu
  // junto com ele — limpa as referências pra não ficar lixo apontando pra
  // nós de um AudioContext já fechado.
  playingSounds.clear();
  soundMonitorGain.mix = null;
  unpublishLocalSource('mic');
  els.micMuteBtn.classList.add('hidden');
}

function setMicMuteBtn(muted) {
  const text = muted ? 'Microfone mutado' : 'Mutar microfone';
  els.micMuteBtn.innerHTML = `${muted ? ICONS.micOff : ICONS.mic}<span>${text}</span>`;
  els.micMuteBtn.title = text;
  els.micMuteBtn.classList.toggle('muted', muted);
  els.micMuteBtn.classList.toggle('active', !muted);
}

els.micMuteBtn.addEventListener('click', () => {
  if (!micMix.micGain) return;
  const nowMuted = !state.settings.micMuted;
  state.settings.micMuted = nowMuted;
  applyMicGain();
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
  els.shareBtn.classList.remove('active');
  updateInteractiveShareBtnVisibility();

  if (state.screen.clipper) {
    state.screen.clipper.stop();
    state.screen.clipper = null;
  }
  if (state.screen.clipperDownscale) {
    state.screen.clipperDownscale.stop();
    state.screen.clipperDownscale = null;
  }
  updateClipBtnVisibility();

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

  unpublishLocalSource('screen');
  removeTile(tileKey(state.myId, 'screen'));
  updateEmptyHint();

  retrackServerPresence();
  renderChannelList();
  renderMemberSidebar();
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
  els.cameraBtn.classList.add('active');

  cam.getVideoTracks()[0].addEventListener('ended', stopCameraShare);

  addOrUpdateTile(tileKey(state.myId, 'camera'), `${state.myName} (você)`, currentProfile ? currentProfile.avatar_url : null, composited, true, 'camera');
  updateEmptyHint();
  publishLocalSource('camera');
}

function stopCameraShare() {
  if (!state.camera.sharing) return;
  state.camera.sharing = false;
  setBtnLabel(els.cameraBtn, 'Câmera');
  els.cameraBtn.classList.remove('active');

  if (state.camera.camStream) {
    for (const t of state.camera.camStream.getTracks()) t.stop();
    state.camera.camStream = null;
  }
  for (const t of state.camera.localTracks) t.stop(); // track do <canvas>, não da câmera
  state.camera.localTracks = [];
  stopCameraCompositor();

  unpublishLocalSource('camera');
  removeTile(tileKey(state.myId, 'camera'));
  updateEmptyHint();
}

/* ---------------- modo admin: controle remoto (mouse/teclado) ----------------
   Liberado pra qualquer um que ligar o toggle nas Configurações (sem trava
   de banco de dados) — em troca, SEMPRE precisa de consentimento explícito
   de quem vai ser controlado antes do controle começar de verdade, por dois
   caminhos possíveis:
   1. Quem assiste pede ("Controlar tela" no menu de botão direito) -> quem
      transmite recebe um pedido e precisa Aceitar.
   2. Quem transmite oferece ("Transmissão interativa" no dock, escolhendo
      alguém presente na call) -> a pessoa escolhida recebe o convite e
      precisa Aceitar. Como foi quem transmite que já escolheu a pessoa de
      propósito, não tem um segundo pedido de confirmação depois do aceite
      (pendingControlOffers controla isso, ver startBeingControlledBy).
   Nos dois casos, enquanto o controle estiver ativo, quem está sendo
   controlado vê uma borda vermelha fixa na tela inteira que só ele
   consegue encerrar (showRemoteControlOverlay), não o controlador.

   Transporte: RTCDataChannel dentro da MESMA RTCPeerConnection de
   broadcast/watch já existente (sem rodear pelo Supabase) — quem
   transmite é sempre quem cria o canal e renegocia (mesmo padrão já usado
   na reconexão de ICE), porque é quem já tem o papel de "ofertante"
   nessa conexão. */

function canUseRemoteAdmin() {
  return isElectron && state.settings.remoteAdminEnabled;
}

function openTileContextMenu(x, y, key, name) {
  openContextMenu(x, y, (menu) => {
    const title = document.createElement('div');
    title.className = 'context-menu-title';
    title.textContent = name;
    menu.appendChild(title);

    const clipBtn = document.createElement('button');
    clipBtn.type = 'button';
    clipBtn.className = 'context-menu-action';
    clipBtn.textContent = 'Clipar os últimos 30s';
    clipBtn.addEventListener('click', () => {
      closeContextMenu();
      const clipper = viewerClippers.get(key);
      if (clipper) clipper.save(`clipe-${name}`);
      else showToast('Não consegui clipar essa transmissão.');
    });
    menu.appendChild(clipBtn);

    if (canUseRemoteAdmin()) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'context-menu-action';
      btn.textContent = 'Controlar tela';
      btn.addEventListener('click', () => {
        closeContextMenu();
        startRemoteControl(key);
      });
      menu.appendChild(btn);
    }
  });
}

function startRemoteControl(key) {
  if (remoteControlTargetId) {
    showToast('Você já está controlando uma tela — encerra antes de começar outra.');
    return;
  }
  const sep = key.lastIndexOf(':');
  const peerId = key.slice(0, sep);
  const source = key.slice(sep + 1);
  remoteControlTargetId = peerId;
  sendControlMessage(peerId, { kind: 'control-request', source });
  showToast('Pedido de controle enviado — esperando a pessoa aceitar.');
}

// diálogo genérico de aceitar/recusar, reaproveitado pelos dois sentidos do
// consentimento (pedido de quem assiste / convite de quem transmite).
function showConsentDialog({ title, message, onAccept, onDecline }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-card consent-dialog">
      <h2 class="settings-modal-title">${escapeHtml(title)}</h2>
      <p class="settings-hint">${escapeHtml(message)}</p>
      <div class="consent-dialog-actions">
        <button type="button" class="ghost" id="consentDeclineBtn">Recusar</button>
        <button type="button" class="primary" id="consentAcceptBtn">Aceitar</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('#consentAcceptBtn').addEventListener('click', () => {
    close();
    onAccept();
  });
  overlay.querySelector('#consentDeclineBtn').addEventListener('click', () => {
    close();
    if (onDecline) onDecline();
  });
}

function nameOfPeer(peerId) {
  const m = serverMembersCache.find((x) => x.user_id === peerId);
  return (m && m.profiles && m.profiles.display_name) || 'Alguém';
}

// pedido de quem assiste ("Controlar tela") chegando aqui - preciso aceitar
// antes do controle começar de verdade.
function showIncomingControlRequest(fromId, source) {
  showConsentDialog({
    title: 'Pedido de controle',
    message: `${nameOfPeer(fromId)} quer controlar sua tela. Aceitar?`,
    onAccept: () => startBeingControlledBy(fromId),
    onDecline: () => sendControlMessage(fromId, { kind: 'control-declined', source }),
  });
}

// convite de quem transmite ("Transmissão interativa") chegando aqui - a
// pessoa ESCOLHIDA precisa aceitar antes de começar a controlar. Com
// autoSubscribe (padrão do LiveKit), se quem convidou já estiver
// transmitindo a tela, o tile dela já existe aqui automaticamente - não
// precisa de nenhum "requestWatch" equivalente antes de pedir controle.
function showIncomingControlOffer(fromId, source) {
  showConsentDialog({
    title: 'Convite pra controlar uma tela',
    message: `${nameOfPeer(fromId)} quer que você controle a tela dele(a). Aceitar?`,
    onAccept: () => {
      remoteControlTargetId = fromId;
      sendControlMessage(fromId, { kind: 'control-request', source });
      showToast('Controle aceito — conectando...');
    },
    onDecline: () => sendControlMessage(fromId, { kind: 'control-declined', source }),
  });
}

// lado de quem transmite: escolhe alguém presente na call pra convidar a
// controlar a tela ("Transmissão interativa") - diferente do fluxo normal
// (quem assiste pede), aqui é quem transmite que convida primeiro.
const pendingControlOffers = new Set();
function openInteractiveShareMenu(anchorRect) {
  if (!activeVoiceChannel) return;
  const occupants = voiceChannelOccupants(activeVoiceChannel.id).filter((o) => o.id !== currentUser.id);
  const x = anchorRect ? anchorRect.left : window.innerWidth / 2;
  const y = anchorRect ? anchorRect.top - 10 : window.innerHeight / 2;
  openContextMenu(x, y, (menu) => {
    const title = document.createElement('div');
    title.className = 'context-menu-title';
    title.textContent = 'Transmissão interativa';
    menu.appendChild(title);
    if (!occupants.length) {
      const empty = document.createElement('div');
      empty.className = 'context-menu-title';
      empty.textContent = 'Ninguém mais na call agora.';
      menu.appendChild(empty);
      return;
    }
    for (const person of occupants) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'context-menu-action';
      btn.textContent = person.name || 'Alguém';
      btn.addEventListener('click', () => {
        closeContextMenu();
        pendingControlOffers.add(person.id);
        sendControlMessage(person.id, { kind: 'control-offer', source: 'screen' });
        showToast(`Convite de controle enviado pra ${person.name || 'essa pessoa'}.`);
      });
      menu.appendChild(btn);
    }
  });
}

// lado de quem está transmitindo (sendo controlado): sem RTCPeerConnection
// dedicada mais, então "aceitar" é só guardar quem me controla e avisar
// de volta (control-accepted) - é esse aviso que o controlador espera pra
// começar a mandar input de verdade (ver handleControlDataReceived).
function startBeingControlledBy(viewerId) {
  controlledByPeerId = viewerId;
  showRemoteControlOverlay(viewerId);
  sendControlMessage(viewerId, { kind: 'control-accepted' });
}

function showRemoteControlOverlay(controllerId) {
  hideRemoteControlOverlay();
  const overlay = document.createElement('div');
  overlay.id = 'remoteControlOverlay';
  overlay.innerHTML = `
    <div class="remote-control-banner">
      <span>Alguém está controlando sua tela</span>
      <button type="button" id="remoteControlEndBtn">Encerrar controle</button>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('#remoteControlEndBtn').addEventListener('click', () => {
    sendControlMessage(controllerId, { type: 'control-ended' });
    controlledByPeerId = null;
    hideRemoteControlOverlay();
  });
}
function hideRemoteControlOverlay() {
  const el = document.getElementById('remoteControlOverlay');
  if (el) el.remove();
}

// lado de quem está assistindo (controlando): captura mouse/teclado no
// <video> do tile e manda via publishData direcionado (destinationIdentities)
// pro identity de quem está sendo controlado. keyCode como "VK code" é uma
// aproximação deliberada — na prática bate com os VK_* do Win32 pra tecla
// de letra/número/função/seta/espaço/enter, que é o que importa aqui.
let controlInputCleanup = null;
let remoteControlTargetId = null; // identity de quem EU estou controlando (se houver)
let controlledByPeerId = null; // identity de quem está ME controlando (se houver)

function sendControlMessage(toIdentity, obj) {
  if (!lkRoom) return;
  const payload = new TextEncoder().encode(JSON.stringify(obj));
  lkRoom.localParticipant.publishData(payload, { destinationIdentities: [toIdentity], topic: 'control', reliable: true }).catch(() => {});
}

// despachante único de tudo que chega no topic 'control' - registrado em
// controlHandlers.onDataReceived (ver setupLiveKitRoomEvents). Cobre tanto
// o handshake de consentimento (control-request/accepted/declined/offer)
// quanto o input cru (mousemove/mousebutton/wheel/key) e o fim de sessão
// (control-ended), já que agora tudo passa pelo mesmo transporte - antes
// o handshake ia por sendSignal/onSignal e só o input cru ia pelo
// RTCDataChannel dedicado.
function handleControlDataReceived(payload, participant) {
  const fromId = participant && participant.identity;
  if (!fromId) return;
  let msg;
  try {
    msg = JSON.parse(new TextDecoder().decode(payload));
  } catch {
    return;
  }

  if (msg.kind === 'control-request') {
    if (pendingControlOffers.has(fromId)) {
      pendingControlOffers.delete(fromId);
      startBeingControlledBy(fromId);
    } else {
      showIncomingControlRequest(fromId, msg.source);
    }
    return;
  }
  if (msg.kind === 'control-declined') {
    showToast('Pedido de controle recusado.');
    if (remoteControlTargetId === fromId) remoteControlTargetId = null;
    return;
  }
  if (msg.kind === 'control-offer') {
    showIncomingControlOffer(fromId, msg.source);
    return;
  }
  if (msg.kind === 'control-accepted') {
    if (remoteControlTargetId !== fromId) return;
    showToast('Controle ativado — você já pode mexer na tela dele(a).');
    const tile = state.tiles.get(tileKey(fromId, 'screen'));
    if (tile) attachControlInputListeners(tile.video, fromId);
    return;
  }

  // a partir daqui é input cru (mousemove/mousebutton/wheel/key) ou o fim
  // de sessão - só processa se vier de quem realmente está no papel certo.
  if (msg.type === 'control-ended') {
    if (controlledByPeerId === fromId) { controlledByPeerId = null; hideRemoteControlOverlay(); }
    if (remoteControlTargetId === fromId) { remoteControlTargetId = null; detachControlInputListeners(); }
    return;
  }
  if (controlledByPeerId === fromId && isElectron) {
    window.telaNative.sendRemoteInput(msg);
  }
}
controlHandlers.onDataReceived = handleControlDataReceived;
controlHandlers.onParticipantDisconnected = (identity) => {
  if (remoteControlTargetId === identity) { remoteControlTargetId = null; detachControlInputListeners(); }
  if (controlledByPeerId === identity) { controlledByPeerId = null; hideRemoteControlOverlay(); }
};

function mouseButtonName(button) {
  return button === 2 ? 'right' : button === 1 ? 'middle' : 'left';
}
function attachControlInputListeners(video, targetId) {
  detachControlInputListeners();
  const send = (obj) => sendControlMessage(targetId, obj);
  const onMouseMove = (ev) => {
    const rect = video.getBoundingClientRect();
    const xNorm = (ev.clientX - rect.left) / rect.width;
    const yNorm = (ev.clientY - rect.top) / rect.height;
    if (xNorm < 0 || xNorm > 1 || yNorm < 0 || yNorm > 1) return;
    send({ type: 'mousemove', x: xNorm, y: yNorm });
  };
  const onMouseDown = (ev) => {
    ev.preventDefault();
    send({ type: 'mousebutton', button: mouseButtonName(ev.button), down: true });
  };
  const onMouseUp = (ev) => send({ type: 'mousebutton', button: mouseButtonName(ev.button), down: false });
  const onWheel = (ev) => {
    ev.preventDefault();
    send({ type: 'wheel', deltaY: ev.deltaY });
  };
  const onContextMenu = (ev) => ev.preventDefault(); // nao abre o menu de tile de novo enquanto controla
  const onKeyDown = (ev) => {
    ev.preventDefault();
    send({ type: 'key', vkCode: ev.keyCode, down: true });
  };
  const onKeyUp = (ev) => {
    ev.preventDefault();
    send({ type: 'key', vkCode: ev.keyCode, down: false });
  };

  video.addEventListener('mousemove', onMouseMove);
  video.addEventListener('mousedown', onMouseDown);
  video.addEventListener('mouseup', onMouseUp);
  video.addEventListener('wheel', onWheel, { passive: false });
  video.addEventListener('contextmenu', onContextMenu);
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);

  controlInputCleanup = () => {
    video.removeEventListener('mousemove', onMouseMove);
    video.removeEventListener('mousedown', onMouseDown);
    video.removeEventListener('mouseup', onMouseUp);
    video.removeEventListener('wheel', onWheel);
    video.removeEventListener('contextmenu', onContextMenu);
    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('keyup', onKeyUp);
  };
}
function detachControlInputListeners() {
  if (controlInputCleanup) {
    controlInputCleanup();
    controlInputCleanup = null;
  }
}

els.remoteAdminCheck.addEventListener('change', () => {
  state.settings.remoteAdminEnabled = els.remoteAdminCheck.checked;
  saveSettings();
  updateInteractiveShareBtnVisibility();
});

function updateInteractiveShareBtnVisibility() {
  els.interactiveShareBtn.classList.toggle('hidden', !(state.screen.sharing && canUseRemoteAdmin()));
}
els.interactiveShareBtn.addEventListener('click', () => {
  openInteractiveShareMenu(els.interactiveShareBtn.getBoundingClientRect());
});

function updateClipBtnVisibility() {
  els.clipBtn.classList.toggle('hidden', !(state.screen.sharing && state.settings.clipEnabled));
}
els.clipBtn.addEventListener('click', () => {
  if (state.screen.clipper) state.screen.clipper.save('clipe');
  else showToast('Clipe ainda não está pronto.');
});

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
      if (!isSelf) applyStoredPeerVolume(key, audio);
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
        <div class="tile-live-badges hidden">
          <span class="tile-live-badge tile-live-badge-live"><span class="live-dot"></span>AO VIVO</span>
          <span class="tile-live-badge tile-live-res"></span>
        </div>
        <span class="tile-watchers-badge hidden"></span>
        <div class="tile-inspector-panel hidden"></div>
        <div class="tile-top-overlay">
          <label class="pin-check" title="Selecionar pra tela cheia">
            <input type="checkbox" class="pin-input" />
            <span class="pin-box"></span>
          </label>
          <div class="tile-top-actions">
            <button type="button" class="btn-inspect icon-btn" title="Qualidade da conexão">${ICONS.signal}</button>
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
    const btnInspect = root.querySelector('.btn-inspect');
    const pinInput = root.querySelector('.pin-input');

    btnInspect.addEventListener('click', () => {
      root.querySelector('.tile-inspector-panel').classList.toggle('hidden');
      renderTileInspectorPanel(key);
    });

    if (!isSelf) {
      const appliedPct = applyStoredPeerVolume(key, video);
      if (appliedPct !== null) volSlider.value = String(appliedPct);
    }

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
      updateStageMode();
    });

    if (!isSelf) applySpeakerDevice(video);

    if (source === 'screen') {
      root.querySelector('.tile-live-badges').classList.remove('hidden');
      if (isSelf) root.querySelector('.tile-watchers-badge').classList.remove('hidden');
      video.addEventListener('loadedmetadata', () => updateTileLiveRes(root, video, isSelf));
      if (!isSelf) {
        root.addEventListener('contextmenu', (ev) => {
          ev.preventDefault();
          openTileContextMenu(ev.clientX, ev.clientY, key, name, video);
        });
      }
    }

    els.grid.appendChild(root);
    tile = { root, video, isSelf, source };
    state.tiles.set(key, tile);
    updateGridTileSize();
  }
  tile.root.querySelector('.tile-identity strong').textContent = name;
  tile.root.querySelector('.tile-identity img').src = avatar || DEFAULT_AVATAR;
  if (tile.video.srcObject !== stream) tile.video.srcObject = stream;
  updateStageMode();
}

// Resolução real do vídeo decodificado (bate pra qualquer um, local ou
// remoto); fps só mostra pro seu próprio tile, porque é o único valor que
// a gente sabe de verdade (o configurado nas configurações) — fps real de
// um stream remoto exigiria ler estatísticas do RTCPeerConnection, não vale
// a complexidade só pra um número no badge.
function updateTileLiveRes(root, video, isSelf) {
  const el = root.querySelector('.tile-live-res');
  if (!video.videoWidth) return;
  const res = `${video.videoWidth}×${video.videoHeight}`;
  el.textContent = isSelf ? `${res} · ${state.settings.fps} fps` : res;
}

function updateSelfScreenWatchersBadge() {
  const key = tileKey(state.myId, 'screen');
  const tile = state.tiles.get(key);
  if (!tile) return;
  const watching = lkRoom ? lkRoom.remoteParticipants.size : 0;
  const badge = tile.root.querySelector('.tile-watchers-badge');
  badge.innerHTML = `${ICONS.monitor} ${watching} assistindo`;
  if (currentMainPanel === 'voice') renderMemberSidebar(); // mantém o nudge "Transmitindo sozinho?" em dia
}
setInterval(updateSelfScreenWatchersBadge, 2000);

// Estatística de verdade por tile de vídeo (local ou remoto), lida via
// getRTCStatsReport() do próprio LiveKit - alimenta tanto o badge de
// resolução/fps (agora com o fps REAL alcançado, não só o configurado -
// antes só dava pra saber o configurado, ver updateTileLiveRes) quanto o
// painel do inspetor de conexão (bitrate, codec, perda de pacote, jitter,
// ping). kbps é calculado por delta de bytes entre duas voltas desse
// loop, não vem pronto da stats API.
async function pollTileStats() {
  for (const [key, track] of tileVideoTracks) {
    let report;
    try {
      report = await track.getRTCStatsReport();
    } catch {
      continue; // track pode estar no meio de uma troca/reconexão - tenta de novo na próxima volta
    }
    if (!report) continue;

    let rtcStat = null;
    for (const stat of report.values()) {
      if ((stat.type === 'outbound-rtp' || stat.type === 'inbound-rtp') && stat.kind === 'video') {
        rtcStat = stat;
        break;
      }
    }
    if (!rtcStat) continue;

    let codec = null;
    if (rtcStat.codecId && report.get(rtcStat.codecId)) {
      const mime = report.get(rtcStat.codecId).mimeType || '';
      codec = mime.split('/')[1] || null;
    }

    let rttMs = null;
    for (const stat of report.values()) {
      if (stat.type === 'candidate-pair' && stat.state === 'succeeded' && stat.currentRoundTripTime != null) {
        rttMs = Math.round(stat.currentRoundTripTime * 1000);
        break;
      }
    }

    const isOutbound = rtcStat.type === 'outbound-rtp';
    const bytes = isOutbound ? rtcStat.bytesSent : rtcStat.bytesReceived;
    const now = performance.now();
    const prev = tileStatsPrev.get(key);
    let kbps = null;
    if (prev && bytes != null && now > prev.ts) {
      kbps = Math.round(((bytes - prev.bytes) * 8) / (now - prev.ts));
    }
    if (bytes != null) tileStatsPrev.set(key, { bytes, ts: now });

    tileStatsLatest.set(key, {
      width: rtcStat.frameWidth || null,
      height: rtcStat.frameHeight || null,
      fps: rtcStat.framesPerSecond != null ? Math.round(rtcStat.framesPerSecond) : null,
      kbps: kbps != null && kbps >= 0 ? kbps : null,
      codec,
      packetsLost: rtcStat.packetsLost ?? null,
      jitterMs: rtcStat.jitter != null ? Math.round(rtcStat.jitter * 1000) : null,
      rttMs,
    });

    const tile = state.tiles.get(key);
    if (tile && rtcStat.frameWidth) {
      const resEl = tile.root.querySelector('.tile-live-res');
      if (resEl) {
        const fpsTxt = rtcStat.framesPerSecond != null ? ` · ${Math.round(rtcStat.framesPerSecond)} fps` : '';
        resEl.textContent = `${rtcStat.frameWidth}×${rtcStat.frameHeight}${fpsTxt}`;
      }
      const panel = tile.root.querySelector('.tile-inspector-panel');
      if (panel && !panel.classList.contains('hidden')) renderTileInspectorPanel(key);
    }
  }
}
setInterval(pollTileStats, 2000);

function renderTileInspectorPanel(key) {
  const tile = state.tiles.get(key);
  if (!tile) return;
  const panel = tile.root.querySelector('.tile-inspector-panel');
  if (!panel) return;
  const s = tileStatsLatest.get(key);
  if (!s) {
    panel.innerHTML = '<p class="hint">Calculando…</p>';
    return;
  }
  const row = (label, value) => (value == null ? '' : `<div class="tile-inspector-row"><span>${label}</span><strong>${value}</strong></div>`);
  panel.innerHTML = [
    row('Resolução', s.width ? `${s.width}×${s.height}` : null),
    row('FPS', s.fps),
    row('Bitrate', s.kbps != null ? `${(s.kbps / 1000).toFixed(1)} Mbps` : null),
    row('Codec', s.codec ? s.codec.toUpperCase() : null),
    row('Ping', s.rttMs != null ? `${s.rttMs} ms` : null),
    row('Pacotes perdidos', s.packetsLost),
    row('Jitter', s.jitterMs != null ? `${s.jitterMs} ms` : null),
  ].join('') || '<p class="hint">Sem dados ainda.</p>';
}

function removeTile(key) {
  const tile = state.tiles.get(key);
  if (!tile) return;
  state.pinned.delete(key);
  if (state.focusIds && state.focusIds.includes(key)) exitFocusIfActive();
  tile.root.remove();
  state.tiles.delete(key);
  // rede de segurança - os pontos normais de saída (handleTrackUnsubscribed,
  // unpublishLocalSource) já limpam isso, mas um tile pode sumir por outro
  // caminho (ex: removeAllTilesFor) sem passar por lá.
  tileVideoTracks.delete(key);
  tileStatsPrev.delete(key);
  tileStatsLatest.delete(key);
  updateFocusBar();
  updateGridTileSize();
}

// Com muitas transmissões simultâneas, tiles de 320px mínimo empilhavam
// crescendo sem limite (ficava feio/ilegível). Encolhe o tamanho mínimo
// conforme a contagem de tiles com vídeo real sobe (exclui tiles audioOnly
// de mic, que não entram na grade visual).
function visibleTileCount() {
  let n = 0;
  for (const tile of state.tiles.values()) {
    if (!tile.audioOnly) n++;
  }
  return n;
}

function updateGridTileSize() {
  const count = visibleTileCount();
  let min;
  if (count <= 2) min = 480;
  else if (count <= 4) min = 360;
  else if (count <= 9) min = 260;
  else if (count <= 16) min = 200;
  else min = 160;
  els.grid.style.setProperty('--tile-min', `${min}px`);
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
  '3.0.0': [
    'Reformulação completa: o app agora é baseado em servidores e canais, igual Discord — a rede local (Radmin) não é mais necessária, funciona em qualquer rede.',
    'Login simples só com apelido (sem senha) — entra uma vez e fica salvo nesse PC.',
    'Crie servidores, convide seus amigos com um código, e organize canais de texto e de voz à vontade.',
    'Canal de texto com mensagens de verdade (ficam salvas, chegam na hora pra quem está com o canal aberto).',
    'Canal de voz com a mesma transmissão de tela/câmera/mic de sempre.',
    'Configurações do servidor: troque o nome, o ícone, veja o código de convite, saia ou apague o servidor.',
    'Aviso: ainda não dá pra mandar arquivo no chat de texto, e chamadas de voz em redes mais restritas (ex: 4G/5G, rede corporativa) podem não conectar ainda — chegando em breve.',
  ],
  '3.0.1': [
    'Ajustes visuais: cada área da tela (servidores, canais, conteúdo, membros) agora tem um tom de fundo diferente, pra ficar claro onde uma termina e a outra começa.',
    'Ícone do soundboard no dock ficou mais simples e legível.',
    'Corrigido: um selo decorativo da tela de login estava ficando preso no canto da tela e escondendo o primeiro servidor da lista.',
  ],
  '3.1.0': [
    'Tela inicial virou uma tela de Amigos, igual Discord: adicione gente pelo apelido, aceite/recuse pedidos, veja quem tá online e mande mensagem direta.',
    'Perfil (foto, banner, bio e apelido) agora salva de verdade e aparece pros outros — antes só ficava salvo no seu PC.',
    'Clique no nome de alguém na lista de online do servidor pra ver o perfil dela, com servidores e amigos em comum.',
    'Botão direito em alguém na lista de online (durante uma chamada) abre um controle de volume só pra você — não muda o volume dela pros outros.',
  ],
  '3.1.1': [
    'Corrigido: alt-tab (ou qualquer coisa que tirasse o foco da janela, como abrir o seletor de arquivo) jogava você de volta pra tela de Amigos e desselecionava o servidor — mesmo com uma chamada de voz rolando. Agora o app fica exatamente onde você deixou.',
    'Isso também corrige não conseguir trocar o ícone do servidor (o seletor de arquivo abrindo contava como perder o foco).',
  ],
  '3.1.2': [
    'Corrigido de vez o botão "Trocar ícone" do servidor — um bug no próprio código cancelava o seletor de arquivo antes dele abrir.',
  ],
  '3.1.3': [
    'Fotos (avatar, banner, ícone de servidor) agora são comprimidas antes de subir — bem mais leve, economiza o espaço grátis do banco.',
    'Trocar de foto várias vezes não deixa mais versões antigas acumulando por aí — cada troca substitui a anterior em vez de empilhar.',
  ],
  '3.2.1': [
    'Login voltou a ser só com apelido, sem email — a versão anterior (3.2.0) deu problema de entrega de email e foi desfeita.',
  ],
  '3.2.2': [
    'Corrigido bug real nas chamadas/transmissões: qualquer oscilação normal de rede (bem comum, principalmente sem um servidor TURN ainda) derrubava a transmissão na hora e não tentava voltar sozinha — agora o app espera alguns segundos pra ver se reconecta antes de desistir de verdade, e quem transmite agora também tenta reconectar ativamente em vez de ficar transmitindo pro vazio.',
  ],
  '3.3.0': [
    '!!BIG!!Atualização para proibir sophias',
    'Corrigido bug de presença: às vezes alguém não aparecia online pros outros mesmo estando com o app aberto — agora a presença se reanuncia sozinha periodicamente, não depende só do evento inicial.',
    'Cores mais vivas em todo o app — o visual tava muito apagado, agora o roxo/violeta do tema e os brilhos ficaram bem mais vivos.',
    'Transmissões simultâneas demais faziam os tiles de vídeo empilharem crescendo sem limite — agora eles encolhem automaticamente conforme a quantidade sobe.',
    'Sidebar de membros mais estreita, liberando espaço de tela.',
    'Painel "Áudio por app" saiu da sala e agora vive só nas Configurações (aba "Apps mutados"), junto com a lista de mute permanente.',
    'Transmissão de tela mais leve: prioriza manter o FPS configurado (bom pra quem tá jogando) em vez de travar quadros, e o encoder agora sabe que é conteúdo em movimento.',
    'Fechar o app no X agora só minimiza pra bandeja (igual Discord) — ele continua rodando em segundo plano, sem derrubar chamada/transmissão. Sair de vez é pelo menu da bandeja.',
    'Chat de texto com cara nova: mensagens em bolha, agrupamento de mensagens seguidas da mesma pessoa, e um cabeçalho de boas-vindas em cada canal com atalhos (Convidar amigos / Entrar na call / Transmitir tela).',
  ],
  '3.3.1': [
    'Paleta de cores e fontes refeitas com valores exatos (visual mais "gaming", fontes Sora/Manrope) — ajuste fino de cima da leva de cores vivas da versão anterior.',
  ],
  '3.4.0': [
    '!!BIG!!Atualização para proibir sophias',
    'Configurações com cara nova: menu lateral com ícones, prévia da câmera ao vivo, medidor de nível do microfone em tempo real, e interruptores no lugar das caixinhas de marcar.',
  ],
  '3.5.0': [
    '!!BIG!!Atualização para proibir sophias',
    'Sala de chamada com visão de palco: quando alguém transmite a tela, ela vira o destaque grande (com selo "AO VIVO", resolução/fps e quantas pessoas estão assistindo) e todo mundo mais vira uma tira pequena embaixo — câmera sozinha não vira palco. Quando ninguém transmite, aparece um convite grande pra compartilhar a tela.',
  ],
  '3.6.0': [
    'Agora dá pra mandar arquivo, foto e vídeo no chat (botão "+" do lado da mensagem) — sem pesar no banco: o arquivo fica só no seu PC e é entregue direto pra quem baixa, então só funciona enquanto você estiver com o app aberto.',
  ],
  '3.6.1': [
    'Corrigido bug sério: abrir o app enquanto ele já estava rodando escondido na bandeja (depois de fechar com o X) fazia o app travar na hora com um erro de porta ocupada. Agora, se você tentar abrir de novo, ele só mostra a janela que já estava aberta.',
  ],
  '3.7.0': [
    'Agora dá pra ver quem está numa call e quem está transmitindo direto na lista de canais de voz (com selo "AO VIVO"), sem precisar entrar na call pra saber.',
    'Lista de membros do servidor não fica mais travada numa altura pequena com rolagem própria — agora usa o espaço da tela inteiro.',
  ],
  '3.8.0': [
    'Nova opção nas Configurações (aba "Geral"): escolher se o X da janela minimiza pra bandeja (padrão) ou fecha o app de vez, pra quem prefere do jeito de antes.',
  ],
  '3.9.0': [
    'Corrigido: às vezes o app continuava mostrando você na call mesmo depois de sair dela.',
    'Novo recurso restrito para administradores da rede — não afeta o uso normal do app.',
  ],
  '3.10.0': [
    'Convite por link: "Copiar convite" agora copia um link — clicar nele abre direto no app (se já tiver instalado) ou leva pra uma página com o botão de baixar. Colar o código antigo em "Entrar com código" continua funcionando normal.',
    'Reações com emoji nas mensagens do chat, e indicador de "fulano está digitando...".',
    'Botão de emoji no chat e nas mensagens diretas.',
    '"Visto há Xh" nos amigos offline.',
    'Painel "Voz conectada" mostra o canal e a latência (ms) mesmo navegando pra outro lugar do app.',
    'Lista de membros da sala de chamada agora mostra só quem está na call (com "AO VIVO" pra quem transmite) em vez da lista geral do servidor, com avisos de "tá vazio aqui" / "transmitindo sozinho?" quando fizer sentido.',
  ],
  '3.10.1': [
    'Convite por link OU por código: agora dá pra escolher qual mandar (link abre o app sozinho; código continua como alternativa se o link der algum problema).',
    'Barra de controles da call com visual mais claro: câmera/compartilhar tela acendem com o gradiente quando estão ligados, e o microfone fica vermelho suave só quando está mutado.',
    'Página de convite por link já está no ar.',
  ],
  '3.11.0': [
    'Novo: "Reportar um bug" nas Configurações (aba Geral) — descreve o problema, cola ou anexa um print, e manda direto pra quem desenvolve o app.',
  ],
  '3.12.0': [
    'Novo: dá pra vincular um e-mail à sua conta (Configurações → Geral → "Vincular e-mail") — sem isso, trocar de computador ou reinstalar o app sempre cria uma conta do zero, perdendo amigos e servidores. Com o e-mail vinculado, dá pra entrar de novo na mesma conta de qualquer lugar.',
    'Login por e-mail não usa senha nem link — chega um código por e-mail, você digita no app e pronto.',
  ],
  '3.12.1': [
    'Corrigido: a lista de quem está online no servidor (e quem está na call) não atualizava sozinha quando alguém novo entrava — só mostrava gente nova depois de sair e abrir o servidor de novo. Agora atualiza na hora.',
  ],
  '3.13.0': [
    'Modo admin (controle remoto) agora é liberado pra qualquer um — basta ligar nas Configurações. Em troca, sempre precisa do consentimento da outra pessoa: um pedido/convite aparece na tela e só começa se for aceito.',
    'Novo: "Transmissão interativa" — enquanto você compartilha a tela, dá pra escolher alguém presente na call e convidar pra controlar (a pessoa escolhida decide se aceita).',
  ],
  '3.13.1': [
    'Corrigido: depois de sair e voltar pra uma call (às vezes por causa de uma reconexão de rede), a pessoa podia ficar presa sumida da lista "Na call"/online do servidor pra sempre, mesmo com a chamada funcionando normal. Agora detecta isso e se reconecta sozinho.',
  ],
  '3.14.0': [
    'Novo: clipar a transmissão — 30s pra quem assiste (sempre disponível, botão direito na tela de alguém) e 60s pra quem transmite (opt-in nas Configurações → Transmissão, qualidade reduzida pra não pesar).',
    'A pasta onde os clipes são salvos agora é configurável (Configurações → Transmissão) — por padrão fica em Vídeos/Ribbit.',
    'A barra do topo da janela agora acompanha a cor do tema escolhido, em vez da barra padrão do Windows.',
    'Corrigido: texto ilegível (branco em cima de fundo quase-branco) no tema Neutro em vários botões/abas selecionadas.',
    'Configurações do servidor agora abrem como aba cheia, igual as Configurações normais.',
    'Novo seletor de tema (Configurações → Geral): Azul, Roxo, Verde ou Neutro.',
    'Modo admin (controle remoto) liberado pra qualquer um — agora sempre pede consentimento da outra pessoa antes de começar, nos dois sentidos (pedir ou oferecer via "Transmissão interativa").',
  ],
  '4.0.0': [
    '"Suvaco da Jinx" agora é "Ribbit"! Nome e ícone novos em todo lugar — janela, bandeja, atalhos, e-mails. Link de convite antigo (suvacodajinx://) continua funcionando normalmente.',
    'Tela de boas-vindas nova, apresentando os recursos do app pra quem tá chegando agora.',
    'Bolinha de notificação nas Configurações lembrando de vincular um e-mail (evita perder a conta se reinstalar o app ou trocar de computador).',
  ],
  '4.1.0': [
    'Corrigido: upload de foto de perfil/ícone do servidor travando depois da primeira troca.',
    'Foto do servidor na barra lateral agora atualiza na hora pra quem trocou, em vez de demorar.',
    'Corrigido: pedido de amizade não chegava em tempo real — agora chega na hora.',
    'Corrigido: lista de quem tá na call às vezes "piscava" gente saindo sozinha.',
    'Corrigido: ícone do app na barra de tarefas às vezes continuava o antigo depois de atualizar.',
    'Aviso de tela preta na transmissão agora dá uma dica melhor de como resolver.',
    'Botão de "Reportar um bug" finalmente funciona — manda direto pro desenvolvedor.',
    '5 temas novos nas Configurações: Halloween, Natal, Lagoa, Névoa e Sombra.',
    'Card de doação (Pix) na barra lateral agora aparece de vez em quando, não fica sempre visível.',
  ],
  '4.2.0': [
    'Os 5 temas novos ganharam enfeite de verdade, não só cor: Halloween (teia, aranha e morcegos), Natal (pisca-pisca e neve caindo), Lagoa (chuva, folha e um sapo espiando), Névoa (fumaça roxa e borboletas) e Sombra (fumaça escura e faíscas elétricas).',
  ],
  '4.3.0': [
    'Corrigido: mutar um app na barra lateral às vezes não bastava — se o programa que abriu ele (ex: a Steam abrindo um jogo) não estivesse mutado também, o som vazava mesmo assim.',
    'Corrigido: às vezes alguém aparecia como "Offline" por alguns segundos logo depois de entrar numa call, mesmo estando lá — a lista agora reconecta na hora em vez de esperar até 20s.',
  ],
  '4.4.0': [
    'Novo: servidor de retransmissão (TURN) pras chamadas/transmissão — ajuda quem está numa rede mais fechada (4G, wifi corporativo, CGNAT) a conseguir conectar, resolvendo tela preta que só acontecia com alguns amigos específicos.',
    'Checagem de atualização agora repete a cada poucas horas, não só quando o app abre — quem deixa ele sempre aberto na bandeja não fica mais preso numa versão antiga.',
  ],
  '4.5.0': [
    'Chamadas de voz/tela/câmera agora passam por um servidor dedicado em vez de ligar direto entre os PCs de todo mundo — resolve a travada/queda de FPS de quem transmite quando tem 3 ou mais pessoas assistindo ao mesmo tempo.',
    'Conexão de chamada deve ficar mais estável em geral, principalmente com várias pessoas na call ao mesmo tempo.',
  ],
  '4.5.1': [
    'Corrigido: trocar de servidor rápido podia deixar a lista de membros (e às vezes de canais) mostrando o servidor errado por um tempo.',
    'Corrigido: o som do que você estava assistindo podia vazar e duplicar na sua própria transmissão ao compartilhar tela, causando eco crescente — o Ribbit estava se contando como "mais um app" na mixagem de áudio por app.',
  ],
  '4.5.2': [
    'Corrigido: mutar um app bem na hora que ele aparecia na lista às vezes não fazia efeito nenhum.',
    'Corrigido: quem minimizava o Ribbit pra bandeja durante uma call podia sumir da lista "Na call"/aparecer Offline pros outros por vários minutos, mesmo seguindo ativo (compartilhando tela, por exemplo) — o Windows/Chromium throttla demais uma janela escondida, o que atrasava demais a atualização de presença.',
  ],
  '4.5.3': [
    'Mute de apps na transmissão refeito do zero: agora só existe a lista "sempre mutar" nas Configurações (tirei o painel "Nesta sessão", que só confundia e dava bug). A lista de apps com som se atualiza sozinha a cada poucos segundos enquanto você compartilha, então um app que você abrir depois de já estar compartilhando (um jogo, uma notificação do Discord) também entra pra ser mutado, não só os que já estavam tocando som no começo.',
  ],
};

// Boas-vindas: aparece pra toda conta nova (justCreatedAccount, setado no
// submit do form de apelido - a única forma de login que cria um usuário do
// zero), não por instalação/PC - assim qualquer pessoa que entrar por aqui
// pela primeira vez vê a apresentação, em qualquer máquina.
els.onboardingOkBtn.addEventListener('click', () => els.onboardingModal.classList.add('hidden'));

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
      <ul>${CHANGELOG[v]
        .map((item) => {
          const isBig = item.startsWith('!!BIG!!');
          const text = escapeHtml(isBig ? item.slice(7) : item);
          return `<li class="${isBig ? 'whats-new-highlight' : ''}">${text}</li>`;
        })
        .join('')}</ul>
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
