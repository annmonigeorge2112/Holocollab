import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  GestureType,
  HandLandmarksResult,
  HAND_CONNECTIONS,
  FINGERTIP_INDICES,
  LandmarkPoint,
} from '../services/GestureService';
import { Settings, Activity } from 'lucide-react';

interface HandOverlayProps {
  videoRef: React.RefObject<HTMLVideoElement>;
  allHands: HandLandmarksResult[];
  gesture: GestureType;
  fps: number;
  latencyMs: number;
  isEnabled: boolean;
  className?: string;
}

const GESTURE_COLORS: Record<GestureType, { main: string; glow: string }> = {
  none: { main: '#06b6d4', glow: 'rgba(6, 182, 212, 0.6)' },      // Cyan
  open: { main: '#06b6d4', glow: 'rgba(6, 182, 212, 0.6)' },      // Cyan
  point: { main: '#10b981', glow: 'rgba(16, 185, 129, 0.7)' },    // Green
  pinch: { main: '#ec4899', glow: 'rgba(236, 72, 153, 0.7)' },    // Magenta
  fist: { main: '#f97316', glow: 'rgba(249, 115, 22, 0.8)' },     // Orange
};

export const HandOverlay: React.FC<HandOverlayProps> = ({
  videoRef,
  allHands,
  gesture,
  fps,
  latencyMs,
  isEnabled,
  className = '',
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Settings
  const [showOverlay, setShowOverlay] = useState(true);
  const [showTrail, setShowTrail] = useState(true);
  const [mirrorVideo, setMirrorVideo] = useState(true);
  const [showSettings, setShowSettings] = useState(false);

  // Fingertip trail (last ~20 positions in canvas coordinates)
  const trailRef = useRef<{ x: number; y: number; time: number }[]>([]);

  /**
   * Unified coordinate mapping function:
   * Maps normalized landmark [0..1] to canvas displayed pixels,
   * accounting for video mirroring and object-fit: cover cropping.
   */
  const mapLandmarkToPixel = useCallback(
    (
      lm: LandmarkPoint,
      canvasWidth: number,
      canvasHeight: number,
      videoWidth: number,
      videoHeight: number,
      isMirrored: boolean
    ): { x: number; y: number } => {
      // Calculate aspect ratios for object-fit: cover
      const videoRatio = videoWidth / videoHeight;
      const canvasRatio = canvasWidth / canvasHeight;

      let renderWidth = canvasWidth;
      let renderHeight = canvasHeight;
      let offsetX = 0;
      let offsetY = 0;

      if (canvasRatio > videoRatio) {
        // Canvas is wider than video -> video scaled by width, top/bottom cropped
        renderWidth = canvasWidth;
        renderHeight = canvasWidth / videoRatio;
        offsetY = (canvasHeight - renderHeight) / 2;
      } else {
        // Canvas is taller than video -> video scaled by height, left/right cropped
        renderHeight = canvasHeight;
        renderWidth = canvasHeight * videoRatio;
        offsetX = (canvasWidth - renderWidth) / 2;
      }

      // Normalized coordinates
      const normX = isMirrored ? 1 - lm.x : lm.x;
      const normY = lm.y;

      const px = offsetX + normX * renderWidth;
      const py = offsetY + normY * renderHeight;

      return { x: px, y: py };
    },
    []
  );

  // Draw overlay whenever allHands or gesture changes
  useEffect(() => {
    if (!isEnabled || !showOverlay) {
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx?.clearRect(0, 0, canvas.width, canvas.height);
      }
      return;
    }

    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Size canvas for devicePixelRatio
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();

    if (canvas.width !== Math.round(rect.width * dpr) || canvas.height !== Math.round(rect.height * dpr)) {
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const videoWidth = video.videoWidth || 640;
    const videoHeight = video.videoHeight || 480;
    const colors = GESTURE_COLORS[gesture] || GESTURE_COLORS.none;

    const mappedHands: { x: number; y: number }[][] = [];

    // Draw hands
    allHands.forEach((hand) => {
      const pts = hand.landmarks.map((lm) =>
        mapLandmarkToPixel(lm, rect.width, rect.height, videoWidth, videoHeight, mirrorVideo)
      );
      mappedHands.push(pts);

      // 1. Draw glowing connector lines
      ctx.beginPath();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = colors.glow;
      ctx.shadowColor = colors.main;
      ctx.shadowBlur = 10;

      HAND_CONNECTIONS.forEach(([start, end]) => {
        const p1 = pts[start];
        const p2 = pts[end];
        if (p1 && p2) {
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
        }
      });
      ctx.stroke();

      // 2. Draw glowing dots on landmarks
      pts.forEach((pt, idx) => {
        const isFingertip = FINGERTIP_INDICES.includes(idx);
        const radius = isFingertip ? 4.5 : 2.5;

        ctx.beginPath();
        ctx.arc(pt.x, pt.y, radius, 0, 2 * Math.PI);
        ctx.fillStyle = isFingertip ? '#ffffff' : colors.main;
        ctx.shadowColor = colors.main;
        ctx.shadowBlur = isFingertip ? 12 : 6;
        ctx.fill();
      });

      // 3. Gesture label next to the wrist (landmark 0)
      if (pts[0] && gesture !== 'none') {
        const wrist = pts[0];
        ctx.shadowBlur = 0;
        ctx.font = 'bold 11px sans-serif';
        const label = gesture.toUpperCase();
        const textWidth = ctx.measureText(label).width;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
        ctx.beginPath();
        ctx.roundRect(wrist.x + 8, wrist.y - 14, textWidth + 12, 18, 4);
        ctx.fill();

        ctx.fillStyle = colors.main;
        ctx.fillText(label, wrist.x + 14, wrist.y);
      }

      // Record index fingertip for trailing path
      if (pts[8]) {
        trailRef.current.push({ x: pts[8].x, y: pts[8].y, time: performance.now() });
        if (trailRef.current.length > 20) {
          trailRef.current.shift();
        }
      }
    });

    // 4. Energy line between two index fingertips if two hands are detected
    if (mappedHands.length >= 2 && mappedHands[0][8] && mappedHands[1][8]) {
      const p1 = mappedHands[0][8];
      const p2 = mappedHands[1][8];

      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(236, 72, 153, 0.45)';
      ctx.shadowColor = '#ec4899';
      ctx.shadowBlur = 12;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 5. Draw fading trail behind index fingertip
    if (showTrail && trailRef.current.length > 1) {
      const trail = trailRef.current;
      for (let i = 1; i < trail.length; i++) {
        const prev = trail[i - 1];
        const curr = trail[i];
        const progress = i / trail.length; // 0 to 1

        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(curr.x, curr.y);
        ctx.lineWidth = progress * 4;
        ctx.strokeStyle = colors.glow;
        ctx.shadowColor = colors.main;
        ctx.shadowBlur = 8;
        ctx.stroke();
      }
    }

    ctx.restore();
  }, [allHands, gesture, isEnabled, showOverlay, showTrail, mirrorVideo, mapLandmarkToPixel, videoRef]);

  if (!isEnabled) return null;

  return (
    <div className={`relative pointer-events-none ${className}`}>
      {/* Hand Canvas Overlay */}
      <canvas
        ref={canvasRef}
        className="w-full h-full object-cover"
        style={{ transform: mirrorVideo ? 'none' : 'scaleX(-1)' }}
      />

      {/* Dev-only FPS and Latency corner badge */}
      <div className="absolute top-2 left-2 pointer-events-auto flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-black/60 backdrop-blur-md border border-purple-500/30 text-[10px] text-purple-200 shadow-md">
        <Activity className="w-3 h-3 text-emerald-400" />
        <span>{fps} fps</span>
        <span className="text-slate-500">|</span>
        <span>{latencyMs} ms</span>
      </div>

      {/* Settings popover trigger */}
      <div className="absolute top-2 right-2 pointer-events-auto">
        <button
          onClick={() => setShowSettings(!showSettings)}
          className="p-1 rounded-md bg-black/60 hover:bg-black/80 border border-purple-500/30 text-purple-300 hover:text-white transition"
          title="Gesture Settings"
        >
          <Settings className="w-3.5 h-3.5" />
        </button>

        {showSettings && (
          <div className="absolute top-7 right-0 w-44 p-2.5 rounded-xl bg-slate-900/95 border border-purple-500/30 shadow-xl backdrop-blur-md flex flex-col gap-2 text-xs text-purple-200 z-50">
            <span className="font-semibold text-purple-100 text-[11px] pb-1 border-b border-purple-500/20">
              Gesture Overlay
            </span>

            <label className="flex items-center justify-between cursor-pointer">
              <span>Show overlay</span>
              <input
                type="checkbox"
                checked={showOverlay}
                onChange={(e) => setShowOverlay(e.target.checked)}
                className="rounded accent-purple-600"
              />
            </label>

            <label className="flex items-center justify-between cursor-pointer">
              <span>Show trail</span>
              <input
                type="checkbox"
                checked={showTrail}
                onChange={(e) => setShowTrail(e.target.checked)}
                className="rounded accent-purple-600"
              />
            </label>

            <label className="flex items-center justify-between cursor-pointer">
              <span>Mirror video</span>
              <input
                type="checkbox"
                checked={mirrorVideo}
                onChange={(e) => setMirrorVideo(e.target.checked)}
                className="rounded accent-purple-600"
              />
            </label>
          </div>
        )}
      </div>
    </div>
  );
};
