import { AudioFormat, TrackItem } from '../types/audio';
import { terminalLogger } from './terminalLogger';

const SUPPORTED_EXTENSIONS = new Set([
  'flac',
  'wav',
  'mp3',
  'ogg',
  'oga',
  'opus',
  'm4a',
  'mp4',
  'm4b',
  'alac',
  'aac',
  'aiff',
  'aif',
  'wv',
  'ape',
  'wma',
  'webm',
  'weba',
  'dsf',
  'dff',
  'mka',
]);

const ID3_GENRE_MAP: Record<number, string> = {
  0: 'Blues',
  1: 'Classic Rock',
  2: 'Country',
  3: 'Dance',
  4: 'Disco',
  5: 'Funk',
  6: 'Grunge',
  7: 'Hip-Hop',
  8: 'Jazz',
  9: 'Metal',
  10: 'New Age',
  11: 'Oldies',
  12: 'Other',
  13: 'Pop',
  14: 'R&B',
  15: 'Rap',
  16: 'Reggae',
  17: 'Rock',
  18: 'Techno',
  19: 'Industrial',
  20: 'Alternative',
  21: 'Ska',
  22: 'Death Metal',
  23: 'Pranks',
  24: 'Soundtrack',
  25: 'Euro-Techno',
  26: 'Ambient',
  27: 'Trip-Hop',
  28: 'Vocal',
  29: 'Jazz+Funk',
  30: 'Fusion',
  31: 'Trance',
  32: 'Classical',
  33: 'Instrumental',
  34: 'Acid',
  35: 'House',
  36: 'Game',
  37: 'Sound Clip',
  38: 'Gospel',
  39: 'Noise',
  40: 'AlternRock',
  41: 'Bass',
  42: 'Soul',
  43: 'Punk',
  44: 'Space',
  45: 'Meditative',
  46: 'Instrumental Pop',
  47: 'Instrumental Rock',
  48: 'Ethnic',
  49: 'Gothic',
  50: 'Darkwave',
  51: 'Techno-Industrial',
  52: 'Electronic',
  53: 'Pop-Folk',
  54: 'Eurodance',
  55: 'Dream',
  56: 'Southern Rock',
  57: 'Comedy',
  58: 'Cult',
  59: 'Gangsta',
  60: 'Top 40',
  61: 'Christian Rap',
  62: 'Pop/Funk',
  63: 'Jungle',
  64: 'Native American',
  65: 'Cabaret',
  66: 'New Wave',
  67: 'Psychadelic',
  68: 'Rave',
  69: 'Showtunes',
  70: 'Trailer',
  71: 'Lo-Fi',
  72: 'Tribal',
  73: 'Acid Punk',
  74: 'Acid Jazz',
  75: 'Polka',
  76: 'Retro',
  77: 'Musical',
  78: 'Rock & Roll',
  79: 'Hard Rock',
  131: 'Indie',
  146: 'Synthpop',
};

function normalizeGenre(raw?: string): string {
  if (!raw) return 'Unknown';
  const cleaned = raw.replace(/\0/g, '').trim();
  if (!cleaned) return 'Unknown';
  const parenMatch = cleaned.match(/^\((\d+)\)(.*)$/);
  if (parenMatch) {
    const code = parseInt(parenMatch[1], 10);
    const suffix = parenMatch[2].trim();
    if (suffix) return suffix;
    return ID3_GENRE_MAP[code] || `Genre #${code}`;
  }
  if (/^\d+$/.test(cleaned)) {
    const code = parseInt(cleaned, 10);
    return ID3_GENRE_MAP[code] || cleaned;
  }
  return cleaned;
}

interface ParsedAudioHeader {
  title?: string;
  artist?: string;
  album?: string;
  genre?: string;
  year?: number;
  trackNumber?: number;
  sampleRate?: number;
  bitDepth?: number;
  channels?: number;
  duration?: number;
  coverDataUrl?: string;
  lyrics?: string;
}

function getExtension(fileName: string): string {
  const cleaned = fileName.trim().toLowerCase();
  const dotIdx = cleaned.lastIndexOf('.');
  return dotIdx > 0 ? cleaned.slice(dotIdx + 1) : '';
}

function getBaseNameWithoutExt(fileName: string): string {
  return fileName.replace(/\.[^/.]+$/, '');
}

function detectFormat(ext: string): AudioFormat {
  switch (ext) {
    case 'flac':
    case 'wv':
    case 'ape':
      return 'FLAC';
    case 'wav':
    case 'aiff':
    case 'aif':
      return 'WAV';
    case 'm4a':
    case 'mp4':
    case 'm4b':
    case 'alac':
      return 'ALAC';
    case 'ogg':
    case 'oga':
    case 'opus':
    case 'webm':
    case 'weba':
      return 'OGG';
    case 'aac':
      return 'AAC';
    default:
      return 'MP3';
  }
}

function inferFromFilename(fileName: string, folderPath: string) {
  const baseName = getBaseNameWithoutExt(fileName);
  const folderParts = folderPath.split(/[\\/]/).filter(Boolean);
  const albumFromFolder =
    folderParts.length > 0 ? folderParts[folderParts.length - 1] : 'Unknown Album';
  const artistFromFolder =
    folderParts.length > 1 ? folderParts[folderParts.length - 2] : 'Unknown Artist';

  let trackNumber = 1;
  let title = baseName;
  let artist = artistFromFolder;

  const numPrefixMatch = baseName.match(/^(\d{1,3})[\s._-]+(.+)$/);
  if (numPrefixMatch) {
    trackNumber = parseInt(numPrefixMatch[1], 10) || 1;
    const rest = numPrefixMatch[2].trim();
    const dashParts = rest.split(/\s+[-–—]\s+/);
    if (dashParts.length >= 2) {
      artist = dashParts[0].trim();
      title = dashParts.slice(1).join(' - ').trim();
    } else {
      title = rest;
    }
  } else {
    const dashParts = baseName.split(/\s+[-–—]\s+/);
    if (dashParts.length >= 2) {
      artist = dashParts[0].trim();
      title = dashParts.slice(1).join(' - ').trim();
    }
  }

  return {
    trackNumber,
    title: title || baseName,
    artist: artist || 'Unknown Artist',
    album: albumFromFolder,
  };
}

function parseVorbisCommentsBlock(
  bytes: Uint8Array,
  view: DataView,
  offset: number,
  blockLength: number,
  result: ParsedAudioHeader
) {
  const decoder = new TextDecoder('utf-8');
  let p = offset;
  if (p + 4 > offset + blockLength) return;
  const vendorLen = view.getUint32(p, true);
  p += 4 + vendorLen;
  if (p + 4 > offset + blockLength) return;
  const commentCount = view.getUint32(p, true);
  p += 4;
  for (let i = 0; i < commentCount && p + 4 <= offset + blockLength; i++) {
    const cLen = view.getUint32(p, true);
    p += 4;
    if (p + cLen > offset + blockLength) break;
    const rawComment = decoder.decode(bytes.subarray(p, p + cLen));
    p += cLen;
    const eqIdx = rawComment.indexOf('=');
    if (eqIdx > 0) {
      const key = rawComment.slice(0, eqIdx).trim().toUpperCase();
      const val = rawComment.slice(eqIdx + 1).trim();
      if (!val) continue;
      if (key === 'TITLE') result.title = val;
      else if (key === 'ARTIST' || (key === 'ALBUMARTIST' && !result.artist))
        result.artist = val;
      else if (key === 'ALBUM') result.album = val;
      else if (key === 'GENRE' || key === 'STYLE')
        result.genre = normalizeGenre(val);
      else if (
        key === 'LYRICS' ||
        key === 'UNSYNCEDLYRICS' ||
        key === 'SYNCEDLYRICS'
      )
        result.lyrics = val;
      else if (key === 'DATE' || key === 'YEAR' || key === 'ORIGINALDATE') {
        const yr = parseInt(val.slice(0, 4), 10);
        if (yr > 1900 && yr < 2100) result.year = yr;
      } else if (key === 'TRACKNUMBER' || key === 'TRACK') {
        const tn = parseInt(val.split('/')[0], 10);
        if (tn > 0) result.trackNumber = tn;
      }
    }
  }
}

/**
 * Chunk-based FLAC metadata reader:
 * - Handles FLAC files that have a leading ID3v2 header before the 'fLaC' stream marker
 * - Reads 4-byte block headers on demand so large PICTURE / SEEKTABLE / PADDING blocks
 *   never truncate or skip VORBIS_COMMENT blocks.
 */
async function parseFlacMetadata(
  file: File,
  skipCover = false
): Promise<ParsedAudioHeader> {
  const result: ParsedAudioHeader = {};
  try {
    const initialProbeSize = Math.min(file.size, 65536);
    const probeBuf = await file.slice(0, initialProbeSize).arrayBuffer();
    const probeBytes = new Uint8Array(probeBuf);

    if (probeBytes.length < 42) return result;

    let flacOffset = -1;

    // 1. Check if FLAC file starts with an ID3v2 header ('ID3')
    if (
      probeBytes[0] === 0x49 &&
      probeBytes[1] === 0x44 &&
      probeBytes[2] === 0x33
    ) {
      const id3TagSize =
        ((probeBytes[6] & 0x7f) << 21) |
        ((probeBytes[7] & 0x7f) << 14) |
        ((probeBytes[8] & 0x7f) << 7) |
        (probeBytes[9] & 0x7f);
      const afterId3 = 10 + id3TagSize;

      // Also extract any ID3v2 fallback fields
      const id3Fallback = await parseId3Metadata(file, skipCover);
      Object.assign(result, id3Fallback);

      if (afterId3 + 4 <= file.size) {
        const magicSlice = new Uint8Array(
          await file.slice(afterId3, afterId3 + 4).arrayBuffer()
        );
        if (
          magicSlice.length === 4 &&
          magicSlice[0] === 0x66 &&
          magicSlice[1] === 0x4c &&
          magicSlice[2] === 0x61 &&
          magicSlice[3] === 0x43
        ) {
          flacOffset = afterId3 + 4;
        }
      }
    }

    // 2. Locate 'fLaC' magic bytes in initial probe buffer
    if (flacOffset === -1) {
      for (let i = 0; i <= probeBytes.length - 4; i++) {
        if (
          probeBytes[i] === 0x66 &&
          probeBytes[i + 1] === 0x4c &&
          probeBytes[i + 2] === 0x61 &&
          probeBytes[i + 3] === 0x43
        ) {
          flacOffset = i + 4;
          break;
        }
      }
    }

    if (flacOffset === -1) return result;

    let offset = flacOffset;
    let isLast = false;
    let blocksVisited = 0;
    const decoder = new TextDecoder('utf-8');

    while (!isLast && offset + 4 <= file.size && blocksVisited < 32) {
      blocksVisited++;
      let hdrBytes: Uint8Array;
      if (offset + 4 <= probeBytes.length) {
        hdrBytes = probeBytes.subarray(offset, offset + 4);
      } else {
        hdrBytes = new Uint8Array(
          await file.slice(offset, offset + 4).arrayBuffer()
        );
      }
      if (hdrBytes.length < 4) break;

      const headerByte = hdrBytes[0];
      isLast = (headerByte & 0x80) !== 0;
      const blockType = headerByte & 0x7f;
      const blockLength =
        (hdrBytes[1] << 16) | (hdrBytes[2] << 8) | hdrBytes[3];
      offset += 4;

      if (blockLength < 0 || offset + blockLength > file.size) break;

      if (blockType === 0 && blockLength >= 34) {
        const sBuf =
          offset + 34 <= probeBytes.length
            ? probeBuf.slice(offset, offset + 34)
            : await file.slice(offset, offset + 34).arrayBuffer();
        const sBytes = new Uint8Array(sBuf);
        const sView = new DataView(sBuf);

        const b10 = sBytes[10];
        const b11 = sBytes[11];
        const b12 = sBytes[12];
        const b13 = sBytes[13];

        const sampleRate = (b10 << 12) | (b11 << 4) | (b12 >> 4);
        const channels = ((b12 >> 1) & 0x07) + 1;
        const bitDepth = (((b12 & 0x01) << 4) | (b13 >> 4)) + 1;

        const highSamples = b13 & 0x0f;
        const lowSamples = sView.getUint32(14, false);
        const totalSamples = highSamples * 4294967296 + lowSamples;

        if (sampleRate > 0) {
          result.sampleRate = sampleRate;
          if (totalSamples > 0) {
            result.duration = totalSamples / sampleRate;
          }
        }
        result.channels = channels;
        result.bitDepth = bitDepth;
      } else if (
        blockType === 4 &&
        blockLength > 0 &&
        blockLength <= 2 * 1024 * 1024
      ) {
        const vBuf =
          offset + blockLength <= probeBytes.length
            ? probeBuf.slice(offset, offset + blockLength)
            : await file.slice(offset, offset + blockLength).arrayBuffer();
        const vBytes = new Uint8Array(vBuf);
        const vView = new DataView(vBuf);
        parseVorbisCommentsBlock(vBytes, vView, 0, blockLength, result);
        if (skipCover || result.coverDataUrl) break;
      } else if (
        blockType === 6 &&
        !skipCover &&
        !result.coverDataUrl &&
        blockLength > 32 &&
        blockLength <= 6 * 1024 * 1024
      ) {
        const pBuf = await file
          .slice(offset, offset + blockLength)
          .arrayBuffer();
        const pBytes = new Uint8Array(pBuf);
        const pView = new DataView(pBuf);
        let p = 4;
        if (p + 4 <= blockLength) {
          const mimeLen = pView.getUint32(p, false);
          p += 4;
          if (p + mimeLen + 4 <= blockLength) {
            const mime =
              decoder.decode(pBytes.subarray(p, p + mimeLen)) || 'image/jpeg';
            p += mimeLen;
            const descLen = pView.getUint32(p, false);
            p += 4 + descLen + 16;
            if (p + 4 <= blockLength) {
              const picDataLen = pView.getUint32(p, false);
              p += 4;
              if (picDataLen > 0 && p + picDataLen <= blockLength) {
                const picBytes = pBytes.slice(p, p + picDataLen);
                const blob = new Blob([picBytes], { type: mime });
                result.coverDataUrl = URL.createObjectURL(blob);
              }
            }
          }
        }
        if (result.title) break;
      }

      offset += blockLength;
    }
  } catch {
    // Ignore partial header errors
  }
  return result;
}

async function parseOggMetadata(file: File): Promise<ParsedAudioHeader> {
  const result: ParsedAudioHeader = {};
  try {
    const sliceSize = Math.min(file.size, 96 * 1024);
    const buf = await file.slice(0, sliceSize).arrayBuffer();
    const bytes = new Uint8Array(buf);
    const view = new DataView(buf);
    for (let i = 0; i < bytes.length - 16; i++) {
      if (
        bytes[i] === 0x03 &&
        bytes[i + 1] === 0x76 &&
        bytes[i + 2] === 0x6f &&
        bytes[i + 3] === 0x72 &&
        bytes[i + 4] === 0x62 &&
        bytes[i + 5] === 0x69 &&
        bytes[i + 6] === 0x73
      ) {
        parseVorbisCommentsBlock(
          bytes,
          view,
          i + 7,
          bytes.length - (i + 7),
          result
        );
        break;
      }
    }
  } catch {
    // Ignore
  }
  return result;
}

async function parseWavMetadata(file: File): Promise<ParsedAudioHeader> {
  const result: ParsedAudioHeader = {};
  try {
    const buf = await file.slice(0, 32 * 1024).arrayBuffer();
    const view = new DataView(buf);
    const bytes = new Uint8Array(buf);
    if (
      bytes.length >= 44 &&
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46
    ) {
      const channels = view.getUint16(22, true);
      const sampleRate = view.getUint32(24, true);
      const byteRate = view.getUint32(28, true);
      const bitDepth = view.getUint16(34, true);
      if (sampleRate > 0) result.sampleRate = sampleRate;
      if (channels > 0) result.channels = channels;
      if (bitDepth > 0) result.bitDepth = bitDepth;
      if (byteRate > 0)
        result.duration = Math.max(1, (file.size - 44) / byteRate);
    }
  } catch {
    // Ignore
  }
  return result;
}

function decodeId3String(bytes: Uint8Array, encodingByte: number): string {
  try {
    if (encodingByte === 1 || encodingByte === 2) {
      return new TextDecoder('utf-16').decode(bytes).replace(/\0/g, '').trim();
    }
    if (encodingByte === 3) {
      return new TextDecoder('utf-8').decode(bytes).replace(/\0/g, '').trim();
    }
    const utf8Attempt = new TextDecoder('utf-8', { fatal: true });
    try {
      return utf8Attempt.decode(bytes).replace(/\0/g, '').trim();
    } catch {
      return new TextDecoder('windows-1251')
        .decode(bytes)
        .replace(/\0/g, '')
        .trim();
    }
  } catch {
    return '';
  }
}

const MPEG1_L3_BITRATES = [
  0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0,
];
const MPEG1_SAMPLERATES = [44100, 48000, 32000, 0];

function estimateMp3DurationFromFrames(
  bytes: Uint8Array,
  view: DataView,
  audioOffset: number,
  fileSize: number,
  result: ParsedAudioHeader
) {
  const maxScan = Math.min(bytes.length - 4, audioOffset + 8192);
  for (let p = Math.max(0, audioOffset); p < maxScan; p++) {
    if (bytes[p] === 0xff && (bytes[p + 1] & 0xe0) === 0xe0) {
      const b1 = bytes[p + 1];
      const b2 = bytes[p + 2];
      const versionBits = (b1 >> 3) & 0x03;
      const layerBits = (b1 >> 1) & 0x03;
      const bitrateIdx = (b2 >> 4) & 0x0f;
      const srIdx = (b2 >> 2) & 0x03;
      if (
        versionBits === 3 &&
        layerBits === 1 &&
        bitrateIdx > 0 &&
        bitrateIdx < 15 &&
        srIdx < 3
      ) {
        const kbps = MPEG1_L3_BITRATES[bitrateIdx];
        const sr = MPEG1_SAMPLERATES[srIdx];
        if (sr > 0) result.sampleRate = sr;

        const xingEnd = Math.min(bytes.length - 12, p + 64);
        for (let x = p + 4; x < xingEnd; x++) {
          const isXing =
            (bytes[x] === 0x58 &&
              bytes[x + 1] === 0x69 &&
              bytes[x + 2] === 0x6e &&
              bytes[x + 3] === 0x67) ||
            (bytes[x] === 0x49 &&
              bytes[x + 1] === 0x6e &&
              bytes[x + 2] === 0x66 &&
              bytes[x + 3] === 0x6f);
          if (isXing) {
            const flags = view.getUint32(x + 4, false);
            if (flags & 0x01) {
              const totalFrames = view.getUint32(x + 8, false);
              if (totalFrames > 0 && sr > 0) {
                result.duration = (totalFrames * 1152) / sr;
                return;
              }
            }
          }
        }

        if (kbps > 0) {
          const audioBytes = Math.max(1000, fileSize - audioOffset);
          result.duration = Math.max(1, (audioBytes * 8) / (kbps * 1000));
        }
        return;
      }
    }
  }
}

async function parseId3Metadata(
  file: File,
  skipCover = false
): Promise<ParsedAudioHeader> {
  const result: ParsedAudioHeader = {};
  try {
    const sliceSize = Math.min(
      file.size,
      skipCover ? 96 * 1024 : 768 * 1024
    );
    const buf = await file.slice(0, sliceSize).arrayBuffer();
    const bytes = new Uint8Array(buf);
    const view = new DataView(buf);

    if (
      bytes.length < 10 ||
      bytes[0] !== 0x49 ||
      bytes[1] !== 0x44 ||
      bytes[2] !== 0x33
    ) {
      estimateMp3DurationFromFrames(bytes, view, 0, file.size, result);
      return result;
    }

    const version = bytes[3];
    const tagSize =
      ((bytes[6] & 0x7f) << 21) |
      ((bytes[7] & 0x7f) << 14) |
      ((bytes[8] & 0x7f) << 7) |
      (bytes[9] & 0x7f);

    const limit = Math.min(bytes.length, 10 + tagSize);
    let offset = 10;

    const decodeTextFrame = (frameBytes: Uint8Array): string => {
      if (frameBytes.length <= 1) return '';
      return decodeId3String(frameBytes.subarray(1), frameBytes[0]);
    };

    while (offset + 10 <= limit) {
      const frameId = String.fromCharCode(
        bytes[offset],
        bytes[offset + 1],
        bytes[offset + 2],
        bytes[offset + 3]
      );
      if (!/^[A-Z0-9]{4}$/.test(frameId)) break;

      const frameSize =
        version === 4
          ? ((bytes[offset + 4] & 0x7f) << 21) |
            ((bytes[offset + 5] & 0x7f) << 14) |
            ((bytes[offset + 6] & 0x7f) << 7) |
            (bytes[offset + 7] & 0x7f)
          : view.getUint32(offset + 4, false);

      offset += 10;
      if (frameSize <= 0 || offset + frameSize > limit) break;

      const frameData = bytes.subarray(offset, offset + frameSize);
      if (frameId === 'TIT2') result.title = decodeTextFrame(frameData);
      else if (frameId === 'TPE1' || (frameId === 'TPE2' && !result.artist))
        result.artist = decodeTextFrame(frameData);
      else if (frameId === 'TALB') result.album = decodeTextFrame(frameData);
      else if (frameId === 'TCON')
        result.genre = normalizeGenre(decodeTextFrame(frameData));
      else if (frameId === 'TYER' || frameId === 'TDRC') {
        const yr = parseInt(decodeTextFrame(frameData).slice(0, 4), 10);
        if (yr > 1900 && yr < 2100) result.year = yr;
      } else if (frameId === 'TRCK') {
        const tn = parseInt(decodeTextFrame(frameData).split('/')[0], 10);
        if (tn > 0) result.trackNumber = tn;
      } else if (frameId === 'TLEN') {
        const ms = parseInt(decodeTextFrame(frameData), 10);
        if (ms > 0) result.duration = ms / 1000;
      } else if (frameId === 'USLT' && frameData.length > 4) {
        const enc = frameData[0];
        let p = 4;
        if (enc === 1 || enc === 2) {
          while (
            p + 1 < frameData.length &&
            !(frameData[p] === 0 && frameData[p + 1] === 0)
          ) {
            p += 2;
          }
          p += 2;
        } else {
          while (p < frameData.length && frameData[p] !== 0) p++;
          p += 1;
        }
        if (p < frameData.length) {
          const lyr = decodeId3String(frameData.subarray(p), enc);
          if (lyr) result.lyrics = lyr;
        }
      } else if (
        frameId === 'TXXX' &&
        frameData.length > 2 &&
        !result.lyrics
      ) {
        const fullText = decodeTextFrame(frameData);
        if (fullText.toUpperCase().startsWith('LYRICS')) {
          result.lyrics = fullText.replace(/^LYRICS[:\s]*/i, '').trim();
        }
      } else if (
        frameId === 'APIC' &&
        !skipCover &&
        !result.coverDataUrl &&
        frameData.length > 16
      ) {
        let p = 1;
        let mime = '';
        while (p < frameData.length && frameData[p] !== 0) {
          mime += String.fromCharCode(frameData[p]);
          p++;
        }
        p++;
        p++;
        const enc = frameData[0];
        if (enc === 1 || enc === 2) {
          while (
            p + 1 < frameData.length &&
            !(frameData[p] === 0 && frameData[p + 1] === 0)
          ) {
            p += 2;
          }
          p += 2;
        } else {
          while (p < frameData.length && frameData[p] !== 0) p++;
          p++;
        }
        if (p < frameData.length && frameData.length - p <= 2 * 1024 * 1024) {
          const imgBytes = frameData.slice(p);
          const blob = new Blob([imgBytes], { type: mime || 'image/jpeg' });
          result.coverDataUrl = URL.createObjectURL(blob);
        }
      }

      offset += frameSize;
    }

    if (!result.duration && 10 + tagSize < bytes.length) {
      estimateMp3DurationFromFrames(
        bytes,
        view,
        10 + tagSize,
        file.size,
        result
      );
    }
  } catch {
    // Ignore ID3 errors
  }
  return result;
}

async function parseMp4Metadata(file: File): Promise<ParsedAudioHeader> {
  const result: ParsedAudioHeader = {};
  try {
    const sliceSize = Math.min(file.size, 128 * 1024);
    const buf = await file.slice(0, sliceSize).arrayBuffer();
    const bytes = new Uint8Array(buf);
    const view = new DataView(buf);
    const decoder = new TextDecoder('utf-8');

    const readAtomText = (start: number, atomSize: number): string => {
      for (let p = start + 8; p + 16 < start + atomSize; p++) {
        if (
          bytes[p + 4] === 0x64 &&
          bytes[p + 5] === 0x61 &&
          bytes[p + 6] === 0x74 &&
          bytes[p + 7] === 0x61
        ) {
          const dataSize = view.getUint32(p, false);
          const payloadStart = p + 16;
          const payloadEnd = Math.min(start + atomSize, p + dataSize);
          if (payloadEnd > payloadStart) {
            return decoder
              .decode(bytes.subarray(payloadStart, payloadEnd))
              .replace(/\0/g, '')
              .trim();
          }
        }
      }
      return '';
    };

    for (let i = 0; i < bytes.length - 16; i++) {
      if (bytes[i + 4] === 0xa9) {
        const atomCode = String.fromCharCode(
          bytes[i + 5],
          bytes[i + 6],
          bytes[i + 7]
        );
        const atomSize = view.getUint32(i, false);
        if (atomSize > 16 && atomSize < 262144 && i + atomSize <= bytes.length) {
          const text = readAtomText(i, atomSize);
          if (text) {
            if (atomCode === 'nam') result.title = text;
            else if (atomCode === 'ART') result.artist = text;
            else if (atomCode === 'alb') result.album = text;
            else if (atomCode === 'gen') result.genre = normalizeGenre(text);
            else if (atomCode === 'lyr') result.lyrics = text;
            else if (atomCode === 'day') {
              const yr = parseInt(text.slice(0, 4), 10);
              if (yr > 1900 && yr < 2100) result.year = yr;
            }
          }
        }
      }
    }
  } catch {
    // Ignore MP4 atom errors
  }
  return result;
}

export async function processDirectoryFiles(
  fileList: FileList | File[],
  onProgress?: (processed: number, total: number, currentFile: string) => void
): Promise<TrackItem[]> {
  const files = Array.from(fileList);
  const audioFiles: File[] = [];
  const folderCoverMap = new Map<string, string>();
  const lyricsSidecarMap = new Map<string, string>();

  for (const file of files) {
    const ext = getExtension(file.name);
    const relPath =
      (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
      file.name;
    const folderPath =
      relPath.includes('/') || relPath.includes('\\')
        ? relPath.replace(/[\\/][^\\/]+$/, '')
        : 'ROOT_DIR';

    const isSupportedAudio =
      SUPPORTED_EXTENSIONS.has(ext) ||
      Boolean(file.type && file.type.toLowerCase().startsWith('audio/'));

    if (isSupportedAudio) {
      audioFiles.push(file);
    } else if (
      ['jpg', 'jpeg', 'png', 'webp'].includes(ext) &&
      file.size <= 6 * 1024 * 1024 &&
      !folderCoverMap.has(folderPath)
    ) {
      try {
        const blobUrl = URL.createObjectURL(file);
        folderCoverMap.set(folderPath, blobUrl);
      } catch {
        // Ignore cover error
      }
    } else if (
      (ext === 'lrc' || ext === 'txt') &&
      file.size <= 256 * 1024
    ) {
      try {
        const text = await file.text();
        if (text.trim()) {
          const key = `${folderPath}/${getBaseNameWithoutExt(
            file.name
          ).toLowerCase()}`;
          lyricsSidecarMap.set(key, text.trim());
        }
      } catch {
        // Ignore lyrics read error
      }
    }
  }

  terminalLogger.log(
    'IO',
    `Directory scan: found ${audioFiles.length} audio files (${files.length} total files).`
  );

  const parsedTracks: TrackItem[] = [];
  const albumCoverDedup = new Map<string, string>();
  const folderCoverAttempts = new Map<string, number>();

  for (let i = 0; i < audioFiles.length; i++) {
    const file = audioFiles[i];
    if (
      onProgress &&
      (i === 0 || (i + 1) % 40 === 0 || i === audioFiles.length - 1)
    ) {
      onProgress(i + 1, audioFiles.length, file.name);
    }
    if (i > 0 && i % 50 === 0) {
      await new Promise((r) => setTimeout(r, 0));
    }

    try {
      const ext = getExtension(file.name);
      const format = detectFormat(ext);
      const relPath =
        (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
        file.name;

      const nativePath =
        window.icejazzDesktop?.getFilePath?.(file) ||
        window.icejazzDesktop?.lookupFilePath?.(
          file.name,
          file.size,
          file.lastModified,
          relPath
        ) ||
        (file as File & { path?: string }).path ||
        undefined;

      const folderPath = nativePath
        ? nativePath.replace(/[\\/][^\\/]+$/, '')
        : relPath.includes('/') || relPath.includes('\\')
          ? relPath.replace(/[\\/][^\\/]+$/, '')
          : 'LOCAL_DIR';

      const fallback = inferFromFilename(file.name, folderPath);
      const attemptsInFolder = folderCoverAttempts.get(folderPath) || 0;
      const skipCover =
        folderCoverMap.has(folderPath) || attemptsInFolder >= 2;
      if (!skipCover) {
        folderCoverAttempts.set(folderPath, attemptsInFolder + 1);
      }

      let header: ParsedAudioHeader = {};
      if (format === 'FLAC') {
        header = await parseFlacMetadata(file, skipCover);
      } else if (format === 'WAV') {
        header = await parseWavMetadata(file);
      } else if (format === 'MP3') {
        header = await parseId3Metadata(file, skipCover);
      } else if (format === 'ALAC' || format === 'AAC') {
        header = await parseMp4Metadata(file);
      } else if (format === 'OGG') {
        header = await parseOggMetadata(file);
      }

      let duration = header.duration || 0;
      if (!duration || duration <= 0) {
        const estKbps = format === 'FLAC' || format === 'WAV' ? 920 : 256;
        duration = Math.max(15, Math.round((file.size * 8) / (estKbps * 1000)));
      }

      const sampleRate = header.sampleRate || 44100;
      const bitDepth = header.bitDepth || 16;
      const channels = header.channels || 2;
      const fileSizeMB = Number((file.size / (1024 * 1024)).toFixed(2));
      const bitrate = Math.max(
        64,
        Math.round((file.size * 8) / (Math.max(1, duration) * 1000))
      );

      const deterministicKey = `${folderPath}/${file.name}::${file.size}`;
      let hash = 0;
      for (let c = 0; c < deterministicKey.length; c++) {
        hash = (hash * 31 + deterministicKey.charCodeAt(c)) >>> 0;
      }
      const id = `trk_${hash.toString(16).padStart(8, '0')}`;

      const sidecarKey = `${folderPath}/${getBaseNameWithoutExt(
        file.name
      ).toLowerCase()}`;
      const lyrics = header.lyrics || lyricsSidecarMap.get(sidecarKey);
      const genre = normalizeGenre(header.genre);
      const resolvedArtist = header.artist || fallback.artist;
      const resolvedAlbum = header.album || fallback.album;
      const albumKey = `${resolvedArtist}::${resolvedAlbum}`;

      let resolvedCover =
        folderCoverMap.get(folderPath) ||
        albumCoverDedup.get(albumKey) ||
        header.coverDataUrl;
      if (resolvedCover) {
        if (!folderCoverMap.has(folderPath)) {
          folderCoverMap.set(folderPath, resolvedCover);
        }
        if (!albumCoverDedup.has(albumKey)) {
          albumCoverDedup.set(albumKey, resolvedCover);
        }
      }

      const tags: string[] = [format];
      if (genre && genre !== 'Unknown') tags.push(genre);
      if (lyrics) tags.push('Lyrics');

      const trackItem: TrackItem = {
        id,
        title: header.title || fallback.title,
        artist: resolvedArtist,
        album: resolvedAlbum,
        genre,
        year:
          header.year ||
          new Date(file.lastModified || Date.now()).getFullYear(),
        trackNumber: header.trackNumber || fallback.trackNumber || i + 1,
        duration,
        format,
        sampleRate,
        bitDepth,
        bitrate,
        channels,
        fileSizeMB,
        fileName: file.name,
        folderPath,
        nativeFilePath: nativePath,
        coverUrl: resolvedCover,
        fileBlob: file,
        lyrics,
        rating: 0,
        tags,
        playCount: 0,
        addedAt: new Date().toISOString(),
      };

      parsedTracks.push(trackItem);

      if (i < 5 || (i + 1) % 250 === 0 || i === audioFiles.length - 1) {
        terminalLogger.log(
          'META',
          `[${i + 1}/${audioFiles.length}] ${trackItem.artist} — ${trackItem.title} | Album: ${trackItem.album}`
        );
      }
    } catch {
      // Skip malformed individual file without aborting directory scan
    }
  }

  return parsedTracks;
}
