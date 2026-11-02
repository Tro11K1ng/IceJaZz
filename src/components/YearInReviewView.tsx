import React, { useMemo, useState } from 'react';
import { ListeningLogEntry, TrackItem } from '../types/audio';
import { parseImportedHistoryJson } from '../utils/artistService';
import { AlbumArtwork } from './AlbumArtwork';

interface YearInReviewViewProps {
  history: ListeningLogEntry[];
  tracks: TrackItem[];
  onImportHistory: (entries: ListeningLogEntry[]) => void;
  onClearHistory: () => void;
  onPlayTrack: (track: TrackItem, queue: TrackItem[]) => void;
}

type PeriodPreset = '7d' | '30d' | '90d' | 'year' | 'all' | 'custom';

export const YearInReviewView: React.FC<YearInReviewViewProps> = ({
  history,
  tracks,
  onImportHistory,
  onClearHistory,
  onPlayTrack,
}) => {
  const [preset, setPreset] = useState<PeriodPreset>('all');
  const [customStart, setCustomStart] = useState<string>('2026-01-01');
  const [customEnd, setCustomEnd] = useState<string>(
    new Date().toISOString().slice(0, 10)
  );
  const [showImportPanel, setShowImportPanel] = useState<boolean>(false);
  const [importStatus, setImportStatus] = useState<string>('');

  const filteredHistory = useMemo(() => {
    const now = Date.now();
    const dayMs = 86400 * 1000;
    let minTime = 0;
    let maxTime = now + dayMs;

    if (preset === '7d') minTime = now - 7 * dayMs;
    else if (preset === '30d') minTime = now - 30 * dayMs;
    else if (preset === '90d') minTime = now - 90 * dayMs;
    else if (preset === 'year') {
      const yr = new Date().getFullYear();
      minTime = new Date(`${yr}-01-01T00:00:00.000Z`).getTime();
    } else if (preset === 'custom') {
      minTime = customStart
        ? new Date(`${customStart}T00:00:00.000Z`).getTime()
        : 0;
      maxTime = customEnd
        ? new Date(`${customEnd}T23:59:59.000Z`).getTime()
        : now;
    }

    return history.filter((item) => {
      const t = new Date(item.timestamp).getTime();
      return t >= minTime && t <= maxTime;
    });
  }, [history, preset, customStart, customEnd]);

  const stats = useMemo(() => {
    const totalPlays = filteredHistory.length;
    const totalSeconds = filteredHistory.reduce(
      (acc, e) => acc + e.durationListened,
      0
    );
    const totalHours = Math.floor(totalSeconds / 3600);
    const remainingMinutes = Math.round((totalSeconds % 3600) / 60);

    const ratedTracks = tracks.filter((t) => t.rating > 0);
    const avgRating =
      ratedTracks.length > 0
        ? (
            ratedTracks.reduce((acc, t) => acc + t.rating, 0) /
            ratedTracks.length
          ).toFixed(1)
        : '—';

    const artistMap = new Map<
      string,
      { name: string; plays: number; seconds: number; topAlbum: string }
    >();
    const albumMap = new Map<
      string,
      {
        album: string;
        artist: string;
        plays: number;
        seconds: number;
        coverUrl?: string;
      }
    >();
    const trackMap = new Map<
      string,
      {
        trackId: string;
        title: string;
        artist: string;
        album: string;
        plays: number;
        seconds: number;
      }
    >();
    const genreMap = new Map<string, number>();

    const hourlyBins = new Array(24).fill(0);

    for (const entry of filteredHistory) {
      const curArt = artistMap.get(entry.artist) || {
        name: entry.artist,
        plays: 0,
        seconds: 0,
        topAlbum: entry.album,
      };
      curArt.plays += 1;
      curArt.seconds += entry.durationListened;
      artistMap.set(entry.artist, curArt);

      const albKey = `${entry.artist}::${entry.album}`;
      const curAlb = albumMap.get(albKey) || {
        album: entry.album,
        artist: entry.artist,
        plays: 0,
        seconds: 0,
        coverUrl: tracks.find((t) => t.album === entry.album)?.coverUrl,
      };
      curAlb.plays += 1;
      curAlb.seconds += entry.durationListened;
      albumMap.set(albKey, curAlb);

      const curTrk = trackMap.get(entry.title) || {
        trackId: entry.trackId,
        title: entry.title,
        artist: entry.artist,
        album: entry.album,
        plays: 0,
        seconds: 0,
      };
      curTrk.plays += 1;
      curTrk.seconds += entry.durationListened;
      trackMap.set(entry.title, curTrk);

      const gName = entry.genre || 'Unknown';
      genreMap.set(gName, (genreMap.get(gName) || 0) + 1);

      const d = new Date(entry.timestamp);
      const hr = d.getHours();
      hourlyBins[hr] += 1;
    }

    const topArtists = Array.from(artistMap.values()).sort(
      (a, b) => b.seconds - a.seconds
    );
    const topAlbums = Array.from(albumMap.values()).sort(
      (a, b) => b.plays - a.plays
    );
    const topTracks = Array.from(trackMap.values()).sort(
      (a, b) => b.plays - a.plays
    );
    const topGenres = Array.from(genreMap.entries())
      .map(([genre, count]) => ({
        genre,
        count,
        pct: totalPlays > 0 ? Math.round((count / totalPlays) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count);

    let peakHour = 0;
    let maxHrCount = 0;
    hourlyBins.forEach((cnt, hr) => {
      if (cnt > maxHrCount) {
        maxHrCount = cnt;
        peakHour = hr;
      }
    });

    return {
      totalHours,
      remainingMinutes,
      avgRating,
      topArtists,
      topAlbums,
      topTracks,
      topGenres,
      peakHour,
      hasData: totalPlays > 0,
    };
  }, [filteredHistory, tracks]);

  const handleJsonFileImport = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const imported = parseImportedHistoryJson(text);
      if (imported.length > 0) {
        onImportHistory(imported);
        setImportStatus('IMPORTED');
      } else {
        setImportStatus('NO VALID ENTRIES');
      }
    } catch {
      setImportStatus('JSON PARSE ERROR');
    }
  };

  const handleExportReport = () => {
    const report = {
      generatedAt: new Date().toISOString(),
      player: 'IceJaZz',
      periodPreset: preset,
      customRange:
        preset === 'custom'
          ? { from: customStart, to: customEnd }
          : undefined,
      summary: {
        totalHours: stats.totalHours,
        totalMinutes: stats.remainingMinutes,
        averageRating: stats.avgRating,
      },
      topGenres: stats.topGenres.slice(0, 5),
      topArtists: stats.topArtists.slice(0, 5),
      topAlbums: stats.topAlbums.slice(0, 5),
      topTracks: stats.topTracks.slice(0, 10),
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `icejazz-stats-${preset}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-full p-6 space-y-5 bg-[var(--bg-base)] text-[var(--text-main)]">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b-[3px] border-[var(--text-main)]">
        <h2 className="text-base font-bold text-[var(--accent)] uppercase">
          [ LISTENING STATS :: ICEJAZZ ]
        </h2>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowImportPanel(!showImportPanel)}
            className="btn-brutal transition-ui px-3 py-1.5 text-xs"
          >
            IMPORT JSON
          </button>

          {history.length > 0 && (
            <>
              <button
                type="button"
                onClick={handleExportReport}
                className="btn-brutal primary transition-ui px-3 py-1.5 text-xs"
              >
                EXPORT JSON
              </button>
              <button
                type="button"
                onClick={onClearHistory}
                className="btn-brutal transition-ui px-2.5 py-1.5 text-xs hover:text-red-500"
              >
                CLEAR
              </button>
            </>
          )}
        </div>
      </div>

      {showImportPanel && (
        <div className="bg-[var(--bg-surface)] border-[3px] border-[var(--text-main)] p-4 flex flex-wrap items-center justify-between gap-4">
          <div className="text-xs font-bold uppercase text-[var(--accent)]">
            IMPORT LISTENING HISTORY (JSON)
          </div>
          <div className="flex items-center gap-3">
            <label className="btn-brutal primary transition-ui px-3.5 py-1.5 text-xs cursor-pointer">
              <span>SELECT FILE</span>
              <input
                type="file"
                accept=".json"
                onChange={handleJsonFileImport}
                className="hidden"
              />
            </label>
            {importStatus && (
              <span className="text-xs font-mono text-[var(--accent)] font-bold">
                {importStatus}
              </span>
            )}
          </div>
        </div>
      )}

      <div className="bg-[var(--bg-surface)] border-[3px] border-[var(--text-main)] p-3.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              { id: '7d', label: '7 DAYS' },
              { id: '30d', label: '30 DAYS' },
              { id: '90d', label: '90 DAYS' },
              { id: 'year', label: 'THIS YEAR' },
              { id: 'all', label: 'ALL TIME' },
              { id: 'custom', label: 'CUSTOM' },
            ] as { id: PeriodPreset; label: string }[]
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setPreset(item.id)}
              className={`btn-brutal transition-ui px-3 py-1.5 text-xs ${
                preset === item.id ? 'primary' : ''
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 text-xs font-mono font-bold">
          <span className="text-[var(--text-dim)]">FROM:</span>
          <input
            type="date"
            value={customStart}
            onChange={(e) => {
              setCustomStart(e.target.value);
              setPreset('custom');
            }}
            className="px-2 py-1 bg-[var(--bg-base)] border-[1px] border-[var(--text-dim)] text-[var(--text-main)] font-mono"
          />
          <span className="text-[var(--text-dim)]">TO:</span>
          <input
            type="date"
            value={customEnd}
            onChange={(e) => {
              setCustomEnd(e.target.value);
              setPreset('custom');
            }}
            className="px-2 py-1 bg-[var(--bg-base)] border-[1px] border-[var(--text-dim)] text-[var(--text-main)] font-mono"
          />
        </div>
      </div>

      {!stats.hasData ? (
        <div className="bg-[var(--bg-surface)] border-[3px] border-[var(--text-main)] p-12 text-center">
          <h3 className="text-sm font-bold uppercase text-[var(--accent)]">
            [ NO LISTENING HISTORY LOGGED ]
          </h3>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-[var(--bg-surface)] border-[3px] border-[var(--text-main)] p-4">
              <div className="text-xs font-bold text-[var(--text-dim)] mb-1 uppercase">
                LISTENING TIME
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-mono tabular-nums font-bold text-[var(--text-main)]">
                  {stats.totalHours}
                </span>
                <span className="text-xs font-mono text-[var(--text-dim)]">
                  H
                </span>
                <span className="text-2xl font-mono tabular-nums font-bold text-[var(--text-main)] ml-1">
                  {stats.remainingMinutes}
                </span>
                <span className="text-xs font-mono text-[var(--text-dim)]">
                  MIN
                </span>
              </div>
            </div>

            <div className="bg-[var(--bg-surface)] border-[3px] border-[var(--text-main)] p-4">
              <div className="text-xs font-bold text-[var(--text-dim)] mb-1 uppercase">
                AVERAGE RATING
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl font-mono tabular-nums font-bold text-[var(--accent)]">
                  {stats.avgRating} ★
                </span>
              </div>
            </div>

            <div className="bg-[var(--bg-surface)] border-[3px] border-[var(--text-main)] p-4">
              <div className="text-xs font-bold text-[var(--text-dim)] mb-1 uppercase">
                TOP GENRE
              </div>
              <div className="text-xl font-mono font-bold text-[var(--accent)] truncate uppercase">
                {stats.topGenres[0]?.genre || 'Unknown'}
              </div>
            </div>

            <div className="bg-[var(--bg-surface)] border-[3px] border-[var(--text-main)] p-4">
              <div className="text-xs font-bold text-[var(--text-dim)] mb-1 uppercase">
                PEAK WINDOW
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl font-mono tabular-nums font-bold text-[var(--text-main)]">
                  {String(stats.peakHour).padStart(2, '0')}:00
                </span>
                <span className="text-xs font-mono text-[var(--text-dim)]">
                  - {String((stats.peakHour + 1) % 24).padStart(2, '0')}:00
                </span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="bg-[var(--bg-surface)] border-[3px] border-[var(--text-main)] p-4 space-y-3.5">
              <h3 className="text-xs font-bold text-[var(--text-main)] uppercase">
                [01] TOP ARTISTS
              </h3>

              <div className="space-y-3">
                {stats.topArtists.slice(0, 5).map((art, idx) => {
                  const maxSec = stats.topArtists[0]?.seconds || 1;
                  const pct = Math.max(
                    8,
                    Math.round((art.seconds / maxSec) * 100)
                  );
                  const mins = Math.max(1, Math.round(art.seconds / 60));
                  return (
                    <div key={art.name} className="space-y-1">
                      <div className="flex items-center justify-between text-xs font-mono">
                        <div className="flex items-center gap-2">
                          <span className="tabular-nums text-[var(--accent)] font-bold w-5">
                            0{idx + 1}
                          </span>
                          <span className="font-bold text-[var(--text-main)]">
                            {art.name}
                          </span>
                          <span className="text-[var(--text-dim)]">/</span>
                          <span className="text-[var(--text-dim)] text-[10px] truncate max-w-[160px]">
                            {art.topAlbum}
                          </span>
                        </div>
                        <div className="tabular-nums font-bold text-[var(--text-dim)]">
                          {mins} MIN
                        </div>
                      </div>
                      <div className="h-1.5 bg-[var(--bg-base)] border-[1px] border-[var(--text-dim)] overflow-hidden p-[1px]">
                        <div
                          className="h-full bg-[var(--accent)]"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="bg-[var(--bg-surface)] border-[3px] border-[var(--text-main)] p-4 space-y-3.5">
              <h3 className="text-xs font-bold text-[var(--text-main)] uppercase">
                [02] TOP ALBUMS
              </h3>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {stats.topAlbums.slice(0, 4).map((alb, idx) => {
                  const albumTracks = tracks.filter(
                    (t) => t.album === alb.album
                  );
                  return (
                    <div
                      key={alb.album}
                      onClick={() => {
                        if (albumTracks.length > 0)
                          onPlayTrack(albumTracks[0], albumTracks);
                      }}
                      className="bg-[var(--bg-base)] border-[1px] border-[var(--text-dim)] p-2.5 cursor-pointer hover:border-[var(--accent)] transition-ui"
                    >
                      <div className="relative aspect-square mb-2 overflow-hidden border-[1px] border-[var(--text-dim)] grayscale">
                        <AlbumArtwork
                          coverUrl={alb.coverUrl}
                          album={alb.album}
                          artist={alb.artist}
                          className="w-full h-full"
                        />
                        <div className="absolute top-0 left-0 bg-[var(--bg-base)] border-r-[1px] border-b-[1px] border-[var(--text-dim)] px-1.5 py-0.5 text-[10px] font-mono tabular-nums text-[var(--accent)] font-bold">
                          0{idx + 1}
                        </div>
                      </div>
                      <div className="text-xs font-bold text-[var(--text-main)] truncate uppercase">
                        {alb.album}
                      </div>
                      <div className="text-[10px] font-mono font-bold text-[var(--text-dim)] truncate uppercase">
                        {alb.artist}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="bg-[var(--bg-surface)] border-[3px] border-[var(--text-main)] overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b-[3px] border-[var(--text-main)]">
              <h3 className="text-xs font-bold text-[var(--text-main)] uppercase">
                [03] TOP TRACKS
              </h3>
            </div>

            <div className="overflow-x-auto brutal-scroll">
              <table className="brutal-table w-full">
                <thead>
                  <tr>
                    <th className="w-12">#</th>
                    <th>TRACK</th>
                    <th>ARTIST</th>
                    <th>ALBUM</th>
                    <th className="text-right">TIME</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.topTracks.slice(0, 10).map((item, idx) => {
                    const matchedTrack = tracks.find(
                      (t) => t.id === item.trackId || t.title === item.title
                    );
                    return (
                      <tr
                        key={`${item.title}-${idx}`}
                        onClick={() => {
                          if (matchedTrack) onPlayTrack(matchedTrack, tracks);
                        }}
                        className="brutal-row transition-ui"
                      >
                        <td className="text-[var(--accent)]">0{idx + 1}</td>
                        <td>{item.title}</td>
                        <td>{item.artist}</td>
                        <td>{item.album}</td>
                        <td className="text-right tabular-nums">
                          {Math.max(1, Math.round(item.seconds / 60))} MIN
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
