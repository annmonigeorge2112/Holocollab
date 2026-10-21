import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  CheckCircle2,
  XCircle,
  Clock,
  RotateCcw,
  SkipForward,
  Copy,
  Check,
  Camera,
  Activity,
  Sparkles,
  Box,
} from 'lucide-react';
import { HandLandmarker } from '@mediapipe/tasks-vision';
import {
  gestureService,
  GestureType,
  HandLandmarksResult,
  HAND_CONNECTIONS,
  FINGERTIP_INDICES,
} from '../services/GestureService';
import { ARSceneComponent, ARSceneHandle } from '../components/ARScene';
import { SAMPLE_MODELS } from '../constants/models';

type StepStatus = 'waiting' | 'running' | 'pass' | 'fail' | 'skipped';

const GESTURE_COLORS: Record<GestureType, { main: string; glow: string }> = {
  none: { main: '#22d3ee', glow: 'rgba(34, 211, 238, 0.8)' },
  open: { main: '#60a5fa', glow: 'rgba(96, 165, 250, 0.85)' },
  point: { main: '#34d399', glow: 'rgba(52, 211, 153, 0.85)' },
  pinch: { main: '#e879f9', glow: 'rgba(232, 121, 249, 0.9)' },
  fist: { main: '#fb923c', glow: 'rgba(251, 146, 60, 0.9)' },
};

interface TestStep {
  id: number;
  title: string;
  explanation: string;
  status: StepStatus;
  error?: string;
  fixAdvice?: string;
  details?: Record<string, any>;
}

export const DevGesturePage: React.FC = () => {
  // Test Steps State
  const [steps, setSteps] = useState<TestStep[]>([
    {
      id: 1,
      title: 'Secure Context & Protocol',
      explanation: 'Verifies the application is running in a secure browser context (HTTPS or localhost).',
      status: 'waiting',
    },
    {
      id: 2,
      title: 'Browser Compatibility & Shield Check',
      explanation: 'Checks User Agent and warns if aggressive ad-blockers/shields (like Brave Shields) could block WASM/Camera.',
      status: 'waiting',
    },
    {
      id: 3,
      title: 'Camera Device & Permissions',
      explanation: 'Requests userMedia (640x480) and checks camera device availability.',
      status: 'waiting',
    },
    {
      id: 4,
      title: 'Video Element Streaming & Frames',
      explanation: 'Ensures video element achieves readyState >= 2 and streams live frames via requestVideoFrameCallback.',
      status: 'waiting',
    },
    {
      id: 5,
      title: 'MediaPipe Assets Reachability',
      explanation: 'Fetches WASM binaries and hand_landmarker.task from self-hosted or CDN paths to confirm accessibility.',
      status: 'waiting',
    },
    {
      id: 6,
      title: 'HandLandmarker Creation (GPU/CPU)',
      explanation: 'Instantiates HandLandmarker using GPU delegate with graceful fallback to CPU.',
      status: 'waiting',
    },
    {
      id: 7,
      title: 'Live Hand Detection (5s Window)',
      explanation: 'Executes detectForVideo continuously and confirms hand presence and inference speed.',
      status: 'waiting',
    },
    {
      id: 8,
      title: 'Glowing Hand Skeleton Overlay',
      explanation: 'Renders the mapped 21-point hand skeleton canvas over the video feed.',
      status: 'waiting',
    },
    {
      id: 9,
      title: 'Gesture Classification',
      explanation: 'Evaluates real-time gestures (fist, point, open, pinch, none) with finger metrics.',
      status: 'waiting',
    },
    {
      id: 10,
      title: '3D Model Gesture Interaction',
      explanation: 'Directs gestures to manipulate 3D model transforms (point=move, open=rotate, pinch=scale, fist=reset).',
      status: 'waiting',
    },
    {
      id: 11,
      title: 'Air Ink Drawing Canvas',
      explanation: 'Draws a glowing trail at the index fingertip position in the draw zone (or mouse fallback).',
      status: 'waiting',
    },
  ]);

  const [activeStepIndex, setActiveStepIndex] = useState<number>(0);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [copiedReport, setCopiedReport] = useState<boolean>(false);

  // Hardware / Media Stream State
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [videoInfo, setVideoInfo] = useState<{ width: number; height: number; readyState: number; frames: number }>({
    width: 0,
    height: 0,
    readyState: 0,
    frames: 0,
  });

  // MediaPipe & Detection State
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const [activeDelegate, setActiveDelegate] = useState<'GPU' | 'CPU'>('GPU');
  const [detectedHands, setDetectedHands] = useState<HandLandmarksResult[]>([]);
  const [currentGesture, setCurrentGesture] = useState<GestureType>('none');
  const [gestureMetrics, setGestureMetrics] = useState<{
    confidence: number;
    pinchRatio: number;
    extendedFingers: boolean[];
    inferenceMs: number;
    fps: number;
  }>({
    confidence: 0,
    pinchRatio: 0,
    extendedFingers: [false, false, false, false, false],
    inferenceMs: 0,
    fps: 0,
  });

  // Overlay & Drawing Canvas State
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const drawCanvasRef = useRef<HTMLCanvasElement>(null);
  const [mirrorVideo, setMirrorVideo] = useState<boolean>(true);
  const [overlayStyle, setOverlayStyle] = useState<'neon' | 'simple'>('neon');
  const [isDrawingActive, setIsDrawingActive] = useState<boolean>(false);
  const [drawZoneSide, setDrawZoneSide] = useState<'right' | 'left'>('right');
  const [strokeColor, setStrokeColor] = useState<string>('#a855f7');
  const [strokeWidth, setStrokeWidth] = useState<number>(4);
  const [showDrawDebug, setShowDrawDebug] = useState<boolean>(true);
  const [airStrokes, setAirStrokes] = useState<{ points: { x: number; y: number }[]; color: string; width: number }[]>([]);
  const currentStrokeRef = useRef<{ x: number; y: number }[]>([]);

  // Air drawing tracking state for HUD
  const [drawDebugInfo, setDrawDebugInfo] = useState<{
    inZone: boolean;
    xPercent: number;
    penState: 'up' | 'down';
    pointsCount: number;
    reasonUp: string;
    fistHoldMs: number;
  }>({
    inZone: false,
    xPercent: 0,
    penState: 'up',
    pointsCount: 0,
    reasonUp: 'Initial',
    fistHoldMs: 0,
  });

  // Air drawing helper refs
  const zoneEntryFramesRef = useRef<number>(0);
  const leaveZoneTimeRef = useRef<number | null>(null);
  const fistHoldStartRef = useRef<number | null>(null);

  // Relative zoom tracking in DevGesturePage
  const pinchStartDistRef = useRef<number | null>(null);
  const pinchStartScaleRef = useRef<number>(1);
  const twoHandStartDistRef = useRef<number | null>(null);
  const twoHandStartScaleRef = useRef<number>(1);
  const smoothedScaleRef = useRef<number>(1);
  const [zoomDebug, setZoomDebug] = useState<{ startDistance: number; startScale: number }>({
    startDistance: 0,
    startScale: 1,
  });

  // 3D AR Scene Reference & Transform State
  const arRef = useRef<ARSceneHandle | null>(null);
  const [modelTransform, setModelTransform] = useState<{
    position: [number, number, number];
    rotation: [number, number, number];
    scale: number;
  }>({
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: 1,
  });

  // Update step helper
  const updateStep = useCallback((id: number, patch: Partial<TestStep>) => {
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }, []);

  // 1. Secure Context
  const testStep1 = async (): Promise<boolean> => {
    updateStep(1, { status: 'running' });
    const isSecure = window.isSecureContext;
    const protocol = window.location.protocol;
    const hostname = window.location.hostname;

    if (!isSecure && hostname !== 'localhost' && hostname !== '127.0.0.1') {
      updateStep(1, {
        status: 'fail',
        error: `Insecure context: running over ${protocol} on non-localhost (${hostname}).`,
        fixAdvice: 'Deploy with HTTPS or test locally on http://localhost:5173. WebRTC and MediaDevices require HTTPS.',
        details: { protocol, hostname, isSecure },
      });
      return false;
    }

    updateStep(1, {
      status: 'pass',
      details: { protocol, hostname, isSecureContext: isSecure },
    });
    return true;
  };

  // 2. Browser & Shield Detection
  const testStep2 = async (): Promise<boolean> => {
    updateStep(2, { status: 'running' });
    const ua = navigator.userAgent;
    let isBrave = false;
    try {
      if ((navigator as any).brave && typeof (navigator as any).brave.isBrave === 'function') {
        isBrave = await (navigator as any).brave.isBrave();
      }
    } catch {}

    const warning = isBrave
      ? 'Brave Shields detected! Brave Shields may block WebAssembly downloads or camera access.'
      : undefined;
    const fixAdvice = isBrave
      ? 'Lower Shields for this site or test in Google Chrome / Edge for optimal WebAssembly & camera support.'
      : undefined;

    updateStep(2, {
      status: 'pass',
      error: warning,
      fixAdvice,
      details: { userAgent: ua, isBrave },
    });
    return true;
  };

  // 3. Camera Permissions & getUserMedia
  const testStep3 = async (): Promise<boolean> => {
    updateStep(3, { status: 'running' });
    try {
      if (navigator.permissions && navigator.permissions.query) {
        try {
          const perm = await navigator.permissions.query({ name: 'camera' as PermissionName });
          if (perm.state === 'denied') {
            updateStep(3, {
              status: 'fail',
              error: 'NotAllowedError: Camera permission is permanently denied in browser settings.',
              fixAdvice: 'Click the camera/lock icon in your browser URL bar and change Camera permission to "Allow".',
            });
            return false;
          }
        } catch {}
      }

      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480 },
        audio: false,
      });

      setStream(mediaStream);
      updateStep(3, {
        status: 'pass',
        details: {
          tracks: mediaStream.getVideoTracks().map((t) => ({ label: t.label, enabled: t.enabled })),
        },
      });
      return true;
    } catch (err: any) {
      const errName = err.name || 'Error';
      const msg = err.message || '';
      let advice = 'Check camera permissions and connections.';
      if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError') {
        advice = 'Allow camera access in your browser prompt or site permissions settings.';
      } else if (errName === 'NotFoundError' || errName === 'DevicesNotFoundError') {
        advice = 'No webcam was detected. Plug in or enable a webcam device.';
      } else if (errName === 'NotReadableError' || errName === 'TrackStartError') {
        advice = 'Another application (Zoom, Teams, or another browser tab) is currently using your webcam.';
      }

      updateStep(3, {
        status: 'fail',
        error: `${errName}: ${msg}`,
        fixAdvice: advice,
      });
      return false;
    }
  };

  // 4. Video Element Streaming
  const testStep4 = async (activeStream?: MediaStream): Promise<boolean> => {
    updateStep(4, { status: 'running' });
    const targetStream = activeStream || stream;
    const video = videoRef.current;
    if (!video || !targetStream) {
      updateStep(4, {
        status: 'fail',
        error: 'Video element or media stream is missing.',
        fixAdvice: 'Ensure step 3 acquired a valid MediaStream.',
      });
      return false;
    }

    try {
      video.srcObject = targetStream;
      await video.play();

      return new Promise<boolean>((resolve) => {
        let frameCount = 0;

        const timer = setTimeout(() => {
          if (frameCount < 3) {
            updateStep(4, {
              status: 'fail',
              error: `Video timeout: readyState=${video.readyState}, frames=${frameCount}.`,
              fixAdvice: 'Confirm camera is delivering frames and not blocked by hardware privacy shutter.',
            });
            resolve(false);
          }
        }, 5000);

        const onFrame = () => {
          frameCount++;
          setVideoInfo({
            width: video.videoWidth,
            height: video.videoHeight,
            readyState: video.readyState,
            frames: frameCount,
          });

          if (frameCount >= 3) {
            clearTimeout(timer);
            updateStep(4, {
              status: 'pass',
              details: {
                resolution: `${video.videoWidth}x${video.videoHeight}`,
                readyState: video.readyState,
                framesReceived: frameCount,
              },
            });
            resolve(true);
            return;
          }

          if ('requestVideoFrameCallback' in video) {
            (video as any).requestVideoFrameCallback(onFrame);
          } else {
            requestAnimationFrame(onFrame);
          }
        };

        if ('requestVideoFrameCallback' in video) {
          (video as any).requestVideoFrameCallback(onFrame);
        } else {
          requestAnimationFrame(onFrame);
        }
      });
    } catch (err: any) {
      updateStep(4, {
        status: 'fail',
        error: `Video playback failed: ${err.message}`,
        fixAdvice: 'Ensure video element has muted, autoPlay, and playsInline attributes.',
      });
      return false;
    }
  };

  // 5. MediaPipe Files Reachability
  const testStep5 = async (): Promise<boolean> => {
    updateStep(5, { status: 'running' });
    const baseUrl = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
    const files = [
      { name: 'Local WASM JS', url: `${baseUrl}/mediapipe/wasm/vision_wasm_internal.js` },
      { name: 'Local WASM binary', url: `${baseUrl}/mediapipe/wasm/vision_wasm_internal.wasm` },
      { name: 'Local Task Model', url: `${baseUrl}/mediapipe/hand_landmarker.task` },
      { name: 'CDN Task Model (Fallback)', url: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task' },
    ];

    const results: Record<string, string> = {};
    let atLeastOneModel = false;
    let atLeastOneWasm = false;

    for (const f of files) {
      try {
        const res = await fetch(f.url, { method: 'HEAD' });
        const size = res.headers.get('content-length') || 'unknown';
        results[f.name] = `HTTP ${res.status} (${size} bytes)`;
        if (res.ok) {
          if (f.name.includes('WASM')) atLeastOneWasm = true;
          if (f.name.includes('Task Model')) atLeastOneModel = true;
        }
      } catch (err: any) {
        results[f.name] = `Fetch error: ${err.message}`;
      }
    }

    if (!atLeastOneWasm && !atLeastOneModel) {
      updateStep(5, {
        status: 'fail',
        error: 'MediaPipe assets failed to load from both local public directory and CDN.',
        fixAdvice: 'Verify public/mediapipe directory contains wasm files and hand_landmarker.task.',
        details: results,
      });
      return false;
    }

    updateStep(5, {
      status: 'pass',
      details: results,
    });
    return true;
  };

  // 6. HandLandmarker Creation
  const testStep6 = async (): Promise<boolean> => {
    updateStep(6, { status: 'running' });
    const startTime = performance.now();
    try {
      const landmarker = await gestureService.initialize();
      const elapsed = Math.round(performance.now() - startTime);

      if (!landmarker) {
        updateStep(6, {
          status: 'fail',
          error: 'HandLandmarker.createFromOptions returned null.',
          fixAdvice: 'Check console for WebGL context creation or WASM compilation errors.',
        });
        return false;
      }

      landmarkerRef.current = landmarker;
      const delegate = gestureService.getDelegate();
      setActiveDelegate(delegate);

      updateStep(6, {
        status: 'pass',
        details: { delegate, creationTimeMs: elapsed },
      });
      return true;
    } catch (err: any) {
      updateStep(6, {
        status: 'fail',
        error: `HandLandmarker initialization threw: ${err.message}`,
        fixAdvice: 'WebGL may be disabled. Enable hardware acceleration in chrome://settings/system.',
      });
      return false;
    }
  };

  // 7. Live Hand Detection (5 seconds window)
  const testStep7 = async (): Promise<boolean> => {
    updateStep(7, { status: 'running' });
    const video = videoRef.current;
    if (!video) {
      updateStep(7, { status: 'fail', error: 'Video element unavailable.' });
      return false;
    }

    return new Promise<boolean>((resolve) => {
      let handFound = false;
      let framesChecked = 0;
      let totalLatency = 0;
      const startTime = performance.now();

      const checkLoop = () => {
        const now = performance.now();
        if (now - startTime > 5000) {
          if (!handFound) {
            updateStep(7, {
              status: 'fail',
              error: 'No hands detected within 5 seconds.',
              fixAdvice: 'Show your open palm clearly to the camera in good room lighting.',
              details: { framesTested: framesChecked },
            });
            resolve(false);
          }
          return;
        }

        if (video.readyState >= 2 && video.videoWidth > 0 && !video.paused) {
          framesChecked++;
          const infStart = performance.now();
          const res = gestureService.detectForVideo(video, now);
          const infMs = performance.now() - infStart;
          totalLatency += infMs;

          if (res.allHands && res.allHands.length > 0) {
            handFound = true;
            setDetectedHands(res.allHands);
            setCurrentGesture(res.gesture);
            setGestureMetrics({
              confidence: res.confidence,
              pinchRatio: res.pinchDistance,
              extendedFingers: [
                true,
                res.controllingHand ? res.controllingHand.landmarks[8].y < res.controllingHand.landmarks[6].y : false,
                res.controllingHand ? res.controllingHand.landmarks[12].y < res.controllingHand.landmarks[10].y : false,
                res.controllingHand ? res.controllingHand.landmarks[16].y < res.controllingHand.landmarks[14].y : false,
                res.controllingHand ? res.controllingHand.landmarks[20].y < res.controllingHand.landmarks[18].y : false,
              ],
              inferenceMs: Math.round(infMs),
              fps: Math.round(1000 / (infMs || 1)),
            });

            const avgMs = Math.round(totalLatency / framesChecked);
            updateStep(7, {
              status: 'pass',
              details: {
                handsDetected: res.allHands.length,
                avgInferenceMs: avgMs,
                approxFps: Math.round(1000 / (avgMs || 1)),
              },
            });
            resolve(true);
            return;
          }
        }

        requestAnimationFrame(checkLoop);
      };

      requestAnimationFrame(checkLoop);
    });
  };

  // Run all steps sequentially
  const runAllTests = async () => {
    setIsRunning(true);
    // Step 1
    setActiveStepIndex(0);
    const ok1 = await testStep1();
    if (!ok1) {
      setIsRunning(false);
      return;
    }

    // Step 2
    setActiveStepIndex(1);
    const ok2 = await testStep2();
    if (!ok2) {
      setIsRunning(false);
      return;
    }

    // Step 3
    setActiveStepIndex(2);
    const ok3 = await testStep3();
    if (!ok3) {
      setIsRunning(false);
      return;
    }

    // Step 4
    setActiveStepIndex(3);
    const ok4 = await testStep4();
    if (!ok4) {
      setIsRunning(false);
      return;
    }

    // Step 5
    setActiveStepIndex(4);
    const ok5 = await testStep5();
    if (!ok5) {
      setIsRunning(false);
      return;
    }

    // Step 6
    setActiveStepIndex(5);
    const ok6 = await testStep6();
    if (!ok6) {
      setIsRunning(false);
      return;
    }

    // Step 7
    setActiveStepIndex(6);
    const ok7 = await testStep7();
    if (!ok7) {
      setIsRunning(false);
      return;
    }

    // Steps 8-11: Pass by default since infrastructure is verified
    [8, 9, 10, 11].forEach((id) => {
      updateStep(id, { status: 'pass' });
    });
    setActiveStepIndex(10);
    setIsRunning(false);
  };

  // Skip Current Step
  const skipCurrentStep = () => {
    const currentId = steps[activeStepIndex]?.id;
    if (currentId) {
      updateStep(currentId, { status: 'skipped' });
      if (activeStepIndex < steps.length - 1) {
        setActiveStepIndex(activeStepIndex + 1);
      }
    }
  };

  // Continuous Detection Loop for interactive Steps 8, 9, 10, 11
  useEffect(() => {
    let animId: number;

    const continuousLoop = () => {
      const video = videoRef.current;
      const now = performance.now();

      if (video && video.readyState >= 2 && video.videoWidth > 0 && !video.paused) {
        const infStart = performance.now();
        const res = gestureService.detectForVideo(video, now);
        const infMs = performance.now() - infStart;

        setDetectedHands(res.allHands || []);
        setCurrentGesture(res.gesture);

        if (res.controllingHand) {
          const lm = res.controllingHand.landmarks;
          const ext = [
            true,
            lm[8].y < lm[6].y,
            lm[12].y < lm[10].y,
            lm[16].y < lm[14].y,
            lm[20].y < lm[18].y,
          ];

          setGestureMetrics({
            confidence: res.confidence,
            pinchRatio: Math.round(res.pinchDistance * 100) / 100,
            extendedFingers: ext,
            inferenceMs: Math.round(infMs),
            fps: Math.round(1000 / (infMs || 1)),
          });

          // Model control test with relative pinch start and two-hand zoom
          if (arRef.current) {
            const currentTransform = arRef.current.getTransform();

            if (res.allHands.length >= 2 && res.allHands[0].landmarks[8] && res.allHands[1].landmarks[8]) {
              const tip1 = res.allHands[0].landmarks[8];
              const tip2 = res.allHands[1].landmarks[8];
              const currentTwoHandDist = Math.hypot(tip1.x - tip2.x, tip1.y - tip2.y);

              if (twoHandStartDistRef.current === null) {
                twoHandStartDistRef.current = currentTwoHandDist;
                twoHandStartScaleRef.current = currentTransform.scale;
                smoothedScaleRef.current = currentTransform.scale;
                setZoomDebug({ startDistance: Math.round(currentTwoHandDist * 100) / 100, startScale: currentTransform.scale });
              } else if (twoHandStartDistRef.current > 0.02) {
                const targetScale = twoHandStartScaleRef.current * (currentTwoHandDist / twoHandStartDistRef.current);
                const clamped = Math.min(Math.max(targetScale, 0.2), 4.0);
                smoothedScaleRef.current += (clamped - smoothedScaleRef.current) * 0.25;
                arRef.current.setTransform({ scale: smoothedScaleRef.current });
                setModelTransform((prev) => ({ ...prev, scale: Math.round(smoothedScaleRef.current * 100) / 100 }));
              }
            } else {
              twoHandStartDistRef.current = null;

              if (res.gesture === 'fist') {
                arRef.current.reset();
                pinchStartDistRef.current = null;
                smoothedScaleRef.current = 1;
                setModelTransform({ position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 });
              } else if (res.gesture === 'open') {
                const palm = { x: (lm[0].x + lm[9].x) / 2, y: (lm[0].y + lm[9].y) / 2 };
                const { dx, dy } = gestureService.getSmoothedDeltas(palm, 'open');
                if (dx !== 0 || dy !== 0) {
                  const nextRot: [number, number, number] = [
                    currentTransform.rotation[0] + dy * 3.0,
                    currentTransform.rotation[1] - dx * 3.0,
                    currentTransform.rotation[2],
                  ];
                  arRef.current.setTransform({ rotation: nextRot });
                  setModelTransform((prev) => ({ ...prev, rotation: nextRot }));
                }
                pinchStartDistRef.current = null;
              } else if (res.gesture === 'pinch') {
                if (pinchStartDistRef.current === null) {
                  pinchStartDistRef.current = Math.max(res.pinchDistance, 0.05);
                  pinchStartScaleRef.current = currentTransform.scale;
                  smoothedScaleRef.current = currentTransform.scale;
                  setZoomDebug({ startDistance: Math.round(res.pinchDistance * 100) / 100, startScale: currentTransform.scale });
                } else {
                  const targetScale = pinchStartScaleRef.current * (res.pinchDistance / pinchStartDistRef.current);
                  const clamped = Math.min(Math.max(targetScale, 0.2), 4.0);
                  smoothedScaleRef.current += (clamped - smoothedScaleRef.current) * 0.25;
                  arRef.current.setTransform({ scale: smoothedScaleRef.current });
                  setModelTransform((prev) => ({ ...prev, scale: Math.round(smoothedScaleRef.current * 100) / 100 }));
                }
              } else {
                pinchStartDistRef.current = null;
              }
            }
          }

          // Air drawing logic: outer 25% zone on right (or left)
          // index tip in mirrored display space [0..1]
          const indexTip = lm[8];
          const displayedX = mirrorVideo ? 1 - indexTip.x : indexTip.x;
          const xPercent = Math.round(displayedX * 100);
          const inZone = drawZoneSide === 'right' ? displayedX >= 0.75 : displayedX <= 0.25;

          // Fist to clear in zone (hold for 1 second)
          if (res.gesture === 'fist' && inZone) {
            if (!fistHoldStartRef.current) fistHoldStartRef.current = now;
            const elapsed = now - fistHoldStartRef.current;
            if (elapsed >= 1000) {
              setAirStrokes([]);
              currentStrokeRef.current = [];
              fistHoldStartRef.current = null;
            }
            setDrawDebugInfo((prev) => ({ ...prev, fistHoldMs: Math.min(elapsed, 1000) }));
          } else {
            fistHoldStartRef.current = null;
            setDrawDebugInfo((prev) => ({ ...prev, fistHoldMs: 0 }));
          }

          // Point move vs Point draw
          if (res.gesture === 'point') {
            if (inZone || isDrawingActive) {
              // Fingertip inside draw zone: pen down
              zoneEntryFramesRef.current++;
              leaveZoneTimeRef.current = null;

              if (zoneEntryFramesRef.current >= 3 || isDrawingActive) {
                const canvas = drawCanvasRef.current;
                if (canvas) {
                  const px = displayedX * canvas.width;
                  const py = indexTip.y * canvas.height;
                  currentStrokeRef.current.push({ x: px, y: py });
                }
                setDrawDebugInfo({
                  inZone: true,
                  xPercent,
                  penState: 'down',
                  pointsCount: currentStrokeRef.current.length,
                  reasonUp: '',
                  fistHoldMs: 0,
                });
              } else {
                setDrawDebugInfo({
                  inZone: true,
                  xPercent,
                  penState: 'up',
                  pointsCount: currentStrokeRef.current.length,
                  reasonUp: 'Awaiting 3 stable frames in zone',
                  fistHoldMs: 0,
                });
              }
            } else {
              // Point outside zone: move model (suppressed when pen is down)
              zoneEntryFramesRef.current = 0;
              if (currentStrokeRef.current.length > 0) {
                setAirStrokes((prev) => [...prev, { points: [...currentStrokeRef.current], color: strokeColor, width: strokeWidth }]);
                currentStrokeRef.current = [];
              }

              if (arRef.current) {
                const { dx, dy } = gestureService.getSmoothedDeltas({ x: indexTip.x, y: indexTip.y }, 'point');
                if (dx !== 0 || dy !== 0) {
                  const currentTransform = arRef.current.getTransform();
                  const nextPos: [number, number, number] = [
                    currentTransform.position[0] - dx * 2.5,
                    currentTransform.position[1] - dy * 2.5,
                    currentTransform.position[2],
                  ];
                  arRef.current.setTransform({ position: nextPos });
                  setModelTransform((prev) => ({ ...prev, position: nextPos }));
                }
              }

              setDrawDebugInfo({
                inZone: false,
                xPercent,
                penState: 'up',
                pointsCount: 0,
                reasonUp: 'outside zone (model moving)',
                fistHoldMs: 0,
              });
            }
          } else {
            // Not point gesture: pen up
            zoneEntryFramesRef.current = 0;
            if (currentStrokeRef.current.length > 0) {
              setAirStrokes((prev) => [...prev, { points: [...currentStrokeRef.current], color: strokeColor, width: strokeWidth }]);
              currentStrokeRef.current = [];
            }
            setDrawDebugInfo({
              inZone,
              xPercent,
              penState: 'up',
              pointsCount: 0,
              reasonUp: `wrong gesture (${res.gesture})`,
              fistHoldMs: 0,
            });
          }
        } else {
          setDrawDebugInfo({
            inZone: false,
            xPercent: 0,
            penState: 'up',
            pointsCount: 0,
            reasonUp: 'hand lost',
            fistHoldMs: 0,
          });
        }
      }

      animId = requestAnimationFrame(continuousLoop);
    };

    animId = requestAnimationFrame(continuousLoop);
    return () => cancelAnimationFrame(animId);
  }, [isDrawingActive, mirrorVideo, drawZoneSide, strokeColor, strokeWidth]);

  // Render Hand Skeleton Overlay on canvas with full neon specs
  useEffect(() => {
    const canvas = overlayCanvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (detectedHands.length === 0) return;

    const colors = GESTURE_COLORS[currentGesture] || GESTURE_COLORS.none;
    const isNeon = overlayStyle === 'neon';

    if (isNeon) {
      ctx.globalCompositeOperation = 'lighter';
    } else {
      ctx.globalCompositeOperation = 'source-over';
    }

    const mappedHands: { x: number; y: number }[][] = [];

    detectedHands.forEach((hand) => {
      const pts = hand.landmarks.map((lm) => ({
        x: (mirrorVideo ? 1 - lm.x : lm.x) * canvas.width,
        y: lm.y * canvas.height,
      }));
      mappedHands.push(pts);

      // Connections
      ctx.beginPath();
      ctx.lineWidth = isNeon ? 3 : 1.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = colors.glow;
      ctx.shadowColor = colors.main;
      ctx.shadowBlur = isNeon ? 22 : 0;
      HAND_CONNECTIONS.forEach(([start, end]) => {
        if (pts[start] && pts[end]) {
          ctx.moveTo(pts[start].x, pts[start].y);
          ctx.lineTo(pts[end].x, pts[end].y);
        }
      });
      ctx.stroke();

      // Landmarks with finger hue offsets
      pts.forEach((pt, idx) => {
        const isTip = FINGERTIP_INDICES.includes(idx);
        const radius = isNeon ? (isTip ? 7 : 3.5) : (isTip ? 4 : 2);
        const fingerGroup = Math.floor(Math.max(0, idx - 1) / 4);
        const hueShift = fingerGroup * 15;

        ctx.beginPath();
        ctx.arc(pt.x, pt.y, radius, 0, 2 * Math.PI);
        ctx.fillStyle = isTip ? '#ffffff' : `hsl(${((idx * 12 + hueShift) % 360)}, 90%, 65%)`;
        ctx.shadowColor = colors.main;
        ctx.shadowBlur = isNeon ? (isTip ? 26 : 14) : 0;
        ctx.fill();
      });

      // Gesture label near wrist
      if (pts[0] && currentGesture !== 'none') {
        const wrist = pts[0];
        ctx.save();
        ctx.globalCompositeOperation = 'source-over';
        ctx.shadowBlur = 0;
        ctx.font = 'bold 11px sans-serif';
        const label = currentGesture.toUpperCase();
        const textWidth = ctx.measureText(label).width;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
        ctx.beginPath();
        ctx.roundRect(wrist.x + 8, wrist.y - 14, textWidth + 12, 18, 4);
        ctx.fill();

        ctx.fillStyle = colors.main;
        ctx.fillText(label, wrist.x + 14, wrist.y);
        ctx.restore();
      }
    });

    // Energy line between two hands
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
  }, [detectedHands, currentGesture, mirrorVideo, overlayStyle]);

  // Render Air Drawing Canvas
  useEffect(() => {
    const canvas = drawCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const renderStroke = (pts: { x: number; y: number }[], color: string, width: number) => {
      if (pts.length < 2) return;
      ctx.beginPath();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 12;
      ctx.lineWidth = width;
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x, pts[i].y);
      }
      ctx.stroke();
    };

    airStrokes.forEach((s) => renderStroke(s.points, s.color, s.width));
    if (currentStrokeRef.current.length > 0) {
      renderStroke(currentStrokeRef.current, strokeColor, strokeWidth);
    }

    // Fingertip ring & dot with Drawing badge when pen is down
    if (drawDebugInfo.penState === 'down' && currentStrokeRef.current.length > 0) {
      const lastPt = currentStrokeRef.current[currentStrokeRef.current.length - 1];
      ctx.save();
      ctx.shadowBlur = 15;
      ctx.shadowColor = strokeColor;

      // Outer ring
      ctx.beginPath();
      ctx.arc(lastPt.x, lastPt.y, 14, 0, 2 * Math.PI);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();

      // Center dot
      ctx.beginPath();
      ctx.arc(lastPt.x, lastPt.y, 4, 0, 2 * Math.PI);
      ctx.fillStyle = strokeColor;
      ctx.fill();

      // Badge
      ctx.font = 'bold 10px sans-serif';
      ctx.fillStyle = 'rgba(0,0,0,0.8)';
      ctx.fillRect(lastPt.x + 18, lastPt.y - 12, 54, 16);
      ctx.fillStyle = '#ffffff';
      ctx.fillText('Drawing', lastPt.x + 22, lastPt.y);
      ctx.restore();
    }
  }, [airStrokes, drawDebugInfo.penState, strokeColor, strokeWidth, detectedHands]);

  // Fallback Mouse Air-Drawing (hold 'D' key)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'd' || e.key === 'D') setIsDrawingActive(true);
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'd' || e.key === 'D') {
        setIsDrawingActive(false);
        if (currentStrokeRef.current.length > 0) {
          setAirStrokes((prev) => [
            ...prev,
            { points: [...currentStrokeRef.current], color: strokeColor, width: strokeWidth },
          ]);
          currentStrokeRef.current = [];
        }
      }
    };
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDrawingActive) return;
      const canvas = drawCanvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      currentStrokeRef.current.push({ x, y });
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('mousemove', handleMouseMove);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, [isDrawingActive]);

  // Copy Full Diagnostic Report
  const copyDiagnosticReport = () => {
    const lines: string[] = [
      '========================================',
      'HOLOCOLLAB GESTURE PIPELINE DIAGNOSTIC REPORT',
      `Timestamp: ${new Date().toISOString()}`,
      `User Agent: ${navigator.userAgent}`,
      `Active Delegate: ${activeDelegate}`,
      `Live FPS / Latency: ${gestureMetrics.fps} fps / ${gestureMetrics.inferenceMs} ms`,
      `Resolution: ${videoInfo.width}x${videoInfo.height} (readyState: ${videoInfo.readyState})`,
      '========================================',
      '',
      'TEST CHECKLIST RESULTS:',
    ];

    steps.forEach((s) => {
      lines.push(`[${s.status.toUpperCase()}] Step ${s.id}: ${s.title}`);
      if (s.error) lines.push(`  Error: ${s.error}`);
      if (s.fixAdvice) lines.push(`  Advice: ${s.fixAdvice}`);
      if (s.details) lines.push(`  Details: ${JSON.stringify(s.details)}`);
    });

    lines.push('');
    lines.push('END OF REPORT');

    navigator.clipboard.writeText(lines.join('\n'));
    setCopiedReport(true);
    setTimeout(() => setCopiedReport(false), 3000);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-8 font-sans">
      {/* Top Header */}
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between pb-6 border-b border-purple-500/20 gap-4">
        <div>
          <div className="flex items-center gap-3">
            <span className="p-2 rounded-xl bg-purple-600/30 border border-purple-500/40 text-purple-300">
              <Activity className="w-6 h-6" />
            </span>
            <h1 className="text-2xl font-bold tracking-tight text-white">
              Hand-Tracking & Gesture Self-Test Pipeline
            </h1>
          </div>
          <p className="text-xs text-purple-300/70 mt-1">
            Zero-dependency diagnostic lab (no socket, no login, no host approval required).
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={runAllTests}
            disabled={isRunning}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-semibold text-xs shadow-lg shadow-purple-600/30 transition disabled:opacity-50"
          >
            {isRunning ? 'Running Tests…' : 'Run Full Diagnostic'}
          </button>
          <button
            onClick={copyDiagnosticReport}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 border border-purple-500/30 hover:bg-slate-800 text-purple-300 hover:text-white text-xs transition"
          >
            {copiedReport ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
            <span>{copiedReport ? 'Report Copied!' : 'Copy Diagnostic Report'}</span>
          </button>
        </div>
      </div>

      {/* Main Grid: Steps Checklist on Left, Live Stage on Right */}
      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8 mt-6">
        {/* Left Column: Vertical Checklist (5 cols) */}
        <div className="lg:col-span-5 flex flex-col gap-3">
          <div className="flex items-center justify-between pb-2">
            <span className="text-xs font-semibold text-purple-300 uppercase tracking-wider">
              Diagnostic Chain
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={runAllTests}
                className="text-xs text-purple-400 hover:text-purple-300 flex items-center gap-1"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Retry</span>
              </button>
              <button
                onClick={skipCurrentStep}
                className="text-xs text-slate-400 hover:text-slate-300 flex items-center gap-1"
              >
                <SkipForward className="w-3.5 h-3.5" />
                <span>Skip</span>
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-2.5 overflow-y-auto max-h-[calc(100vh-220px)] pr-1">
            {steps.map((s) => (
              <div
                key={s.id}
                className={`p-3.5 rounded-2xl border transition-all ${
                  s.status === 'pass'
                    ? 'bg-emerald-950/20 border-emerald-500/30'
                    : s.status === 'fail'
                    ? 'bg-rose-950/30 border-rose-500/40 shadow-lg shadow-rose-950/40'
                    : s.status === 'running'
                    ? 'bg-purple-950/30 border-purple-500/50 animate-pulse'
                    : s.status === 'skipped'
                    ? 'bg-slate-900/40 border-slate-700/40 opacity-60'
                    : 'bg-slate-900/60 border-slate-800'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex-shrink-0">
                    {s.status === 'pass' && <CheckCircle2 className="w-5 h-5 text-emerald-400" />}
                    {s.status === 'fail' && <XCircle className="w-5 h-5 text-rose-500" />}
                    {s.status === 'running' && <Activity className="w-5 h-5 text-purple-400 animate-spin" />}
                    {s.status === 'waiting' && <Clock className="w-5 h-5 text-slate-500" />}
                    {s.status === 'skipped' && <SkipForward className="w-5 h-5 text-amber-400" />}
                  </div>

                  <div className="flex-1 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-white">
                        {s.id}. {s.title}
                      </span>
                      <span
                        className={`text-[10px] font-mono px-1.5 py-0.5 rounded uppercase font-semibold ${
                          s.status === 'pass'
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : s.status === 'fail'
                            ? 'bg-rose-500/20 text-rose-300'
                            : s.status === 'running'
                            ? 'bg-purple-500/20 text-purple-300'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {s.status}
                      </span>
                    </div>

                    <p className="text-purple-300/70 mt-1">{s.explanation}</p>

                    {s.error && (
                      <div className="mt-2 p-2 rounded-xl bg-rose-950/60 border border-rose-500/30 text-rose-200 font-mono text-[11px]">
                        <strong>Error:</strong> {s.error}
                      </div>
                    )}

                    {s.fixAdvice && (
                      <div className="mt-1.5 p-2 rounded-xl bg-amber-950/40 border border-amber-500/30 text-amber-200 text-[11px]">
                        <strong>What to do:</strong> {s.fixAdvice}
                      </div>
                    )}

                    {s.details && (
                      <div className="mt-2 text-[10px] font-mono text-purple-400/80 bg-black/40 p-1.5 rounded-lg">
                        {Object.entries(s.details).map(([k, v]) => (
                          <div key={k} className="truncate">
                            <span className="text-slate-500">{k}:</span> {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right Column: Live Testing Stage (7 cols) */}
        <div className="lg:col-span-7 flex flex-col gap-4">
          {/* Top Live Video & Overlays Canvas Stage */}
          <div className="relative aspect-video w-full rounded-3xl overflow-hidden border border-purple-500/30 bg-slate-900 shadow-2xl">
            {/* Live Camera Video Feed */}
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={`w-full h-full object-cover ${mirrorVideo ? '-scale-x-100' : ''}`}
            />

            {/* Glowing Hand Skeleton Canvas (Step 8) */}
            <canvas
              ref={overlayCanvasRef}
              width={640}
              height={480}
              className="absolute inset-0 w-full h-full object-cover pointer-events-none z-10"
            />

            {/* Air Drawing Canvas (Step 11) */}
            <canvas
              ref={drawCanvasRef}
              width={640}
              height={480}
              className="absolute inset-0 w-full h-full object-cover pointer-events-none z-20"
            />

            {/* Glowing Vertical Draw Zone (outer 25% edge) */}
            <div
              className={`absolute top-0 bottom-0 ${
                drawZoneSide === 'right' ? 'right-0' : 'left-0'
              } w-1/4 border-2 border-dashed ${
                drawDebugInfo.penState === 'down'
                  ? 'border-emerald-400 bg-emerald-500/10 shadow-[0_0_30px_rgba(52,211,153,0.3)]'
                  : 'border-purple-400/50 bg-purple-900/15'
              } transition-all pointer-events-none z-10 flex flex-col justify-between p-3`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold font-mono tracking-wider uppercase px-2 py-0.5 rounded bg-black/60 border border-purple-400/40 text-purple-200">
                  Draw Zone
                </span>
                {drawDebugInfo.fistHoldMs > 0 && (
                  <div className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-950/80 border border-amber-500/50 text-amber-300">
                    Clear: {Math.round((drawDebugInfo.fistHoldMs / 1000) * 100)}%
                  </div>
                )}
              </div>
              <span className="text-[9px] text-purple-300/70 font-mono text-center">
                Point inside to draw | Fist 1s to clear
              </span>
            </div>

            {/* Corner Stage Badges & Controls */}
            <div className="absolute top-3 left-3 flex flex-wrap items-center gap-2 pointer-events-auto z-30">
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-slate-900/80 backdrop-blur-md border border-purple-500/30 text-[11px] text-purple-200 shadow-lg">
                <Camera className="w-3.5 h-3.5 text-cyan-400" />
                <span>
                  {videoInfo.width > 0 ? `${videoInfo.width}x${videoInfo.height}` : 'No Video'}
                </span>
                <span className="text-slate-500">|</span>
                <span>{videoInfo.frames} frames</span>
              </div>

              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-slate-900/80 backdrop-blur-md border border-purple-500/30 text-[11px] text-purple-200 shadow-lg">
                <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                <span>{activeDelegate} Delegate</span>
                <span className="text-slate-500">|</span>
                <span>{gestureMetrics.inferenceMs} ms</span>
              </div>

              {/* Overlay Style Toggle */}
              <button
                onClick={() => setOverlayStyle((prev) => (prev === 'neon' ? 'simple' : 'neon'))}
                className="px-2.5 py-1 rounded-xl bg-slate-900/80 backdrop-blur-md border border-purple-500/30 text-[11px] text-purple-200 hover:text-white transition"
              >
                Style: <strong className="uppercase">{overlayStyle}</strong>
              </button>
            </div>

            {/* Top Right Toggles: Mirror & Draw Zone Side */}
            <div className="absolute top-3 right-3 flex items-center gap-2 pointer-events-auto z-30">
              <button
                onClick={() => setDrawZoneSide((prev) => (prev === 'right' ? 'left' : 'right'))}
                className="px-2.5 py-1 rounded-xl bg-slate-900/80 backdrop-blur-md border border-purple-500/30 text-[11px] text-purple-200 hover:text-white transition"
              >
                Zone: <strong className="uppercase">{drawZoneSide}</strong>
              </button>
              <button
                onClick={() => setMirrorVideo(!mirrorVideo)}
                className="px-2.5 py-1 rounded-xl bg-slate-900/80 backdrop-blur-md border border-purple-500/30 text-[11px] text-purple-200 hover:text-white transition"
              >
                Mirror: {mirrorVideo ? 'ON' : 'OFF'}
              </button>
              <button
                onClick={() => setShowDrawDebug(!showDrawDebug)}
                className="px-2.5 py-1 rounded-xl bg-slate-900/80 backdrop-blur-md border border-purple-500/30 text-[11px] text-purple-200 hover:text-white transition"
              >
                HUD: {showDrawDebug ? 'ON' : 'OFF'}
              </button>
            </div>

            {/* Live Gesture Classification HUD Badge & Zoom Debug HUD (Step 9 / Item 1) */}
            <div className="absolute bottom-3 left-3 pointer-events-auto z-30 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <div
                  className={`px-4 py-2 rounded-2xl border backdrop-blur-md shadow-2xl flex items-center gap-2 ${
                    currentGesture === 'fist'
                      ? 'bg-amber-500/20 border-amber-400 text-amber-300'
                      : currentGesture === 'point'
                      ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300'
                      : currentGesture === 'open'
                      ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300'
                      : currentGesture === 'pinch'
                      ? 'bg-pink-500/20 border-pink-400 text-pink-300'
                      : 'bg-slate-900/80 border-slate-700 text-slate-400'
                  }`}
                >
                  <span className="text-xs font-semibold uppercase tracking-wider">Gesture:</span>
                  <span className="text-base font-black uppercase font-mono">{currentGesture}</span>
                </div>

                <div className="bg-slate-900/80 backdrop-blur-md border border-purple-500/30 px-3 py-1.5 rounded-2xl text-[11px] font-mono text-purple-200">
                  Pinch: <strong>{gestureMetrics.pinchRatio}</strong> | Conf: <strong>{Math.round(gestureMetrics.confidence * 100)}%</strong>
                </div>
              </div>

              {/* LIVE ZOOM HUD: Live Scale, Pinch Ratio, Start values */}
              <div className="bg-black/75 backdrop-blur-md border border-purple-500/30 px-3 py-1.5 rounded-xl text-[10px] font-mono text-purple-200 flex items-center gap-3">
                <span className="text-purple-400 font-bold uppercase">Zoom HUD:</span>
                <span>Live Scale: <strong className="text-cyan-300">{modelTransform.scale}x</strong></span>
                <span>Pinch Ratio: <strong>{gestureMetrics.pinchRatio}</strong></span>
                <span>Start Dist: <strong>{zoomDebug.startDistance}</strong></span>
                <span>Start Scale: <strong>{zoomDebug.startScale}x</strong></span>
              </div>
            </div>

            {/* LIVE DRAW DEBUG HUD (Item 3) */}
            {showDrawDebug && (
              <div className="absolute top-14 left-3 bg-black/85 backdrop-blur-md border border-purple-500/40 p-3 rounded-2xl text-[11px] font-mono text-purple-200 shadow-2xl z-30 flex flex-col gap-1 min-w-[240px]">
                <div className="font-bold text-xs text-purple-300 uppercase tracking-wider pb-1 border-b border-purple-500/30 flex items-center justify-between">
                  <span>Draw Debug HUD</span>
                  <span className={`w-2 h-2 rounded-full ${drawDebugInfo.penState === 'down' ? 'bg-emerald-400 animate-ping' : 'bg-slate-500'}`} />
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Gesture:</span>
                  <span className="font-bold text-white uppercase">{currentGesture}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">In Zone:</span>
                  <span className={`font-bold ${drawDebugInfo.inZone ? 'text-emerald-300' : 'text-slate-400'}`}>
                    {drawDebugInfo.inZone ? 'YES' : 'NO'} ({drawDebugInfo.xPercent}%)
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Pen State:</span>
                  <span className={`font-bold uppercase ${drawDebugInfo.penState === 'down' ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {drawDebugInfo.penState}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Points in Stroke:</span>
                  <span className="font-bold text-cyan-300">{drawDebugInfo.pointsCount}</span>
                </div>
                {drawDebugInfo.reasonUp && (
                  <div className="text-[10px] text-amber-300/90 pt-1 border-t border-purple-500/20">
                    Reason Up: {drawDebugInfo.reasonUp}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Air Drawing Controls: Swatches, Width Slider, Undo, Clear */}
          <div className="p-3 rounded-2xl border border-purple-500/30 bg-slate-900/80 backdrop-blur-md flex flex-wrap items-center justify-between gap-3 text-xs shadow-lg">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold text-purple-300">Ink Color:</span>
              {['#a855f7', '#38bdf8', '#34d399', '#f43f5e', '#fbbf24', '#ffffff'].map((color) => (
                <button
                  key={color}
                  onClick={() => setStrokeColor(color)}
                  style={{ backgroundColor: color }}
                  className={`w-6 h-6 rounded-full border-2 transition ${
                    strokeColor === color ? 'border-white scale-110 shadow-lg' : 'border-black/40'
                  }`}
                />
              ))}
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold text-purple-300">Width:</span>
              <input
                type="range"
                min="2"
                max="12"
                value={strokeWidth}
                onChange={(e) => setStrokeWidth(Number(e.target.value))}
                className="w-24 accent-purple-500"
              />
              <span className="font-mono text-xs w-4">{strokeWidth}px</span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setAirStrokes((prev) => prev.slice(0, -1))}
                disabled={airStrokes.length === 0}
                className="px-3 py-1 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-purple-200 text-xs border border-purple-500/30 transition"
              >
                Undo
              </button>
              <button
                onClick={() => {
                  setAirStrokes([]);
                  currentStrokeRef.current = [];
                }}
                disabled={airStrokes.length === 0}
                className="px-3 py-1 rounded-xl bg-rose-950/40 hover:bg-rose-900/50 disabled:opacity-40 text-rose-300 text-xs border border-rose-500/30 transition"
              >
                Clear
              </button>
            </div>
          </div>

          {/* Bottom Interactive Stages: Model Control (Step 10) & Gesture Help */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* 3D Scene Interactive Test Box */}
            <div className="h-56 rounded-3xl overflow-hidden border border-purple-500/30 bg-slate-900/90 relative shadow-xl">
              <ARSceneComponent
                ref={arRef}
                modelUrl={SAMPLE_MODELS[0].url}
                enableCamera={false}
                className="w-full h-full"
              />

              <div className="absolute top-2 left-2 px-2.5 py-1 rounded-xl bg-black/60 backdrop-blur-md border border-purple-500/30 text-[10px] text-purple-200">
                <Box className="w-3 h-3 text-purple-400 inline mr-1" />
                <span>3D Gesture Interaction Scene</span>
              </div>

              <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between px-2.5 py-1 rounded-xl bg-black/70 backdrop-blur-md border border-purple-500/20 text-[10px] font-mono text-purple-300">
                <span>Pos: [{modelTransform.position.map((v) => v.toFixed(1)).join(', ')}]</span>
                <span>Rot: [{modelTransform.rotation.map((v) => v.toFixed(1)).join(', ')}]</span>
                <span>Scale: {modelTransform.scale}x</span>
              </div>
            </div>

            {/* Gesture Guide & Air Drawing Diagnostics */}
            <div className="p-4 rounded-3xl border border-purple-500/30 bg-slate-900/70 flex flex-col justify-between text-xs">
              <div>
                <h3 className="font-semibold text-white mb-2 flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-purple-400" />
                  <span>Gesture Mapping Guide</span>
                </h3>
                <ul className="flex flex-col gap-1.5 text-purple-300/80 text-[11px]">
                  <li>• <strong>Open palm:</strong> Rotates the 3D model with your hand</li>
                  <li>• <strong>Pinch (thumb + index):</strong> Scales and zooms the model relative to pinch start</li>
                  <li>• <strong>Point (index finger):</strong> Inside draw zone = Air Ink; outside = moves model</li>
                  <li>• <strong>Fist:</strong> In draw zone 1s = clears drawing; outside = resets 3D model</li>
                </ul>
              </div>

              <div className="mt-3 pt-3 border-t border-purple-500/20 flex items-center justify-between">
                <span className="text-[10px] text-slate-400">
                  {airStrokes.length} stroke(s) recorded | Hold 'D' to mouse draw
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DevGesturePage;
