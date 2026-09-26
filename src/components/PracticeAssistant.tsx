import React, { useEffect, useRef, useState } from 'react';
import { Brain, Mic, MicOff, Search, UserRound, Users, Volume2 } from 'lucide-react';

type RecognitionLike = {
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
type RecognitionCtor = new () => RecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  }
}

type Role = 'interviewer' | 'candidate';

type Analysis = {
  question: string;
  type: string;
  answer: string;
  keyPoints: string[];
  sources?: { title: string; url: string }[];
};

export const PracticeAssistant: React.FC = () => {
  const [enabled, setEnabled] = useState(false);
  const [role, setRole] = useState<Role>('interviewer');
  const [transcript, setTranscript] = useState('');
  const transcriptRef = useRef('');
  const recognitionRef = useRef<RecognitionLike | null>(null);
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState('Ready');
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [autoAnalyze, setAutoAnalyze] = useState(false);
  const lastAnalyzedRef = useRef('');
  const debounceRef = useRef<any>(null);

  const appendTranscript = (value: string) => {
    const next = `${transcriptRef.current}${transcriptRef.current ? ' ' : ''}${value}`.trim();
    transcriptRef.current = next.slice(-12000);
    setTranscript(transcriptRef.current);
  };

  const analyze = async (override?: string) => {
    const current = (override || transcriptRef.current).trim();
    if (!current || loading) return;
    setLoading(true);
    setStatus('Analyzing…');
    try {
      const res = await fetch('/api/practice/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript: current, speakerRole: role }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      setAnalysis(data);
      lastAnalyzedRef.current = current;
      setStatus('Analysis ready');
    } catch (e: any) {
      setStatus(e?.message || 'Analysis failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!enabled) return;
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor) {
      setStatus('Built-in speech recognition is not available in this browser.');
      return;
    }
    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || 'en-US';
    recognition.onresult = (event: any) => {
      let finalText = '';
      for (let i = event.resultIndex || 0; i < event.results.length; i++) {
        if (event.results[i]?.isFinal) finalText += event.results[i][0]?.transcript || '';
      }
      if (finalText.trim()) {
        appendTranscript(finalText.trim());
        if (autoAnalyze) {
          if (debounceRef.current) clearTimeout(debounceRef.current);
          debounceRef.current = setTimeout(() => analyze(), 1400);
        }
      }
    };
    recognition.onerror = (event: any) => {
      setListening(false);
      setStatus(`Voice error: ${event?.error || 'unknown error'}`);
    };
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    return () => {
      try { recognition.abort(); } catch {}
      recognitionRef.current = null;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [enabled, autoAnalyze]);

  const toggleListening = () => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    if (listening) {
      try { recognition.stop(); } catch {}
      setListening(false);
      setStatus('Paused');
      return;
    }
    try {
      recognition.start();
      setListening(true);
      setStatus(`Listening as ${role}…`);
    } catch {
      setStatus('Could not start microphone. Check browser microphone permission.');
    }
  };

  const clear = () => {
    transcriptRef.current = '';
    setTranscript('');
    setAnalysis(null);
    lastAnalyzedRef.current = '';
    setStatus('Ready');
  };

  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900/70 p-3 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Brain className="w-4 h-4 text-indigo-400" />
          <span className="font-medium text-sm">Practice / Meeting Assistant</span>
          <span className="text-[10px] uppercase tracking-wide text-amber-300 border border-amber-400/20 rounded px-1.5 py-0.5">Disclosed use</span>
        </div>
        <button
          onClick={() => setEnabled(v => !v)}
          className={`px-2.5 py-1 rounded-md text-xs ${enabled ? 'bg-indigo-600 text-white' : 'bg-neutral-800 text-neutral-300'}`}
        >
          {enabled ? 'Enabled' : 'Enable'}
        </button>
      </div>

      {enabled && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-neutral-500">Speaking:</span>
            <button onClick={() => setRole('interviewer')} className={`px-2 py-1 rounded border ${role === 'interviewer' ? 'border-indigo-500 bg-indigo-500/15 text-indigo-200' : 'border-neutral-800 text-neutral-400'}`}><Users className="inline w-3 h-3 mr-1" />Interviewer</button>
            <button onClick={() => setRole('candidate')} className={`px-2 py-1 rounded border ${role === 'candidate' ? 'border-indigo-500 bg-indigo-500/15 text-indigo-200' : 'border-neutral-800 text-neutral-400'}`}><UserRound className="inline w-3 h-3 mr-1" />Candidate</button>
            <button onClick={toggleListening} className={`ml-auto px-2.5 py-1 rounded-md ${listening ? 'bg-red-500/15 text-red-300' : 'bg-neutral-800 text-neutral-200'}`}>
              {listening ? <MicOff className="inline w-3.5 h-3.5 mr-1" /> : <Mic className="inline w-3.5 h-3.5 mr-1" />}
              {listening ? 'Stop' : 'Listen'}
            </button>
          </div>

          <div className="flex items-center justify-between text-[11px] text-neutral-500">
            <span>{status}</span>
            <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={autoAnalyze} onChange={e => setAutoAnalyze(e.target.checked)} /> Auto-analyze completed turns</label>
          </div>

          <textarea value={transcript} onChange={e => { transcriptRef.current = e.target.value; setTranscript(e.target.value); }} placeholder="Live transcript appears here…" className="min-h-20 max-h-40 resize-y rounded-md border border-neutral-800 bg-neutral-950 p-2 text-sm focus:outline-none focus:border-indigo-500" />

          <div className="flex items-center gap-2">
            <button onClick={() => analyze()} disabled={!transcript.trim() || loading} className="px-3 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-500 text-sm disabled:opacity-40"><Search className="inline w-3.5 h-3.5 mr-1" />{loading ? 'Analyzing…' : 'Analyze latest question'}</button>
            <button onClick={clear} className="px-3 py-1.5 rounded-md bg-neutral-800 text-neutral-300 text-sm">Clear</button>
          </div>

          {analysis && (
            <div className="rounded-md border border-neutral-800 bg-neutral-950 p-3 space-y-2 text-sm">
              <div><span className="text-indigo-300 font-medium">Detected question:</span> {analysis.question}</div>
              <div><span className="text-indigo-300 font-medium">Type:</span> {analysis.type}</div>
              <div><span className="text-emerald-300 font-medium">Suggested answer:</span><div className="whitespace-pre-wrap mt-1 text-neutral-200">{analysis.answer}</div></div>
              {analysis.keyPoints?.length > 0 && <div><span className="text-amber-300 font-medium">Key points:</span><ul className="list-disc ml-5 mt-1">{analysis.keyPoints.map((p, i) => <li key={i}>{p}</li>)}</ul></div>}
              {analysis.sources?.length ? <div className="pt-1 text-xs text-neutral-500">Sources: {analysis.sources.map((s, i) => <a key={i} href={s.url} target="_blank" rel="noreferrer" className="text-indigo-300 hover:underline mr-2">{s.title}</a>)}</div> : null}
              <button onClick={() => window.speechSynthesis?.speak(new SpeechSynthesisUtterance(analysis.answer))} className="text-xs text-neutral-400 hover:text-white"><Volume2 className="inline w-3.5 h-3.5 mr-1" />Read answer aloud</button>
            </div>
          )}
        </>
      )}
    </section>
  );
};
