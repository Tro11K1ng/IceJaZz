import { DSPSettings, EQBand, EQPreset, TrackItem } from '../types/audio';

export const DEFAULT_EQ_FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
export const DEFAULT_EQ_LABELS = ['31', '62', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'];

export const BUILTIN_EQ_PRESETS: EQPreset[] = [
  {
    id: 'flat',
    name: 'Flat (0 dB)',
    preamp: 0,
    gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  {
    id: 'studio-monitor',
    name: 'Studio Monitor',
    preamp: -1.0,
    gains: [1.5, 1.0, 0.0, -0.5, 0.0, 0.5, 1.0, 1.5, 1.0, 0.5],
  },
  {
    id: 'hifi-v',
    name: 'Loudness Contour',
    preamp: -2.0,
    gains: [4.5, 3.8, 2.0, -1.0, -1.5, -0.5, 1.5, 3.0, 4.2, 4.0],
  },
  {
    id: 'sub-bass',
    name: 'Bass Boost',
    preamp: -2.5,
    gains: [5.5, 4.5, 3.0, 1.5, 0.0, -0.5, -0.5, 0.0, 1.0, 1.5],
  },
  {
    id: 'vocal-presence',
    name: 'Vocal Presence',
    preamp: -1.0,
    gains: [-2.0, -1.0, 0.0, 1.5, 3.0, 3.8, 2.5, 1.5, 0.5, 0.0],
  },
  {
    id: 'late-night',
    name: 'Late Night',
    preamp: 0.5,
    gains: [-3.5, -2.5, -1.0, 1.0, 2.0, 1.5, 0.5, -1.5, -2.5, -3.5],
  },
];

export function createDefaultDSPSettings(): DSPSettings {
  const bands: EQBand[] = DEFAULT_EQ_FREQUENCIES.map((freq, idx) => ({
    frequency: freq,
    label: DEFAULT_EQ_LABELS[idx],
    gain: 0,
    type:
      idx === 0
        ? 'lowshelf'
        : idx === DEFAULT_EQ_FREQUENCIES.length - 1
        ? 'highshelf'
        : 'peaking',
    q: 1.4,
  }));

  return {
    enabled: true,
    preamp: 0,
    bands,
    activePresetId: 'flat',
    crossfadeSeconds: 0,
    gapless: true,
    stereoBalance: 0,
  };
}

class StudioAudioEngine {
  private ctx: AudioContext | null = null;
  private deckA: HTMLAudioElement;
  private deckB: HTMLAudioElement;
  private activeDeck: 'A' | 'B' = 'A';

  private sourceA: MediaElementAudioSourceNode | null = null;
  private sourceB: MediaElementAudioSourceNode | null = null;
  private fadeGainA: GainNode | null = null;
  private fadeGainB: GainNode | null = null;

  private preampNode: GainNode | null = null;
  private eqNodes: BiquadFilterNode[] = [];
  private pannerNode: StereoPannerNode | null = null;
  private masterGainNode: GainNode | null = null;
  private analyserNode: AnalyserNode | null = null;

  private dspSettings: DSPSettings = createDefaultDSPSettings();
  private volume: number = 0.85;
  private isMuted: boolean = false;
  private isCrossfading: boolean = false;
  private activeObjectUrlA: string | null = null;
  private activeObjectUrlB: string | null = null;

  private timeListeners = new Set<(currentTime: number, duration: number) => void>();
  private onTrackEndedCallback?: () => void;
  private onCrossfadeTriggerCallback?: () => void;
  private onPlayStateChangeCallback?: (playing: boolean) => void;

  constructor() {
    this.deckA = new Audio();
    this.deckB = new Audio();
    this.deckA.preload = 'auto';
    this.deckB.preload = 'auto';

    this.bindDeckEvents(this.deckA, 'A');
    this.bindDeckEvents(this.deckB, 'B');
  }

  private bindDeckEvents(audioEl: HTMLAudioElement, deckId: 'A' | 'B') {
    audioEl.addEventListener('timeupdate', () => {
      if (this.activeDeck !== deckId) return;
      const cur = audioEl.currentTime || 0;
      const dur =
        Number.isFinite(audioEl.duration) && audioEl.duration > 0 ? audioEl.duration : 0;

      this.timeListeners.forEach((fn) => fn(cur, dur));

      if (
        !this.isCrossfading &&
        this.dspSettings.crossfadeSeconds > 0 &&
        dur > this.dspSettings.crossfadeSeconds + 2 &&
        dur - cur <= this.dspSettings.crossfadeSeconds
      ) {
        this.isCrossfading = true;
        if (this.onCrossfadeTriggerCallback) {
          this.onCrossfadeTriggerCallback();
        }
      }
    });

    audioEl.addEventListener('loadedmetadata', () => {
      if (this.activeDeck !== deckId) return;
      const dur =
        Number.isFinite(audioEl.duration) && audioEl.duration > 0 ? audioEl.duration : 0;
      this.timeListeners.forEach((fn) => fn(audioEl.currentTime || 0, dur));
    });

    audioEl.addEventListener('play', () => {
      if (this.activeDeck === deckId && this.onPlayStateChangeCallback) {
        this.onPlayStateChangeCallback(true);
      }
    });

    audioEl.addEventListener('pause', () => {
      if (this.activeDeck === deckId && !this.isCrossfading && this.onPlayStateChangeCallback) {
        this.onPlayStateChangeCallback(false);
      }
    });

    audioEl.addEventListener('ended', () => {
      if (this.activeDeck === deckId && !this.isCrossfading) {
        if (this.onTrackEndedCallback) {
          this.onTrackEndedCallback();
        }
      }
    });
  }

  private ensureAudioGraph() {
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();

      this.sourceA = this.ctx.createMediaElementSource(this.deckA);
      this.sourceB = this.ctx.createMediaElementSource(this.deckB);

      this.fadeGainA = this.ctx.createGain();
      this.fadeGainB = this.ctx.createGain();
      this.fadeGainA.gain.value = 1;
      this.fadeGainB.gain.value = 0;

      this.preampNode = this.ctx.createGain();
      this.pannerNode = this.ctx.createStereoPanner();
      this.masterGainNode = this.ctx.createGain();
      this.analyserNode = this.ctx.createAnalyser();
      this.analyserNode.fftSize = 1024;
      this.analyserNode.smoothingTimeConstant = 0.8;

      this.eqNodes = this.dspSettings.bands.map((band) => {
        const filter = this.ctx!.createBiquadFilter();
        filter.type = band.type;
        filter.frequency.value = band.frequency;
        filter.Q.value = band.q;
        filter.gain.value = this.dspSettings.enabled ? band.gain : 0;
        return filter;
      });

      this.sourceA.connect(this.fadeGainA);
      this.sourceB.connect(this.fadeGainB);

      this.fadeGainA.connect(this.preampNode);
      this.fadeGainB.connect(this.preampNode);

      let prevNode: AudioNode = this.preampNode;
      for (const filter of this.eqNodes) {
        prevNode.connect(filter);
        prevNode = filter;
      }

      prevNode.connect(this.pannerNode);
      this.pannerNode.connect(this.masterGainNode);
      this.masterGainNode.connect(this.analyserNode);
      this.analyserNode.connect(this.ctx.destination);

      this.applyDSPSettings(this.dspSettings);
      this.setVolume(this.volume, this.isMuted);
    }

    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  public subscribeTimeUpdate(fn: (currentTime: number, duration: number) => void) {
    this.timeListeners.add(fn);
    return () => {
      this.timeListeners.delete(fn);
    };
  }

  public setLifecycleCallbacks(
    onTrackEnded: () => void,
    onCrossfadeTrigger: () => void,
    onPlayStateChange?: (playing: boolean) => void
  ) {
    this.onTrackEndedCallback = onTrackEnded;
    this.onCrossfadeTriggerCallback = onCrossfadeTrigger;
    this.onPlayStateChangeCallback = onPlayStateChange;
  }

  private resolveTrackUrl(track: TrackItem, deck: 'A' | 'B'): string {
    if (!track.fileRef) return '';
    const objUrl = URL.createObjectURL(track.fileRef);
    if (deck === 'A') {
      if (this.activeObjectUrlA) URL.revokeObjectURL(this.activeObjectUrlA);
      this.activeObjectUrlA = objUrl;
    } else {
      if (this.activeObjectUrlB) URL.revokeObjectURL(this.activeObjectUrlB);
      this.activeObjectUrlB = objUrl;
    }
    return objUrl;
  }

  public async loadAndPlay(track: TrackItem, useCrossfade = false): Promise<boolean> {
    if (!track.fileRef) return false;
    this.ensureAudioGraph();
    this.syncVolumeNodes();

    const now = this.ctx ? this.ctx.currentTime : 0;
    const xfadeSec = useCrossfade ? this.dspSettings.crossfadeSeconds : 0;

    if (xfadeSec > 0 && this.ctx && this.fadeGainA && this.fadeGainB) {
      const nextDeckId: 'A' | 'B' = this.activeDeck === 'A' ? 'B' : 'A';
      const outgoingDeck = this.activeDeck === 'A' ? this.deckA : this.deckB;
      const incomingDeck = nextDeckId === 'A' ? this.deckA : this.deckB;
      const outgoingGain = this.activeDeck === 'A' ? this.fadeGainA : this.fadeGainB;
      const incomingGain = nextDeckId === 'A' ? this.fadeGainA : this.fadeGainB;

      this.activeDeck = nextDeckId;
      incomingDeck.src = this.resolveTrackUrl(track, nextDeckId);
      incomingDeck.currentTime = 0;

      incomingGain.gain.cancelScheduledValues(now);
      outgoingGain.gain.cancelScheduledValues(now);

      incomingGain.gain.setValueAtTime(0.01, now);
      incomingGain.gain.linearRampToValueAtTime(1.0, now + xfadeSec);

      outgoingGain.gain.setValueAtTime(1.0, now);
      outgoingGain.gain.linearRampToValueAtTime(0.0, now + xfadeSec);

      try {
        await incomingDeck.play();
        setTimeout(() => {
          outgoingDeck.pause();
          this.isCrossfading = false;
        }, xfadeSec * 1000);
        return true;
      } catch {
        this.isCrossfading = false;
        return false;
      }
    } else {
      this.isCrossfading = false;
      const activeAudio = this.activeDeck === 'A' ? this.deckA : this.deckB;
      const inactiveAudio = this.activeDeck === 'A' ? this.deckB : this.deckA;
      inactiveAudio.pause();

      if (this.ctx && this.fadeGainA && this.fadeGainB) {
        this.fadeGainA.gain.cancelScheduledValues(now);
        this.fadeGainB.gain.cancelScheduledValues(now);
        this.fadeGainA.gain.setValueAtTime(this.activeDeck === 'A' ? 1 : 0, now);
        this.fadeGainB.gain.setValueAtTime(this.activeDeck === 'B' ? 1 : 0, now);
      }

      activeAudio.src = this.resolveTrackUrl(track, this.activeDeck);
      activeAudio.currentTime = 0;
      try {
        await activeAudio.play();
        return true;
      } catch {
        return false;
      }
    }
  }

  public async togglePlayPause(forceState?: boolean): Promise<boolean> {
    this.ensureAudioGraph();
    const activeAudio = this.activeDeck === 'A' ? this.deckA : this.deckB;
    if (!activeAudio.src) return false;
    const shouldPlay = forceState !== undefined ? forceState : activeAudio.paused;

    if (shouldPlay) {
      try {
        await activeAudio.play();
        return true;
      } catch {
        return false;
      }
    } else {
      activeAudio.pause();
      return false;
    }
  }

  public seek(seconds: number) {
    const activeAudio = this.activeDeck === 'A' ? this.deckA : this.deckB;
    if (Number.isFinite(seconds) && seconds >= 0 && activeAudio.src) {
      activeAudio.currentTime = Math.min(seconds, activeAudio.duration || seconds);
    }
  }

  private syncVolumeNodes() {
    const clamped = Math.max(0, Math.min(1, this.volume));
    const effective = this.isMuted ? 0 : clamped;

    // Directly set HTMLAudioElement volume + mute AND Web Audio GainNode so volume is 100% reliable
    this.deckA.muted = this.isMuted;
    this.deckB.muted = this.isMuted;
    this.deckA.volume = effective;
    this.deckB.volume = effective;

    if (this.masterGainNode && this.ctx) {
      this.masterGainNode.gain.cancelScheduledValues(this.ctx.currentTime);
      this.masterGainNode.gain.setValueAtTime(effective, this.ctx.currentTime);
    }
  }

  public setVolume(vol: number, muted = false) {
    this.volume = Math.max(0, Math.min(1, vol));
    this.isMuted = muted;
    this.syncVolumeNodes();
  }

  public getVolume() {
    return { volume: this.volume, isMuted: this.isMuted };
  }

  public applyDSPSettings(settings: DSPSettings) {
    this.dspSettings = settings;
    if (!this.ctx || !this.preampNode || !this.pannerNode) return;

    const now = this.ctx.currentTime;
    const preampLinear = settings.enabled ? Math.pow(10, settings.preamp / 20) : 1.0;
    this.preampNode.gain.setTargetAtTime(preampLinear, now, 0.015);
    this.pannerNode.pan.setTargetAtTime(settings.stereoBalance, now, 0.015);

    settings.bands.forEach((band, idx) => {
      const node = this.eqNodes[idx];
      if (node) {
        const targetGain = settings.enabled ? band.gain : 0;
        node.gain.setTargetAtTime(targetGain, now, 0.02);
      }
    });
  }

  public getAnalyserNode(): AnalyserNode | null {
    return this.analyserNode;
  }

  public isPlaying(): boolean {
    const activeAudio = this.activeDeck === 'A' ? this.deckA : this.deckB;
    return !activeAudio.paused && !activeAudio.ended && Boolean(activeAudio.src);
  }
}

export const audioEngine = new StudioAudioEngine();
