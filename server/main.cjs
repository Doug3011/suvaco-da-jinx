// Servidor local do "Tela Radmin" — roda dentro do executável.
// Serve o app (public/), faz o relay de sinalização WebRTC (WebSocket) e o
// anúncio/descoberta de salas na rede local (broadcast UDP, igual ao "Mundo de
// LAN" do Minecraft e ao Outro Lado).
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const dgram = require('node:dgram');
const { exec } = require('node:child_process');
const { WebSocketServer, WebSocket } = require('./vendor/ws');

const HTTP_PORT = Number(process.env.TELA_PORT) || 47400;
const DISCOVERY_PORT = 47410;
const APP_ID = 'tela-radmin-v1';
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

/* ---------------- dados em disco: chat + arquivos + identidade estável ----------------
   Fica na pasta de dados do usuário (ex: %APPDATA%\Suvaco da Jinx\chat-data),
   passada pelo Electron via TELA_DATA_DIR — sobrevive a fechar/abrir o app.
   Fora do Electron (dev/teste com `node main.cjs` direto), cai numa pasta
   local de desenvolvimento pra não escrever em lugar nenhum importante. */

const DATA_DIR = process.env.TELA_DATA_DIR
  ? path.join(process.env.TELA_DATA_DIR, 'chat-data')
  : path.join(__dirname, '..', '.dev-chat-data');
const FILES_DIR = path.join(DATA_DIR, 'files');
const DM_DIR = path.join(DATA_DIR, 'dm');
const ROOM_HISTORY_FILE = path.join(DATA_DIR, 'room-history.json');
const DEVICE_ID_FILE = path.join(DATA_DIR, 'device-id.txt');

fs.mkdirSync(FILES_DIR, { recursive: true });
fs.mkdirSync(DM_DIR, { recursive: true });

function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

// Identidade estável desse INSTALL (não desse processo) — ao contrário do
// `presenceId` abaixo (que muda toda vez que o app reabre), essa aqui é
// gerada uma vez e salva em disco, pra conversas de mensagem direta
// continuarem sendo "a mesma pessoa" mesmo depois de fechar/abrir o app.
function getOrCreateDeviceId() {
  try {
    const existing = fs.readFileSync(DEVICE_ID_FILE, 'utf8').trim();
    if (existing) return existing;
  } catch {
    /* ainda não existe, cria abaixo */
  }
  const fresh = makeId() + makeId();
  try {
    fs.writeFileSync(DEVICE_ID_FILE, fresh);
  } catch {
    /* disco não gravável por algum motivo — segue só em memória pra essa sessão */
  }
  return fresh;
}
const deviceId = getOrCreateDeviceId();

function loadJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}
function saveJson(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data));
  } catch {
    /* falha de disco — a conversa continua funcionando, só não persiste dessa vez */
  }
}

// 500MB — bem mais generoso que o limite antigo de 25MB porque agora o
// arquivo vai por upload HTTP de verdade (streamed pro disco aos poucos),
// não mais embutido inteiro numa mensagem JSON em base64.
const CHAT_FILE_MAX_BYTES = 500 * 1024 * 1024;

function deleteStoredFile(id) {
  if (!id) return;
  try {
    for (const f of fs.readdirSync(FILES_DIR)) {
      if (f.startsWith(id + '__')) fs.unlinkSync(path.join(FILES_DIR, f));
    }
  } catch {
    /* ignora */
  }
}

function handleFileUpload(req, res) {
  const url = new URL(req.url, 'http://local');
  const name = (url.searchParams.get('name') || 'arquivo').slice(0, 150);
  const type = (url.searchParams.get('type') || 'application/octet-stream').slice(0, 100);
  const id = makeId() + makeId();
  const filePath = path.join(FILES_DIR, `${id}__${encodeURIComponent(type)}__${encodeURIComponent(name)}`);
  const writeStream = fs.createWriteStream(filePath);
  let total = 0;
  let aborted = false;

  req.on('data', (chunk) => {
    total += chunk.length;
    if (!aborted && total > CHAT_FILE_MAX_BYTES) {
      aborted = true;
      writeStream.destroy();
      try {
        fs.unlinkSync(filePath);
      } catch {
        /* ignora */
      }
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'arquivo maior que 500MB' }));
      req.destroy();
    }
  });
  req.on('error', () => {
    writeStream.destroy();
  });
  req.pipe(writeStream);
  writeStream.on('finish', () => {
    if (aborted) return;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id, name, type, size: total }));
  });
  writeStream.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'falha ao salvar no disco' }));
    }
  });
}

function handleFileDownload(req, res, id) {
  let found = null;
  try {
    found = fs.readdirSync(FILES_DIR).find((f) => f.startsWith(id + '__'));
  } catch {
    /* ignora */
  }
  if (!found) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  const [, encodedType, ...nameParts] = found.split('__');
  const type = decodeURIComponent(encodedType || '');
  const name = decodeURIComponent(nameParts.join('__') || 'arquivo').replace(/"/g, '');
  const fullPath = path.join(FILES_DIR, found);
  let stat;
  try {
    stat = fs.statSync(fullPath);
  } catch {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  // Imagem fica "inline" (pra <img src> e clicar-pra-ver funcionarem);
  // qualquer outra coisa força download — sem isso, o atributo `download`
  // do HTML não é confiável em link cross-origin (que é sempre o caso
  // aqui, ver CORS acima), o navegador só respeitaria `download` de
  // verdade pra link do mesmo domínio.
  const disposition = type && type.startsWith('image/') ? 'inline' : 'attachment';
  res.writeHead(200, {
    'Content-Type': type || 'application/octet-stream',
    'Content-Length': stat.size,
    'Content-Disposition': `${disposition}; filename="${name}"`,
    'Cache-Control': 'private, max-age=31536000, immutable',
  });
  fs.createReadStream(fullPath).pipe(res);
}

function getAppVersion() {
  // O app de verdade (empacotado no Electron) expõe a versão via IPC
  // (app.getVersion()); esse endpoint é só um fallback pra quando o
  // servidor roda sozinho (dev/teste, `node main.cjs` sem Electron).
  try {
    return require(path.join(__dirname, '..', 'package.json')).version;
  } catch {
    return require('./package.json').version;
  }
}

function getPreferredInterface() {
  const ifaces = os.networkInterfaces();
  // prioriza adaptadores de VPN de LAN virtual (Radmin/Hamachi/ZeroTier) e físicos comuns
  const all = [];
  for (const name of Object.keys(ifaces)) {
    for (const i of ifaces[name] || []) {
      if (i.family === 'IPv4' && !i.internal) all.push({ name, address: i.address, netmask: i.netmask });
    }
  }
  const radmin = all.find((x) => /radmin/i.test(x.name));
  return radmin || all[0] || { name: 'loopback', address: '127.0.0.1', netmask: '255.0.0.0' };
}

function getLocalIp() {
  return getPreferredInterface().address;
}

// Endereço de broadcast DIRECIONADO da sub-rede (ex: 26.1.2.255), calculado
// a partir do IP+máscara da interface escolhida. Em cima de VPNs de LAN
// virtual tipo Radmin, mandar só pro broadcast global (255.255.255.255) não
// é confiável — um socket sem bind num endereço específico deixa o Windows
// escolher a interface de saída pela tabela de rotas, que normalmente é o
// adaptador de internet (Wi-Fi/Ethernet), não o adaptador virtual do Radmin
// (que não costuma ser a rota padrão). Mandar os dois, a partir de um socket
// EXPLICITAMENTE vinculado ao IP da interface certa, cobre os dois casos.
function subnetBroadcastAddress(iface) {
  try {
    const ip = iface.address.split('.').map(Number);
    const mask = iface.netmask.split('.').map(Number);
    return ip.map((part, idx) => part | (~mask[idx] & 0xff)).join('.');
  } catch {
    return '255.255.255.255';
  }
}

/* ---------------- servidor HTTP (arquivos estáticos) ---------------- */

function serveStatic(req, res) {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p === '/' || p === '') p = '/index.html';
  const full = path.normalize(path.join(PUBLIC_DIR, p));
  if (!full.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end();
    return;
  }
  fs.readFile(full, (err, data) => {
    const target = err ? path.join(PUBLIC_DIR, 'index.html') : full;
    fs.readFile(target, (e2, data2) => {
      if (e2) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      const ext = path.extname(target);
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(data2);
    });
  });
}

const server = http.createServer((req, res) => {
  if (req.url === '/lan/info') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ localIp: getLocalIp(), hostname: os.hostname(), port: HTTP_PORT }));
    return;
  }
  if (req.url === '/version') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ version: getAppVersion() }));
    return;
  }
  if ((req.url || '').startsWith('/chat/')) {
    // Cada participante carrega a PRÓPRIA página via localhost (seu próprio
    // `server/main.cjs`), mas upload/download de anexo sempre vai pro
    // servidor de quem hospedou a sala (`state.roomAddr` no cliente) — ou
    // seja, é sempre uma origem DIFERENTE da página (até pro próprio
    // anfitrião: a página dele é `localhost`, o servidor dele também
    // responde pelo IP da rede). Sem CORS liberado aqui, o navegador barra
    // o upload (preflight OPTIONS) mesmo sendo, na prática, a mesma máquina.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method === 'POST' && req.url.startsWith('/chat/upload')) {
      handleFileUpload(req, res);
      return;
    }
    if (req.method === 'GET' && req.url.startsWith('/chat/files/')) {
      const id = decodeURIComponent(req.url.slice('/chat/files/'.length).split('?')[0]);
      handleFileDownload(req, res, id);
      return;
    }
  }
  serveStatic(req, res);
});

/* ---------------- WebSocket: relay de sinalização WebRTC (/relay) ----------------
   O servidor NÃO toca em vídeo — só repassa mensagens JSON (quem está
   presente/compartilhando, e as ofertas/respostas/candidatos ICE) entre os
   clientes. O vídeo em si trafega direto (P2P) entre as máquinas na rede. */

const wss = new WebSocketServer({ noServer: true });
const clients = new Map(); // id -> { ws, name, avatar, sharing }
let hostId = null; // primeiro cliente conectado no relay vira o "anfitrião" da sala
const SOURCE_FIELD = { screen: 'sharingScreen', camera: 'sharingCamera', mic: 'sharingMic' };

// Histórico do chat da sala agora é salvo em disco de verdade (ROOM_HISTORY_FILE)
// — sobrevive a fechar/abrir o app, não só a "todo mundo sair e voltar"
// dentro da mesma sessão. Capado em 200 mensagens; quando estoura, apaga
// também os arquivos anexados das mensagens mais antigas que saem da lista.
let chatHistory = loadJson(ROOM_HISTORY_FILE, []);
const CHAT_HISTORY_MAX = 200;
function saveChatHistory() {
  saveJson(ROOM_HISTORY_FILE, chatHistory);
}
function pushChatHistory(entry) {
  chatHistory.push(entry);
  if (chatHistory.length > CHAT_HISTORY_MAX) {
    const evicted = chatHistory.shift();
    for (const att of evicted.attachments || []) deleteStoredFile(att.fileId);
  }
  saveChatHistory();
}

// Anexo agora vem de um de dois jeitos: `fileId` (upload HTTP de verdade,
// arquivo grande, modo LAN) ou `dataUrl` (base64 embutido na mensagem,
// modo Internet — sem servidor compartilhado alcançável entre as pessoas,
// então continua limitado a uns 25MB do lado do cliente).
const CHAT_ATTACHMENT_DATAURL_MAX = 34 * 1024 * 1024;
function sanitizeChatAttachment(a) {
  const out = {
    name: String((a && a.name) || 'arquivo').slice(0, 150),
    type: String((a && a.type) || '').slice(0, 100),
    size: Number(a && a.size) || 0,
  };
  if (a && typeof a.fileId === 'string') {
    out.fileId = a.fileId.slice(0, 40);
    // só usado em mensagem direta (sem "sala" compartilhada pra saber de
    // quem é o arquivo) — no chat de sala isso não é necessário, já que
    // todo mundo já sabe o endereço do anfitrião (`roomAddr`).
    if (typeof a.fileHost === 'string') out.fileHost = a.fileHost.slice(0, 64);
    if (a.filePort) out.filePort = Number(a.filePort) || 0;
  } else if (a && typeof a.dataUrl === 'string' && a.dataUrl.startsWith('data:')) {
    out.dataUrl = a.dataUrl.slice(0, CHAT_ATTACHMENT_DATAURL_MAX);
  }
  return out;
}

function broadcastPresence() {
  const list = [...clients.entries()].map(([id, c]) => ({
    id,
    name: c.name,
    avatar: c.avatar,
    banner: c.banner,
    bio: c.bio,
    sharingScreen: c.sharingScreen,
    sharingCamera: c.sharingCamera,
    sharingMic: c.sharingMic,
    isHost: id === hostId,
  }));
  const payload = JSON.stringify({ type: 'presence', clients: list });
  for (const c of clients.values()) if (c.ws.readyState === c.ws.OPEN) c.ws.send(payload);
}

function handleRelayConn(ws) {
  const id = makeId();
  if (hostId === null) hostId = id;
  clients.set(id, {
    ws,
    name: 'Convidado',
    avatar: null,
    banner: null,
    bio: '',
    sharingScreen: false,
    sharingCamera: false,
    sharingMic: false,
  });
  ws.send(JSON.stringify({ type: 'welcome', id }));
  if (chatHistory.length) ws.send(JSON.stringify({ type: 'chat:history', messages: chatHistory }));

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    const me = clients.get(id);
    if (!me || !msg || !msg.type) return;

    if (msg.type === 'hello') {
      me.name = String(msg.name || 'Convidado').slice(0, 30);
      // avatar/banner já vêm prontos (redimensionados/comprimidos) do cliente como data URL
      if (typeof msg.avatar === 'string' && msg.avatar.startsWith('data:image/')) {
        me.avatar = msg.avatar.slice(0, 60000);
      }
      if (typeof msg.banner === 'string' && msg.banner.startsWith('data:image/')) {
        me.banner = msg.banner.slice(0, 120000);
      }
      if (typeof msg.bio === 'string') {
        me.bio = msg.bio.slice(0, 190);
      }
      broadcastPresence();
    } else if (msg.type === 'share:start') {
      const field = SOURCE_FIELD[msg.source];
      if (field) me[field] = true;
      broadcastPresence();
    } else if (msg.type === 'share:stop') {
      const field = SOURCE_FIELD[msg.source];
      if (field) me[field] = false;
      broadcastPresence();
    } else if (msg.type === 'signal' && msg.to) {
      const target = clients.get(msg.to);
      if (target && target.ws.readyState === target.ws.OPEN) {
        target.ws.send(JSON.stringify({ type: 'signal', from: id, data: msg.data }));
      }
    } else if (msg.type === 'chat') {
      const text = typeof msg.text === 'string' ? msg.text.slice(0, 2000) : '';
      const attachments = Array.isArray(msg.attachments) ? msg.attachments.slice(0, 4).map(sanitizeChatAttachment) : [];
      if (!text && !attachments.length) return;
      const chatEntry = {
        type: 'chat',
        from: id,
        name: me.name,
        avatar: me.avatar,
        text,
        attachments,
        ts: Date.now(),
      };
      pushChatHistory(chatEntry);
      const chatMsg = JSON.stringify(chatEntry);
      // mesma lógica da presença: retransmite pra TODO MUNDO conectado nesse
      // relay — no modo LAN isso já é só quem está na rede Radmin, já que
      // ninguém de fora alcança esse WebSocket pra começo de conversa.
      for (const c of clients.values()) if (c.ws.readyState === c.ws.OPEN) c.ws.send(chatMsg);
    }
  });

  ws.on('close', () => {
    clients.delete(id);
    if (id === hostId) {
      hostId = clients.size > 0 ? clients.keys().next().value : null;
    }
    broadcastPresence();
  });
}

/* ---------------- WebSocket: canal de controle local (/lan/ctl) ----------------
   Usado só pela própria aba do app (mesma máquina) pra: virar sala anunciada
   na rede, ligar/desligar a descoberta de salas e receber a lista encontrada. */

const ctlClients = new Set();
let hosting = false;
let roomName = 'Sala';
let beaconSocket = null;
let beaconTimer = null;
let discSocket = null;
let discPruneTimer = null;
const seenRooms = new Map(); // "host:port" -> {app,name,host,port,people,lastSeen}
const seenPeers = new Map(); // id -> {id,name,host,port,room,lastSeen} — "quem está online", não necessariamente numa sala

// Presença: ao contrário do beacon de sala (só liga quando alguém hospeda),
// esse aqui roda o tempo todo desde que o app abre — é o que faz "aparecer
// online" pros amigos na mesma rede Radmin mesmo sem ninguém ter hospedado
// nada ainda. `myRoomLabel` é preenchido tanto por quem hospeda (startHosting)
// quanto por quem entrou como convidado (mensagem ctl `presence:room`), pra
// esse beacon sempre refletir "Sala N" corretamente pros dois lados.
const presenceId = makeId();
let presenceName = 'Convidado';
let presenceAvatar = null; // atualizado via ctl `presence:avatar` — usado só nas mensagens diretas que EU inicio
let myRoomLabel = null;
let presenceSocket = null;
let presenceTimer = null;

function ctlBroadcast(obj) {
  const s = JSON.stringify(obj);
  for (const c of ctlClients) if (c.readyState === c.OPEN) c.send(s);
}

function startPresenceBeacon() {
  // Calculado uma vez, não a cada tick: reavaliar `os.networkInterfaces()"
  // toda hora é o que causava o IP "piscar" entre adaptadores quando uma
  // outra VPN (ex: Cloudflare WARP) liga/desliga no meio da sessão, fazendo
  // a mesma pessoa aparecer como duas entradas diferentes pros outros.
  const iface = getPreferredInterface();
  const directedBroadcast = subnetBroadcastAddress(iface);
  presenceSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  presenceSocket.bind(0, iface.address, () => {
    try {
      presenceSocket.setBroadcast(true);
    } catch {
      /* ignora */
    }
  });
  presenceTimer = setInterval(() => {
    const msg = Buffer.from(
      JSON.stringify({
        app: APP_ID,
        type: 'presence',
        id: presenceId,
        deviceId,
        name: presenceName,
        host: iface.address,
        port: HTTP_PORT,
        room: myRoomLabel,
      }),
    );
    presenceSocket.send(msg, 0, msg.length, DISCOVERY_PORT, '255.255.255.255');
    if (directedBroadcast !== '255.255.255.255') {
      presenceSocket.send(msg, 0, msg.length, DISCOVERY_PORT, directedBroadcast);
    }
  }, 2500);
}

function startHosting(name) {
  roomName = (name || 'Sala').slice(0, 40);
  myRoomLabel = roomName;
  if (hosting) {
    ctlBroadcast({ type: 'hosting', value: true, name: roomName });
    return;
  }
  hosting = true;
  const iface = getPreferredInterface();
  const directedBroadcast = subnetBroadcastAddress(iface);
  beaconSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  beaconSocket.bind(0, iface.address, () => {
    try {
      beaconSocket.setBroadcast(true);
    } catch {
      /* ignora */
    }
  });
  beaconTimer = setInterval(() => {
    const msg = Buffer.from(
      JSON.stringify({
        app: APP_ID,
        type: 'room',
        id: presenceId, // identidade estável do anfitrião — não depende do IP, que pode mudar com outra VPN ligando/desligando
        name: roomName,
        host: iface.address,
        port: HTTP_PORT,
        people: clients.size,
        // nomes de quem está dentro — pra lista de salas na barra lateral
        // mostrar quem já está lá (estilo canal de voz do Discord), sem
        // precisar entrar na sala só pra descobrir.
        members: [...clients.values()].map((c) => c.name),
      }),
    );
    beaconSocket.send(msg, 0, msg.length, DISCOVERY_PORT, '255.255.255.255');
    if (directedBroadcast !== '255.255.255.255') {
      beaconSocket.send(msg, 0, msg.length, DISCOVERY_PORT, directedBroadcast);
    }
  }, 1500);
  ctlBroadcast({ type: 'hosting', value: true, name: roomName });
}

function stopHosting() {
  hosting = false;
  myRoomLabel = null;
  if (beaconTimer) clearInterval(beaconTimer);
  beaconTimer = null;
  if (beaconSocket) beaconSocket.close();
  beaconSocket = null;
  ctlBroadcast({ type: 'hosting', value: false });
}

function startDiscovery() {
  if (discSocket) {
    ctlBroadcast({ type: 'rooms', rooms: [...seenRooms.values()] });
    ctlBroadcast({ type: 'peers', peers: [...seenPeers.values()] });
    return;
  }
  seenRooms.clear();
  seenPeers.clear();
  discSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  discSocket.on('message', (buf) => {
    let data;
    try {
      data = JSON.parse(buf.toString());
    } catch {
      return;
    }
    if (!data || data.app !== APP_ID) return;
    if (data.type === 'presence') {
      if (data.id === presenceId) return; // não lista a mim mesmo
      seenPeers.set(data.id, { ...data, lastSeen: Date.now() });
      return;
    }
    // Filtra pela identidade estável (`id`), não pelo IP: o IP anunciado pode
    // mudar durante a sessão se outra VPN ligar/desligar (ex: Cloudflare
    // WARP), e comparar por IP nesse caso faz a própria sala aparecer pro
    // anfitrião como se fosse de outra pessoa — "duplicando" a entrada dele
    // mesmo na lista. Mantém o fallback por host:port só pra salas vindas de
    // uma versão antiga do app que ainda não manda `id`.
    const isMine = data.id ? data.id === presenceId : data.host === getLocalIp() && hosting;
    if (isMine) return;
    const key = data.id || data.host + ':' + data.port;
    seenRooms.set(key, { ...data, lastSeen: Date.now() });
  });
  discSocket.bind(DISCOVERY_PORT, () => {
    try {
      discSocket.setBroadcast(true);
    } catch {
      /* ignora */
    }
  });
  discPruneTimer = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of seenRooms) if (now - v.lastSeen > 5000) seenRooms.delete(k);
    for (const [k, v] of seenPeers) if (now - v.lastSeen > 6000) seenPeers.delete(k);
    ctlBroadcast({ type: 'rooms', rooms: [...seenRooms.values()] });
    ctlBroadcast({ type: 'peers', peers: [...seenPeers.values()] });
  }, 1000);
}

function stopDiscovery() {
  if (discPruneTimer) clearInterval(discPruneTimer);
  discPruneTimer = null;
  if (discSocket) discSocket.close();
  discSocket = null;
  seenRooms.clear();
  seenPeers.clear();
}

/* ---------------- mensagens diretas (/dm) ----------------
   Dá pra mandar mensagem pra alguém só porque ele "aparece online" na
   página inicial, sem os dois estarem na mesma sala — porque CADA app já
   roda seu próprio servidor o tempo todo (é o mesmo que serve a UI pra essa
   pessoa). "Mandar uma DM" é essa máquina abrir uma conexão de saída pro
   `/dm` do servidor da OUTRA pessoa — só funciona enquanto o app dela
   estiver aberto (sem isso, nem "aparece online" pra começo de conversa).

   A própria renderer (a aba/janela que você olha) NUNCA fala direto com o
   servidor remoto — ela pede pro MEU PRÓPRIO servidor mandar/buscar
   histórico via o canal de controle local (/lan/ctl) que já existe pra
   outras coisas. Isso mantém TODA a lógica de rede do lado do servidor
   (Node), igual o resto do app já funciona, e deixa o histórico de cada
   conversa salvo em disco por MIM, por pessoa (arquivo por deviceId remoto)
   — cada lado guarda a própria cópia, sobrevive a fechar/abrir o app. */

const DM_HISTORY_MAX = 500;
const dmOutgoing = new Map(); // deviceId remoto -> { ws, ready, queue[] } (conexão que EU abri)
const dmIncoming = new Map(); // deviceId remoto -> ws (conexão que ELE abriu comigo)

function dmHistoryFile(remoteDeviceId) {
  return path.join(DM_DIR, `${remoteDeviceId}.json`);
}
function loadDmHistory(remoteDeviceId) {
  return loadJson(dmHistoryFile(remoteDeviceId), []);
}
function appendDmHistory(remoteDeviceId, entry) {
  const history = loadDmHistory(remoteDeviceId);
  history.push(entry);
  if (history.length > DM_HISTORY_MAX) {
    const evicted = history.shift();
    for (const att of evicted.attachments || []) deleteStoredFile(att.fileId);
  }
  saveJson(dmHistoryFile(remoteDeviceId), history);
}

function connectDmOutgoing(remoteDeviceId, host, port) {
  const existing = dmOutgoing.get(remoteDeviceId);
  if (existing && (existing.ws.readyState === WebSocket.OPEN || existing.ws.readyState === WebSocket.CONNECTING)) {
    return existing;
  }
  const ws = new WebSocket(`ws://${host}:${port}/dm`);
  const record = { ws, ready: false, queue: [] };
  ws.on('open', () => {
    record.ready = true;
    ws.send(JSON.stringify({ type: 'dm:hello', deviceId, name: presenceName, avatar: presenceAvatar }));
    for (const payload of record.queue.splice(0)) ws.send(JSON.stringify(payload));
  });
  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg && msg.type === 'dm:message') {
      const entry = {
        from: remoteDeviceId,
        name: String(msg.name || 'Convidado').slice(0, 30),
        avatar: typeof msg.avatar === 'string' && msg.avatar.startsWith('data:image/') ? msg.avatar.slice(0, 60000) : null,
        text: typeof msg.text === 'string' ? msg.text.slice(0, 2000) : '',
        attachments: Array.isArray(msg.attachments) ? msg.attachments.slice(0, 4).map(sanitizeChatAttachment) : [],
        ts: Date.now(),
      };
      appendDmHistory(remoteDeviceId, entry);
      ctlBroadcast({ type: 'dm:incoming', deviceId: remoteDeviceId, entry });
    }
  });
  ws.on('close', () => {
    if (dmOutgoing.get(remoteDeviceId) === record) dmOutgoing.delete(remoteDeviceId);
  });
  ws.on('error', () => {
    /* fica pro 'close' cuidar de limpar — tentar de novo só na próxima mensagem mandada */
  });
  dmOutgoing.set(remoteDeviceId, record);
  return record;
}

function sendDm(remoteDeviceId, host, port, text, attachments) {
  const cleanText = typeof text === 'string' ? text.slice(0, 2000) : '';
  const cleanAttachments = Array.isArray(attachments) ? attachments.slice(0, 4).map(sanitizeChatAttachment) : [];
  if (!cleanText && !cleanAttachments.length) return null;
  const entry = { from: 'me', name: presenceName, avatar: presenceAvatar, text: cleanText, attachments: cleanAttachments, ts: Date.now() };
  appendDmHistory(remoteDeviceId, entry);
  const record = connectDmOutgoing(remoteDeviceId, host, port);
  const payload = { type: 'dm:message', name: presenceName, avatar: presenceAvatar, text: cleanText, attachments: cleanAttachments, ts: entry.ts };
  if (record.ready) record.ws.send(JSON.stringify(payload));
  else record.queue.push(payload);
  return entry;
}

function handleDmConn(ws) {
  let remoteId = null;
  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!msg || !msg.type) return;
    if (msg.type === 'dm:hello') {
      remoteId = String(msg.deviceId || '').slice(0, 64);
      if (remoteId) dmIncoming.set(remoteId, ws);
      return;
    }
    if (!remoteId || msg.type !== 'dm:message') return;
    const entry = {
      from: remoteId,
      name: String(msg.name || 'Convidado').slice(0, 30),
      avatar: typeof msg.avatar === 'string' && msg.avatar.startsWith('data:image/') ? msg.avatar.slice(0, 60000) : null,
      text: typeof msg.text === 'string' ? msg.text.slice(0, 2000) : '',
      attachments: Array.isArray(msg.attachments) ? msg.attachments.slice(0, 4).map(sanitizeChatAttachment) : [],
      ts: Date.now(),
    };
    if (!entry.text && !entry.attachments.length) return;
    appendDmHistory(remoteId, entry);
    ctlBroadcast({ type: 'dm:incoming', deviceId: remoteId, entry });
  });
  ws.on('close', () => {
    if (remoteId && dmIncoming.get(remoteId) === ws) dmIncoming.delete(remoteId);
  });
}

function handleCtlConn(ws) {
  ctlClients.add(ws);
  ws.send(JSON.stringify({ type: 'info', localIp: getLocalIp(), port: HTTP_PORT, hosting }));
  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!msg || !msg.type) return;
    if (msg.type === 'host:start') startHosting(msg.name);
    else if (msg.type === 'host:stop') stopHosting();
    else if (msg.type === 'discover:start') startDiscovery();
    else if (msg.type === 'discover:stop') stopDiscovery();
    else if (msg.type === 'presence:name') presenceName = String(msg.name || 'Convidado').slice(0, 30);
    else if (msg.type === 'presence:room') myRoomLabel = msg.room ? String(msg.room).slice(0, 40) : null;
    else if (msg.type === 'presence:avatar') {
      presenceAvatar = typeof msg.avatar === 'string' && msg.avatar.startsWith('data:image/') ? msg.avatar.slice(0, 60000) : null;
    } else if (msg.type === 'dm:send') {
      const remoteId = String(msg.deviceId || '').slice(0, 64);
      if (!remoteId || !msg.host || !msg.port) return;
      const entry = sendDm(remoteId, msg.host, Number(msg.port), msg.text, msg.attachments);
      if (entry) ws.send(JSON.stringify({ type: 'dm:sent', deviceId: remoteId, entry }));
    } else if (msg.type === 'dm:get-history') {
      const remoteId = String(msg.deviceId || '').slice(0, 64);
      if (!remoteId) return;
      ws.send(JSON.stringify({ type: 'dm:history', deviceId: remoteId, messages: loadDmHistory(remoteId) }));
    }
  });
  ws.on('close', () => ctlClients.delete(ws));
}

server.on('upgrade', (req, socket, head) => {
  const pathname = (req.url || '').split('?')[0];
  if (pathname === '/relay') {
    wss.handleUpgrade(req, socket, head, handleRelayConn);
  } else if (pathname === '/lan/ctl') {
    wss.handleUpgrade(req, socket, head, handleCtlConn);
  } else if (pathname === '/dm') {
    wss.handleUpgrade(req, socket, head, handleDmConn);
  } else {
    socket.destroy();
  }
});

/* ---------------- sobe o servidor e abre a janela do app ---------------- */

function openAppWindow(url) {
  exec(`start msedge --app=${url}`, (err) => {
    if (!err) return;
    exec(`start chrome --app=${url}`, (err2) => {
      if (!err2) return;
      exec(`start ${url}`);
    });
  });
}

server.listen(HTTP_PORT, () => {
  const url = `http://localhost:${HTTP_PORT}`;
  console.log('=================================================');
  console.log('  SUVACO DA JINX - compartilhamento de tela na rede local');
  console.log('  por Doug Muller Burro');
  console.log('  ' + url);
  console.log('  IP nesta rede (pra outros conectarem): ' + getLocalIp());
  console.log('=================================================');
  startPresenceBeacon();
  if (!process.env.TELA_NO_OPEN) openAppWindow(url);
});
