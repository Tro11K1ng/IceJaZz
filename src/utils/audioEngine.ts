import { DSPSettings, EQBand, EQPreset, TrackItem } from '../types/audio';
import {
  loadTrackBlobById,
  updateSingleTrackMetadataInStorage,
} from './storageEngine';
import { terminalLogger } from './terminalLogger';

const EQ_FREQUENCIES: { freq: number; label: string; type: BiquadFilterType }[] = [
  { freq: 31, label: '31', type: 'lowshelf' },
  { freq: 62, label: '62', type: 'peaking' },
  { freq: 125, label: '125', type: 'peaking' },
  { freq: 250, label: '250', type: 'peaking' },
  { freq: 500, label: '500', type: 'peaking' },
  { freq: 1000, label: '1k', type: 'peaking' },
  { freq: 2000, label: '2k', type: 'peaking' },
  { freq: 4000, label: '4k', type: 'peaking' },
  { freq: 8000, label: '8k', type: 'peaking' },
  { freq: 16000, label: '16k', type: 'highshelf' },
];

export const BUILTIN_EQ_PRESETS: EQPreset[] = [
  {
    id: 'flat',
    name: 'Flat Studio',
    preamp: 0,
    gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  {
    id: 'ice-punch',
    name: 'IceJaZz Punch',
    preamp: 1.5,
    gains: [5.5, 4.0, 1.5, -1.0, -1.5, 0.5, 2.5, 4.0, 4.5, 3.5],
  },
  {
    id: 'loud-boost',
    name: 'Loudness Boost',
    preamp: 3.5,
    gains: [4.5, 3.5, 2.0, 0.5, 0.0, 1.0, 2.5, 3.5, 4.0, 3.5],
  },
  {
    id: 'jazz-club',
    name: 'Jazz Club',
    preamp: 1.0,
    gains: [3.0, 2.5, 1.5, 2.0, -1.5, -1.5, 0, 1.5, 2.5, 3.0],
  },
  {
    id: 'warm-tube',
    name: 'Warm Analog',
    preamp: 1.0,
    gains: [2.5, 3.5, 2.0, 1.0, 0.5, -0.5, -1.0, -1.5, -1.0, 0.5],
  },
  {
    id: 'sub-bass',
    name: 'Sub Bass',
    preamp: 1.5,
    gains: [6.5, 5.5, 3.5, 1.0, 0, 0, 0, 0.5, 1.0, 1.0],
  },
  {
    id: 'vocal-focus',
    name: 'Vocal Presence',
    preamp: 1.0,
    gains: [-2.0, -1.5, -0.5, 1.5, 3.5, 4.5, 3.5, 1.5, 0, -1.0],
  },
];

export function createDefaultDSPSettings(): DSPSettings {
  const bands: EQBand[] = EQ_FREQUENCIES.map((item) => ({
    frequency: item.freq,
    label: item.label,
    gain: 0,
    type: item.type,
  }));

  return {
    enabled: true,
    preamp: 0,
    bands,
    activePresetId: 'flat',
    crossfadeSeconds: 0,
    stereoBalance: 0,
    volume: 0.8,
    muted: false,
  };
}

export function computePerceptualGain(
  normalizedVol: number,
  muted: boolean
): number {
  if (muted) return 0;
  const raw = Number.isFinite(normalizedVol) ? normalizedVol : 0.8;
  if (raw <= 0) return 0;
  const v = Math.max(0, Math.min(1, raw));
  return Math.pow(v, 2.15) * 2.25;
}

function getTrackMimeType(track: TrackItem): string {
  const name = (track.fileName || track.nativeFilePath || '').toLowerCase();
  if (name.endsWith('.flac') || track.format === 'FLAC') return 'audio/flac';
  if (name.endsWith('.wav') || track.format === 'WAV') return 'audio/wav';
  if (
    name.endsWith('.ogg') ||
    name.endsWith('.oga') ||
    name.endsWith('.opus') ||
    track.format === 'OGG'
  ) {
    return 'audio/ogg';
  }
  if (
    name.endsWith('.m4a') ||
    name.endsWith('.mp4') ||
    name.endsWith('.m4b') ||
    name.endsWith('.alac') ||
    track.format === 'ALAC'
  ) {
    return 'audio/mp4';
  }
  if (name.endsWith('.aac') || track.format === 'AAC') return 'audio/aac';
  if (name.endsWith('.webm') || name.endsWith('.weba')) return 'audio/webm';
  return 'audio/mpeg';
}

type TimeUpdateCallback = (currentTime: number, duration: number) => void;

class WebAudioEngine {
  private ctx: AudioContext | null = null;
  private primaryAudio: HTMLAudioElement;
  private crossfadeAudio: HTMLAudioElement;
  private primarySource: MediaElementAudioSourceNode | null = null;
  private crossfadeSource: MediaElementAudioSourceNode | null = null;
  private primaryDeckGain: GainNode | null = null;
  private crossfadeDeckGain: GainNode | null = null;

  private preampNode: GainNode | null = null;
  private filterNodes: BiquadFilterNode[] = [];
  private pannerNode: StereoPannerNode | null = null;
  private masterGainNode: GainNode | null = null;
  private limiterNode: DynamicsCompressorNode | null = null;
  private analyserNode: AnalyserNode | null = null;

  private dsp: DSPSettings = createDefaultDSPSettings();
  private timeListeners: Set<TimeUpdateCallback> = new Set();

  private onTrackEndedCallback: (() => void) | null = null;
  private onCrossfadeTriggerCallback: (() => void) | null = null;
  private onPlayStateChangeCallback: ((playing: boolean) => void) | null = null;

  private crossfadeTriggeredForCurrentTrack = false;
  private currentTrack: TrackItem | null = null;
  private playRequestId = 0;
  private activeCreatedBlobUrls: string[] = [];

  constructor() {
    this.primaryAudio = new Audio();
    this.primaryAudio.preload = 'auto';
    this.primaryAudio.volume = 1.0;

    this.crossfadeAudio = new Audio();
    this.crossfadeAudio.preload = 'auto';
    this.crossfadeAudio.volume = 1.0;

    this.bindAudioEvents();
  }

  private registerBlobUrl(url: string): string {
    this.activeCreatedBlobUrls.push(url);
    // Keep at most the 3 most recent blob URLs in memory (for current + crossfade deck)
    while (this.activeCreatedBlobUrls.length > 3) {
      const old = this.activeCreatedBlobUrls.shift();
      if (
        old &&
        old !== this.primaryAudio.src &&
        old !== this.crossfadeAudio.src
      ) {
        try {
          URL.revokeObjectURL(old);
        } catch {
          // ignore
        }
      }
    }
    return url;
  }

  private ensureAudioGraph(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      return;
    }

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    this.ctx = new AudioCtx();

    this.primarySource = this.ctx.createMediaElementSource(this.primaryAudio);
    this.crossfadeSource = this.ctx.createMediaElementSource(
      this.crossfadeAudio
    );

    this.primaryDeckGain = this.ctx.createGain();
    this.crossfadeDeckGain = this.ctx.createGain();
    this.primaryDeckGain.gain.value = 1;
    this.crossfadeDeckGain.gain.value = 0;

    this.preampNode = this.ctx.createGain();
    this.filterNodes = EQ_FREQUENCIES.map((eq) => {
      const f = this.ctx!.createBiquadFilter();
      f.type = eq.type;
      f.frequency.value = eq.freq;
      f.Q.value = 1.4;
      f.gain.value = 0;
      return f;
    });

    this.pannerNode = this.ctx.createStereoPanner();
    this.masterGainNode = this.ctx.createGain();

    this.limiterNode = this.ctx.createDynamicsCompressor();
    this.limiterNode.threshold.value = -1.0;
    this.limiterNode.knee.value = 6.0;
    this.limiterNode.ratio.value = 12.0;
    this.limiterNode.attack.value = 0.003;
    this.limiterNode.release.value = 0.12;

    this.analyserNode = this.ctx.createAnalyser();
    this.analyserNode.fftSize = 1024;
    this.analyserNode.smoothingTimeConstant = 0.8;

    this.primarySource.connect(this.primaryDeckGain);
    this.crossfadeSource.connect(this.crossfadeDeckGain);

    this.primaryDeckGain.connect(this.preampNode);
    this.crossfadeDeckGain.connect(this.preampNode);

    let prevNode: AudioNode = this.preampNode;
    for (const filter of this.filterNodes) {
      prevNode.connect(filter);
      prevNode = filter;
    }

    prevNode.connect(this.pannerNode);
    this.pannerNode.connect(this.masterGainNode);
    this.masterGainNode.connect(this.limiterNode);
    this.limiterNode.connect(this.analyserNode);
    this.analyserNode.connect(this.ctx.destination);

    this.applyDSPSettings(this.dsp);
    terminalLogger.log(
      'DSP',
      `WebAudio graph initialized @ ${this.ctx.sampleRate}Hz (10-band EQ + perceptual gain + limiter)`
    );
  }

  private bindAudioEvents(): void {
    this.primaryAudio.addEventListener('timeupdate', () => {
      const cur = this.primaryAudio.currentTime || 0;
      const dur = Number.isFinite(this.primaryAudio.duration)
        ? this.primaryAudio.duration
        : this.currentTrack?.duration || 0;

      for (const cb of this.timeListeners) {
        cb(cur, dur);
      }

      if (
        this.dsp.crossfadeSeconds > 0 &&
        dur > this.dsp.crossfadeSeconds + 2 &&
        !this.crossfadeTriggeredForCurrentTrack &&
        dur - cur <= this.dsp.crossfadeSeconds
      ) {
        this.crossfadeTriggeredForCurrentTrack = true;
        terminalLogger.log(
          'DSP',
          `Crossfade (${this.dsp.crossfadeSeconds.toFixed(1)}s) -> blending next track`
        );
        if (this.onCrossfadeTriggerCallback) {
          this.onCrossfadeTriggerCallback();
        }
      }
    });

    this.primaryAudio.addEventListener('play', () => {
      if (this.onPlayStateChangeCallback) this.onPlayStateChangeCallback(true);
    });

    this.primaryAudio.addEventListener('pause', () => {
      if (this.onPlayStateChangeCallback) this.onPlayStateChangeCallback(false);
    });

    this.primaryAudio.addEventListener('ended', () => {
      if (
        !this.crossfadeTriggeredForCurrentTrack &&
        this.onTrackEndedCallback
      ) {
        this.onTrackEndedCallback();
      }
    });
  }

  /**
   * Always resolves to a same-origin `blob:` URL so Chromium's MediaElementAudioSourceNode
   * never CORS-taints or silences the WebAudio / AnalyserNode output.
   */
  private async resolveTrackAudioUrl(track: TrackItem): Promise<string | null> {
    if (track.audioUrl && track.audioUrl.startsWith('blob:')) {
      return track.audioUrl;
    }

    if (track.fileBlob && track.fileBlob.size > 0) {
      const typedBlob = track.fileBlob.type
        ? track.fileBlob
        : new Blob([track.fileBlob], { type: getTrackMimeType(track) });
      const url = this.registerBlobUrl(URL.createObjectURL(typedBlob));
      track.audioUrl = url;
      return url;
    }

    // If nativeFilePath is missing on desktop, attempt on-the-fly path healing
    if (
      !track.nativeFilePath &&
      track.fileName &&
      window.icejazzDesktop?.resolveMissingPaths
    ) {
      try {
        const map = await window.icejazzDesktop.resolveMissingPaths([
          {
            id: track.id,
            fileName: track.fileName,
            folderPath: track.folderPath,
          },
        ]);
        if (map && map[track.id]) {
          track.nativeFilePath = map[track.id];
          updateSingleTrackMetadataInStorage(track);
        }
      } catch {
        // Ignore
      }
    }

    // Read native file via Electron IPC into a same-origin Blob URL (prevents WebAudio CORS silence!)
    if (track.nativeFilePath && window.icejazzDesktop?.readLocalFile) {
      try {
        const arrayBuf = await window.icejazzDesktop.readLocalFile(
          track.nativeFilePath
        );
        if (arrayBuf && arrayBuf.byteLength > 0) {
          const blob = new Blob([arrayBuf], { type: getTrackMimeType(track) });
          const url = this.registerBlobUrl(URL.createObjectURL(blob));
          track.audioUrl = url;
          return url;
        }
      } catch {
        // Fall through to protocol fetch or IDB
      }
    }

    // Fallback: fetch local-audio:// into a same-origin Blob URL
    if (track.nativeFilePath && window.icejazzDesktop?.isDesktopApp) {
      try {
        const protoUrl = `local-audio://media?path=${encodeURIComponent(
          track.nativeFilePath
        )}`;
        const resp = await fetch(protoUrl);
        if (resp.ok) {
          const buf = await resp.arrayBuffer();
          if (buf.byteLength > 0) {
            const blob = new Blob([buf], { type: getTrackMimeType(track) });
            const url = this.registerBlobUrl(URL.createObjectURL(blob));
            track.audioUrl = url;
            return url;
          }
        }
      } catch {
        // Fall through to IDB
      }
    }

    const storedBlob = await loadTrackBlobById(track.id);
    if (storedBlob && storedBlob.size > 0) {
      const typedBlob = storedBlob.type
        ? storedBlob
        : new Blob([storedBlob], { type: getTrackMimeType(track) });
      track.fileBlob = typedBlob;
      const url = this.registerBlobUrl(URL.createObjectURL(typedBlob));
      track.audioUrl = url;
      return url;
    }

    return null;
  }

  public async playTrack(track: TrackItem, isCrossfade = false): Promise<void> {
    const requestId = ++this.playRequestId;
    this.ensureAudioGraph();
    this.currentTrack = track;
    this.crossfadeTriggeredForCurrentTrack = false;

    const url = await this.resolveTrackAudioUrl(track);
    if (requestId !== this.playRequestId) {
      return;
    }
    if (!url) {
      terminalLogger.log(
        'ERR',
        `Unable to open audio stream for "${track.title}". Click [+ MOUNT DIR] to link folder.`
      );
      return;
    }

    if (this.ctx && this.ctx.state === 'suspended') {
      await this.ctx.resume().catch(() => {});
    }

    if (
      isCrossfade &&
      this.ctx &&
      this.primaryDeckGain &&
      this.crossfadeDeckGain &&
      this.dsp.crossfadeSeconds > 0 &&
      !this.primaryAudio.paused
    ) {
      const fadeSec = this.dsp.crossfadeSeconds;
      const now = this.ctx.currentTime;

      try {
        this.crossfadeAudio.src = this.primaryAudio.src;
        this.crossfadeAudio.currentTime = this.primaryAudio.currentTime;
        this.crossfadeDeckGain.gain.cancelScheduledValues(now);
        this.crossfadeDeckGain.gain.setValueAtTime(1, now);
        this.crossfadeDeckGain.gain.linearRampToValueAtTime(
          0.0001,
          now + fadeSec
        );
        await this.crossfadeAudio.play().catch(() => {});
        window.setTimeout(() => {
          this.crossfadeAudio.pause();
        }, fadeSec * 1000 + 150);
      } catch {
        // Fallback to instant switch
      }

      this.primaryDeckGain.gain.cancelScheduledValues(now);
      this.primaryDeckGain.gain.setValueAtTime(0.0001, now);
      this.primaryDeckGain.gain.linearRampToValueAtTime(1, now + fadeSec);
    } else if (this.ctx && this.primaryDeckGain) {
      this.primaryDeckGain.gain.cancelScheduledValues(this.ctx.currentTime);
      this.primaryDeckGain.gain.setValueAtTime(1, this.ctx.currentTime);
      this.primaryDeckGain.gain.value = 1;
    }

    if (!this.primaryAudio.paused) {
      this.primaryAudio.pause();
    }

    if (this.primaryAudio.src !== url) {
      this.primaryAudio.src = url;
    } else {
      this.primaryAudio.currentTime = 0;
    }

    if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
      try {
        const canUseCover =
          track.coverUrl &&
          (track.coverUrl.startsWith('blob:') || track.coverUrl.length < 65536);
        navigator.mediaSession.metadata = new MediaMetadata({
          title: track.title || 'Unknown Track',
          artist: track.artist || 'Unknown Artist',
          album: track.album || 'IceJaZz',
          artwork: canUseCover
            ? [{ src: track.coverUrl!, sizes: '512x512', type: 'image/png' }]
            : [],
        });
        navigator.mediaSession.playbackState = 'playing';
      } catch {
        // Ignore MediaMetadata errors on unsupported platforms
      }
    }

    try {
      await this.primaryAudio.play();
      if (requestId !== this.playRequestId) return;
      terminalLogger.log(
        'PLAY',
        `Now playing: ${track.artist} — "${track.title}" [${track.format} ${track.bitrate}kbps]`
      );
    } catch (err) {
      if (requestId !== this.playRequestId) {
        return;
      }

      if (err instanceof DOMException && err.name === 'AbortError') {
        await new Promise((r) => setTimeout(r, 35));
        if (requestId !== this.playRequestId) return;
        try {
          await this.primaryAudio.play();
          terminalLogger.log(
            'PLAY',
            `Now playing: ${track.artist} — "${track.title}" [${track.format} ${track.bitrate}kbps]`
          );
          return;
        } catch {
          // Fall through
        }
      }

      terminalLogger.log('WARN', `Playback interrupted: ${String(err)}`);
    }
  }

  public async togglePlay(): Promise<void> {
    this.ensureAudioGraph();
    if (!this.primaryAudio.src) return;

    if (this.ctx && this.ctx.state === 'suspended') {
      await this.ctx.resume().catch(() => {});
    }

    if (this.primaryAudio.paused) {
      try {
        await this.primaryAudio.play();
        terminalLogger.log(
          'PLAY',
          `Resumed at ${this.primaryAudio.currentTime.toFixed(1)}s`
        );
      } catch (err) {
        terminalLogger.log('ERR', `Playback start error: ${String(err)}`);
      }
    } else {
      this.primaryAudio.pause();
      terminalLogger.log(
        'PLAY',
        `Paused at ${this.primaryAudio.currentTime.toFixed(1)}s`
      );
    }
  }

  public pause(): void {
    if (!this.primaryAudio.paused) {
      this.primaryAudio.pause();
    }
  }

  public seek(seconds: number): void {
    if (!this.primaryAudio.src || !Number.isFinite(seconds)) return;
    const clamped = Math.max(
      0,
      Math.min(
        seconds,
        this.primaryAudio.duration || this.currentTrack?.duration || seconds
      )
    );
    this.primaryAudio.currentTime = clamped;
    for (const cb of this.timeListeners) {
      cb(
        clamped,
        this.primaryAudio.duration || this.currentTrack?.duration || 0
      );
    }
  }

  public applyDSPSettings(nextDsp: DSPSettings): void {
    this.dsp = nextDsp;
    const safeVol = Number.isFinite(nextDsp.volume) ? nextDsp.volume : 0.8;
    const safePreamp = Number.isFinite(nextDsp.preamp) ? nextDsp.preamp : 0;
    const safeBalance = Number.isFinite(nextDsp.stereoBalance)
      ? nextDsp.stereoBalance
      : 0;

    if (!this.ctx) {
      this.primaryAudio.volume = nextDsp.muted
        ? 0
        : Math.max(0, Math.min(1, Math.pow(safeVol, 1.8)));
      return;
    }

    const now = this.ctx.currentTime;

    if (this.preampNode) {
      const db = nextDsp.enabled ? safePreamp : 0;
      const linearGain = Math.pow(10, db / 20);
      this.preampNode.gain.setTargetAtTime(linearGain, now, 0.015);
    }

    if (
      Array.isArray(nextDsp.bands) &&
      this.filterNodes.length === nextDsp.bands.length
    ) {
      nextDsp.bands.forEach((band, idx) => {
        const rawGain = Number.isFinite(band.gain) ? band.gain : 0;
        const gainVal = nextDsp.enabled ? rawGain : 0;
        this.filterNodes[idx].gain.setTargetAtTime(gainVal, now, 0.015);
      });
    }

    if (this.pannerNode) {
      const panVal = Math.max(-1, Math.min(1, safeBalance));
      this.pannerNode.pan.setTargetAtTime(panVal, now, 0.015);
    }

    if (this.masterGainNode) {
      this.primaryAudio.volume = 1.0;
      this.crossfadeAudio.volume = 1.0;
      const perceptualGain = computePerceptualGain(safeVol, nextDsp.muted);
      this.masterGainNode.gain.setTargetAtTime(perceptualGain, now, 0.015);
    }
  }

  public subscribeTimeUpdate(cb: TimeUpdateCallback): () => void {
    this.timeListeners.add(cb);
    return () => {
      this.timeListeners.delete(cb);
    };
  }

  public setLifecycleCallbacks(
    onEnded: () => void,
    onCrossfade: () => void,
    onPlayStateChange: (playing: boolean) => void
  ): void {
    this.onTrackEndedCallback = onEnded;
    this.onCrossfadeTriggerCallback = onCrossfade;
    this.onPlayStateChangeCallback = onPlayStateChange;
  }

  public getAnalyserNode(): AnalyserNode | null {
    return this.analyserNode;
  }

  public getCurrentTime(): number {
    return this.primaryAudio.currentTime || 0;
  }

  public getLoadedTrackId(): string | null {
    return this.currentTrack?.id || null;
  }
}

export const audioEngine = new WebAudioEngine();
