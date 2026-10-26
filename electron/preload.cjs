const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('icejazzDesktop', {
  isDesktopApp: true,
  minimizeToTray: () => ipcRenderer.send('window-minimize-to-tray'),
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  quitApp: () => ipcRenderer.send('window-quit'),
  onTrayCommand: (callback) => {
    const handler = (_event, command) => callback(command);
    ipcRenderer.on('tray-command', handler);
    return () => ipcRenderer.removeListener('tray-command', handler);
  },
});
