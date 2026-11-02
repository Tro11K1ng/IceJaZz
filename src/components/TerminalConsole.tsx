import React, { useEffect, useRef, useState } from 'react';
import { TerminalLogEntry, TerminalLogTag } from '../types/audio';
import { terminalLogger } from '../utils/terminalLogger';

interface TerminalConsoleProps {
  onCommand: (cmd: string) => void;
}

const TAG_COLORS: Record<TerminalLogTag, string> = {
  SYS: 'text-[var(--text-main)]',
  DSP: 'text-[var(--accent)]',
  IO: 'text-[#60a5fa]',
  META: 'text-[#34d399]',
  PLAY: 'text-[var(--accent)]',
  FILTER: 'text-[#c084fc]',
  SCROBBLE: 'text-[#38bdf8]',
  RPC: 'text-[#818cf8]',
  CMD: 'text-[#facc15]',
  WARN: 'text-[#fb923c]',
  ERR: 'text-[#f87171]',
};

export const TerminalConsole: React.FC<TerminalConsoleProps> = React.memo(
  ({ onCommand }) => {
    const [logs, setLogs] = useState<TerminalLogEntry[]>([]);
    const [inputVal, setInputVal] = useState('');
    const viewportRef = useRef<HTMLDivElement | null>(null);
    const shouldStickBottomRef = useRef(true);

    useEffect(() => {
      const unsubscribe = terminalLogger.subscribe((nextLogs) => {
        setLogs(nextLogs);
      });
      return unsubscribe;
    }, []);

    useEffect(() => {
      const el = viewportRef.current;
      if (!el) return;
      if (shouldStickBottomRef.current) {
        el.scrollTop = el.scrollHeight;
      }
    }, [logs]);

    const handleScroll = () => {
      const el = viewportRef.current;
      if (!el) return;
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      shouldStickBottomRef.current = distFromBottom < 36;
    };

    const handleSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = inputVal.trim();
      if (!trimmed) return;
      shouldStickBottomRef.current = true;
      terminalLogger.log('CMD', `icejazz@audio:~# ${trimmed}`);
      onCommand(trimmed);
      setInputVal('');
    };

    return (
      <div className="terminal-zone">
        <div className="terminal-header">
          <span className="text-[10px] font-extrabold uppercase tracking-wider text-[var(--accent)]">
            [ICEJAZZ_TERMINAL]
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => terminalLogger.clear()}
              className="text-[9px] font-bold uppercase text-[var(--text-dim)] hover:text-[var(--text-main)] cursor-pointer"
              title="Clear log"
            >
              [CLR]
            </button>
          </div>
        </div>

        <div
          ref={viewportRef}
          onScroll={handleScroll}
          className="terminal-log-viewport"
        >
          {logs.map((entry) => (
            <div key={entry.id} className="terminal-log-line">
              <span className="text-[var(--text-dim)] shrink-0">
                [{entry.timestamp}]
              </span>{' '}
              <span
                className={`font-bold shrink-0 ${
                  TAG_COLORS[entry.tag] || 'text-[var(--accent)]'
                }`}
              >
                [{entry.tag}]
              </span>{' '}
              <span className="text-[var(--text-main)] break-words">
                {entry.message}
              </span>
            </div>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="terminal-input-row">
          <span className="text-[10px] font-bold text-[var(--accent)] shrink-0">
            &gt;
          </span>
          <input
            type="text"
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            placeholder="cmd (help, play, vol 80, discord, overlay)..."
            className="terminal-input"
          />
        </form>
      </div>
    );
  }
);
