// filepath: src/App.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DSPSettings,
  EQPreset,
  ListeningLogEntry,
  SmartPlaylist,
  TrackItem,
} from './types/audio';
import { audioEngine, createDefaultDSPSettings } from './utils/audioEngine';
import { processDirectoryFiles } from './utils/flacParser';
import { evaluateSmartPlaylist } from './utils/smartFilter';
import { SmartPlaylistView } from './components/SmartPlaylistView';
import { EqualizerView } from './components/EqualizerView';
import { YearInReviewView } from './components/YearInReviewView';

declare global {
  interface Window {
    icejazzDesktop?: {
      isDesktopApp?: boolean;
      minimizeToTray?: () => Promise<boolean>;
      minimizeWindow?: () => Promise<boolean>;
      quitApp?: () => Promise<boolean>;
      onTrayCommand?: (callback: (command: string) => void) => () => void;
    };
  }
}

type MainWorkspaceTab = 'library' | 'smart-playlists' | 'equalizer' | 'year-review';
type SortColumn = 'trackNumber' | 'title' | 'artist' | 'album' | 'duration';

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const mins = Math.floor(sec / 60);
  const secs = Math.floor(sec % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

export default function App() {
  const [tracks, setTracks] = useState<TrackItem[]>([]);
  const [smartPlaylists, setSmartPlaylists] = useState<SmartPlaylist[]>([]);
  const [history, setHistory] = useState<ListeningLogEntry[]>([]);
  const [dsp, setDsp] = useState<DSPSettings>(createDefaultDSPSettings());
  const [customPresets, setCustomPresets] = useState<EQPreset[]>([]);

  const [activeTab, setActiveTab] = useState<MainWorkspaceTab>('library');
  const [sortColumn, setSortColumn] = useState<SortColumn>('album');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  const [currentTrackId, setCurrentTrackId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [repeatMode, setRepeatMode] = useState<'off' | 'all' | 'one'>('off');

  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);

  const folderInputRef = useRef<HTMLInputElement | null>(null);

  const currentTrack = useMemo(
    () => tracks.find((t) => t.id === currentTrackId) || null,
    [tracks, currentTrackId]
  );

  const filteredTracks = useMemo(() => {
    let list = [...tracks];
    const dir = sortDirection === 'asc' ? 1 : -1;
    return list.sort((a, b) => {
      switch (sortColumn) {
        case 'trackNumber': return (a.trackNumber - b.trackNumber) * dir;
        case 'title': return a.title.localeCompare(b.title) * dir;
        case 'artist': return a.artist.localeCompare(b.artist) * dir;
        case 'duration': return (a.duration - b.duration) * dir;
        default: return a.album.localeCompare(b.album) * dir;
      }
    });
  }, [tracks, sortColumn, sortDirection]);

  useEffect(() => {
    audioEngine.applyDSPSettings(dsp);
  }, [dsp]);

  useEffect(() => {
    const unsubscribe = audioEngine.subscribeTimeUpdate((time, dur) => {
      setCurrentTime(time);
      if (dur && Number.isFinite(dur) && dur > 0) setDuration(dur);
    });
    return unsubscribe;
  }, []);

  const playTrack = useCallback(async (track: TrackItem, isCrossfade = false) => {
    setCurrentTrackId(track.id);
    await audioEngine.playTrack(track, isCrossfade);
  }, []);

  const handleTogglePlay = useCallback(async () => {
    if (!currentTrack && filteredTracks.length > 0) {
      await playTrack(filteredTracks[0], false);
      return;
    }
    await audioEngine.togglePlay();
  }, [currentTrack, filteredTracks, playTrack]);

  const handleNextTrack = useCallback((isCrossfade = false) => {
    if (filteredTracks.length === 0) return;
    if (shuffle) {
      const randomIdx = Math.floor(Math.random() * filteredTracks.length);
      playTrack(filteredTracks[randomIdx], isCrossfade);
      return;
    }
    const idx = filteredTracks.findIndex((t) => t.id === currentTrackId);
    if (idx === -1 || idx + 1 >= filteredTracks.length) {
      playTrack(filteredTracks[0], isCrossfade);
    } else {
      playTrack(filteredTracks[idx + 1], isCrossfade);
    }
  }, [filteredTracks, currentTrackId, shuffle, playTrack]);

  const handlePrevTrack = useCallback(() => {
    if (filteredTracks.length === 0) return;
    const idx = filteredTracks.findIndex((t) => t.id === currentTrackId);
    if (idx > 0) playTrack(filteredTracks[idx - 1], false);
    else playTrack(filteredTracks[filteredTracks.length - 1], false);
  }, [filteredTracks, currentTrackId, playTrack]);

  useEffect(() => {
    audioEngine.setLifecycleCallbacks(
      () => handleNextTrack(false),
      () => handleNextTrack(true),
      (playing) => setIsPlaying(playing)
    );
  }, [handleNextTrack]);

  const handleFolderSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    try {
      const parsedTracks = await processDirectoryFiles(fileList, () => {});
      if (parsedTracks.length > 0) {
        setTracks((prev) => [...prev, ...parsedTracks]);
      }
    } finally {
      if (folderInputRef.current) folderInputRef.current.value = '';
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextTime = Number(e.target.value);
    setCurrentTime(nextTime);
    audioEngine.seek(nextTime);
  };

  const handleVolumeWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const step = e.deltaY < 0 ? 0.05 : -0.05;
    const nextVol = Math.max(0, Math.min(1, Number((dsp.volume + step).toFixed(2))));
    setDsp(prev => ({ ...prev, volume: nextVol, muted: nextVol === 0 }));
  };

  const handleSort = (col: SortColumn) => {
    if (sortColumn === col) setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    else { setSortColumn(col); setSortDirection('asc'); }
  };

  const effectiveDuration = duration > 0 ? duration : currentTrack?.duration || 0;
  const progressPercent = effectiveDuration > 0 ? Math.min(100, (currentTime / effectiveDuration) * 100) : 0;

  return (
    <div className="app-shell">
      <input
        ref={folderInputRef}
        type="file"
        multiple
        // @ts-expect-error standard attr
        webkitdirectory=""
        directory=""
        onChange={handleFolderSelect}
        className="hidden"
      />

      <header className="top-nav">
        <div className="brand-block transition-ui">
          {"[TRL]\nBRUTAL\nCORE."}
        </div>
        <nav className="tabs-container">
          <button onClick={() => setActiveTab('library')} className={`tab transition-ui ${activeTab === 'library' ? 'active' : ''}`}>Library</button>
          <button onClick={() => setActiveTab('smart-playlists')} className={`tab transition-ui ${activeTab === 'smart-playlists' ? 'active' : ''}`}>Filters</button>
          <button onClick={() => setActiveTab('equalizer')} className={`tab transition-ui ${activeTab === 'equalizer' ? 'active' : ''}`}>Terminal_EQ</button>
          <button onClick={() => setActiveTab('year-review')} className={`tab transition-ui ${activeTab === 'year-review' ? 'active' : ''}`}>Stats</button>
        </nav>
      </header>

      <main className="workspace">
        <aside className="sidebar">
          <div className="album-art-zone">
            <div className="art-label">Current_Container</div>
            <div className="art-placeholder transition-ui">
              {currentTrack?.coverUrl ? (
                <img src={currentTrack.coverUrl} alt="Cover" className="w-full h-full object-cover grayscale" />
              ) : (
                "+-------------------+\n| \\ \\ \\ \\ \\ \\ \\ \\ \\ |\n|  \\ \\ \\ \\ \\ \\ \\ \\  |\n|   N E O N         |\n|   A R C H I V E S |\n|  / / / / / / / /  |\n| / / / / / / / / / |\n+-------------------+"
              )}
            </div>
          </div>
          <div className="track-meta-detailed">
            <div className="meta-row">
              <span className="meta-key">Track_ID</span>
              <span className="meta-val">{currentTrack ? currentTrack.id.slice(0, 12) : '0x001A_CYBER'}</span>
            </div>
            <div className="meta-row">
              <span className="meta-key">Author_Signature</span>
              <span className="meta-val">{currentTrack ? currentTrack.artist : 'System Override'}</span>
            </div>
            <div className="meta-row">
              <span className="meta-key">Format / Bitrate</span>
              <span className="meta-val">{currentTrack ? `${currentTrack.format} / ${currentTrack.bitrate} kbps` : 'N/A'}</span>
            </div>
            <div className="meta-row">
              <span className="meta-key">Engine_Owner</span>
              <span className="meta-val" style={{ color: 'var(--accent)' }}>TrollKing</span>
            </div>
            <div className="mt-4">
              <button onClick={() => folderInputRef.current?.click()} className="btn-brutal w-full transition-ui">MOUNT_DIR</button>
            </div>
          </div>
        </aside>

        <section className="main-view">
          <div className="tracklist-wrapper">
            {activeTab === 'library' && (
              <table className="brutal-table">
                <thead>
                  <tr>
                    <th onClick={() => handleSort('trackNumber')}>IDX</th>
                    <th onClick={() => handleSort('title')}>FILE_NAME</th>
                    <th onClick={() => handleSort('artist')}>AUTHOR</th>
                    <th style={{ textAlign: 'right' }} onClick={() => handleSort('duration')}>LEN</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTracks.map((track) => {
                    const isActive = track.id === currentTrackId;
                    return (
                      <tr 
                        key={track.id} 
                        onDoubleClick={() => playTrack(track, false)} 
                        className={`brutal-row transition-ui ${isActive ? 'playing' : ''}`}
                      >
                        <td>{track.trackNumber}</td>
                        <td>{track.title}</td>
                        <td>{track.artist}</td>
                        <td style={{ textAlign: 'right' }}>{formatTime(track.duration)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            
            {activeTab === 'smart-playlists' && (
              <SmartPlaylistView
                tracks={tracks}
                playlists={smartPlaylists}
                activePlaylistId={smartPlaylists[0]?.id || ''}
                onSelectPlaylist={() => {}}
                onUpdatePlaylist={() => {}}
                onCreatePlaylist={() => {}}
                onDeletePlaylist={() => {}}
                onPlayTrack={(track) => playTrack(track)}
                currentTrackId={currentTrackId || undefined}
              />
            )}
            {activeTab === 'equalizer' && (
              <EqualizerView
                dsp={dsp}
                customPresets={customPresets}
                onChangeDSP={setDsp}
                onSavePreset={(p) => setCustomPresets(prev => [...prev, p])}
              />
            )}
            {activeTab === 'year-review' && (
              <YearInReviewView
                history={history}
                tracks={tracks}
                onImportHistory={(h) => setHistory(prev => [...prev, ...h])}
                onClearHistory={() => setHistory([])}
                onPlayTrack={(track) => playTrack(track)}
              />
            )}
          </div>
        </section>
      </main>

      <footer className="player-footer z-20">
        <div className="visualizer-block transition-ui">
          {"_ ▄ █ ▄ █ ▄ _\n█ █ █ █ █ █ █\n█ █ █ █ █ █ █"}
        </div>

        <div className="controls-block">
          <div className="action-row">
            <button onClick={() => setShuffle(!shuffle)} className={`btn-brutal transition-ui ${shuffle ? 'primary' : ''}`}>[SHUF]</button>
            <button onClick={handlePrevTrack} disabled={!currentTrack} className="btn-brutal transition-ui">&lt;&lt;</button>
            <button onClick={handleTogglePlay} disabled={!currentTrack} className="btn-brutal primary transition-ui">
              {isPlaying ? 'PAUSE' : 'PLAY'}
            </button>
            <button onClick={() => handleNextTrack(false)} disabled={!currentTrack} className="btn-brutal transition-ui">&gt;&gt;</button>
            <button onClick={() => setRepeatMode(prev => prev === 'off' ? 'all' : 'off')} className={`btn-brutal transition-ui ${repeatMode !== 'off' ? 'primary' : ''}`}>[REP]</button>
          </div>
          <div className="progress-row">
            <span>{formatTime(currentTime)}</span>
            <div className="progress-track transition-ui">
              <input
                type="range"
                min={0}
                max={effectiveDuration || 100}
                step={0.2}
                value={currentTime}
                disabled={!currentTrack}
                onChange={handleSeek}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
              />
              <div className="progress-fill transition-ui" style={{ width: `${progressPercent}%` }}></div>
            </div>
            <span>{formatTime(effectiveDuration)}</span>
          </div>
        </div>

        <div className="sys-status-block" onWheel={handleVolumeWheel}>
          <div className="sys-row">
            <span>VOL</span>
            <span className="sys-val">{dsp.muted ? 'MUTE' : `${Math.round(dsp.volume * 100)}%`}</span>
          </div>
          <div className="sys-row">
            <span>TRK</span>
            <span className="sys-val">{currentTrack ? currentTrack.format : 'NULL'}</span>
          </div>
          <div className="sys-row">
            <span>SYS</span>
            <span className="sys-val" style={{ color: 'var(--accent)' }}>TrollKing_Engine</span>
          </div>
        </div>
      </footer>
    </div>
  );
}