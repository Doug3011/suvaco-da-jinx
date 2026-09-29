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
const { WebSocketServer } = require('./vendor/ws');

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

function getLocalIp() {
  const ifaces = os.networkInterfaces();
  // prioriza adaptadores de VPN de LAN virtual (Radmin/Hamachi/ZeroTier) e físicos comuns
  const all = [];
  for (const name of Object.keys(ifaces)) {
    for (const i of ifaces[name] || []) {
      if (i.family === 'IPv4' && !i.internal) all.push({ name, address: i.address });
    }
  }
  const radmin = all.find((x) => /radmin/i.test(x.name));
  return (radmin || all[0] || { address: '127.0.0.1' }).address;
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
  serveStatic(req, res);
});

/* ---------------- WebSocket: relay de sinalização WebRTC (/relay) ----------------
   O servidor NÃO toca em vídeo — só repassa mensagens JSON (quem está
   presente/compartilhando, e as ofertas/respostas/candidatos ICE) entre os
   clientes. O vídeo em si trafega direto (P2P) entre as máquinas na rede. */

const wss = new WebSocketServer({ noServer: true });
const clients = new Map(); // id -> { ws, name, avatar, sharing }

function makeId() {
  return Math.random().toString(36).slice(2, 10);
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
  }));
  const payload = JSON.stringify({ type: 'presence', clients: list });
  for (const c of clients.values()) if (c.ws.readyState === c.ws.OPEN) c.ws.send(payload);
}

function handleRelayConn(ws) {
  const id = makeId();
  clients.set(id, {
    ws,
    name: 'Convidado',
    avatar: null,
    banner: null,
    bio: '',
    sharingScreen: false,
    sharingCamera: false,
  });
  ws.send(JSON.stringify({ type: 'welcome', id }));

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
      if (msg.source === 'camera') me.sharingCamera = true;
      else me.sharingScreen = true;
      broadcastPresence();
    } else if (msg.type === 'share:stop') {
      if (msg.source === 'camera') me.sharingCamera = false;
      else me.sharingScreen = false;
      broadcastPresence();
    } else if (msg.type === 'signal' && msg.to) {
      const target = clients.get(msg.to);
      if (target && target.ws.readyState === target.ws.OPEN) {
        target.ws.send(JSON.stringify({ type: 'signal', from: id, data: msg.data }));
      }
    }
  });

  ws.on('close', () => {
    clients.delete(id);
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

function ctlBroadcast(obj) {
  const s = JSON.stringify(obj);
  for (const c of ctlClients) if (c.readyState === c.OPEN) c.send(s);
}

function startHosting(name) {
  roomName = (name || 'Sala').slice(0, 40);
  if (hosting) {
    ctlBroadcast({ type: 'hosting', value: true, name: roomName });
    return;
  }
  hosting = true;
  beaconSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  beaconSocket.bind(() => {
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
        name: roomName,
        host: getLocalIp(),
        port: HTTP_PORT,
        people: clients.size,
      }),
    );
    beaconSocket.send(msg, 0, msg.length, DISCOVERY_PORT, '255.255.255.255');
  }, 1500);
  ctlBroadcast({ type: 'hosting', value: true, name: roomName });
}

function stopHosting() {
  hosting = false;
  if (beaconTimer) clearInterval(beaconTimer);
  beaconTimer = null;
  if (beaconSocket) beaconSocket.close();
  beaconSocket = null;
  ctlBroadcast({ type: 'hosting', value: false });
}

function startDiscovery() {
  if (discSocket) {
    ctlBroadcast({ type: 'rooms', rooms: [...seenRooms.values()] });
    return;
  }
  seenRooms.clear();
  discSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  discSocket.on('message', (buf) => {
    let data;
    try {
      data = JSON.parse(buf.toString());
    } catch {
      return;
    }
    if (!data || data.app !== APP_ID) return;
    if (data.host === getLocalIp() && hosting) return; // não lista a própria sala
    seenRooms.set(data.host + ':' + data.port, { ...data, lastSeen: Date.now() });
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
    ctlBroadcast({ type: 'rooms', rooms: [...seenRooms.values()] });
  }, 1000);
}

function stopDiscovery() {
  if (discPruneTimer) clearInterval(discPruneTimer);
  discPruneTimer = null;
  if (discSocket) discSocket.close();
  discSocket = null;
  seenRooms.clear();
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
  });
  ws.on('close', () => ctlClients.delete(ws));
}

server.on('upgrade', (req, socket, head) => {
  const pathname = (req.url || '').split('?')[0];
  if (pathname === '/relay') {
    wss.handleUpgrade(req, socket, head, handleRelayConn);
  } else if (pathname === '/lan/ctl') {
    wss.handleUpgrade(req, socket, head, handleCtlConn);
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
  if (!process.env.TELA_NO_OPEN) openAppWindow(url);
});
