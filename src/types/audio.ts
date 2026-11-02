export type AudioFormat = 'FLAC' | 'WAV' | 'ALAC' | 'MP3' | 'OGG' | 'AAC';

export interface TrackItem {
  id: string;
  title: string;
  artist: string;
  album: string;
  genre: string;
  year: number;
  trackNumber: number;
  duration: number;
  format: AudioFormat;
  sampleRate: number;
  bitDepth: number;
  bitrate: number;
  channels: number;
  fileSizeMB: number;
  fileName: string;
  folderPath: string;
  nativeFilePath?: string;
  coverUrl?: string;
  audioUrl?: string;
  fileBlob?: Blob;
  lyrics?: string;
  rating: number;
  tags: string[];
  playCount: number;
  lastPlayed?: string;
  addedAt: string;
}

export interface EQBand {
  frequency: number;
  label: string;
  gain: number;
  type: BiquadFilterType;
}

export interface EQPreset {
  id: string;
  name: string;
  preamp: number;
  gains: number[];
  isCustom?: boolean;
}

export interface DSPSettings {
  enabled: boolean;
  preamp: number;
  bands: EQBand[];
  activePresetId: string;
  crossfadeSeconds: number;
  stereoBalance: number;
  volume: number;
  muted: boolean;
}

export type RuleField =
  | 'title'
  | 'artist'
  | 'album'
  | 'genre'
  | 'format'
  | 'year'
  | 'rating'
  | 'playCount'
  | 'sampleRate'
  | 'bitDepth'
  | 'bitrate'
  | 'duration'
  | 'folderPath'
  | 'tags';

export type RuleOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'between';

export interface SmartRule {
  id: string;
  field: RuleField;
  operator: RuleOperator;
  value: string | number;
  valueSecond?: string | number;
}

export interface SmartRuleGroup {
  id: string;
  logic: 'AND' | 'OR';
  rules: SmartRule[];
}

export interface SmartPlaylist {
  id: string;
  name: string;
  description: string;
  rootLogic: 'AND' | 'OR';
  groups: SmartRuleGroup[];
  sortBy: keyof TrackItem;
  sortOrder: 'asc' | 'desc';
  limit?: number;
}

export interface ListeningLogEntry {
  id: string;
  trackId: string;
  title: string;
  artist: string;
  album: string;
  genre: string;
  format: AudioFormat;
  sampleRate: number;
  durationListened: number;
  timestamp: string;
}

export interface ArtistReleaseItem {
  title: string;
  year: string;
  type: string;
}

export interface ArtistBioData {
  name: string;
  country?: string;
  lifeSpan?: string;
  disambiguation?: string;
  biography: string;
  imageUrl?: string;
  tags: string[];
  discography: ArtistReleaseItem[];
  sourceUrl?: string;
  isLiveWeb: boolean;
}

export interface ThemeConfig {
  id: string;
  name: string;
  accent: string;
  bgBase: string;
  bgSurface: string;
  textMain: string;
  textDim: string;
  scanlines: boolean;
  borderThickness: number;
}

export interface OverlayConfig {
  enabled: boolean;
  opacity: number;
  width: number;
  showCover: boolean;
  showVisualizer: boolean;
  showLyricsLine: boolean;
  showProgress: boolean;
  showRating: boolean;
  alwaysOnTop: boolean;
}

export interface DiscordConfig {
  enabled: boolean;
  clientId: string;
  showTimestamps: boolean;
  showWhenPaused: boolean;
  largeImageKey: string;
}

export interface SystemConfig {
  openAtLogin: boolean;
  startInTray: boolean;
}

export type TerminalLogTag =
  | 'SYS'
  | 'DSP'
  | 'IO'
  | 'META'
  | 'PLAY'
  | 'FILTER'
  | 'SCROBBLE'
  | 'RPC'
  | 'CMD'
  | 'WARN'
  | 'ERR';

export interface TerminalLogEntry {
  id: string;
  timestamp: string;
  tag: TerminalLogTag;
  message: string;
}
