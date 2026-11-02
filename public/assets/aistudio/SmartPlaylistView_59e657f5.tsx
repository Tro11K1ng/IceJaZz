// filepath: src/components/SmartPlaylistView.tsx
import React from 'react';
import { Filter, Play, Plus, Trash2 } from 'lucide-react';
import {
  RuleField,
  RuleOperator,
  SmartPlaylist,
  SmartRule,
  SmartRuleGroup,
  TrackItem,
} from '../types/audio';
import {
  evaluateSmartPlaylist,
  FIELD_LABELS,
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
  currentTrackId?: string;
}

export const SmartPlaylistView: React.FC<SmartPlaylistViewProps> = ({
  tracks,
  playlists,
  activePlaylistId,
  onSelectPlaylist,
  onUpdatePlaylist,
  onCreatePlaylist,
  onDeletePlaylist,
  onPlayTrack,
  currentTrackId,
}) => {
  const activePlaylist =
    playlists.find((p) => p.id === activePlaylistId) || playlists[0];

  if (!activePlaylist) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 text-center bg-[var(--bg-base)]">
        <div className="w-12 h-12 bg-[var(--bg-surface)] border-[3px] border-[var(--text-main)] flex items-center justify-center mb-4">
          <Filter className="w-5 h-5 text-[var(--accent)]" />
        </div>
        <h2 className="text-base font-bold text-[var(--text-main)] mb-1 uppercase">
          [ NULL_FILTERS_FOUND ]
        </h2>
        <p className="text-xs text-[var(--text-dim)] max-w-md mb-5 uppercase">
          Initialize dynamic logic gates for local audio indexing.
        </p>
        <button
          type="button"
          onClick={onCreatePlaylist}
          className="btn-brutal primary transition-ui flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          <span>INIT_FILTER</span>
        </button>
      </div>
    );
  }

  const matchedTracks = evaluateSmartPlaylist(tracks, activePlaylist);

  const handleUpdateGroupLogic = (groupId: string, logic: 'AND' | 'OR') => {
    const groups = activePlaylist.groups.map((g) =>
      g.id === groupId ? { ...g, logic } : g
    );
    onUpdatePlaylist({ ...activePlaylist, groups });
  };

  const handleAddGroup = () => {
    const newGroup: SmartRuleGroup = {
      id: `grp-${Date.now()}`,
      logic: 'AND',
      rules: [
        {
          id: `rule-${Date.now()}`,
          field: 'format',
          operator: 'equals',
          value: 'FLAC',
        },
      ],
    };
    onUpdatePlaylist({
      ...activePlaylist,
      groups: [...activePlaylist.groups, newGroup],
    });
  };

  const handleRemoveGroup = (groupId: string) => {
    if (activePlaylist.groups.length <= 1) return;
    onUpdatePlaylist({
      ...activePlaylist,
      groups: activePlaylist.groups.filter((g) => g.id !== groupId),
    });
  };

  const handleAddRule = (groupId: string) => {
    const newRule: SmartRule = {
      id: `rule-${Date.now()}`,
      field: 'rating',
      operator: 'gte',
      value: 4,
    };
    const groups = activePlaylist.groups.map((g) =>
      g.id === groupId ? { ...g, rules: [...g.rules, newRule] } : g
    );
    onUpdatePlaylist({ ...activePlaylist, groups });
  };

  const handleUpdateRule = (
    groupId: string,
    ruleId: string,
    patch: Partial<SmartRule>
  ) => {
    const groups = activePlaylist.groups.map((g) => {
      if (g.id !== groupId) return g;
      return {
        ...g,
        rules: g.rules.map((r) => (r.id === ruleId ? { ...r, ...patch } : r)),
      };
    });
    onUpdatePlaylist({ ...activePlaylist, groups });
  };

  const handleRemoveRule = (groupId: string, ruleId: string) => {
    const groups = activePlaylist.groups.map((g) => {
      if (g.id !== groupId) return g;
      return {
        ...g,
        rules: g.rules.filter((r) => r.id !== ruleId),
      };
    });
    onUpdatePlaylist({ ...activePlaylist, groups });
  };

  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <div className="h-full overflow-y-auto p-6 space-y-5 bg-[var(--bg-base)] text-[var(--text-main)]">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b-[3px] border-[var(--text-main)]">
        <div>
          <h2 className="text-base font-bold text-[var(--accent)] flex items-center gap-2 uppercase">
            <Filter className="w-4 h-4" />
            <span>[ TRL_FILTER_ENGINE :: TrollKing ]</span>
          </h2>
          <p className="text-xs text-[var(--text-dim)] mt-0.5 uppercase">
            Logic gates and dynamic query execution
          </p>
        </div>

        <button
          type="button"
          onClick={onCreatePlaylist}
          className="btn-brutal transition-ui flex items-center gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>NEW_NODE</span>
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {playlists.map((pl) => {
          const count = evaluateSmartPlaylist(tracks, pl).length;
          const isSelected = pl.id === activePlaylist.id;
          return (
            <button
              key={pl.id}
              type="button"
              onClick={() => onSelectPlaylist(pl.id)}
              className={`btn-brutal transition-ui flex items-center gap-2 ${isSelected ? 'primary' : ''}`}
            >
              <span>{pl.name}</span>
              <span className="font-mono text-[11px] opacity-85">[{count}]</span>
            </button>
          );
        })}
      </div>

      <div className="bg-[var(--bg-surface)] border-[3px] border-[var(--text-main)] p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-bold text-[var(--text-dim)] mb-1 uppercase">
              QUERY_NAME
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
              META_DESC
            </label>
            <input
              type="text"
              value={activePlaylist.description}
              onChange={(e) =>
                onUpdatePlaylist({ ...activePlaylist, description: e.target.value })
              }
              className="w-full px-3 py-1.5 text-xs bg-[var(--bg-base)] border-[1px] border-[var(--text-dim)] text-[var(--text-main)] focus:outline-none focus:border-[var(--accent)] font-mono"
            />
          </div>

          <div className="flex items-end justify-between gap-2">
            <div className="flex-1">
              <label className="block text-xs font-bold text-[var(--text-dim)] mb-1 uppercase">
                SORT_INDEX
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
                  <option value="title">TITLE</option>
                  <option value="artist">AUTHOR</option>
                  <option value="album">CONTAINER</option>
                  <option value="playCount">CYCLES</option>
                  <option value="sampleRate">FREQ_HZ</option>
                  <option value="bitrate">BITRATE</option>
                  <option value="rating">RATING</option>
                  <option value="year">YEAR</option>
                </select>
                <button
                  type="button"
                  onClick={() =>
                    onUpdatePlaylist({
                      ...activePlaylist,
                      sortOrder: activePlaylist.sortOrder === 'desc' ? 'asc' : 'desc',
                    })
                  }
                  className="btn-brutal transition-ui px-2.5 py-1 text-xs"
                >
                  {activePlaylist.sortOrder === 'desc' ? 'DESC' : 'ASC'}
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={() => onDeletePlaylist(activePlaylist.id)}
              className="btn-brutal transition-ui p-1.5 hover:text-red-500"
              title="DROP_NODE"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t-[3px] border-[var(--text-main)]">
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--text-dim)] font-bold uppercase">ROOT_LOGIC:</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() =>
                  onUpdatePlaylist({ ...activePlaylist, rootLogic: 'AND' })
                }
                className={`btn-brutal transition-ui px-2.5 py-1 text-xs ${
                  activePlaylist.rootLogic === 'AND' ? 'primary' : ''
                }`}
              >
                AND_GATE
              </button>
              <button
                type="button"
                onClick={() =>
                  onUpdatePlaylist({ ...activePlaylist, rootLogic: 'OR' })
                }
                className={`btn-brutal transition-ui px-2.5 py-1 text-xs ${
                  activePlaylist.rootLogic === 'OR' ? 'primary' : ''
                }`}
              >
                OR_GATE
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={handleAddGroup}
            className="btn-brutal transition-ui flex items-center gap-1.5 px-3 py-1 text-xs"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>ADD_GROUP</span>
          </button>
        </div>

        <div className="space-y-3">
          {activePlaylist.groups.map((group, gIdx) => (
            <div
              key={group.id}
              className="bg-[var(--bg-base)] border-[1px] border-[var(--text-dim)] p-3.5 space-y-2.5"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-[var(--accent)] uppercase">
                    BLOCK_0x{gIdx + 1}:
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      handleUpdateGroupLogic(
                        group.id,
                        group.logic === 'AND' ? 'OR' : 'AND'
                      )
                    }
                    className="btn-brutal transition-ui px-2.5 py-0.5 text-xs font-mono"
                  >
                    {group.logic === 'AND'
                      ? 'AND'
                      : 'OR'}
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleAddRule(group.id)}
                    className="btn-brutal transition-ui px-2.5 py-1 text-xs"
                  >
                    + APPEND_RULE
                  </button>
                  {activePlaylist.groups.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveGroup(group.id)}
                      className="text-xs text-[var(--text-dim)] hover:text-red-500 font-bold px-1.5"
                    >
                      [X]
                    </button>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                {group.rules.map((rule) => (
                  <div
                    key={rule.id}
                    className="flex flex-wrap items-center gap-2 bg-[var(--bg-surface)] p-2 border-[1px] border-[var(--text-dim)]"
                  >
                    <select
                      value={rule.field}
                      onChange={(e) =>
                        handleUpdateRule(group.id, rule.id, {
                          field: e.target.value as RuleField,
                        })
                      }
                      className="px-2.5 py-1 text-xs bg-[var(--bg-base)] border-[1px] border-[var(--text-dim)] text-[var(--text-main)] font-mono"
                    >
                      {Object.entries(FIELD_LABELS).map(([k, lbl]) => (
                        <option key={k} value={k}>
                          {lbl.toUpperCase()}
                        </option>
                      ))}
                    </select>

                    <select
                      value={rule.operator}
                      onChange={(e) =>
                        handleUpdateRule(group.id, rule.id, {
                          operator: e.target.value as RuleOperator,
                        })
                      }
                      className="px-2.5 py-1 text-xs bg-[var(--bg-base)] border-[1px] border-[var(--accent)] text-[var(--accent)] font-mono font-bold"
                    >
                      {Object.entries(OPERATOR_LABELS).map(([k, lbl]) => (
                        <option key={k} value={k}>
                          {lbl.toUpperCase()}
                        </option>
                      ))}
                    </select>

                    <input
                      type="text"
                      value={rule.value}
                      onChange={(e) =>
                        handleUpdateRule(group.id, rule.id, {
                          value: e.target.value,
                        })
                      }
                      placeholder="VALUE..."
                      className="flex-1 min-w-[150px] px-2.5 py-1 text-xs bg-[var(--bg-base)] border-[1px] border-[var(--text-dim)] text-[var(--text-main)] font-mono"
                    />

                    {rule.operator === 'between' && (
                      <>
                        <span className="text-xs text-[var(--text-dim)] font-bold font-mono">AND</span>
                        <input
                          type="text"
                          value={rule.valueSecond ?? ''}
                          onChange={(e) =>
                            handleUpdateRule(group.id, rule.id, {
                              valueSecond: e.target.value,
                            })
                          }
                          placeholder="MAX..."
                          className="w-24 px-2.5 py-1 text-xs bg-[var(--bg-base)] border-[1px] border-[var(--text-dim)] text-[var(--text-main)] font-mono"
                        />
                      </>
                    )}

                    {group.rules.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveRule(group.id, rule.id)}
                        className="p-1 text-[var(--text-dim)] hover:text-red-500 font-bold"
                      >
                        [X]
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-[var(--bg-surface)] border-[3px] border-[var(--text-main)] overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b-[3px] border-[var(--text-main)]">
          <div className="text-xs text-[var(--text-dim)] font-bold uppercase">
            RESULT_SET: <span className="text-[var(--accent)]">{matchedTracks.length}</span> / {tracks.length}
          </div>
          {matchedTracks.length > 0 && (
            <button
              type="button"
              onClick={() => onPlayTrack(matchedTracks[0], matchedTracks)}
              className="btn-brutal primary transition-ui flex items-center gap-1.5 px-3 py-1 text-xs"
            >
              <Play className="w-3 h-3 fill-current" />
              <span>EXEC_PLAY</span>
            </button>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="brutal-table w-full">
            <thead>
              <tr>
                <th className="w-10">IDX</th>
                <th>FILE_NAME</th>
                <th>AUTHOR_DATA</th>
                <th>CODEC</th>
                <th>TAGS</th>
                <th className="text-right">CYCLES</th>
                <th className="text-right">LEN</th>
              </tr>
            </thead>
            <tbody>
              {matchedTracks.map((trk, idx) => {
                const isCurrent = trk.id === currentTrackId;
                return (
                  <tr
                    key={trk.id}
                    onClick={() => onPlayTrack(trk, matchedTracks)}
                    className={`brutal-row transition-ui ${isCurrent ? 'playing' : ''}`}
                  >
                    <td>{idx + 1}</td>
                    <td>{trk.title}</td>
                    <td>
                      <span>{trk.artist}</span>
                      <span className="mx-1.5 text-[var(--text-dim)]">/</span>
                      <span>{trk.album}</span>
                    </td>
                    <td className="text-[var(--accent)]">
                      {trk.format} - {(trk.sampleRate / 1000).toFixed(1)}k/{trk.bitDepth}b
                    </td>
                    <td className="truncate max-w-[220px]">
                      {trk.tags.length > 0 ? trk.tags.join(' - ') : 'NULL'}
                    </td>
                    <td className="text-right">{trk.playCount}</td>
                    <td className="text-right">{formatDuration(trk.duration)}</td>
                  </tr>
                );
              })}
              {matchedTracks.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-xs text-[var(--text-dim)] font-bold uppercase">
                    {tracks.length === 0
                      ? 'AWAITING_DIR_MOUNT'
                      : '0_MATCHES_FOUND'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};