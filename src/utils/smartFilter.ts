import { SmartPlaylist, SmartRule, SmartRuleGroup, TrackItem } from '../types/audio';

const naturalCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});

function evaluateRule(track: TrackItem, rule: SmartRule): boolean {
  const { field, operator, value, valueSecond } = rule;

  if (field === 'tags') {
    const query = String(value).toLowerCase().trim();
    if (!query) return true;
    const hasMatch = track.tags.some((t) => t.toLowerCase().includes(query));
    if (operator === 'not_contains' || operator === 'not_equals') return !hasMatch;
    return hasMatch;
  }

  const rawTrackVal = track[field];
  if (rawTrackVal === undefined || rawTrackVal === null) return false;

  if (
    field === 'sampleRate' ||
    field === 'bitDepth' ||
    field === 'bitrate' ||
    field === 'year' ||
    field === 'rating' ||
    field === 'playCount' ||
    field === 'duration'
  ) {
    const numTrack = Number(rawTrackVal);
    const numVal = Number(value);
    if (isNaN(numVal)) return true;

    switch (operator) {
      case 'equals':
        return numTrack === numVal;
      case 'not_equals':
        return numTrack !== numVal;
      case 'gt':
        return numTrack > numVal;
      case 'gte':
        return numTrack >= numVal;
      case 'lt':
        return numTrack < numVal;
      case 'lte':
        return numTrack <= numVal;
      case 'between': {
        const numVal2 = Number(valueSecond ?? numVal);
        const min = Math.min(numVal, numVal2);
        const max = Math.max(numVal, numVal2);
        return numTrack >= min && numTrack <= max;
      }
      default:
        return numTrack === numVal;
    }
  }

  const strTrack = String(rawTrackVal).toLowerCase();
  const strVal = String(value).toLowerCase().trim();
  if (!strVal) return true;

  switch (operator) {
    case 'equals':
      return strTrack === strVal;
    case 'not_equals':
      return strTrack !== strVal;
    case 'contains':
    case 'includes_tag':
      return strTrack.includes(strVal);
    case 'not_contains':
      return !strTrack.includes(strVal);
    default:
      return strTrack.includes(strVal);
  }
}

function evaluateGroup(track: TrackItem, group: SmartRuleGroup): boolean {
  if (group.rules.length === 0) return true;
  if (group.logic === 'AND') {
    return group.rules.every((r) => evaluateRule(track, r));
  } else {
    return group.rules.some((r) => evaluateRule(track, r));
  }
}

export function evaluateSmartPlaylist(
  tracks: TrackItem[],
  playlist: SmartPlaylist
): TrackItem[] {
  const filtered = tracks.filter((track) => {
    if (playlist.groups.length === 0) return true;
    if (playlist.rootLogic === 'AND') {
      return playlist.groups.every((g) => evaluateGroup(track, g));
    } else {
      return playlist.groups.some((g) => evaluateGroup(track, g));
    }
  });

  const sorted = [...filtered].sort((a, b) => {
    const valA = a[playlist.sortBy];
    const valB = b[playlist.sortBy];
    if (typeof valA === 'number' && typeof valB === 'number') {
      return playlist.sortOrder === 'asc' ? valA - valB : valB - valA;
    }
    const strA = String(valA ?? '');
    const strB = String(valB ?? '');
    return playlist.sortOrder === 'asc'
      ? naturalCollator.compare(strA, strB)
      : naturalCollator.compare(strB, strA);
  });

  if (playlist.limit && playlist.limit > 0) {
    return sorted.slice(0, playlist.limit);
  }
  return sorted;
}

export const FIELD_LABELS: Record<SmartRule['field'], string> = {
  format: 'Audio Format (FLAC/MP3/WAV)',
  sampleRate: 'Sample Rate (Hz)',
  bitDepth: 'Bit Depth (bit)',
  bitrate: 'Bitrate (kbps)',
  genre: 'Genre',
  artist: 'Artist',
  album: 'Album',
  title: 'Track Title',
  year: 'Release Year',
  rating: 'Rating (0–5)',
  playCount: 'Play Count',
  duration: 'Duration (sec)',
  tags: 'Custom Tag',
  folderPath: 'Folder Path',
};

export const OPERATOR_LABELS: Record<SmartRule['operator'], string> = {
  equals: 'is (=)',
  not_equals: 'is not (≠)',
  contains: 'contains',
  not_contains: 'does not contain',
  gt: 'greater than (>)',
  gte: 'at least (≥)',
  lt: 'less than (<)',
  lte: 'at most (≤)',
  between: 'between',
  includes_tag: 'has tag',
};
