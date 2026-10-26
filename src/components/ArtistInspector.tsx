import React, { useEffect, useState } from 'react';
import {
  ExternalLink,
  FolderOpen,
  Globe,
  History,
  Info,
  Plus,
  RefreshCw,
  Star,
} from 'lucide-react';
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
      <aside className="w-80 shrink-0 bg-[#161920] border-l border-[#262B36] flex flex-col h-full overflow-hidden select-none">
        {/* Visualizer Module */}
        <VisualizerRack
          isPlaying={isPlaying}
          sampleRate={activeTrack?.sampleRate}
          bitDepth={activeTrack?.bitDepth}
          format={activeTrack?.format}
        />

        {/* Inspector Tabs */}
        <div className="grid grid-cols-3 border-b border-[#262B36] bg-[#0F1115] p-1 gap-1">
          <button
            type="button"
            onClick={() => setTab('artist')}
            className={`flex items-center justify-center gap-1.5 py-1.5 text-xs rounded transition-colors whitespace-nowrap shrink-0 ${
              tab === 'artist'
                ? 'bg-[#1E232D] text-white font-medium'
                : 'text-[#9CA3AF] hover:text-white'
            }`}
          >
            <Globe className="w-3.5 h-3.5 text-blue-400" />
            <span>Artist Info</span>
          </button>

          <button
            type="button"
            onClick={() => setTab('stream')}
            className={`flex items-center justify-center gap-1.5 py-1.5 text-xs rounded transition-colors whitespace-nowrap shrink-0 ${
              tab === 'stream'
                ? 'bg-[#1E232D] text-white font-medium'
                : 'text-[#9CA3AF] hover:text-white'
            }`}
          >
            <Info className="w-3.5 h-3.5 text-blue-400" />
            <span>Properties</span>
          </button>

          <button
            type="button"
            onClick={() => setTab('history')}
            className={`flex items-center justify-center gap-1.5 py-1.5 text-xs rounded transition-colors whitespace-nowrap shrink-0 ${
              tab === 'history'
                ? 'bg-[#1E232D] text-white font-medium'
                : 'text-[#9CA3AF] hover:text-white'
            }`}
          >
            <History className="w-3.5 h-3.5 text-blue-400" />
            <span>History</span>
          </button>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {tab === 'artist' && (
            <>
              {!activeTrack ? (
                <div className="py-10 text-center text-xs text-[#9CA3AF]">
                  Select or play a track to automatically fetch artist biography and discography from Wikipedia & MusicBrainz.
                </div>
              ) : (
                <>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-[11px] font-mono text-blue-400">
                        {bioData?.isLiveWeb ? 'Wikipedia / MusicBrainz' : 'Artist Profile'}
                      </div>
                      <h3 className="text-sm font-semibold text-white mt-0.5">
                        {bioData?.name || artistName}
                      </h3>
                      {(bioData?.country || bioData?.lifeSpan) && (
                        <div className="text-xs text-[#9CA3AF] mt-0.5">
                          {[bioData.country, bioData.lifeSpan].filter(Boolean).join(' · ')}
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={handleRefreshBio}
                      disabled={loadingBio}
                      className="p-1.5 text-[#9CA3AF] hover:text-white bg-[#0F1115] border border-[#262B36] rounded transition-colors"
                      title="Refresh artist metadata from web"
                    >
                      <RefreshCw
                        className={`w-3.5 h-3.5 ${loadingBio ? 'animate-spin text-blue-400' : ''}`}
                      />
                    </button>
                  </div>

                  {bioData?.imageUrl && (
                    <div className="rounded border border-[#262B36] overflow-hidden h-36 bg-[#0F1115]">
                      <img
                        src={bioData.imageUrl}
                        alt={bioData.name}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                      />
                    </div>
                  )}

                  {bioData?.disambiguation && (
                    <div className="text-xs text-[#D1D5DB] bg-[#0F1115] border border-[#262B36] rounded p-2.5">
                      {bioData.disambiguation}
                    </div>
                  )}

                  <div className="space-y-1">
                    <div className="text-xs font-medium text-[#D1D5DB]">Biography</div>
                    <p className="text-xs text-[#F3F4F6] leading-relaxed select-text">
                      {loadingBio
                        ? 'Fetching biography from Wikipedia and MusicBrainz...'
                        : bioData?.biography}
                    </p>
                  </div>

                  {bioData && bioData.tags.length > 0 && (
                    <div className="pt-2 border-t border-[#262B36]">
                      <div className="text-xs text-[#9CA3AF] mb-1">Genre Tags</div>
                      <div className="text-xs text-blue-400 leading-relaxed">
                        {bioData.tags.join(' · ')}
                      </div>
                    </div>
                  )}

                  {bioData && bioData.discography.length > 0 && (
                    <div className="pt-2 border-t border-[#262B36] space-y-1.5">
                      <div className="text-xs font-medium text-[#D1D5DB]">Discography</div>
                      <div className="space-y-1">
                        {bioData.discography.map((rel, idx) => (
                          <div
                            key={`${rel.title}-${idx}`}
                            className="flex items-center justify-between text-xs bg-[#0F1115] px-2.5 py-1.5 rounded border border-[#262B36]"
                          >
                            <div className="truncate pr-2">
                              <span className="text-white">{rel.title}</span>
                              <span className="mx-1.5 text-[#6B7280]">·</span>
                              <span className="text-xs text-[#9CA3AF]">{rel.type}</span>
                            </div>
                            <span className="font-mono tabular-nums text-xs text-blue-400 shrink-0">
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
                      className="inline-flex items-center gap-1.5 text-xs text-[#9CA3AF] hover:text-blue-400 pt-1 transition-colors"
                    >
                      <span>Open on Wikipedia / MusicBrainz</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </>
              )}
            </>
          )}

          {tab === 'stream' && (
            <>
              {!activeTrack ? (
                <div className="py-10 text-center text-xs text-[#9CA3AF]">
                  No track selected.
                </div>
              ) : (
                <div className="space-y-3.5">
                  <div className="flex items-center gap-3">
                    <AlbumArtwork
                      coverUrl={activeTrack.coverUrl}
                      album={activeTrack.album}
                      artist={activeTrack.artist}
                      className="w-14 h-14 rounded shrink-0"
                    />
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-white truncate">
                        {activeTrack.title}
                      </div>
                      <div className="text-xs text-[#D1D5DB] truncate">
                        {activeTrack.artist}
                      </div>
                      <div className="text-xs text-[#9CA3AF] truncate">
                        {activeTrack.album} ({activeTrack.year})
                      </div>
                    </div>
                  </div>

                  <div className="bg-[#0F1115] border border-[#262B36] rounded p-3 flex items-center justify-between">
                    <span className="text-xs text-[#D1D5DB]">Rating:</span>
                    <div className="flex items-center gap-1">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          key={star}
                          type="button"
                          onClick={() => onUpdateTrackRating(activeTrack.id, star)}
                          className="p-0.5 text-blue-400 hover:scale-110 transition-transform"
                        >
                          <Star
                            className={`w-4 h-4 ${
                              star <= activeTrack.rating
                                ? 'fill-blue-400 text-blue-400'
                                : 'text-[#374151]'
                            }`}
                          />
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="bg-[#0F1115] border border-[#262B36] rounded p-3 space-y-2">
                    <div className="text-xs font-medium text-[#D1D5DB]">
                      Custom Tags
                    </div>

                    {activeTrack.tags.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {activeTrack.tags.map((tag) => (
                          <button
                            key={tag}
                            type="button"
                            onClick={() => handleRemoveTag(tag)}
                            className="px-2 py-0.5 text-xs bg-[#161920] border border-[#262B36] rounded text-[#D1D5DB] hover:text-rose-400 transition-colors"
                            title="Click to remove tag"
                          >
                            {tag} ×
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="text-xs text-[#6B7280]">No tags assigned.</div>
                    )}

                    <form onSubmit={handleAddTag} className="flex items-center gap-1.5 pt-1">
                      <input
                        type="text"
                        value={newTagText}
                        onChange={(e) => setNewTagText(e.target.value)}
                        placeholder="Add custom tag..."
                        className="flex-1 px-2.5 py-1 text-xs bg-[#161920] border border-[#262B36] rounded text-white focus:outline-none focus:border-blue-500"
                      />
                      <button
                        type="submit"
                        className="p-1.5 bg-blue-600 text-white rounded hover:bg-blue-500"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </form>
                  </div>

                  <div className="bg-[#0F1115] border border-[#262B36] rounded p-3 space-y-1.5">
                    <div className="text-xs font-medium text-[#D1D5DB] mb-1">
                      Audio Stream Details
                    </div>
                    <div className="grid grid-cols-2 gap-y-1 text-xs">
                      <span className="text-[#9CA3AF]">Format:</span>
                      <span className="font-mono tabular-nums text-blue-400 text-right">
                        {activeTrack.format}
                      </span>

                      <span className="text-[#9CA3AF]">Sample Rate:</span>
                      <span className="font-mono tabular-nums text-white text-right">
                        {(activeTrack.sampleRate / 1000).toFixed(1)} kHz
                      </span>

                      <span className="text-[#9CA3AF]">Bit Depth:</span>
                      <span className="font-mono tabular-nums text-white text-right">
                        {activeTrack.bitDepth} bit ({activeTrack.channels} ch)
                      </span>

                      <span className="text-[#9CA3AF]">Bitrate:</span>
                      <span className="font-mono tabular-nums text-white text-right">
                        {activeTrack.bitrate} kbps
                      </span>

                      <span className="text-[#9CA3AF]">File Size:</span>
                      <span className="font-mono tabular-nums text-white text-right">
                        {activeTrack.fileSizeMB} MB
                      </span>
                    </div>

                    <div className="pt-2 mt-2 border-t border-[#262B36] text-[11px] font-mono text-[#9CA3AF] break-all">
                      <div className="flex items-center gap-1 text-[#D1D5DB] mb-0.5">
                        <FolderOpen className="w-3 h-3 text-blue-400 shrink-0" />
                        <span>File Location:</span>
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
                <span className="text-xs font-medium text-[#D1D5DB]">
                  Playback Log
                </span>
                <span className="text-xs font-mono tabular-nums text-[#9CA3AF]">
                  {history.length} plays
                </span>
              </div>

              {history.length === 0 ? (
                <div className="py-10 text-center text-xs text-[#9CA3AF]">
                  No tracks played yet.
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
                        className="bg-[#0F1115] border border-[#262B36] hover:border-blue-500 rounded p-2 cursor-pointer transition-colors"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs text-white font-medium truncate">
                            {entry.title}
                          </span>
                          <span className="text-[10px] font-mono tabular-nums text-[#9CA3AF] shrink-0">
                            {dateStr} {timeStr}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-xs text-[#9CA3AF] mt-0.5">
                          <span className="truncate">{entry.artist}</span>
                          <span className="font-mono text-[10px] text-blue-400 shrink-0">
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
