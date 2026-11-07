// Ponte segura entre a janela principal (server/public/app.js, que continua
// sendo HTML/JS "normal") e as capacidades nativas do Electron.
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('telaNative', {
  available: () => ipcRenderer.invoke('native:available'),
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  listApps: () => ipcRenderer.invoke('native:listApps'),
  startCapture: (pid) => ipcRenderer.invoke('native:startCapture', pid),
  stopCapture: (handle) => ipcRenderer.invoke('native:stopCapture', handle),
  onAudioChunk: (cb) => {
    const listener = (_event, payload) => cb(payload);
    ipcRenderer.on('native:audioChunk', listener);
    return () => ipcRenderer.removeListener('native:audioChunk', listener);
  },
  quitAndInstall: () => ipcRenderer.invoke('app:quitAndInstall'),
  getCloseBehavior: () => ipcRenderer.invoke('app:getCloseBehavior'),
  setCloseBehavior: (value) => ipcRenderer.invoke('app:setCloseBehavior', value),
  getClipSaveDir: () => ipcRenderer.invoke('clip:getSaveDir'),
  chooseClipSaveDir: () => ipcRenderer.invoke('clip:chooseSaveDir'),
  resetClipSaveDir: () => ipcRenderer.invoke('clip:resetSaveDir'),
  saveClipFile: (filename, buffer) => ipcRenderer.invoke('clip:saveFile', { filename, buffer }),
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  maximizeToggleWindow: () => ipcRenderer.invoke('window:maximizeToggle'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  onMaximizeChanged: (cb) => {
    const listener = (_e, isMaximized) => cb(isMaximized);
    ipcRenderer.on('window:maximizeChanged', listener);
    return () => ipcRenderer.removeListener('window:maximizeChanged', listener);
  },
  sendRemoteInput: (msg) => ipcRenderer.invoke('native:remoteInput', msg),
  onJoinByCode: (cb) => {
    const listener = (_event, code) => cb(code);
    ipcRenderer.on('app:joinByCode', listener);
    return () => ipcRenderer.removeListener('app:joinByCode', listener);
  },
  onUpdateReady: (cb) => {
    const listener = (_event, payload) => cb(payload);
    ipcRenderer.on('update:ready', listener);
    return () => ipcRenderer.removeListener('update:ready', listener);
  },
});
