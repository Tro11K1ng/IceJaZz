const { contextBridge, ipcRenderer, webUtils } = require('electron');

// Cache native file paths in the preload isolated world during capture phase
// BEFORE contextBridge clones File objects across V8 contexts.
const nativePathCache = new Map();

function cacheFileObjectPath(file) {
  if (!file) return '';
  try {
    let p = '';
    if (webUtils && typeof webUtils.getPathForFile === 'function') {
      p = webUtils.getPathForFile(file) || '';
    }
    if (!p && typeof file.path === 'string') {
      p = file.path;
    }
    if (p) {
      const rel = file.webkitRelativePath || '';
      const key1 = `${file.name}::${file.size}::${file.lastModified}`;
      const key2 = `${rel}::${file.size}`;
      const key3 = `${file.name}::${file.size}`;
      nativePathCache.set(key1, p);
      if (rel) nativePathCache.set(key2, p);
      nativePathCache.set(key3, p);
    }
    return p;
  } catch {
    return (file && file.path) || '';
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener(
    'change',
    (e) => {
      try {
        const target = e.target;
        if (target && target.files && target.files.length > 0) {
          for (let i = 0; i < target.files.length; i++) {
            cacheFileObjectPath(target.files[i]);
          }
        }
      } catch {
        // Ignore
      }
    },
    true
  );

  window.addEventListener(
    'drop',
    (e) => {
      try {
        const dt = e.dataTransfer;
        if (dt && dt.files && dt.files.length > 0) {
          for (let i = 0; i < dt.files.length; i++) {
            cacheFileObjectPath(dt.files[i]);
          }
        }
      } catch {
        // Ignore
      }
    },
    true
  );
}

contextBridge.exposeInMainWorld('icejazzDesktop', {
  isDesktopApp: true,
  getFilePath: (file) => {
    const direct = cacheFileObjectPath(file);
    if (direct) return direct;
    if (!file) return '';
    const rel = file.webkitRelativePath || '';
    return (
      nativePathCache.get(`${file.name}::${file.size}::${file.lastModified}`) ||
      (rel && nativePathCache.get(`${rel}::${file.size}`)) ||
      nativePathCache.get(`${file.name}::${file.size}`) ||
      ''
    );
  },
  lookupFilePath: (name, size, lastModified, relPath) => {
    return (
      nativePathCache.get(`${name}::${size}::${lastModified}`) ||
      (relPath && nativePathCache.get(`${relPath}::${size}`)) ||
      nativePathCache.get(`${name}::${size}`) ||
      ''
    );
  },
  scanDirectoryNative: () => ipcRenderer.invoke('icejazz:scan-directory'),
  resolveMissingPaths: (items) =>
    ipcRenderer.invoke('icejazz:resolve-missing-paths', items),
  onScanProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('icejazz:scan-progress', handler);
    return () => ipcRenderer.removeListener('icejazz:scan-progress', handler);
  },
  minimizeToTray: () => ipcRenderer.invoke('icejazz:minimize-to-tray'),
  minimizeWindow: () => ipcRenderer.invoke('icejazz:minimize-window'),
  toggleMaximize: () => ipcRenderer.invoke('icejazz:toggle-maximize'),
  setOverlayMode: (enabled, width, height) =>
    ipcRenderer.invoke('icejazz:set-overlay-mode', enabled, width, height),
  updateDiscordPresence: (payload) =>
    ipcRenderer.invoke('icejazz:update-discord-presence', payload),
  reconnectDiscord: () => ipcRenderer.invoke('icejazz:reconnect-discord'),
  getAutostart: () => ipcRenderer.invoke('icejazz:get-autostart'),
  setAutostart: (cfg) => ipcRenderer.invoke('icejazz:set-autostart', cfg),
  openExternalUrl: (url) => ipcRenderer.invoke('icejazz:open-external', url),
  quitApp: () => ipcRenderer.invoke('icejazz:quit-app'),
  readLocalFile: (filePath) => ipcRenderer.invoke('icejazz:read-file', filePath),
  selectDirectory: () => ipcRenderer.invoke('icejazz:select-directory'),
  onTrayCommand: (callback) => {
    const handler = (_event, cmd) => callback(cmd);
    ipcRenderer.on('icejazz:tray-command', handler);
    return () => ipcRenderer.removeListener('icejazz:tray-command', handler);
  },
});
