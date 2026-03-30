const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const net = require('net');
const { autoUpdater } = require('electron-updater');

const IS_DEV = process.argv.includes('--dev');

let mainWindow = null;
let splashWindow = null;
let backendProcess = null;
let backendPort = null;

// --------------- Auto-updater setup ---------------

autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

function initAutoUpdater() {
  if (IS_DEV || !app.isPackaged) return;

  autoUpdater.on('checking-for-update', () => {
    sendUpdateStatus('checking');
  });

  autoUpdater.on('update-available', (info) => {
    sendUpdateStatus('available', { version: info.version });
  });

  autoUpdater.on('update-not-available', () => {
    sendUpdateStatus('not-available');
  });

  autoUpdater.on('download-progress', (progress) => {
    sendUpdateStatus('downloading', { percent: Math.round(progress.percent) });
  });

  autoUpdater.on('update-downloaded', (info) => {
    sendUpdateStatus('ready', { version: info.version });
  });

  autoUpdater.on('error', (err) => {
    sendUpdateStatus('error', { message: err?.message || 'Unknown error' });
  });

  autoUpdater.checkForUpdates().catch(() => {});
}

function sendUpdateStatus(status, data = {}) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-status', { status, ...data });
  }
}

ipcMain.on('install-update', () => {
  autoUpdater.quitAndInstall(false, true);
});

ipcMain.on('check-for-updates', () => {
  if (!IS_DEV && app.isPackaged) {
    autoUpdater.checkForUpdates().catch(() => {});
  }
});

function getBackendPath() {
  if (IS_DEV) return null;
  const isPacked = app.isPackaged;
  if (isPacked) {
    return path.join(process.resourcesPath, 'backend', 'LapForge.exe');
  }
  // Running from source (npx electron .) — look in project dist/
  const localBackend = path.join(__dirname, '..', 'dist', 'backend', 'LapForge.exe');
  return localBackend;
}

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 400,
    height: 300,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  splashWindow.loadFile(path.join(__dirname, 'splash.html'));
  splashWindow.center();
}

function createMainWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadURL(`http://127.0.0.1:${port}/`);

  mainWindow.once('ready-to-show', () => {
    if (splashWindow) {
      splashWindow.destroy();
      splashWindow = null;
    }
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function waitForServer(port, retries, delay) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    function tryConnect() {
      attempts++;
      const sock = new net.Socket();
      sock.setTimeout(1000);
      sock.once('connect', () => {
        sock.destroy();
        resolve();
      });
      sock.once('error', () => {
        sock.destroy();
        if (attempts >= retries) {
          reject(new Error(`Backend not reachable after ${retries} attempts`));
        } else {
          setTimeout(tryConnect, delay);
        }
      });
      sock.once('timeout', () => {
        sock.destroy();
        if (attempts >= retries) {
          reject(new Error(`Backend connection timed out after ${retries} attempts`));
        } else {
          setTimeout(tryConnect, delay);
        }
      });
      sock.connect(port, '127.0.0.1');
    }
    tryConnect();
  });
}

function startBackend() {
  return new Promise((resolve, reject) => {
    const exePath = getBackendPath();
    if (!exePath) {
      reject(new Error('No backend executable (use --dev for development mode)'));
      return;
    }

    const child = spawn(exePath, ['--production', '--port', '0'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    backendProcess = child;
    let resolved = false;

    child.stdout.on('data', (data) => {
      const text = data.toString();
      if (!resolved) {
        const match = text.match(/FLASK_READY:port=(\d+)/);
        if (match) {
          resolved = true;
          backendPort = parseInt(match[1], 10);
          resolve(backendPort);
        }
      }
    });

    child.stderr.on('data', (data) => {
      if (!resolved) {
        const text = data.toString();
        const match = text.match(/Running on http:\/\/127\.0\.0\.1:(\d+)/);
        if (match) {
          resolved = true;
          backendPort = parseInt(match[1], 10);
          resolve(backendPort);
        }
      }
    });

    child.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        reject(new Error(`Failed to start backend: ${err.message}`));
      }
    });

    child.on('exit', (code) => {
      if (!resolved) {
        resolved = true;
        reject(new Error(`Backend exited unexpectedly with code ${code}`));
      }
      backendProcess = null;
    });

    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        reject(new Error('Backend did not signal ready within 30 seconds'));
      }
    }, 30000);
  });
}

function killBackend() {
  if (!backendProcess) return Promise.resolve();
  return new Promise((resolve) => {
    const child = backendProcess;
    backendProcess = null;

    const forceKillTimer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch (_) {}
      resolve();
    }, 5000);

    child.once('exit', () => {
      clearTimeout(forceKillTimer);
      resolve();
    });

    try { child.kill('SIGTERM'); } catch (_) {}
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    if (IS_DEV) {
      const port = 5000;
      createSplashWindow();
      try {
        await waitForServer(port, 30, 1000);
      } catch {
        dialog.showErrorBox('Dev Server Not Running',
          'Start the Flask dev server first:\n\npython -m LapForge.app');
        app.quit();
        return;
      }
      createMainWindow(port);
      return;
    }

    createSplashWindow();
    try {
      const port = await startBackend();
      await waitForServer(port, 20, 500);
      createMainWindow(port);
      initAutoUpdater();
    } catch (err) {
      dialog.showErrorBox('Startup Error', err.message);
      await killBackend();
      app.quit();
    }
  });

  app.on('window-all-closed', async () => {
    await killBackend();
    app.quit();
  });

  app.on('before-quit', async () => {
    await killBackend();
  });
}
