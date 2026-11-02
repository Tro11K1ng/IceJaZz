import React, { useEffect, useMemo, useRef, useState } from 'react';
import { TrackItem } from '../types/audio';

export interface ParsedLyricLine {
  timeSec: number | null;
  text: string;
}

export function parseLyricsText(raw?: string): {
  isSynced: boolean;
  lines: ParsedLyricLine[];
} {
  if (!raw || !raw.trim()) {
    return { isSynced: false, lines: [] };
  }

  const rawLines = raw.split(/\r?\n/);
  const parsed: ParsedLyricLine[] = [];
  let syncedCount = 0;

  const timeRegex = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;

  for (const line of rawLines) {
    const matches = Array.from(line.matchAll(timeRegex));
    if (matches.length > 0) {
      const cleanText = line.replace(timeRegex, '').trim();
      for (const m of matches) {
        const mins = parseInt(m[1], 10);
        const secs = parseInt(m[2], 10);
        const msStr = m[3] || '0';
        const frac =
          msStr.length === 3
            ? parseInt(msStr, 10) / 1000
            : msStr.length === 2
            ? parseInt(msStr, 10) / 100
            : parseInt(msStr, 10) / 10;
        parsed.push({
          timeSec: mins * 60 + secs + frac,
          text: cleanText || '· · ·',
        });
        syncedCount++;
      }
    } else {
      if (/^\[(ar|ti|al|by|offset|length):/i.test(line.trim())) {
        continue;
      }
      parsed.push({
        timeSec: null,
        text: line,
      });
    }
  }

  if (syncedCount > 0) {
    parsed.sort((a, b) => (a.timeSec ?? 0) - (b.timeSec ?? 0));
  }

  return {
    isSynced: syncedCount > 0,
    lines: parsed,
  };
}

export function getActiveLyricLine(
  rawLyrics: string | undefined,
  currentTime: number
): string | null {
  const { isSynced, lines } = parseLyricsText(rawLyrics);
  if (lines.length === 0) return null;
  if (!isSynced) {
    const firstNonEmpty = lines.find((l) => l.text.trim().length > 0);
    return firstNonEmpty ? firstNonEmpty.text : null;
  }
  let activeIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].timeSec;
    if (t !== null && t <= currentTime + 0.15) {
      activeIdx = i;
    }
  }
  return activeIdx >= 0 ? lines[activeIdx].text : lines[0]?.text || null;
}

interface LyricsViewProps {
  track: TrackItem | null;
  currentTime: number;
  onSeek: (seconds: number) => void;
  onSaveLyrics: (trackId: string, lyrics: string) => void;
}

export const LyricsView: React.FC<LyricsViewProps> = ({
  track,
  currentTime,
  onSeek,
  onSaveLyrics,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [draftLyrics, setDraftLyrics] = useState('');
  const activeLineRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setDraftLyrics(track?.lyrics || '');
    setIsEditing(false);
  }, [track?.id, track?.lyrics]);

  const { isSynced, lines } = useMemo(
    () => parseLyricsText(track?.lyrics),
    [track?.lyrics]
  );

  const activeLineIndex = useMemo(() => {
    if (!isSynced || lines.length === 0) return -1;
    let idx = -1;
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].timeSec;
      if (t !== null && t <= currentTime + 0.15) {
        idx = i;
      }
    }
    return idx;
  }, [isSynced, lines, currentTime]);

  useEffect(() => {
    if (activeLineIndex >= 0 && activeLineRef.current && !isEditing) {
      activeLineRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, [activeLineIndex, isEditing]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !track) return;
    try {
      const text = await file.text();
      setDraftLyrics(text);
      onSaveLyrics(track.id, text);
      setIsEditing(false);
    } catch {
      // Ignore error
    }
  };

  const handleSave = () => {
    if (!track) return;
    onSaveLyrics(track.id, draftLyrics);
    setIsEditing(false);
  };

  const formatTimestamp = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  if (!track) {
    return (
      <div className="min-h-full flex flex-col items-center justify-center p-8 text-center bg-[var(--bg-base)]">
        <h2 className="text-base font-bold text-[var(--text-main)] uppercase">
          [ NO ACTIVE TRACK ]
        </h2>
      </div>
    );
  }

  return (
    <div className="min-h-full p-6 space-y-5 bg-[var(--bg-base)] text-[var(--text-main)] flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b-[3px] border-[var(--text-main)]">
        <div>
          <h2 className="text-base font-bold text-[var(--accent)] uppercase">
            [ LYRICS :: {track.title} ]
          </h2>
          <div className="text-xs text-[var(--text-dim)] mt-0.5 uppercase">
            {track.artist} — {track.album}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <label className="btn-brutal transition-ui px-3 py-1.5 text-xs cursor-pointer">
            <span>LOAD .LRC/.TXT</span>
            <input
              type="file"
              accept=".lrc,.txt"
              onChange={handleFileUpload}
              className="hidden"
            />
          </label>

          {!isEditing ? (
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              className="btn-brutal primary transition-ui px-3 py-1.5 text-xs"
            >
              EDIT LYRICS
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={handleSave}
                className="btn-brutal primary transition-ui px-3 py-1.5 text-xs"
              >
                SAVE
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraftLyrics(track.lyrics || '');
                  setIsEditing(false);
                }}
                className="btn-brutal transition-ui px-3 py-1.5 text-xs"
              >
                CANCEL
              </button>
            </>
          )}
        </div>
      </div>

      {isEditing ? (
        <div className="bg-[var(--bg-surface)] border-[3px] border-[var(--text-main)] p-4 flex-1 flex flex-col">
          <textarea
            value={draftLyrics}
            onChange={(e) => setDraftLyrics(e.target.value)}
            rows={18}
            placeholder="Paste lyrics or LRC lines ([00:15.00] ...)..."
            className="w-full flex-1 p-4 text-sm bg-[var(--bg-base)] border-[1px] border-[var(--text-dim)] text-[var(--text-main)] focus:outline-none focus:border-[var(--accent)] font-mono leading-relaxed"
          />
        </div>
      ) : lines.length === 0 ? (
        <div className="bg-[var(--bg-surface)] border-[3px] border-[var(--text-main)] p-12 text-center space-y-3">
          <div className="text-sm font-bold text-[var(--accent)] uppercase">
            [ NO LYRICS FOUND ]
          </div>
          <button
            type="button"
            onClick={() => setIsEditing(true)}
            className="btn-brutal primary transition-ui inline-flex items-center px-4 py-2 text-xs"
          >
            ADD LYRICS
          </button>
        </div>
      ) : (
        <div className="bg-[var(--bg-surface)] border-[3px] border-[var(--text-main)] p-6 space-y-1.5">
          {lines.map((line, idx) => {
            const isActive = idx === activeLineIndex;
            const canSeek = line.timeSec !== null;
            return (
              <div
                key={idx}
                ref={isActive ? activeLineRef : null}
                onClick={() => {
                  if (line.timeSec !== null) onSeek(line.timeSec);
                }}
                className={`flex items-baseline gap-4 px-3 py-1.5 transition-ui ${
                  canSeek ? 'cursor-pointer hover:bg-[var(--bg-base)]' : ''
                } ${
                  isActive
                    ? 'bg-[var(--accent)] text-[var(--text-dark)] font-extrabold border-l-[4px] border-[var(--text-main)]'
                    : 'text-[var(--text-main)]'
                }`}
              >
                {line.timeSec !== null && (
                  <span
                    className={`text-xs font-mono tabular-nums shrink-0 ${
                      isActive
                        ? 'text-[var(--text-dark)] font-extrabold'
                        : 'text-[var(--text-dim)]'
                    }`}
                  >
                    [{formatTimestamp(line.timeSec)}]
                  </span>
                )}
                <span className="text-sm leading-relaxed break-words">
                  {line.text || '\u00A0'}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
