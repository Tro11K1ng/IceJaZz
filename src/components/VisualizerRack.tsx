import React, { useEffect, useRef, useState } from 'react';
import { audioEngine } from '../utils/audioEngine';

interface VisualizerRackProps {
  isPlaying: boolean;
  sampleRate?: number;
  bitDepth?: number;
  format?: string;
  compactFooter?: boolean;
}

type VisMode = 'spectrum' | 'oscilloscope' | 'meters' | 'off';

export const VisualizerRack: React.FC<VisualizerRackProps> = React.memo(
  ({
    isPlaying,
    sampleRate = 44100,
    bitDepth = 16,
    format = 'FLAC',
    compactFooter = false,
  }) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const dbReadoutRef = useRef<HTMLDivElement | null>(null);
    const [mode, setMode] = useState<VisMode>('spectrum');
    const peakHoldsRef = useRef<number[]>(new Array(40).fill(0));

    useEffect(() => {
      if (mode === 'off') return;

      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      let animId: number | null = null;
      const freqBuffer = new Uint8Array(512);
      const timeBuffer = new Uint8Array(512);
      let frameCount = 0;

      let accentColor = '#b49a1f';
      let textMainColor = '#f3f4f6';
      let bgBaseColor = '#000000';
      let textDimColor = '#6b7280';

      const syncThemeColors = () => {
        const rootStyle = getComputedStyle(document.documentElement);
        accentColor =
          rootStyle.getPropertyValue('--accent').trim() || '#b49a1f';
        textMainColor =
          rootStyle.getPropertyValue('--text-main').trim() || '#f3f4f6';
        bgBaseColor =
          rootStyle.getPropertyValue('--bg-base').trim() || '#000000';
        textDimColor =
          rootStyle.getPropertyValue('--text-dim').trim() || '#6b7280';
      };

      syncThemeColors();

      const drawFrame = () => {
        frameCount++;
        if (frameCount % 45 === 0) {
          syncThemeColors();
        }
        const width = canvas.width;
        const height = canvas.height;
        const analyser = audioEngine.getAnalyserNode();

        if (analyser && isPlaying) {
          analyser.getByteFrequencyData(freqBuffer);
          analyser.getByteTimeDomainData(timeBuffer);
        } else {
          freqBuffer.fill(0);
          timeBuffer.fill(128);
        }

        if (frameCount % 6 === 0 && dbReadoutRef.current) {
          if (isPlaying && analyser) {
            let maxDev = 0;
            for (let i = 0; i < 128; i++) {
              const norm = Math.abs((timeBuffer[i] - 128) / 128);
              if (norm > maxDev) maxDev = norm;
            }
            const db =
              maxDev > 0.001
                ? Math.max(-48, Math.min(0, 20 * Math.log10(maxDev * 1.15)))
                : -48;
            dbReadoutRef.current.textContent = `${db.toFixed(1)} dBFS`;
          } else {
            dbReadoutRef.current.textContent = '-INF dBFS';
          }
        }

        ctx.fillStyle = bgBaseColor;
        ctx.fillRect(0, 0, width, height);

        ctx.strokeStyle = '#222222';
        ctx.lineWidth = 1;
        for (let y = 1; y < 3; y++) {
          const py = Math.floor((height / 3) * y) + 0.5;
          ctx.beginPath();
          ctx.moveTo(0, py);
          ctx.lineTo(width, py);
          ctx.stroke();
        }

        if (mode === 'spectrum') {
          const numBars = 40;
          const gap = 2;
          const barWidth = (width - gap * (numBars - 1) - 12) / numBars;
          const peaks = peakHoldsRef.current;
          const bottomPad = compactFooter ? 4 : 13;

          for (let i = 0; i < numBars; i++) {
            const binIdx = Math.min(
              freqBuffer.length - 1,
              Math.floor(Math.pow(i / numBars, 1.75) * 220) + 1
            );
            const rawVal = freqBuffer[binIdx] / 255;
            const barHeight = Math.max(2, rawVal * (height - (bottomPad + 5)));

            if (barHeight >= peaks[i]) {
              peaks[i] = barHeight;
            } else {
              peaks[i] = Math.max(2, peaks[i] - 0.8);
            }

            const x = 6 + i * (barWidth + gap);
            const y = height - bottomPad - barHeight;

            ctx.fillStyle = accentColor;
            ctx.fillRect(x, y, barWidth, barHeight);

            const peakY = height - bottomPad - peaks[i] - 2;
            ctx.fillStyle = textMainColor;
            ctx.fillRect(x, Math.max(2, peakY), barWidth, 1.5);
          }

          if (!compactFooter) {
            ctx.fillStyle = textDimColor;
            ctx.font = '9px "JetBrains Mono", monospace';
            const labels = ['31', '125', '500', '2k', '8k', '16k'];
            labels.forEach((lbl, idx) => {
              const lx = 8 + idx * ((width - 28) / (labels.length - 1));
              ctx.fillText(lbl, lx, height - 2);
            });
          }
        } else if (mode === 'oscilloscope') {
          ctx.strokeStyle = '#333333';
          ctx.beginPath();
          ctx.moveTo(0, height / 2);
          ctx.lineTo(width, height / 2);
          ctx.stroke();

          ctx.strokeStyle = accentColor;
          ctx.lineWidth = 1.6;
          ctx.beginPath();

          let triggerOffset = 0;
          for (let i = 1; i < 128; i++) {
            if (timeBuffer[i - 1] < 128 && timeBuffer[i] >= 128) {
              triggerOffset = i;
              break;
            }
          }

          const samplesToDraw = 240;
          const sliceWidth = width / samplesToDraw;
          let x = 0;

          for (let i = 0; i < samplesToDraw; i++) {
            const sample = timeBuffer[triggerOffset + i] ?? 128;
            const v = (sample - 128) / 128;
            const y = height / 2 - v * (height * 0.4);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
            x += sliceWidth;
          }
          ctx.stroke();
        } else if (mode === 'meters') {
          let maxDev = 0;
          if (isPlaying && analyser) {
            for (let i = 0; i < 128; i++) {
              const norm = Math.abs((timeBuffer[i] - 128) / 128);
              if (norm > maxDev) maxDev = norm;
            }
          }
          const db =
            maxDev > 0.001
              ? Math.max(-48, Math.min(0, 20 * Math.log10(maxDev * 1.15)))
              : -48;
          const normLevel = Math.max(0, Math.min(1, (db + 48) / 48));

          const channels = compactFooter
            ? [
                { label: 'L', y: Math.floor(height * 0.22), ratio: normLevel },
                {
                  label: 'R',
                  y: Math.floor(height * 0.56),
                  ratio: normLevel * 0.96,
                },
              ]
            : [
                { label: 'L', y: 20, ratio: normLevel },
                { label: 'R', y: 48, ratio: normLevel * 0.96 },
              ];
          const totalSegments = 30;
          const meterLeft = 22;
          const meterWidth = width - meterLeft - 8;
          const segWidth =
            (meterWidth - (totalSegments - 1) * 2) / totalSegments;
          const segHeight = compactFooter ? 10 : 12;

          channels.forEach((ch) => {
            ctx.fillStyle = textDimColor;
            ctx.font = '10px "JetBrains Mono", monospace';
            ctx.fillText(ch.label, 6, ch.y + segHeight - 2);

            const activeSegs = isPlaying
              ? Math.round(ch.ratio * totalSegments)
              : 0;
            for (let s = 0; s < totalSegments; s++) {
              const sx = meterLeft + s * (segWidth + 2);
              const isLit = s < activeSegs;
              if (!isLit) {
                ctx.fillStyle = '#181818';
              } else if (s > totalSegments * 0.85) {
                ctx.fillStyle = textMainColor;
              } else {
                ctx.fillStyle = accentColor;
              }
              ctx.fillRect(sx, ch.y, segWidth, segHeight);
            }
          });
        }

        if (isPlaying) {
          animId = requestAnimationFrame(drawFrame);
        }
      };

      drawFrame();

      return () => {
        if (animId !== null) cancelAnimationFrame(animId);
      };
    }, [isPlaying, mode, compactFooter]);

    if (compactFooter) {
      return (
        <div
          className="relative w-full h-full flex items-center justify-center bg-[var(--bg-base)] select-none cursor-pointer overflow-hidden"
          onClick={() =>
            setMode((prev) =>
              prev === 'spectrum'
                ? 'oscilloscope'
                : prev === 'oscilloscope'
                ? 'meters'
                : prev === 'meters'
                ? 'off'
                : 'spectrum'
            )
          }
          title="Click to cycle visualizer mode (Spectrum / Wave / Peak / ASCII)"
        >
          {mode === 'off' ? (
            <div className="text-[var(--accent)] text-[10px] leading-none whitespace-pre font-extrabold">
              {"_ ▄ █ ▄ █ ▄ _\n█ █ █ █ █ █ █\n█ █ █ █ █ █ █"}
            </div>
          ) : (
            <>
              <canvas
                ref={canvasRef}
                width={296}
                height={62}
                className="w-full h-full block"
              />
              <div className="absolute top-1 left-2 text-[9px] font-mono font-bold text-[var(--text-dim)] uppercase pointer-events-none">
                {mode === 'spectrum'
                  ? 'SPEC'
                  : mode === 'oscilloscope'
                  ? 'WAVE'
                  : 'PEAK'}
              </div>
              <div
                ref={dbReadoutRef}
                className="absolute top-1 right-2 text-[9px] font-mono font-bold tabular-nums text-[var(--accent)] pointer-events-none"
              >
                -INF dBFS
              </div>
            </>
          )}
        </div>
      );
    }

    return (
      <div className="bg-[var(--bg-base)] border-b-[3px] border-[var(--text-main)] p-3 select-none shrink-0">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-0.5">
            {(
              [
                { id: 'spectrum', label: 'SPEC' },
                { id: 'oscilloscope', label: 'WAVE' },
                { id: 'meters', label: 'METERS' },
                { id: 'off', label: 'OFF' },
              ] as { id: VisMode; label: string }[]
            ).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setMode(m.id)}
                className={`btn-brutal transition-ui px-2 py-0.5 text-[11px] ${
                  mode === m.id ? 'primary' : ''
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          <div className="text-[11px] font-mono tabular-nums text-[var(--accent)] font-bold whitespace-nowrap shrink-0">
            {format} · {(sampleRate / 1000).toFixed(1)}k/{bitDepth}b
          </div>
        </div>

        {mode !== 'off' && (
          <div className="relative border-[3px] border-[var(--text-main)] overflow-hidden bg-[var(--bg-base)]">
            <canvas
              ref={canvasRef}
              width={290}
              height={84}
              className="w-full h-[84px] block cursor-pointer"
              onClick={() =>
                setMode((prev) =>
                  prev === 'spectrum'
                    ? 'oscilloscope'
                    : prev === 'oscilloscope'
                    ? 'meters'
                    : 'spectrum'
                )
              }
              title="Cycle visualizer mode"
            />
            <div
              ref={dbReadoutRef}
              className="absolute top-1.5 right-2 text-[10px] font-mono font-bold tabular-nums text-[var(--text-dim)] pointer-events-none"
            >
              -INF dBFS
            </div>
          </div>
        )}
      </div>
    );
  }
);
