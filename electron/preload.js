const { contextBridge, ipcRenderer } = require('electron');

let _updateHandler = null;

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  isElectron: true,
  appVersion: require('./package.json').version,

  onUpdateStatus: (callback) => {
    if (_updateHandler) {
      ipcRenderer.removeListener('update-status', _updateHandler);
    }
    _updateHandler = (_event, data) => callback(data);
    ipcRenderer.on('update-status', _updateHandler);
  },
  installUpdate: () => ipcRenderer.send('install-update'),
  checkForUpdates: () => ipcRenderer.send('check-for-updates'),
  requestLastUpdateStatus: () => ipcRenderer.send('get-last-update-status'),
  showAbout: () => ipcRenderer.send('show-about'),
});
