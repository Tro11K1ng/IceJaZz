import { spawn, execSync } from 'node:child_process';
import http from 'node:http';

/**
 * One-command launcher (`npm run jazz`):
 * 1. Checks if `electron` is installed locally; if not, installs it automatically.
 * 2. Starts the Vite server on port 3000 (without opening a browser tab).
 * 3. Waits for port 3000 to be ready and launches the native Electron desktop window with System Tray support.
 */
function ensureElectronInstalled() {
  try {
    execSync('node -e "require.resolve(\'electron\')"', { stdio: 'ignore' });
  } catch {
    console.log('[IceJaZz] Installing Electron native desktop runtime (first-time setup)...');
    execSync('npm install --save-dev electron', { stdio: 'inherit' });
  }
}

function waitForServer(url, timeoutMs = 15000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      http
        .get(url, (res) => {
          res.resume();
          resolve();
        })
        .on('error', () => {
          if (Date.now() - start > timeoutMs) {
            reject(new Error('Timeout waiting for local server'));
          } else {
            setTimeout(check, 250);
          }
        });
    };
    check();
  });
}

async function main() {
  ensureElectronInstalled();

  console.log('[IceJaZz] Starting local audio engine server...');
  const viteProc = spawn('npx', ['vite', '--port=3000', '--host=127.0.0.1'], {
    stdio: 'inherit',
    shell: true,
  });

  await waitForServer('http://127.0.0.1:3000');
  console.log('[IceJaZz] Launching native desktop window (with System Tray support)...');

  const electronProc = spawn('npx', ['electron', 'electron/main.cjs'], {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, ELECTRON_START_URL: 'http://127.0.0.1:3000' },
  });

  electronProc.on('exit', () => {
    viteProc.kill();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('[IceJaZz] Launch error:', err);
  process.exit(1);
});
