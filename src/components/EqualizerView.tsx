// filepath: src/components/EqualizerView.tsx
import React, { useState } from 'react';
import { RotateCcw, Save, Sliders, Volume2, Waves } from 'lucide-react';
import { DSPSettings, EQPreset } from '../types/audio';
import { BUILTIN_EQ_PRESETS } from '../utils/audioEngine';

interface EqualizerViewProps {
  dsp: DSPSettings;
  customPresets: EQPreset[];
  onChangeDSP: (next: DSPSettings) => void;
  onSavePreset: (preset: EQPreset) => void;
}

export const EqualizerView: React.FC<EqualizerViewProps> = ({
  dsp,
  customPresets,
  onChangeDSP,
  onSavePreset,
}) => {
  const [newPresetName, setNewPresetName] = useState('');
  const [showSaveInput, setShowSaveInput] = useState(false);

  const allPresets = [...BUILTIN_EQ_PRESETS, ...customPresets];

  const handleSelectPreset = (preset: EQPreset) => {
    const updatedBands = dsp.bands.map((b, idx) => ({
      ...b,
      gain: preset.gains[idx] ?? 0,
    }));
    onChangeDSP({
      ...dsp,
      preamp: preset.preamp,
      bands: updatedBands,
      activePresetId: preset.id,
    });
  };

  const handleBandChange = (index: number, newGain: number) => {
    const updatedBands = dsp.bands.map((b, idx) =>
      idx === index ? { ...b, gain: Number(newGain.toFixed(1)) } : b
    );
    onChangeDSP({
      ...dsp,
      bands: updatedBands,
      activePresetId: 'custom',
    });
  };

  const handleResetFlat = () => {
    handleSelectPreset(BUILTIN_EQ_PRESETS[0]);
  };

  const handleSaveCustomPreset = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newPresetName.trim();
    if (!trimmed) return;
    const preset: EQPreset = {
      id: `custom-${Date.now()}`,
      name: trimmed,
      preamp: dsp.preamp,
      gains: dsp.bands.map((b) => b.gain),
      isCustom: true,
    };
    onSavePreset(preset);
    onChangeDSP({ ...dsp, activePresetId: preset.id });
    setNewPresetName('');
    setShowSaveInput(false);
  };

  const svgWidth = 680;
  const svgHeight = 130;
  const midY = svgHeight / 2;
  const maxDb = 15;

  const points = dsp.bands.map((b, idx) => {
    const x = 36 + (idx * (svgWidth - 72)) / (dsp.bands.length - 1);
    const totalDb = Math.max(-maxDb, Math.min(maxDb, dsp.enabled ? b.gain : 0));
    const y = midY - (totalDb / maxDb) * (midY - 18);
    return { x, y, gain: b.gain, label: b.label };
  });

  const buildSmoothPath = (pts: { x: number; y: number }[]) => {
    if (pts.length === 0) return '';
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i];
      const p1 = pts[i + 1];
      const cx1 = p0.x + (p1.x - p0.x) * 0.45;
      const cy1 = p0.y;
      const cx2 = p0.x + (p1.x - p0.x) * 0.55;
      const cy2 = p1.y;
      d += ` C ${cx1} ${cy1}, ${cx2} ${cy2}, ${p1.x} ${p1.y}`;
    }
    return d;
  };

  const curvePath = buildSmoothPath(points);
  const fillPath = `${curvePath} L ${points[points.length - 1].x} ${midY} L ${points[0].x} ${midY} Z`;
  const preampY = midY - ((dsp.enabled ? dsp.preamp : 0) / maxDb) * (midY - 18);

  return (
    <div className="h-full overflow-y-auto p-6 space-y-5 bg-[var(--bg-base)] text-[var(--text-main)]">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b-[3px] border-[var(--text-main)]">
        <div>
          <h2 className="text-base font-bold text-[var(--accent)] flex items-center gap-2 uppercase">
            <Sliders className="w-4 h-4" />
            <span>[ TRL_DSP_CORE :: TrollKing ]</span>
          </h2>
          <p className="text-xs text-[var(--text-dim)] mt-0.5 uppercase">
            Hardware-accelerated routing & multi-band EQ
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => onChangeDSP({ ...dsp, enabled: !dsp.enabled })}
            className={`btn-brutal transition-ui px-3.5 py-1.5 text-xs ${dsp.enabled ? 'primary' : ''}`}
          >
            {dsp.enabled ? 'DSP_ONLINE' : 'DSP_BYPASSED'}
          </button>

          <button
            type="button"
            onClick={handleResetFlat}
            className="btn-brutal transition-ui flex items-center gap-1.5 px-3 py-1.5 text-xs"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>FLAT_RESET</span>
          </button>
        </div>
      </div>

      <div className="bg-[var(--bg-surface)] border-[3px] border-[var(--text-main)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <span className="text-xs font-bold text-[var(--text-dim)] uppercase">EQ_PRESETS</span>
          {!showSaveInput ? (
            <button
              type="button"
              onClick={() => setShowSaveInput(true)}
              className="btn-brutal transition-ui flex items-center gap-1.5 px-3 py-1 text-xs"
            >
              <Save className="w-3.5 h-3.5" />
              <span>DUMP_STATE</span>
            </button>
          ) : (
            <form onSubmit={handleSaveCustomPreset} className="flex items-center gap-2">
              <input
                type="text"
                value={newPresetName}
                onChange={(e) => setNewPresetName(e.target.value)}
                placeholder="PRESET_ID..."
                className="px-2.5 py-1 text-xs bg-[var(--bg-base)] border-[1px] border-[var(--text-dim)] text-[var(--text-main)] focus:outline-none focus:border-[var(--accent)] font-mono uppercase"
                autoFocus
              />
              <button type="submit" className="btn-brutal primary transition-ui px-3 py-1 text-xs">
                WRITE
              </button>
              <button
                type="button"
                onClick={() => setShowSaveInput(false)}
                className="btn-brutal transition-ui px-2 py-1 text-xs"
              >
                ABORT
              </button>
            </form>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {allPresets.map((preset) => {
            const isActive = dsp.activePresetId === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => handleSelectPreset(preset)}
                className={`btn-brutal transition-ui px-3 py-1.5 text-xs ${isActive ? 'primary' : ''}`}
              >
                {preset.name.toUpperCase()}
              </button>
            );
          })}
        </div>
      </div>

      <div className="bg-[var(--bg-surface)] border-[3px] border-[var(--text-main)] p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-bold text-[var(--text-dim)] uppercase">
            FREQ_RESPONSE (20Hz - 20kHz)
          </span>
          <span className="text-xs font-mono font-bold">
            PREAMP:{' '}
            <strong className="text-[var(--accent)]">
              {dsp.preamp >= 0 ? `+${dsp.preamp.toFixed(1)}` : dsp.preamp.toFixed(1)} dB
            </strong>
          </span>
        </div>

        <div className="bg-[#000000] border-[1px] border-[var(--text-dim)] overflow-hidden">
          <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="w-full h-32 block">
            <line x1="0" y1={18} x2={svgWidth} y2={18} stroke="var(--text-dim)" strokeDasharray="3 3" />
            <line x1="0" y1={midY} x2={svgWidth} y2={midY} stroke="var(--text-main)" strokeWidth="1" />
            <line x1="0" y1={svgHeight - 18} x2={svgWidth} y2={svgHeight - 18} stroke="var(--text-dim)" strokeDasharray="3 3" />

            <line x1="0" y1={preampY} x2={svgWidth} y2={preampY} stroke="var(--text-dim)" strokeOpacity="0.5" strokeDasharray="4 4" />

            <path d={fillPath} fill="var(--accent)" opacity="0.15" />
            <path d={curvePath} fill="none" stroke="var(--accent)" strokeWidth="2" />

            {points.map((pt, i) => (
              <g key={i}>
                <line x1={pt.x} y1={14} x2={pt.x} y2={svgHeight - 14} stroke="var(--text-dim)" strokeWidth="1" opacity="0.5" />
                <circle cx={pt.x} cy={pt.y} r="4" fill={pt.gain === 0 ? 'var(--text-main)' : 'var(--accent)'} stroke="#000000" strokeWidth="1.5" />
              </g>
            ))}

            <text x="8" y="15" fill="var(--text-dim)" fontSize="9" fontFamily="JetBrains Mono">+12 dB</text>
            <text x="8" y={midY - 4} fill="var(--text-main)" fontSize="9" fontFamily="JetBrains Mono">0 dB</text>
            <text x="8" y={svgHeight - 6} fill="var(--text-dim)" fontSize="9" fontFamily="JetBrains Mono">-12 dB</text>
          </svg>
        </div>
      </div>

      <div className="bg-[var(--bg-surface)] border-[3px] border-[var(--text-main)] p-4">
        <div className="grid grid-cols-11 gap-2 items-center">
          <div className="flex flex-col items-center pr-3 border-r-[1px] border-[var(--text-dim)]">
            <span className="text-xs font-mono font-bold text-[var(--accent)] mb-2">
              {dsp.preamp > 0 ? `+${dsp.preamp.toFixed(1)}` : dsp.preamp.toFixed(1)} dB
            </span>
            <div className="h-36 flex items-center justify-center">
              <input
                type="range"
                min={-12}
                max={12}
                step={0.5}
                value={dsp.preamp}
                onDoubleClick={() => onChangeDSP({ ...dsp, preamp: 0 })}
                onChange={(e) =>
                  onChangeDSP({
                    ...dsp,
                    preamp: parseFloat(e.target.value),
                    activePresetId: 'custom',
                  })
                }
                className="studio-slider w-28 -rotate-90"
                style={{ accentColor: 'var(--accent)' }}
              />
            </div>
            <span className="text-xs font-mono font-bold mt-2 uppercase">PREAMP</span>
          </div>

          {dsp.bands.map((band, idx) => (
            <div key={band.frequency} className="flex flex-col items-center">
              <span
                className={`text-xs font-mono font-bold mb-2 ${
                  band.gain !== 0 ? 'text-[var(--accent)]' : 'text-[var(--text-dim)]'
                }`}
              >
                {band.gain > 0 ? `+${band.gain.toFixed(1)}` : band.gain.toFixed(1)}
              </span>

              <div className="h-36 flex items-center justify-center">
                <input
                  type="range"
                  min={-12}
                  max={12}
                  step={0.5}
                  value={band.gain}
                  onDoubleClick={() => handleBandChange(idx, 0)}
                  onChange={(e) => handleBandChange(idx, parseFloat(e.target.value))}
                  className="studio-slider w-28 -rotate-90"
                  style={{ accentColor: 'var(--accent)' }}
                />
              </div>

              <span className="text-xs font-mono text-[var(--text-dim)] font-bold mt-2">
                {band.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-[var(--bg-surface)] border-[3px] border-[var(--text-main)] p-4 space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Waves className="w-4 h-4 text-[var(--accent)]" />
              <span className="text-xs font-bold uppercase">X_FADE_DUR</span>
            </div>
            <span className="text-xs font-mono text-[var(--accent)] font-bold">
              {dsp.crossfadeSeconds === 0
                ? 'GAPLESS'
                : `${dsp.crossfadeSeconds.toFixed(1)}s`}
            </span>
          </div>
          <div className="flex items-center gap-3 pt-1">
            <span className="text-xs font-mono text-[var(--text-dim)] font-bold">0s</span>
            <input
              type="range"
              min={0}
              max={12}
              step={0.5}
              value={dsp.crossfadeSeconds}
              onChange={(e) =>
                onChangeDSP({ ...dsp, crossfadeSeconds: parseFloat(e.target.value) })
              }
              className="studio-slider flex-1"
              style={{ accentColor: 'var(--accent)' }}
            />
            <span className="text-xs font-mono text-[var(--text-dim)] font-bold">12s</span>
          </div>
        </div>

        <div className="bg-[var(--bg-surface)] border-[3px] border-[var(--text-main)] p-4 space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Volume2 className="w-4 h-4 text-[var(--accent)]" />
              <span className="text-xs font-bold uppercase">ST_PAN</span>
            </div>
            <span className="text-xs font-mono text-[var(--accent)] font-bold">
              {dsp.stereoBalance === 0
                ? 'CTR'
                : dsp.stereoBalance < 0
                ? `L${Math.abs(Math.round(dsp.stereoBalance * 100))}%`
                : `R${Math.round(dsp.stereoBalance * 100)}%`}
            </span>
          </div>
          <div className="flex items-center gap-3 pt-1">
            <span className="text-xs font-mono text-[var(--text-dim)] font-bold">L</span>
            <input
              type="range"
              min={-1}
              max={1}
              step={0.05}
              value={dsp.stereoBalance}
              onDoubleClick={() => onChangeDSP({ ...dsp, stereoBalance: 0 })}
              onChange={(e) =>
                onChangeDSP({ ...dsp, stereoBalance: parseFloat(e.target.value) })
              }
              className="studio-slider flex-1"
              style={{ accentColor: 'var(--accent)' }}
            />
            <span className="text-xs font-mono text-[var(--text-dim)] font-bold">R</span>
          </div>
        </div>
      </div>
    </div>
  );
};