import React, { useEffect, useState } from 'react';
import { ArtistBioData, ListeningLogEntry, TrackItem } from '../types/audio';
import { fetchArtistBiography } from '../utils/artistService';
import { AlbumArtwork } from './AlbumArtwork';
import { VisualizerRack } from './VisualizerRack';

interface ArtistInspectorProps {
  activeTrack: TrackItem | null;
  isPlaying: boolean;
  history: ListeningLogEntry[];
  onUpdateTrackTags: (trackId: string, tags: string[]) => void;
  onUpdateTrackRating: (trackId: string, rating: number) => void;
  onSelectTrackById: (trackId: string) => void;
}

type InspectorTab = 'artist' | 'stream' | 'history';

export const ArtistInspector: React.FC<ArtistInspectorProps> = React.memo(
  ({
    activeTrack,
    isPlaying,
    history,
    onUpdateTrackTags,
    onUpdateTrackRating,
    onSelectTrackById,
  }) => {
    const [tab, setTab] = useState<InspectorTab>('artist');
    const [bioData, setBioData] = useState<ArtistBioData | null>(null);
    const [loadingBio, setLoadingBio] = useState<boolean>(false);
    const [newTagText, setNewTagText] = useState<string>('');

    const artistName = activeTrack?.artist || '';

    useEffect(() => {
      let cancelled = false;
      if (!artistName) {
        setBioData(null);
        return;
      }
      setLoadingBio(true);
      fetchArtistBiography(artistName, false)
        .then((data) => {
          if (!cancelled) {
            setBioData(data);
            setLoadingBio(false);
          }
        })
        .catch(() => {
          if (!cancelled) setLoadingBio(false);
        });
      return () => {
        cancelled = true;
      };
    }, [artistName]);

    const handleRefreshBio = async () => {
      if (!artistName) return;
      setLoadingBio(true);
      const fresh = await fetchArtistBiography(artistName, true);
      setBioData(fresh);
      setLoadingBio(false);
    };

    const handleAddTag = (e: React.FormEvent) => {
      e.preventDefault();
      if (!activeTrack || !newTagText.trim()) return;
      const clean = newTagText.trim();
      if (!activeTrack.tags.includes(clean)) {
        onUpdateTrackTags(activeTrack.id, [...activeTrack.tags, clean]);
      }
      setNewTagText('');
    };

    const handleRemoveTag = (tagToRemove: string) => {
      if (!activeTrack) return;
      onUpdateTrackTags(
        activeTrack.id,
        activeTrack.tags.filter((t) => t !== tagToRemove)
      );
    };

    return (
      <aside className="w-80 shrink-0 bg-[var(--bg-base)] border-l-[3px] border-[var(--text-main)] flex flex-col h-full min-h-0 overflow-hidden select-none">
        {/* Visualizer Module */}
        <VisualizerRack
          isPlaying={isPlaying}
          sampleRate={activeTrack?.sampleRate}
          bitDepth={activeTrack?.bitDepth}
          format={activeTrack?.format}
        />

        {/* Inspector Tabs without icons */}
        <div className="grid grid-cols-3 border-b-[3px] border-[var(--text-main)] bg-[var(--bg-surface)] p-1 gap-1 shrink-0">
          <button
            type="button"
            onClick={() => setTab('artist')}
            className={`btn-brutal transition-ui flex items-center justify-center py-1 px-1.5 text-[11px] whitespace-nowrap shrink-0 ${
              tab === 'artist' ? 'primary' : ''
            }`}
          >
            BIO
          </button>

          <button
            type="button"
            onClick={() => setTab('stream')}
            className={`btn-brutal transition-ui flex items-center justify-center py-1 px-1.5 text-[11px] whitespace-nowrap shrink-0 ${
              tab === 'stream' ? 'primary' : ''
            }`}
          >
            PROPS
          </button>

          <button
            type="button"
            onClick={() => setTab('history')}
            className={`btn-brutal transition-ui flex items-center justify-center py-1 px-1.5 text-[11px] whitespace-nowrap shrink-0 ${
              tab === 'history' ? 'primary' : ''
            }`}
          >
            LOG
          </button>
        </div>

        {/* Tab Content */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4 brutal-scroll">
          {tab === 'artist' && (
            <>
              {!activeTrack ? (
                <div className="py-10 text-center text-xs text-[var(--text-dim)] uppercase font-bold">
                  NO TRACK SELECTED
                </div>
              ) : (
                <>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-[11px] font-mono text-[var(--accent)] font-bold uppercase">
                        {bioData?.isLiveWeb ? 'Wikipedia / MusicBrainz' : 'Artist Profile'}
                      </div>
                      <h3 className="text-sm font-bold text-[var(--text-main)] mt-0.5 uppercase">
                        {bioData?.name || artistName}
                      </h3>
                      {(bioData?.country || bioData?.lifeSpan) && (
                        <div className="text-xs text-[var(--text-dim)] mt-0.5">
                          {[bioData.country, bioData.lifeSpan].filter(Boolean).join(' · ')}
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={handleRefreshBio}
                      disabled={loadingBio}
                      className="btn-brutal transition-ui px-2 py-1 text-[10px]"
                    >
                      {loadingBio ? '...' : 'SYNC'}
                    </button>
                  </div>

                  {bioData?.imageUrl && (
                    <div className="border-[3px] border-[var(--text-main)] overflow-hidden h-36 bg-[var(--bg-surface)]">
                      <img
                        src={bioData.imageUrl}
                        alt={bioData.name}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover grayscale"
                      />
                    </div>
                  )}

                  {bioData?.disambiguation && (
                    <div className="text-xs text-[var(--text-main)] bg-[var(--bg-surface)] border-[1px] border-[var(--text-dim)] p-2.5">
                      {bioData.disambiguation}
                    </div>
                  )}

                  <div className="space-y-1">
                    <div className="text-xs font-bold text-[var(--text-dim)] uppercase">Biography</div>
                    <p className="text-xs text-[var(--text-main)] leading-relaxed select-text">
                      {loadingBio
                        ? 'Fetching biography...'
                        : bioData?.biography}
                    </p>
                  </div>

                  {bioData && bioData.tags.length > 0 && (
                    <div className="pt-2 border-t-[1px] border-[var(--text-dim)]">
                      <div className="text-xs text-[var(--text-dim)] font-bold uppercase mb-1">Genre Tags</div>
                      <div className="text-xs text-[var(--accent)] font-bold leading-relaxed uppercase">
                        {bioData.tags.join(' · ')}
                      </div>
                    </div>
                  )}

                  {bioData && bioData.discography.length > 0 && (
                    <div className="pt-2 border-t-[1px] border-[var(--text-dim)] space-y-1.5">
                      <div className="text-xs font-bold text-[var(--text-dim)] uppercase">Discography</div>
                      <div className="space-y-1">
                        {bioData.discography.map((rel, idx) => (
                          <div
                            key={`${rel.title}-${idx}`}
                            className="flex items-center justify-between text-xs bg-[var(--bg-surface)] px-2.5 py-1.5 border-[1px] border-[var(--text-dim)]"
                          >
                            <div className="truncate pr-2">
                              <span className="text-[var(--text-main)] font-bold">{rel.title}</span>
                              <span className="mx-1.5 text-[var(--text-dim)]">/</span>
                              <span className="text-xs text-[var(--text-dim)]">{rel.type}</span>
                            </div>
                            <span className="font-mono tabular-nums text-xs text-[var(--accent)] font-bold shrink-0">
                              {rel.year}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {bioData?.sourceUrl && (
                    <a
                      href={bioData.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block text-xs text-[var(--text-dim)] hover:text-[var(--accent)] pt-1 font-bold uppercase transition-colors"
                    >
                      [SOURCE LINK]
                    </a>
                  )}
                </>
              )}
            </>
          )}

          {tab === 'stream' && (
            <>
              {!activeTrack ? (
                <div className="py-10 text-center text-xs text-[var(--text-dim)] font-bold uppercase">
                  NO TRACK SELECTED
                </div>
              ) : (
                <div className="space-y-3.5">
                  <div className="flex items-center gap-3">
                    <AlbumArtwork
                      coverUrl={activeTrack.coverUrl}
                      album={activeTrack.album}
                      artist={activeTrack.artist}
                      className="w-14 h-14 border-[2px] border-[var(--text-main)] shrink-0 grayscale"
                    />
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-[var(--text-main)] truncate uppercase">
                        {activeTrack.title}
                      </div>
                      <div className="text-xs text-[var(--accent)] font-bold truncate uppercase">
                        {activeTrack.artist}
                      </div>
                      <div className="text-xs text-[var(--text-dim)] truncate">
                        {activeTrack.album} ({activeTrack.year})
                      </div>
                    </div>
                  </div>

                  <div className="bg-[var(--bg-surface)] border-[1px] border-[var(--text-dim)] p-3 flex items-center justify-between">
                    <span className="text-xs font-bold text-[var(--text-dim)] uppercase">Rating:</span>
                    <div className="flex items-center gap-1 font-mono">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          key={star}
                          type="button"
                          onClick={() =>
                            onUpdateTrackRating(
                              activeTrack.id,
                              activeTrack.rating === star ? 0 : star
                            )
                          }
                          className={`px-0.5 text-sm cursor-pointer transition-transform hover:scale-110 ${
                            star <= activeTrack.rating
                              ? 'text-[var(--accent)]'
                              : 'text-[var(--text-dim)]'
                          }`}
                        >
                          ★
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="bg-[var(--bg-surface)] border-[1px] border-[var(--text-dim)] p-3 space-y-2">
                    <div className="text-xs font-bold text-[var(--text-dim)] uppercase">
                      Custom Tags
                    </div>

                    {activeTrack.tags.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {activeTrack.tags.map((tag) => (
                          <button
                            key={tag}
                            type="button"
                            onClick={() => handleRemoveTag(tag)}
                            className="px-2 py-0.5 text-xs bg-[var(--bg-base)] border-[1px] border-[var(--text-dim)] text-[var(--text-main)] hover:text-red-500 font-bold cursor-pointer"
                            title="Click to remove tag"
                          >
                            {tag} ×
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="text-xs text-[var(--text-dim)]">No tags assigned.</div>
                    )}

                    <form onSubmit={handleAddTag} className="flex items-center gap-1.5 pt-1">
                      <input
                        type="text"
                        value={newTagText}
                        onChange={(e) => setNewTagText(e.target.value)}
                        placeholder="ADD TAG..."
                        className="flex-1 min-w-0 px-2.5 py-1 text-xs bg-[var(--bg-base)] border-[1px] border-[var(--text-dim)] text-[var(--text-main)] focus:outline-none focus:border-[var(--accent)] font-mono"
                      />
                      <button
                        type="submit"
                        className="btn-brutal primary transition-ui px-2.5 py-1 text-xs"
                      >
                        ADD
                      </button>
                    </form>
                  </div>

                  <div className="bg-[var(--bg-surface)] border-[1px] border-[var(--text-dim)] p-3 space-y-1.5">
                    <div className="text-xs font-bold text-[var(--text-dim)] uppercase mb-1">
                      Audio Stream Details
                    </div>
                    <div className="grid grid-cols-2 gap-y-1 text-xs">
                      <span className="text-[var(--text-dim)]">Format:</span>
                      <span className="font-mono tabular-nums text-[var(--accent)] font-bold text-right">
                        {activeTrack.format}
                      </span>

                      <span className="text-[var(--text-dim)]">Sample Rate:</span>
                      <span className="font-mono tabular-nums text-[var(--text-main)] font-bold text-right">
                        {(activeTrack.sampleRate / 1000).toFixed(1)} kHz
                      </span>

                      <span className="text-[var(--text-dim)]">Bit Depth:</span>
                      <span className="font-mono tabular-nums text-[var(--text-main)] font-bold text-right">
                        {activeTrack.bitDepth} bit ({activeTrack.channels} ch)
                      </span>

                      <span className="text-[var(--text-dim)]">Bitrate:</span>
                      <span className="font-mono tabular-nums text-[var(--text-main)] font-bold text-right">
                        {activeTrack.bitrate} kbps
                      </span>

                      <span className="text-[var(--text-dim)]">File Size:</span>
                      <span className="font-mono tabular-nums text-[var(--text-main)] font-bold text-right">
                        {activeTrack.fileSizeMB} MB
                      </span>
                    </div>

                    <div className="pt-2 mt-2 border-t-[1px] border-[var(--text-dim)] text-[11px] font-mono text-[var(--text-dim)] break-all">
                      <div className="text-[var(--text-main)] font-bold mb-0.5 uppercase">
                        Location:
                      </div>
                      {activeTrack.folderPath}/{activeTrack.fileName}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {tab === 'history' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[var(--text-dim)] uppercase">
                  Playback Log
                </span>
              </div>

              {history.length === 0 ? (
                <div className="py-10 text-center text-xs text-[var(--text-dim)] uppercase font-bold">
                  NO TRACKS LOGGED YET
                </div>
              ) : (
                <div className="space-y-1.5">
                  {history.slice(0, 40).map((entry) => {
                    const dateObj = new Date(entry.timestamp);
                    const dateStr = dateObj.toLocaleDateString('en-US', {
                      month: 'short',
                      day: '2-digit',
                    });
                    const timeStr = dateObj.toLocaleTimeString('en-US', {
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: false,
                    });
                    return (
                      <div
                        key={entry.id}
                        onClick={() => onSelectTrackById(entry.trackId)}
                        className="bg-[var(--bg-surface)] border-[1px] border-[var(--text-dim)] hover:border-[var(--accent)] p-2 cursor-pointer transition-colors"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs text-[var(--text-main)] font-bold truncate">
                            {entry.title}
                          </span>
                          <span className="text-[10px] font-mono tabular-nums text-[var(--text-dim)] shrink-0">
                            {dateStr} {timeStr}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-xs text-[var(--text-dim)] mt-0.5">
                          <span className="truncate">{entry.artist}</span>
                          <span className="font-mono text-[10px] text-[var(--accent)] font-bold shrink-0">
                            {entry.format}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </aside>
    );
  }
);
