import React, { useState } from 'react';
import { Shield, Key, Copy, Check, RefreshCw, X, QrCode, Pencil } from 'lucide-react';

interface SecurityModalProps {
  isOpen: boolean;
  onClose: () => void;
  sessionToken: string;
  onRegenerateToken: () => void;
  // Lets the user pick their own token instead of the random default
  onSetToken: (token: string) => Promise<{ ok: boolean; token: string; error?: string }>;
  theme: 'light' | 'dark';
  port: number;
  // Network addresses (host:port) a sender on another machine can use; only known inside Electron
  addresses?: string[];
}

export const SecurityModal: React.FC<SecurityModalProps> = ({
  isOpen,
  onClose,
  sessionToken,
  onRegenerateToken,
  onSetToken,
  theme,
  port,
  addresses = [],
}) => {
  const [copied, setCopied] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [isEditingToken, setIsEditingToken] = useState(false);
  const [customToken, setCustomToken] = useState('');
  const [tokenError, setTokenError] = useState<string | null>(null);
  const isDark = theme === 'dark';

  if (!isOpen) return null;

  const handleCopy = async () => {
    // Electron's sandboxed renderer blocks navigator.clipboard; go through the main process instead
    const success = window.companion?.copyText
      ? await window.companion.copyText(sessionToken)
      : await navigator.clipboard.writeText(sessionToken).then(() => true).catch(() => false);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const startEditingToken = () => {
    setCustomToken(sessionToken);
    setTokenError(null);
    setIsEditingToken(true);
  };

  const cancelEditingToken = () => {
    setIsEditingToken(false);
    setTokenError(null);
  };

  const submitCustomToken = async () => {
    const result = await onSetToken(customToken);
    if (result.ok) {
      setIsEditingToken(false);
      setTokenError(null);
    } else {
      setTokenError(result.error || 'Invalid token');
    }
  };

  const pairingUrl = `${window.location.origin}/?token=${sessionToken}&mode=sender`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div
        className={`w-full max-w-md rounded-xl border p-5 shadow-2xl transition-all ${
          isDark
            ? 'bg-neutral-900 border-neutral-800 text-neutral-100'
            : 'bg-white border-neutral-200 text-neutral-900'
        }`}
      >
        <div className="flex items-center justify-between pb-3 border-b border-neutral-800/60 mb-4">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-400">
              <Shield className="w-4 h-4" />
            </div>
            <h3 className="font-semibold text-sm">Security & Session Token</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-4 text-xs">
          <p className={isDark ? 'text-neutral-400' : 'text-neutral-600'}>
            The WebSocket service listens on port <code className="font-mono text-indigo-400">{port}</code>. Only senders presenting this random token are permitted to transmit text.
          </p>

          {addresses.length > 0 && (
            <div>
              <label className="block text-[11px] font-medium text-neutral-400 mb-1">
                Companion Address (enter on the sender machine)
              </label>
              <div className="space-y-1">
                {addresses.map((address) => (
                  <div
                    key={address}
                    className={`rounded-lg border px-3 py-2 font-mono text-emerald-400 select-all ${
                      isDark ? 'bg-neutral-950 border-neutral-800' : 'bg-neutral-50 border-neutral-200'
                    }`}
                  >
                    {address}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="block text-[11px] font-medium text-neutral-400 mb-1">
              Active Session Token
            </label>
            {isEditingToken ? (
              <div className="space-y-1.5">
                <div
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${
                    isDark ? 'bg-neutral-950 border-indigo-500/60' : 'bg-neutral-50 border-indigo-400'
                  }`}
                >
                  <Key className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
                  <input
                    autoFocus
                    value={customToken}
                    onChange={(e) => setCustomToken(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') submitCustomToken();
                      if (e.key === 'Escape') cancelEditingToken();
                    }}
                    placeholder="8-64 hex characters (0-9, a-f)"
                    className={`w-full bg-transparent border-none outline-none font-mono text-xs ${
                      isDark ? 'text-indigo-300 placeholder:text-neutral-600' : 'text-indigo-700 placeholder:text-neutral-400'
                    }`}
                  />
                </div>
                {tokenError && <p className="text-[11px] text-red-400">{tokenError}</p>}
                <div className="flex items-center justify-end gap-1.5">
                  <button
                    onClick={cancelEditingToken}
                    className={`px-2.5 py-1 rounded text-[11px] font-medium ${
                      isDark ? 'text-neutral-400 hover:text-neutral-200' : 'text-neutral-500 hover:text-neutral-800'
                    }`}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={submitCustomToken}
                    className="px-2.5 py-1 rounded text-[11px] font-medium bg-indigo-600 text-white hover:bg-indigo-500"
                  >
                    Save
                  </button>
                </div>
              </div>
            ) : (
              <div
                className={`flex items-center justify-between rounded-lg border px-3 py-2 ${
                  isDark ? 'bg-neutral-950 border-neutral-800' : 'bg-neutral-50 border-neutral-200'
                }`}
              >
                <div className="flex items-center gap-2 font-mono text-xs text-indigo-400 select-all truncate">
                  <Key className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
                  <span>{sessionToken || 'No token generated'}</span>
                </div>
                <div className="flex items-center gap-1 shrink-0 ml-2">
                  <button
                    onClick={handleCopy}
                    className="p-1 text-neutral-400 hover:text-indigo-400 transition-colors"
                    title="Copy token"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    onClick={startEditingToken}
                    className="p-1 text-neutral-400 hover:text-indigo-400 transition-colors"
                    title="Set a custom token"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={onRegenerateToken}
                    className="p-1 text-neutral-400 hover:text-amber-400 transition-colors"
                    title="Rotate / Regenerate token"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Quick Pairing & QR Feature (Section 24) */}
          <div className="pt-2">
            <button
              onClick={() => setShowQR(!showQR)}
              className={`flex items-center justify-between w-full p-2.5 rounded-lg border text-left transition-colors ${
                isDark
                  ? 'border-neutral-800 hover:bg-neutral-800/40'
                  : 'border-neutral-200 hover:bg-neutral-50'
              }`}
            >
              <div className="flex items-center gap-2">
                <QrCode className="w-4 h-4 text-indigo-400" />
                <div>
                  <div className="font-medium text-xs">Direct Web Sender Pairing URL</div>
                  <div className="text-[11px] text-neutral-500">Includes authenticated session token</div>
                </div>
              </div>
              <span className="text-[11px] text-indigo-400 font-semibold">{showQR ? 'Hide' : 'View'}</span>
            </button>

            {showQR && (
              <div className="mt-3 p-3 rounded-lg border border-neutral-800 bg-neutral-950 text-center">
                {/* SVG QR Code Simulation */}
                <div className="mx-auto w-32 h-32 bg-white p-2 rounded-md shadow-sm mb-2 flex items-center justify-center">
                  <div className="grid grid-cols-6 gap-1 w-full h-full p-1 bg-neutral-900 rounded">
                    {Array.from({ length: 36 }).map((_, i) => (
                      <div
                        key={i}
                        className={`rounded-xs ${
                          (i % 2 === 0 && i % 3 !== 0) || i === 0 || i === 5 || i === 30 || i === 35
                            ? 'bg-white'
                            : 'bg-neutral-800'
                        }`}
                      />
                    ))}
                  </div>
                </div>
                <div className="text-[11px] text-neutral-400 break-all select-all font-mono">
                  {pairingUrl}
                </div>
              </div>
            )}
          </div>

          <div
            className={`p-2.5 rounded-lg border text-[11px] leading-relaxed ${
              isDark ? 'bg-neutral-950/60 border-neutral-800 text-neutral-400' : 'bg-neutral-50 border-neutral-200 text-neutral-600'
            }`}
          >
            <strong className="text-neutral-300 block mb-0.5">Privacy Invariant (Spec #13):</strong>
            Text synchronized between sender and companion is stored exclusively in transient memory. No persistent database or cloud log is maintained.
          </div>
        </div>

        <div className="mt-5 flex justify-end">
          <button
            onClick={onClose}
            className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              isDark
                ? 'bg-neutral-800 text-neutral-200 hover:bg-neutral-700'
                : 'bg-neutral-200 text-neutral-800 hover:bg-neutral-300'
            }`}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
