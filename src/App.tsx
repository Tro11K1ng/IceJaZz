import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DiscordConfig,
  DSPSettings,
  EQPreset,
  ListeningLogEntry,
  OverlayConfig,
  SmartPlaylist,
  SystemConfig,
  ThemeConfig,
  TrackItem,
} from './types/audio';
import {
  audioEngine,
  BUILTIN_EQ_PRESETS,
  createDefaultDSPSettings,
} from './utils/audioEngine';
import { processDirectoryFiles } from './utils/flacParser';
import { createDefaultSmartPlaylists } from './utils/smartFilter';
import {
  BUILTIN_THEMES,
  clearLibraryStorage,
  loadSavedDiscordConfig,
  loadSavedDSP,
  loadSavedHistory,
  loadSavedOverlayConfig,
  loadSavedPlayerState,
  loadSavedPresets,
  loadSavedSmartPlaylists,
  loadSavedSystemConfig,
  loadSavedTheme,
  loadTracksFromStorage,
  saveCustomPresets,
  saveDiscordConfig,
  saveDSPSettings,
  saveListeningHistory,
  saveOverlayConfig,
  savePlayerState,
  saveSmartPlaylists,
  saveSystemConfig,
  saveThemeConfig,
  saveTracksToStorage,
  updateSingleTrackMetadataInStorage,
} from './utils/storageEngine';
import { terminalLogger } from './utils/terminalLogger';
import { SmartPlaylistView } from './components/SmartPlaylistView';
import { EqualizerView } from './components/EqualizerView';
import { YearInReviewView } from './components/YearInReviewView';
import { VisualizerRack } from './components/VisualizerRack';
import { ArtistInspector } from './components/ArtistInspector';
import { TerminalConsole } from './components/TerminalConsole';
import { getActiveLyricLine, LyricsView } from './components/LyricsView';
import { CustomizationView } from './components/CustomizationView';
import { AlbumArtwork } from './components/AlbumArtwork';

declare global {
  interface Window {
    icejazzDesktop?: {
      isDesktopApp?: boolean;
      getFilePath?: (file: File) => string;
      lookupFilePath?: (
        name: string,
        size: number,
        lastModified: number,
        relPath?: string
      ) => string;
      scanDirectoryNative?: () => Promise<{
        canceled: boolean;
        tracks: TrackItem[];
        selectedPaths?: string[];
      }>;
      resolveMissingPaths?: (
        items: { id: string; fileName: string; folderPath: string }[]
      ) => Promise<Record<string, string>>;
      onScanProgress?: (
        callback: (data: {
          done: number;
          total: number;
          fileName: string;
        }) => void
      ) => () => void;
      openExternalUrl?: (url: string) => Promise<boolean>;
      minimizeToTray?: () => Promise<boolean>;
      minimizeWindow?: () => Promise<boolean>;
      toggleMaximize?: () => Promise<boolean>;
      setOverlayMode?: (
        enabled: boolean,
        width?: number,
        height?: number
      ) => Promise<boolean>;
      updateDiscordPresence?: (payload: {
        enabled: boolean;
        clientId: string;
        showTimestamps: boolean;
        showWhenPaused: boolean;
        largeImageKey: string;
        trackTitle?: string;
        artist?: string;
        album?: string;
        format?: string;
        isPlaying: boolean;
        currentTime: number;
        duration: number;
      }) => Promise<{ ok: boolean; status: string }>;
      reconnectDiscord?: () => Promise<{ ok: boolean; status: string }>;
      getAutostart?: () => Promise<{
        openAtLogin: boolean;
        startInTray: boolean;
      }>;
      setAutostart?: (cfg: {
        openAtLogin: boolean;
        startInTray: boolean;
      }) => Promise<{
        ok: boolean;
        openAtLogin: boolean;
        startInTray: boolean;
      }>;
      quitApp?: () => Promise<boolean>;
      readLocalFile?: (filePath: string) => Promise<ArrayBuffer | null>;
      selectDirectory?: () => Promise<string | null>;
      onTrayCommand?: (callback: (command: string) => void) => () => void;
    };
  }
}

type MainWorkspaceTab =
  | 'library'
  | 'lyrics'
  | 'smart-playlists'
  | 'equalizer'
  | 'year-review'
  | 'config';

type LibrarySubView = 'tracks' | 'artists' | 'albums' | 'genres';
type SortColumn =
  | 'trackNumber'
  | 'title'
  | 'artist'
  | 'album'
  | 'genre'
  | 'rating'
  | 'duration';

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const mins = Math.floor(sec / 60);
  const secs = Math.floor(sec % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

const TRACK_ROW_HEIGHT = 38;
const TRACK_OVERSCAN = 18;

interface TrackRowProps {
  track: TrackItem;
  isActive: boolean;
  onPlayFromTable: (track: TrackItem) => void;
  onOpenLyrics: (trackId: string) => void;
  onFilterArtist: (artist: string) => void;
  onFilterAlbum: (album: string) => void;
  onFilterGenre: (genre: string) => void;
  onRateTrack: (trackId: string, rating: number) => void;
}

const MemoizedTrackRow = React.memo<TrackRowProps>(
  ({
    track,
    isActive,
    onPlayFromTable,
    onOpenLyrics,
    onFilterArtist,
    onFilterAlbum,
    onFilterGenre,
    onRateTrack,
  }) => {
    return (
      <tr
        onClick={() => onPlayFromTable(track)}
        className={`brutal-row transition-ui cursor-pointer ${
          isActive ? 'playing' : ''
        }`}
        style={{ height: `${TRACK_ROW_HEIGHT}px` }}
      >
        <td className="tabular-nums">{track.trackNumber}</td>
        <td>
          <div className="flex items-center gap-2">
            <span className="truncate max-w-[280px] inline-block">
              {track.title}
            </span>
            {track.lyrics && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenLyrics(track.id);
                }}
                className="text-[10px] font-mono px-1 border border-current opacity-75 hover:opacity-100 cursor-pointer shrink-0"
                title="Open Lyrics"
              >
                LYR
              </button>
            )}
          </div>
        </td>
        <td>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onFilterArtist(track.artist);
            }}
            className="hover:underline text-left cursor-pointer font-bold truncate max-w-[200px] block"
          >
            {track.artist}
          </button>
        </td>
        <td>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onFilterAlbum(track.album);
            }}
            className="hover:underline text-left opacity-85 cursor-pointer truncate max-w-[220px] block"
          >
            {track.album}
          </button>
        </td>
        <td>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onFilterGenre(track.genre);
            }}
            className="hover:underline text-left opacity-85 cursor-pointer truncate max-w-[140px] block"
          >
            {track.genre}
          </button>
        </td>
        <td onClick={(e) => e.stopPropagation()}>
          <div className="inline-flex items-center gap-0.5 font-mono">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                type="button"
                onClick={() =>
                  onRateTrack(track.id, track.rating === star ? 0 : star)
                }
                className={`px-0.5 text-sm cursor-pointer hover:scale-125 transition-transform ${
                  star <= track.rating
                    ? isActive
                      ? 'text-[var(--text-dark)]'
                      : 'text-[var(--accent)]'
                    : 'opacity-25'
                }`}
              >
                ★
              </button>
            ))}
          </div>
        </td>
        <td style={{ textAlign: 'right' }} className="tabular-nums">
          {formatTime(track.duration)}
        </td>
      </tr>
    );
  }
);

interface VirtualizedTrackTableProps {
  tracks: TrackItem[];
  totalLibraryCount: number;
  currentTrackId: string | null;
  sortColumn: SortColumn;
  sortDirection: 'asc' | 'desc';
  scrollTop: number;
  viewportHeight: number;
  onSort: (col: SortColumn) => void;
  onPlayFromTable: (track: TrackItem) => void;
  onOpenLyrics: (trackId: string) => void;
  onFilterArtist: (artist: string) => void;
  onFilterAlbum: (album: string) => void;
  onFilterGenre: (genre: string) => void;
  onRateTrack: (trackId: string, rating: number) => void;
}

const VirtualizedTrackTable = React.memo<VirtualizedTrackTableProps>(
  ({
    tracks,
    totalLibraryCount,
    currentTrackId,
    sortColumn,
    sortDirection,
    scrollTop,
    viewportHeight,
    onSort,
    onPlayFromTable,
    onOpenLyrics,
    onFilterArtist,
    onFilterAlbum,
    onFilterGenre,
    onRateTrack,
  }) => {
    const totalRows = tracks.length;
    const adjustedScrollTop = Math.max(0, scrollTop - 48);
    const startIdx = Math.max(
      0,
      Math.floor(adjustedScrollTop / TRACK_ROW_HEIGHT) - TRACK_OVERSCAN
    );
    const endIdx = Math.min(
      totalRows,
      Math.ceil((adjustedScrollTop + viewportHeight) / TRACK_ROW_HEIGHT) +
        TRACK_OVERSCAN
    );

    const visibleRows = tracks.slice(startIdx, endIdx);
    const topSpacerHeight = startIdx * TRACK_ROW_HEIGHT;
    const bottomSpacerHeight = Math.max(
      0,
      (totalRows - endIdx) * TRACK_ROW_HEIGHT
    );

    return (
      <table className="brutal-table">
        <thead>
          <tr>
            <th onClick={() => onSort('trackNumber')}>
              #{' '}
              {sortColumn === 'trackNumber'
                ? sortDirection === 'asc'
                  ? '▲'
                  : '▼'
                : ''}
            </th>
            <th onClick={() => onSort('title')}>
              TITLE{' '}
              {sortColumn === 'title'
                ? sortDirection === 'asc'
                  ? '▲'
                  : '▼'
                : ''}
            </th>
            <th onClick={() => onSort('artist')}>
              ARTIST{' '}
              {sortColumn === 'artist'
                ? sortDirection === 'asc'
                  ? '▲'
                  : '▼'
                : ''}
            </th>
            <th onClick={() => onSort('album')}>
              ALBUM{' '}
              {sortColumn === 'album'
                ? sortDirection === 'asc'
                  ? '▲'
                  : '▼'
                : ''}
            </th>
            <th onClick={() => onSort('genre')}>
              GENRE{' '}
              {sortColumn === 'genre'
                ? sortDirection === 'asc'
                  ? '▲'
                  : '▼'
                : ''}
            </th>
            <th onClick={() => onSort('rating')}>
              RATING ★{' '}
              {sortColumn === 'rating'
                ? sortDirection === 'asc'
                  ? '▲'
                  : '▼'
                : ''}
            </th>
            <th
              style={{ textAlign: 'right' }}
              onClick={() => onSort('duration')}
            >
              TIME{' '}
              {sortColumn === 'duration'
                ? sortDirection === 'asc'
                  ? '▲'
                  : '▼'
                : ''}
            </th>
          </tr>
        </thead>
        <tbody>
          {topSpacerHeight > 0 && (
            <tr style={{ height: `${topSpacerHeight}px` }}>
              <td
                colSpan={7}
                style={{ height: `${topSpacerHeight}px`, padding: 0, border: 0 }}
              />
            </tr>
          )}
          {visibleRows.map((track) => (
            <MemoizedTrackRow
              key={track.id}
              track={track}
              isActive={track.id === currentTrackId}
              onPlayFromTable={onPlayFromTable}
              onOpenLyrics={onOpenLyrics}
              onFilterArtist={onFilterArtist}
              onFilterAlbum={onFilterAlbum}
              onFilterGenre={onFilterGenre}
              onRateTrack={onRateTrack}
            />
          ))}
          {bottomSpacerHeight > 0 && (
            <tr style={{ height: `${bottomSpacerHeight}px` }}>
              <td
                colSpan={7}
                style={{
                  height: `${bottomSpacerHeight}px`,
                  padding: 0,
                  border: 0,
                }}
              />
            </tr>
          )}
          {totalRows === 0 && (
            <tr>
              <td
                colSpan={7}
                className="py-16 text-center text-xs text-[var(--text-dim)] font-bold uppercase"
              >
                {totalLibraryCount === 0
                  ? '[ LIBRARY EMPTY :: CLICK "+ MOUNT DIR" IN SIDEBAR ]'
                  : '[ NO TRACKS MATCH CURRENT FILTER ]'}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    );
  }
);

interface ArtistCatalogEntry {
  name: string;
  trackCount: number;
  albums: Set<string>;
  genres: Set<string>;
  coverUrl?: string;
  totalDuration: number;
  tracks: TrackItem[];
}

interface AlbumCatalogEntry {
  album: string;
  artist: string;
  year: number;
  genre: string;
  trackCount: number;
  coverUrl?: string;
  totalDuration: number;
  tracks: TrackItem[];
}

interface GenreCatalogEntry {
  genre: string;
  trackCount: number;
  artists: Set<string>;
  totalDuration: number;
  tracks: TrackItem[];
}

const MemoizedArtistsGrid = React.memo<{
  artists: ArtistCatalogEntry[];
  scrollTop: number;
  viewportHeight: number;
  onSelectArtist: (artist: string) => void;
  onPlayQueue: (firstTrack: TrackItem, queue: TrackItem[]) => void;
}>(({ artists, scrollTop, viewportHeight, onSelectArtist, onPlayQueue }) => {
  const maxVisible = Math.max(
    48,
    Math.ceil((scrollTop + viewportHeight) / 110) * 4 + 32
  );
  const visibleArtists = artists.slice(0, maxVisible);

  return (
    <div className="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {visibleArtists.map((art) => (
        <div
          key={art.name}
          onClick={() => onSelectArtist(art.name)}
          className="bg-[var(--bg-surface)] border-[3px] border-[var(--text-main)] p-4 cursor-pointer hover:border-[var(--accent)] transition-ui flex flex-col justify-between gap-3"
        >
          <div className="flex items-center gap-3">
            <AlbumArtwork
              coverUrl={art.coverUrl}
              album={art.name}
              artist={art.name}
              className="w-14 h-14 border-[2px] border-[var(--text-main)] shrink-0 grayscale"
            />
            <div className="min-w-0">
              <div className="text-sm font-extrabold text-[var(--text-main)] truncate uppercase">
                {art.name}
              </div>
              <div className="text-[11px] text-[var(--text-dim)] truncate mt-0.5">
                {Array.from(art.genres).join(' · ') || 'Unknown'}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between pt-2 border-t-[1px] border-[var(--text-dim)] text-xs">
            <span className="text-[var(--text-dim)] font-mono">
              {Math.max(1, Math.round(art.totalDuration / 60))} MIN
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (art.tracks.length > 0) {
                  onPlayQueue(art.tracks[0], art.tracks);
                }
              }}
              className="btn-brutal primary transition-ui px-2.5 py-0.5 text-[11px]"
            >
              PLAY
            </button>
          </div>
        </div>
      ))}
    </div>
  );
});

const MemoizedAlbumsGrid = React.memo<{
  albums: AlbumCatalogEntry[];
  scrollTop: number;
  viewportHeight: number;
  onSelectAlbum: (album: string) => void;
  onPlayQueue: (firstTrack: TrackItem, queue: TrackItem[]) => void;
}>(({ albums, scrollTop, viewportHeight, onSelectAlbum, onPlayQueue }) => {
  const maxVisible = Math.max(
    45,
    Math.ceil((scrollTop + viewportHeight) / 220) * 5 + 30
  );
  const visibleAlbums = albums.slice(0, maxVisible);

  return (
    <div className="p-5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
      {visibleAlbums.map((alb) => (
        <div
          key={`${alb.album}::${alb.artist}`}
          onClick={() => onSelectAlbum(alb.album)}
          className="bg-[var(--bg-surface)] border-[3px] border-[var(--text-main)] p-3 cursor-pointer hover:border-[var(--accent)] transition-ui flex flex-col justify-between"
        >
          <div>
            <div className="aspect-square mb-2.5 border-[2px] border-[var(--text-main)] overflow-hidden grayscale">
              <AlbumArtwork
                coverUrl={alb.coverUrl}
                album={alb.album}
                artist={alb.artist}
                className="w-full h-full"
              />
            </div>
            <div className="text-xs font-extrabold text-[var(--text-main)] truncate uppercase">
              {alb.album}
            </div>
            <div className="text-xs text-[var(--accent)] font-bold truncate mt-0.5">
              {alb.artist}
            </div>
          </div>

          <div className="flex items-center justify-between pt-2 mt-2 border-t-[1px] border-[var(--text-dim)] text-[11px] font-mono">
            <span className="text-[var(--text-dim)]">{alb.year}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (alb.tracks.length > 0) {
                  onPlayQueue(alb.tracks[0], alb.tracks);
                }
              }}
              className="btn-brutal primary transition-ui px-2 py-0.5 text-[10px]"
            >
              PLAY
            </button>
          </div>
        </div>
      ))}
    </div>
  );
});

const MemoizedGenresGrid = React.memo<{
  genres: GenreCatalogEntry[];
  onSelectGenre: (genre: string) => void;
  onPlayQueue: (firstTrack: TrackItem, queue: TrackItem[]) => void;
}>(({ genres, onSelectGenre, onPlayQueue }) => {
  return (
    <div className="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {genres.map((g) => (
        <div
          key={g.genre}
          onClick={() => onSelectGenre(g.genre)}
          className="bg-[var(--bg-surface)] border-[3px] border-[var(--text-main)] p-4 cursor-pointer hover:border-[var(--accent)] transition-ui flex flex-col justify-between gap-3"
        >
          <div>
            <div className="text-xs text-[var(--text-dim)] font-bold uppercase">
              GENRE
            </div>
            <div className="text-base font-extrabold text-[var(--accent)] uppercase mt-0.5 truncate">
              {g.genre}
            </div>
          </div>

          <div className="flex items-center justify-between pt-2 border-t-[1px] border-[var(--text-dim)] text-xs">
            <span className="text-[var(--text-dim)] font-mono">
              {Math.max(1, Math.round(g.totalDuration / 60))} MIN
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (g.tracks.length > 0) {
                  onPlayQueue(g.tracks[0], g.tracks);
                }
              }}
              className="btn-brutal primary transition-ui px-2.5 py-0.5 text-[11px]"
            >
              PLAY GENRE
            </button>
          </div>
        </div>
      ))}
    </div>
  );
});

export default function App() {
  const initialPlayerState = useMemo(
    () =>
      loadSavedPlayerState({
        currentTrackId: null,
        shuffle: false,
        repeatMode: 'off',
        sortColumn: 'trackNumber',
        sortDirection: 'asc',
      }),
    []
  );

  const [tracks, setTracks] = useState<TrackItem[]>([]);
  const [smartPlaylists, setSmartPlaylists] = useState<SmartPlaylist[]>(() =>
    loadSavedSmartPlaylists(createDefaultSmartPlaylists())
  );
  const [activePlaylistId, setActivePlaylistId] = useState<string>(() => {
    const loaded = loadSavedSmartPlaylists(createDefaultSmartPlaylists());
    return loaded[0]?.id || '';
  });
  const [history, setHistory] = useState<ListeningLogEntry[]>(() =>
    loadSavedHistory()
  );
  const [dsp, setDsp] = useState<DSPSettings>(() =>
    loadSavedDSP(createDefaultDSPSettings())
  );
  const [customPresets, setCustomPresets] = useState<EQPreset[]>(() =>
    loadSavedPresets()
  );
  const [theme, setTheme] = useState<ThemeConfig>(() => loadSavedTheme());
  const [overlay, setOverlay] = useState<OverlayConfig>(() =>
    loadSavedOverlayConfig()
  );
  const [discord, setDiscord] = useState<DiscordConfig>(() =>
    loadSavedDiscordConfig()
  );
  const [systemConfig, setSystemConfig] = useState<SystemConfig>(() =>
    loadSavedSystemConfig()
  );
  const [discordStatus, setDiscordStatus] = useState<string>('READY');
  const [minimizedToWebTray, setMinimizedToWebTray] = useState<boolean>(false);

  const [activeTab, setActiveTab] = useState<MainWorkspaceTab>('library');
  const [librarySubView, setLibrarySubView] =
    useState<LibrarySubView>('tracks');
  const [selectedArtistFilter, setSelectedArtistFilter] = useState<
    string | null
  >(null);
  const [selectedAlbumFilter, setSelectedAlbumFilter] = useState<string | null>(
    null
  );
  const [selectedGenreFilter, setSelectedGenreFilter] = useState<string | null>(
    null
  );
  const [ratingFilter, setRatingFilter] = useState<
    'all' | '5' | '4+' | '3+' | 'unrated'
  >('all');

  const [sortColumn, setSortColumn] = useState<SortColumn>(
    initialPlayerState.sortColumn
  );
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>(
    initialPlayerState.sortDirection
  );
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showInspector, setShowInspector] = useState<boolean>(false);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [scanStatus, setScanStatus] = useState<string>('');

  const [currentTrackId, setCurrentTrackId] = useState<string | null>(
    initialPlayerState.currentTrackId
  );
  const [playbackQueueIds, setPlaybackQueueIds] = useState<string[] | null>(
    null
  );
  const [isPlaying, setIsPlaying] = useState(false);
  const [shuffle, setShuffle] = useState<boolean>(initialPlayerState.shuffle);
  const [repeatMode, setRepeatMode] = useState<'off' | 'all' | 'one'>(
    initialPlayerState.repeatMode
  );

  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [seekRevision, setSeekRevision] = useState<number>(0);

  const tracklistWrapperRef = useRef<HTMLDivElement | null>(null);
  const [tracklistScrollTop, setTracklistScrollTop] = useState<number>(0);
  const [tracklistViewportHeight, setTracklistViewportHeight] =
    useState<number>(760);
  const scrollRafRef = useRef<number | null>(null);
  const lastUiTimeUpdateRef = useRef<number>(0);

  const [overlayPos, setOverlayPos] = useState<{ x: number; y: number }>({
    x: 28,
    y: 28,
  });
  const dragOffsetRef = useRef<{
    dragging: boolean;
    startX: number;
    startY: number;
  }>({
    dragging: false,
    startX: 0,
    startY: 0,
  });

  const folderInputRef = useRef<HTMLInputElement | null>(null);

  const scrobbleStateRef = useRef<{
    trackId: string | null;
    accumulatedSec: number;
    lastTickTime: number;
    loggedForCurrentPlay: boolean;
  }>({
    trackId: null,
    accumulatedSec: 0,
    lastTickTime: 0,
    loggedForCurrentPlay: false,
  });

  const handleTracklistScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const target = e.currentTarget;
      const top = target.scrollTop;
      const vh = target.clientHeight || 760;
      if (scrollRafRef.current !== null) return;
      scrollRafRef.current = window.requestAnimationFrame(() => {
        scrollRafRef.current = null;
        setTracklistScrollTop(top);
        setTracklistViewportHeight((prev) =>
          Math.abs(prev - vh) > 8 ? vh : prev
        );
      });
    },
    []
  );

  useEffect(() => {
    const updateSize = () => {
      if (tracklistWrapperRef.current) {
        setTracklistViewportHeight(
          tracklistWrapperRef.current.clientHeight || 760
        );
      }
    };
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => {
      window.removeEventListener('resize', updateSize);
      if (scrollRafRef.current !== null) {
        window.cancelAnimationFrame(scrollRafRef.current);
      }
    };
  }, [overlay.enabled, minimizedToWebTray]);

  // Reset scroll position when switching library views or filters
  useEffect(() => {
    if (tracklistWrapperRef.current) {
      tracklistWrapperRef.current.scrollTop = 0;
      setTracklistScrollTop(0);
    }
  }, [
    activeTab,
    librarySubView,
    selectedArtistFilter,
    selectedAlbumFilter,
    selectedGenreFilter,
    ratingFilter,
    searchQuery,
  ]);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--accent', theme.accent);
    root.style.setProperty('--bg-base', theme.bgBase);
    root.style.setProperty('--bg-surface', theme.bgSurface);
    root.style.setProperty('--text-main', theme.textMain);
    root.style.setProperty('--text-dim', theme.textDim);
    root.style.setProperty('--border-px', `${theme.borderThickness || 3}px`);

    if (theme.scanlines) {
      document.body.classList.remove('scanlines-off');
    } else {
      document.body.classList.add('scanlines-off');
    }
    saveThemeConfig(theme);
  }, [theme]);

  useEffect(() => {
    saveOverlayConfig(overlay);
    if (window.icejazzDesktop?.setOverlayMode) {
      window.icejazzDesktop.setOverlayMode(
        overlay.enabled,
        overlay.width,
        overlay.showVisualizer ? 240 : 170
      );
    }
  }, [overlay]);

  useEffect(() => {
    saveDiscordConfig(discord);
  }, [discord]);

  // Read OS login item settings on initial mount when running in desktop mode
  useEffect(() => {
    if (window.icejazzDesktop?.getAutostart) {
      window.icejazzDesktop
        .getAutostart()
        .then((res) => {
          if (res && typeof res.openAtLogin === 'boolean') {
            setSystemConfig({
              openAtLogin: res.openAtLogin,
              startInTray: Boolean(res.startInTray),
            });
          }
        })
        .catch(() => {});
    }
  }, []);

  const handleUpdateSystemConfig = useCallback((next: SystemConfig) => {
    setSystemConfig(next);
    saveSystemConfig(next);
    if (window.icejazzDesktop?.setAutostart) {
      window.icejazzDesktop
        .setAutostart(next)
        .then(() => {
          terminalLogger.log(
            'SYS',
            `Windows startup: ${next.openAtLogin ? 'ENABLED' : 'DISABLED'}${
              next.startInTray ? ' (Start in Tray)' : ''
            }`
          );
        })
        .catch((err) => {
          terminalLogger.log('ERR', `Autostart update failed: ${String(err)}`);
        });
    } else {
      terminalLogger.log(
        'SYS',
        `Startup preference saved: ${next.openAtLogin ? 'ON' : 'OFF'}`
      );
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    loadTracksFromStorage().then((restored) => {
      if (!mounted) return;
      if (restored.length > 0) {
        setTracks(restored);
      } else {
        terminalLogger.log(
          'SYS',
          'Library empty. Click [+ MOUNT DIR] in the sidebar to load audio files.'
        );
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    audioEngine.applyDSPSettings(dsp);
    saveDSPSettings(dsp);
  }, [dsp]);

  useEffect(() => {
    saveCustomPresets(customPresets);
  }, [customPresets]);

  useEffect(() => {
    saveSmartPlaylists(smartPlaylists);
  }, [smartPlaylists]);

  useEffect(() => {
    saveListeningHistory(history);
  }, [history]);

  useEffect(() => {
    savePlayerState({
      currentTrackId,
      shuffle,
      repeatMode,
      sortColumn:
        sortColumn === 'genre' || sortColumn === 'rating'
          ? 'trackNumber'
          : sortColumn,
      sortDirection,
    });
  }, [currentTrackId, shuffle, repeatMode, sortColumn, sortDirection]);

  // Fast O(1) track lookup map for 4000+ track libraries
  const tracksById = useMemo(() => {
    const map = new Map<string, TrackItem>();
    for (let i = 0; i < tracks.length; i++) {
      map.set(tracks[i].id, tracks[i]);
    }
    return map;
  }, [tracks]);

  const currentTrack = useMemo(
    () => (currentTrackId ? tracksById.get(currentTrackId) || null : null),
    [tracksById, currentTrackId]
  );

  // Sync Discord Rich Presence on track change, play/pause, seek, or config update
  useEffect(() => {
    let cancelled = false;
    const effectiveDur =
      duration > 0 ? duration : currentTrack?.duration || 0;

    const FALLBACK_DISCORD_ICON_URL =
      'https://raw.githubusercontent.com/github/explore/80688e429a7d4ef2fca1e82350fe8e3517d3494d/topics/music/music.png';

    const customKey = (discord.largeImageKey || '').trim();
    const isCustomRemoteUrl =
      customKey !== '' &&
      customKey !== 'icejazz_logo' &&
      (customKey.startsWith('https://') ||
        customKey.startsWith('http://') ||
        customKey.startsWith('mp:'));

    const initialImageUrl = isCustomRemoteUrl
      ? customKey
      : FALLBACK_DISCORD_ICON_URL;

    if (!discord.enabled) {
      setDiscordStatus('DISABLED');
      window.icejazzDesktop?.updateDiscordPresence?.({
        enabled: false,
        clientId: discord.clientId,
        showTimestamps: discord.showTimestamps,
        showWhenPaused: discord.showWhenPaused,
        largeImageKey: initialImageUrl,
        isPlaying: false,
        currentTime: 0,
        duration: 0,
      });
      return;
    }

    const sendPresence = (imageUrl: string) => {
      if (cancelled) return;
      if (window.icejazzDesktop?.updateDiscordPresence) {
        window.icejazzDesktop
          .updateDiscordPresence({
            enabled: discord.enabled,
            clientId: discord.clientId,
            showTimestamps: discord.showTimestamps,
            showWhenPaused: discord.showWhenPaused,
            largeImageKey: imageUrl,
            trackTitle: currentTrack?.title,
            artist: currentTrack?.artist,
            album: currentTrack?.album,
            format: currentTrack?.format,
            isPlaying,
            currentTime: audioEngine.getCurrentTime(),
            duration: effectiveDur,
          })
          .then((res) => {
            if (!cancelled && res?.status) {
              setDiscordStatus(res.status);
            }
          })
          .catch(() => {
            if (!cancelled) setDiscordStatus('IPC_OFFLINE');
          });
      } else {
        setDiscordStatus(currentTrack ? 'ACTIVE (PREVIEW)' : 'STANDBY');
      }
    };

    // Immediately send presence with fallback/custom HTTPS icon so Discord never shows an empty icon
    sendPresence(initialImageUrl);

    // If using default key and a track is loaded, query iTunes Search API for real HTTPS album cover
    if (!isCustomRemoteUrl && currentTrack) {
      const query = [
        currentTrack.artist,
        currentTrack.album && !/unknown/i.test(currentTrack.album)
          ? currentTrack.album
          : currentTrack.title,
      ]
        .filter((s) => s && !/unknown/i.test(s))
        .join(' ')
        .trim();

      if (query) {
        fetch(
          `https://itunes.apple.com/search?term=${encodeURIComponent(
            query
          )}&media=music&limit=1`
        )
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => {
            if (cancelled) return;
            const art = data?.results?.[0]?.artworkUrl100;
            if (typeof art === 'string' && art.startsWith('https://')) {
              const hiRes = art.replace('100x100bb', '512x512bb');
              sendPresence(hiRes);
            }
          })
          .catch(() => {
            // Keep FALLBACK_DISCORD_ICON_URL
          });
      }
    }

    if (currentTrack && isPlaying) {
      terminalLogger.log(
        'RPC',
        `Discord status -> Listening to IceJaZz: "${currentTrack.title}" by ${currentTrack.artist}`
      );
    }

    return () => {
      cancelled = true;
    };
  }, [
    currentTrack,
    isPlaying,
    discord,
    duration,
    seekRevision,
  ]);

  const artistsCatalog = useMemo(() => {
    const map = new Map<string, ArtistCatalogEntry>();
    for (let i = 0; i < tracks.length; i++) {
      const t = tracks[i];
      let existing = map.get(t.artist);
      if (!existing) {
        existing = {
          name: t.artist,
          trackCount: 0,
          albums: new Set<string>(),
          genres: new Set<string>(),
          coverUrl: t.coverUrl,
          totalDuration: 0,
          tracks: [],
        };
        map.set(t.artist, existing);
      }
      existing.trackCount += 1;
      existing.albums.add(t.album);
      if (t.genre && t.genre !== 'Unknown') existing.genres.add(t.genre);
      if (!existing.coverUrl && t.coverUrl) existing.coverUrl = t.coverUrl;
      existing.totalDuration += t.duration || 0;
      existing.tracks.push(t);
    }
    return Array.from(map.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }, [tracks]);

  const albumsCatalog = useMemo(() => {
    const map = new Map<string, AlbumCatalogEntry>();
    for (let i = 0; i < tracks.length; i++) {
      const t = tracks[i];
      const key = `${t.album}::${t.artist}`;
      let existing = map.get(key);
      if (!existing) {
        existing = {
          album: t.album,
          artist: t.artist,
          year: t.year,
          genre: t.genre,
          trackCount: 0,
          coverUrl: t.coverUrl,
          totalDuration: 0,
          tracks: [],
        };
        map.set(key, existing);
      }
      existing.trackCount += 1;
      if (!existing.coverUrl && t.coverUrl) existing.coverUrl = t.coverUrl;
      existing.totalDuration += t.duration || 0;
      existing.tracks.push(t);
    }
    return Array.from(map.values()).sort((a, b) =>
      a.album.localeCompare(b.album)
    );
  }, [tracks]);

  const genresCatalog = useMemo(() => {
    const map = new Map<string, GenreCatalogEntry>();
    for (let i = 0; i < tracks.length; i++) {
      const t = tracks[i];
      const g = t.genre || 'Unknown';
      let existing = map.get(g);
      if (!existing) {
        existing = {
          genre: g,
          trackCount: 0,
          artists: new Set<string>(),
          totalDuration: 0,
          tracks: [],
        };
        map.set(g, existing);
      }
      existing.trackCount += 1;
      existing.artists.add(t.artist);
      existing.totalDuration += t.duration || 0;
      existing.tracks.push(t);
    }
    return Array.from(map.values()).sort((a, b) => b.trackCount - a.trackCount);
  }, [tracks]);

  const filteredTracks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = tracks.filter((t) => {
      if (selectedArtistFilter && t.artist !== selectedArtistFilter)
        return false;
      if (selectedAlbumFilter && t.album !== selectedAlbumFilter) return false;
      if (selectedGenreFilter && t.genre !== selectedGenreFilter) return false;

      if (ratingFilter === '5' && t.rating < 5) return false;
      if (ratingFilter === '4+' && t.rating < 4) return false;
      if (ratingFilter === '3+' && t.rating < 3) return false;
      if (ratingFilter === 'unrated' && t.rating > 0) return false;

      if (q) {
        return (
          t.title.toLowerCase().includes(q) ||
          t.artist.toLowerCase().includes(q) ||
          t.album.toLowerCase().includes(q) ||
          t.genre.toLowerCase().includes(q) ||
          t.tags.some((tag) => tag.toLowerCase().includes(q))
        );
      }
      return true;
    });

    const dir = sortDirection === 'asc' ? 1 : -1;
    return list.sort((a, b) => {
      switch (sortColumn) {
        case 'trackNumber':
          return (a.trackNumber - b.trackNumber) * dir;
        case 'title':
          return a.title.localeCompare(b.title) * dir;
        case 'artist':
          return a.artist.localeCompare(b.artist) * dir;
        case 'genre':
          return a.genre.localeCompare(b.genre) * dir;
        case 'rating':
          return (a.rating - b.rating) * dir;
        case 'duration':
          return (a.duration - b.duration) * dir;
        default:
          return a.album.localeCompare(b.album) * dir;
      }
    });
  }, [
    tracks,
    sortColumn,
    sortDirection,
    searchQuery,
    selectedArtistFilter,
    selectedAlbumFilter,
    selectedGenreFilter,
    ratingFilter,
  ]);

  const activeQueue = useMemo(() => {
    if (playbackQueueIds && playbackQueueIds.length > 0) {
      const resolved: TrackItem[] = [];
      for (let i = 0; i < playbackQueueIds.length; i++) {
        const found = tracksById.get(playbackQueueIds[i]);
        if (found) resolved.push(found);
      }
      if (resolved.length > 0) return resolved;
    }
    return filteredTracks;
  }, [playbackQueueIds, tracksById, filteredTracks]);

  // O(1) index map for activeQueue so next/prev never scan 4000 items linearly
  const activeQueueIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    for (let i = 0; i < activeQueue.length; i++) {
      map.set(activeQueue[i].id, i);
    }
    return map;
  }, [activeQueue]);

  const recordTrackPlay = useCallback(
    (track: TrackItem, listenedSeconds: number) => {
      const nowIso = new Date().toISOString();
      const logEntry: ListeningLogEntry = {
        id: `play-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        trackId: track.id,
        title: track.title,
        artist: track.artist,
        album: track.album,
        genre: track.genre,
        format: track.format,
        sampleRate: track.sampleRate,
        durationListened: Math.max(
          1,
          Math.round(listenedSeconds || track.duration || 30)
        ),
        timestamp: nowIso,
      };

      setHistory((prev) => [logEntry, ...prev]);

      setTracks((prev) =>
        prev.map((t) => {
          if (t.id !== track.id) return t;
          const updated: TrackItem = {
            ...t,
            playCount: (t.playCount || 0) + 1,
            lastPlayed: nowIso,
          };
          updateSingleTrackMetadataInStorage(updated);
          return updated;
        })
      );

      terminalLogger.log(
        'SCROBBLE',
        `Logged play for "${track.title}" (${Math.round(
          logEntry.durationListened
        )}s)`
      );
    },
    []
  );

  useEffect(() => {
    const unsubscribe = audioEngine.subscribeTimeUpdate((time, dur) => {
      if (
        Math.abs(time - lastUiTimeUpdateRef.current) >= 0.5 ||
        time < 0.25
      ) {
        lastUiTimeUpdateRef.current = time;
        setCurrentTime(time);
      }
      if (dur && Number.isFinite(dur) && dur > 0) {
        setDuration((prevDur) => (Math.abs(prevDur - dur) > 1.0 ? dur : prevDur));
      }

      const st = scrobbleStateRef.current;
      if (currentTrack && st.trackId === currentTrack.id) {
        const delta = time - st.lastTickTime;
        if (delta > 0 && delta < 2.5) {
          st.accumulatedSec += delta;
        }
        st.lastTickTime = time;

        if (!st.loggedForCurrentPlay && st.accumulatedSec >= 30) {
          st.loggedForCurrentPlay = true;
          recordTrackPlay(currentTrack, Math.max(30, st.accumulatedSec));
        }
      }
    });
    return unsubscribe;
  }, [currentTrack, recordTrackPlay]);

  const playTrack = useCallback(
    async (
      track: TrackItem,
      isCrossfade = false,
      customQueue?: TrackItem[]
    ) => {
      if (customQueue && customQueue.length > 0) {
        setPlaybackQueueIds(customQueue.map((t) => t.id));
      }
      setCurrentTrackId(track.id);
      lastUiTimeUpdateRef.current = 0;
      setCurrentTime(0);
      setDuration(track.duration || 0);

      scrobbleStateRef.current = {
        trackId: track.id,
        accumulatedSec: 0,
        lastTickTime: 0,
        loggedForCurrentPlay: false,
      };

      await audioEngine.playTrack(track, isCrossfade);
    },
    []
  );

  const handlePlayFromLibraryTable = useCallback(
    (track: TrackItem) => {
      setPlaybackQueueIds(null);
      playTrack(track, false);
    },
    [playTrack]
  );

  const handlePlayQueue = useCallback(
    (firstTrack: TrackItem, queue: TrackItem[]) => {
      playTrack(firstTrack, false, queue);
    },
    [playTrack]
  );

  const handleOpenLyricsFromRow = useCallback((trackId: string) => {
    setCurrentTrackId(trackId);
    setActiveTab('lyrics');
  }, []);

  const handleTogglePlay = useCallback(async () => {
    if (!currentTrack && activeQueue.length > 0) {
      await playTrack(activeQueue[0], false);
      return;
    }
    if (
      currentTrack &&
      (audioEngine.getLoadedTrackId() !== currentTrack.id ||
        (audioEngine.getCurrentTime() === 0 && !isPlaying))
    ) {
      await playTrack(currentTrack, false);
      return;
    }
    await audioEngine.togglePlay();
  }, [currentTrack, activeQueue, isPlaying, playTrack]);

  const handleNextTrack = useCallback(
    (isCrossfade = false, isNaturalEnd = false) => {
      if (
        isNaturalEnd &&
        currentTrack &&
        scrobbleStateRef.current.trackId === currentTrack.id &&
        !scrobbleStateRef.current.loggedForCurrentPlay &&
        scrobbleStateRef.current.accumulatedSec >=
          Math.min(10, (currentTrack.duration || 10) * 0.7)
      ) {
        scrobbleStateRef.current.loggedForCurrentPlay = true;
        recordTrackPlay(currentTrack, currentTrack.duration || 30);
      }

      if (activeQueue.length === 0) return;

      if (isNaturalEnd && repeatMode === 'one' && currentTrack) {
        playTrack(currentTrack, false);
        return;
      }

      if (shuffle && activeQueue.length > 1) {
        let randIdx = Math.floor(Math.random() * activeQueue.length);
        if (activeQueue[randIdx]?.id === currentTrackId) {
          randIdx = (randIdx + 1) % activeQueue.length;
        }
        playTrack(activeQueue[randIdx] || activeQueue[0], isCrossfade);
        return;
      }

      const idx = currentTrackId
        ? (activeQueueIndexMap.get(currentTrackId) ?? -1)
        : -1;
      if (idx === -1 || idx + 1 >= activeQueue.length) {
        if (isNaturalEnd && repeatMode === 'off') {
          setIsPlaying(false);
          terminalLogger.log('PLAY', 'End of queue reached (repeat off).');
          return;
        }
        playTrack(activeQueue[0], isCrossfade);
      } else {
        playTrack(activeQueue[idx + 1], isCrossfade);
      }
    },
    [
      activeQueue,
      activeQueueIndexMap,
      currentTrack,
      currentTrackId,
      repeatMode,
      shuffle,
      playTrack,
      recordTrackPlay,
    ]
  );

  const handlePrevTrack = useCallback(() => {
    if (activeQueue.length === 0) return;
    if (audioEngine.getCurrentTime() > 3 && currentTrack) {
      audioEngine.seek(0);
      setSeekRevision((r) => r + 1);
      return;
    }
    const idx = currentTrackId
      ? (activeQueueIndexMap.get(currentTrackId) ?? -1)
      : -1;
    if (idx > 0) playTrack(activeQueue[idx - 1], false);
    else playTrack(activeQueue[activeQueue.length - 1], false);
  }, [
    activeQueue,
    activeQueueIndexMap,
    currentTrack,
    currentTrackId,
    playTrack,
  ]);

  useEffect(() => {
    audioEngine.setLifecycleCallbacks(
      () => handleNextTrack(false, true),
      () => handleNextTrack(true, true),
      (playing) => setIsPlaying(playing)
    );
  }, [handleNextTrack]);

  useEffect(() => {
    if (!window.icejazzDesktop?.onTrayCommand) return;
    const unsub = window.icejazzDesktop.onTrayCommand((cmd) => {
      if (cmd === 'play-pause') handleTogglePlay();
      else if (cmd === 'next') handleNextTrack(false, false);
      else if (cmd === 'prev') handlePrevTrack();
      else if (cmd === 'toggle-overlay') {
        setOverlay((prev) => ({ ...prev, enabled: !prev.enabled }));
      }
    });
    return unsub;
  }, [handleTogglePlay, handleNextTrack, handlePrevTrack]);

  const handleMinimizeToTray = useCallback(async () => {
    if (window.icejazzDesktop?.minimizeToTray) {
      await window.icejazzDesktop.minimizeToTray();
      terminalLogger.log('SYS', 'Window minimized to system tray.');
    } else {
      setMinimizedToWebTray(true);
      terminalLogger.log('SYS', 'Minimized to compact tray bar.');
    }
  }, []);

  const mergeParsedTracksIntoLibrary = useCallback(
    (parsedTracks: TrackItem[]) => {
      if (parsedTracks.length === 0) {
        terminalLogger.log(
          'WARN',
          'No supported audio files found in selected directory.'
        );
        return;
      }

      setTracks((prev) => {
        const map = new Map<string, TrackItem>();
        const unlinkedByNameAndSize = new Map<string, string>();

        for (const existing of prev) {
          map.set(existing.id, existing);
          if (!existing.nativeFilePath && existing.fileName) {
            unlinkedByNameAndSize.set(
              `${existing.fileName}::${existing.fileSizeMB}`,
              existing.id
            );
          }
        }

        for (const incoming of parsedTracks) {
          let prevMatch = map.get(incoming.id);
          if (!prevMatch && incoming.fileName) {
            const oldUnlinkedId = unlinkedByNameAndSize.get(
              `${incoming.fileName}::${incoming.fileSizeMB}`
            );
            if (oldUnlinkedId) {
              prevMatch = map.get(oldUnlinkedId);
              map.delete(oldUnlinkedId);
            }
          }

          const cleanAudioUrl = incoming.audioUrl?.startsWith('blob:')
            ? incoming.audioUrl
            : undefined;

          if (prevMatch) {
            map.set(incoming.id, {
              ...incoming,
              audioUrl: cleanAudioUrl,
              rating: prevMatch.rating,
              lyrics: incoming.lyrics || prevMatch.lyrics,
              tags: Array.from(
                new Set([...prevMatch.tags, ...incoming.tags])
              ),
              playCount: prevMatch.playCount,
              lastPlayed: prevMatch.lastPlayed,
            });
          } else {
            map.set(incoming.id, {
              ...incoming,
              audioUrl: cleanAudioUrl,
            });
          }
        }

        const merged = Array.from(map.values());
        saveTracksToStorage(merged);
        terminalLogger.log(
          'IO',
          `Indexed ${parsedTracks.length} tracks (${merged.length} total in library).`
        );
        return merged;
      });
    },
    []
  );

  const handleMountDirectory = useCallback(async () => {
    if (isScanning) return;
    if (window.icejazzDesktop?.scanDirectoryNative) {
      setIsScanning(true);
      setScanStatus('SELECTING...');
      const unsub = window.icejazzDesktop.onScanProgress?.((prog) => {
        setScanStatus(`INDEXING ${prog.done}/${prog.total}`);
      });
      try {
        const res = await window.icejazzDesktop.scanDirectoryNative();
        if (!res.canceled) {
          mergeParsedTracksIntoLibrary(res.tracks || []);
        }
        return;
      } catch {
        // Fallback to standard file input if preload/main IPC is from an older session
      } finally {
        unsub?.();
        setIsScanning(false);
        setScanStatus('');
      }
    }
    folderInputRef.current?.click();
  }, [isScanning, mergeParsedTracksIntoLibrary]);

  const handleFolderSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    setIsScanning(true);
    setScanStatus('SCANNING...');
    try {
      const parsedTracks = await processDirectoryFiles(
        fileList,
        (done, total) => {
          setScanStatus(`INDEXING ${done}/${total}`);
        }
      );
      mergeParsedTracksIntoLibrary(parsedTracks);
    } finally {
      setIsScanning(false);
      setScanStatus('');
      if (folderInputRef.current) folderInputRef.current.value = '';
    }
  };

  const handleClearLibrary = useCallback(async () => {
    audioEngine.pause();
    setIsPlaying(false);
    setCurrentTrackId(null);
    setTracks([]);
    setPlaybackQueueIds(null);
    await clearLibraryStorage();
  }, []);

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextTime = Number(e.target.value);
    setCurrentTime(nextTime);
    scrobbleStateRef.current.lastTickTime = nextTime;
    audioEngine.seek(nextTime);
    setSeekRevision((r) => r + 1);
  };

  const handleSeekToSeconds = useCallback((seconds: number) => {
    setCurrentTime(seconds);
    scrobbleStateRef.current.lastTickTime = seconds;
    audioEngine.seek(seconds);
    setSeekRevision((r) => r + 1);
  }, []);

  const handleVolumeWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const step = e.deltaY < 0 ? 0.05 : -0.05;
    const nextVol = Math.max(
      0,
      Math.min(1, Number((dsp.volume + step).toFixed(2)))
    );
    setDsp((prev) => ({ ...prev, volume: nextVol, muted: nextVol === 0 }));
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextVol = Math.max(0, Math.min(1, parseFloat(e.target.value)));
    setDsp((prev) => ({ ...prev, volume: nextVol, muted: nextVol === 0 }));
  };

  const handleToggleMute = () => {
    setDsp((prev) => {
      const nextMuted = !prev.muted;
      terminalLogger.log(
        'DSP',
        nextMuted
          ? 'Audio muted.'
          : `Audio unmuted (${Math.round(prev.volume * 100)}%).`
      );
      return { ...prev, muted: nextMuted };
    });
  };

  const handleSort = useCallback((col: SortColumn) => {
    setSortColumn((prevCol) => {
      if (prevCol === col) {
        setSortDirection((prevDir) => (prevDir === 'asc' ? 'desc' : 'asc'));
        return prevCol;
      }
      setSortDirection('asc');
      return col;
    });
  }, []);

  const handleSelectPlaylist = useCallback((id: string) => {
    setActivePlaylistId(id);
  }, []);

  const handleUpdatePlaylist = useCallback((updated: SmartPlaylist) => {
    setSmartPlaylists((prev) =>
      prev.map((pl) => (pl.id === updated.id ? updated : pl))
    );
  }, []);

  const handleCreatePlaylist = useCallback(() => {
    const newPl: SmartPlaylist = {
      id: `sp-${Date.now()}`,
      name: `Custom Playlist #${smartPlaylists.length + 1}`,
      description: 'Dynamic smart playlist',
      rootLogic: 'AND',
      groups: [
        {
          id: `grp-${Date.now()}`,
          logic: 'AND',
          rules: [
            {
              id: `rule-${Date.now()}`,
              field: 'rating',
              operator: 'gte',
              value: 4,
            },
          ],
        },
      ],
      sortBy: 'rating',
      sortOrder: 'desc',
    };
    setSmartPlaylists((prev) => [...prev, newPl]);
    setActivePlaylistId(newPl.id);
    terminalLogger.log('FILTER', `Created playlist "${newPl.name}".`);
  }, [smartPlaylists.length]);

  const handleDeletePlaylist = useCallback(
    (id: string) => {
      setSmartPlaylists((prev) => {
        const next = prev.filter((p) => p.id !== id);
        if (activePlaylistId === id) {
          setActivePlaylistId(next[0]?.id || '');
        }
        return next;
      });
      terminalLogger.log('FILTER', `Deleted playlist ${id}.`);
    },
    [activePlaylistId]
  );

  const handleUpdateTrackTags = useCallback(
    (trackId: string, tags: string[]) => {
      setTracks((prev) =>
        prev.map((t) => {
          if (t.id !== trackId) return t;
          const updated = { ...t, tags };
          updateSingleTrackMetadataInStorage(updated);
          return updated;
        })
      );
      terminalLogger.log('IO', `Tags updated: [${tags.join(', ')}]`);
    },
    []
  );

  const handleUpdateTrackRating = useCallback(
    (trackId: string, rating: number) => {
      setTracks((prev) =>
        prev.map((t) => {
          if (t.id !== trackId) return t;
          const updated = { ...t, rating };
          updateSingleTrackMetadataInStorage(updated);
          return updated;
        })
      );
      terminalLogger.log(
        'IO',
        `Track rating updated: ${rating > 0 ? `${rating}★` : 'Unrated'}.`
      );
    },
    []
  );

  const handleSaveLyrics = useCallback((trackId: string, lyrics: string) => {
    setTracks((prev) =>
      prev.map((t) => {
        if (t.id !== trackId) return t;
        const nextTags = lyrics.trim()
          ? Array.from(new Set([...t.tags, 'Lyrics']))
          : t.tags.filter((tg) => tg !== 'Lyrics');
        const updated = { ...t, lyrics, tags: nextTags };
        updateSingleTrackMetadataInStorage(updated);
        return updated;
      })
    );
    terminalLogger.log('META', `Lyrics saved for track ${trackId}.`);
  }, []);

  const handleTerminalCommand = useCallback(
    (rawCmd: string) => {
      const parts = rawCmd.trim().split(/\s+/);
      const cmd = parts[0].toLowerCase();
      const arg = parts.slice(1).join(' ');

      switch (cmd) {
        case 'help':
          terminalLogger.log(
            'SYS',
            'COMMANDS: play | pause | next | prev | vol <0-100> | mute | shuf | rep | eq <preset> | theme <name> | discord | overlay | tray | lyrics | status | mount | clear | nuke'
          );
          break;
        case 'play':
        case 'pause':
          handleTogglePlay();
          break;
        case 'next':
          handleNextTrack(false, false);
          break;
        case 'prev':
          handlePrevTrack();
          break;
        case 'vol': {
          const v = Number(arg);
          if (!Number.isNaN(v) && v >= 0 && v <= 100) {
            setDsp((prev) => ({
              ...prev,
              volume: Number((v / 100).toFixed(2)),
              muted: v === 0,
            }));
            terminalLogger.log('DSP', `Volume set to ${Math.round(v)}%`);
          } else {
            terminalLogger.log('WARN', 'Usage: vol <0-100>');
          }
          break;
        }
        case 'mute':
          handleToggleMute();
          break;
        case 'shuf':
          setShuffle((prev) => {
            terminalLogger.log('PLAY', `Shuffle: ${!prev ? 'ON' : 'OFF'}`);
            return !prev;
          });
          break;
        case 'rep':
          setRepeatMode((prev) => {
            const next =
              prev === 'off' ? 'all' : prev === 'all' ? 'one' : 'off';
            terminalLogger.log('PLAY', `Repeat mode: ${next.toUpperCase()}`);
            return next;
          });
          break;
        case 'eq': {
          const allPresets = [...BUILTIN_EQ_PRESETS, ...customPresets];
          const found = allPresets.find(
            (p) =>
              p.id.toLowerCase() === arg.toLowerCase() ||
              p.name.toLowerCase().includes(arg.toLowerCase())
          );
          if (found) {
            setDsp((prev) => ({
              ...prev,
              preamp: found.preamp,
              bands: prev.bands.map((b, i) => ({
                ...b,
                gain: found.gains[i] ?? 0,
              })),
              activePresetId: found.id,
            }));
            terminalLogger.log(
              'DSP',
              `EQ preset: ${found.name.toUpperCase()}`
            );
          } else {
            terminalLogger.log(
              'WARN',
              `Available presets: ${allPresets.map((p) => p.id).join(', ')}`
            );
          }
          break;
        }
        case 'theme': {
          const matchedTheme = BUILTIN_THEMES.find(
            (t) =>
              t.id.toLowerCase().includes(arg.toLowerCase()) ||
              t.name.toLowerCase().includes(arg.toLowerCase())
          );
          if (matchedTheme) {
            setTheme(matchedTheme);
            terminalLogger.log('SYS', `Theme applied: ${matchedTheme.name}`);
          } else {
            terminalLogger.log(
              'WARN',
              `Themes: ${BUILTIN_THEMES.map((t) => t.id).join(', ')}`
            );
          }
          break;
        }
        case 'discord':
          setDiscord((prev) => {
            const nextEnabled = !prev.enabled;
            terminalLogger.log(
              'RPC',
              `Discord Rich Presence: ${nextEnabled ? 'ENABLED' : 'DISABLED'}`
            );
            return { ...prev, enabled: nextEnabled };
          });
          break;
        case 'overlay':
          setOverlay((prev) => ({ ...prev, enabled: !prev.enabled }));
          break;
        case 'tray':
          handleMinimizeToTray();
          break;
        case 'lyrics':
          setActiveTab('lyrics');
          break;
        case 'mount':
        case 'scan':
          handleMountDirectory();
          break;
        case 'inspect':
          setShowInspector((prev) => !prev);
          break;
        case 'status':
          terminalLogger.log(
            'SYS',
            `TRACKS=${tracks.length} | ARTISTS=${artistsCatalog.length} | ALBUMS=${albumsCatalog.length} | GENRES=${genresCatalog.length} | VOL=${Math.round(
              dsp.volume * 100
            )}% | DISCORD=${discordStatus}`
          );
          break;
        case 'clear':
          terminalLogger.clear();
          break;
        case 'nuke':
          handleClearLibrary();
          break;
        default:
          terminalLogger.log(
            'WARN',
            `Unknown command "${cmd}". Type "help" for available commands.`
          );
      }
    },
    [
      albumsCatalog.length,
      artistsCatalog.length,
      customPresets,
      discordStatus,
      dsp.volume,
      genresCatalog.length,
      handleClearLibrary,
      handleMinimizeToTray,
      handleMountDirectory,
      handleNextTrack,
      handlePrevTrack,
      handleTogglePlay,
      tracks.length,
    ]
  );

  const handleOverlayMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button, input')) return;
    dragOffsetRef.current = {
      dragging: true,
      startX: e.clientX - overlayPos.x,
      startY: e.clientY - overlayPos.y,
    };
  };

  useEffect(() => {
    if (!overlay.enabled) return;
    const onMove = (e: MouseEvent) => {
      if (!dragOffsetRef.current.dragging) return;
      setOverlayPos({
        x: Math.max(
          8,
          Math.min(
            window.innerWidth - 200,
            e.clientX - dragOffsetRef.current.startX
          )
        ),
        y: Math.max(
          8,
          Math.min(
            window.innerHeight - 100,
            e.clientY - dragOffsetRef.current.startY
          )
        ),
      });
    };
    const onUp = () => {
      dragOffsetRef.current.dragging = false;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [overlay.enabled]);

  const effectiveDuration =
    duration > 0 ? duration : currentTrack?.duration || 0;
  const progressPercent =
    effectiveDuration > 0
      ? Math.min(100, (currentTime / effectiveDuration) * 100)
      : 0;

  const activeLyricSnippet = useMemo(
    () => getActiveLyricLine(currentTrack?.lyrics, currentTime),
    [currentTrack?.lyrics, currentTime]
  );

  if (minimizedToWebTray) {
    return (
      <div className="fixed inset-0 bg-black/90 flex items-end justify-end p-6 z-50">
        <div className="border-[3px] border-[var(--text-main)] bg-[var(--bg-surface)] p-4 w-96 shadow-2xl space-y-3">
          <div className="flex items-center justify-between border-b-[1px] border-[var(--text-dim)] pb-2">
            <span className="text-xs font-extrabold text-[var(--accent)]">
              [TRAY :: ICEJAZZ]
            </span>
            <button
              type="button"
              onClick={() => setMinimizedToWebTray(false)}
              className="btn-brutal primary transition-ui px-2.5 py-0.5 text-[11px]"
            >
              RESTORE
            </button>
          </div>

          <div className="flex items-center gap-3">
            {currentTrack?.coverUrl && (
              <img
                src={currentTrack.coverUrl}
                alt="Cover"
                className="w-11 h-11 object-cover border border-[var(--text-main)] grayscale shrink-0"
              />
            )}
            <div className="min-w-0 flex-1">
              <div className="text-xs font-bold text-[var(--text-main)] truncate">
                {currentTrack ? currentTrack.title : 'No active track'}
              </div>
              <div className="text-[11px] text-[var(--text-dim)] truncate">
                {currentTrack ? currentTrack.artist : 'Standby'}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={handlePrevTrack}
              className="btn-brutal transition-ui text-xs"
            >
              &lt;&lt;
            </button>
            <button
              type="button"
              onClick={handleTogglePlay}
              className="btn-brutal primary transition-ui flex-1 text-xs"
            >
              {isPlaying ? 'PAUSE' : 'PLAY'}
            </button>
            <button
              type="button"
              onClick={() => handleNextTrack(false, false)}
              className="btn-brutal transition-ui text-xs"
            >
              &gt;&gt;
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (overlay.enabled) {
    return (
      <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-4">
        <div
          onMouseDown={handleOverlayMouseDown}
          style={{
            width: `${overlay.width}px`,
            maxWidth: '96vw',
            opacity: overlay.opacity,
            left: window.icejazzDesktop?.isDesktopApp
              ? undefined
              : `${overlayPos.x}px`,
            top: window.icejazzDesktop?.isDesktopApp
              ? undefined
              : `${overlayPos.y}px`,
            position: window.icejazzDesktop?.isDesktopApp
              ? 'relative'
              : 'fixed',
          }}
          className="border-[3px] border-[var(--text-main)] bg-[var(--bg-surface)] shadow-2xl select-none cursor-move overflow-hidden"
        >
          <div className="window-drag-region flex items-center justify-between px-3 py-1.5 bg-[var(--bg-base)] border-b-[3px] border-[var(--text-main)]">
            <span className="text-[10px] font-extrabold text-[var(--accent)] uppercase">
              [ICEJAZZ OVERLAY]
            </span>
            <div className="window-no-drag flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setOverlay((prev) => ({ ...prev, enabled: false }));
                  setActiveTab('config');
                }}
                className="text-[10px] font-bold px-1.5 py-0.5 border border-[var(--text-dim)] text-[var(--text-dim)] hover:text-[var(--text-main)] cursor-pointer"
              >
                [CFG]
              </button>
              <button
                type="button"
                onClick={() =>
                  setOverlay((prev) => ({ ...prev, enabled: false }))
                }
                className="text-[10px] font-extrabold px-2 py-0.5 bg-[var(--accent)] text-[var(--text-dark)] cursor-pointer"
              >
                [EXPAND]
              </button>
            </div>
          </div>

          <div className="p-3.5 space-y-3">
            <div className="flex items-center gap-3">
              {overlay.showCover && (
                <div className="w-14 h-14 border-[2px] border-[var(--text-main)] bg-[var(--bg-base)] shrink-0 overflow-hidden">
                  {currentTrack?.coverUrl ? (
                    <img
                      src={currentTrack.coverUrl}
                      alt="Cover"
                      className="w-full h-full object-cover grayscale"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[var(--accent)] text-[10px] font-bold">
                      IJZ
                    </div>
                  )}
                </div>
              )}

              <div className="min-w-0 flex-1">
                <div className="text-xs font-extrabold text-[var(--text-main)] truncate uppercase">
                  {currentTrack ? currentTrack.title : 'No active track'}
                </div>
                <div className="text-[11px] font-bold text-[var(--accent)] truncate">
                  {currentTrack
                    ? `${currentTrack.artist} — ${currentTrack.album}`
                    : 'Select a track'}
                </div>

                {overlay.showRating && currentTrack && (
                  <div className="flex items-center gap-1 mt-1 window-no-drag font-mono">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        type="button"
                        onClick={() =>
                          handleUpdateTrackRating(
                            currentTrack.id,
                            currentTrack.rating === star ? 0 : star
                          )
                        }
                        className={`text-sm cursor-pointer ${
                          star <= currentTrack.rating
                            ? 'text-[var(--accent)]'
                            : 'text-[var(--text-dim)]'
                        }`}
                      >
                        ★
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {overlay.showLyricsLine && activeLyricSnippet && (
              <div className="px-2.5 py-1.5 bg-[var(--bg-base)] border-[1px] border-[var(--text-dim)] text-xs font-bold text-[var(--accent)] truncate text-center">
                {activeLyricSnippet}
              </div>
            )}

            {overlay.showVisualizer && (
              <div className="h-14 border-[2px] border-[var(--text-main)] overflow-hidden window-no-drag">
                <VisualizerRack
                  isPlaying={isPlaying}
                  sampleRate={currentTrack?.sampleRate}
                  bitDepth={currentTrack?.bitDepth}
                  format={currentTrack?.format}
                  compactFooter
                />
              </div>
            )}

            {overlay.showProgress && (
              <div className="progress-row window-no-drag">
                <span className="text-[11px]">{formatTime(currentTime)}</span>
                <div className="progress-track h-4">
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
                  <div
                    className="progress-fill"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                <span className="text-[11px]">
                  {formatTime(effectiveDuration)}
                </span>
              </div>
            )}

            <div className="flex items-center justify-between gap-2 window-no-drag">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handlePrevTrack}
                  className="btn-brutal transition-ui px-2.5 py-1 text-xs"
                >
                  &lt;&lt;
                </button>
                <button
                  type="button"
                  onClick={handleTogglePlay}
                  className="btn-brutal primary transition-ui px-3.5 py-1 text-xs"
                >
                  {isPlaying ? 'PAUSE' : 'PLAY'}
                </button>
                <button
                  type="button"
                  onClick={() => handleNextTrack(false, false)}
                  className="btn-brutal transition-ui px-2.5 py-1 text-xs"
                >
                  &gt;&gt;
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleToggleMute}
                  className="text-xs font-bold text-[var(--text-dim)] hover:text-[var(--text-main)] cursor-pointer"
                >
                  {dsp.muted ? 'MUTE' : `${Math.round(dsp.volume * 100)}%`}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={dsp.muted ? 0 : dsp.volume}
                  onChange={handleVolumeChange}
                  className="studio-slider w-20"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <input
        ref={folderInputRef}
        type="file"
        multiple
        // @ts-expect-error standard directory attribute
        webkitdirectory=""
        directory=""
        onChange={handleFolderSelect}
        className="hidden"
      />

      {/* Custom Frameless Window Header */}
      <header className="top-nav window-drag-region">
        <div className="brand-block transition-ui">
          {"ICE\nJAZZ\nAUDIO"}
        </div>

        <nav className="tabs-container window-no-drag">
          <button
            onClick={() => setActiveTab('library')}
            className={`tab transition-ui ${
              activeTab === 'library' ? 'active' : ''
            }`}
          >
            Library
          </button>
          <button
            onClick={() => setActiveTab('lyrics')}
            className={`tab transition-ui ${
              activeTab === 'lyrics' ? 'active' : ''
            }`}
          >
            Lyrics
          </button>
          <button
            onClick={() => setActiveTab('smart-playlists')}
            className={`tab transition-ui ${
              activeTab === 'smart-playlists' ? 'active' : ''
            }`}
          >
            Smart Playlists
          </button>
          <button
            onClick={() => setActiveTab('equalizer')}
            className={`tab transition-ui ${
              activeTab === 'equalizer' ? 'active' : ''
            }`}
          >
            Equalizer
          </button>
          <button
            onClick={() => setActiveTab('year-review')}
            className={`tab transition-ui ${
              activeTab === 'year-review' ? 'active' : ''
            }`}
          >
            Stats
          </button>
          <button
            onClick={() => setActiveTab('config')}
            className={`tab transition-ui ${
              activeTab === 'config' ? 'active' : ''
            }`}
          >
            Config
          </button>
        </nav>

        {/* Custom Window Frame & Utility Controls */}
        <div className="window-no-drag flex items-center gap-1.5 px-2.5 border-l-[3px] border-[var(--text-main)] bg-[var(--bg-base)] shrink-0">
          <button
            type="button"
            onClick={() => setShowInspector((prev) => !prev)}
            className={`btn-brutal transition-ui px-2 py-1 text-[11px] ${
              showInspector ? 'primary' : ''
            }`}
            title="Toggle Inspector Panel"
          >
            [INFO]
          </button>

          <button
            type="button"
            onClick={() =>
              setOverlay((prev) => ({ ...prev, enabled: !prev.enabled }))
            }
            className="btn-brutal transition-ui px-2 py-1 text-[11px]"
            title="Toggle Overlay Mode"
          >
            [OVR]
          </button>

          <button
            type="button"
            onClick={handleMinimizeToTray}
            className="btn-brutal transition-ui px-2 py-1 text-[11px]"
            title="Minimize to System Tray"
          >
            [TRAY]
          </button>

          {window.icejazzDesktop?.isDesktopApp && (
            <>
              <button
                type="button"
                onClick={() => window.icejazzDesktop?.minimizeWindow?.()}
                className="btn-brutal transition-ui px-2 py-1 text-[11px]"
                title="Minimize Window"
              >
                _
              </button>
              <button
                type="button"
                onClick={() => window.icejazzDesktop?.toggleMaximize?.()}
                className="btn-brutal transition-ui px-2 py-1 text-[11px]"
                title="Maximize Window"
              >
                □
              </button>
              <button
                type="button"
                onClick={() => window.icejazzDesktop?.quitApp?.()}
                className="btn-brutal transition-ui px-2 py-1 text-[11px] hover:bg-red-600 hover:text-white"
                title="Close Window"
              >
                ✕
              </button>
            </>
          )}
        </div>
      </header>

      <main className="workspace">
        <aside className="sidebar">
          <div className="album-art-zone">
            <div className="art-label">
              <span>Current_Track</span>
              {currentTrack && (
                <span className="text-[var(--accent)]">
                  {currentTrack.genre} · {currentTrack.year}
                </span>
              )}
            </div>
            <div className="art-placeholder transition-ui">
              {currentTrack?.coverUrl ? (
                <img
                  src={currentTrack.coverUrl}
                  alt="Cover"
                  className="w-full h-full object-cover grayscale"
                />
              ) : (
                "+-------------------+\n| \\ \\ \\ \\ \\ \\ \\ \\ \\ |\n|  \\ \\ \\ \\ \\ \\ \\ \\  |\n|   I C E           |\n|   J A Z Z         |\n|  / / / / / / / /  |\n| / / / / / / / / / |\n+-------------------+"
              )}
            </div>
          </div>

          <div className="track-meta-detailed">
            <div className="meta-row">
              <span className="meta-key">Track / Album</span>
              <span className="meta-val" title={currentTrack?.title}>
                {currentTrack
                  ? `${currentTrack.title} (${currentTrack.album})`
                  : 'None'}
              </span>
            </div>
            <div className="meta-row">
              <span className="meta-key">Artist / Genre</span>
              <span className="meta-val">
                {currentTrack
                  ? `${currentTrack.artist} · ${currentTrack.genre}`
                  : 'Standby'}
              </span>
            </div>

            <div className="flex items-center justify-between py-0.5">
              <span className="meta-key">Rating ★</span>
              <div className="flex items-center gap-1 font-mono">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    disabled={!currentTrack}
                    onClick={() => {
                      if (!currentTrack) return;
                      handleUpdateTrackRating(
                        currentTrack.id,
                        currentTrack.rating === star ? 0 : star
                      );
                    }}
                    className={`text-sm cursor-pointer disabled:opacity-30 hover:scale-110 transition-transform ${
                      currentTrack && star <= currentTrack.rating
                        ? 'text-[var(--accent)]'
                        : 'text-[var(--text-dim)]'
                    }`}
                  >
                    ★
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-1 flex items-center gap-2">
              <button
                onClick={handleMountDirectory}
                disabled={isScanning}
                className="btn-brutal primary flex-1 transition-ui"
              >
                {isScanning ? scanStatus || 'SCANNING...' : '+ MOUNT DIR'}
              </button>
              {tracks.length > 0 && (
                <button
                  onClick={handleClearLibrary}
                  className="btn-brutal transition-ui hover:text-red-500 px-2.5"
                  title="Clear Library"
                >
                  [RESET]
                </button>
              )}
            </div>
          </div>

          <TerminalConsole onCommand={handleTerminalCommand} />
        </aside>

        <section className="main-view">
          <div
            ref={tracklistWrapperRef}
            onScroll={handleTracklistScroll}
            className="tracklist-wrapper"
          >
            {activeTab === 'library' && (
              <div className="flex flex-col min-h-full">
                {/* Library Sub-Navigation without icons or counters */}
                <div className="sticky top-0 z-20 bg-[var(--bg-surface)] border-b-[3px] border-[var(--text-main)] p-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setLibrarySubView('tracks');
                        setSelectedArtistFilter(null);
                        setSelectedAlbumFilter(null);
                        setSelectedGenreFilter(null);
                      }}
                      className={`btn-brutal transition-ui text-xs ${
                        librarySubView === 'tracks' &&
                        !selectedArtistFilter &&
                        !selectedAlbumFilter &&
                        !selectedGenreFilter
                          ? 'primary'
                          : ''
                      }`}
                    >
                      ALL TRACKS
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setLibrarySubView('artists');
                        setSelectedArtistFilter(null);
                        setSelectedAlbumFilter(null);
                        setSelectedGenreFilter(null);
                      }}
                      className={`btn-brutal transition-ui text-xs ${
                        librarySubView === 'artists' || selectedArtistFilter
                          ? 'primary'
                          : ''
                      }`}
                    >
                      ARTISTS
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setLibrarySubView('albums');
                        setSelectedArtistFilter(null);
                        setSelectedAlbumFilter(null);
                        setSelectedGenreFilter(null);
                      }}
                      className={`btn-brutal transition-ui text-xs ${
                        librarySubView === 'albums' || selectedAlbumFilter
                          ? 'primary'
                          : ''
                      }`}
                    >
                      ALBUMS
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setLibrarySubView('genres');
                        setSelectedArtistFilter(null);
                        setSelectedAlbumFilter(null);
                        setSelectedGenreFilter(null);
                      }}
                      className={`btn-brutal transition-ui text-xs ${
                        librarySubView === 'genres' || selectedGenreFilter
                          ? 'primary'
                          : ''
                      }`}
                    >
                      GENRES
                    </button>
                  </div>

                  {/* Quick Rating Filter & Search */}
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-1 bg-[var(--bg-base)] p-1 border-[1px] border-[var(--text-dim)]">
                      <span className="text-[10px] font-bold text-[var(--text-dim)] px-1 uppercase">
                        Rating:
                      </span>
                      {(
                        [
                          { id: 'all', label: 'All' },
                          { id: '5', label: '5★' },
                          { id: '4+', label: '4★+' },
                          { id: '3+', label: '3★+' },
                          { id: 'unrated', label: 'Unrated' },
                        ] as const
                      ).map((rf) => (
                        <button
                          key={rf.id}
                          type="button"
                          onClick={() => setRatingFilter(rf.id)}
                          className={`px-2 py-0.5 text-[11px] font-mono font-bold cursor-pointer transition-ui ${
                            ratingFilter === rf.id
                              ? 'bg-[var(--accent)] text-[var(--text-dark)]'
                              : 'text-[var(--text-main)] hover:text-[var(--accent)]'
                          }`}
                        >
                          {rf.label}
                        </button>
                      ))}
                    </div>

                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search tracks, artists, genres..."
                      className="w-56 px-2.5 py-1 text-xs bg-[var(--bg-base)] border-[1px] border-[var(--text-dim)] text-[var(--text-main)] focus:outline-none focus:border-[var(--accent)] font-mono"
                    />
                  </div>
                </div>

                {/* Active Drill-down Banner */}
                {(selectedArtistFilter ||
                  selectedAlbumFilter ||
                  selectedGenreFilter) && (
                  <div className="bg-[var(--bg-base)] border-b-[3px] border-[var(--text-main)] px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-xs font-bold">
                      <span className="text-[var(--text-dim)] uppercase">
                        FILTER:
                      </span>
                      {selectedArtistFilter && (
                        <span className="text-[var(--accent)]">
                          ARTIST: {selectedArtistFilter}
                        </span>
                      )}
                      {selectedAlbumFilter && (
                        <span className="text-[var(--accent)]">
                          ALBUM: {selectedAlbumFilter}
                        </span>
                      )}
                      {selectedGenreFilter && (
                        <span className="text-[var(--accent)]">
                          GENRE: {selectedGenreFilter}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {filteredTracks.length > 0 && (
                        <button
                          type="button"
                          onClick={() =>
                            handlePlayFromLibraryTable(filteredTracks[0])
                          }
                          className="btn-brutal primary transition-ui text-xs"
                        >
                          PLAY ALL
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedArtistFilter(null);
                          setSelectedAlbumFilter(null);
                          setSelectedGenreFilter(null);
                        }}
                        className="btn-brutal transition-ui text-xs"
                      >
                        BACK
                      </button>
                    </div>
                  </div>
                )}

                {/* Artists Catalog Grid (Memoized + Progressive Scroll Windowing) */}
                {librarySubView === 'artists' && !selectedArtistFilter && (
                  <MemoizedArtistsGrid
                    artists={artistsCatalog}
                    scrollTop={tracklistScrollTop}
                    viewportHeight={tracklistViewportHeight}
                    onSelectArtist={setSelectedArtistFilter}
                    onPlayQueue={handlePlayQueue}
                  />
                )}

                {/* Albums Catalog Grid (Memoized + Progressive Scroll Windowing) */}
                {librarySubView === 'albums' && !selectedAlbumFilter && (
                  <MemoizedAlbumsGrid
                    albums={albumsCatalog}
                    scrollTop={tracklistScrollTop}
                    viewportHeight={tracklistViewportHeight}
                    onSelectAlbum={setSelectedAlbumFilter}
                    onPlayQueue={handlePlayQueue}
                  />
                )}

                {/* Genres Catalog Grid (Memoized) */}
                {librarySubView === 'genres' && !selectedGenreFilter && (
                  <MemoizedGenresGrid
                    genres={genresCatalog}
                    onSelectGenre={setSelectedGenreFilter}
                    onPlayQueue={handlePlayQueue}
                  />
                )}

                {/* Virtualized Tracks Table (renders only visible rows in viewport) */}
                {(librarySubView === 'tracks' ||
                  selectedArtistFilter ||
                  selectedAlbumFilter ||
                  selectedGenreFilter) && (
                  <VirtualizedTrackTable
                    tracks={filteredTracks}
                    totalLibraryCount={tracks.length}
                    currentTrackId={currentTrackId}
                    sortColumn={sortColumn}
                    sortDirection={sortDirection}
                    scrollTop={tracklistScrollTop}
                    viewportHeight={tracklistViewportHeight}
                    onSort={handleSort}
                    onPlayFromTable={handlePlayFromLibraryTable}
                    onOpenLyrics={handleOpenLyricsFromRow}
                    onFilterArtist={setSelectedArtistFilter}
                    onFilterAlbum={setSelectedAlbumFilter}
                    onFilterGenre={setSelectedGenreFilter}
                    onRateTrack={handleUpdateTrackRating}
                  />
                )}
              </div>
            )}

            {activeTab === 'lyrics' && (
              <LyricsView
                track={currentTrack}
                currentTime={currentTime}
                onSeek={handleSeekToSeconds}
                onSaveLyrics={handleSaveLyrics}
              />
            )}

            {activeTab === 'smart-playlists' && (
              <SmartPlaylistView
                tracks={tracks}
                playlists={smartPlaylists}
                activePlaylistId={activePlaylistId}
                onSelectPlaylist={handleSelectPlaylist}
                onUpdatePlaylist={handleUpdatePlaylist}
                onCreatePlaylist={handleCreatePlaylist}
                onDeletePlaylist={handleDeletePlaylist}
                onPlayTrack={(track, queue) => playTrack(track, false, queue)}
                onUpdateTrackRating={handleUpdateTrackRating}
                currentTrackId={currentTrackId || undefined}
              />
            )}

            {activeTab === 'equalizer' && (
              <EqualizerView
                dsp={dsp}
                customPresets={customPresets}
                onChangeDSP={(nextDsp) => {
                  setDsp(nextDsp);
                  terminalLogger.log(
                    'DSP',
                    `EQ updated (preset=${nextDsp.activePresetId}, preamp=${nextDsp.preamp}dB)`
                  );
                }}
                onSavePreset={(p) => {
                  setCustomPresets((prev) => [...prev, p]);
                  terminalLogger.log(
                    'DSP',
                    `Saved EQ preset "${p.name.toUpperCase()}"`
                  );
                }}
              />
            )}

            {activeTab === 'year-review' && (
              <YearInReviewView
                history={history}
                tracks={tracks}
                onImportHistory={(h) => {
                  setHistory((prev) => [...h, ...prev]);
                  terminalLogger.log('IO', 'Imported listening history.');
                }}
                onClearHistory={() => {
                  setHistory([]);
                  terminalLogger.log('IO', 'Listening history cleared.');
                }}
                onPlayTrack={(track, queue) => playTrack(track, false, queue)}
              />
            )}

            {activeTab === 'config' && (
              <CustomizationView
                theme={theme}
                overlay={overlay}
                discord={discord}
                systemConfig={systemConfig}
                discordStatus={discordStatus}
                currentTrack={currentTrack}
                isPlaying={isPlaying}
                currentTime={currentTime}
                duration={effectiveDuration}
                onChangeTheme={(nextTheme) => {
                  setTheme(nextTheme);
                  terminalLogger.log('SYS', `Theme applied: ${nextTheme.name}`);
                }}
                onChangeOverlay={(nextOverlay) => {
                  setOverlay(nextOverlay);
                }}
                onChangeDiscord={(nextDiscord) => {
                  setDiscord(nextDiscord);
                }}
                onChangeSystemConfig={handleUpdateSystemConfig}
                onReconnectDiscord={() => {
                  if (window.icejazzDesktop?.reconnectDiscord) {
                    window.icejazzDesktop
                      .reconnectDiscord()
                      .then((res) => {
                        if (res?.status) setDiscordStatus(res.status);
                        terminalLogger.log(
                          'RPC',
                          `Discord IPC reconnect -> ${res?.status || 'OK'}`
                        );
                      })
                      .catch(() => setDiscordStatus('IPC_OFFLINE'));
                  } else {
                    setSeekRevision((r) => r + 1);
                  }
                }}
              />
            )}
          </div>

          {showInspector && (
            <ArtistInspector
              activeTrack={currentTrack}
              isPlaying={isPlaying}
              history={history}
              onUpdateTrackTags={handleUpdateTrackTags}
              onUpdateTrackRating={handleUpdateTrackRating}
              onSelectTrackById={(trackId) => {
                const found = tracks.find((t) => t.id === trackId);
                if (found) playTrack(found, false);
              }}
            />
          )}
        </section>
      </main>

      <footer className="player-footer z-20">
        <div className="visualizer-block transition-ui">
          <VisualizerRack
            isPlaying={isPlaying}
            sampleRate={currentTrack?.sampleRate}
            bitDepth={currentTrack?.bitDepth}
            format={currentTrack?.format}
            compactFooter
          />
        </div>

        <div className="controls-block">
          <div className="action-row">
            <button
              onClick={() => {
                setShuffle((prev) => {
                  terminalLogger.log('PLAY', `Shuffle: ${!prev ? 'ON' : 'OFF'}`);
                  return !prev;
                });
              }}
              className={`btn-brutal transition-ui ${shuffle ? 'primary' : ''}`}
            >
              [SHUF]
            </button>
            <button
              onClick={handlePrevTrack}
              disabled={!currentTrack && tracks.length === 0}
              className="btn-brutal transition-ui"
            >
              &lt;&lt;
            </button>
            <button
              onClick={handleTogglePlay}
              disabled={!currentTrack && tracks.length === 0}
              className="btn-brutal primary transition-ui"
            >
              {isPlaying ? 'PAUSE' : 'PLAY'}
            </button>
            <button
              onClick={() => handleNextTrack(false, false)}
              disabled={!currentTrack && tracks.length === 0}
              className="btn-brutal transition-ui"
            >
              &gt;&gt;
            </button>
            <button
              onClick={() =>
                setRepeatMode((prev) => {
                  const next =
                    prev === 'off' ? 'all' : prev === 'all' ? 'one' : 'off';
                  terminalLogger.log(
                    'PLAY',
                    `Repeat mode -> ${next.toUpperCase()}`
                  );
                  return next;
                })
              }
              className={`btn-brutal transition-ui ${
                repeatMode !== 'off' ? 'primary' : ''
              }`}
            >
              {repeatMode === 'one' ? '[REP:1]' : '[REP]'}
            </button>

            {currentTrack?.lyrics && (
              <button
                type="button"
                onClick={() => setActiveTab('lyrics')}
                className={`btn-brutal transition-ui ml-auto ${
                  activeTab === 'lyrics' ? 'primary' : ''
                }`}
              >
                [LYRICS]
              </button>
            )}
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
              <div
                className="progress-fill transition-ui"
                style={{ width: `${progressPercent}%` }}
              ></div>
            </div>
            <span>{formatTime(effectiveDuration)}</span>
          </div>
        </div>

        <div
          className="sys-status-block"
          onWheel={handleVolumeWheel}
          title="Mouse wheel or slider to adjust volume"
        >
          <div className="sys-row">
            <button
              type="button"
              onClick={handleToggleMute}
              className="text-[var(--text-dim)] hover:text-[var(--text-main)] cursor-pointer font-bold"
              title="Toggle Mute"
            >
              {dsp.muted ? 'MUTE' : 'VOL'}
            </button>
            <span className="sys-val">
              {dsp.muted ? 'MUTE' : `${Math.round(dsp.volume * 100)}%`}
            </span>
          </div>

          <div className="py-0.5">
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={dsp.muted ? 0 : dsp.volume}
              onChange={handleVolumeChange}
              className="studio-slider w-full"
            />
          </div>

          <div className="sys-row">
            <span>FMT</span>
            <span className="sys-val" style={{ color: 'var(--accent)' }}>
              {currentTrack
                ? `${currentTrack.format} · ${currentTrack.bitrate}k`
                : 'IDLE'}
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
