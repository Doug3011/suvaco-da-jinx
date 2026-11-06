// Processo principal do Electron. Sobe o MESMO servidor local do modo antigo
// (server/main.cjs, sem mudar nada nele) e adiciona por cima: a janela do
// app, o seletor de tela/janela (getDisplayMedia) e a ponte com o módulo
// nativo de captura de áudio por processo (mute por app).
'use strict';

const path = require('node:path');
const { app, BrowserWindow, ipcMain, desktopCapturer, session, dialog, shell, Tray, Menu, nativeImage } = require('electron');
const { autoUpdater } = require('electron-updater');

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
        message: `Uma nova versão (${info.version}) do Suvaco da Jinx foi baixada.`,
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

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    autoHideMenuBar: true,
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
  // Fechar com o X não encerra o app (igual Discord) — só esconde a janela,
  // pra não derrubar chamada/transmissão em andamento. Só sai de verdade
  // pelo "Sair" da bandeja ou pelo fluxo de atualização (isQuitting=true).
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  const iconPath = path.join(__dirname, '..', 'build', 'icon.ico');
  tray = new Tray(nativeImage.createFromPath(iconPath));
  tray.setToolTip('Suvaco da Jinx');
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

  createMainWindow();
  createTray();

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
  }
});

app.on('window-all-closed', () => {
  // A janela nunca é de fato destruída ao fechar (ver mainWindow.on('close')
  // acima) — só escondida, com a bandeja mantendo o app vivo. Isso só
  // dispara mesmo quando isQuitting já é true (Sair da bandeja, ou update).
  if (process.platform !== 'darwin' && isQuitting) app.quit();
});
