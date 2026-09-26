import { app, BrowserWindow, ipcMain, clipboard, shell, globalShortcut, desktopCapturer, screen } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import selfsigned from 'selfsigned';
import { fileURLToPath } from 'url';
import { LocalCompanionWebSocketServer } from './websocket-server.js';
import { IPC_CHANNELS, AppPreferences, ConnectionStatusPayload } from './ipc.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Project root: the bundled main runs from electron/out/, the source layout from electron/
const PROJECT_ROOT = path.resolve(__dirname, path.basename(__dirname) === 'out' ? '../..' : '..');

// Accept senders from other machines on the network by default; set COMPANION_HOST=127.0.0.1 for this machine only
const WS_HOST = process.env.COMPANION_HOST || '0.0.0.0';
const WS_PORT = process.env.COMPANION_PORT ? parseInt(process.env.COMPANION_PORT, 10) : 8765;

let mainWindow: BrowserWindow | null = null;
let wsServer: LocalCompanionWebSocketServer | null = null;
let clipboardWatchEnabled = false;
let clipboardPollTimer: NodeJS.Timeout | null = null;
let lastClipboardText = '';

// Session token is persisted so the sender machine does not need a new token after every restart
const getTokenFilePath = () => path.join(app.getPath('userData'), 'companion-session-token');

function loadOrCreateSessionToken(): string {
  try {
    const file = getTokenFilePath();
    if (fs.existsSync(file)) {
      const token = fs.readFileSync(file, 'utf8').trim();
      if (/^[0-9a-f]{8,64}$/.test(token)) return token;
    }
  } catch (err) {
    console.warn('Failed to read session token:', err);
  }
  const token = crypto.randomBytes(16).toString('hex');
  saveSessionToken(token);
  return token;
}

function saveSessionToken(token: string) {
  try {
    fs.writeFileSync(getTokenFilePath(), token, 'utf8');
  } catch (err) {
    console.error('Failed to save session token:', err);
  }
}

// host:port addresses a sender on another machine can use to reach this companion
function getReachableAddresses(): string[] {
  if (WS_HOST !== '0.0.0.0') return [`${WS_HOST}:${WS_PORT}`];
  const addresses: string[] = [];
  for (const iface of Object.values(os.networkInterfaces())) {
    for (const info of iface || []) {
      if (info.family === 'IPv4' && !info.internal) addresses.push(`${info.address}:${WS_PORT}`);
    }
  }
  return addresses;
}

// Self-signed TLS cert so the WebSocket service can serve wss:// (an https:// sender page,
// e.g. one deployed on the web, cannot open a plain ws:// connection — browsers block that
// as mixed content). Persisted so the browser's one-time "unsafe certificate" trust exception
// survives app restarts, and covers every LAN IP so there is no separate hostname-mismatch warning.
const getTlsFilePaths = () => ({
  key: path.join(app.getPath('userData'), 'companion-tls-key.pem'),
  cert: path.join(app.getPath('userData'), 'companion-tls-cert.pem'),
});

async function loadOrCreateTlsCert(): Promise<{ key: string; cert: string }> {
  const { key: keyFile, cert: certFile } = getTlsFilePaths();
  try {
    if (fs.existsSync(keyFile) && fs.existsSync(certFile)) {
      return { key: fs.readFileSync(keyFile, 'utf8'), cert: fs.readFileSync(certFile, 'utf8') };
    }
  } catch (err) {
    console.warn('Failed to read TLS cert, generating a new one:', err);
  }

  const altNames: { type: 2 | 7; ip?: string; value?: string }[] = [
    { type: 2, value: 'localhost' },
    { type: 7, ip: '127.0.0.1' },
  ];
  for (const iface of Object.values(os.networkInterfaces())) {
    for (const info of iface || []) {
      if (info.family === 'IPv4' && !info.internal) altNames.push({ type: 7, ip: info.address });
    }
  }

  const notBeforeDate = new Date();
  const notAfterDate = new Date(notBeforeDate);
  notAfterDate.setFullYear(notAfterDate.getFullYear() + 10);
  const pems = await selfsigned.generate([{ name: 'commonName', value: 'Window auto Update Companion' }], {
    notBeforeDate,
    notAfterDate,
    keySize: 2048,
    extensions: [{ name: 'subjectAltName', altNames }],
  });

  try {
    fs.writeFileSync(keyFile, pems.private, 'utf8');
    fs.writeFileSync(certFile, pems.cert, 'utf8');
  } catch (err) {
    console.error('Failed to persist TLS cert (will regenerate next launch):', err);
  }
  return { key: pems.private, cert: pems.cert };
}

function buildConnectionStatus(connected: boolean): ConnectionStatusPayload {
  return {
    connected,
    statusText: connected ? 'Connected' : 'Disconnected',
    port: WS_PORT,
    sessionToken: wsServer ? wsServer.getSessionToken() : '',
    addresses: getReachableAddresses(),
  };
}

// Preferences storage file (Only store preferences, NEVER received text per spec #13 & #15)
const getPreferencesFilePath = () => path.join(app.getPath('userData'), 'companion-preferences.json');

const DEFAULT_PREFERENCES: AppPreferences = {
  width: 600,
  height: 500,
  fontSize: 16,
  theme: 'dark',
  autoScroll: true,
  // On by default: copying is the main way text reaches the web page
  clipboardWatch: true,
  // Pinned by default: with no taskbar button, an unpinned window gets lost behind other apps
  alwaysOnTop: true,
  // Where the web sender page is hosted, for the pairing link (Security modal). The companion
  // window has no reachable origin of its own to infer this from (a packaged app loads a local
  // file), so it defaults to .env's APP_URL if set, else the deployed site, and is user-editable.
  webAppUrl:
    process.env.APP_URL && process.env.APP_URL !== 'MY_APP_URL'
      ? process.env.APP_URL
      : 'https://windowupdate.ai.studio',
};

function loadStoredPreferences(): AppPreferences {
  try {
    const file = getPreferencesFilePath();
    if (fs.existsSync(file)) {
      const data = fs.readFileSync(file, 'utf8');
      return { ...DEFAULT_PREFERENCES, ...JSON.parse(data) };
    }
  } catch (err) {
    console.warn('Failed to read preferences:', err);
  }
  return DEFAULT_PREFERENCES;
}

function saveStoredPreferences(prefs: Partial<AppPreferences>) {
  try {
    const current = loadStoredPreferences();
    const updated = { ...current, ...prefs };
    fs.writeFileSync(getPreferencesFilePath(), JSON.stringify(updated, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save preferences:', err);
  }
}

async function createWindow() {
  const prefs = loadStoredPreferences();
  clipboardWatchEnabled = !!prefs.clipboardWatch;
  if (prefs.tooltipSize?.width && prefs.tooltipSize?.height) tooltipSize = prefs.tooltipSize;

  mainWindow = new BrowserWindow({
    alwaysOnTop: !!prefs.alwaysOnTop,
    width: prefs.width || 600,
    height: prefs.height || 500,
    minWidth: 400,
    minHeight: 350,
    backgroundColor: prefs.theme === 'dark' ? '#0a0a0a' : '#ffffff',
    title: 'Window auto Update',
    // Plain window: no OS title bar or menu; the app header is the drag area (see CompanionApp)
    frame: false,
    autoHideMenuBar: true,
    // No taskbar button; the window is reached with the global shortcuts (Ctrl+Space then H)
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  // Ask the OS to exclude this companion window from supported screen-capture paths.
  // The window remains visible and interactive locally. Capture behavior still depends on
  // the operating system and the meeting app's capture pipeline.
  mainWindow.setContentProtection(true);

  // Allow microphone access for the built-in browser speech-recognition voice input.
  // Only the local app window is granted media permission; other permission types remain denied.
  mainWindow.webContents.session.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media');
  });

  mainWindow.removeMenu();

  // Track window size and position changes
  mainWindow.on('resize', () => {
    if (!mainWindow) return;
    // Resizing the paused tooltip sets the tooltip size; it is never saved as the normal window size
    if (followCursorEnabled) {
      if (followPaused) {
        const [w, h] = mainWindow.getSize();
        tooltipSize = { width: w, height: h };
        saveStoredPreferences({ tooltipSize });
      }
      return;
    }
    const [width, height] = mainWindow.getSize();
    saveStoredPreferences({ width, height });
  });

  // Open external links in default browser, not in the companion window
  mainWindow.webContents.setWindowOpenHandler(({ url }: { url: string }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Load Companion React UI
  // In development prefer the Vite dev server; fall back to the built UI in dist/ when it is not
  // running (e.g. on a machine that only runs the desktop companion).
  const loadBuiltUI = () =>
    mainWindow!.loadFile(path.join(PROJECT_ROOT, 'dist', 'index.html'), {
      query: { mode: 'companion' },
    });

  const isDev = !app.isPackaged;
  if (isDev) {
    try {
      await mainWindow.loadURL('http://localhost:3000/?mode=companion');
    } catch {
      console.log('Dev server not reachable on localhost:3000, loading built UI from dist/');
      await loadBuiltUI();
    }
    // DevTools are opt-in: set COMPANION_DEVTOOLS=1 to open them on launch
    if (process.env.COMPANION_DEVTOOLS === '1') {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
  } else {
    await loadBuiltUI();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function setupIPC() {
  ipcMain.handle(IPC_CHANNELS.GET_CONNECTION_STATUS, (): ConnectionStatusPayload => {
    return buildConnectionStatus(wsServer ? wsServer.isSenderConnected() : false);
  });

  ipcMain.handle(IPC_CHANNELS.CLEAR_TEXT, () => {
    // Notify window that text is cleared
    if (mainWindow) {
      mainWindow.webContents.send(IPC_CHANNELS.ON_TEXT_UPDATE, {
        text: '',
        timestamp: Date.now(),
      });
      mainWindow.webContents.send(IPC_CHANNELS.ON_IMAGES_UPDATE, { images: [] });
    }
  });

  ipcMain.handle(IPC_CHANNELS.COPY_TEXT, async (_event: Electron.IpcMainInvokeEvent, text: string) => {
    try {
      // Our own Copy button should not be picked up by the clipboard watcher as a reply
      lastClipboardText = text || '';
      await clipboard.writeText(text || '');
      return true;
    } catch (err) {
      console.error('Failed to copy text to clipboard:', err);
      return false;
    }
  });

  ipcMain.handle(IPC_CHANNELS.GET_SESSION_TOKEN, () => {
    return wsServer ? wsServer.getSessionToken() : '';
  });

  ipcMain.handle(IPC_CHANNELS.REGENERATE_SESSION_TOKEN, () => {
    if (!wsServer) return '';
    const token = wsServer.regenerateSessionToken();
    saveSessionToken(token);
    return token;
  });

  // Custom token: only lowercase hex, 8-64 chars so it stays valid for the persisted-token file format
  ipcMain.handle(IPC_CHANNELS.SET_SESSION_TOKEN, (_event: Electron.IpcMainInvokeEvent, customToken: string) => {
    if (!wsServer) return { ok: false, token: '', error: 'Service not running' };
    const normalized = typeof customToken === 'string' ? customToken.trim().toLowerCase() : '';
    if (!/^[0-9a-f]{8,64}$/.test(normalized)) {
      return { ok: false, token: wsServer.getSessionToken(), error: 'Token must be 8-64 hex characters (0-9, a-f)' };
    }
    const token = wsServer.setSessionToken(normalized);
    saveSessionToken(token);
    return { ok: true, token };
  });

  ipcMain.handle(IPC_CHANNELS.SAVE_PREFERENCES, (_event: Electron.IpcMainInvokeEvent, prefs: Partial<AppPreferences>) => {
    saveStoredPreferences(prefs);
    // Pin button in the companion window: keep it above other windows (it stays in the taskbar)
    if (typeof prefs.alwaysOnTop === 'boolean' && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setAlwaysOnTop(prefs.alwaysOnTop);
    }
  });

  // Reply box in the companion window: text is shown on the connected web sender page
  ipcMain.handle(IPC_CHANNELS.SEND_REPLY, (_event: Electron.IpcMainInvokeEvent, text: string, source?: string) => {
    const safeSource = source === 'clipboard' || source === 'send' ? source : 'typing';
    return wsServer ? wsServer.sendReply(typeof text === 'string' ? text : '', safeSource) : false;
  });

  ipcMain.handle(IPC_CHANNELS.LOAD_PREFERENCES, () => {
    return loadStoredPreferences();
  });

  ipcMain.handle(IPC_CHANNELS.SET_CLIPBOARD_WATCH, (_event: Electron.IpcMainInvokeEvent, enabled: boolean) =>
    setClipboardWatch(!!enabled)
  );

  ipcMain.handle(IPC_CHANNELS.GET_CLIPBOARD_WATCH, () => clipboardWatchEnabled);

  ipcMain.handle(IPC_CHANNELS.SEND_SCREENSHOT, () => captureAndSendScreenshot());

  ipcMain.handle(IPC_CHANNELS.SET_FOLLOW_CURSOR, (_event: Electron.IpcMainInvokeEvent, enabled: boolean) =>
    setFollowCursor(!!enabled)
  );

  // Window Controls
  ipcMain.on(IPC_CHANNELS.WINDOW_MINIMIZE, () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.minimize();
    }
  });

  ipcMain.on(IPC_CHANNELS.WINDOW_MAXIMIZE, () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
      } else {
        mainWindow.maximize();
      }
    }
  });

  ipcMain.on(IPC_CHANNELS.WINDOW_CLOSE, () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.close();
    }
  });

  // Manual window dragging (CSS drag regions are unreliable after click-through was toggled):
  // while the mouse button is held, keep the window at the same offset from the pointer
  let dragTimer: NodeJS.Timeout | null = null;
  const stopDrag = () => {
    if (dragTimer) clearInterval(dragTimer);
    dragTimer = null;
  };
  ipcMain.on(IPC_CHANNELS.WINDOW_DRAG_START, () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    stopDrag();
    const start = screen.getCursorScreenPoint();
    const bounds = mainWindow.getBounds();
    dragTimer = setInterval(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return stopDrag();
      const now = screen.getCursorScreenPoint();
      // Fixed width/height: setPosition alone grows the window on scaled displays
      mainWindow.setBounds({
        x: bounds.x + now.x - start.x,
        y: bounds.y + now.y - start.y,
        width: bounds.width,
        height: bounds.height,
      });
    }, 16);
  });
  ipcMain.on(IPC_CHANNELS.WINDOW_DRAG_END, stopDrag);

  ipcMain.on(IPC_CHANNELS.WINDOW_TOGGLE_VISIBILITY, () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isVisible()) mainWindow.hide();
    else {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// Longest side of a sent screenshot; keeps a 4K capture to roughly 1 MB of JPEG
const MAX_SCREENSHOT_SIDE = 2560;
let capturing = false;

// Capture the display under the mouse and send it to the web page as a reply image.
// The companion window has content protection, so it is left out of the capture.
async function captureAndSendScreenshot(): Promise<{ ok: boolean; error?: string }> {
  if (capturing) return { ok: false, error: 'Capture already in progress' };
  capturing = true;
  let result: { ok: boolean; error?: string };
  try {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const width = Math.round(display.size.width * display.scaleFactor);
    const height = Math.round(display.size.height * display.scaleFactor);
    const scale = Math.min(1, MAX_SCREENSHOT_SIDE / Math.max(width, height));

    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: Math.round(width * scale), height: Math.round(height * scale) },
    });
    const source = sources.find((s) => s.display_id === String(display.id)) || sources[0];
    if (!source || source.thumbnail.isEmpty()) throw new Error('No screen available to capture');

    const image = `data:image/jpeg;base64,${source.thumbnail.toJPEG(85).toString('base64')}`;
    const delivered = wsServer ? wsServer.sendReplyImage(image) : false;
    // Saved even when no page is connected: it is delivered when one connects
    result = delivered ? { ok: true } : { ok: true, error: 'No web page connected — sent when it connects' };
  } catch (err: any) {
    console.error('Screenshot failed:', err);
    result = { ok: false, error: err?.message || 'Screenshot failed' };
  } finally {
    capturing = false;
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC_CHANNELS.ON_SCREENSHOT_SENT, result);
  }
  return result;
}

// Follow-cursor mode: the window sits just beside the mouse pointer so the eyes need not travel
const FOLLOW_OFFSET = 14;
// Tooltip-sized window while following; the normal size is restored afterwards
// Default tooltip size; resizing it while paused changes this (and it is remembered)
let tooltipSize = { width: 420, height: 150 };
// Paused: the tooltip stays put and takes the mouse, so it can be scrolled with the wheel
let followPaused = false;
let normalSize: [number, number] | null = null;
let followCursorEnabled = false;
let followTimer: NodeJS.Timeout | null = null;
let lastCursor = { x: -1, y: -1 };

function followCursorTick() {
  if (followPaused || !mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) return;
  const cursor = screen.getCursorScreenPoint();
  if (cursor.x === lastCursor.x && cursor.y === lastCursor.y) return;
  lastCursor = cursor;

  const area = screen.getDisplayNearestPoint(cursor).workArea;
  const { width, height } = tooltipSize;
  // Above and to the right of the pointer, like a tooltip, so the line being typed stays visible.
  // Flip below / to the left when it would run off the screen.
  let x = cursor.x + FOLLOW_OFFSET;
  let y = cursor.y - FOLLOW_OFFSET - height;
  if (x + width > area.x + area.width) x = cursor.x - FOLLOW_OFFSET - width;
  if (y < area.y) y = cursor.y + FOLLOW_OFFSET + 10;
  x = Math.max(area.x, Math.min(x, area.x + area.width - width));
  y = Math.max(area.y, Math.min(y, area.y + area.height - height));
  // setBounds with a fixed size: repeated setPosition grows the window on scaled Windows displays
  mainWindow.setBounds({ x: Math.round(x), y: Math.round(y), width, height });
}

// Tooltip mode: small, always on top, and click-through so it never gets in the way
function applyTooltipWindow(enabled: boolean) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (enabled) {
    // A maximized or full-screen window ignores setSize and would cover the whole screen
    if (mainWindow.isFullScreen()) mainWindow.setFullScreen(false);
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    if (!normalSize) normalSize = mainWindow.getSize() as [number, number];
    mainWindow.setMinimumSize(160, 50);
    mainWindow.setSize(tooltipSize.width, tooltipSize.height);
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
    mainWindow.setIgnoreMouseEvents(true);
    mainWindow.setOpacity(0.92);
  } else {
    mainWindow.setOpacity(1);
    mainWindow.setIgnoreMouseEvents(false);
    mainWindow.setAlwaysOnTop(!!loadStoredPreferences().alwaysOnTop);
    mainWindow.setMinimumSize(400, 350);
    if (normalSize) mainWindow.setSize(normalSize[0], normalSize[1]);
    normalSize = null;
  }
}

function toggleFollowPause() {
  if (!followCursorEnabled || !mainWindow || mainWindow.isDestroyed()) return;
  followPaused = !followPaused;
  mainWindow.setIgnoreMouseEvents(!followPaused);
  if (followPaused) {
    // Take focus right away so the wheel, text selection and typing work without an extra click
    mainWindow.focus();
  } else {
    mainWindow.blur();
  }
  lastCursor = { x: -1, y: -1 };
  mainWindow.webContents.send(IPC_CHANNELS.ON_FOLLOW_PAUSE_CHANGE, followPaused);
}

function setFollowCursor(enabled: boolean): boolean {
  followCursorEnabled = enabled;
  if (followPaused && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC_CHANNELS.ON_FOLLOW_PAUSE_CHANGE, false);
  }
  followPaused = false;
  applyTooltipWindow(enabled);
  saveStoredPreferences({ followCursor: enabled });
  if (followTimer) clearInterval(followTimer);
  followTimer = null;
  // Ctrl/Cmd+Alt+Up/Down scroll the tooltip (it is click-through, so the mouse wheel can't)
  globalShortcut.unregister('CommandOrControl+Alt+Up');
  globalShortcut.unregister('CommandOrControl+Alt+Down');
  if (enabled) {
    lastCursor = { x: -1, y: -1 };
    followTimer = setInterval(followCursorTick, 30);
    const scroll = (delta: number) => mainWindow?.webContents.send(IPC_CHANNELS.ON_TOOLTIP_SCROLL, delta);
    globalShortcut.register('CommandOrControl+Alt+Up', () => scroll(-40));
    globalShortcut.register('CommandOrControl+Alt+Down', () => scroll(40));
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC_CHANNELS.ON_FOLLOW_CURSOR_CHANGE, enabled);
    // Start paused: the tooltip stays put and is usable; Ctrl+Space then P starts following
    if (enabled) {
      followPaused = true;
      mainWindow.setIgnoreMouseEvents(false);
      mainWindow.webContents.send(IPC_CHANNELS.ON_FOLLOW_PAUSE_CHANGE, true);
    }
  }
  return enabled;
}

// Clipboard auto-send on/off, shared by the title-bar button and the global shortcut
async function setClipboardWatch(enabled: boolean): Promise<boolean> {
  // Only react to copies made after watching is turned on, not whatever was already copied
  lastClipboardText = enabled ? await clipboard.readText().catch(() => '') : '';
  clipboardWatchEnabled = enabled;
  saveStoredPreferences({ clipboardWatch: enabled });
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC_CHANNELS.ON_CLIPBOARD_WATCH_CHANGE, enabled);
  }
  return enabled;
}

async function startClipboardWatcher() {
  if (clipboardPollTimer) clearInterval(clipboardPollTimer);
  // Ignore whatever was on the clipboard before the app started
  lastClipboardText = await clipboard.readText().catch(() => '');

  // clipboard.readText() is async in current Electron; skip ticks while a read is still pending
  let reading = false;
  clipboardPollTimer = setInterval(async () => {
    if (reading || !clipboardWatchEnabled || !mainWindow || mainWindow.isDestroyed()) return;

    reading = true;
    try {
      const current = await clipboard.readText();
      if (!current || current === lastClipboardText || !mainWindow || mainWindow.isDestroyed()) return;
      lastClipboardText = current;

      // Copied text goes straight to the web page; the companion window only shows a notice
      const delivered = current.trim() ? !!wsServer?.sendCopiedText(current) : false;
      mainWindow.webContents.send(IPC_CHANNELS.ON_CLIPBOARD_TEXT, {
        text: current,
        delivered,
        timestamp: Date.now(),
      });
    } catch (err) {
      console.warn('Clipboard watcher failed:', err);
    } finally {
      reading = false;
    }
  }, 500);
}

function registerGlobalShortcuts() {
  // No taskbar button (skipTaskbar), so this is the only way back once the window is hidden
  // or buried behind something else. isVisible() alone can't tell "buried" from "on top" —
  // it stays true either way — so we also check isFocused() before deciding to hide vs raise.
  const toggleWindow = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
      mainWindow.focus();
    } else if (mainWindow.isVisible() && mainWindow.isFocused()) {
      mainWindow.hide();
    } else {
      // Hidden, or visible but buried behind other windows: bring it to the front
      mainWindow.show();
      mainWindow.moveTop();
      mainWindow.focus();
    }
  };

  // Ctrl/Cmd+Shift+Space toggles the protected companion window.
  globalShortcut.register('CommandOrControl+Shift+Space', toggleWindow);

  // Ctrl/Cmd+Shift+H is an emergency hide shortcut.
  globalShortcut.register('CommandOrControl+Shift+H', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
  });

  // Ctrl/Cmd+Alt+C toggles clipboard auto-send: while on, every copy is sent as the reply
  if (!globalShortcut.register('CommandOrControl+Alt+C', () => setClipboardWatch(!clipboardWatchEnabled))) {
    console.warn('Could not register Ctrl/Cmd+Alt+C (already used by another app)');
  }

  // Ctrl/Cmd+Alt+S captures the screen under the mouse and sends it to the web page
  if (!globalShortcut.register('CommandOrControl+Alt+S', () => captureAndSendScreenshot())) {
    console.warn('Could not register Ctrl/Cmd+Alt+S (already used by another app)');
  }

  // Leader key: Ctrl/Cmd+Space, then a letter within 1.5 s.
  // The letters are only captured during that window so normal typing is unaffected.
  const leaderActions: Record<string, () => void> = {
    F: () => setFollowCursor(!followCursorEnabled),
    S: () => captureAndSendScreenshot(),
    C: () => setClipboardWatch(!clipboardWatchEnabled),
    H: toggleWindow,
    P: toggleFollowPause,
    // Quit needs K twice: Ctrl+Space is also editor autocomplete, and a stray "k" must not close the app
    K: () => {
      endLeader();
      globalShortcut.register('K', () => app.quit());
      leaderTimer = setTimeout(endLeader, 1500);
    },
  };
  let leaderTimer: NodeJS.Timeout | null = null;
  const endLeader = () => {
    if (leaderTimer) clearTimeout(leaderTimer);
    leaderTimer = null;
    for (const key of Object.keys(leaderActions)) globalShortcut.unregister(key);
  };
  const registerLeader = globalShortcut.register('CommandOrControl+Space', () => {
    endLeader();
    for (const [key, action] of Object.entries(leaderActions)) {
      globalShortcut.register(key, () => {
        endLeader();
        action();
      });
    }
    leaderTimer = setTimeout(endLeader, 1500);
  });
  if (!registerLeader) console.warn('Could not register Ctrl/Cmd+Space (already used by another app)');

  // Ctrl/Cmd+Alt+F toggles follow-cursor mode (the window cannot be clicked while it follows)
  if (!globalShortcut.register('CommandOrControl+Alt+F', () => setFollowCursor(!followCursorEnabled))) {
    console.warn('Could not register Ctrl/Cmd+Alt+F (already used by another app)');
  }
}

async function init() {
  app.setName('Window auto Update');
  // Start the companion WebSocket service (0.0.0.0:8765 by default so another machine can send text)
  wsServer = new LocalCompanionWebSocketServer({
    port: WS_PORT,
    host: WS_HOST,
    sessionToken: loadOrCreateSessionToken(),
    tls: await loadOrCreateTlsCert(),
    onTextReceived: (text, metadata) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC_CHANNELS.ON_TEXT_UPDATE, {
          text,
          timestamp: metadata.timestamp,
        });
      }
    },
    onImagesReceived: (images) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC_CHANNELS.ON_IMAGES_UPDATE, { images });
      }
    },
    onSenderStatusChange: (connected) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC_CHANNELS.ON_CONNECTION_CHANGE, buildConnectionStatus(connected));
      }
    },
    onError: (err) => {
      console.error('WebSocket server error:', err.message);
    },
  });

  try {
    await wsServer.start();
  } catch (err: any) {
    console.error(`Unable to start local communication service. Port ${WS_PORT} may already be in use.`, err);
  }

  setupIPC();
  await createWindow();
  registerGlobalShortcuts();
  await startClipboardWatcher();
  if (loadStoredPreferences().followCursor) setFollowCursor(true);
}

// Log file (the packaged app has no console): %APPDATA%/<app>/companion.log
// Records errors and why the app or its window went away, to diagnose unexpected closes.
function logToFile(...parts: unknown[]) {
  try {
    const line = `[${new Date().toISOString()}] ${parts.map((p) => (p instanceof Error ? p.stack : String(p))).join(' ')}\n`;
    fs.appendFileSync(path.join(app.getPath('userData'), 'companion.log'), line);
  } catch {}
}
for (const level of ['log', 'warn', 'error'] as const) {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    original(...args);
    logToFile(level.toUpperCase(), ...args);
  };
}
process.on('uncaughtException', (err) => logToFile('UNCAUGHT', err));
process.on('unhandledRejection', (err) => logToFile('UNHANDLED REJECTION', err));
app.on('render-process-gone', (_e, _wc, details) => logToFile('RENDERER GONE', JSON.stringify(details)));
app.on('child-process-gone', (_e, details) => logToFile('CHILD PROCESS GONE', JSON.stringify(details)));
app.on('before-quit', () => logToFile('QUIT requested'));
app.on('window-all-closed', () => logToFile('All windows closed'));

// Only one copy may run: a second copy cannot get the port or the global shortcuts,
// so it would look broken. Launching again just brings the running window forward.
if (!app.requestSingleInstanceLock()) {
  console.log('Desktop Companion is already running; close it (Ctrl+Space then K) before starting it again.');
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (followCursorEnabled) setFollowCursor(false);
    mainWindow.show();
    mainWindow.focus();
  });
  app.whenReady().then(init);
}

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (followTimer) clearInterval(followTimer);
  if (clipboardPollTimer) {
    clearInterval(clipboardPollTimer);
    clipboardPollTimer = null;
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('will-quit', async () => {
  if (wsServer) {
    await wsServer.stop();
  }
});
