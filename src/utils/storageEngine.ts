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
} from '../types/audio';
import { terminalLogger } from './terminalLogger';

const DB_NAME = 'IceJaZzAudioDB';
const DB_VERSION = 2;
const STORE_TRACKS = 'tracks';
const STORE_BLOBS = 'audio_blobs';
const STORE_HANDLES = 'dir_handles';

let activeStorageWriteGen = 0;

const LS_KEYS = {
  DSP: 'ijz_dsp_settings_v1',
  PRESETS: 'ijz_eq_presets_v1',
  PLAYLISTS: 'ijz_smart_playlists_v3',
  HISTORY: 'ijz_listening_history_v1',
  PLAYER_STATE: 'ijz_player_state_v1',
  THEME: 'ijz_theme_config_v2',
  OVERLAY: 'ijz_overlay_config_v1',
  DISCORD: 'ijz_discord_config_v1',
  SYSTEM: 'ijz_system_config_v1',
};

export const BUILTIN_THEMES: ThemeConfig[] = [
  {
    id: 'amber-gold',
    name: 'Amber Gold (Default)',
    accent: '#b49a1f',
    bgBase: '#000000',
    bgSurface: '#0a0a0a',
    textMain: '#f3f4f6',
    textDim: '#6b7280',
    scanlines: true,
    borderThickness: 3,
  },
  {
    id: 'ice-cyan',
    name: 'IceJaZz Cyan',
    accent: '#06b6d4',
    bgBase: '#020609',
    bgSurface: '#09131c',
    textMain: '#f0f9ff',
    textDim: '#64748b',
    scanlines: false,
    borderThickness: 2,
  },
  {
    id: 'cyber-emerald',
    name: 'Phosphor Matrix',
    accent: '#10b981',
    bgBase: '#020806',
    bgSurface: '#07130e',
    textMain: '#ecfdf5',
    textDim: '#4b7a67',
    scanlines: true,
    borderThickness: 3,
  },
  {
    id: 'crimson-red',
    name: 'Crimson Studio',
    accent: '#ef4444',
    bgBase: '#050202',
    bgSurface: '#110707',
    textMain: '#f9fafb',
    textDim: '#7f6262',
    scanlines: true,
    borderThickness: 3,
  },
  {
    id: 'violet-synth',
    name: 'Midnight Violet',
    accent: '#a855f7',
    bgBase: '#050209',
    bgSurface: '#10081c',
    textMain: '#faf5ff',
    textDim: '#7e6b93',
    scanlines: true,
    borderThickness: 3,
  },
  {
    id: 'mono-paper',
    name: 'Stark Monochrome',
    accent: '#ffffff',
    bgBase: '#000000',
    bgSurface: '#121212',
    textMain: '#e5e7eb',
    textDim: '#737373',
    scanlines: false,
    borderThickness: 3,
  },
];

export function createDefaultThemeConfig(): ThemeConfig {
  return BUILTIN_THEMES[0];
}

export function createDefaultOverlayConfig(): OverlayConfig {
  return {
    enabled: false,
    opacity: 0.94,
    width: 460,
    showCover: true,
    showVisualizer: true,
    showLyricsLine: true,
    showProgress: true,
    showRating: true,
    alwaysOnTop: true,
  };
}

export function createDefaultDiscordConfig(): DiscordConfig {
  return {
    enabled: true,
    clientId: '1129859263741837373',
    showTimestamps: true,
    showWhenPaused: true,
    largeImageKey: 'icejazz_logo',
  };
}

export function createDefaultSystemConfig(): SystemConfig {
  return {
    openAtLogin: false,
    startInTray: false,
  };
}

export interface PersistedPlayerState {
  currentTrackId: string | null;
  shuffle: boolean;
  repeatMode: 'off' | 'all' | 'one';
  sortColumn: 'trackNumber' | 'title' | 'artist' | 'album' | 'duration';
  sortDirection: 'asc' | 'desc';
}

interface StoredTrackRecord extends Omit<TrackItem, 'fileBlob' | 'audioUrl'> {
  coverDataUrl?: string;
}

interface StoredBlobRecord {
  id: string;
  blob: Blob;
  coverBlob?: Blob;
  nativeFilePath?: string;
}

function isPersistableCoverUrl(url?: string): boolean {
  if (!url) return false;
  if (
    url.startsWith('local-audio://') ||
    url.startsWith('http://') ||
    url.startsWith('https://')
  ) {
    return true;
  }
  if (url.startsWith('data:') && url.length <= 200000) {
    return true;
  }
  return false;
}

function dataUrlToBlobUrl(dataUrl: string): string {
  if (!dataUrl.startsWith('data:')) return dataUrl;
  try {
    const commaIdx = dataUrl.indexOf(',');
    if (commaIdx === -1) return dataUrl;
    const header = dataUrl.slice(0, commaIdx);
    const base64 = dataUrl.slice(commaIdx + 1);
    const mimeMatch = header.match(/data:([^;]+)/);
    const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return URL.createObjectURL(new Blob([bytes], { type: mime }));
  } catch {
    return dataUrl;
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_TRACKS)) {
        db.createObjectStore(STORE_TRACKS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_BLOBS)) {
        db.createObjectStore(STORE_BLOBS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_HANDLES)) {
        db.createObjectStore(STORE_HANDLES, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveTracksToStorage(tracks: TrackItem[]): Promise<void> {
  const myGen = ++activeStorageWriteGen;
  try {
    const db = await openDatabase();
    const META_BATCH_SIZE = 500;

    // 1. Save lightweight metadata records in fast batches
    for (let i = 0; i < tracks.length; i += META_BATCH_SIZE) {
      if (myGen !== activeStorageWriteGen) {
        db.close();
        return;
      }
      const slice = tracks.slice(i, i + META_BATCH_SIZE);
      const tx = db.transaction([STORE_TRACKS], 'readwrite');
      const trackStore = tx.objectStore(STORE_TRACKS);

      for (const track of slice) {
        const { fileBlob, audioUrl, ...serializableMeta } = track;
        const record: StoredTrackRecord = {
          ...serializableMeta,
          coverUrl: isPersistableCoverUrl(track.coverUrl)
            ? track.coverUrl
            : undefined,
        };
        trackStore.put(record);
      }

      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });

      if (i + META_BATCH_SIZE < tracks.length) {
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    // 2. For any tracks that do NOT have nativeFilePath, persist their File reference in STORE_BLOBS
    // in gentle background batches so playback after restart works even in browser / fallback mode.
    const tracksNeedingBlobs = tracks.filter(
      (t) => !t.nativeFilePath && t.fileBlob && t.fileBlob.size > 0
    );

    const BLOB_BATCH_SIZE = 40;
    for (let i = 0; i < tracksNeedingBlobs.length; i += BLOB_BATCH_SIZE) {
      if (myGen !== activeStorageWriteGen) {
        db.close();
        return;
      }
      const slice = tracksNeedingBlobs.slice(i, i + BLOB_BATCH_SIZE);
      const tx = db.transaction([STORE_BLOBS], 'readwrite');
      const blobStore = tx.objectStore(STORE_BLOBS);

      for (const track of slice) {
        if (track.fileBlob) {
          const blobRec: StoredBlobRecord = {
            id: track.id,
            blob: track.fileBlob,
          };
          blobStore.put(blobRec);
        }
      }

      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });

      if (i + BLOB_BATCH_SIZE < tracksNeedingBlobs.length) {
        await new Promise((r) => setTimeout(r, 12));
      }
    }

    db.close();
  } catch (err) {
    terminalLogger.log('ERR', `IDB_SYNC write error: ${String(err)}`);
  }
}

export async function loadTrackBlobById(trackId: string): Promise<Blob | null> {
  try {
    const db = await openDatabase();
    const tx = db.transaction([STORE_BLOBS], 'readonly');
    const blobStore = tx.objectStore(STORE_BLOBS);
    const rec: StoredBlobRecord | undefined = await new Promise(
      (resolve, reject) => {
        const req = blobStore.get(trackId);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }
    );
    db.close();
    if (rec && rec.blob && rec.blob.size > 0) {
      return rec.blob;
    }
    return null;
  } catch {
    return null;
  }
}

export async function updateSingleTrackMetadataInStorage(
  track: TrackItem
): Promise<void> {
  try {
    const db = await openDatabase();
    const tx = db.transaction([STORE_TRACKS], 'readwrite');
    const trackStore = tx.objectStore(STORE_TRACKS);
    const { fileBlob, audioUrl, ...serializableMeta } = track;
    trackStore.put({
      ...serializableMeta,
      coverUrl: isPersistableCoverUrl(track.coverUrl)
        ? track.coverUrl
        : undefined,
    });
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (err) {
    terminalLogger.log('ERR', `IDB_META update failed: ${String(err)}`);
  }
}

export async function loadTracksFromStorage(): Promise<TrackItem[]> {
  try {
    const db = await openDatabase();
    const tx = db.transaction([STORE_TRACKS], 'readonly');
    const trackStore = tx.objectStore(STORE_TRACKS);

    const metaList: StoredTrackRecord[] = await new Promise(
      (resolve, reject) => {
        const req = trackStore.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      }
    );

    db.close();

    // Automatically heal any tracks saved in previous sessions that lacked nativeFilePath
    let healedPathsMap: Record<string, string> = {};
    if (window.icejazzDesktop?.resolveMissingPaths && metaList.length > 0) {
      const missingItems = metaList
        .filter((m) => !m.nativeFilePath && m.fileName)
        .map((m) => ({
          id: m.id,
          fileName: m.fileName,
          folderPath: m.folderPath,
        }));

      if (missingItems.length > 0) {
        try {
          healedPathsMap =
            (await window.icejazzDesktop.resolveMissingPaths(missingItems)) ||
            {};
        } catch {
          healedPathsMap = {};
        }
      }
    }

    const coverDedupMap = new Map<string, string>();
    const restored: TrackItem[] = new Array(metaList.length);
    const healedTracksToPersist: TrackItem[] = [];

    for (let i = 0; i < metaList.length; i++) {
      const meta = metaList[i];
      const albumKey = `${meta.artist}::${meta.album}`;
      let coverUrl = coverDedupMap.get(albumKey);

      if (!coverUrl && meta.coverUrl) {
        coverUrl = meta.coverUrl.startsWith('data:')
          ? dataUrlToBlobUrl(meta.coverUrl)
          : meta.coverUrl;
        coverDedupMap.set(albumKey, coverUrl);
      }

      const resolvedNativePath =
        meta.nativeFilePath || healedPathsMap[meta.id] || undefined;

      const item: TrackItem = {
        ...meta,
        nativeFilePath: resolvedNativePath,
        coverUrl,
        audioUrl: undefined,
      };
      restored[i] = item;

      if (!meta.nativeFilePath && resolvedNativePath) {
        healedTracksToPersist.push(item);
      }
    }

    if (healedTracksToPersist.length > 0) {
      saveTracksToStorage(restored);
      terminalLogger.log(
        'IO',
        `Auto-linked native disk paths for ${healedTracksToPersist.length} restored tracks.`
      );
    }

    if (restored.length > 0) {
      terminalLogger.log(
        'IO',
        `Restored ${restored.length} tracks from IndexedDB storage.`
      );
    }
    return restored;
  } catch (err) {
    terminalLogger.log('ERR', `IDB_LOAD failure: ${String(err)}`);
    return [];
  }
}

export async function clearLibraryStorage(): Promise<void> {
  activeStorageWriteGen++;
  try {
    const db = await openDatabase();
    const tx = db.transaction(
      [STORE_TRACKS, STORE_BLOBS, STORE_HANDLES],
      'readwrite'
    );
    tx.objectStore(STORE_TRACKS).clear();
    tx.objectStore(STORE_BLOBS).clear();
    tx.objectStore(STORE_HANDLES).clear();
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    terminalLogger.log('IO', 'Local audio library storage cleared.');
  } catch (err) {
    terminalLogger.log('ERR', `IDB_PURGE error: ${String(err)}`);
  }
}

export function loadLocalJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function saveLocalJson<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore quota errors
  }
}

export function loadSavedDSP(fallback: DSPSettings): DSPSettings {
  return loadLocalJson<DSPSettings>(LS_KEYS.DSP, fallback);
}

export function saveDSPSettings(dsp: DSPSettings): void {
  saveLocalJson(LS_KEYS.DSP, dsp);
}

export function loadSavedPresets(): EQPreset[] {
  return loadLocalJson<EQPreset[]>(LS_KEYS.PRESETS, []);
}

export function saveCustomPresets(presets: EQPreset[]): void {
  saveLocalJson(LS_KEYS.PRESETS, presets);
}

export function loadSavedSmartPlaylists(
  fallback: SmartPlaylist[]
): SmartPlaylist[] {
  const loaded = loadLocalJson<SmartPlaylist[]>(LS_KEYS.PLAYLISTS, []);
  return loaded.length > 0 ? loaded : fallback;
}

export function saveSmartPlaylists(playlists: SmartPlaylist[]): void {
  saveLocalJson(LS_KEYS.PLAYLISTS, playlists);
}

export function loadSavedHistory(): ListeningLogEntry[] {
  return loadLocalJson<ListeningLogEntry[]>(LS_KEYS.HISTORY, []);
}

export function saveListeningHistory(history: ListeningLogEntry[]): void {
  saveLocalJson(LS_KEYS.HISTORY, history);
}

export function loadSavedPlayerState(
  fallback: PersistedPlayerState
): PersistedPlayerState {
  return loadLocalJson<PersistedPlayerState>(LS_KEYS.PLAYER_STATE, fallback);
}

export function savePlayerState(state: PersistedPlayerState): void {
  saveLocalJson(LS_KEYS.PLAYER_STATE, state);
}

export function loadSavedTheme(): ThemeConfig {
  return loadLocalJson<ThemeConfig>(LS_KEYS.THEME, createDefaultThemeConfig());
}

export function saveThemeConfig(theme: ThemeConfig): void {
  saveLocalJson(LS_KEYS.THEME, theme);
}

export function loadSavedOverlayConfig(): OverlayConfig {
  return loadLocalJson<OverlayConfig>(
    LS_KEYS.OVERLAY,
    createDefaultOverlayConfig()
  );
}

export function saveOverlayConfig(cfg: OverlayConfig): void {
  saveLocalJson(LS_KEYS.OVERLAY, cfg);
}

export function loadSavedDiscordConfig(): DiscordConfig {
  const loaded = loadLocalJson<DiscordConfig>(
    LS_KEYS.DISCORD,
    createDefaultDiscordConfig()
  );
  if (
    !loaded.clientId ||
    loaded.clientId.trim() === '' ||
    loaded.clientId.trim() === '1298643829104820224' ||
    loaded.clientId.trim() === '463151177836658699'
  ) {
    loaded.clientId = '1129859263741837373';
  }
  return loaded;
}

export function saveDiscordConfig(cfg: DiscordConfig): void {
  saveLocalJson(LS_KEYS.DISCORD, cfg);
}

export function loadSavedSystemConfig(): SystemConfig {
  return loadLocalJson<SystemConfig>(
    LS_KEYS.SYSTEM,
    createDefaultSystemConfig()
  );
}

export function saveSystemConfig(cfg: SystemConfig): void {
  saveLocalJson(LS_KEYS.SYSTEM, cfg);
}
