import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  RuleField,
  RuleOperator,
  SmartPlaylist,
  SmartRule,
  TrackItem,
} from '../types/audio';
import {
  evaluateSmartPlaylist,
  FIELD_LABELS,
  NUMERIC_FIELDS,
  OPERATOR_LABELS,
} from '../utils/smartFilter';

interface SmartPlaylistViewProps {
  tracks: TrackItem[];
  playlists: SmartPlaylist[];
  activePlaylistId: string;
  onSelectPlaylist: (id: string) => void;
  onUpdatePlaylist: (updated: SmartPlaylist) => void;
  onCreatePlaylist: () => void;
  onDeletePlaylist: (id: string) => void;
  onPlayTrack: (track: TrackItem, queue: TrackItem[]) => void;
  onUpdateTrackRating?: (trackId: string, rating: number) => void;
  currentTrackId?: string;
}

const ROW_HEIGHT = 38;
const OVERSCAN = 15;

export const SmartPlaylistView: React.FC<SmartPlaylistViewProps> = React.memo(
  ({
    tracks,
    playlists,
    activePlaylistId,
    onSelectPlaylist,
    onUpdatePlaylist,
    onCreatePlaylist,
    onDeletePlaylist,
    onPlayTrack,
    onUpdateTrackRating,
    currentTrackId,
  }) => {
    const activePlaylist =
      playlists.find((p) => p.id === activePlaylistId) || playlists[0];

    const librarySuggestions = useMemo(() => {
      const artists = Array.from(new Set(tracks.map((t) => t.artist)))
        .sort()
        .slice(0, 300);
      const albums = Array.from(new Set(tracks.map((t) => t.album)))
        .sort()
        .slice(0, 300);
      const genres = Array.from(new Set(tracks.map((t) => t.genre)))
        .sort()
        .slice(0, 150);
      const formats = Array.from(new Set(tracks.map((t) => t.format))).sort();
      return { artists, albums, genres, formats };
    }, [tracks]);

    const matchedTracks = useMemo(() => {
      if (!activePlaylist) return [];
      return evaluateSmartPlaylist(tracks, activePlaylist);
    }, [tracks, activePlaylist]);

    const tableScrollRef = useRef<HTMLDivElement | null>(null);
    const [scrollTop, setScrollTop] = useState(0);
    const [viewportHeight, setViewportHeight] = useState(520);

    useEffect(() => {
      const el = tableScrollRef.current;
      if (!el) return;
      setViewportHeight(el.clientHeight || 520);
      const onScroll = () => {
        setScrollTop(el.scrollTop);
      };
      el.addEventListener('scroll', onScroll, { passive: true });
      return () => {
        el.removeEventListener('scroll', onScroll);
      };
    }, [activePlaylist?.id]);

    useEffect(() => {
      if (tableScrollRef.current) {
        tableScrollRef.current.scrollTop = 0;
        setScrollTop(0);
      }
    }, [activePlaylist?.id]);

    if (!activePlaylist) {
      return (
        <div className="min-h-full flex flex-col items-center justify-center p-8 text-center bg-[var(--bg-base)]">
          <h2 className="text-base font-bold text-[var(--text-main)] mb-4 uppercase">
            [ NO SMART PLAYLISTS ]
          </h2>
          <button
            type="button"
            onClick={onCreatePlaylist}
            className="btn-brutal primary transition-ui px-4 py-2 text-xs"
          >
            + CREATE SMART PLAYLIST
          </button>
        </div>
      );
    }

    const primaryGroup = activePlaylist.groups[0] || {
      id: 'grp-main',
      logic: activePlaylist.rootLogic || 'AND',
      rules: [],
    };

    const handleSetMatchMode = (logic: 'AND' | 'OR') => {
      const updatedGroups = activePlaylist.groups.map((g, idx) =>
        idx === 0 ? { ...g, logic } : g
      );
      onUpdatePlaylist({
        ...activePlaylist,
        rootLogic: logic,
        groups: updatedGroups,
      });
    };

    const handleAddRule = (presetRule?: Partial<SmartRule>) => {
      const newRule: SmartRule = {
        id: `rule-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        field: presetRule?.field || 'genre',
        operator: presetRule?.operator || 'contains',
        value: presetRule?.value ?? '',
      };
      const nextGroups =
        activePlaylist.groups.length > 0
          ? activePlaylist.groups.map((g, i) =>
              i === 0 ? { ...g, rules: [...g.rules, newRule] } : g
            )
          : [{ id: 'grp-main', logic: 'AND' as const, rules: [newRule] }];

      onUpdatePlaylist({ ...activePlaylist, groups: nextGroups });
    };

    const handleUpdateRule = (ruleId: string, patch: Partial<SmartRule>) => {
      const nextGroups = activePlaylist.groups.map((g) => ({
        ...g,
        rules: g.rules.map((r) => {
          if (r.id !== ruleId) return r;
          const next = { ...r, ...patch };
          if (patch.field && patch.field !== r.field) {
            if (patch.field === 'rating') {
              next.operator = 'gte';
              next.value = 4;
            } else if (NUMERIC_FIELDS.has(patch.field)) {
              next.operator = 'gte';
              next.value = 1;
            } else {
              next.operator = 'contains';
              next.value = '';
            }
          }
          return next;
        }),
      }));
      onUpdatePlaylist({ ...activePlaylist, groups: nextGroups });
    };

    const handleRemoveRule = (ruleId: string) => {
      const nextGroups = activePlaylist.groups.map((g) => ({
        ...g,
        rules: g.rules.filter((r) => r.id !== ruleId),
      }));
      onUpdatePlaylist({ ...activePlaylist, groups: nextGroups });
    };

    const applyQuickPreset = (
      name: string,
      description: string,
      rules: SmartRule[],
      sortBy: keyof TrackItem = 'title',
      sortOrder: 'asc' | 'desc' = 'asc'
    ) => {
      onUpdatePlaylist({
        ...activePlaylist,
        name,
        description,
        rootLogic: 'AND',
        groups: [
          {
            id: primaryGroup.id || `grp-${Date.now()}`,
            logic: 'AND',
            rules,
          },
        ],
        sortBy,
        sortOrder,
      });
    };

    const formatDuration = (sec: number) => {
      const m = Math.floor(sec / 60);
      const s = Math.floor(sec % 60);
      return `${m}:${s < 10 ? '0' : ''}${s}`;
    };

    const totalRows = matchedTracks.length;
    const startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
    const endIdx = Math.min(
      totalRows,
      Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN
    );
    const visibleTracks = matchedTracks.slice(startIdx, endIdx);
    const topPadding = startIdx * ROW_HEIGHT;
    const bottomPadding = Math.max(0, (totalRows - endIdx) * ROW_HEIGHT);

    return (
      <div className="min-h-full p-6 space-y-5 bg-[var(--bg-base)] text-[var(--text-main)]">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b-[3px] border-[var(--text-main)]">
          <h2 className="text-base font-bold text-[var(--accent)] uppercase">
            [ SMART PLAYLISTS &amp; FILTERS ]
          </h2>

          <button
            type="button"
            onClick={onCreatePlaylist}
            className="btn-brutal primary transition-ui px-3 py-1.5 text-xs"
          >
            + NEW PLAYLIST
          </button>
        </div>

        {/* Playlist selector tabs without counters */}
        <div className="flex flex-wrap items-center gap-2">
          {playlists.map((pl) => {
            const isSelected = pl.id === activePlaylist.id;
            return (
              <button
                key={pl.id}
                type="button"
                onClick={() => onSelectPlaylist(pl.id)}
                className={`btn-brutal transition-ui ${
                  isSelected ? 'primary' : ''
                }`}
              >
                {pl.name}
              </button>
            );
          })}
        </div>

        {/* Filter Builder Card */}
        <div className="bg-[var(--bg-surface)] border-[3px] border-[var(--text-main)] p-5 space-y-4">
          {/* Quick Templates Bar */}
          <div className="flex flex-wrap items-center gap-2 pb-3 border-b-[1px] border-[var(--text-dim)]">
            <span className="text-xs font-bold text-[var(--accent)] uppercase mr-1">
              PRESETS:
            </span>
            <button
              type="button"
              onClick={() =>
                applyQuickPreset(
                  '★ 5 Stars Only',
                  'Top rated 5-star tracks',
                  [
                    {
                      id: `r-${Date.now()}`,
                      field: 'rating',
                      operator: 'equals',
                      value: 5,
                    },
                  ],
                  'title',
                  'asc'
                )
              }
              className="btn-brutal transition-ui px-2.5 py-1 text-[11px]"
            >
              ★ 5 Stars
            </button>
            <button
              type="button"
              onClick={() =>
                applyQuickPreset(
                  '★ Favorites (4–5★)',
                  'Highly rated tracks',
                  [
                    {
                      id: `r-${Date.now()}`,
                      field: 'rating',
                      operator: 'gte',
                      value: 4,
                    },
                  ],
                  'rating',
                  'desc'
                )
              }
              className="btn-brutal transition-ui px-2.5 py-1 text-[11px]"
            >
              ★ 4 &amp; 5 Stars
            </button>
            <button
              type="button"
              onClick={() =>
                applyQuickPreset(
                  'Heavy Rotation',
                  'Most played tracks',
                  [
                    {
                      id: `r-${Date.now()}`,
                      field: 'playCount',
                      operator: 'gte',
                      value: 1,
                    },
                  ],
                  'playCount',
                  'desc'
                )
              }
              className="btn-brutal transition-ui px-2.5 py-1 text-[11px]"
            >
              Heavy Rotation
            </button>
            <button
              type="button"
              onClick={() =>
                applyQuickPreset(
                  'With Lyrics',
                  'Tracks with embedded or LRC lyrics',
                  [
                    {
                      id: `r-${Date.now()}`,
                      field: 'tags',
                      operator: 'contains',
                      value: 'Lyrics',
                    },
                  ],
                  'title',
                  'asc'
                )
              }
              className="btn-brutal transition-ui px-2.5 py-1 text-[11px]"
            >
              With Lyrics
            </button>
            <button
              type="button"
              onClick={() =>
                applyQuickPreset(
                  'Unplayed',
                  'Tracks never played yet',
                  [
                    {
                      id: `r-${Date.now()}`,
                      field: 'playCount',
                      operator: 'equals',
                      value: 0,
                    },
                  ],
                  'album',
                  'asc'
                )
              }
              className="btn-brutal transition-ui px-2.5 py-1 text-[11px]"
            >
              Unplayed
            </button>
          </div>

          {/* Name, Description & Sort */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-bold text-[var(--text-dim)] mb-1 uppercase">
                PLAYLIST NAME
              </label>
              <input
                type="text"
                value={activePlaylist.name}
                onChange={(e) =>
                  onUpdatePlaylist({ ...activePlaylist, name: e.target.value })
                }
                className="w-full px-3 py-1.5 text-xs bg-[var(--bg-base)] border-[1px] border-[var(--text-dim)] text-[var(--text-main)] focus:outline-none focus:border-[var(--accent)] font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-[var(--text-dim)] mb-1 uppercase">
                DESCRIPTION
              </label>
              <input
                type="text"
                value={activePlaylist.description}
                onChange={(e) =>
                  onUpdatePlaylist({
                    ...activePlaylist,
                    description: e.target.value,
                  })
                }
                className="w-full px-3 py-1.5 text-xs bg-[var(--bg-base)] border-[1px] border-[var(--text-dim)] text-[var(--text-main)] focus:outline-none focus:border-[var(--accent)] font-mono"
              />
            </div>

            <div className="flex items-end justify-between gap-2">
              <div className="flex-1">
                <label className="block text-xs font-bold text-[var(--text-dim)] mb-1 uppercase">
                  SORT ORDER
                </label>
                <div className="flex items-center gap-1.5">
                  <select
                    value={activePlaylist.sortBy}
                    onChange={(e) =>
                      onUpdatePlaylist({
                        ...activePlaylist,
                        sortBy: e.target.value as keyof TrackItem,
                      })
                    }
                    className="flex-1 px-2.5 py-1.5 text-xs bg-[var(--bg-base)] border-[1px] border-[var(--text-dim)] text-[var(--text-main)] font-mono"
                  >
                    <option value="rating">Rating (★)</option>
                    <option value="playCount">Popularity</option>
                    <option value="title">Title</option>
                    <option value="artist">Artist</option>
                    <option value="album">Album</option>
                    <option value="genre">Genre</option>
                    <option value="year">Year</option>
                    <option value="duration">Duration</option>
                  </select>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdatePlaylist({
                        ...activePlaylist,
                        sortOrder:
                          activePlaylist.sortOrder === 'desc' ? 'asc' : 'desc',
                      })
                    }
                    className="btn-brutal transition-ui px-2.5 py-1 text-xs"
                  >
                    {activePlaylist.sortOrder === 'desc' ? 'DESC' : 'ASC'}
                  </button>
                </div>
              </div>

              {playlists.length > 1 && (
                <button
                  type="button"
                  onClick={() => onDeletePlaylist(activePlaylist.id)}
                  className="btn-brutal transition-ui px-2.5 py-1 text-xs hover:text-red-500"
                >
                  DEL
                </button>
              )}
            </div>
          </div>

          {/* Rule Mode Header */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t-[3px] border-[var(--text-main)]">
            <div className="flex items-center gap-2">
              <span className="text-xs text-[var(--text-dim)] font-bold uppercase">
                MATCH MODE:
              </span>
              <button
                type="button"
                onClick={() => handleSetMatchMode('AND')}
                className={`btn-brutal transition-ui px-3 py-1 text-xs ${
                  primaryGroup.logic === 'AND' ? 'primary' : ''
                }`}
              >
                ALL RULES (AND)
              </button>
              <button
                type="button"
                onClick={() => handleSetMatchMode('OR')}
                className={`btn-brutal transition-ui px-3 py-1 text-xs ${
                  primaryGroup.logic === 'OR' ? 'primary' : ''
                }`}
              >
                ANY RULE (OR)
              </button>
            </div>

            <button
              type="button"
              onClick={() => handleAddRule()}
              className="btn-brutal transition-ui px-3 py-1 text-xs"
            >
              + ADD RULE
            </button>
          </div>

          {/* Rules List */}
          <div className="space-y-2">
            {primaryGroup.rules.map((rule) => {
              const isRatingField = rule.field === 'rating';
              const datalistId = `dl-${rule.id}`;

              return (
                <div
                  key={rule.id}
                  className="flex flex-wrap items-center gap-2 bg-[var(--bg-base)] p-3 border-[1px] border-[var(--text-dim)]"
                >
                  <select
                    value={rule.field}
                    onChange={(e) =>
                      handleUpdateRule(rule.id, {
                        field: e.target.value as RuleField,
                      })
                    }
                    className="px-2.5 py-1.5 text-xs bg-[var(--bg-surface)] border-[1px] border-[var(--text-dim)] text-[var(--text-main)] font-mono font-bold"
                  >
                    {Object.entries(FIELD_LABELS).map(([k, lbl]) => (
                      <option key={k} value={k}>
                        {lbl}
                      </option>
                    ))}
                  </select>

                  <select
                    value={rule.operator}
                    onChange={(e) =>
                      handleUpdateRule(rule.id, {
                        operator: e.target.value as RuleOperator,
                      })
                    }
                    className="px-2.5 py-1.5 text-xs bg-[var(--bg-surface)] border-[1px] border-[var(--accent)] text-[var(--accent)] font-mono font-bold"
                  >
                    {Object.entries(OPERATOR_LABELS).map(([k, lbl]) => (
                      <option key={k} value={k}>
                        {lbl}
                      </option>
                    ))}
                  </select>

                  {isRatingField ? (
                    <div className="flex items-center gap-1 bg-[var(--bg-surface)] px-3 py-1 border-[1px] border-[var(--text-dim)]">
                      {[0, 1, 2, 3, 4, 5].map((starVal) => (
                        <button
                          key={starVal}
                          type="button"
                          onClick={() =>
                            handleUpdateRule(rule.id, { value: starVal })
                          }
                          className={`px-2 py-0.5 text-xs font-mono font-bold cursor-pointer transition-ui ${
                            Number(rule.value) === starVal
                              ? 'bg-[var(--accent)] text-[var(--text-dark)]'
                              : 'text-[var(--text-main)] hover:text-[var(--accent)]'
                          }`}
                        >
                          {starVal === 0 ? '0 (Unrated)' : `${starVal}★`}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <>
                      <input
                        type="text"
                        list={datalistId}
                        value={rule.value}
                        onChange={(e) =>
                          handleUpdateRule(rule.id, {
                            value: e.target.value,
                          })
                        }
                        placeholder="Value..."
                        className="flex-1 min-w-[180px] px-2.5 py-1.5 text-xs bg-[var(--bg-surface)] border-[1px] border-[var(--text-dim)] text-[var(--text-main)] font-mono"
                      />
                      <datalist id={datalistId}>
                        {rule.field === 'genre' &&
                          librarySuggestions.genres.map((g) => (
                            <option key={g} value={g} />
                          ))}
                        {rule.field === 'artist' &&
                          librarySuggestions.artists.map((a) => (
                            <option key={a} value={a} />
                          ))}
                        {rule.field === 'album' &&
                          librarySuggestions.albums.map((al) => (
                            <option key={al} value={al} />
                          ))}
                        {rule.field === 'format' &&
                          librarySuggestions.formats.map((f) => (
                            <option key={f} value={f} />
                          ))}
                      </datalist>
                    </>
                  )}

                  {rule.operator === 'between' && (
                    <>
                      <span className="text-xs text-[var(--text-dim)] font-bold font-mono">
                        TO
                      </span>
                      <input
                        type="text"
                        value={rule.valueSecond ?? ''}
                        onChange={(e) =>
                          handleUpdateRule(rule.id, {
                            valueSecond: e.target.value,
                          })
                        }
                        placeholder="Max..."
                        className="w-24 px-2.5 py-1.5 text-xs bg-[var(--bg-surface)] border-[1px] border-[var(--text-dim)] text-[var(--text-main)] font-mono"
                      />
                    </>
                  )}

                  {primaryGroup.rules.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveRule(rule.id)}
                      className="btn-brutal transition-ui px-2 py-1 text-xs hover:text-red-500"
                    >
                      ✕
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Matched Results Virtualized Table without counters */}
        <div className="bg-[var(--bg-surface)] border-[3px] border-[var(--text-main)] overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b-[3px] border-[var(--text-main)]">
            <div className="text-xs text-[var(--text-dim)] font-bold uppercase">
              MATCHED TRACKS
            </div>
            {matchedTracks.length > 0 && (
              <button
                type="button"
                onClick={() => onPlayTrack(matchedTracks[0], matchedTracks)}
                className="btn-brutal primary transition-ui px-3 py-1 text-xs"
              >
                PLAY PLAYLIST
              </button>
            )}
          </div>

          <div
            ref={tableScrollRef}
            className="max-h-[540px] overflow-y-auto overflow-x-auto brutal-scroll"
          >
            <table className="brutal-table w-full">
              <thead>
                <tr>
                  <th className="w-10">#</th>
                  <th>TITLE</th>
                  <th>ARTIST / ALBUM</th>
                  <th>GENRE</th>
                  <th>RATING ★</th>
                  <th className="text-right">TIME</th>
                </tr>
              </thead>
              <tbody>
                {topPadding > 0 && (
                  <tr style={{ height: `${topPadding}px` }}>
                    <td colSpan={6} style={{ padding: 0, border: 0 }} />
                  </tr>
                )}
                {visibleTracks.map((trk, i) => {
                  const absoluteIdx = startIdx + i;
                  const isCurrent = trk.id === currentTrackId;
                  return (
                    <tr
                      key={trk.id}
                      onDoubleClick={() => onPlayTrack(trk, matchedTracks)}
                      className={`brutal-row transition-ui ${
                        isCurrent ? 'playing' : ''
                      }`}
                    >
                      <td>{absoluteIdx + 1}</td>
                      <td>
                        <button
                          type="button"
                          onClick={() => onPlayTrack(trk, matchedTracks)}
                          className="text-left font-bold hover:underline cursor-pointer"
                        >
                          {trk.title}
                        </button>
                      </td>
                      <td>
                        <span>{trk.artist}</span>
                        <span className="mx-1.5 opacity-60">/</span>
                        <span className="opacity-80">{trk.album}</span>
                      </td>
                      <td>{trk.genre}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="inline-flex items-center gap-0.5 font-mono">
                          {[1, 2, 3, 4, 5].map((star) => (
                            <button
                              key={star}
                              type="button"
                              onClick={() =>
                                onUpdateTrackRating?.(
                                  trk.id,
                                  trk.rating === star ? 0 : star
                                )
                              }
                              className={`px-0.5 text-sm cursor-pointer transition-transform hover:scale-125 ${
                                star <= trk.rating
                                  ? 'text-[var(--accent)]'
                                  : 'opacity-25'
                              }`}
                            >
                              ★
                            </button>
                          ))}
                        </div>
                      </td>
                      <td className="text-right tabular-nums">
                        {formatDuration(trk.duration)}
                      </td>
                    </tr>
                  );
                })}
                {bottomPadding > 0 && (
                  <tr style={{ height: `${bottomPadding}px` }}>
                    <td colSpan={6} style={{ padding: 0, border: 0 }} />
                  </tr>
                )}
                {matchedTracks.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="py-10 text-center text-xs text-[var(--text-dim)] font-bold uppercase"
                    >
                      {tracks.length === 0
                        ? 'MOUNT A MUSIC DIRECTORY FIRST'
                        : 'NO TRACKS MATCH CURRENT FILTER RULES'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }
);
