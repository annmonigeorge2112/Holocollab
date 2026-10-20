import { useEffect, useRef, useState, useCallback } from 'react';
import {
  gestureService,
  GestureType,
  HandLandmarksResult,
  GestureDetectionResult,
} from '../services/GestureService';
import { socketManager } from '../services/SocketManager';
import { ARSceneHandle } from '../components/ARScene';

export interface UseGestureSessionOptions {
  sessionId?: string;
  videoRef: React.RefObject<HTMLVideoElement>;
  arSceneRef?: React.RefObject<ARSceneHandle | null>;
  isApproved?: boolean; // Control and safety: host approval
  enabled?: boolean;
}

export interface UseGestureSessionReturn {
  currentGesture: GestureType;
  controllingHand: HandLandmarksResult | null;
  allHands: HandLandmarksResult[];
  fps: number;
  latencyMs: number;
  isEnabled: boolean;
  setIsEnabled: (enabled: boolean) => void;
  isApproved: boolean;
  isCalibrating: boolean;
  setIsCalibrating: (calibrating: boolean) => void;
  logCalibrationSample: (expected: GestureType) => void;
}

export const useGestureSession = ({
  sessionId,
  videoRef,
  arSceneRef,
  isApproved = true,
  enabled = true,
}: UseGestureSessionOptions): UseGestureSessionReturn => {
  const [isEnabled, setIsEnabled] = useState(enabled);
  const [currentGesture, setCurrentGesture] = useState<GestureType>('none');
  const [controllingHand, setControllingHand] = useState<HandLandmarksResult | null>(null);
  const [allHands, setAllHands] = useState<HandLandmarksResult[]>([]);
  const [fps, setFps] = useState(0);
  const [latencyMs, setLatencyMs] = useState(0);
  const [isCalibrating, setIsCalibrating] = useState(false);

  // Benchmarking and rolling FPS tracking
  const frameTimesRef = useRef<number[]>([]);
  const lastDetectionTimeRef = useRef<number>(0);
  const animFrameIdRef = useRef<number | null>(null);

  // Pinch baseline tracking
  const lastPinchDistRef = useRef<number | null>(null);
  const lastEmittedGestureRef = useRef<GestureType>('none');

  // Calibration logger function
  const logCalibrationSample = useCallback(
    (expected: GestureType) => {
      try {
        const stored = localStorage.getItem('gesture_calibration_log');
        const list = stored ? JSON.parse(stored) : [];
        list.push({
          timestamp: new Date().toISOString(),
          predicted: currentGesture,
          expected,
          landmarks: controllingHand?.landmarks ?? [],
        });
        localStorage.setItem('gesture_calibration_log', JSON.stringify(list));
      } catch (e) {
        console.warn('Failed saving calibration sample:', e);
      }
    },
    [currentGesture, controllingHand]
  );

  useEffect(() => {
    if (isEnabled && isApproved) {
      gestureService.initialize();
    }
  }, [isEnabled, isApproved]);

  // Detection loop capped at 30 fps (~33.3 ms interval)
  useEffect(() => {
    if (!isEnabled || !isApproved) {
      setCurrentGesture('none');
      setControllingHand(null);
      setAllHands([]);
      gestureService.resetTracking();
      return;
    }

    let running = true;
    const TARGET_INTERVAL_MS = 1000 / 30; // 30 fps cap

    const processFrame = () => {
      if (!running) return;

      const video = videoRef.current;
      const now = performance.now();

      if (
        video &&
        video.readyState >= 2 &&
        !video.paused &&
        !video.ended &&
        now - lastDetectionTimeRef.current >= TARGET_INTERVAL_MS
      ) {
        lastDetectionTimeRef.current = now;

        const startInference = performance.now();
        const res: GestureDetectionResult = gestureService.detectForVideo(video, now);
        const inferenceTime = performance.now() - startInference;

        setLatencyMs(Math.round(inferenceTime));

        // Rolling 1000ms FPS counter
        frameTimesRef.current.push(now);
        frameTimesRef.current = frameTimesRef.current.filter((t) => now - t <= 1000);
        setFps(frameTimesRef.current.length);

        setCurrentGesture(res.gesture);
        setControllingHand(res.controllingHand);
        setAllHands(res.allHands);

        // Handle AR mapping if AR scene ref is provided
        if (arSceneRef?.current && res.controllingHand) {
          const lm = res.controllingHand.landmarks;
          const currentTransform = arSceneRef.current.getTransform();

          if (res.gesture === 'fist') {
            // Fist: reset model
            arSceneRef.current.reset();
            lastPinchDistRef.current = null;
          } else if (res.gesture === 'point') {
            // Point: translate by fingertip movement (index tip: 8)
            const indexTip = lm[8];
            const { dx, dy } = gestureService.getSmoothedDeltas(
              { x: indexTip.x, y: indexTip.y },
              'point'
            );
            if (dx !== 0 || dy !== 0) {
              const [px, py, pz] = currentTransform.position;
              // Mirror delta horizontally for natural feel
              arSceneRef.current.setTransform({
                position: [px - dx * 2.5, py - dy * 2.5, pz],
              });
            }
            lastPinchDistRef.current = null;
          } else if (res.gesture === 'open') {
            // Open: rotate by palm movement (wrist: 0 / MCP 9 center)
            const palmCenter = { x: (lm[0].x + lm[9].x) / 2, y: (lm[0].y + lm[9].y) / 2 };
            const { dx, dy } = gestureService.getSmoothedDeltas(palmCenter, 'open');
            if (dx !== 0 || dy !== 0) {
              const [rx, ry, rz] = currentTransform.rotation;
              arSceneRef.current.setTransform({
                rotation: [rx + dy * 3.0, ry - dx * 3.0, rz],
              });
            }
            lastPinchDistRef.current = null;
          } else if (res.gesture === 'pinch') {
            // Pinch: zoom in/out (scale)
            if (lastPinchDistRef.current !== null) {
              const deltaPinch = res.pinchDistance - lastPinchDistRef.current;
              if (Math.abs(deltaPinch) > 0.01) {
                const nextScale = Math.min(Math.max(currentTransform.scale * (1 + deltaPinch * 1.5), 0.2), 5.0);
                arSceneRef.current.setTransform({ scale: nextScale });
              }
            }
            lastPinchDistRef.current = res.pinchDistance;
          } else {
            lastPinchDistRef.current = null;
          }
        }

        // Emit gesture_event if gesture changed
        if (
          sessionId &&
          res.gesture !== 'none' &&
          res.gesture !== lastEmittedGestureRef.current
        ) {
          lastEmittedGestureRef.current = res.gesture;
          socketManager.emit('gesture_event', {
            sessionId,
            type: res.gesture,
            data: { confidence: res.confidence },
          });
        }
      }

      animFrameIdRef.current = requestAnimationFrame(processFrame);
    };

    animFrameIdRef.current = requestAnimationFrame(processFrame);

    return () => {
      running = false;
      if (animFrameIdRef.current) {
        cancelAnimationFrame(animFrameIdRef.current);
      }
    };
  }, [isEnabled, isApproved, videoRef, arSceneRef, sessionId]);

  return {
    currentGesture,
    controllingHand,
    allHands,
    fps,
    latencyMs,
    isEnabled,
    setIsEnabled,
    isApproved,
    isCalibrating,
    setIsCalibrating,
    logCalibrationSample,
  };
};
