import { AudioFormat, TrackItem } from '../types/audio';

interface ParsedAudioMetadata {
  title?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  trackNumber?: number;
  year?: number;
  genre?: string;
  sampleRate?: number;
  bitDepth?: number;
  channels?: number;
  duration?: number;
  bitrate?: number;
  coverUrl?: string;
}

/**
 * Fast binary FLAC / ID3v2 / WAV header parser.
 * Reads only the header slice needed to extract STREAMINFO and tags without blocking the UI thread.
 */
export async function parseAudioFileMetadata(
  file: File,
  extractEmbeddedPicture = false
): Promise<ParsedAudioMetadata> {
  const result: ParsedAudioMetadata = {};
  try {
    // Only read 64KB if folder already has cover.jpg, or 256KB if checking embedded cover
    const sliceSize = Math.min(file.size, extractEmbeddedPicture ? 256 * 1024 : 64 * 1024);
    const buffer = await file.slice(0, sliceSize).arrayBuffer();
    const view = new DataView(buffer);

    if (buffer.byteLength < 12) return result;

    const magic =
      String.fromCharCode(view.getUint8(0)) +
      String.fromCharCode(view.getUint8(1)) +
      String.fromCharCode(view.getUint8(2)) +
      String.fromCharCode(view.getUint8(3));

    if (magic === 'fLaC') {
      parseFlacBlocks(view, buffer, file.size, result, extractEmbeddedPicture);
      return result;
    }

    if (magic.startsWith('ID3')) {
      parseId3v2(view, buffer, file.size, result);
      return result;
    }

    if (magic === 'RIFF' && buffer.byteLength >= 44) {
      const waveMagic =
        String.fromCharCode(view.getUint8(8)) +
        String.fromCharCode(view.getUint8(9)) +
        String.fromCharCode(view.getUint8(10)) +
        String.fromCharCode(view.getUint8(11));
      if (waveMagic === 'WAVE') {
        const channels = view.getUint16(22, true);
        const sampleRate = view.getUint32(24, true);
        const byteRate = view.getUint32(28, true);
        const bitsPerSample = view.getUint16(34, true);
        result.channels = channels || 2;
        result.sampleRate = sampleRate || 44100;
        result.bitDepth = bitsPerSample || 16;
        if (byteRate > 0) {
          result.duration = Math.max(1, Math.round((file.size - 44) / byteRate));
          result.bitrate = Math.round((byteRate * 8) / 1000);
        }
      }
    }
  } catch {
    // Fallback to filename/folder parsing
  }
  return result;
}

function parseFlacBlocks(
  view: DataView,
  buffer: ArrayBuffer,
  totalFileSize: number,
  out: ParsedAudioMetadata,
  extractEmbeddedPicture: boolean
) {
  let offset = 4;
  let isLastBlock = false;
  const decoder = new TextDecoder('utf-8');

  while (!isLastBlock && offset + 4 <= buffer.byteLength) {
    const headerByte = view.getUint8(offset);
    isLastBlock = (headerByte & 0x80) !== 0;
    const blockType = headerByte & 0x7f;
    const blockLength =
      (view.getUint8(offset + 1) << 16) |
      (view.getUint8(offset + 2) << 8) |
      view.getUint8(offset + 3);

    offset += 4;
    if (offset + blockLength > buffer.byteLength) {
      break;
    }

    // Block 0: STREAMINFO
    if (blockType === 0 && blockLength >= 18) {
      const b10 = view.getUint8(offset + 10);
      const b11 = view.getUint8(offset + 11);
      const b12 = view.getUint8(offset + 12);
      const b13 = view.getUint8(offset + 13);
      const b14 = view.getUint8(offset + 14);
      const b15 = view.getUint8(offset + 15);
      const b16 = view.getUint8(offset + 16);
      const b17 = view.getUint8(offset + 17);

      const sampleRate = (b10 << 12) | (b11 << 4) | (b12 >> 4);
      const channels = ((b12 >> 1) & 0x07) + 1;
      const bitsPerSample = (((b12 & 0x01) << 4) | (b13 >> 4)) + 1;
      const totalSamplesHigh = b13 & 0x0f;
      const totalSamplesLow = b14 * 16777216 + (b15 << 16) + (b16 << 8) + b17;
      const totalSamples = totalSamplesHigh * 4294967296 + totalSamplesLow;

      if (sampleRate > 0) out.sampleRate = sampleRate;
      if (channels > 0) out.channels = channels;
      if (bitsPerSample > 0) out.bitDepth = bitsPerSample;
      if (sampleRate > 0 && totalSamples > 0) {
        const durationSec = Math.round(totalSamples / sampleRate);
        out.duration = Math.max(1, durationSec);
        out.bitrate = Math.round((totalFileSize * 8) / durationSec / 1000);
      }
    }

    // Block 4: VORBIS_COMMENT
    else if (blockType === 4) {
      try {
        let pos = offset;
        const vendorLen = view.getUint32(pos, true);
        pos += 4 + vendorLen;
        if (pos + 4 <= offset + blockLength) {
          const commentCount = view.getUint32(pos, true);
          pos += 4;

          for (let i = 0; i < commentCount && pos + 4 <= offset + blockLength; i++) {
            const len = view.getUint32(pos, true);
            pos += 4;
            if (pos + len > offset + blockLength) break;
            const commentBytes = new Uint8Array(buffer, pos, len);
            pos += len;
            const commentStr = decoder.decode(commentBytes);
            const eqIdx = commentStr.indexOf('=');
            if (eqIdx > 0) {
              const key = commentStr.slice(0, eqIdx).trim().toUpperCase();
              const val = commentStr.slice(eqIdx + 1).trim();
              if (!val) continue;
              if (key === 'TITLE') out.title = val;
              else if (key === 'ARTIST') out.artist = val;
              else if (key === 'ALBUM') out.album = val;
              else if (key === 'ALBUMARTIST' || key === 'ALBUM ARTIST') out.albumArtist = val;
              else if (key === 'GENRE') out.genre = val;
              else if (key === 'DATE' || key === 'YEAR') {
                const yr = parseInt(val.slice(0, 4), 10);
                if (!isNaN(yr)) out.year = yr;
              } else if (key === 'TRACKNUMBER' || key === 'TRACK') {
                const trk = parseInt(val.split('/')[0], 10);
                if (!isNaN(trk)) out.trackNumber = trk;
              }
            }
          }
        }
      } catch {
        // ignore
      }
    }

    // Block 6: PICTURE (only extract once per album folder to avoid memory bloat)
    else if (blockType === 6 && extractEmbeddedPicture && !out.coverUrl) {
      try {
        let pos = offset + 4;
        const mimeLen = view.getUint32(pos, false);
        pos += 4;
        const mimeBytes = new Uint8Array(buffer, pos, mimeLen);
        const mimeType = decoder.decode(mimeBytes) || 'image/jpeg';
        pos += mimeLen;
        const descLen = view.getUint32(pos, false);
        pos += 4 + descLen + 16;
        const dataLen = view.getUint32(pos, false);
        pos += 4;
        if (dataLen > 0 && pos + dataLen <= offset + blockLength) {
          const imgBytes = new Uint8Array(buffer, pos, dataLen);
          const blob = new Blob([imgBytes], { type: mimeType });
          out.coverUrl = URL.createObjectURL(blob);
        }
      } catch {
        // ignore
      }
    }

    offset += blockLength;
  }
}

function parseId3v2(
  view: DataView,
  buffer: ArrayBuffer,
  totalFileSize: number,
  out: ParsedAudioMetadata
) {
  const version = view.getUint8(3);
  const tagSize =
    ((view.getUint8(6) & 0x7f) << 21) |
    ((view.getUint8(7) & 0x7f) << 14) |
    ((view.getUint8(8) & 0x7f) << 7) |
    (view.getUint8(9) & 0x7f);

  const maxOffset = Math.min(buffer.byteLength, 10 + tagSize);
  let offset = 10;
  const utf8Decoder = new TextDecoder('utf-8');
  const utf16Decoder = new TextDecoder('utf-16');

  while (offset + 10 <= maxOffset) {
    const frameId =
      String.fromCharCode(view.getUint8(offset)) +
      String.fromCharCode(view.getUint8(offset + 1)) +
      String.fromCharCode(view.getUint8(offset + 2)) +
      String.fromCharCode(view.getUint8(offset + 3));

    if (!/^[A-Z0-9]{4}$/.test(frameId)) break;

    let frameSize = view.getUint32(offset + 4, false);
    if (version === 4) {
      frameSize =
        ((view.getUint8(offset + 4) & 0x7f) << 21) |
        ((view.getUint8(offset + 5) & 0x7f) << 14) |
        ((view.getUint8(offset + 6) & 0x7f) << 7) |
        (view.getUint8(offset + 7) & 0x7f);
    }

    offset += 10;
    if (frameSize <= 0 || offset + frameSize > maxOffset) break;

    if (frameId.startsWith('T')) {
      const encoding = view.getUint8(offset);
      const textBytes = new Uint8Array(buffer, offset + 1, frameSize - 1);
      let text = '';
      try {
        text =
          encoding === 1 || encoding === 2
            ? utf16Decoder.decode(textBytes)
            : utf8Decoder.decode(textBytes);
        text = text.replace(/\0/g, '').trim();
      } catch {
        text = '';
      }

      if (text) {
        if (frameId === 'TIT2') out.title = text;
        else if (frameId === 'TPE1') out.artist = text;
        else if (frameId === 'TALB') out.album = text;
        else if (frameId === 'TCON') out.genre = text;
        else if (frameId === 'TYER' || frameId === 'TDRC') {
          const yr = parseInt(text.slice(0, 4), 10);
          if (!isNaN(yr)) out.year = yr;
        } else if (frameId === 'TRCK') {
          const trk = parseInt(text.split('/')[0], 10);
          if (!isNaN(trk)) out.trackNumber = trk;
        }
      }
    }

    offset += frameSize;
  }

  out.sampleRate = 44100;
  out.bitDepth = 16;
  out.bitrate = 320;
  out.duration = Math.max(30, Math.round((totalFileSize * 8) / (320 * 1000)));
}

const naturalCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});

export async function processDirectoryFiles(
  files: File[],
  onProgress?: (processed: number, total: number) => void
): Promise<TrackItem[]> {
  const audioExtensions = /\.(flac|wav|mp3|ogg|m4a|alac|aac)$/i;
  const imageExtensions = /^(cover|folder|front|album|art|artwork)\.(jpg|jpeg|png|webp)$/i;

  const audioFiles: { file: File; relPath: string }[] = [];
  const folderCovers = new Map<string, string>();

  for (const file of files) {
    const relPath = (file.webkitRelativePath || file.name).replace(/\\/g, '/');
    const parts = relPath.split('/');
    const fileName = parts[parts.length - 1];
    const folderPath = parts.length > 1 ? '/' + parts.slice(0, -1).join('/') : '/Library';

    if (imageExtensions.test(fileName)) {
      if (!folderCovers.has(folderPath)) {
        folderCovers.set(folderPath, URL.createObjectURL(file));
      }
    } else if (audioExtensions.test(fileName)) {
      audioFiles.push({ file, relPath });
    }
  }

  const tracks: TrackItem[] = [];
  const total = audioFiles.length;
  const nowIso = new Date().toISOString();

  for (let i = 0; i < total; i++) {
    const { file, relPath } = audioFiles[i];

    // Yield to browser UI every 25 files so large libraries never freeze the UI
    if (i > 0 && i % 25 === 0) {
      if (onProgress) onProgress(i, total);
      await new Promise((r) => setTimeout(r, 0));
    }

    const parts = relPath.split('/');
    const fileName = parts[parts.length - 1];
    const folderPath = parts.length > 1 ? '/' + parts.slice(0, -1).join('/') : '/Library';
    const albumFolderName = parts.length >= 2 ? parts[parts.length - 2] : 'Single Tracks';
    const parentArtistFolder = parts.length >= 3 ? parts[parts.length - 3] : undefined;

    const extMatch = fileName.match(/\.([a-z0-9]+)$/i);
    const ext = (extMatch ? extMatch[1].toUpperCase() : 'FLAC') as AudioFormat;

    // Only extract embedded FLAC picture if this folder doesn't have a cover yet
    const needsCover = !folderCovers.has(folderPath);
    const meta = await parseAudioFileMetadata(file, needsCover);
    if (needsCover && meta.coverUrl) {
      folderCovers.set(folderPath, meta.coverUrl);
    }

    const baseName = fileName.replace(/\.[^/.]+$/, '');
    let inferredTrackNum = i + 1;
    let inferredTitle = baseName;
    const trackMatch = baseName.match(/^(\d{1,3})[\s._-]+(.+)$/);
    if (trackMatch) {
      inferredTrackNum = parseInt(trackMatch[1], 10);
      inferredTitle = trackMatch[2].trim();
    }

    let inferredAlbum = albumFolderName;
    let inferredYear = new Date().getFullYear();
    const albumYearPrefix = albumFolderName.match(/^[\[(]?(\d{4})[\])]?[\s._-]+(.+)$/);
    const albumYearSuffix = albumFolderName.match(/^(.+?)[\s._-]*[\[(](\d{4})[\])]$/);
    if (albumYearPrefix) {
      inferredYear = parseInt(albumYearPrefix[1], 10);
      inferredAlbum = albumYearPrefix[2].trim();
    } else if (albumYearSuffix) {
      inferredAlbum = albumYearSuffix[1].trim();
      inferredYear = parseInt(albumYearSuffix[2], 10);
    }

    const finalFormat: AudioFormat = ['FLAC', 'WAV', 'MP3', 'OGG', 'M4A', 'ALAC'].includes(ext)
      ? ext
      : 'FLAC';
    const isLossless = finalFormat === 'FLAC' || finalFormat === 'WAV' || finalFormat === 'ALAC';
    const sampleRate = meta.sampleRate || 44100;
    const bitDepth = meta.bitDepth || 16;
    const fileSizeMB = Number((file.size / (1024 * 1024)).toFixed(1));
    const estimatedBitrate = meta.bitrate || (isLossless ? 950 : 320);
    const estimatedDuration =
      meta.duration || Math.max(1, Math.round((file.size * 8) / (estimatedBitrate * 1000)));

    tracks.push({
      id: `trk-${Date.now()}-${i}`,
      title: meta.title || inferredTitle,
      artist: meta.artist || meta.albumArtist || parentArtistFolder || 'Unknown Artist',
      album: meta.album || inferredAlbum,
      albumArtist: meta.albumArtist || parentArtistFolder,
      trackNumber: meta.trackNumber || inferredTrackNum,
      year: meta.year || inferredYear,
      genre: meta.genre || 'Unclassified',
      format: finalFormat,
      sampleRate,
      bitDepth,
      bitrate: estimatedBitrate,
      channels: meta.channels || 2,
      duration: estimatedDuration,
      folderPath,
      fileName,
      fileSizeMB,
      rating: 0,
      playCount: 0,
      addedAt: nowIso,
      tags: [],
      coverUrl: folderCovers.get(folderPath),
      artworkSeed: i,
      fileRef: file,
    });
  }

  if (onProgress) onProgress(total, total);

  return tracks.sort((a, b) => {
    const folderCmp = naturalCollator.compare(a.folderPath, b.folderPath);
    if (folderCmp !== 0) return folderCmp;
    return a.trackNumber - b.trackNumber;
  });
}
