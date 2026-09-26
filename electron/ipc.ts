export const IPC_CHANNELS = {
  // Main -> Renderer events
  ON_TEXT_UPDATE: 'companion:on-text-update',
  ON_IMAGES_UPDATE: 'companion:on-images-update',
  ON_CONNECTION_CHANGE: 'companion:on-connection-change',
  ON_SETTINGS_CHANGE: 'companion:on-settings-change',
  ON_CLIPBOARD_TEXT: 'companion:on-clipboard-text',
  ON_CLIPBOARD_WATCH_CHANGE: 'companion:on-clipboard-watch-change',
  ON_SCREENSHOT_SENT: 'companion:on-screenshot-sent',
  ON_FOLLOW_CURSOR_CHANGE: 'companion:on-follow-cursor-change',
  SET_FOLLOW_CURSOR: 'companion:set-follow-cursor',
  ON_TOOLTIP_SCROLL: 'companion:on-tooltip-scroll',
  ON_FOLLOW_PAUSE_CHANGE: 'companion:on-follow-pause-change',
  ON_TOGGLE_SPEAKER_LISTENING: 'companion:on-toggle-speaker-listening',

  // Renderer -> Main invokes
  GET_CONNECTION_STATUS: 'companion:get-connection-status',
  CLEAR_TEXT: 'companion:clear-text',
  COPY_TEXT: 'companion:copy-text',
  SEND_REPLY: 'companion:send-reply',
  GET_SESSION_TOKEN: 'companion:get-session-token',
  REGENERATE_SESSION_TOKEN: 'companion:regenerate-session-token',
  SET_SESSION_TOKEN: 'companion:set-session-token',
  SAVE_PREFERENCES: 'companion:save-preferences',
  LOAD_PREFERENCES: 'companion:load-preferences',
  SET_CLIPBOARD_WATCH: 'companion:set-clipboard-watch',
  GET_CLIPBOARD_WATCH: 'companion:get-clipboard-watch',
  SEND_SCREENSHOT: 'companion:send-screenshot',

  // Window Controls
  WINDOW_DRAG_START: 'companion:window-drag-start',
  WINDOW_DRAG_END: 'companion:window-drag-end',
  WINDOW_MINIMIZE: 'companion:window-minimize',
  WINDOW_MAXIMIZE: 'companion:window-maximize',
  WINDOW_CLOSE: 'companion:window-close',
  WINDOW_TOGGLE_VISIBILITY: 'companion:window-toggle-visibility',
} as const;

export interface AppPreferences {
  width: number;
  height: number;
  fontSize: number;
  theme: 'light' | 'dark';
  autoScroll?: boolean;
  alwaysOnTop?: boolean;
  clipboardWatch?: boolean;
  followCursor?: boolean;
  tooltipSize?: { width: number; height: number };
  webAppUrl?: string;
}

export interface ConnectionStatusPayload {
  connected: boolean;
  statusText: 'Connected' | 'Disconnected' | 'Connecting...';
  port: number;
  sessionToken: string;
  // host:port addresses other machines on the network can use to reach this companion
  addresses: string[];
}
