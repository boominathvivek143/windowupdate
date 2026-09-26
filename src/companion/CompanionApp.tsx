import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ConnectionState, AppPreferences } from '../types/companion';
import { ConnectionStatus } from '../components/ConnectionStatus';
import { TextViewer } from '../components/TextViewer';
import { SecurityModal } from '../components/SecurityModal';
import { Pin, PinOff, Clipboard, ShieldCheck, Send, Camera, MousePointer2, Maximize2, Trash2, Sun, Moon } from 'lucide-react';
import { VoiceInputButton, SpeakButton } from '../components/VoiceControls';

// Companion window UI, rendered inside Electron (receives text and images over IPC)
export const CompanionApp: React.FC = () => {
  const [text, setText] = useState<string>('');
  const [connectionStatus, setConnectionStatus] = useState<ConnectionState>('Connecting...');
  const [senderActive, setSenderActive] = useState<boolean>(false);
  const [sessionToken, setSessionToken] = useState<string>('');
  const [isSecurityModalOpen, setIsSecurityModalOpen] = useState<boolean>(false);
  const [port, setPort] = useState<number>(8765);
  const [addresses, setAddresses] = useState<string[]>([]);
  const [clipboardWatch, setClipboardWatch] = useState<boolean>(false);
  const [clipboardNotice, setClipboardNotice] = useState<boolean>(false);
  // Last thing shared with the web page: yellow block for copied text, green for a screenshot
  const [activity, setActivity] = useState<{ kind: 'copy' | 'screenshot'; text: string; ok: boolean; note?: string } | null>(
    null
  );
  const [followCursor, setFollowCursor] = useState<boolean>(false);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [followPaused, setFollowPaused] = useState<boolean>(false);
  // Brief icon on the drag bar itself when something is shared while following (yellow=copy, green=screenshot)
  const [barIconState, setBarIconState] = useState<'copy' | 'screenshot' | null>(null);
  const barIconTimerRef = useRef<any>(null);
  const setBarIcon = (kind: 'copy' | 'screenshot') => {
    setBarIconState(kind);
    if (barIconTimerRef.current) clearTimeout(barIconTimerRef.current);
    barIconTimerRef.current = setTimeout(() => setBarIconState(null), 2000);
  };
  const [screenshotNotice, setScreenshotNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const screenshotNoticeTimerRef = useRef<any>(null);
  const replyInputRef = useRef<HTMLTextAreaElement>(null);
  const [images, setImages] = useState<string[]>([]);
  // Reply box: text shown on the connected web sender page
  const [reply, setReply] = useState<string>('');
  const replyTimerRef = useRef<any>(null);

  // Persistent preferences (theme, fontSize, autoScroll) - NEVER persists text per spec #13 & #15
  const [preferences, setPreferences] = useState<AppPreferences>(() => {
    try {
      const saved = localStorage.getItem('companion_preferences');
      if (saved) {
        return {
          width: 600,
          height: 500,
          fontSize: 16,
          theme: 'dark',
          autoScroll: true,
          ...JSON.parse(saved),
        };
      }
    } catch {}
    return {
      width: 600,
      height: 500,
      fontSize: 16,
      theme: 'dark',
      autoScroll: true,
    };
  });

  // Save UI preferences to localStorage & Electron IPC if available
  const updatePreferences = useCallback((newPrefs: Partial<AppPreferences>) => {
    setPreferences((prev) => {
      const updated = { ...prev, ...newPrefs };
      try {
        localStorage.setItem('companion_preferences', JSON.stringify(updated));
      } catch {}
      if (window.companion?.savePreferences) {
        window.companion.savePreferences(updated);
      }
      return updated;
    });
  }, []);

  // Receive text, images and connection status from the Electron main process
  useEffect(() => {
    if (window.companion) {
      // Load stored preferences from Electron
      window.companion.loadPreferences().then((prefs) => {
        if (prefs) {
          updatePreferences(prefs);
          setClipboardWatch(!!prefs.clipboardWatch);
          setFollowCursor(!!prefs.followCursor);
          // Follow mode always starts paused (matches the main process)
          if (prefs.followCursor) setFollowPaused(true);
        }
      });

      window.companion.getClipboardWatch().then(setClipboardWatch);

      window.companion.getSessionToken().then((token) => {
        if (token) setSessionToken(token);
      });

      // Subscribe to text updates from Electron Main Process
      const unsubscribeText = window.companion.onTextUpdate((data) => {
        setText(data.text);
      });

      const unsubscribeClipboard = window.companion.onClipboardText((data) => {
        if (!data.text.trim()) return;
        // The main process already sent it to the web page; the reply box is left for typing
        setActivity({
          kind: 'copy',
          text: data.text,
          ok: !!data.delivered,
          note: data.delivered ? undefined : 'Web page not connected — not delivered',
        });
        setBarIcon('copy');
        setClipboardNotice(true);
        window.setTimeout(() => setClipboardNotice(false), 1800);
      });

      const unsubscribeWatch = window.companion.onClipboardWatchChange(setClipboardWatch);
      const unsubscribeFollow = window.companion.onFollowCursorChange(setFollowCursor);
      const unsubscribePause = window.companion.onFollowPauseChange(setFollowPaused);
      const unsubscribeScroll = window.companion.onTooltipScroll((delta) => {
        tooltipRef.current?.scrollBy({ top: delta, behavior: 'smooth' });
      });

      // Fired for both the camera button and the Ctrl+Alt+S shortcut
      const unsubscribeScreenshot = window.companion.onScreenshotSent((result) => {
        setScreenshotNotice({
          ok: result.ok,
          text: result.error ? result.error : 'Screenshot sent',
        });
        setActivity({ kind: 'screenshot', text: 'Screenshot shared', ok: result.ok && !result.error, note: result.error });
        setBarIcon('screenshot');
        if (screenshotNoticeTimerRef.current) clearTimeout(screenshotNoticeTimerRef.current);
        screenshotNoticeTimerRef.current = setTimeout(() => setScreenshotNotice(null), 2500);
      });

      const unsubscribeImages = window.companion.onImagesUpdate((data) => {
        setImages(data.images || []);
      });

      // Subscribe to connection status
      const unsubscribeConn = window.companion.onConnectionChange((status) => {
        setConnectionStatus(status.statusText);
        setSenderActive(status.connected);
        setPort(status.port || 8765);
        setAddresses(status.addresses || []);
        if (status.sessionToken) setSessionToken(status.sessionToken);
      });

      window.companion.getConnectionStatus().then((status) => {
        setConnectionStatus(status.statusText);
        setSenderActive(status.connected);
        setPort(status.port || 8765);
        setAddresses(status.addresses || []);
      });

      return () => {
        unsubscribeText();
        unsubscribeClipboard();
        unsubscribeWatch();
        unsubscribeFollow();
        unsubscribeScroll();
        unsubscribePause();
        unsubscribeScreenshot();
        unsubscribeImages();
        unsubscribeConn();
      };
    }
  }, [updatePreferences]);

  // Action: Copy text
  const handleCopy = async () => {
    if (!text) return;
    let success = false;
    if (window.companion?.copyText) {
      success = await window.companion.copyText(text);
    } else {
      try {
        await navigator.clipboard.writeText(text);
        success = true;
      } catch (e) {
        console.error('Copy failed:', e);
      }
    }

  };

  // Action: Clear text
  const handleClear = () => {
    setText('');
    setImages([]);
    if (window.companion?.clearText) {
      window.companion.clearText();
    }
  };

  const handleRegenerateToken = async () => {
    if (window.companion?.regenerateSessionToken) {
      const newToken = await window.companion.regenerateSessionToken();
      setSessionToken(newToken);
    }
  };

  const handleSetToken = async (token: string) => {
    if (!window.companion?.setSessionToken) return { ok: false, token: sessionToken, error: 'Not available' };
    const result = await window.companion.setSessionToken(token);
    if (result.ok) setSessionToken(result.token);
    return result;
  };

  const toggleClipboardWatch = async () => {
    if (!window.companion?.setClipboardWatch) return;
    const next = await window.companion.setClipboardWatch(!clipboardWatch);
    setClipboardWatch(next);
  };

  const sendReplyNow = async () => {
    await window.companion?.sendReply(reply, 'send');
  };

  const updateReply = (value: string, immediate = false) => {
    setReply(value);
    if (replyTimerRef.current) clearTimeout(replyTimerRef.current);
    const send = () => window.companion?.sendReply(value);
    if (immediate) send();
    else replyTimerRef.current = setTimeout(send, 150);
  };

  // Drag handles: hold the left button to move the window (buttons inside still click normally)
  const dragHandlers = {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest('button, span[title], input, textarea')) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      window.companion?.startWindowDrag();
    },
    onPointerUp: () => window.companion?.endWindowDrag(),
    onLostPointerCapture: () => window.companion?.endWindowDrag(),
  };

  const charCount = text.length;
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
  const isDark = preferences.theme === 'dark';

  // Follow-cursor mode: a tooltip showing just the latest text (the window is click-through)
  // Paused tooltip: stays put; drag the top bar to move, drag the edges to resize, scroll and type
  if (followCursor && followPaused) {
    return (
      <div
        className={`h-full w-full flex flex-col overflow-hidden rounded-md border ${
          isDark ? 'bg-neutral-950 border-indigo-500/60 text-neutral-100' : 'bg-white border-indigo-400 text-neutral-900'
        }`}
        style={{ fontSize: 12 }}
      >
        <div
          {...dragHandlers}
          className="shrink-0 h-5 flex items-center justify-between px-1 bg-indigo-500/25 cursor-move"
          aria-label="Drag to move"
        >
          <span className="flex items-center" title={barIconState === 'copy' ? 'Copied text shared' : barIconState === 'screenshot' ? 'Screenshot shared' : undefined}>
            {barIconState === 'copy' && <Clipboard className="w-3 h-3 text-amber-400" />}
            {barIconState === 'screenshot' && <Camera className="w-3 h-3 text-emerald-400" />}
          </span>
          <button
            onClick={() => window.companion?.setFollowCursor(false)}
            className="p-0.5 rounded text-indigo-200 hover:text-white hover:bg-indigo-500/40 cursor-pointer"
            title="Back to full window"
            aria-label="Back to full window"
          >
            <Maximize2 className="w-3 h-3" />
          </button>
        </div>
        <div ref={tooltipRef} className="flex-1 min-h-0 overflow-y-auto px-2 py-1 select-text whitespace-pre-wrap break-words leading-tight">
          {text || reply}
        </div>
      </div>
    );
  }

  if (followCursor) {
    return (
      <div
        className={`h-full w-full flex flex-col overflow-hidden rounded-md border ${
          isDark ? 'bg-neutral-950 border-neutral-700 text-neutral-100' : 'bg-white border-neutral-300 text-neutral-900'
        }`}
        style={{ fontSize: 12 }}
      >
        <div
          className="shrink-0 h-3 flex items-center justify-center bg-indigo-500/25"
          title={barIconState === 'copy' ? 'Copied text shared' : barIconState === 'screenshot' ? 'Screenshot shared' : undefined}
        >
          {barIconState === 'copy' && <Clipboard className="w-2.5 h-2.5 text-amber-400" />}
          {barIconState === 'screenshot' && <Camera className="w-2.5 h-2.5 text-emerald-400" />}
        </div>
        <div ref={tooltipRef} className="flex-1 min-h-0 overflow-y-auto px-2 py-1">
          {text || reply ? (
            <div className="whitespace-pre-wrap break-words leading-tight">{text || reply}</div>
          ) : images.length > 0 ? (
            <img src={images[0]} alt="Latest image" className="max-h-full max-w-full rounded" draggable={false} />
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex flex-col h-full w-full select-none transition-colors duration-200 overflow-hidden ${
        isDark ? 'bg-neutral-950 text-neutral-100' : 'bg-neutral-50 text-neutral-900'
      } border border-neutral-800 rounded-lg shadow-xl`}
    >
      {/* Title Bar: single icon-only row (window controls, status, and every action) */}
      <header
        // Frameless window: dragging the header moves the window
        {...dragHandlers}
        className={`cursor-move flex items-center justify-between px-2 py-1.5 border-b select-none transition-colors overflow-x-auto ${
          isDark
            ? 'bg-neutral-900/90 border-neutral-800 text-neutral-200'
            : 'bg-neutral-100 border-neutral-200 text-neutral-800'
        }`}
      >
        {/* Left: window controls + status */}
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="flex items-center gap-1.5">
            <span
              onClick={() => window.companion?.close()}
              className="w-3 h-3 rounded-full bg-rose-500/80 hover:bg-rose-500 cursor-pointer transition-colors shadow-xs"
              title="Close window"
            />
            <span
              onClick={() => window.companion?.minimize()}
              className="w-3 h-3 rounded-full bg-amber-500/80 hover:bg-amber-500 cursor-pointer transition-colors shadow-xs"
              title="Minimize"
            />
            <span
              onClick={() => window.companion?.maximize()}
              className="w-3 h-3 rounded-full bg-emerald-500/80 hover:bg-emerald-500 cursor-pointer transition-colors shadow-xs"
              title="Maximize"
            />
          </div>

          <div className="h-3 w-px bg-neutral-700/40 mx-0.5" />

          <ConnectionStatus
            status={connectionStatus}
            senderActive={senderActive}
            theme={preferences.theme}
            compact
          />

          <span title="Electron capture protection requested; actual behavior depends on the OS and capture app">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          </span>
        </div>

        {/* Right: every action, icon-only */}
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            onClick={handleClear}
            disabled={charCount === 0}
            className={`p-1 rounded text-neutral-400 hover:text-rose-400 disabled:opacity-40 transition-colors ${isDark ? 'hover:bg-neutral-800' : 'hover:bg-neutral-200'}`}
            title="Clear text (Ctrl+L)"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={toggleClipboardWatch}
            className={`p-1 rounded transition-colors ${
              clipboardWatch ? 'text-emerald-400' : 'text-neutral-400 hover:text-white'
            } ${isDark ? 'hover:bg-neutral-800' : 'hover:bg-neutral-200'}`}
            title={`Auto-send copied text is ${clipboardWatch ? 'ON' : 'OFF'} (Ctrl+Alt+C to toggle)`}
            aria-pressed={clipboardWatch}
          >
            <Clipboard className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => window.companion?.sendScreenshot()}
            className={`p-1 rounded text-neutral-400 hover:text-white transition-colors ${
              isDark ? 'hover:bg-neutral-800' : 'hover:bg-neutral-200'
            }`}
            title="Send a screenshot to the web page (Ctrl+Alt+S)"
          >
            <Camera className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => window.companion?.setFollowCursor(!followCursor)}
            className={`p-1 rounded transition-colors ${
              followCursor ? 'text-emerald-400' : 'text-neutral-400 hover:text-white'
            } ${isDark ? 'hover:bg-neutral-800' : 'hover:bg-neutral-200'}`}
            title={`Follow cursor is ${followCursor ? 'ON' : 'OFF'} (Ctrl+Alt+F to toggle)`}
            aria-pressed={followCursor}
          >
            <MousePointer2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => updatePreferences({ alwaysOnTop: !preferences.alwaysOnTop })}
            className={`p-1 rounded transition-colors ${
              preferences.alwaysOnTop ? 'text-indigo-400' : 'text-neutral-400 hover:text-white'
            } ${isDark ? 'hover:bg-neutral-800' : 'hover:bg-neutral-200'}`}
            title={preferences.alwaysOnTop ? 'Unpin (stop keeping on top)' : 'Pin (keep above other windows)'}
            aria-pressed={!!preferences.alwaysOnTop}
          >
            {preferences.alwaysOnTop ? <Pin className="w-3.5 h-3.5" /> : <PinOff className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={() => updatePreferences({ theme: isDark ? 'light' : 'dark' })}
            className={`p-1 rounded transition-colors ${isDark ? 'hover:bg-neutral-800' : 'hover:bg-neutral-200'}`}
            title={`Switch to ${isDark ? 'light' : 'dark'} theme`}
          >
            {isDark ? <Sun className="w-3.5 h-3.5 text-amber-400" /> : <Moon className="w-3.5 h-3.5 text-neutral-700" />}
          </button>
          <button
            onClick={() => setIsSecurityModalOpen(true)}
            className={`p-1 rounded text-neutral-400 hover:text-white transition-colors ${
              isDark ? 'hover:bg-neutral-800' : 'hover:bg-neutral-200'
            }`}
            title="Session Token & Security Settings"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-indigo-400" />
          </button>
        </div>
      </header>

      {/* Pasted images from the sender */}
      {images.length > 0 && (
        <div
          className={`flex flex-col gap-3 p-4 overflow-y-auto ${text ? 'max-h-[55%] shrink-0 border-b' : 'flex-1'} ${
            isDark ? 'border-neutral-800' : 'border-neutral-200'
          }`}
        >
          {images.map((src, index) => (
            <img
              key={index}
              src={src}
              alt={`Pasted image ${index + 1}`}
              className="max-w-full h-auto rounded-md border border-neutral-800 self-start"
              draggable={false}
            />
          ))}
        </div>
      )}

      {/* Text Viewer Content Area (hidden when only images were sent, to skip the empty state) */}
      {(text || images.length === 0) && (
      <TextViewer
        text={text}
        fontSize={preferences.fontSize}
        theme={preferences.theme}
        autoScroll={preferences.autoScroll}
        onClear={handleClear}
        onCopy={handleCopy}
      />
      )}

      {/* Last shared item: yellow = copied text, green = screenshot; red note when not delivered */}
      {activity && (
        <div
          className={`shrink-0 mx-2 mt-2 flex items-start gap-2 rounded-md border px-2 py-1.5 text-xs ${
            activity.kind === 'copy' ? 'border-amber-400/40 bg-amber-400/10' : 'border-emerald-400/40 bg-emerald-400/10'
          }`}
        >
          {activity.kind === 'copy' ? (
            <Clipboard className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-400" />
          ) : (
            <Camera className="w-3.5 h-3.5 mt-0.5 shrink-0 text-emerald-400" />
          )}
          <div className="min-w-0 flex-1">
            <div className={activity.kind === 'copy' ? 'text-amber-300' : 'text-emerald-300'}>
              {activity.kind === 'copy' ? 'Copied text shared' : 'Screenshot shared'}
            </div>
            {activity.kind === 'copy' && <div className="truncate text-neutral-400">{activity.text}</div>}
            {activity.note && <div className="text-red-400">{activity.note}</div>}
          </div>
        </div>
      )}

      {/* Reply box: shown on the web sender page */}
      <div
        className={`shrink-0 border-t p-2 flex flex-col gap-1 ${
          isDark ? 'border-neutral-800 bg-neutral-900/60' : 'border-neutral-200 bg-neutral-100'
        }`}
      >
        <div className="flex items-center justify-between text-[11px] text-neutral-500 px-0.5">
          <span className="flex items-center gap-1">
            Reply — shown on the web page
            {clipboardNotice && <span className="text-emerald-400">Copied text shared</span>}
            {screenshotNotice && (
              <span className={screenshotNotice.ok ? 'text-emerald-400' : 'text-red-400'}>{screenshotNotice.text}</span>
            )}
          </span>
          <div className="flex items-center gap-1">
            <VoiceInputButton
              onTranscript={(spoken) => updateReply(reply ? `${reply} ${spoken}` : spoken, true)}
              title="Dictate reply"
            />
            <SpeakButton text={reply} title="Read reply aloud" className="p-1" />
            {reply && (
              <button onClick={() => updateReply('', true)} className="hover:text-neutral-300">
                Clear reply
              </button>
            )}
          </div>
        </div>
        <div className="relative">
          <textarea
            ref={replyInputRef}
            value={reply}
            onChange={(e) => updateReply(e.target.value)}
            placeholder="Type or paste a reply…"
            rows={3}
            className={`w-full resize-none rounded-md border px-2 py-1.5 pr-8 text-sm select-text focus:outline-none focus:border-indigo-500 ${
              isDark ? 'bg-neutral-950 border-neutral-800 text-neutral-100' : 'bg-white border-neutral-300 text-neutral-900'
            }`}
          />
          <button
            onClick={sendReplyNow}
            disabled={!reply}
            className="absolute bottom-1.5 right-1.5 p-1 rounded text-indigo-400 hover:text-indigo-300 disabled:opacity-30 transition-colors"
            title={senderActive ? 'Send reply now' : 'No web page connected — the reply is delivered when it connects'}
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Security & Token Settings Modal */}
      <SecurityModal
        isOpen={isSecurityModalOpen}
        onClose={() => setIsSecurityModalOpen(false)}
        sessionToken={sessionToken}
        onRegenerateToken={handleRegenerateToken}
        onSetToken={handleSetToken}
        theme={preferences.theme}
        port={port}
        addresses={addresses}
        webAppUrl={preferences.webAppUrl || ''}
        onUpdateWebAppUrl={(url) => updatePreferences({ webAppUrl: url })}
      />
    </div>
  );
};
