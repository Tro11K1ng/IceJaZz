export type AudioFormat = 'FLAC' | 'WAV' | 'MP3' | 'OGG' | 'M4A' | 'ALAC';

export interface SynthRecipe {
  rootFreq: number;
  chordIntervals: number[];
  tempoBpm: number;
  bassPattern: number[];
  arpNotes: number[];
  timbre: 'ambient-drone' | 'post-rock' | 'modular-tech' | 'warm-tube-jazz';
  noiseFloor: number;
}

export interface TrackItem {
  id: string;
  title: string;
  artist: string;
  album: string;
  albumArtist?: string;
  trackNumber: number;
  year: number;
  genre: string;
  format: AudioFormat;
  sampleRate: number; // e.g., 44100, 48000, 96000, 192000
  bitDepth: number; // e.g., 16, 24
  bitrate: number; // kbps, e.g., 980, 1411, 2822
  channels: number; // 2
  duration: number; // seconds
  folderPath: string; // e.g., "/Music/FLAC_Archive/Boards of Nord/2024 - Subzero Echoes"
  fileName: string; // e.g., "01 - Glacial Phase.flac"
  fileSizeMB: number;
  rating: number; // 0 to 5
  playCount: number;
  lastPlayed?: string; // ISO string
  addedAt: string; // ISO string
  tags: string[]; // custom user tags e.g. ["Ночной драйв", "Эталон баса", "Инструментал"]
  coverUrl?: string; // ObjectURL from embedded FLAC picture or folder.jpg
  artworkSeed: number;
  fileRef?: File; // Actual local File object when loaded from user's PC
  synthRecipe?: SynthRecipe; // Used for built-in reference FLAC tracks when no local file is attached
}

export type RuleField =
  | 'format'
  | 'sampleRate'
  | 'bitDepth'
  | 'bitrate'
  | 'genre'
  | 'artist'
  | 'album'
  | 'title'
  | 'year'
  | 'rating'
  | 'playCount'
  | 'duration'
  | 'tags'
  | 'folderPath';

export type RuleOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'between'
  | 'includes_tag';

export interface SmartRule {
  id: string;
  field: RuleField;
  operator: RuleOperator;
  value: string | number;
  valueSecond?: string | number; // For 'between'
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
  isSystem?: boolean;
}

export interface EQBand {
  frequency: number;
  label: string;
  gain: number; // -12 to +12 dB
  type: BiquadFilterType;
  q: number;
}

export interface EQPreset {
  id: string;
  name: string;
  preamp: number;
  gains: number[]; // 10 values matching standard bands
  isCustom?: boolean;
}

export interface DSPSettings {
  enabled: boolean;
  preamp: number; // -12 to +12 dB
  bands: EQBand[];
  activePresetId: string;
  crossfadeSeconds: number; // 0 to 12s
  gapless: boolean;
  stereoBalance: number; // -1 (L) to +1 (R)
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
  bitDepth: number;
  durationListened: number; // seconds
  timestamp: string; // ISO string
  source: 'local-player' | 'lastfm-import';
}

export interface ArtistBioData {
  name: string;
  country?: string;
  lifeSpan?: string;
  disambiguation?: string;
  biography: string;
  tags: string[];
  discography: {
    title: string;
    year: string;
    type: string;
  }[];
  sourceUrl?: string;
  imageUrl?: string;
  fetchedAt: string;
  isLiveWeb: boolean;
}
