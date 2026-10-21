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
  stream?: MediaStream | null;
  arSceneRef?: React.RefObject<ARSceneHandle | null>;
  isApproved?: boolean; // Control and safety: host approval
  enabled?: boolean;
}

export type HandTrackingStatus = 'off' | 'loading' | 'ready' | 'running' | 'failed';

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
  status: HandTrackingStatus;
  error: string | null;
  delegate: 'GPU' | 'CPU';
  hands: number;
}

export const useGestureSession = ({
  sessionId,
  videoRef,
  stream,
  arSceneRef,
  isApproved = true,
  enabled = true,
}: UseGestureSessionOptions): UseGestureSessionReturn => {
  const [isEnabled, setIsEnabled] = useState(enabled);
  const [status, setStatus] = useState<HandTrackingStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [currentGesture, setCurrentGesture] = useState<GestureType>('none');
  const [controllingHand, setControllingHand] = useState<HandLandmarksResult | null>(null);
  const [allHands, setAllHands] = useState<HandLandmarksResult[]>([]);
  const [fps, setFps] = useState(0);
  const [latencyMs, setLatencyMs] = useState(0);
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [delegate, setDelegate] = useState<'GPU' | 'CPU'>('GPU');

  // Benchmarking and rolling FPS tracking
  const frameTimesRef = useRef<number[]>([]);
  const lastDetectionTimeRef = useRef<number>(0);
  const animFrameIdRef = useRef<number | null>(null);

  // Pinch baseline tracking
  const pinchStartDistRef = useRef<number | null>(null);
  const pinchStartScaleRef = useRef<number>(1);
  const twoHandStartDistRef = useRef<number | null>(null);
  const twoHandStartScaleRef = useRef<number>(1);
  const smoothedScaleRef = useRef<number>(1);
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
    if (!isEnabled || !isApproved) {
      setStatus('off');
      return;
    }

    setStatus('loading');
    setError(null);

    gestureService
      .initialize()
      .then((landmarker) => {
        if (landmarker) {
          setStatus('ready');
          setDelegate(gestureService.getDelegate());
        } else {
          setStatus('failed');
          setError('Hand tracking failed to load: initialization failed');
        }
      })
      .catch((err: any) => {
        setStatus('failed');
        setError(`Hand tracking failed to load: ${err?.message || 'network/WASM error'}`);
        console.error('Hand tracking init error:', err);
      });
  }, [isEnabled, isApproved, stream, videoRef]);

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

    // If landmarker is not available yet, ensure re-init
    gestureService.initialize().catch(() => {});

    const processFrame = () => {
      if (!running) return;

      const video = videoRef.current;
      const now = performance.now();

      // Ensure video is ready: readyState >= 2 (HAVE_CURRENT_DATA) and videoWidth > 0
      if (
        video &&
        video.readyState >= 2 &&
        video.videoWidth > 0 &&
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

        setStatus('running');
        setDelegate(gestureService.getDelegate());
        setCurrentGesture(res.gesture);
        setControllingHand(res.controllingHand);
        setAllHands(res.allHands);

        // Handle AR mapping if AR scene ref is provided
        if (arSceneRef?.current) {
          const currentTransform = arSceneRef.current.getTransform();

          // Check Two-Hand Zoom: if two hands are detected, scale by distance change between the two index fingertips (landmark 8)
          if (res.allHands.length >= 2 && res.allHands[0].landmarks[8] && res.allHands[1].landmarks[8]) {
            const tip1 = res.allHands[0].landmarks[8];
            const tip2 = res.allHands[1].landmarks[8];
            const currentTwoHandDist = Math.hypot(tip1.x - tip2.x, tip1.y - tip2.y);

            if (twoHandStartDistRef.current === null) {
              twoHandStartDistRef.current = currentTwoHandDist;
              twoHandStartScaleRef.current = currentTransform.scale;
              smoothedScaleRef.current = currentTransform.scale;
            } else if (twoHandStartDistRef.current > 0.02) {
              const targetScale = twoHandStartScaleRef.current * (currentTwoHandDist / twoHandStartDistRef.current);
              const clamped = Math.min(Math.max(targetScale, 0.2), 4.0);
              smoothedScaleRef.current += (clamped - smoothedScaleRef.current) * 0.25;
              arSceneRef.current.setTransform({ scale: smoothedScaleRef.current });
            }
          } else {
            twoHandStartDistRef.current = null;

            if (res.controllingHand) {
              const lm = res.controllingHand.landmarks;

              if (res.gesture === 'fist') {
                // Fist: reset model
                arSceneRef.current.reset();
                pinchStartDistRef.current = null;
                smoothedScaleRef.current = 1;
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
                pinchStartDistRef.current = null;
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
                pinchStartDistRef.current = null;
              } else if (res.gesture === 'pinch') {
                // Pinch: relative zoom start (scale = startScale * (currentDistance / startDistance))
                // Clamped to [0.2, 4.0], smoothed
                if (pinchStartDistRef.current === null) {
                  pinchStartDistRef.current = Math.max(res.pinchDistance, 0.05);
                  pinchStartScaleRef.current = currentTransform.scale;
                  smoothedScaleRef.current = currentTransform.scale;
                } else {
                  const targetScale = pinchStartScaleRef.current * (res.pinchDistance / pinchStartDistRef.current);
                  const clamped = Math.min(Math.max(targetScale, 0.2), 4.0);
                  smoothedScaleRef.current += (clamped - smoothedScaleRef.current) * 0.25;
                  arSceneRef.current.setTransform({ scale: smoothedScaleRef.current });
                }
              } else {
                pinchStartDistRef.current = null;
              }
            } else {
              pinchStartDistRef.current = null;
            }
          }
        }

        // Emit gesture_event if gesture changed and socket connected
        if (
          sessionId &&
          socketManager.isConnected() &&
          res.gesture !== 'none' &&
          res.gesture !== lastEmittedGestureRef.current
        ) {
          lastEmittedGestureRef.current = res.gesture;
          try {
            socketManager.emit('gesture_event', {
              sessionId,
              type: res.gesture,
              data: { confidence: res.confidence },
            });
          } catch {
            // Silently skip if socket is unavailable
          }
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
  }, [isEnabled, isApproved, videoRef, stream, arSceneRef, sessionId]);

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
    status,
    error,
    delegate,
    hands: allHands.length,
  };
};
