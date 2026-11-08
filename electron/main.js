// Processo principal do Electron. Sobe o MESMO servidor local do modo antigo
// (server/main.cjs, sem mudar nada nele) e adiciona por cima: a janela do
// app, o seletor de tela/janela (getDisplayMedia) e a ponte com o módulo
// nativo de captura de áudio por processo (mute por app).
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, ipcMain, desktopCapturer, session, dialog, shell, Tray, Menu, nativeImage } = require('electron');
const { autoUpdater } = require('electron-updater');

// Trava de instância única — crítico agora que fechar com o X só minimiza
// pra bandeja (em vez de encerrar de vez): sem isso, abrir o app nas
// Olimpíadas/atalho de novo enquanto a instância anterior ainda está viva
// escondida na bandeja faz uma SEGUNDA cópia tentar subir o servidor na
// MESMA porta, travando com "EADDRINUSE" antes mesmo de abrir janela
// nenhuma. Em vez disso, a segunda tentativa só foca a janela já aberta.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
  process.exit(0);
}
// Convite por link: ribbit://join/<codigo> - registrado como protocolo
// customizado (build.protocols no package.json, o NSIS escreve a chave de
// registro certa no instalador). Extrai o código de qualquer argv que
// pareça com esse link, de onde quer que ele apareça na lista (o SO pode
// colocar em posições diferentes dependendo de como foi lançado). Aceita
// também o esquema antigo (suvacodajinx://) pra não quebrar link que
// alguém ainda tenha guardado de antes da troca de nome.
function extractInviteCodeFromArgv(argv) {
  for (const arg of argv) {
    const match = /^(?:ribbit|suvacodajinx):\/\/join\/([a-zA-Z0-9]+)/.exec(arg);
    if (match) return match[1];
  }
  return null;
}
function sendInviteCodeToRenderer(code) {
  if (!code || !mainWindow) return;
  mainWindow.webContents.send('app:joinByCode', code);
}

app.on('second-instance', (_event, commandLine) => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
  sendInviteCodeToRenderer(extractInviteCodeFromArgv(commandLine));
});

// macOS entrega o link assim em vez de via argv/second-instance - sem
// efeito no Windows, mas não custa nada deixar coberto.
app.on('open-url', (event, url) => {
  event.preventDefault();
  const match = /^(?:ribbit|suvacodajinx):\/\/join\/([a-zA-Z0-9]+)/.exec(url);
  if (match) sendInviteCodeToRenderer(match[1]);
});

// Tira a borda que o Windows desenha em volta de uma JANELA sendo
// capturada — vem da API moderna de captura (Windows Graphics Capture),
// que o Chromium usa por padrão pra captura por janela. É o próprio
// Windows que desenha isso (proteção contra captura escondida), não o
// nosso app — mas dá pra pedir pro Chromium não exigir a borda, ou (se
// isso não bastar nessa versão do Chromium) cair pro capturador mais
// antigo que nunca desenhava borda nenhuma. Nomes de feature "errados"
// aqui não quebram nada — o Chromium ignora silenciosamente o que não
// reconhece em --disable-features.
app.commandLine.appendSwitch(
  'disable-features',
  'WgcRequireBorder,WebRtcWgcRequireBorder,WebRtcAllowWgcWindowCapturer,WebRtcAllowWgcScreenCapturer',
);

// Atualização automática via GitHub Releases (github.com/Doug3011/suvaco-da-jinx).
// Só roda no app empacotado de verdade — em dev (`npm start`) não tem update
// feed configurado e só ia gerar erro no console à toa.
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.on('update-downloaded', (info) => {
  // Avisa em HTML/CSS dentro da própria janela (em vez do dialog nativo do
  // SO) pra manter o visual igual ao resto do app — ver #updateReadyModal
  // em index.html/app.js. Se a janela ainda não existir por algum motivo,
  // cai de volta pro dialog nativo pra não perder o aviso.
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update:ready', { version: info.version });
  } else {
    dialog
      .showMessageBox({
        type: 'info',
        title: 'Atualização pronta',
        message: `Uma nova versão (${info.version}) do Ribbit foi baixada.`,
        detail: 'Reiniciar agora pra aplicar, ou continuar usando e aplicar só quando fechar o app.',
        buttons: ['Reiniciar agora', 'Depois'],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) {
          isQuitting = true;
          autoUpdater.quitAndInstall();
        }
      });
  }
});
autoUpdater.on('error', (err) => {
  console.warn('[auto-update] erro ao checar/baixar atualização:', err.message);
});

let nativeAddon = null;
try {
  nativeAddon = require(path.join(__dirname, '..', 'native', 'build', 'Release', 'tela_native.node'));
} catch (err) {
  console.warn('Módulo nativo de áudio por app ainda não compilado:', err.message);
}

process.env.TELA_NO_OPEN = '1';
require(path.join(__dirname, '..', 'server', 'main.cjs'));

const PORT = Number(process.env.TELA_PORT) || 47400;

let mainWindow = null;
let tray = null;
let isQuitting = false;
const captureHandles = new Map(); // handle -> true (só controle local)

// Preferência de "ao fechar com o X": 'tray' (padrão, minimiza — não derruba
// call/transmissão) ou 'quit' (fecha de vez, igual antes da v3.3.0). Guardada
// num arquivo próprio (não dá pra ler o localStorage do renderer aqui no
// processo principal) — lida uma vez na subida, atualizada via IPC sempre
// que a pessoa muda a opção nas Configurações.
const closeBehaviorFile = path.join(app.getPath('userData'), 'close-behavior.json');
let closeBehavior = 'tray';
try {
  const saved = JSON.parse(fs.readFileSync(closeBehaviorFile, 'utf8'));
  if (saved && (saved.closeBehavior === 'tray' || saved.closeBehavior === 'quit')) closeBehavior = saved.closeBehavior;
} catch {
  /* primeira vez rodando (arquivo não existe ainda) ou arquivo corrompido — fica no padrão */
}

// Pasta onde os clipes (30s/60s) são salvos - padrão dentro de "Vídeos" com
// o nome NOVO do app ("Ribbit", já decidido pelo usuário pra não precisar
// renomear a pasta de novo quando a troca de nome acontecer de verdade em
// todo o resto). Criada sob demanda (só quando o primeiro clipe realmente
// for salvo), não aqui na subida - não faz sentido criar uma pasta vazia
// no PC de todo mundo só por ter instalado o app.
const DEFAULT_CLIP_DIR = path.join(app.getPath('videos'), 'Ribbit');
const clipDirFile = path.join(app.getPath('userData'), 'clip-dir.json');
let clipSaveDir = DEFAULT_CLIP_DIR;
try {
  const saved = JSON.parse(fs.readFileSync(clipDirFile, 'utf8'));
  if (saved && typeof saved.clipSaveDir === 'string' && saved.clipSaveDir) clipSaveDir = saved.clipSaveDir;
} catch {
  /* primeira vez rodando ou arquivo corrompido - fica no padrão */
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    autoHideMenuBar: true,
    // frame:false tira a barra nativa inteira (que no Windows do usuário
    // pinta com a cor de destaque do sistema, sempre destoando do tema do
    // app) - o index.html desenha a própria faixa do topo, 100% CSS
    // (var(--bg) etc.), reagindo ao tema sozinha sem precisar de IPC
    // nenhum pra recolorir nada nativo. Os botões de minimizar/maximizar/
    // fechar também são HTML próprios agora (ver window:minimize/
    // window:maximizeToggle/window:close abaixo) - tentei primeiro o
    // caminho "oficial" (titleBarStyle:'hidden' + titleBarOverlay, que
    // mantém os botões nativos só recolorindo a faixa deles) mas essa API
    // tem bugs conhecidos entre versões/config do Windows e não funcionou
    // aqui; frame:false é o jeito mais antigo mas também o mais confiável.
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadURL(`http://localhost:${PORT}/`);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  // Fechar com o X: por padrão só esconde a janela (igual Discord), pra não
  // derrubar chamada/transmissão em andamento — mas a pessoa pode trocar
  // pra "fechar de vez" nas Configurações (closeBehavior, ver acima).
  mainWindow.on('close', (event) => {
    if (!isQuitting && closeBehavior === 'tray') {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  const iconPath = path.join(__dirname, '..', 'build', 'icon.ico');
  tray = new Tray(nativeImage.createFromPath(iconPath));
  tray.setToolTip('Ribbit');
  const menu = Menu.buildFromTemplate([
    {
      label: 'Abrir',
      click: () => {
        mainWindow.show();
        mainWindow.focus();
      },
    },
    { type: 'separator' },
    {
      label: 'Sair',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
  tray.on('double-click', () => {
    mainWindow.show();
    mainWindow.focus();
  });
}

function createPickerWindow() {
  return new Promise((resolve) => {
    const picker = new BrowserWindow({
      width: 720,
      height: 480,
      modal: true,
      parent: mainWindow,
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, 'picker-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    picker.loadFile(path.join(__dirname, 'picker.html'));
    picker.webContents.on('did-fail-load', (_ev, errorCode, errorDescription) => {
      console.error('[picker] falha ao carregar picker.html:', errorCode, errorDescription);
    });
    picker.webContents.on('console-message', (_ev, level, message, line, sourceId) => {
      console.log('[picker console]', level, message, `(${sourceId}:${line})`);
    });
    picker.webContents.on('preload-error', (_ev, preloadPath, error) => {
      console.error('[picker] erro no preload:', preloadPath, error);
    });

    const onChoose = (_ev, sourceId) => {
      cleanup();
      resolve(sourceId);
    };
    const onCancel = () => {
      cleanup();
      resolve(null);
    };
    function cleanup() {
      ipcMain.removeListener('picker:choose', onChoose);
      ipcMain.removeListener('picker:cancel', onCancel);
      if (!picker.isDestroyed()) picker.close();
    }
    ipcMain.once('picker:choose', onChoose);
    ipcMain.once('picker:cancel', onCancel);
    picker.on('closed', () => resolve(null));
  });
}

app.whenReady().then(() => {
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 200 },
    });
    ipcMain.emit('picker:sources', null, sources);
    const chosenId = await createPickerWindow();
    const picked = sources.find((s) => s.id === chosenId);
    if (!picked) {
      callback({});
      return;
    }
    // Áudio vem só do módulo nativo (mixado no navegador); aqui é só vídeo.
    callback({ video: picked });
  });

  ipcMain.handle('picker:getSources', async () => {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 200 },
    });
    return sources.map((s) => ({ id: s.id, name: s.name, thumbnail: s.thumbnail.toDataURL() }));
  });

  // Modo admin: entrada de mouse/teclado vinda do renderer (via DataChannel,
  // já filtrada do outro lado pelas duas travas — flag do banco + toggle
  // local). Aqui só traduz pra chamada de addon nativo, sem checar nada de
  // novo (a decisão de aceitar o pedido já foi tomada no app.js).
  ipcMain.handle('native:remoteInput', (_event, msg) => {
    if (!nativeAddon || !msg) return;
    try {
      if (msg.type === 'mousemove') nativeAddon.sendMouseMove(msg.x, msg.y);
      else if (msg.type === 'mousebutton') nativeAddon.sendMouseButton(msg.button, !!msg.down);
      else if (msg.type === 'wheel') nativeAddon.sendMouseWheel(msg.deltaY);
      else if (msg.type === 'key') nativeAddon.sendKeyEvent(msg.vkCode, !!msg.down);
    } catch (err) {
      console.warn('[modo admin] erro ao executar input remoto:', err.message);
    }
  });

  ipcMain.handle('native:listApps', () => {
    if (!nativeAddon) return [];
    try {
      return nativeAddon.listAudioApps();
    } catch (err) {
      console.warn('listAudioApps falhou:', err.message);
      return [];
    }
  });

  ipcMain.handle('native:startCapture', (event, pid) => {
    if (!nativeAddon) return null;
    const sender = event.sender;
    const handle = nativeAddon.startCapture(pid, (buffer) => {
      if (sender.isDestroyed()) return;
      sender.send('native:audioChunk', { pid, buffer });
    });
    captureHandles.set(handle, pid);
    return handle;
  });

  ipcMain.handle('native:stopCapture', (_event, handle) => {
    if (!nativeAddon || handle == null) return;
    nativeAddon.stopCapture(handle);
    captureHandles.delete(handle);
  });

  ipcMain.handle('native:available', () => !!nativeAddon);

  ipcMain.handle('app:getVersion', () => app.getVersion());
  ipcMain.handle('app:quitAndInstall', () => {
    isQuitting = true;
    return autoUpdater.quitAndInstall();
  });

  ipcMain.handle('app:getCloseBehavior', () => closeBehavior);
  ipcMain.handle('app:setCloseBehavior', (_event, value) => {
    if (value !== 'tray' && value !== 'quit') return;
    closeBehavior = value;
    try {
      fs.writeFileSync(closeBehaviorFile, JSON.stringify({ closeBehavior }));
    } catch (err) {
      console.warn('Não deu pra salvar a preferência de fechar o app:', err.message);
    }
  });
  // clipes: pasta de destino configurável (padrão Vídeos/Ribbit) + salvar
  // de verdade no disco. O renderer manda o Blob já pronto (como
  // ArrayBuffer, via IPC - contextIsolation:true usa structured clone, que
  // transporta ArrayBuffer sem problema) e o processo principal escreve o
  // arquivo, criando a pasta se ainda não existir.
  ipcMain.handle('clip:getSaveDir', () => clipSaveDir);
  ipcMain.handle('clip:chooseSaveDir', async () => {
    if (!mainWindow) return clipSaveDir;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Escolher pasta pra salvar os clipes',
      defaultPath: clipSaveDir,
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return clipSaveDir;
    clipSaveDir = result.filePaths[0];
    try {
      fs.writeFileSync(clipDirFile, JSON.stringify({ clipSaveDir }));
    } catch (err) {
      console.warn('Não deu pra salvar a pasta de clipes escolhida:', err.message);
    }
    return clipSaveDir;
  });
  ipcMain.handle('clip:resetSaveDir', () => {
    clipSaveDir = DEFAULT_CLIP_DIR;
    try {
      fs.writeFileSync(clipDirFile, JSON.stringify({ clipSaveDir }));
    } catch (err) {
      console.warn('Não deu pra salvar a pasta de clipes (reset):', err.message);
    }
    return clipSaveDir;
  });
  ipcMain.handle('clip:saveFile', async (_event, { filename, buffer }) => {
    try {
      fs.mkdirSync(clipSaveDir, { recursive: true });
      const fullPath = path.join(clipSaveDir, filename);
      fs.writeFileSync(fullPath, Buffer.from(buffer));
      return { ok: true, path: fullPath };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // botões de minimizar/maximizar/fechar da faixa própria (frame:false tirou
  // os nativos) - maximizeToggle alterna com base no estado atual da janela,
  // e avisa o renderer (window:maximizeChanged) pra trocar o ícone certo
  // (maximizar vs restaurar) mesmo quando o usuário maximiza/restaura pelo
  // SO (ex: arrastando pro topo da tela), não só pelo próprio botão.
  ipcMain.handle('window:minimize', () => mainWindow && mainWindow.minimize());
  ipcMain.handle('window:maximizeToggle', () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.handle('window:close', () => mainWindow && mainWindow.close());
  if (mainWindow) {
    mainWindow.on('maximize', () => mainWindow.webContents.send('window:maximizeChanged', true));
    mainWindow.on('unmaximize', () => mainWindow.webContents.send('window:maximizeChanged', false));
  }

  // Só registra em build empacotado - em dev o "exe" é o electron.exe
  // genérico, registrar o protocolo nele faria QUALQUER coisa que abra um
  // link ribbit:// disparar o Electron cru sem carregar nosso app.
  if (app.isPackaged) {
    app.setAsDefaultProtocolClient('ribbit');
    app.setAsDefaultProtocolClient('suvacodajinx'); // links antigos continuam abrindo o app
  }

  createMainWindow();
  createTray();

  // link de convite clicado com o app ainda FECHADO - a janela acabou de
  // ser criada, precisa esperar a página carregar antes de mandar o IPC
  // (senão o preload ainda não registrou o listener do lado do renderer).
  const initialInviteCode = extractInviteCodeFromArgv(process.argv);
  if (initialInviteCode) {
    mainWindow.webContents.once('did-finish-load', () => sendInviteCodeToRenderer(initialInviteCode));
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    else {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  if (app.isPackaged) {
    autoUpdater.checkForUpdates().catch((err) => {
      console.warn('[auto-update] não deu pra checar atualização agora:', err.message);
    });
    // Fechar com o X só minimiza pra bandeja (ver 'close' do mainWindow
    // abaixo) - o processo pode ficar vivo por dias sem reiniciar de
    // verdade, e checkForUpdates() acima só roda uma vez, logo no boot.
    // Sem isso, quem deixa o app sempre aberto na bandeja nunca recebe
    // atualização nenhuma depois do primeiro check, mesmo com releases
    // novas saindo - rechecar a cada 4h cobre isso sem bater na API do
    // GitHub toda hora.
    setInterval(() => {
      autoUpdater.checkForUpdates().catch((err) => {
        console.warn('[auto-update] não deu pra checar atualização agora:', err.message);
      });
    }, 4 * 60 * 60 * 1000);
  }
});

app.on('window-all-closed', () => {
  // Com closeBehavior='tray' (padrão) a janela nunca é de fato destruída ao
  // fechar (ver mainWindow.on('close') acima) — só escondida, com a bandeja
  // mantendo o app vivo; isso só dispara quando isQuitting já é true (Sair
  // da bandeja, ou update). Com closeBehavior='quit', a janela fecha de
  // verdade e cai aqui direto — também precisa encerrar o app de vez.
  if (process.platform !== 'darwin' && (isQuitting || closeBehavior === 'quit')) app.quit();
});
