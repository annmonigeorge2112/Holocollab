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
  none: { main: '#22d3ee', glow: 'rgba(34, 211, 238, 0.8)' },   // Cyan
  open: { main: '#60a5fa', glow: 'rgba(96, 165, 250, 0.85)' },  // Blue
  point: { main: '#34d399', glow: 'rgba(52, 211, 153, 0.85)' }, // Green
  pinch: { main: '#e879f9', glow: 'rgba(232, 121, 249, 0.9)' }, // Magenta
  fist: { main: '#fb923c', glow: 'rgba(251, 146, 60, 0.9)' },   // Orange
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
  const [overlayStyle, setOverlayStyle] = useState<'neon' | 'simple'>('neon');
  const [showSettings, setShowSettings] = useState(false);

  // Fingertip trail (last ~20 positions in canvas coordinates)
  const trailRef = useRef<{ x: number; y: number; time: number }[]>([]);

  // Automatically resize canvas when container or video resizes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleResize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        canvas.width = Math.round(rect.width * dpr);
        canvas.height = Math.round(rect.height * dpr);
      }
    };

    handleResize();
    const observer = new ResizeObserver(handleResize);
    observer.observe(canvas);
    if (videoRef.current) {
      observer.observe(videoRef.current);
      videoRef.current.addEventListener('loadedmetadata', handleResize);
    }

    return () => {
      observer.disconnect();
      if (videoRef.current) {
        videoRef.current.removeEventListener('loadedmetadata', handleResize);
      }
    };
  }, [videoRef]);

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
      const videoRatio = videoWidth / videoHeight;
      const canvasRatio = canvasWidth / canvasHeight;

      let renderWidth = canvasWidth;
      let renderHeight = canvasHeight;
      let offsetX = 0;
      let offsetY = 0;

      if (canvasRatio > videoRatio) {
        renderWidth = canvasWidth;
        renderHeight = canvasWidth / videoRatio;
        offsetY = (canvasHeight - renderHeight) / 2;
      } else {
        renderHeight = canvasHeight;
        renderWidth = canvasHeight * videoRatio;
        offsetX = (canvasWidth - renderWidth) / 2;
      }

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
    const isNeon = overlayStyle === 'neon';

    if (isNeon) {
      ctx.globalCompositeOperation = 'lighter';
    }

    const mappedHands: { x: number; y: number }[][] = [];

    // Draw hands
    allHands.forEach((hand) => {
      const pts = hand.landmarks.map((lm) =>
        mapLandmarkToPixel(lm, rect.width, rect.height, videoWidth, videoHeight, mirrorVideo)
      );
      mappedHands.push(pts);

      // 1. Draw glowing connector lines
      ctx.beginPath();
      ctx.lineWidth = isNeon ? 3 : 1.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = colors.glow;
      ctx.shadowColor = colors.main;
      ctx.shadowBlur = isNeon ? 22 : 0;

      HAND_CONNECTIONS.forEach(([start, end]) => {
        const p1 = pts[start];
        const p2 = pts[end];
        if (p1 && p2) {
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
        }
      });
      ctx.stroke();

      // 2. Draw glowing dots on landmarks with subtle finger hue offsets
      pts.forEach((pt, idx) => {
        const isFingertip = FINGERTIP_INDICES.includes(idx);
        const radius = isNeon ? (isFingertip ? 7 : 3.5) : (isFingertip ? 4 : 2);

        // Subtle finger hue offset: thumb=0, index=20, middle=40, ring=60, pinky=80
        const fingerGroup = Math.floor(Math.max(0, idx - 1) / 4);
        const hueShift = fingerGroup * 15;

        ctx.beginPath();
        ctx.arc(pt.x, pt.y, radius, 0, 2 * Math.PI);
        ctx.fillStyle = isFingertip ? '#ffffff' : `hsl(${((idx * 12 + hueShift) % 360)}, 90%, 65%)`;
        ctx.shadowColor = colors.main;
        ctx.shadowBlur = isNeon ? (isFingertip ? 26 : 14) : 0;
        ctx.fill();
      });

      // 3. Gesture label next to the wrist (landmark 0)
      if (pts[0] && gesture !== 'none') {
        const wrist = pts[0];
        ctx.save();
        ctx.globalCompositeOperation = 'source-over';
        ctx.shadowBlur = 0;
        ctx.font = 'bold 11px sans-serif';
        const label = gesture.toUpperCase();
        const textWidth = ctx.measureText(label).width;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
        ctx.beginPath();
        ctx.roundRect(wrist.x + 8, wrist.y - 14, textWidth + 12, 18, 4);
        ctx.fill();

        ctx.fillStyle = colors.main;
        ctx.fillText(label, wrist.x + 14, wrist.y);
        ctx.restore();
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
      ctx.lineWidth = isNeon ? 2 : 1;
      ctx.strokeStyle = 'rgba(232, 121, 249, 0.6)';
      ctx.shadowColor = '#e879f9';
      ctx.shadowBlur = isNeon ? 20 : 0;
      ctx.setLineDash([5, 5]);
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
        ctx.lineWidth = progress * (isNeon ? 5 : 2.5);
        ctx.strokeStyle = colors.glow;
        ctx.shadowColor = colors.main;
        ctx.shadowBlur = isNeon ? 18 : 0;
        ctx.stroke();
      }
    }

    ctx.restore();
  }, [allHands, gesture, isEnabled, showOverlay, showTrail, mirrorVideo, overlayStyle, mapLandmarkToPixel, videoRef]);

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

            <div className="flex items-center justify-between pt-1 border-t border-purple-500/20">
              <span>Style</span>
              <div className="flex rounded-lg overflow-hidden border border-purple-500/30 text-[10px]">
                <button
                  type="button"
                  onClick={() => setOverlayStyle('neon')}
                  className={`px-2 py-0.5 ${overlayStyle === 'neon' ? 'bg-purple-600 text-white font-bold' : 'bg-slate-800 text-purple-300'}`}
                >
                  Neon
                </button>
                <button
                  type="button"
                  onClick={() => setOverlayStyle('simple')}
                  className={`px-2 py-0.5 ${overlayStyle === 'simple' ? 'bg-purple-600 text-white font-bold' : 'bg-slate-800 text-purple-300'}`}
                >
                  Simple
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
