'use strict';

const { BrowserWindow } = require('electron');

// These switches harden Chromium's network stack. The only deliberate network
// client is the explicit model downloader in the main process, which uses
// Node's HTTPS stack and verifies pinned hashes; do not add a renderer exception.
function applyOfflineSwitches(isPackaged) {
  const switches = [
    ['disable-background-networking', null],
    ['disable-component-update', null],
    ['disable-domain-reliability', null],
    ['disable-sync', null],
    ['disable-breakpad', null],
    ['metrics-recording-only', null],
    ['no-pings', null],
    [
      'disable-features',
      'NetworkPrediction,OptimizationHints,AutofillServerCommunication,Translate,MediaRouter,InterestFeedContentSuggestions'
    ]
  ];
  for (const [name, value] of switches) {
    if (value == null) {
      try {
        require('electron').app.commandLine.appendSwitch(name);
      } catch {
        // The app module is always available in the main process.
      }
    } else {
      try {
        require('electron').app.commandLine.appendSwitch(name, value);
      } catch {
        // Ignore switch failures; the session filter below is the hard stop.
      }
    }
  }
  if (isPackaged) {
    try {
      require('electron').app.commandLine.appendSwitch(
        'host-resolver-rules',
        'MAP * ~NOTFOUND'
      );
    } catch {
      // The session filter still blocks egress.
    }
  }
}

function normalizeDevOrigin(devUrl) {
  if (!devUrl) return null;
  try {
    const parsed = new URL(devUrl);
    if (parsed.protocol !== 'http:') return null;
    if (parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') return null;
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

function isAllowedRequest(rawUrl, devOrigin) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }

  if (['file:', 'data:', 'blob:', 'about:', 'devtools:'].includes(parsed.protocol)) {
    return true;
  }

  if (devOrigin) {
    const origin = `${parsed.protocol}//${parsed.host}`;
    if (origin === devOrigin) return true;
    if (
      (parsed.protocol === 'ws:' || parsed.protocol === 'wss:') &&
      `${parsed.protocol === 'ws:' ? 'http:' : 'https:'}//${parsed.host}` === devOrigin
    ) {
      return true;
    }
  }

  return false;
}

function hardenSession(defaultSession, { devOrigin }) {
  defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  defaultSession.setPermissionCheckHandler(() => false);
  try {
    defaultSession.setSpellCheckerEnabled(false);
  } catch {
    // Spellchecking is optional; not all Electron builds expose this.
  }

  defaultSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    if (isAllowedRequest(details.url, devOrigin)) {
      callback({});
      return;
    }
    try {
      const parsed = new URL(details.url);
      console.warn(`[airgap] blocked ${parsed.protocol}//${parsed.hostname || 'local'}`);
    } catch {
      console.warn('[airgap] blocked an unparseable request');
    }
    callback({ cancel: true });
  });
}

function hardenWebContents(webContents, { devOrigin, isPackaged }) {
  webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
  webContents.on('will-navigate', (event, navigationUrl) => {
    if (isAllowedRequest(navigationUrl, devOrigin)) return;
    event.preventDefault();
  });
  webContents.on('will-redirect', (event, navigationUrl) => {
    if (isAllowedRequest(navigationUrl, devOrigin)) return;
    event.preventDefault();
  });
  webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const devToolsShortcut =
      (input.control || input.meta) && input.shift && input.key.toLowerCase() === 'i';
    if (devToolsShortcut && isPackaged && !process.env.LICHEN_DEVTOOLS) {
      event.preventDefault();
    }
  });
}

async function verifyOffline() {
  const probe = new BrowserWindow({
    show: false,
    width: 2,
    height: 2,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      devTools: false,
      spellcheck: false
    }
  });
  try {
    await probe.loadURL('data:text/html;charset=UTF-8,<title>airgap</title><body>probe</body>');
    const result = await probe.webContents.executeJavaScript(
      `(async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 4000);
        try {
          await fetch('https://lichen-airgap-probe.invalid/?source=offline-check', {
            mode: 'no-cors',
            cache: 'no-store',
            signal: controller.signal
          });
          return { blocked: false, detail: 'A network request unexpectedly completed.' };
        } catch (error) {
          return { blocked: true, detail: String(error && (error.message || error)) };
        } finally {
          clearTimeout(timer);
        }
      })()`,
      true
    );
    return {
      blocked: Boolean(result && result.blocked),
      detail: result && result.detail ? String(result.detail).slice(0, 300) : ''
    };
  } catch (error) {
    return { blocked: true, detail: String(error.message || error).slice(0, 300) };
  } finally {
    if (!probe.isDestroyed()) probe.destroy();
  }
}

module.exports = {
  applyOfflineSwitches,
  normalizeDevOrigin,
  isAllowedRequest,
  hardenSession,
  hardenWebContents,
  verifyOffline
};
