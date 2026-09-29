// Ponte segura entre a janela principal (server/public/app.js, que continua
// sendo HTML/JS "normal") e as capacidades nativas do Electron.
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('telaNative', {
  available: () => ipcRenderer.invoke('native:available'),
  listApps: () => ipcRenderer.invoke('native:listApps'),
  startCapture: (pid) => ipcRenderer.invoke('native:startCapture', pid),
  stopCapture: (handle) => ipcRenderer.invoke('native:stopCapture', handle),
  onAudioChunk: (cb) => {
    const listener = (_event, payload) => cb(payload);
    ipcRenderer.on('native:audioChunk', listener);
    return () => ipcRenderer.removeListener('native:audioChunk', listener);
  },
});
