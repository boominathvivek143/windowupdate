export type ConnectionState = 'Connected' | 'Disconnected' | 'Connecting...';

export interface AppPreferences {
  width: number;
  height: number;
  fontSize: number; // 12px to 32px
  theme: 'light' | 'dark';
  autoScroll: boolean;
  alwaysOnTop?: boolean;
  clipboardWatch?: boolean;
  followCursor?: boolean;
}

export interface WsMessagePayload {
  type:
    | 'TEXT_UPDATE'
    | 'PING'
    | 'PONG'
    | 'AUTH'
    | 'AUTH_SUCCESS'
    | 'AUTH_FAILED'
    | 'ACK'
    | 'SENDER_ASSIGNED'
    | 'WARNING_MULTIPLE_SENDERS'
    | 'CLAIM_ACTIVE_SENDER'
    | 'SENDER_STATUS'
    | 'TOKEN_REFRESHED'
    | 'ERROR';
  text?: string;
  token?: string;
  timestamp?: number;
  charCount?: number;
  isActive?: boolean;
  connected?: boolean;
  senderId?: string | null;
  message?: string;
  code?: string;
}

export interface CompanionIPCBridge {
  getConnectionStatus: () => Promise<{
    connected: boolean;
    statusText: ConnectionState;
    port: number;
    sessionToken: string;
    addresses: string[];
  }>;
  clearText: () => Promise<void>;
  copyText: (text: string) => Promise<boolean>;
  // source tells the web page whether to ask Gemini (clipboard / send) or not (typing)
  sendReply: (text: string, source?: 'typing' | 'clipboard' | 'send') => Promise<boolean>;
  getSessionToken: () => Promise<string>;
  regenerateSessionToken: () => Promise<string>;
  setSessionToken: (token: string) => Promise<{ ok: boolean; token: string; error?: string }>;
  savePreferences: (prefs: Partial<AppPreferences>) => Promise<void>;
  loadPreferences: () => Promise<AppPreferences>;
  minimize: () => void;
  maximize: () => void;
  close: () => void;
  toggleVisibility: () => void;
  // Move the window with the mouse while the button is held (drag handles)
  startWindowDrag: () => void;
  endWindowDrag: () => void;
  setClipboardWatch: (enabled: boolean) => Promise<boolean>;
  getClipboardWatch: () => Promise<boolean>;
  // Capture the screen under the mouse and send it to the web page (also Ctrl+Alt+S)
  sendScreenshot: () => Promise<{ ok: boolean; error?: string }>;
  // Window stays next to the mouse pointer (also Ctrl+Alt+F)
  setFollowCursor: (enabled: boolean) => Promise<boolean>;
  onFollowCursorChange: (callback: (enabled: boolean) => void) => () => void;
  // Ctrl+Alt+Up/Down while following: scroll the tooltip by this many pixels
  onTooltipScroll: (callback: (delta: number) => void) => () => void;
  // Tooltip paused (Ctrl+Space then P): it stays put and can be moved, resized, scrolled and typed in
  onFollowPauseChange: (callback: (paused: boolean) => void) => () => void;
  onScreenshotSent: (callback: (result: { ok: boolean; error?: string }) => void) => () => void;
  onTextUpdate: (callback: (data: { text: string; timestamp: number }) => void) => () => void;
  // delivered: whether a connected web page received it
  onClipboardText: (callback: (data: { text: string; timestamp: number; delivered?: boolean }) => void) => () => void;
  // Fired when auto-send is toggled from the global shortcut
  onClipboardWatchChange: (callback: (enabled: boolean) => void) => () => void;
  onImagesUpdate: (callback: (data: { images: string[] }) => void) => () => void;
  onConnectionChange: (
    callback: (status: {
      connected: boolean;
      statusText: ConnectionState;
      port: number;
      sessionToken: string;
      addresses: string[];
    }) => void
  ) => () => void;
}

declare global {
  interface Window {
    companion?: CompanionIPCBridge;
  }
}
