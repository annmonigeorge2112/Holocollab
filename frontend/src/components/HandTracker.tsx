import React, { useEffect, useRef, useState } from 'react';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

interface HandTrackerProps {
  onGestureMove: (delta: { dx: number; dy: number; pinchScale: number }) => void;
  isEnabled: boolean;
}

export const HandTracker: React.FC<HandTrackerProps> = ({ onGestureMove, isEnabled }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [loaded, setLoaded] = useState(false);
  const handLandmarkerRef = useRef<HandLandmarker | null>(null);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    let active = true;

    async function initMediaPipe() {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
        );
        const landmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numHands: 1,
        });
        if (active) {
          handLandmarkerRef.current = landmarker;
          setLoaded(true);
        }
      } catch (err) {
        console.warn('Could not load HandLandmarker model', err);
      }
    }

    if (isEnabled) {
      initMediaPipe();
    }

    return () => {
      active = false;
      if (handLandmarkerRef.current) {
        handLandmarkerRef.current.close();
      }
    };
  }, [isEnabled]);

  useEffect(() => {
    if (!isEnabled || !loaded) return;

    let stream: MediaStream | null = null;
    let animFrame: number;

    async function startCamera() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 320, height: 240 },
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
        }
      } catch (err) {
        console.warn('Webcam access failed', err);
      }
    }

    startCamera();

    const processVideo = () => {
      if (
        videoRef.current &&
        videoRef.current.readyState >= 2 &&
        handLandmarkerRef.current
      ) {
        const results = handLandmarkerRef.current.detectForVideo(
          videoRef.current,
          performance.now()
        );
        if (results.landmarks && results.landmarks.length > 0) {
          const landmarks = results.landmarks[0];
          const indexFinger = landmarks[8];
          const thumbTip = landmarks[4];

          // Compute pinch distance
          const pinchDist = Math.hypot(
            indexFinger.x - thumbTip.x,
            indexFinger.y - thumbTip.y
          );
          const pinchScale = pinchDist > 0.08 ? 1.02 : 0.98;

          if (lastPosRef.current) {
            const dx = (indexFinger.x - lastPosRef.current.x) * 4;
            const dy = (indexFinger.y - lastPosRef.current.y) * 4;
            onGestureMove({ dx, dy, pinchScale });
          }
          lastPosRef.current = { x: indexFinger.x, y: indexFinger.y };
        } else {
          lastPosRef.current = null;
        }
      }
      animFrame = requestAnimationFrame(processVideo);
    };

    animFrame = requestAnimationFrame(processVideo);

    return () => {
      cancelAnimationFrame(animFrame);
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [isEnabled, loaded, onGestureMove]);

  if (!isEnabled) return null;

  return (
    <div className="absolute bottom-4 right-4 z-30 rounded-lg overflow-hidden border border-cyan-500/30 shadow-lg bg-black/60">
      <video
        ref={videoRef}
        muted
        playsInline
        className="w-36 h-28 object-cover transform scale-x-[-1]"
      />
      <div className="absolute top-1 left-2 text-[10px] text-cyan-400 font-mono">
        {loaded ? 'Gesture Active' : 'Loading Vision...'}
      </div>
    </div>
  );
};
