import React, { useState } from 'react';

interface AlbumArtworkProps {
  coverUrl?: string;
  album: string;
  artist: string;
  seed?: number;
  className?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

export const AlbumArtwork: React.FC<AlbumArtworkProps> = React.memo(
  ({ coverUrl, album, artist, className = '' }) => {
    const [imgError, setImgError] = useState(false);

    if (coverUrl && !imgError) {
      return (
        <div className={`relative overflow-hidden bg-[#161920] select-none ${className}`}>
          <img
            src={coverUrl}
            alt={`${artist} — ${album}`}
            referrerPolicy="no-referrer"
            onError={() => setImgError(true)}
            className="w-full h-full object-cover"
          />
        </div>
      );
    }

    return (
      <div
        className={`relative overflow-hidden select-none flex items-center justify-center bg-[var(--bg-base)] border border-[var(--text-dim)] text-[var(--text-dim)] font-mono text-[10px] font-bold uppercase ${className}`}
        title={`${artist} — ${album}`}
      >
        IJZ
      </div>
    );
  }
);
