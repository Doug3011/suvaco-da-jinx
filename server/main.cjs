// Servidor local do "Suvaco da Jinx" — roda dentro do executável.
// Só serve os arquivos estáticos do app (public/) — toda a lógica de rede
// (login, servidores/canais, presença, chat, sinalização WebRTC) agora
// vive no Supabase (Auth + Postgres + Realtime), não mais aqui.
// Ver supabase/schema.sql pro schema completo.
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { exec } = require('node:child_process');

const HTTP_PORT = Number(process.env.TELA_PORT) || 47400;
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
  if (req.url === '/version') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ version: getAppVersion() }));
    return;
  }
  serveStatic(req, res);
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
  console.log('  SUVACO DA JINX');
  console.log('  por Doug Muller Burro');
  console.log('  ' + url);
  console.log('=================================================');
  if (!process.env.TELA_NO_OPEN) openAppWindow(url);
});
