import React, { useState } from 'react';
import { Shield, Key, Copy, Check, RefreshCw, X, Pencil, Link2 } from 'lucide-react';

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
  // Where the web sender page is hosted (e.g. https://windowupdate.ai.studio). The companion
  // window has no reachable origin of its own — a packaged app loads a local file — so this
  // can't be inferred and has to be configured once.
  webAppUrl: string;
  onUpdateWebAppUrl: (url: string) => void;
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
  webAppUrl,
  onUpdateWebAppUrl,
}) => {
  const [copied, setCopied] = useState<'token' | 'pairing' | 'webAppUrl' | 'trust' | null>(null);
  const [isEditingToken, setIsEditingToken] = useState(false);
  const [customToken, setCustomToken] = useState('');
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [isEditingWebAppUrl, setIsEditingWebAppUrl] = useState(false);
  const [customWebAppUrl, setCustomWebAppUrl] = useState(webAppUrl);
  const isDark = theme === 'dark';

  if (!isOpen) return null;

  // Electron's sandboxed renderer blocks navigator.clipboard; go through the main process instead
  const copyText = async (text: string, which: 'token' | 'pairing' | 'webAppUrl' | 'trust') => {
    const success = window.companion?.copyText
      ? await window.companion.copyText(text)
      : await navigator.clipboard.writeText(text).then(() => true).catch(() => false);
    if (success) {
      setCopied(which);
      setTimeout(() => setCopied(null), 2000);
    }
  };
  const handleCopy = () => copyText(sessionToken, 'token');

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

  // Pre-fills both the address and token on whatever device opens this link (scanned or clicked),
  // so nobody has to notice or retype the LAN IP, which is different on every machine/network.
  const primaryAddress = addresses[0] || '';
  const pairingBase = webAppUrl.trim().replace(/\/+$/, '');
  const pairingUrl = pairingBase
    ? `${pairingBase}/?desktop=${encodeURIComponent(primaryAddress)}&desktopToken=${encodeURIComponent(sessionToken)}`
    : '';

  const submitWebAppUrl = () => {
    const trimmed = customWebAppUrl.trim();
    if (!trimmed) return;
    onUpdateWebAppUrl(trimmed);
    setIsEditingWebAppUrl(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div
        className={`w-full max-w-md max-h-[85vh] flex flex-col rounded-xl border shadow-2xl transition-all ${
          isDark
            ? 'bg-neutral-900 border-neutral-800 text-neutral-100'
            : 'bg-white border-neutral-200 text-neutral-900'
        }`}
      >
        <div className="shrink-0 flex items-center justify-between px-5 pt-5 pb-3 border-b border-neutral-800/60">
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

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 space-y-4 text-xs">
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
                    {copied === 'token' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
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

          {/* Web sender pairing: the companion has no reachable origin of its own, so the web
              app's URL is configured once here, then a ready-to-copy link (address + token
              pre-filled) can be shared without opening anything else. */}
          <div className="pt-1 space-y-2">
            <div>
              <label className="block text-[11px] font-medium text-neutral-400 mb-1">Web App URL</label>
              {isEditingWebAppUrl ? (
                <div className="space-y-1.5">
                  <input
                    autoFocus
                    value={customWebAppUrl}
                    onChange={(e) => setCustomWebAppUrl(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') submitWebAppUrl();
                      if (e.key === 'Escape') setIsEditingWebAppUrl(false);
                    }}
                    placeholder="https://windowupdate.ai.studio"
                    className={`w-full px-2.5 py-1.5 rounded-md border border-indigo-500/60 font-mono text-[11px] text-indigo-300 focus:outline-none ${
                      isDark ? 'bg-neutral-950' : 'bg-neutral-50'
                    }`}
                  />
                  <div className="flex items-center justify-end gap-1.5">
                    <button
                      onClick={() => setIsEditingWebAppUrl(false)}
                      className="px-2.5 py-1 rounded text-[11px] font-medium text-neutral-400 hover:text-neutral-200"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={submitWebAppUrl}
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
                  <span className="font-mono text-xs text-indigo-400 truncate">
                    {webAppUrl || 'Not set — click to configure'}
                  </span>
                  <div className="flex items-center gap-1 shrink-0 ml-2">
                    <button
                      onClick={() => copyText(webAppUrl, 'webAppUrl')}
                      disabled={!webAppUrl}
                      className="p-1 text-neutral-400 hover:text-indigo-400 disabled:opacity-40 transition-colors"
                      title="Copy web app URL"
                    >
                      {copied === 'webAppUrl' ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                    <button
                      onClick={() => {
                        setCustomWebAppUrl(webAppUrl);
                        setIsEditingWebAppUrl(true);
                      }}
                      className="p-1 text-neutral-400 hover:text-indigo-400 transition-colors"
                      title="Edit web app URL"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>

            {pairingUrl ? (
              <div>
                <label className="block text-[11px] font-medium text-neutral-400 mb-1">
                  Sender Pairing Link (address &amp; token pre-filled)
                </label>
                <div
                  className={`flex items-center justify-between rounded-lg border px-3 py-2 ${
                    isDark ? 'bg-neutral-950 border-neutral-800' : 'bg-neutral-50 border-neutral-200'
                  }`}
                >
                  <span className="font-mono text-[11px] text-indigo-400 truncate">{pairingUrl}</span>
                  <button
                    onClick={() => copyText(pairingUrl, 'pairing')}
                    className="p-1 text-neutral-400 hover:text-indigo-400 transition-colors shrink-0 ml-2"
                    title="Copy pairing link"
                  >
                    {copied === 'pairing' ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Link2 className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-[11px] text-amber-400/90">Set the Web App URL above to generate a pairing link.</p>
            )}

            {primaryAddress && (
              <div>
                <label className="block text-[11px] font-medium text-neutral-400 mb-1">
                  Trust This Connection (first time only)
                </label>
                <div
                  className={`flex items-center justify-between rounded-lg border px-3 py-2 ${
                    isDark ? 'bg-neutral-950 border-neutral-800' : 'bg-neutral-50 border-neutral-200'
                  }`}
                >
                  <a
                    href={`https://${primaryAddress}/health`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-[11px] text-indigo-400 hover:text-indigo-300 underline truncate"
                  >
                    https://{primaryAddress}/health
                  </a>
                  <button
                    onClick={() => copyText(`https://${primaryAddress}/health`, 'trust')}
                    className="p-1 text-neutral-400 hover:text-indigo-400 transition-colors shrink-0 ml-2"
                    title="Copy trust-connection link"
                  >
                    {copied === 'trust' ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
                <p className="text-[11px] text-neutral-500 mt-1">
                  Open once per browser and click through the "not secure" warning (self-signed certificate — there's
                  no public one for a LAN address).
                </p>
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

        <div className="shrink-0 flex justify-end px-5 pb-5 pt-3 border-t border-neutral-800/60">
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
