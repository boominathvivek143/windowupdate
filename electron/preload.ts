import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import { IPC_CHANNELS, AppPreferences, ConnectionStatusPayload } from './ipc.js';
import type { CompanionIPCBridge, ConnectionState } from '../src/types/companion';

const companionAPI: CompanionIPCBridge = {
  getConnectionStatus: async () => {
    const res: ConnectionStatusPayload = await ipcRenderer.invoke(IPC_CHANNELS.GET_CONNECTION_STATUS);
    return {
      connected: res.connected,
      statusText: res.statusText as ConnectionState,
      port: res.port,
      sessionToken: res.sessionToken,
      addresses: res.addresses || [],
    };
  },
  clearText: () => ipcRenderer.invoke(IPC_CHANNELS.CLEAR_TEXT),
  copyText: (text: string) => ipcRenderer.invoke(IPC_CHANNELS.COPY_TEXT, text),
  sendReply: (text: string, source?: 'typing' | 'clipboard' | 'send') =>
    ipcRenderer.invoke(IPC_CHANNELS.SEND_REPLY, text, source),
  getSessionToken: () => ipcRenderer.invoke(IPC_CHANNELS.GET_SESSION_TOKEN),
  regenerateSessionToken: () => ipcRenderer.invoke(IPC_CHANNELS.REGENERATE_SESSION_TOKEN),
  setSessionToken: (token: string) => ipcRenderer.invoke(IPC_CHANNELS.SET_SESSION_TOKEN, token),
  savePreferences: (prefs) => ipcRenderer.invoke(IPC_CHANNELS.SAVE_PREFERENCES, prefs),
  loadPreferences: () => ipcRenderer.invoke(IPC_CHANNELS.LOAD_PREFERENCES),

  minimize: () => ipcRenderer.send(IPC_CHANNELS.WINDOW_MINIMIZE),
  maximize: () => ipcRenderer.send(IPC_CHANNELS.WINDOW_MAXIMIZE),
  close: () => ipcRenderer.send(IPC_CHANNELS.WINDOW_CLOSE),
  toggleVisibility: () => ipcRenderer.send(IPC_CHANNELS.WINDOW_TOGGLE_VISIBILITY),
  startWindowDrag: () => ipcRenderer.send(IPC_CHANNELS.WINDOW_DRAG_START),
  endWindowDrag: () => ipcRenderer.send(IPC_CHANNELS.WINDOW_DRAG_END),
  setClipboardWatch: (enabled: boolean) => ipcRenderer.invoke(IPC_CHANNELS.SET_CLIPBOARD_WATCH, enabled),
  getClipboardWatch: () => ipcRenderer.invoke(IPC_CHANNELS.GET_CLIPBOARD_WATCH),
  sendScreenshot: () => ipcRenderer.invoke(IPC_CHANNELS.SEND_SCREENSHOT),
  setFollowCursor: (enabled: boolean) => ipcRenderer.invoke(IPC_CHANNELS.SET_FOLLOW_CURSOR, enabled),

  onFollowPauseChange: (callback) => {
    const subscription = (_event: IpcRendererEvent, paused: boolean) => callback(paused);
    ipcRenderer.on(IPC_CHANNELS.ON_FOLLOW_PAUSE_CHANGE, subscription);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.ON_FOLLOW_PAUSE_CHANGE, subscription);
    };
  },

  onTooltipScroll: (callback) => {
    const subscription = (_event: IpcRendererEvent, delta: number) => callback(delta);
    ipcRenderer.on(IPC_CHANNELS.ON_TOOLTIP_SCROLL, subscription);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.ON_TOOLTIP_SCROLL, subscription);
    };
  },

  onFollowCursorChange: (callback) => {
    const subscription = (_event: IpcRendererEvent, enabled: boolean) => callback(enabled);
    ipcRenderer.on(IPC_CHANNELS.ON_FOLLOW_CURSOR_CHANGE, subscription);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.ON_FOLLOW_CURSOR_CHANGE, subscription);
    };
  },

  onScreenshotSent: (callback) => {
    const subscription = (_event: IpcRendererEvent, result: { ok: boolean; error?: string }) => callback(result);
    ipcRenderer.on(IPC_CHANNELS.ON_SCREENSHOT_SENT, subscription);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.ON_SCREENSHOT_SENT, subscription);
    };
  },

  onTextUpdate: (callback) => {
    const subscription = (_event: IpcRendererEvent, data: { text: string; timestamp: number }) => callback(data);
    ipcRenderer.on(IPC_CHANNELS.ON_TEXT_UPDATE, subscription);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.ON_TEXT_UPDATE, subscription);
    };
  },

  onClipboardText: (callback) => {
    const subscription = (_event: IpcRendererEvent, data: { text: string; timestamp: number; delivered?: boolean }) =>
      callback(data);
    ipcRenderer.on(IPC_CHANNELS.ON_CLIPBOARD_TEXT, subscription);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.ON_CLIPBOARD_TEXT, subscription);
    };
  },

  onClipboardWatchChange: (callback) => {
    const subscription = (_event: IpcRendererEvent, enabled: boolean) => callback(enabled);
    ipcRenderer.on(IPC_CHANNELS.ON_CLIPBOARD_WATCH_CHANGE, subscription);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.ON_CLIPBOARD_WATCH_CHANGE, subscription);
    };
  },

  onImagesUpdate: (callback) => {
    const subscription = (_event: IpcRendererEvent, data: { images: string[] }) => callback(data);
    ipcRenderer.on(IPC_CHANNELS.ON_IMAGES_UPDATE, subscription);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.ON_IMAGES_UPDATE, subscription);
    };
  },

  onConnectionChange: (callback) => {
    const subscription = (_event: IpcRendererEvent, status: ConnectionStatusPayload) => {
      callback({
        connected: status.connected,
        statusText: status.statusText as ConnectionState,
        port: status.port,
        sessionToken: status.sessionToken,
        addresses: status.addresses || [],
      });
    };
    ipcRenderer.on(IPC_CHANNELS.ON_CONNECTION_CHANGE, subscription);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.ON_CONNECTION_CHANGE, subscription);
    };
  },
};

contextBridge.exposeInMainWorld('companion', companionAPI);
