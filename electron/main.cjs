const {
  app,
  BrowserWindow,
  ipcMain,
  Tray,
  Menu,
  dialog,
  protocol,
  nativeImage,
  shell,
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const net = require('node:net');
const https = require('node:https');
const crypto = require('node:crypto');

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'local-audio',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
      bypassCSP: true,
    },
  },
]);

const APP_ID = 'com.icejazz.audioplayer';
const DEFAULT_DISCORD_CLIENT_ID = '440997014315204609';
const LEGACY_BROKEN_CLIENT_IDS = new Set([
  '1298643829104820224',
  '463151177836658699',
  '1129859263741837373',
]);
const DEFAULT_DISCORD_LARGE_ASSET_KEY = 'music';

if (process.platform === 'win32') {
  app.setAppUserModelId(APP_ID);
}
app.setName('IceJaZz');

let mainWindow = null;
let tray = null;
let isQuitting = false;
let savedBoundsBeforeOverlay = null;

function padRpcText(value, fallback) {
  const clean = String(value || fallback || 'IceJaZz').trim();
  if (clean.length === 0) return 'IceJaZz';
  if (clean.length === 1) return `${clean} `;
  return clean.slice(0, 128);
}

const artworkCache = new Map();

function fetchItunesCoverUrl(artist, album, title) {
  return new Promise((resolve) => {
    const query = [artist, album || title]
      .filter((s) => s && !/unknown/i.test(s))
      .join(' ')
      .trim();
    if (!query) {
      resolve(null);
      return;
    }
    const cacheKey = query.toLowerCase();
    if (artworkCache.has(cacheKey)) {
      resolve(artworkCache.get(cacheKey));
      return;
    }

    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(
      query
    )}&media=music&limit=1`;

    const req = https.get(url, { timeout: 3500 }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        resolve(null);
        return;
      }
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        if (raw.length < 65536) raw += chunk;
      });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw);
          const first = parsed && parsed.results && parsed.results[0];
          if (first && first.artworkUrl100) {
            const hiRes = String(first.artworkUrl100).replace(
              '100x100bb',
              '512x512bb'
            );
            artworkCache.set(cacheKey, hiRes);
            resolve(hiRes);
            return;
          }
        } catch {
          // ignore
        }
        artworkCache.set(cacheKey, null);
        resolve(null);
      });
    });

    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

/**
 * Full binary-framed Discord Rich Presence IPC Client over local named pipe / Unix socket.
 */
class DiscordIPCClient {
  constructor() {
    this.socket = null;
    this.connected = false;
    this.handshakeComplete = false;
    this.clientId = DEFAULT_DISCORD_CLIENT_ID;
    this.lastPayload = null;
    this.lastRawConfig = null;
    this.lastError = null;
    this.reconnectTimer = null;
    this.recvBuffer = Buffer.alloc(0);
    this.coverRequestSeq = 0;
  }

  getPipePath(index = 0) {
    if (process.platform === 'win32') {
      return `\\\\.\\pipe\\discord-ipc-${index}`;
    }
    const runtimeDir =
      process.env.XDG_RUNTIME_DIR ||
      process.env.TMPDIR ||
      process.env.TMP ||
      process.env.TEMP ||
      '/tmp';
    const candidates = [
      path.join(runtimeDir, `discord-ipc-${index}`),
      path.join(runtimeDir, 'app/com.discordapp.Discord', `discord-ipc-${index}`),
      path.join(runtimeDir, 'snap.discord', `discord-ipc-${index}`),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
    return candidates[0];
  }

  encodeFrame(opcode, payloadObj) {
    const data = Buffer.from(JSON.stringify(payloadObj), 'utf8');
    const header = Buffer.alloc(8);
    header.writeInt32LE(opcode, 0);
    header.writeInt32LE(data.length, 4);
    return Buffer.concat([header, data]);
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    if (!this.lastRawConfig || !this.lastRawConfig.enabled) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.lastRawConfig && this.lastRawConfig.enabled && !this.connected) {
        this.connect(this.clientId, 0);
      }
    }, 6000);
  }

  handleIncomingBuffer(chunk) {
    this.recvBuffer = Buffer.concat([this.recvBuffer, chunk]);
    while (this.recvBuffer.length >= 8) {
      const opcode = this.recvBuffer.readInt32LE(0);
      const length = this.recvBuffer.readInt32LE(4);
      if (length < 0 || length > 1024 * 1024) {
        this.recvBuffer = Buffer.alloc(0);
        break;
      }
      if (this.recvBuffer.length < 8 + length) {
        break;
      }
      const jsonSlice = this.recvBuffer.subarray(8, 8 + length).toString('utf8');
      this.recvBuffer = this.recvBuffer.subarray(8 + length);

      let msg = null;
      try {
        msg = JSON.parse(jsonSlice);
      } catch {
        continue;
      }

      if (opcode === 1) {
        if (msg && msg.cmd === 'DISPATCH' && msg.evt === 'READY') {
          this.handshakeComplete = true;
          this.lastError = null;
          if (this.lastPayload) {
            this.sendActivityFrame(this.lastPayload);
          }
        } else if (msg && msg.evt === 'ERROR') {
          this.lastError =
            (msg.data && msg.data.message) || 'DISCORD_RPC_REJECTED';
        }
      } else if (opcode === 2) {
        this.lastError =
          (msg && msg.message) || 'INVALID_CLIENT_ID_OR_CLOSED';
        this.disconnect(false);
      } else if (opcode === 3) {
        if (this.socket && this.connected) {
          try {
            this.socket.write(this.encodeFrame(4, msg || {}));
          } catch {
            // ignore
          }
        }
      }
    }
  }

  connect(clientId, pipeIndex = 0) {
    if (clientId) {
      const cleanId = String(clientId).trim();
      this.clientId =
        !cleanId || LEGACY_BROKEN_CLIENT_IDS.has(cleanId)
          ? DEFAULT_DISCORD_CLIENT_ID
          : cleanId;
    }
    if (this.connected && this.socket) return;
    if (pipeIndex > 9) {
      this.connected = false;
      this.handshakeComplete = false;
      this.socket = null;
      this.scheduleReconnect();
      return;
    }

    const pipePath = this.getPipePath(pipeIndex);
    const sock = net.createConnection(pipePath);

    sock.once('connect', () => {
      this.socket = sock;
      this.connected = true;
      this.handshakeComplete = false;
      this.recvBuffer = Buffer.alloc(0);
      try {
        sock.write(
          this.encodeFrame(0, {
            v: 1,
            client_id: this.clientId,
          })
        );
      } catch {
        this.disconnect(true);
      }
    });

    sock.on('data', (chunk) => {
      this.handleIncomingBuffer(chunk);
    });

    sock.once('error', () => {
      sock.destroy();
      if (!this.connected && pipeIndex < 9) {
        this.connect(this.clientId, pipeIndex + 1);
      } else {
        this.connected = false;
        this.handshakeComplete = false;
        this.socket = null;
        this.scheduleReconnect();
      }
    });

    sock.once('close', () => {
      this.connected = false;
      this.handshakeComplete = false;
      this.socket = null;
      this.scheduleReconnect();
    });
  }

  disconnect(allowReconnect = false) {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      try {
        this.socket.destroy();
      } catch {
        // Ignore
      }
    }
    this.socket = null;
    this.connected = false;
    this.handshakeComplete = false;
    this.recvBuffer = Buffer.alloc(0);
    if (allowReconnect) {
      this.scheduleReconnect();
    }
  }

  sendActivityFrame(activityObj) {
    if (!this.socket || !this.connected || !this.handshakeComplete) return false;
    try {
      const frame = this.encodeFrame(1, {
        cmd: 'SET_ACTIVITY',
        args: {
          pid: process.pid,
          activity: activityObj || null,
        },
        nonce: crypto.randomUUID(),
      });
      this.socket.write(frame);
      return true;
    } catch {
      this.disconnect(true);
      return false;
    }
  }

  updatePresence(data) {
    this.lastRawConfig = data || null;

    if (!data || !data.enabled) {
      this.lastPayload = null;
      this.lastError = null;
      if (this.connected) {
        this.sendActivityFrame(null);
        this.disconnect(false);
      }
      return { ok: true, status: 'DISABLED' };
    }

    const rawId = String(data.clientId || '').trim();
    const nextClientId =
      !rawId || LEGACY_BROKEN_CLIENT_IDS.has(rawId)
        ? DEFAULT_DISCORD_CLIENT_ID
        : rawId;

    if (nextClientId !== this.clientId) {
      this.lastError = null;
      this.disconnect(false);
      this.clientId = nextClientId;
    }

    if (!data.trackTitle) {
      this.lastPayload = null;
      if (this.connected && this.handshakeComplete) {
        this.sendActivityFrame(null);
        return { ok: true, status: 'CONNECTED (IDLE)' };
      }
      if (!this.connected) {
        this.connect(this.clientId, 0);
      }
      return {
        ok: true,
        status: this.lastError
          ? `ERR: ${this.lastError}`
          : this.connected
            ? 'HANDSHAKING'
            : 'WAITING FOR DISCORD',
      };
    }

    if (!data.isPlaying && !data.showWhenPaused) {
      this.lastPayload = null;
      if (this.connected && this.handshakeComplete) {
        this.sendActivityFrame(null);
      }
      return { ok: true, status: 'PAUSED (HIDDEN)' };
    }

    const nowMs = Date.now();
    const curSec = Math.max(0, Number(data.currentTime) || 0);
    const durSec = Math.max(0, Number(data.duration) || 0);

    const detailsStr = padRpcText(data.trackTitle, 'Unknown Track');
    const artistPart = data.artist || 'Unknown Artist';
    const albumPart = data.album ? ` — ${data.album}` : '';
    const stateStr = padRpcText(
      `${artistPart}${albumPart}${!data.isPlaying ? ' [PAUSED]' : ''}`,
      'IceJaZz'
    );

    const customImg = String(data.largeImageKey || '').trim();
    const isDefaultKey =
      !customImg ||
      customImg === 'icejazz_logo' ||
      customImg === 'music' ||
      customImg.includes('raw.githubusercontent.com');

    const assetsObj = {
      large_text: padRpcText(
        `IceJaZz Audio Player${data.format ? ` [${data.format}]` : ''}`,
        'IceJaZz Audio Player'
      ),
    };

    if (!isDefaultKey) {
      assetsObj.large_image = customImg;
    } else if (this.clientId === DEFAULT_DISCORD_CLIENT_ID) {
      assetsObj.large_image = DEFAULT_DISCORD_LARGE_ASSET_KEY;
      assetsObj.small_image = data.isPlaying ? 'play' : 'pause';
      assetsObj.small_text = data.isPlaying ? 'Playing' : 'Paused';
    }

    const activity = {
      name: 'IceJaZz',
      type: 2, // Listening to
      status_display_type: 1,
      details: detailsStr,
      state: stateStr,
      assets: assetsObj,
      instance: false,
    };

    if (data.isPlaying && data.showTimestamps && durSec > 0) {
      const startTimestamp = Math.round(nowMs - curSec * 1000);
      const endTimestamp = Math.round(startTimestamp + durSec * 1000);
      activity.timestamps = {
        start: startTimestamp,
        end: endTimestamp,
      };
    }

    this.lastPayload = activity;

    if (!this.connected) {
      this.connect(this.clientId, 0);
      return {
        ok: true,
        status: this.lastError ? `ERR: ${this.lastError}` : 'CONNECTING TO PIPE',
      };
    }

    if (this.handshakeComplete) {
      this.sendActivityFrame(activity);
      return { ok: true, status: 'CONNECTED (LIVE)' };
    }

    return {
      ok: true,
      status: this.lastError ? `ERR: ${this.lastError}` : 'HANDSHAKING',
    };
  }
}

const discordClient = new DiscordIPCClient();

/**
 * Native Node.js Audio Directory Scanner & Metadata Parser
 * Handles 4000+ FLAC/MP3/WAV/OGG/M4A files directly via Node fs without Chromium webkitdirectory limits.
 */
const SUPPORTED_AUDIO_EXTS = new Set([
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
]);

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp']);

const ID3_GENRE_MAP = {
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
  24: 'Soundtrack',
  26: 'Ambient',
  27: 'Trip-Hop',
  30: 'Fusion',
  31: 'Trance',
  32: 'Classical',
  33: 'Instrumental',
  35: 'House',
  40: 'AlternRock',
  42: 'Soul',
  43: 'Punk',
  52: 'Electronic',
  71: 'Lo-Fi',
  74: 'Acid Jazz',
  78: 'Rock & Roll',
  79: 'Hard Rock',
  131: 'Indie',
  146: 'Synthpop',
};

function normalizeGenreNode(raw) {
  if (!raw) return 'Unknown';
  const cleaned = String(raw).replace(/\0/g, '').trim();
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

function detectFormatNode(ext) {
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

function inferFromFilenameNode(fileName, folderPath) {
  const baseName = fileName.replace(/\.[^/.]+$/, '');
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

function parseVorbisCommentsBuf(buf, offset, blockLen, result) {
  let p = offset;
  const end = offset + blockLen;
  if (p + 4 > end) return;
  const vendorLen = buf.readUInt32LE(p);
  p += 4 + vendorLen;
  if (p + 4 > end) return;
  const commentCount = buf.readUInt32LE(p);
  p += 4;
  for (let i = 0; i < commentCount && p + 4 <= end; i++) {
    const cLen = buf.readUInt32LE(p);
    p += 4;
    if (cLen < 0 || p + cLen > end) break;
    const raw = buf.toString('utf8', p, p + cLen);
    p += cLen;
    const eqIdx = raw.indexOf('=');
    if (eqIdx > 0) {
      const key = raw.slice(0, eqIdx).trim().toUpperCase();
      const val = raw.slice(eqIdx + 1).trim();
      if (!val) continue;
      if (key === 'TITLE') result.title = val;
      else if (key === 'ARTIST' || (key === 'ALBUMARTIST' && !result.artist))
        result.artist = val;
      else if (key === 'ALBUM') result.album = val;
      else if (key === 'GENRE' || key === 'STYLE')
        result.genre = normalizeGenreNode(val);
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

function decodeId3TextBuf(buf, encodingByte) {
  try {
    if (encodingByte === 1 || encodingByte === 2) {
      return new TextDecoder('utf-16').decode(buf).replace(/\0/g, '').trim();
    }
    if (encodingByte === 3) {
      return buf.toString('utf8').replace(/\0/g, '').trim();
    }
    try {
      return new TextDecoder('utf-8', { fatal: true })
        .decode(buf)
        .replace(/\0/g, '')
        .trim();
    } catch {
      return new TextDecoder('windows-1251')
        .decode(buf)
        .replace(/\0/g, '')
        .trim();
    }
  } catch {
    return '';
  }
}

function parseId3Buffer(buf, fileSize, result, skipCover, coversDir, folderHash) {
  if (buf.length < 10 || buf[0] !== 0x49 || buf[1] !== 0x44 || buf[2] !== 0x33) {
    return 0;
  }
  const version = buf[3];
  const tagSize =
    ((buf[6] & 0x7f) << 21) |
    ((buf[7] & 0x7f) << 14) |
    ((buf[8] & 0x7f) << 7) |
    (buf[9] & 0x7f);
  const limit = Math.min(buf.length, 10 + tagSize);
  let offset = 10;

  while (offset + 10 <= limit) {
    const frameId = buf.toString('ascii', offset, offset + 4);
    if (!/^[A-Z0-9]{4}$/.test(frameId)) break;
    const frameSize =
      version === 4
        ? ((buf[offset + 4] & 0x7f) << 21) |
          ((buf[offset + 5] & 0x7f) << 14) |
          ((buf[offset + 6] & 0x7f) << 7) |
          (buf[offset + 7] & 0x7f)
        : buf.readUInt32BE(offset + 4);

    offset += 10;
    if (frameSize <= 0 || offset + frameSize > limit) break;
    const frameData = buf.subarray(offset, offset + frameSize);

    if (frameId === 'TIT2' && frameData.length > 1) {
      result.title = decodeId3TextBuf(frameData.subarray(1), frameData[0]);
    } else if (
      (frameId === 'TPE1' || (frameId === 'TPE2' && !result.artist)) &&
      frameData.length > 1
    ) {
      result.artist = decodeId3TextBuf(frameData.subarray(1), frameData[0]);
    } else if (frameId === 'TALB' && frameData.length > 1) {
      result.album = decodeId3TextBuf(frameData.subarray(1), frameData[0]);
    } else if (frameId === 'TCON' && frameData.length > 1) {
      result.genre = normalizeGenreNode(
        decodeId3TextBuf(frameData.subarray(1), frameData[0])
      );
    } else if (
      (frameId === 'TYER' || frameId === 'TDRC') &&
      frameData.length > 1
    ) {
      const yr = parseInt(
        decodeId3TextBuf(frameData.subarray(1), frameData[0]).slice(0, 4),
        10
      );
      if (yr > 1900 && yr < 2100) result.year = yr;
    } else if (frameId === 'TRCK' && frameData.length > 1) {
      const tn = parseInt(
        decodeId3TextBuf(frameData.subarray(1), frameData[0]).split('/')[0],
        10
      );
      if (tn > 0) result.trackNumber = tn;
    } else if (
      frameId === 'APIC' &&
      !skipCover &&
      !result.coverFilePath &&
      frameData.length > 16
    ) {
      let p = 1;
      let mime = '';
      while (p < frameData.length && frameData[p] !== 0) {
        mime += String.fromCharCode(frameData[p]);
        p++;
      }
      p += 2; // null + picType
      const enc = frameData[0];
      if (enc === 1 || enc === 2) {
        while (
          p + 1 < frameData.length &&
          !(frameData[p] === 0 && frameData[p + 1] === 0)
        )
          p += 2;
        p += 2;
      } else {
        while (p < frameData.length && frameData[p] !== 0) p++;
        p += 1;
      }
      if (p < frameData.length && frameData.length - p <= 4 * 1024 * 1024) {
        try {
          const ext = mime.includes('png') ? 'png' : 'jpg';
          const coverOut = path.join(coversDir, `cov_${folderHash}.${ext}`);
          if (!fs.existsSync(coverOut)) {
            fs.writeFileSync(coverOut, frameData.subarray(p));
          }
          result.coverFilePath = coverOut;
        } catch {
          // ignore
        }
      }
    }

    offset += frameSize;
  }

  return 10 + tagSize;
}

async function parseFlacFileNode(
  filePath,
  fileSize,
  skipCover,
  coversDir,
  folderHash
) {
  const result = {};
  let fh = null;
  try {
    fh = await fs.promises.open(filePath, 'r');
    const probeLen = Math.min(fileSize, 65536);
    const probeBuf = Buffer.allocUnsafe(probeLen);
    const { bytesRead } = await fh.read(probeBuf, 0, probeLen, 0);
    if (bytesRead < 42) return result;

    let flacOffset = -1;
    // Check if FLAC starts with an ID3v2 header
    if (
      probeBuf[0] === 0x49 &&
      probeBuf[1] === 0x44 &&
      probeBuf[2] === 0x33
    ) {
      const id3End = parseId3Buffer(
        probeBuf.subarray(0, bytesRead),
        fileSize,
        result,
        skipCover,
        coversDir,
        folderHash
      );
      if (id3End + 4 <= fileSize) {
        const magicBuf = Buffer.allocUnsafe(4);
        await fh.read(magicBuf, 0, 4, id3End);
        if (
          magicBuf[0] === 0x66 &&
          magicBuf[1] === 0x4c &&
          magicBuf[2] === 0x61 &&
          magicBuf[3] === 0x43
        ) {
          flacOffset = id3End + 4;
        }
      }
    }

    if (flacOffset === -1) {
      for (let i = 0; i <= bytesRead - 4; i++) {
        if (
          probeBuf[i] === 0x66 &&
          probeBuf[i + 1] === 0x4c &&
          probeBuf[i + 2] === 0x61 &&
          probeBuf[i + 3] === 0x43
        ) {
          flacOffset = i + 4;
          break;
        }
      }
    }

    if (flacOffset === -1) return result;

    let offset = flacOffset;
    let isLast = false;
    const hdrBuf = Buffer.allocUnsafe(4);
    let blocksVisited = 0;

    while (!isLast && offset + 4 <= fileSize && blocksVisited < 32) {
      blocksVisited++;
      const { bytesRead: hb } = await fh.read(hdrBuf, 0, 4, offset);
      if (hb < 4) break;
      const headerByte = hdrBuf[0];
      isLast = (headerByte & 0x80) !== 0;
      const blockType = headerByte & 0x7f;
      const blockLength = (hdrBuf[1] << 16) | (hdrBuf[2] << 8) | hdrBuf[3];
      offset += 4;

      if (blockLength < 0 || offset + blockLength > fileSize) break;

      if (blockType === 0 && blockLength >= 34) {
        const sBuf = Buffer.allocUnsafe(34);
        await fh.read(sBuf, 0, 34, offset);
        const b10 = sBuf[10];
        const b11 = sBuf[11];
        const b12 = sBuf[12];
        const b13 = sBuf[13];
        const sampleRate = (b10 << 12) | (b11 << 4) | (b12 >> 4);
        const channels = ((b12 >> 1) & 0x07) + 1;
        const bitDepth = (((b12 & 0x01) << 4) | (b13 >> 4)) + 1;
        const highSamples = b13 & 0x0f;
        const lowSamples = sBuf.readUInt32BE(14);
        const totalSamples = highSamples * 4294967296 + lowSamples;
        if (sampleRate > 0) {
          result.sampleRate = sampleRate;
          if (totalSamples > 0) {
            result.duration = totalSamples / sampleRate;
          }
        }
        result.channels = channels;
        result.bitDepth = bitDepth;
      } else if (blockType === 4 && blockLength > 0 && blockLength <= 2 * 1024 * 1024) {
        const vBuf = Buffer.allocUnsafe(blockLength);
        await fh.read(vBuf, 0, blockLength, offset);
        parseVorbisCommentsBuf(vBuf, 0, blockLength, result);
        if (skipCover || result.coverFilePath) break;
      } else if (
        blockType === 6 &&
        !skipCover &&
        !result.coverFilePath &&
        blockLength > 32 &&
        blockLength <= 8 * 1024 * 1024
      ) {
        const pBuf = Buffer.allocUnsafe(blockLength);
        await fh.read(pBuf, 0, blockLength, offset);
        let p = 4;
        if (p + 4 <= blockLength) {
          const mimeLen = pBuf.readUInt32BE(p);
          p += 4;
          if (mimeLen >= 0 && p + mimeLen + 4 <= blockLength) {
            const mime = pBuf.toString('utf8', p, p + mimeLen) || 'image/jpeg';
            p += mimeLen;
            const descLen = pBuf.readUInt32BE(p);
            p += 4 + descLen + 16;
            if (p + 4 <= blockLength) {
              const picDataLen = pBuf.readUInt32BE(p);
              p += 4;
              if (picDataLen > 0 && p + picDataLen <= blockLength) {
                try {
                  const ext = mime.includes('png') ? 'png' : 'jpg';
                  const coverOut = path.join(
                    coversDir,
                    `cov_${folderHash}.${ext}`
                  );
                  if (!fs.existsSync(coverOut)) {
                    fs.writeFileSync(
                      coverOut,
                      pBuf.subarray(p, p + picDataLen)
                    );
                  }
                  result.coverFilePath = coverOut;
                } catch {
                  // ignore
                }
              }
            }
          }
        }
        if (result.title) break;
      }

      offset += blockLength;
    }
  } catch {
    // ignore
  } finally {
    if (fh) {
      await fh.close().catch(() => {});
    }
  }
  return result;
}

async function parseOtherAudioNode(
  filePath,
  fileSize,
  format,
  skipCover,
  coversDir,
  folderHash
) {
  const result = {};
  let fh = null;
  try {
    fh = await fs.promises.open(filePath, 'r');
    const sliceLen = Math.min(fileSize, skipCover ? 96 * 1024 : 512 * 1024);
    const buf = Buffer.allocUnsafe(sliceLen);
    const { bytesRead } = await fh.read(buf, 0, sliceLen, 0);
    const slice = buf.subarray(0, bytesRead);

    if (format === 'MP3') {
      parseId3Buffer(slice, fileSize, result, skipCover, coversDir, folderHash);
    } else if (format === 'WAV' && slice.length >= 44) {
      if (slice.toString('ascii', 0, 4) === 'RIFF') {
        const channels = slice.readUInt16LE(22);
        const sampleRate = slice.readUInt32LE(24);
        const byteRate = slice.readUInt32LE(28);
        const bitDepth = slice.readUInt16LE(34);
        if (sampleRate > 0) result.sampleRate = sampleRate;
        if (channels > 0) result.channels = channels;
        if (bitDepth > 0) result.bitDepth = bitDepth;
        if (byteRate > 0) result.duration = Math.max(1, (fileSize - 44) / byteRate);
      }
    } else if (format === 'OGG') {
      for (let i = 0; i < slice.length - 16; i++) {
        if (
          slice[i] === 0x03 &&
          slice[i + 1] === 0x76 &&
          slice[i + 2] === 0x6f &&
          slice[i + 3] === 0x72 &&
          slice[i + 4] === 0x62 &&
          slice[i + 5] === 0x69 &&
          slice[i + 6] === 0x73
        ) {
          parseVorbisCommentsBuf(slice, i + 7, slice.length - (i + 7), result);
          break;
        }
      }
    }
  } catch {
    // ignore
  } finally {
    if (fh) {
      await fh.close().catch(() => {});
    }
  }
  return result;
}

function getMountedDirsStorePath() {
  return path.join(app.getPath('userData'), 'mounted-dirs.json');
}

function loadSavedMountedDirs() {
  try {
    const p = getMountedDirsStorePath();
    if (fs.existsSync(p)) {
      const arr = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (Array.isArray(arr)) return arr;
    }
  } catch {
    // ignore
  }
  return [];
}

function saveMountedDirs(dirs) {
  try {
    const existing = new Set(loadSavedMountedDirs());
    for (const d of dirs) {
      if (d && typeof d === 'string') existing.add(d);
    }
    fs.writeFileSync(
      getMountedDirsStorePath(),
      JSON.stringify(Array.from(existing)),
      'utf8'
    );
  } catch {
    // ignore
  }
}

async function walkDirectoryForAudio(rootDirs) {
  const audioEntries = [];
  const folderCoverMap = new Map();
  const lyricsSidecarMap = new Map();
  const visitedDirs = new Set();

  async function walk(currentDir) {
    const normDir = path.resolve(currentDir);
    if (visitedDirs.has(normDir)) return;
    visitedDirs.add(normDir);

    let dirents;
    try {
      dirents = await fs.promises.readdir(normDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const d of dirents) {
      const fullPath = path.join(normDir, d.name);
      if (d.isDirectory()) {
        if (!d.name.startsWith('.') && d.name !== 'node_modules') {
          await walk(fullPath);
        }
      } else if (d.isFile()) {
        const dotIdx = d.name.lastIndexOf('.');
        const ext = dotIdx > 0 ? d.name.slice(dotIdx + 1).toLowerCase() : '';
        if (SUPPORTED_AUDIO_EXTS.has(ext)) {
          audioEntries.push({
            fullPath,
            fileName: d.name,
            folderPath: normDir,
            ext,
          });
        } else if (IMAGE_EXTS.has(ext) && !folderCoverMap.has(normDir)) {
          folderCoverMap.set(normDir, fullPath);
        } else if (ext === 'lrc' || ext === 'txt') {
          try {
            const st = await fs.promises.stat(fullPath);
            if (st.size <= 256 * 1024) {
              const base = d.name.replace(/\.[^/.]+$/, '').toLowerCase();
              lyricsSidecarMap.set(`${normDir}/${base}`, fullPath);
            }
          } catch {
            // ignore
          }
        }
      }
    }
  }

  for (const dir of rootDirs) {
    await walk(dir);
  }

  // Smart Parent Auto-Detection: if user clicked inside a 'Scans'/'Covers'/'Artwork' subfolder
  // that had 0 audio files, check its parent Album directory automatically!
  if (audioEntries.length === 0 && rootDirs.length > 0) {
    for (const dir of rootDirs) {
      const parentDir = path.dirname(path.resolve(dir));
      if (parentDir && parentDir !== path.resolve(dir)) {
        try {
          const parentItems = await fs.promises.readdir(parentDir, {
            withFileTypes: true,
          });
          const hasParentAudio = parentItems.some((item) => {
            if (!item.isFile()) return false;
            const dot = item.name.lastIndexOf('.');
            const ext = dot > 0 ? item.name.slice(dot + 1).toLowerCase() : '';
            return SUPPORTED_AUDIO_EXTS.has(ext);
          });
          if (hasParentAudio) {
            await walk(parentDir);
          }
        } catch {
          // ignore
        }
      }
    }
  }

  return { audioEntries, folderCoverMap, lyricsSidecarMap };
}

async function scanDirectoriesNative(rootDirs, onProgress) {
  saveMountedDirs(rootDirs);
  const coversDir = path.join(app.getPath('userData'), 'covers');
  try {
    if (!fs.existsSync(coversDir)) {
      fs.mkdirSync(coversDir, { recursive: true });
    }
  } catch {
    // ignore
  }

  const { audioEntries, folderCoverMap, lyricsSidecarMap } =
    await walkDirectoryForAudio(rootDirs);

  const tracks = [];
  const folderCoverExtracted = new Map();

  for (let i = 0; i < audioEntries.length; i++) {
    const entry = audioEntries[i];
    if (
      onProgress &&
      (i === 0 || (i + 1) % 40 === 0 || i === audioEntries.length - 1)
    ) {
      onProgress({
        done: i + 1,
        total: audioEntries.length,
        fileName: entry.fileName,
      });
    }

    let stat;
    try {
      stat = await fs.promises.stat(entry.fullPath);
    } catch {
      continue;
    }
    if (!stat || stat.size <= 0) continue;

    const format = detectFormatNode(entry.ext);
    const fallback = inferFromFilenameNode(entry.fileName, entry.folderPath);

    let folderHash = 0;
    for (let c = 0; c < entry.folderPath.length; c++) {
      folderHash = (folderHash * 31 + entry.folderPath.charCodeAt(c)) >>> 0;
    }
    const folderHashHex = folderHash.toString(16);

    const existingCoverPath =
      folderCoverMap.get(entry.folderPath) ||
      folderCoverExtracted.get(entry.folderPath);
    const skipCover = Boolean(existingCoverPath);

    let header = {};
    if (format === 'FLAC' && entry.ext === 'flac') {
      header = await parseFlacFileNode(
        entry.fullPath,
        stat.size,
        skipCover,
        coversDir,
        folderHashHex
      );
    } else {
      header = await parseOtherAudioNode(
        entry.fullPath,
        stat.size,
        format,
        skipCover,
        coversDir,
        folderHashHex
      );
    }

    if (header.coverFilePath && !folderCoverExtracted.has(entry.folderPath)) {
      folderCoverExtracted.set(entry.folderPath, header.coverFilePath);
    }

    const finalCoverFile =
      existingCoverPath ||
      header.coverFilePath ||
      folderCoverExtracted.get(entry.folderPath);

    const coverUrl = finalCoverFile
      ? `local-audio://media?path=${encodeURIComponent(finalCoverFile)}`
      : undefined;

    let duration = header.duration || 0;
    if (!duration || duration <= 0) {
      const estKbps = format === 'FLAC' || format === 'WAV' ? 920 : 256;
      duration = Math.max(15, Math.round((stat.size * 8) / (estKbps * 1000)));
    }

    const sampleRate = header.sampleRate || 44100;
    const bitDepth = header.bitDepth || 16;
    const channels = header.channels || 2;
    const fileSizeMB = Number((stat.size / (1024 * 1024)).toFixed(2));
    const bitrate = Math.max(
      64,
      Math.round((stat.size * 8) / (Math.max(1, duration) * 1000))
    );

    const deterministicKey = `${entry.folderPath}/${entry.fileName}::${stat.size}`;
    let hash = 0;
    for (let c = 0; c < deterministicKey.length; c++) {
      hash = (hash * 31 + deterministicKey.charCodeAt(c)) >>> 0;
    }
    const id = `trk_${hash.toString(16).padStart(8, '0')}`;

    const baseLower = entry.fileName.replace(/\.[^/.]+$/, '').toLowerCase();
    let lyrics = header.lyrics;
    if (!lyrics) {
      const lrcPath = lyricsSidecarMap.get(`${entry.folderPath}/${baseLower}`);
      if (lrcPath) {
        try {
          lyrics = await fs.promises.readFile(lrcPath, 'utf8');
        } catch {
          // ignore
        }
      }
    }

    const genre = normalizeGenreNode(header.genre);
    const tags = [format];
    if (genre && genre !== 'Unknown') tags.push(genre);
    if (lyrics) tags.push('Lyrics');

    tracks.push({
      id,
      title: header.title || fallback.title,
      artist: header.artist || fallback.artist,
      album: header.album || fallback.album,
      genre,
      year: header.year || new Date(stat.mtimeMs || Date.now()).getFullYear(),
      trackNumber: header.trackNumber || fallback.trackNumber || i + 1,
      duration,
      format,
      sampleRate,
      bitDepth,
      bitrate,
      channels,
      fileSizeMB,
      fileName: entry.fileName,
      folderPath: entry.folderPath,
      nativeFilePath: entry.fullPath,
      coverUrl,
      lyrics,
      rating: 0,
      tags,
      playCount: 0,
      addedAt: new Date().toISOString(),
    });
  }

  return tracks;
}

/**
 * Resolves missing nativeFilePath for tracks previously saved in IndexedDB without nativeFilePath.
 */
async function resolveMissingTrackPathsNode(items) {
  if (!Array.isArray(items) || items.length === 0) return {};

  const candidateRoots = [];
  const seenRoots = new Set();
  const addRoot = (p) => {
    if (!p || typeof p !== 'string') return;
    const norm = path.resolve(p);
    if (!seenRoots.has(norm) && fs.existsSync(norm)) {
      seenRoots.add(norm);
      candidateRoots.push(norm);
    }
  };

  for (const d of loadSavedMountedDirs()) {
    addRoot(d);
    addRoot(path.dirname(d));
  }

  const electronKeys = ['music', 'home', 'desktop', 'downloads', 'documents'];
  for (const k of electronKeys) {
    try {
      const p = app.getPath(k);
      addRoot(p);
      addRoot(path.dirname(p));
    } catch {
      // ignore
    }
  }

  if (process.platform === 'win32') {
    const driveLetters = 'CDEFGHIJKLMNOPQRSTUVWXYZ';
    for (const letter of driveLetters) {
      const driveRoot = `${letter}:\\`;
      if (fs.existsSync(driveRoot)) {
        addRoot(driveRoot);
        try {
          const topDirs = fs.readdirSync(driveRoot, { withFileTypes: true });
          for (const td of topDirs) {
            if (
              td.isDirectory() &&
              !td.name.startsWith('$') &&
              !td.name.startsWith('.') &&
              td.name !== 'Windows' &&
              td.name !== 'Program Files' &&
              td.name !== 'Program Files (x86)'
            ) {
              addRoot(path.join(driveRoot, td.name));
            }
          }
        } catch {
          // ignore
        }
      }
    }
  }

  const resolvedMap = {};
  let hotRoot = null;

  for (const item of items) {
    if (!item || !item.id || !item.fileName) continue;
    const relFolder =
      item.folderPath &&
      item.folderPath !== 'LOCAL_DIR' &&
      item.folderPath !== 'ROOT_DIR'
        ? String(item.folderPath).replace(/\//g, path.sep)
        : '';

    // 1. Check if folderPath itself is already an absolute path on disk
    if (relFolder && path.isAbsolute(relFolder)) {
      const directCandidate = path.join(relFolder, item.fileName);
      if (fs.existsSync(directCandidate)) {
        resolvedMap[item.id] = directCandidate;
        continue;
      }
    }

    // 2. Check hotRoot first (once found, 99.9% of tracks share the same root)
    if (hotRoot) {
      const c1 = relFolder
        ? path.join(hotRoot, relFolder, item.fileName)
        : path.join(hotRoot, item.fileName);
      if (fs.existsSync(c1)) {
        resolvedMap[item.id] = c1;
        continue;
      }
    }

    // 3. Search across candidateRoots
    for (const root of candidateRoots) {
      const candidates = [];
      if (relFolder) {
        candidates.push(path.join(root, relFolder, item.fileName));
        const firstSeg = relFolder.split(/[\\/]/)[0];
        if (
          firstSeg &&
          path.basename(root).toLowerCase() === firstSeg.toLowerCase()
        ) {
          candidates.push(
            path.join(path.dirname(root), relFolder, item.fileName)
          );
        }
      }
      candidates.push(path.join(root, item.fileName));

      let matched = false;
      for (const cand of candidates) {
        if (fs.existsSync(cand)) {
          resolvedMap[item.id] = cand;
          hotRoot = path.dirname(cand).slice(
            0,
            Math.max(0, path.dirname(cand).length - relFolder.length)
          );
          if (!hotRoot || !fs.existsSync(hotRoot)) {
            hotRoot = root;
          }
          matched = true;
          break;
        }
      }
      if (matched) break;
    }
  }

  return resolvedMap;
}

/**
 * Resolves custom icon from public/icon.ico or public/icon.png if present,
 * otherwise generates a 16x16 bitmap icon on the fly.
 */
function resolveAppIcon() {
  const candidates = [
    path.join(__dirname, '../public/icon.ico'),
    path.join(__dirname, '../public/icon.png'),
    path.join(__dirname, '../dist/icon.ico'),
    path.join(__dirname, '../dist/icon.png'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      const img = nativeImage.createFromPath(p);
      if (!img.isEmpty()) return img;
    }
  }

  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const isBorder = x < 2 || x >= size - 2 || y < 2 || y >= size - 2;
      const isInnerBar =
        (x >= 4 && x <= 6 && y >= 4 && y <= 11) ||
        (x >= 9 && x <= 11 && y >= 4 && y <= 11);
      if (isBorder) {
        buf[idx] = 243;
        buf[idx + 1] = 244;
        buf[idx + 2] = 246;
        buf[idx + 3] = 255;
      } else if (isInnerBar) {
        buf[idx] = 180;
        buf[idx + 1] = 154;
        buf[idx + 2] = 31;
        buf[idx + 3] = 255;
      } else {
        buf[idx] = 10;
        buf[idx + 1] = 10;
        buf[idx + 2] = 10;
        buf[idx + 3] = 255;
      }
    }
  }
  return nativeImage.createFromBuffer(buf, { width: size, height: size });
}

function setupSystemTray() {
  if (tray) return;
  try {
    const icon = resolveAppIcon();
    tray = new Tray(icon);
    tray.setToolTip('IceJaZz Audio Player');

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Restore IceJaZz',
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          }
        },
      },
      { type: 'separator' },
      {
        label: 'Play / Pause',
        click: () =>
          mainWindow?.webContents.send('icejazz:tray-command', 'play-pause'),
      },
      {
        label: 'Next Track (>>)',
        click: () =>
          mainWindow?.webContents.send('icejazz:tray-command', 'next'),
      },
      {
        label: 'Previous Track (<<)',
        click: () =>
          mainWindow?.webContents.send('icejazz:tray-command', 'prev'),
      },
      { type: 'separator' },
      {
        label: 'Toggle Overlay Mode',
        click: () =>
          mainWindow?.webContents.send('icejazz:tray-command', 'toggle-overlay'),
      },
      { type: 'separator' },
      {
        label: 'Quit IceJaZz',
        click: () => {
          isQuitting = true;
          discordClient.disconnect(false);
          app.quit();
        },
      },
    ]);

    tray.setContextMenu(contextMenu);
    tray.on('double-click', () => {
      if (!mainWindow) return;
      if (mainWindow.isVisible()) {
        mainWindow.focus();
      } else {
        mainWindow.show();
      }
    });
  } catch (err) {
    console.warn('[IceJaZz] Tray initialization warning:', err);
  }
}

function readAutostartSettings() {
  try {
    const login = app.getLoginItemSettings({
      path: process.execPath,
      args: ['--hidden'],
    });
    const generalLogin = app.getLoginItemSettings();
    const openAtLogin = Boolean(
      generalLogin.openAtLogin || login.openAtLogin
    );
    return {
      openAtLogin,
      startInTray: Boolean(login.openAtLogin || generalLogin.openAsHidden),
    };
  } catch {
    return { openAtLogin: false, startInTray: false };
  }
}

function applyAutostartSettings(openAtLogin, startInTray) {
  try {
    const args = startInTray ? ['--hidden'] : [];
    app.setLoginItemSettings({
      openAtLogin: Boolean(openAtLogin),
      openAsHidden: Boolean(startInTray),
      path: process.execPath,
      args,
    });
    return {
      ok: true,
      openAtLogin: Boolean(openAtLogin),
      startInTray: Boolean(startInTray),
    };
  } catch (err) {
    return {
      ok: false,
      error: String(err),
      openAtLogin: false,
      startInTray: false,
    };
  }
}

function createSafeFileStream(filePath, opts) {
  let nodeStream = null;
  return new ReadableStream({
    start(controller) {
      nodeStream = fs.createReadStream(filePath, {
        ...opts,
        highWaterMark: 64 * 1024,
      });
      nodeStream.on('data', (chunk) => {
        try {
          controller.enqueue(
            new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)
          );
        } catch {
          nodeStream.destroy();
        }
      });
      nodeStream.on('end', () => {
        try {
          controller.close();
        } catch {
          // Already closed
        }
      });
      nodeStream.on('error', (err) => {
        try {
          controller.error(err);
        } catch {
          // Already closed
        }
      });
    },
    cancel() {
      if (nodeStream) {
        nodeStream.destroy();
        nodeStream = null;
      }
    },
  });
}

function createWindow() {
  const icon = resolveAppIcon();
  const launchedHidden =
    process.argv.includes('--hidden') ||
    Boolean(app.getLoginItemSettings().wasOpenedAsHidden);

  mainWindow = new BrowserWindow({
    title: 'IceJaZz',
    width: 1440,
    height: 900,
    minWidth: 340,
    minHeight: 110,
    show: !launchedHidden,
    frame: false,
    transparent: false,
    backgroundColor: '#000000',
    icon,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  });

  mainWindow.on('page-title-updated', (e) => {
    e.preventDefault();
  });

  const startUrl =
    process.env.ELECTRON_START_URL ||
    `file://${path.join(__dirname, '../dist/index.html')}`;

  mainWindow.loadURL(startUrl);

  mainWindow.on('close', (e) => {
    if (!isQuitting && tray) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (!mainWindow.isVisible()) mainWindow.show();
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    protocol.handle('local-audio', async (request) => {
      try {
        let filePath = '';
        try {
          const parsed = new URL(request.url);
          const qPath = parsed.searchParams.get('path');
          if (qPath) {
            filePath = qPath;
          }
        } catch {
          // Fallback for legacy URLs
        }

        if (!filePath) {
          filePath = decodeURIComponent(
            request.url
              .replace(/^local-audio:\/\/(media\/?\?path=)?/i, '')
              .replace(/\/+$/, '')
          );
        }

        if (!filePath || !fs.existsSync(filePath)) {
          return new Response('File not found', { status: 404 });
        }

        const stat = await fs.promises.stat(filePath);
        const totalSize = stat.size;
        const ext = path.extname(filePath).toLowerCase();
        const mimeMap = {
          '.flac': 'audio/flac',
          '.mp3': 'audio/mpeg',
          '.wav': 'audio/wav',
          '.ogg': 'audio/ogg',
          '.oga': 'audio/ogg',
          '.opus': 'audio/ogg',
          '.m4a': 'audio/mp4',
          '.mp4': 'audio/mp4',
          '.m4b': 'audio/mp4',
          '.aac': 'audio/aac',
          '.alac': 'audio/mp4',
          '.webm': 'audio/webm',
          '.weba': 'audio/webm',
          '.aiff': 'audio/aiff',
          '.aif': 'audio/aiff',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.png': 'image/png',
          '.webp': 'image/webp',
        };
        const contentType = mimeMap[ext] || 'application/octet-stream';
        const rangeHeader = request.headers.get('range');

        if (rangeHeader) {
          const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
          if (match) {
            const start = match[1] ? parseInt(match[1], 10) : 0;
            const end = match[2]
              ? Math.min(totalSize - 1, parseInt(match[2], 10))
              : totalSize - 1;

            if (start >= totalSize || start > end) {
              return new Response(null, {
                status: 416,
                headers: {
                  'Content-Range': `bytes */${totalSize}`,
                  'Access-Control-Allow-Origin': '*',
                },
              });
            }

            const chunkSize = end - start + 1;
            const webStream = createSafeFileStream(filePath, { start, end });
            return new Response(webStream, {
              status: 206,
              headers: {
                'Content-Type': contentType,
                'Content-Length': String(chunkSize),
                'Content-Range': `bytes ${start}-${end}/${totalSize}`,
                'Accept-Ranges': 'bytes',
                'Access-Control-Allow-Origin': '*',
              },
            });
          }
        }

        const webStream = createSafeFileStream(filePath, {});
        return new Response(webStream, {
          status: 200,
          headers: {
            'Content-Type': contentType,
            'Content-Length': String(totalSize),
            'Accept-Ranges': 'bytes',
            'Access-Control-Allow-Origin': '*',
          },
        });
      } catch (err) {
        return new Response(String(err), { status: 500 });
      }
    });

    setupSystemTray();
    createWindow();

    ipcMain.handle('icejazz:scan-directory', async () => {
      if (!mainWindow) return { canceled: true, tracks: [] };
      const res = await dialog.showOpenDialog(mainWindow, {
        title: 'Select Music Folder(s) (FLAC, MP3, WAV, OGG, M4A)',
        properties: ['openDirectory', 'multiSelections'],
      });
      if (res.canceled || !res.filePaths || res.filePaths.length === 0) {
        return { canceled: true, tracks: [] };
      }

      const tracks = await scanDirectoriesNative(res.filePaths, (prog) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('icejazz:scan-progress', prog);
        }
      });

      return {
        canceled: false,
        tracks,
        selectedPaths: res.filePaths,
      };
    });

    ipcMain.handle('icejazz:resolve-missing-paths', async (_event, items) => {
      return resolveMissingTrackPathsNode(items);
    });

    ipcMain.handle('icejazz:minimize-to-tray', () => {
      setupSystemTray();
      if (mainWindow) mainWindow.hide();
      return true;
    });

    ipcMain.handle('icejazz:minimize-window', () => {
      if (mainWindow) mainWindow.minimize();
      return true;
    });

    ipcMain.handle('icejazz:toggle-maximize', () => {
      if (!mainWindow) return false;
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
        return false;
      } else {
        mainWindow.maximize();
        return true;
      }
    });

    ipcMain.handle(
      'icejazz:set-overlay-mode',
      (_event, enabled, width = 460, height = 160) => {
        if (!mainWindow) return false;
        if (enabled) {
          if (!savedBoundsBeforeOverlay) {
            savedBoundsBeforeOverlay = mainWindow.getBounds();
          }
          if (mainWindow.isMaximized()) {
            mainWindow.unmaximize();
          }
          mainWindow.setAlwaysOnTop(true, 'floating');
          mainWindow.setSize(Math.max(320, width), Math.max(100, height), true);
        } else {
          mainWindow.setAlwaysOnTop(false);
          if (savedBoundsBeforeOverlay) {
            mainWindow.setBounds(savedBoundsBeforeOverlay, true);
            savedBoundsBeforeOverlay = null;
          } else {
            mainWindow.setSize(1440, 900, true);
          }
        }
        return true;
      }
    );

    ipcMain.handle('icejazz:update-discord-presence', (_event, payload) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (payload && payload.trackTitle && payload.isPlaying) {
          const winTitle = `IceJaZz — ${payload.artist || 'Unknown Artist'} - ${payload.trackTitle}`;
          mainWindow.setTitle(winTitle);
          if (tray) tray.setToolTip(winTitle);
        } else {
          mainWindow.setTitle('IceJaZz');
          if (tray) tray.setToolTip('IceJaZz Audio Player');
        }
      }
      return discordClient.updatePresence(payload);
    });

    ipcMain.handle('icejazz:reconnect-discord', () => {
      discordClient.lastError = null;
      discordClient.disconnect(false);
      if (discordClient.lastRawConfig && discordClient.lastRawConfig.enabled) {
        return discordClient.updatePresence(discordClient.lastRawConfig);
      }
      return { ok: true, status: 'RECONNECTING' };
    });

    ipcMain.handle('icejazz:get-autostart', () => {
      return readAutostartSettings();
    });

    ipcMain.handle('icejazz:set-autostart', (_event, cfg) => {
      return applyAutostartSettings(
        Boolean(cfg && cfg.openAtLogin),
        Boolean(cfg && cfg.startInTray)
      );
    });

    ipcMain.handle('icejazz:open-external', async (_event, url) => {
      if (
        typeof url === 'string' &&
        (url.startsWith('https://') || url.startsWith('http://'))
      ) {
        await shell.openExternal(url);
        return true;
      }
      return false;
    });

    ipcMain.handle('icejazz:quit-app', () => {
      isQuitting = true;
      discordClient.disconnect(false);
      app.quit();
      return true;
    });

    ipcMain.handle('icejazz:read-file', async (_event, filePath) => {
      try {
        if (!filePath || !fs.existsSync(filePath)) return null;
        const buf = await fs.promises.readFile(filePath);
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      } catch {
        return null;
      }
    });

    ipcMain.handle('icejazz:select-directory', async () => {
      if (!mainWindow) return null;
      const res = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory'],
      });
      if (res.canceled || res.filePaths.length === 0) return null;
      return res.filePaths[0];
    });
  });
}

app.on('before-quit', () => {
  isQuitting = true;
  discordClient.disconnect(false);
});

app.on('window-all-closed', () => {
  discordClient.disconnect(false);
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
