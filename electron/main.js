// Processo principal do Electron. Sobe o MESMO servidor local do modo antigo
// (server/main.cjs, sem mudar nada nele) e adiciona por cima: a janela do
// app, o seletor de tela/janela (getDisplayMedia) e a ponte com o módulo
// nativo de captura de áudio por processo (mute por app).
'use strict';

const path = require('node:path');
const { app, BrowserWindow, ipcMain, desktopCapturer, session, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');

// Atualização automática via GitHub Releases (github.com/Doug3011/suvaco-da-jinx).
// Só roda no app empacotado de verdade — em dev (`npm start`) não tem update
// feed configurado e só ia gerar erro no console à toa.
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.on('update-downloaded', (info) => {
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
      if (response === 0) autoUpdater.quitAndInstall();
    });
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

  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });

  if (app.isPackaged) {
    autoUpdater.checkForUpdates().catch((err) => {
      console.warn('[auto-update] não deu pra checar atualização agora:', err.message);
    });
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
