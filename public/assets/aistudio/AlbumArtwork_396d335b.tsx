import React, { useState } from 'react';
import { Disc } from 'lucide-react';

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
        className={`relative overflow-hidden select-none flex items-center justify-center bg-[#161920] border border-[#262B36] text-[#4B5563] ${className}`}
        title={`${artist} — ${album}`}
      >
        <Disc className="w-1/2 h-1/2 stroke-[1.5]" />
      </div>
    );
  }
);
