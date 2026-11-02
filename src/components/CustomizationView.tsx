import React, { useEffect, useState } from 'react';
import {
  DiscordConfig,
  OverlayConfig,
  SystemConfig,
  ThemeConfig,
  TrackItem,
} from '../types/audio';
import {
  BUILTIN_THEMES,
  createDefaultDiscordConfig,
  createDefaultOverlayConfig,
  createDefaultSystemConfig,
  createDefaultThemeConfig,
} from '../utils/storageEngine';

interface CustomizationViewProps {
  theme: ThemeConfig;
  overlay: OverlayConfig;
  discord: DiscordConfig;
  systemConfig: SystemConfig;
  discordStatus: string;
  currentTrack: TrackItem | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  onChangeTheme: (next: ThemeConfig) => void;
  onChangeOverlay: (next: OverlayConfig) => void;
  onChangeDiscord: (next: DiscordConfig) => void;
  onChangeSystemConfig: (next: SystemConfig) => void;
  onReconnectDiscord: () => void;
}

function formatShortTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export const CustomizationView: React.FC<CustomizationViewProps> = ({
  theme,
  overlay,
  discord,
  systemConfig,
  discordStatus,
  currentTrack,
  isPlaying,
  currentTime,
  duration,
  onChangeTheme,
  onChangeOverlay,
  onChangeDiscord,
  onChangeSystemConfig,
  onReconnectDiscord,
}) => {
  const effectiveDur = duration > 0 ? duration : currentTrack?.duration || 0;
  const pct =
    effectiveDur > 0 ? Math.min(100, (currentTime / effectiveDur) * 100) : 0;

  const [verifiedAppName, setVerifiedAppName] = useState<string>('VERIFYING...');
  const [isClientValid, setIsClientValid] = useState<boolean>(true);

  useEffect(() => {
    const cleanId = (discord.clientId || '').trim();
    if (!/^\d{17,20}$/.test(cleanId)) {
      setVerifiedAppName('INVALID FORMAT');
      setIsClientValid(false);
      return;
    }

    let cancelled = false;
    setVerifiedAppName('CHECKING...');
    fetch(`https://discord.com/api/v9/oauth2/applications/${cleanId}/rpc`)
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          setVerifiedAppName('UNREGISTERED APP ID');
          setIsClientValid(false);
          return;
        }
        const data = await res.json();
        if (!cancelled) {
          setVerifiedAppName(
            data?.name ? String(data.name).toUpperCase() : 'VERIFIED RPC APP'
          );
          setIsClientValid(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setVerifiedAppName('LOCAL IPC MODE');
          setIsClientValid(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [discord.clientId]);

  return (
    <div className="min-h-full p-6 space-y-6 bg-[var(--bg-base)] text-[var(--text-main)]">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b-[3px] border-[var(--text-main)]">
        <h2 className="text-base font-bold text-[var(--accent)] uppercase">
          [ CUSTOMIZATION &amp; INTEGRATIONS :: ICEJAZZ ]
        </h2>

        <button
          type="button"
          onClick={() => {
            onChangeTheme(createDefaultThemeConfig());
            onChangeOverlay(createDefaultOverlayConfig());
            onChangeDiscord(createDefaultDiscordConfig());
            onChangeSystemConfig(createDefaultSystemConfig());
          }}
          className="btn-brutal transition-ui px-3 py-1.5 text-xs"
        >
          RESET DEFAULTS
        </button>
      </div>

      {/* Section 1: Color Presets & Custom Palette */}
      <div className="bg-[var(--bg-surface)] border-[3px] border-[var(--text-main)] p-5 space-y-5">
        <div className="flex items-center justify-between">
          <div className="text-xs font-extrabold uppercase text-[var(--accent)]">
            [01] COLOR THEMES
          </div>
          <span className="text-xs text-[var(--text-dim)] font-mono">
            ACTIVE: {theme.name.toUpperCase()}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {BUILTIN_THEMES.map((preset) => {
            const isSelected = theme.id === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => onChangeTheme(preset)}
                className={`p-3 text-left border-[3px] transition-ui cursor-pointer flex items-center justify-between ${
                  isSelected
                    ? 'border-[var(--accent)] bg-[var(--bg-base)]'
                    : 'border-[var(--text-main)] bg-[var(--bg-base)] opacity-80 hover:opacity-100'
                }`}
              >
                <div>
                  <div className="text-xs font-extrabold uppercase text-[var(--text-main)]">
                    {preset.name}
                  </div>
                  <div className="text-[10px] font-mono text-[var(--text-dim)] mt-0.5">
                    ACCENT: {preset.accent}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span
                    className="w-5 h-5 border border-white/40 inline-block"
                    style={{ backgroundColor: preset.bgBase }}
                  />
                  <span
                    className="w-5 h-5 border border-white/40 inline-block"
                    style={{ backgroundColor: preset.accent }}
                  />
                  <span
                    className="w-5 h-5 border border-white/40 inline-block"
                    style={{ backgroundColor: preset.textMain }}
                  />
                </div>
              </button>
            );
          })}
        </div>

        <div className="pt-4 border-t-[1px] border-[var(--text-dim)] space-y-4">
          <div className="text-xs font-extrabold uppercase text-[var(--text-main)]">
            CUSTOM PALETTE (HEX)
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <label className="bg-[var(--bg-base)] border-[1px] border-[var(--text-dim)] p-3 flex flex-col gap-2 cursor-pointer">
              <span className="text-[11px] font-bold text-[var(--text-dim)] uppercase">
                Accent (--accent)
              </span>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={theme.accent}
                  onChange={(e) =>
                    onChangeTheme({
                      ...theme,
                      id: 'custom',
                      name: 'Custom Theme',
                      accent: e.target.value,
                    })
                  }
                  className="w-8 h-8 bg-transparent border-0 cursor-pointer"
                />
                <input
                  type="text"
                  value={theme.accent}
                  onChange={(e) =>
                    onChangeTheme({
                      ...theme,
                      id: 'custom',
                      name: 'Custom Theme',
                      accent: e.target.value,
                    })
                  }
                  className="w-full px-2 py-1 text-xs bg-[var(--bg-surface)] border-[1px] border-[var(--text-dim)] text-[var(--text-main)] font-mono"
                />
              </div>
            </label>

            <label className="bg-[var(--bg-base)] border-[1px] border-[var(--text-dim)] p-3 flex flex-col gap-2 cursor-pointer">
              <span className="text-[11px] font-bold text-[var(--text-dim)] uppercase">
                Base (--bg-base)
              </span>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={theme.bgBase}
                  onChange={(e) =>
                    onChangeTheme({
                      ...theme,
                      id: 'custom',
                      name: 'Custom Theme',
                      bgBase: e.target.value,
                    })
                  }
                  className="w-8 h-8 bg-transparent border-0 cursor-pointer"
                />
                <input
                  type="text"
                  value={theme.bgBase}
                  onChange={(e) =>
                    onChangeTheme({
                      ...theme,
                      id: 'custom',
                      name: 'Custom Theme',
                      bgBase: e.target.value,
                    })
                  }
                  className="w-full px-2 py-1 text-xs bg-[var(--bg-surface)] border-[1px] border-[var(--text-dim)] text-[var(--text-main)] font-mono"
                />
              </div>
            </label>

            <label className="bg-[var(--bg-base)] border-[1px] border-[var(--text-dim)] p-3 flex flex-col gap-2 cursor-pointer">
              <span className="text-[11px] font-bold text-[var(--text-dim)] uppercase">
                Surface (--bg-surface)
              </span>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={theme.bgSurface}
                  onChange={(e) =>
                    onChangeTheme({
                      ...theme,
                      id: 'custom',
                      name: 'Custom Theme',
                      bgSurface: e.target.value,
                    })
                  }
                  className="w-8 h-8 bg-transparent border-0 cursor-pointer"
                />
                <input
                  type="text"
                  value={theme.bgSurface}
                  onChange={(e) =>
                    onChangeTheme({
                      ...theme,
                      id: 'custom',
                      name: 'Custom Theme',
                      bgSurface: e.target.value,
                    })
                  }
                  className="w-full px-2 py-1 text-xs bg-[var(--bg-surface)] border-[1px] border-[var(--text-dim)] text-[var(--text-main)] font-mono"
                />
              </div>
            </label>

            <label className="bg-[var(--bg-base)] border-[1px] border-[var(--text-dim)] p-3 flex flex-col gap-2 cursor-pointer">
              <span className="text-[11px] font-bold text-[var(--text-dim)] uppercase">
                Primary (--text-main)
              </span>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={theme.textMain}
                  onChange={(e) =>
                    onChangeTheme({
                      ...theme,
                      id: 'custom',
                      name: 'Custom Theme',
                      textMain: e.target.value,
                    })
                  }
                  className="w-8 h-8 bg-transparent border-0 cursor-pointer"
                />
                <input
                  type="text"
                  value={theme.textMain}
                  onChange={(e) =>
                    onChangeTheme({
                      ...theme,
                      id: 'custom',
                      name: 'Custom Theme',
                      textMain: e.target.value,
                    })
                  }
                  className="w-full px-2 py-1 text-xs bg-[var(--bg-surface)] border-[1px] border-[var(--text-dim)] text-[var(--text-main)] font-mono"
                />
              </div>
            </label>

            <label className="bg-[var(--bg-base)] border-[1px] border-[var(--text-dim)] p-3 flex flex-col gap-2 cursor-pointer">
              <span className="text-[11px] font-bold text-[var(--text-dim)] uppercase">
                Dim (--text-dim)
              </span>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={theme.textDim}
                  onChange={(e) =>
                    onChangeTheme({
                      ...theme,
                      id: 'custom',
                      name: 'Custom Theme',
                      textDim: e.target.value,
                    })
                  }
                  className="w-8 h-8 bg-transparent border-0 cursor-pointer"
                />
                <input
                  type="text"
                  value={theme.textDim}
                  onChange={(e) =>
                    onChangeTheme({
                      ...theme,
                      id: 'custom',
                      name: 'Custom Theme',
                      textDim: e.target.value,
                    })
                  }
                  className="w-full px-2 py-1 text-xs bg-[var(--bg-surface)] border-[1px] border-[var(--text-dim)] text-[var(--text-main)] font-mono"
                />
              </div>
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-4 pt-2">
            <button
              type="button"
              onClick={() =>
                onChangeTheme({ ...theme, scanlines: !theme.scanlines })
              }
              className={`btn-brutal transition-ui text-xs ${
                theme.scanlines ? 'primary' : ''
              }`}
            >
              CRT SCANLINES: {theme.scanlines ? 'ON' : 'OFF'}
            </button>

            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-[var(--text-dim)] uppercase">
                BORDER WIDTH:
              </span>
              {[1, 2, 3, 4].map((px) => (
                <button
                  key={px}
                  type="button"
                  onClick={() =>
                    onChangeTheme({ ...theme, borderThickness: px })
                  }
                  className={`btn-brutal transition-ui px-2.5 py-1 text-xs ${
                    theme.borderThickness === px ? 'primary' : ''
                  }`}
                >
                  {px}PX
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Section 2: Configurable Overlay Mode */}
      <div className="bg-[var(--bg-surface)] border-[3px] border-[var(--text-main)] p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs font-extrabold uppercase text-[var(--accent)]">
            [02] OVERLAY MODE CONFIGURATION
          </div>

          <button
            type="button"
            onClick={() =>
              onChangeOverlay({ ...overlay, enabled: !overlay.enabled })
            }
            className={`btn-brutal transition-ui px-4 py-1.5 text-xs ${
              overlay.enabled ? 'primary' : ''
            }`}
          >
            {overlay.enabled ? 'EXIT OVERLAY' : 'LAUNCH OVERLAY'}
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
          <div className="bg-[var(--bg-base)] border-[1px] border-[var(--text-dim)] p-4 space-y-2">
            <div className="flex items-center justify-between text-xs font-bold">
              <span>OVERLAY OPACITY</span>
              <span className="text-[var(--accent)] font-mono">
                {Math.round(overlay.opacity * 100)}%
              </span>
            </div>
            <input
              type="range"
              min={0.35}
              max={1}
              step={0.05}
              value={overlay.opacity}
              onChange={(e) =>
                onChangeOverlay({
                  ...overlay,
                  opacity: parseFloat(e.target.value),
                })
              }
              className="studio-slider w-full"
            />
          </div>

          <div className="bg-[var(--bg-base)] border-[1px] border-[var(--text-dim)] p-4 space-y-2">
            <div className="flex items-center justify-between text-xs font-bold">
              <span>OVERLAY WIDTH (PX)</span>
              <span className="text-[var(--accent)] font-mono">
                {overlay.width} px
              </span>
            </div>
            <input
              type="range"
              min={340}
              max={680}
              step={20}
              value={overlay.width}
              onChange={(e) =>
                onChangeOverlay({
                  ...overlay,
                  width: parseInt(e.target.value, 10),
                })
              }
              className="studio-slider w-full"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            onClick={() =>
              onChangeOverlay({ ...overlay, showCover: !overlay.showCover })
            }
            className={`btn-brutal transition-ui text-xs ${
              overlay.showCover ? 'primary' : ''
            }`}
          >
            COVER ART: {overlay.showCover ? 'ON' : 'OFF'}
          </button>

          <button
            type="button"
            onClick={() =>
              onChangeOverlay({
                ...overlay,
                showVisualizer: !overlay.showVisualizer,
              })
            }
            className={`btn-brutal transition-ui text-xs ${
              overlay.showVisualizer ? 'primary' : ''
            }`}
          >
            VISUALIZER: {overlay.showVisualizer ? 'ON' : 'OFF'}
          </button>

          <button
            type="button"
            onClick={() =>
              onChangeOverlay({
                ...overlay,
                showLyricsLine: !overlay.showLyricsLine,
              })
            }
            className={`btn-brutal transition-ui text-xs ${
              overlay.showLyricsLine ? 'primary' : ''
            }`}
          >
            LYRICS LINE: {overlay.showLyricsLine ? 'ON' : 'OFF'}
          </button>

          <button
            type="button"
            onClick={() =>
              onChangeOverlay({
                ...overlay,
                showProgress: !overlay.showProgress,
              })
            }
            className={`btn-brutal transition-ui text-xs ${
              overlay.showProgress ? 'primary' : ''
            }`}
          >
            PROGRESS BAR: {overlay.showProgress ? 'ON' : 'OFF'}
          </button>

          <button
            type="button"
            onClick={() =>
              onChangeOverlay({
                ...overlay,
                showRating: !overlay.showRating,
              })
            }
            className={`btn-brutal transition-ui text-xs ${
              overlay.showRating ? 'primary' : ''
            }`}
          >
            RATING ★: {overlay.showRating ? 'ON' : 'OFF'}
          </button>
        </div>
      </div>

      {/* Section 3: Discord Rich Presence */}
      <div className="bg-[var(--bg-surface)] border-[3px] border-[var(--text-main)] p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs font-extrabold uppercase text-[var(--accent)]">
              [03] DISCORD RICH PRESENCE
            </span>
            <span className="text-[11px] font-mono px-2 py-0.5 border border-[var(--text-dim)] text-[var(--text-main)] uppercase">
              IPC: {discordStatus}
            </span>
            <span
              className={`text-[11px] font-mono px-2 py-0.5 border uppercase ${
                isClientValid
                  ? 'border-[var(--accent)] text-[var(--accent)]'
                  : 'border-red-500 text-red-400'
              }`}
            >
              APP: {verifiedAppName}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onReconnectDiscord}
              className="btn-brutal transition-ui px-3 py-1.5 text-xs"
            >
              RECONNECT IPC
            </button>
            <button
              type="button"
              onClick={() =>
                onChangeDiscord({ ...discord, enabled: !discord.enabled })
              }
              className={`btn-brutal transition-ui px-4 py-1.5 text-xs ${
                discord.enabled ? 'primary' : ''
              }`}
            >
              {discord.enabled
                ? 'DISCORD RPC: ENABLED'
                : 'DISCORD RPC: DISABLED'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 pt-1">
          <div className="space-y-3">
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                <label className="block text-xs font-bold text-[var(--text-dim)] uppercase">
                  DISCORD APPLICATION CLIENT ID
                </label>
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      onChangeDiscord({
                        ...discord,
                        clientId: '1129859263741837373',
                      })
                    }
                    className={`px-2 py-0.5 text-[10px] border cursor-pointer uppercase font-bold ${
                      discord.clientId === '1129859263741837373'
                        ? 'border-[var(--accent)] text-[var(--accent)]'
                        : 'border-[var(--text-dim)] text-[var(--text-dim)]'
                    }`}
                  >
                    &quot;MUSIC&quot; ID
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onChangeDiscord({
                        ...discord,
                        clientId: '507982587416018945',
                      })
                    }
                    className={`px-2 py-0.5 text-[10px] border cursor-pointer uppercase font-bold ${
                      discord.clientId === '507982587416018945'
                        ? 'border-[var(--accent)] text-[var(--accent)]'
                        : 'border-[var(--text-dim)] text-[var(--text-dim)]'
                    }`}
                  >
                    FOOBAR2000 ID
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onChangeDiscord({
                        ...discord,
                        clientId: '954253873160286278',
                      })
                    }
                    className={`px-2 py-0.5 text-[10px] border cursor-pointer uppercase font-bold ${
                      discord.clientId === '954253873160286278'
                        ? 'border-[var(--accent)] text-[var(--accent)]'
                        : 'border-[var(--text-dim)] text-[var(--text-dim)]'
                    }`}
                  >
                    TAUON ID
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const url = 'https://discord.com/developers/applications';
                      if (window.icejazzDesktop?.openExternalUrl) {
                        window.icejazzDesktop.openExternalUrl(url);
                      } else {
                        navigator.clipboard?.writeText(url).catch(() => {});
                      }
                    }}
                    className="px-2 py-0.5 text-[10px] border border-[var(--accent)] text-[var(--accent)] cursor-pointer uppercase font-bold hover:bg-[var(--accent)] hover:text-[var(--text-dark)]"
                    title="Open Discord Developer Portal -> New Application -> Name it 'IceJaZz' -> Paste Application ID below"
                  >
                    CREATE &quot;ICEJAZZ&quot; ID
                  </button>
                </div>
              </div>
              <input
                type="text"
                value={discord.clientId}
                onChange={(e) =>
                  onChangeDiscord({ ...discord, clientId: e.target.value })
                }
                placeholder="1129859263741837373"
                className="w-full px-3 py-1.5 text-xs bg-[var(--bg-base)] border-[1px] border-[var(--text-dim)] text-[var(--text-main)] focus:outline-none focus:border-[var(--accent)] font-mono"
              />
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                onClick={() =>
                  onChangeDiscord({
                    ...discord,
                    showTimestamps: !discord.showTimestamps,
                  })
                }
                className={`btn-brutal transition-ui text-xs ${
                  discord.showTimestamps ? 'primary' : ''
                }`}
              >
                PROGRESS BAR TIMESTAMPS: {discord.showTimestamps ? 'ON' : 'OFF'}
              </button>

              <button
                type="button"
                onClick={() =>
                  onChangeDiscord({
                    ...discord,
                    showWhenPaused: !discord.showWhenPaused,
                  })
                }
                className={`btn-brutal transition-ui text-xs ${
                  discord.showWhenPaused ? 'primary' : ''
                }`}
              >
                SHOW WHEN PAUSED: {discord.showWhenPaused ? 'ON' : 'OFF'}
              </button>
            </div>
          </div>

          {/* Live Discord Profile Rich Presence Preview */}
          <div className="bg-[var(--bg-base)] border-[2px] border-[var(--text-main)] p-4 space-y-2.5">
            <div className="flex items-center justify-between text-[10px] font-extrabold tracking-wider text-[var(--accent)] uppercase">
              <span>LISTENING TO {verifiedAppName}</span>
              <span>{isPlaying ? 'LIVE' : 'PAUSED'}</span>
            </div>

            <div className="flex items-center gap-3">
              <div className="w-14 h-14 border-[2px] border-[var(--text-main)] bg-[var(--bg-surface)] shrink-0 overflow-hidden flex items-center justify-center">
                {currentTrack?.coverUrl ? (
                  <img
                    src={currentTrack.coverUrl}
                    alt="Cover"
                    className="w-full h-full object-cover grayscale"
                  />
                ) : (
                  <span className="text-xs font-extrabold text-[var(--accent)]">
                    IJZ
                  </span>
                )}
              </div>

              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="text-xs font-extrabold text-[var(--text-main)] truncate">
                  {currentTrack ? currentTrack.title : 'Idle'}
                </div>
                <div className="text-xs text-[var(--text-dim)] truncate">
                  {currentTrack
                    ? `by ${currentTrack.artist}`
                    : 'No track active'}
                </div>
                {currentTrack && (
                  <div className="text-[11px] text-[var(--text-dim)] truncate">
                    on {currentTrack.album} [{currentTrack.format}]
                  </div>
                )}
              </div>
            </div>

            {discord.showTimestamps && currentTrack && (
              <div className="space-y-1 pt-1">
                <div className="h-1.5 bg-[var(--bg-surface)] border-[1px] border-[var(--text-dim)] overflow-hidden">
                  <div
                    className="h-full bg-[var(--accent)]"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-[10px] font-mono text-[var(--text-dim)]">
                  <span>{formatShortTime(currentTime)}</span>
                  <span>{formatShortTime(effectiveDur)}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Section 4: System Startup & Desktop Application */}
      <div className="bg-[var(--bg-surface)] border-[3px] border-[var(--text-main)] p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs font-extrabold uppercase text-[var(--accent)]">
            [04] SYSTEM STARTUP &amp; WINDOWS INTEGRATION
          </div>
          <span className="text-xs font-mono text-[var(--text-dim)] uppercase">
            AUTOSTART: {systemConfig.openAtLogin ? 'ENABLED' : 'DISABLED'}
          </span>
        </div>

        <div className="flex flex-wrap gap-3 pt-1">
          <button
            type="button"
            onClick={() =>
              onChangeSystemConfig({
                ...systemConfig,
                openAtLogin: !systemConfig.openAtLogin,
              })
            }
            className={`btn-brutal transition-ui px-4 py-2 text-xs ${
              systemConfig.openAtLogin ? 'primary' : ''
            }`}
          >
            LAUNCH ON SYSTEM STARTUP: {systemConfig.openAtLogin ? 'ON' : 'OFF'}
          </button>

          <button
            type="button"
            onClick={() =>
              onChangeSystemConfig({
                ...systemConfig,
                startInTray: !systemConfig.startInTray,
              })
            }
            className={`btn-brutal transition-ui px-4 py-2 text-xs ${
              systemConfig.startInTray ? 'primary' : ''
            }`}
          >
            START MINIMIZED IN TRAY: {systemConfig.startInTray ? 'ON' : 'OFF'}
          </button>
        </div>
      </div>
    </div>
  );
};
