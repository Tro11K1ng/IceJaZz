import { ListeningLogEntry, SmartPlaylist, TrackItem } from '../types/audio';

// Clean zero-placeholder state: no fake demo tracks, no pre-made smart filters, no fake listening history.
export const INITIAL_DEMO_TRACKS: TrackItem[] = [];
export const INITIAL_SMART_PLAYLISTS: SmartPlaylist[] = [];

export function generateInitialListeningHistory(_tracks: TrackItem[]): ListeningLogEntry[] {
  return [];
}
