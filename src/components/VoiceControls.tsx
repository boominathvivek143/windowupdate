import React, { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Volume2, VolumeX, Loader2 } from 'lucide-react';

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

// Chromium's SpeechRecognition needs a Google API key baked into the browser to reach the cloud
// recognition service. Electron's bundled Chromium ships without one, so recognition.start()
// always fails with a 'network' error there — this is an Electron/Chromium limitation, not
// something fixable from renderer code (electron/electron#7749, #46143). When that happens we
// fall back to recording the clip ourselves and transcribing it server-side via Gemini.
const ERROR_MESSAGES: Record<string, string> = {
  'not-allowed': 'Microphone access was denied.',
  'service-not-allowed': 'Speech recognition service is blocked.',
  'no-speech': 'No speech detected — try again.',
  'audio-capture': 'No microphone found.',
  aborted: 'Voice input stopped.',
};

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export const VoiceInputButton: React.FC<{
  onTranscript: (text: string) => void;
  className?: string;
  title?: string;
}> = ({ onTranscript, className = '', title = 'Voice input' }) => {
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const callbackRef = useRef(onTranscript);
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorTimerRef = useRef<any>(null);
  // Once native recognition proves broken (Electron), skip straight to the recording fallback
  const useFallbackRef = useRef(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);

  useEffect(() => {
    callbackRef.current = onTranscript;
  }, []);
  const [supported, setSupported] = useState(true);

  const showError = (message: string) => {
    setError(message);
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    errorTimerRef.current = setTimeout(() => setError(null), 5000);
  };

  const startFallbackRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: 'audio/webm' });
        if (blob.size === 0) {
          setListening(false);
          return;
        }
        setListening(false);
        setTranscribing(true);
        try {
          const audio = await blobToDataUrl(blob);
          const res = await fetch('/api/transcribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ audio }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
          if (data.text) callbackRef.current(data.text);
        } catch (err: any) {
          showError(err?.message || 'Transcription failed.');
        } finally {
          setTranscribing(false);
        }
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setListening(true);
    } catch {
      setListening(false);
      showError('Microphone access failed.');
    }
  };

  useEffect(() => {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      // No native speech API at all (unlikely in Chromium-based hosts): recording fallback only
      useFallbackRef.current = true;
      return;
    }

    const recognition = new Recognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = navigator.language || 'en-US';
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results || [])
        .map((result: any) => result?.[0]?.transcript || '')
        .join(' ')
        .trim();
      if (transcript) callbackRef.current(transcript);
    };
    recognition.onerror = (event: any) => {
      setListening(false);
      // 'network' / 'service-not-allowed' here means the host's Chromium has no speech API key
      // (always true in Electron) — switch to the record-and-transcribe fallback from now on
      if (event?.error === 'network' || event?.error === 'service-not-allowed') {
        useFallbackRef.current = true;
        startFallbackRecording();
        return;
      }
      showError(ERROR_MESSAGES[event?.error] || `Voice input failed (${event?.error || 'unknown error'}).`);
    };
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;

    return () => {
      try { recognition.abort(); } catch {}
      recognitionRef.current = null;
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    };
  }, []);

  if (!supported) return null;

  const toggle = () => {
    setError(null);
    if (listening) {
      if (useFallbackRef.current) {
        try { mediaRecorderRef.current?.stop(); } catch {}
      } else {
        try { recognitionRef.current?.stop(); } catch {}
        setListening(false);
      }
      return;
    }
    if (useFallbackRef.current) {
      startFallbackRecording();
      return;
    }
    const recognition = recognitionRef.current;
    if (!recognition) return;
    try {
      recognition.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  };

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={toggle}
        disabled={transcribing}
        className={`inline-flex items-center justify-center rounded-md transition-colors disabled:opacity-60 ${
          error
            ? 'text-amber-400 bg-amber-400/10'
            : listening
            ? 'text-red-400 bg-red-400/10'
            : 'text-neutral-400 hover:text-white hover:bg-neutral-800'
        } ${className}`}
        title={error || (transcribing ? 'Transcribing…' : listening ? 'Stop voice input' : title)}
        aria-label={error || (transcribing ? 'Transcribing…' : listening ? 'Stop voice input' : title)}
        aria-pressed={listening}
      >
        {transcribing ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : listening ? (
          <MicOff className="w-4 h-4" />
        ) : (
          <Mic className="w-4 h-4" />
        )}
      </button>
      {error && (
        <span
          role="alert"
          className="absolute bottom-full right-0 mb-1 w-48 rounded-md border border-amber-500/40 bg-neutral-900 px-2 py-1 text-[10px] leading-snug text-amber-300 shadow-lg z-10"
        >
          {error}
        </span>
      )}
    </span>
  );
};

export const SpeakButton: React.FC<{
  text: string;
  className?: string;
  title?: string;
}> = ({ text, className = '', title = 'Read aloud' }) => {
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => () => window.speechSynthesis?.cancel(), []);

  const toggle = () => {
    if (!('speechSynthesis' in window) || !text.trim()) return;
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = navigator.language || 'en-US';
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utterance);
    setSpeaking(true);
  };

  if (!('speechSynthesis' in window)) return null;

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={!text.trim()}
      className={`inline-flex items-center justify-center rounded-md text-neutral-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed ${className}`}
      title={speaking ? 'Stop speaking' : title}
      aria-label={speaking ? 'Stop speaking' : title}
      aria-pressed={speaking}
    >
      {speaking ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
    </button>
  );
};
