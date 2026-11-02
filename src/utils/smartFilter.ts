import {
  RuleField,
  RuleOperator,
  SmartPlaylist,
  SmartRule,
  SmartRuleGroup,
  TrackItem,
} from '../types/audio';

export const FIELD_LABELS: Record<RuleField, string> = {
  artist: 'Artist',
  album: 'Album',
  genre: 'Genre',
  rating: 'Rating (★ 0–5)',
  title: 'Track Title',
  year: 'Release Year',
  playCount: 'Play Count',
  duration: 'Duration (sec)',
  tags: 'Tags',
  format: 'File Format',
  bitrate: 'Bitrate (kbps)',
  sampleRate: 'Sample Rate (Hz)',
  bitDepth: 'Bit Depth',
  folderPath: 'Folder Path',
};

export const OPERATOR_LABELS: Record<RuleOperator, string> = {
  contains: 'contains',
  equals: 'equals (=)',
  gte: 'at least (≥)',
  lte: 'at most (≤)',
  gt: 'greater than (>)',
  lt: 'less than (<)',
  between: 'between (min .. max)',
  not_equals: 'not equal (≠)',
  not_contains: 'does not contain',
};

export const NUMERIC_FIELDS = new Set<RuleField>([
  'year',
  'rating',
  'playCount',
  'sampleRate',
  'bitDepth',
  'bitrate',
  'duration',
]);

function evaluateSingleRule(track: TrackItem, rule: SmartRule): boolean {
  const rawTrackValue = track[rule.field as keyof TrackItem];

  if (NUMERIC_FIELDS.has(rule.field)) {
    const numVal = Number(rawTrackValue ?? 0);
    const targetA = Number(rule.value);
    const targetB = Number(rule.valueSecond ?? rule.value);

    if (Number.isNaN(targetA)) return true;

    switch (rule.operator) {
      case 'equals':
        return numVal === targetA;
      case 'not_equals':
        return numVal !== targetA;
      case 'gt':
        return numVal > targetA;
      case 'gte':
        return numVal >= targetA;
      case 'lt':
        return numVal < targetA;
      case 'lte':
        return numVal <= targetA;
      case 'between': {
        const min = Math.min(targetA, Number.isNaN(targetB) ? targetA : targetB);
        const max = Math.max(targetA, Number.isNaN(targetB) ? targetA : targetB);
        return numVal >= min && numVal <= max;
      }
      case 'contains':
        return String(numVal).includes(String(rule.value).trim());
      case 'not_contains':
        return !String(numVal).includes(String(rule.value).trim());
      default:
        return true;
    }
  }

  const strTrackVal = Array.isArray(rawTrackValue)
    ? rawTrackValue.join(' ').toLowerCase()
    : String(rawTrackValue ?? '').toLowerCase();
  const query = String(rule.value ?? '')
    .trim()
    .toLowerCase();

  if (!query) return true;

  switch (rule.operator) {
    case 'equals':
      if (Array.isArray(rawTrackValue)) {
        return rawTrackValue.some((t) => t.toLowerCase() === query);
      }
      return strTrackVal === query;
    case 'not_equals':
      if (Array.isArray(rawTrackValue)) {
        return !rawTrackValue.some((t) => t.toLowerCase() === query);
      }
      return strTrackVal !== query;
    case 'contains':
      return strTrackVal.includes(query);
    case 'not_contains':
      return !strTrackVal.includes(query);
    default:
      return strTrackVal.includes(query);
  }
}

function evaluateGroup(track: TrackItem, group: SmartRuleGroup): boolean {
  if (!group.rules || group.rules.length === 0) return true;
  if (group.logic === 'AND') {
    return group.rules.every((r) => evaluateSingleRule(track, r));
  }
  return group.rules.some((r) => evaluateSingleRule(track, r));
}

export function evaluateSmartPlaylist(
  tracks: TrackItem[],
  playlist: SmartPlaylist
): TrackItem[] {
  if (!playlist) return tracks;

  const filtered = tracks.filter((track) => {
    if (!playlist.groups || playlist.groups.length === 0) return true;
    if (playlist.rootLogic === 'AND') {
      return playlist.groups.every((g) => evaluateGroup(track, g));
    }
    return playlist.groups.some((g) => evaluateGroup(track, g));
  });

  const dir = playlist.sortOrder === 'desc' ? -1 : 1;
  const sortBy = playlist.sortBy || 'title';

  const sorted = [...filtered].sort((a, b) => {
    const valA = a[sortBy];
    const valB = b[sortBy];

    if (typeof valA === 'number' && typeof valB === 'number') {
      return (valA - valB) * dir;
    }
    return String(valA ?? '').localeCompare(String(valB ?? '')) * dir;
  });

  if (playlist.limit && playlist.limit > 0) {
    return sorted.slice(0, playlist.limit);
  }
  return sorted;
}

export function createDefaultSmartPlaylists(): SmartPlaylist[] {
  return [
    {
      id: 'sp-favorites',
      name: '★ Favorites (4–5★)',
      description: 'Highly rated tracks (4 or 5 stars)',
      rootLogic: 'AND',
      groups: [
        {
          id: 'grp-fav-1',
          logic: 'AND',
          rules: [
            {
              id: 'rule-stars',
              field: 'rating',
              operator: 'gte',
              value: 4,
            },
          ],
        },
      ],
      sortBy: 'rating',
      sortOrder: 'desc',
    },
    {
      id: 'sp-heavy-rotation',
      name: 'Heavy Rotation',
      description: 'Most played tracks in your library',
      rootLogic: 'AND',
      groups: [
        {
          id: 'grp-heavy-1',
          logic: 'AND',
          rules: [
            {
              id: 'rule-plays',
              field: 'playCount',
              operator: 'gte',
              value: 1,
            },
          ],
        },
      ],
      sortBy: 'playCount',
      sortOrder: 'desc',
    },
    {
      id: 'sp-with-lyrics',
      name: 'With Lyrics',
      description: 'Tracks with embedded or attached lyrics',
      rootLogic: 'AND',
      groups: [
        {
          id: 'grp-lyr-1',
          logic: 'AND',
          rules: [
            {
              id: 'rule-lyr',
              field: 'tags',
              operator: 'contains',
              value: 'Lyrics',
            },
          ],
        },
      ],
      sortBy: 'title',
      sortOrder: 'asc',
    },
    {
      id: 'sp-never-played',
      name: 'Unplayed',
      description: 'Fresh tracks with zero plays',
      rootLogic: 'AND',
      groups: [
        {
          id: 'grp-unplayed-1',
          logic: 'AND',
          rules: [
            {
              id: 'rule-zero',
              field: 'playCount',
              operator: 'equals',
              value: 0,
            },
          ],
        },
      ],
      sortBy: 'album',
      sortOrder: 'asc',
    },
  ];
}
