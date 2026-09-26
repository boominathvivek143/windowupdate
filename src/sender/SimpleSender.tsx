import React, { useState, useEffect, useRef } from 'react';
import { Clipboard, Camera } from 'lucide-react';
import { VoiceInputButton, SpeakButton } from '../components/VoiceControls';
import { PracticeAssistant } from '../components/PracticeAssistant';

type LinkStatus = 'setup' | 'connecting' | 'connected' | 'rejected';

const ADDRESS_KEY = 'companion.desktopAddress';
const TOKEN_KEY = 'companion.desktopToken';
// Answer mode: 'manual' = click Ask Gemini per screenshot, 'ai' = every new screenshot is answered automatically
const ANSWER_MODE_KEY = 'companion.answerMode';
type AnswerMode = 'manual' | 'ai';

type Analysis = { status: 'idle' | 'loading' | 'done' | 'error'; text: string };

// Save a data URL (the desktop screenshot) as a file
function downloadDataUrl(dataUrl: string) {
  const ext = dataUrl.startsWith('data:image/png') ? 'png' : dataUrl.startsWith('data:image/webp') ? 'webp' : 'jpg';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = `screenshot-${stamp}.${ext}`;
  a.click();
}
const DEFAULT_ADDRESS = '127.0.0.1:8765';

// The desktop app accepts messages up to 5 MB, so images are shrunk and the total is capped
const MAX_IMAGES = 10;
const MAX_IMAGE_SIDE = 1920;
const MAX_TOTAL_IMAGE_CHARS = 4_500_000;

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// Downscale large images (and re-encode as JPEG) so they fit comfortably in one message
async function prepareImage(file: File): Promise<string> {
  const original = await readAsDataUrl(file);
  if (original.length < 1_000_000) return original;

  const img = new Image();
  img.src = original;
  await img.decode();
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.85);
}

const STATUS_TEXT: Record<LinkStatus, string> = {
  setup: 'Enter the address and token shown in the desktop app',
  connecting: 'Looking for desktop app…',
  connected: 'Connected to desktop app',
  rejected: 'Token rejected — check the token in the desktop app',
};

// URL parameter wins (pairing links), then the value saved in this browser, then the default
function readSetting(param: string, storageKey: string, fallback: string): string {
  const fromUrl = new URLSearchParams(window.location.search).get(param);
  if (fromUrl) return fromUrl;
  try {
    return localStorage.getItem(storageKey) ?? fallback;
  } catch {
    return fallback;
  }
}

// Minimal sender: types straight into the Electron desktop companion over wss://<address>
// (wss, not ws: the companion serves a self-signed TLS cert so this works from an https:// page too —
// browsers block a plain ws:// connection from https:// as mixed content)
export const SimpleSender: React.FC = () => {
  const [text, setText] = useState('');
  const [address, setAddress] = useState(() => readSetting('desktop', ADDRESS_KEY, DEFAULT_ADDRESS));
  const [token, setToken] = useState(() => readSetting('desktopToken', TOKEN_KEY, ''));
  const [status, setStatus] = useState<LinkStatus>('connecting');
  const [showSettings, setShowSettings] = useState(false);
  const [images, setImages] = useState<string[]>([]);
  const [imageError, setImageError] = useState<string | null>(null);
  // Reply typed in the desktop app's reply box
  const [reply, setReply] = useState('');
  const [replyCopied, setReplyCopied] = useState(false);
  // Screenshot sent from the desktop app (Ctrl+Alt+S there)
  const [replyImage, setReplyImage] = useState('');
  const [replyImageOpen, setReplyImageOpen] = useState(false);
  // Text copied on the desktop (clipboard auto-send), shown separately from the reply
  const [copiedText, setCopiedText] = useState('');
  // Short status shown next to the connection line ("Screenshot shared", "Copied text shared", ...)
  const [notice, setNotice] = useState('');
  const noticeTimerRef = useRef<any>(null);
  const showNotice = (message: string) => {
    setNotice(message);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setNotice(''), 3000);
  };
  // Features the web server offers (Gemini key configured, installer built)
  const [serverConfig, setServerConfig] = useState({ geminiEnabled: false, desktopDownload: false });
  // Gemini reading of the current screenshot
  const [analysis, setAnalysis] = useState<Analysis>({ status: 'idle', text: '' });
  const [question, setQuestion] = useState('');
  const [analysisCopied, setAnalysisCopied] = useState(false);
  const [answerMode, setAnswerMode] = useState<AnswerMode>(() => {
    try {
      return localStorage.getItem(ANSWER_MODE_KEY) === 'ai' ? 'ai' : 'manual';
    } catch {
      return 'manual';
    }
  });
  const analyzeRequestRef = useRef(0);
  const answerModeRef = useRef(answerMode);
  const geminiEnabledRef = useRef(false);
  const questionRef = useRef('');

  const wsRef = useRef<WebSocket | null>(null);
  const authedRef = useRef(false);
  const activeRef = useRef(false);
  const textRef = useRef('');
  const imagesRef = useRef<string[]>([]);
  const debounceRef = useRef<any>(null);

  useEffect(() => {
    try {
      localStorage.setItem(ADDRESS_KEY, address);
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      // Storage unavailable (private mode): settings last for this page only
    }
  }, [address, token]);

  useEffect(() => {
    fetch('/api/config')
      .then((res) => (res.ok ? res.json() : null))
      .then((config) => {
        if (!config) return;
        setServerConfig({ geminiEnabled: !!config.geminiEnabled, desktopDownload: !!config.desktopDownload });
        geminiEnabledRef.current = !!config.geminiEnabled;
      })
      .catch(() => {
        // Page opened without the companion web server (e.g. static hosting): extras stay hidden
      });
  }, []);

  useEffect(() => {
    answerModeRef.current = answerMode;
    try {
      localStorage.setItem(ANSWER_MODE_KEY, answerMode);
    } catch {}
  }, [answerMode]);

  // Ask Gemini (via this page's server) to answer a screenshot or copied text
  const analyze = async (input: { image?: string; text?: string }, userQuestion = questionRef.current) => {
    const requestId = ++analyzeRequestRef.current;
    setAnalysis({ status: 'loading', text: '' });
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...input, question: userQuestion }),
      });
      const data = await res.json().catch(() => ({}));
      if (requestId !== analyzeRequestRef.current) return; // a newer screenshot replaced this one
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      setAnalysis({ status: 'done', text: data.text || '' });
      // Put the answer straight into the share box, which syncs to the desktop app
      if (data.text) update(data.text, true);
    } catch (err: any) {
      if (requestId !== analyzeRequestRef.current) return;
      setAnalysis({ status: 'error', text: err?.message || 'Could not analyze the screenshot.' });
    }
  };

  const copyAnalysis = async () => {
    try {
      await navigator.clipboard.writeText(analysis.text);
      setAnalysisCopied(true);
      setTimeout(() => setAnalysisCopied(false), 1500);
    } catch {}
  };

  // Returns an open, authenticated socket that is the active sender (claiming the role if needed)
  const activeSocket = (): WebSocket | null => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !authedRef.current) return null;
    // The tab being typed in takes over from any other sender tab
    if (!activeRef.current) {
      ws.send(JSON.stringify({ type: 'CLAIM_ACTIVE_SENDER' }));
      activeRef.current = true;
    }
    return ws;
  };

  const sendText = (value: string) => {
    activeSocket()?.send(JSON.stringify({ type: 'TEXT_UPDATE', text: value, timestamp: Date.now() }));
  };

  const sendImages = (list: string[]) => {
    activeSocket()?.send(JSON.stringify({ type: 'IMAGES_UPDATE', images: list }));
  };

  // Connect to the desktop app, retrying every 3 seconds while it is unreachable
  useEffect(() => {
    const host = address.trim().replace(/^wss?:\/\//, '').replace(/\/+$/, '');
    const key = token.trim();
    if (!host || !key) {
      setStatus('setup');
      return;
    }

    let disposed = false;
    let retryTimer: any = null;

    const connect = () => {
      if (disposed) return;
      let ws: WebSocket;
      try {
        ws = new WebSocket(`wss://${host}/?role=sender`);
      } catch {
        setStatus('setup');
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => ws.send(JSON.stringify({ type: 'AUTH', token: key }));

      ws.onmessage = (event) => {
        let data: any;
        try {
          data = JSON.parse(event.data);
        } catch {
          return;
        }
        if (data.type === 'AUTH_SUCCESS') {
          authedRef.current = true;
          setStatus('connected');
        } else if (data.type === 'AUTH_FAILED') {
          authedRef.current = false;
          setStatus('rejected');
        } else if (data.type === 'SENDER_ASSIGNED') {
          activeRef.current = true;
          // Catch the desktop window up with whatever is already typed
          if (textRef.current) sendText(textRef.current);
          if (imagesRef.current.length) sendImages(imagesRef.current);
        } else if (data.type === 'WARNING_MULTIPLE_SENDERS') {
          activeRef.current = false;
        } else if (data.type === 'REPLY_UPDATE') {
          const next = typeof data.text === 'string' ? data.text : '';
          setReply(next);
          // Only the newest item is shown: new text replaces the previous screenshot
          if (next) {
            setCopiedText('');
            setReplyImage('');
            setReplyImageOpen(false);
            analyzeRequestRef.current++;
            setAnalysis({ status: 'idle', text: '' });
            // AI answer mode: copied text (or an explicit Send) is answered right away; typing is not
            const explicit = data.source === 'clipboard' || data.source === 'send';
            if (data.source === 'clipboard') showNotice('Copied text shared');
            else if (data.source === 'send') showNotice('Reply shared');
            if (explicit && answerModeRef.current === 'ai' && geminiEnabledRef.current) analyze({ text: next });
          }
        } else if (data.type === 'COPIED_TEXT') {
          const copied = typeof data.text === 'string' ? data.text : '';
          if (!copied.trim()) return;
          // Newest item wins: copied text replaces the previous screenshot and reply
          setCopiedText(copied);
          setReply('');
          setReplyImage('');
          setReplyImageOpen(false);
          analyzeRequestRef.current++;
          setAnalysis({ status: 'idle', text: '' });
          showNotice('Copied text shared');
          if (answerModeRef.current === 'ai' && geminiEnabledRef.current) analyze({ text: copied });
        } else if (data.type === 'REPLY_IMAGE') {
          const image = typeof data.image === 'string' ? data.image : '';
          // Only raster data URLs are rendered
          const valid = /^data:image\/(png|jpeg|webp);base64,/.test(image) ? image : '';
          setReplyImage(valid);
          // ...and a new screenshot replaces the previous text
          if (valid) {
            setReply('');
            setCopiedText('');
            showNotice('Screenshot shared');
          }
          // A new screenshot invalidates the previous answer
          analyzeRequestRef.current++;
          setAnalysis({ status: 'idle', text: '' });
          if (valid && answerModeRef.current === 'ai' && geminiEnabledRef.current) analyze({ image: valid });
        }
      };

      ws.onclose = () => {
        authedRef.current = false;
        activeRef.current = false;
        if (wsRef.current === ws) wsRef.current = null;
        if (disposed) return;
        setStatus((prev) => (prev === 'rejected' ? prev : 'connecting'));
        retryTimer = setTimeout(connect, 3000);
      };

      // Expected while the desktop app is not running; onclose schedules the retry
      ws.onerror = () => {};
    };

    setStatus('connecting');
    connect();

    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [address, token]);

  const update = (value: string, immediate = false) => {
    setText(value);
    textRef.current = value;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (immediate) sendText(value);
    else debounceRef.current = setTimeout(() => sendText(value), 150);
  };

  const updateImages = (list: string[]) => {
    setImages(list);
    imagesRef.current = list;
    sendImages(list);
  };

  const addImageFiles = async (files: File[]) => {
    const imageFiles = files.filter((f) => /^image\/(png|jpeg|gif|webp)$/.test(f.type));
    if (imageFiles.length === 0) return;
    setImageError(null);
    try {
      const prepared = await Promise.all(imageFiles.map(prepareImage));
      const next = [...imagesRef.current, ...prepared].slice(0, MAX_IMAGES);
      const total = next.reduce((sum, img) => sum + img.length, 0);
      if (total > MAX_TOTAL_IMAGE_CHARS) {
        setImageError('Images are too large to send together. Remove one and try again.');
        return;
      }
      updateImages(next);
    } catch {
      setImageError('Could not read that image.');
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData.files);
    if (files.some((f) => f.type.startsWith('image/'))) {
      e.preventDefault();
      addImageFiles(files);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    const files = Array.from(e.dataTransfer.files);
    if (files.length) {
      e.preventDefault();
      addImageFiles(files);
    }
  };

  const clearAll = () => {
    update('', true);
    updateImages([]);
    setImageError(null);
    // Also drop what came from the desktop app, and tell it not to re-send it on reconnect
    setReply('');
    setCopiedText('');
    setReplyImage('');
    setReplyImageOpen(false);
    analyzeRequestRef.current++;
    setAnalysis({ status: 'idle', text: '' });
    activeSocket()?.send(JSON.stringify({ type: 'CLEAR_REPLY' }));
  };

  const copyReply = async () => {
    try {
      await navigator.clipboard.writeText(reply);
      setReplyCopied(true);
      setTimeout(() => setReplyCopied(false), 1500);
    } catch {
      // Clipboard may be blocked; the reply text can still be selected manually
    }
  };

  const connected = status === 'connected';
  const settingsOpen = showSettings || !connected;

  return (
    <div className="h-screen w-screen flex flex-col bg-neutral-950 text-neutral-100 font-sans antialiased">
      <div className="w-full max-w-3xl mx-auto flex flex-col flex-1 min-h-0 p-4 sm:p-6 gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm">
            <span
              className={`w-2 h-2 rounded-full ${
                connected ? 'bg-emerald-400' : status === 'rejected' ? 'bg-red-400' : 'bg-amber-400'
              }`}
            />
            <span className={connected ? 'text-emerald-400' : status === 'rejected' ? 'text-red-400' : 'text-neutral-400'}>
              {STATUS_TEXT[status]}
            </span>
            {notice && (
              <span className="ml-2 px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300 text-xs">{notice}</span>
            )}
          </div>
          <div className="flex items-center gap-4">
            {serverConfig.geminiEnabled && (
              <div
                role="radiogroup"
                aria-label="Screenshot answer mode"
                className="flex items-center rounded-md border border-neutral-800 p-0.5 text-xs"
                title="Manual: click Ask Gemini on a screenshot. AI answer: every new screenshot is answered automatically."
              >
                {(['manual', 'ai'] as const).map((mode) => (
                  <button
                    key={mode}
                    role="radio"
                    aria-checked={answerMode === mode}
                    onClick={() => setAnswerMode(mode)}
                    className={`px-2 py-0.5 rounded ${
                      answerMode === mode ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:text-neutral-200'
                    }`}
                  >
                    {mode === 'manual' ? 'Manual' : 'AI answer'}
                  </button>
                ))}
              </div>
            )}
            {serverConfig.desktopDownload && (
              <a href="/download/desktop" className="text-xs text-indigo-300 hover:text-indigo-200">
                Download desktop app
              </a>
            )}
            {connected && (
              <button
                onClick={() => setShowSettings(!showSettings)}
                className="text-xs text-neutral-500 hover:text-neutral-300"
              >
                {showSettings ? 'Hide settings' : 'Settings'}
              </button>
            )}
          </div>
        </div>

        {settingsOpen && (
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="192.168.1.20:8765"
              aria-label="Desktop app address"
              className="sm:w-48 px-3 py-2 rounded-lg border border-neutral-800 bg-neutral-900 font-mono text-sm focus:outline-none focus:border-indigo-500"
            />
            <input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Token from the desktop app"
              aria-label="Desktop app token"
              className="flex-1 px-3 py-2 rounded-lg border border-neutral-800 bg-neutral-900 font-mono text-sm focus:outline-none focus:border-indigo-500"
            />
          </div>
        )}

        {settingsOpen && !connected && address.trim() && (
          <p className="text-[11px] text-neutral-500">
            First time connecting to this desktop app? Its certificate is self-signed, so open{' '}
            <a
              href={`https://${address.trim().replace(/^wss?:\/\//, '')}/health`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-300 hover:text-indigo-200 underline"
            >
              https://{address.trim().replace(/^wss?:\/\//, '')}
            </a>{' '}
            once and click through the browser's "not secure" warning — otherwise the connection above will be silently blocked.
          </p>
        )}

        <PracticeAssistant />

        {images.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {images.map((src, index) => (
              <div key={index} className="relative">
                <img
                  src={src}
                  alt={`Pasted image ${index + 1}`}
                  className="h-20 w-auto rounded-md border border-neutral-800 object-cover"
                />
                <button
                  onClick={() => updateImages(images.filter((_, i) => i !== index))}
                  aria-label={`Remove image ${index + 1}`}
                  className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-neutral-800 border border-neutral-700 text-neutral-300 text-xs leading-none hover:bg-red-500 hover:text-white"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        {imageError && <div className="text-xs text-red-400">{imageError}</div>}

        <div className="relative flex-1 min-h-0">
          <textarea
          value={text}
          onChange={(e) => update(e.target.value)}
          onPaste={handlePaste}
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          placeholder="Type or paste text or images here…"
          autoFocus
          className="h-full min-h-0 w-full resize-none rounded-lg border border-neutral-800 bg-neutral-900 p-4 pr-12 text-base leading-relaxed focus:outline-none focus:border-indigo-500"
          />
          <div className="absolute right-2 bottom-2 flex items-center gap-1 rounded-md bg-neutral-950/90 border border-neutral-800 p-1">
            <VoiceInputButton
              onTranscript={(spoken) => update(text ? `${text} ${spoken}` : spoken, true)}
              title="Dictate text"
              className="p-2"
            />
          </div>
        </div>

        {(reply || replyImage || copiedText) && (
          <div className="rounded-lg border border-indigo-500/40 bg-indigo-500/5 p-3 flex flex-col gap-1.5 max-h-[60%] min-h-0">
            <div className="flex items-center justify-between text-xs">
              {/* Yellow = copied text, green = screenshot, indigo = typed reply */}
              <span
                className={`inline-flex items-center gap-1.5 font-medium ${
                  copiedText ? 'text-amber-300' : replyImage ? 'text-emerald-300' : 'text-indigo-300'
                }`}
              >
                {copiedText ? (
                  <Clipboard className="w-3.5 h-3.5 text-amber-400" />
                ) : replyImage ? (
                  <Camera className="w-3.5 h-3.5 text-emerald-400" />
                ) : null}
                {copiedText ? 'Copied text' : replyImage ? 'Screenshot' : 'From desktop app'}
              </span>
              <div className="flex items-center gap-3">
                {replyImage && (
                  <>
                    <button onClick={() => downloadDataUrl(replyImage)} className="text-neutral-400 hover:text-neutral-200">
                      Download
                    </button>
                    <button
                      onClick={() => {
                        analyzeRequestRef.current++;
                        setAnalysis({ status: 'idle', text: '' });
                        setReplyImage('');
                      }}
                      className="text-neutral-400 hover:text-neutral-200"
                    >
                      Hide screenshot
                    </button>
                  </>
                )}
                {reply && (
                  <>
                    <SpeakButton text={reply} title="Read response aloud" className="p-1" />
                    <button onClick={copyReply} className="text-neutral-400 hover:text-neutral-200">
                      {replyCopied ? 'Copied' : 'Copy'}
                    </button>
                  </>
                )}
              </div>
            </div>
            <div className="overflow-y-auto flex flex-col gap-2 min-h-0">
              {replyImage && (
                <img
                  src={replyImage}
                  alt="Screenshot from the desktop app"
                  onClick={() => setReplyImageOpen(true)}
                  title="Click to enlarge"
                  className="max-h-60 w-auto self-start rounded-md border border-neutral-800 cursor-zoom-in"
                />
              )}
              {copiedText && (
                <div className="whitespace-pre-wrap break-words text-sm text-neutral-200 select-text">{copiedText}</div>
              )}
              {(replyImage || reply || copiedText) && serverConfig.geminiEnabled && (
                <div className="flex flex-col gap-2 rounded-md border border-neutral-800 bg-neutral-900/60 p-2">
                  <form
                    className="flex flex-col sm:flex-row gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      analyze(replyImage ? { image: replyImage } : { text: copiedText || reply }, question);
                    }}
                  >
                    <input
                      value={question}
                      onChange={(e) => {
                        setQuestion(e.target.value);
                        questionRef.current = e.target.value;
                      }}
                      placeholder="Optional question for Gemini (leave empty to answer what's on screen)"
                      aria-label="Question for Gemini"
                      className="flex-1 px-2.5 py-1.5 rounded-md border border-neutral-800 bg-neutral-950 text-sm focus:outline-none focus:border-indigo-500"
                    />
                    <button
                      type="submit"
                      disabled={analysis.status === 'loading'}
                      className="px-3 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white text-sm disabled:opacity-50"
                    >
                      {analysis.status === 'loading' ? 'Reading…' : analysis.status === 'done' ? 'Ask again' : 'Ask Gemini'}
                    </button>
                  </form>
                  {analysis.status === 'error' && <div className="text-xs text-red-400">{analysis.text}</div>}
                  {analysis.status === 'done' && (
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-emerald-300 font-medium">Gemini</span>
                        <button onClick={copyAnalysis} className="text-neutral-400 hover:text-neutral-200">
                          {analysisCopied ? 'Copied' : 'Copy'}
                        </button>
                      </div>
                      <div className="whitespace-pre-wrap break-words text-sm text-neutral-200 select-text">{analysis.text}</div>
                    </div>
                  )}
                </div>
              )}
              {reply && (
                <div className="whitespace-pre-wrap break-words text-sm text-neutral-200 select-text">{reply}</div>
              )}
            </div>
          </div>
        )}

        {replyImageOpen && replyImage && (
          <div
            onClick={() => setReplyImageOpen(false)}
            className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4 cursor-zoom-out"
          >
            <img src={replyImage} alt="Screenshot from the desktop app, enlarged" className="max-w-full max-h-full rounded-md" />
          </div>
        )}

        <div className="flex items-center justify-between text-xs text-neutral-500">
          <span>
            {text.length} characters{images.length > 0 && ` · ${images.length} image${images.length > 1 ? 's' : ''}`}
          </span>
          <button
            onClick={clearAll}
            className="px-3 py-1.5 rounded-lg border border-neutral-800 hover:bg-neutral-900 text-neutral-300"
          >
            Clear
          </button>
        </div>
      </div>
    </div>
  );
};
