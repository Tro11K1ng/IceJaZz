const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage } = require('electron');
const path = require('path');

let mainWindow = null;
let tray = null;
let isQuitting = false;

// Create a crisp 16x16 RGBA tray icon programmatically so no external .ico file is required
function createTrayIcon() {
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const dx = x - 7.5;
      const dy = y - 7.5;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= 7.0) {
        // Inner disc (cobalt blue #3B82F6 -> BGRA for nativeImage bitmap)
        if (dist <= 2.2) {
          buf[idx] = 246;     // B
          buf[idx + 1] = 244; // G
          buf[idx + 2] = 243; // R
          buf[idx + 3] = 255; // A
        } else {
          buf[idx] = 246;     // B
          buf[idx + 1] = 130; // G
          buf[idx + 2] = 59;  // R
          buf[idx + 3] = 255; // A
        }
      } else {
        buf[idx + 3] = 0;
      }
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

function setupTray() {
  if (tray) return;
  const icon = createTrayIcon();
  tray = new Tray(icon);
  tray.setToolTip('IceJaZz Audio Player');

  const updateMenu = () => {
    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Open IceJaZz',
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          }
        },
      },
      { type: 'separator' },
      {
        label: 'Play / Pause',
        click: () => mainWindow?.webContents.send('tray-command', 'play-pause'),
      },
      {
        label: 'Next Track',
        click: () => mainWindow?.webContents.send('tray-command', 'next'),
      },
      {
        label: 'Previous Track',
        click: () => mainWindow?.webContents.send('tray-command', 'prev'),
      },
      { type: 'separator' },
      {
        label: 'Minimize to System Tray',
        click: () => mainWindow?.hide(),
      },
      {
        label: 'Quit IceJaZz',
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]);
    tray.setContextMenu(contextMenu);
  };

  updateMenu();

  tray.on('click', () => {
    if (!mainWindow) return;
    if (mainWindow.isVisible()) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    title: 'IceJaZz',
    backgroundColor: '#0F1115',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  const devUrl = process.env.ELECTRON_START_URL || 'http://localhost:3000';
  mainWindow.loadURL(devUrl);

  // Intercept window close -> minimize to system tray instead of exiting
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

ipcMain.on('window-minimize-to-tray', () => {
  if (mainWindow) {
    mainWindow.hide();
  }
});

ipcMain.on('window-minimize', () => {
  if (mainWindow) {
    mainWindow.minimize();
  }
});

ipcMain.on('window-quit', () => {
  isQuitting = true;
  app.quit();
});

app.whenReady().then(() => {
  setupTray();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else if (mainWindow) {
      mainWindow.show();
    }
  });
});

app.on('before-quit', () => {
  isQuitting = true;
});
