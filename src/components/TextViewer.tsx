import React, { useRef, useEffect, useState } from 'react';
import { Search, X, ShieldAlert } from 'lucide-react';

interface TextViewerProps {
  text: string;
  fontSize: number;
  theme: 'light' | 'dark';
  autoScroll: boolean;
  onClear: () => void;
  onCopy: () => void;
}

export const TextViewer: React.FC<TextViewerProps> = ({
  text,
  fontSize,
  theme,
  autoScroll,
  onClear,
  onCopy,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const isDark = theme === 'dark';

  // Auto-scroll when text changes if autoScroll is enabled
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [text, autoScroll]);

  // Keyboard shortcut listener: Ctrl/Cmd + A, Ctrl/Cmd + C, Ctrl/Cmd + L, Ctrl/Cmd + F
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isCmdOrCtrl = e.metaKey || e.ctrlKey;

      if (isCmdOrCtrl && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        onClear();
      } else if (isCmdOrCtrl && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setIsSearchOpen((prev) => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClear]);

  // Select all text inside content container
  const handleSelectAll = () => {
    if (contentRef.current) {
      const range = document.createRange();
      range.selectNodeContents(contentRef.current);
      const selection = window.getSelection();
      if (selection) {
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }
  };

  // Render text safely with search highlights, strict plain text (no HTML execution)
  const renderContent = () => {
    if (!text) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[300px] text-center p-8 select-none">
          <div
            className={`w-12 h-12 rounded-xl mb-3 flex items-center justify-center border ${
              isDark ? 'bg-neutral-900 border-neutral-800 text-neutral-500' : 'bg-neutral-100 border-neutral-200 text-neutral-400'
            }`}
          >
            <span className="font-mono text-xl">⇄</span>
          </div>
          <h4 className={`text-sm font-semibold mb-1 ${isDark ? 'text-neutral-300' : 'text-neutral-700'}`}>
            Waiting for text from browser...
          </h4>
          <p className={`text-xs max-w-sm ${isDark ? 'text-neutral-500' : 'text-neutral-500'}`}>
            Type or paste into the web sender. Text synchronizes instantly over the local WebSocket connection.
          </p>
          <div className="mt-4 flex items-center gap-2 text-[11px] font-mono text-neutral-500">
            <span className="px-1.5 py-0.5 rounded border border-neutral-800 bg-neutral-900/60">Ctrl + L</span> to clear
            <span>·</span>
            <span className="px-1.5 py-0.5 rounded border border-neutral-800 bg-neutral-900/60">Ctrl + F</span> to search
          </div>
        </div>
      );
    }

    if (!searchQuery.trim()) {
      // Direct text node rendering ensures plain text is never interpreted as HTML
      return (
        <div
          ref={contentRef}
          className="whitespace-pre-wrap break-words leading-relaxed select-text font-sans"
          style={{ fontSize: `${fontSize}px` }}
        >
          {text}
        </div>
      );
    }

    // Highlighting matches while preserving safe plain-text rendering
    const parts = text.split(new RegExp(`(${searchQuery.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')})`, 'gi'));
    return (
      <div
        ref={contentRef}
        className="whitespace-pre-wrap break-words leading-relaxed select-text font-sans"
        style={{ fontSize: `${fontSize}px` }}
      >
        {parts.map((part, index) =>
          part.toLowerCase() === searchQuery.toLowerCase() ? (
            <mark
              key={index}
              className="bg-amber-400/30 text-amber-200 font-medium px-0.5 rounded"
            >
              {part}
            </mark>
          ) : (
            <React.Fragment key={index}>{part}</React.Fragment>
          )
        )}
      </div>
    );
  };

  return (
    <div className="relative flex-1 min-h-0 flex flex-col overflow-hidden">
      {/* Quick Search bar (Ctrl+F) */}
      {isSearchOpen && (
        <div
          className={`flex items-center gap-2 px-3 py-1.5 border-b text-xs transition-colors ${
            isDark ? 'bg-neutral-900 border-neutral-800' : 'bg-neutral-100 border-neutral-200'
          }`}
        >
          <Search className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Find in received text..."
            autoFocus
            className={`w-full bg-transparent border-none outline-none text-xs placeholder:text-neutral-500 ${
              isDark ? 'text-white' : 'text-neutral-900'
            }`}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="text-neutral-400 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={() => {
              setIsSearchOpen(false);
              setSearchQuery('');
            }}
            className="text-[11px] px-1.5 py-0.5 rounded text-neutral-400 hover:text-white"
          >
            Esc
          </button>
        </div>
      )}

      {/* Main text content scroll container */}
      <div
        ref={containerRef}
        className={`flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6 transition-colors scroll-smooth ${
          isDark
            ? 'bg-neutral-950 text-neutral-100 selection:bg-indigo-500/40 selection:text-indigo-100'
            : 'bg-white text-neutral-900 selection:bg-indigo-200 selection:text-indigo-900'
        }`}
      >
        {renderContent()}
      </div>
    </div>
  );
};
