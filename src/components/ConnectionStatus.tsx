import React from 'react';
import { ConnectionState } from '../types/companion';
import { RefreshCw } from 'lucide-react';

interface ConnectionStatusProps {
  status: ConnectionState;
  senderActive?: boolean;
  onReconnect?: () => void;
  compact?: boolean;
  theme?: 'light' | 'dark';
}

export const ConnectionStatus: React.FC<ConnectionStatusProps> = ({
  status,
  senderActive = true,
  onReconnect,
  compact = false,
  theme = 'dark',
}) => {
  const isDark = theme === 'dark';

  const getDotColor = () => {
    switch (status) {
      case 'Connected':
        return senderActive ? 'bg-emerald-500 shadow-emerald-500/40 shadow-sm animate-pulse' : 'bg-amber-400';
      case 'Connecting...':
        return 'bg-amber-400 animate-ping';
      case 'Disconnected':
      default:
        return 'bg-neutral-500';
    }
  };

  const getTextColor = () => {
    if (status === 'Connected') {
      return isDark ? 'text-emerald-400' : 'text-emerald-700';
    }
    if (status === 'Connecting...') {
      return isDark ? 'text-amber-400' : 'text-amber-700';
    }
    return isDark ? 'text-neutral-400' : 'text-neutral-600';
  };

  const label = `${status}${status === 'Connected' && !senderActive ? ' (Idle)' : ''}`;

  if (compact) {
    return (
      <span className="relative flex h-2.5 w-2.5 items-center justify-center" title={label}>
        {status === 'Connected' && (
          <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60 animate-ping" />
        )}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${getDotColor()}`} />
      </span>
    );
  }

  return (
    <div className="flex items-center gap-2 text-xs font-medium tracking-tight">
      <span className="relative flex h-2.5 w-2.5 items-center justify-center">
        {status === 'Connected' && (
          <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60 animate-ping" />
        )}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${getDotColor()}`} />
      </span>

      <span className={`${getTextColor()} tabular-nums`}>{label}</span>

      {status === 'Disconnected' && onReconnect && (
        <button
          onClick={onReconnect}
          className={`flex items-center gap-1 ml-1 px-1.5 py-0.5 rounded text-[11px] transition-colors ${
            isDark
              ? 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700 hover:text-white'
              : 'bg-neutral-200 text-neutral-700 hover:bg-neutral-300 hover:text-neutral-900'
          }`}
          title="Attempt reconnect now"
        >
          <RefreshCw className="w-2.5 h-2.5" />
          <span>Retry</span>
        </button>
      )}
    </div>
  );
};
