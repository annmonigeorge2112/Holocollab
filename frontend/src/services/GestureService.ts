import { FilesetResolver, HandLandmarker, NormalizedLandmark } from '@mediapipe/tasks-vision';

export type GestureType = 'fist' | 'point' | 'open' | 'pinch' | 'none';

export interface LandmarkPoint {
  x: number;
  y: number;
  z: number;
}

export interface HandLandmarksResult {
  landmarks: LandmarkPoint[];
  handedness?: string;
}

export interface GestureDetectionResult {
  gesture: GestureType;
  controllingHand: HandLandmarksResult | null;
  allHands: HandLandmarksResult[];
  pinchDistance: number;
  confidence: number;
}

// MediaPipe 21 Hand Connections
export const HAND_CONNECTIONS: [number, number][] = [
  // Wrist to MCP
  [0, 1], [1, 2], [2, 3], [3, 4],       // Thumb
  [0, 5], [5, 6], [6, 7], [7, 8],       // Index
  [0, 9], [9, 10], [10, 11], [11, 12],  // Middle
  [0, 13], [13, 14], [14, 15], [15, 16],// Ring
  [0, 17], [17, 18], [18, 19], [19, 20],// Pinky
  // Palm base
  [5, 9], [9, 13], [13, 17]
];

export const FINGERTIP_INDICES = [4, 8, 12, 16, 20];

export class GestureService {
  private static instance: GestureService | null = null;
  private landmarker: HandLandmarker | null = null;
  private initPromise: Promise<HandLandmarker | null> | null = null;

  // Smoothing state
  private recentGestures: GestureType[] = [];
  private lastFingertipPos: { x: number; y: number } | null = null;
  private lastPalmPos: { x: number; y: number } | null = null;

  public static getInstance(): GestureService {
    if (!GestureService.instance) {
      GestureService.instance = new GestureService();
    }
    return GestureService.instance;
  }

  public async initialize(): Promise<HandLandmarker | null> {
    if (this.landmarker) return this.landmarker;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
        );

        let landmarker: HandLandmarker | null = null;
        try {
          landmarker = await HandLandmarker.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath:
                'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
              delegate: 'GPU',
            },
            runningMode: 'VIDEO',
            numHands: 2,
          });
        } catch (gpuError) {
          console.warn('GPU delegate failed for HandLandmarker, falling back to CPU:', gpuError);
          landmarker = await HandLandmarker.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath:
                'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
              delegate: 'CPU',
            },
            runningMode: 'VIDEO',
            numHands: 2,
          });
        }

        this.landmarker = landmarker;
        return landmarker;
      } catch (err) {
        console.error('Failed to initialize HandLandmarker:', err);
        return null;
      }
    })();

    return this.initPromise;
  }

  public detectForVideo(video: HTMLVideoElement, timestampMs: number): GestureDetectionResult {
    if (!this.landmarker) {
      return {
        gesture: 'none',
        controllingHand: null,
        allHands: [],
        pinchDistance: 0,
        confidence: 0,
      };
    }

    try {
      const results = this.landmarker.detectForVideo(video, timestampMs);

      if (!results.landmarks || results.landmarks.length === 0) {
        this.recentGestures.push('none');
        if (this.recentGestures.length > 3) this.recentGestures.shift();
        this.lastFingertipPos = null;
        this.lastPalmPos = null;
        return {
          gesture: 'none',
          controllingHand: null,
          allHands: [],
          pinchDistance: 0,
          confidence: 0,
        };
      }

      const allHands: HandLandmarksResult[] = results.landmarks.map((hand, idx) => ({
        landmarks: hand.map((lm: NormalizedLandmark) => ({ x: lm.x, y: lm.y, z: lm.z })),
        handedness: results.handedness?.[idx]?.[0]?.categoryName || 'Unknown',
      }));

      const controlling = allHands[0];
      const rawGesture = this.classifyGesture(controlling.landmarks);

      // Stabilize: same gesture for 3 consecutive frames
      this.recentGestures.push(rawGesture);
      if (this.recentGestures.length > 3) {
        this.recentGestures.shift();
      }

      const isStable =
        this.recentGestures.length === 3 &&
        this.recentGestures.every((g) => g === rawGesture);

      const stableGesture: GestureType = isStable ? rawGesture : (this.recentGestures[this.recentGestures.length - 2] || 'none');

      // Calculate pinch distance (thumb tip: 4 to index tip: 8 / hand size)
      const lm = controlling.landmarks;
      const wrist = lm[0];
      const middleMcp = lm[9];
      const handSize = Math.hypot(middleMcp.x - wrist.x, middleMcp.y - wrist.y) || 1;
      const thumbTip = lm[4];
      const indexTip = lm[8];
      const pinchDistance = Math.hypot(indexTip.x - thumbTip.x, indexTip.y - thumbTip.y) / handSize;

      return {
        gesture: stableGesture,
        controllingHand: controlling,
        allHands,
        pinchDistance,
        confidence: results.handedness?.[0]?.[0]?.score || 0.9,
      };
    } catch {
      return {
        gesture: 'none',
        controllingHand: null,
        allHands: [],
        pinchDistance: 0,
        confidence: 0,
      };
    }
  }

  /**
   * Geometry classification:
   * A finger is extended when tip distance to wrist > PIP joint distance to wrist.
   * - Thumb tip: 4, IP: 3
   * - Index tip: 8, PIP: 6
   * - Middle tip: 12, PIP: 10
   * - Ring tip: 16, PIP: 14
   * - Pinky tip: 20, PIP: 18
   */
  public classifyGesture(lm: LandmarkPoint[]): GestureType {
    if (lm.length < 21) return 'none';

    const wrist = lm[0];
    const distToWrist = (p: LandmarkPoint) => Math.hypot(p.x - wrist.x, p.y - wrist.y);

    const indexExtended = distToWrist(lm[8]) > distToWrist(lm[6]);
    const middleExtended = distToWrist(lm[12]) > distToWrist(lm[10]);
    const ringExtended = distToWrist(lm[16]) > distToWrist(lm[14]);
    const pinkyExtended = distToWrist(lm[20]) > distToWrist(lm[18]);

    // Hand size normalization
    const handSize = Math.hypot(lm[9].x - wrist.x, lm[9].y - wrist.y) || 1;
    const thumbIndexDist = Math.hypot(lm[8].x - lm[4].x, lm[8].y - lm[4].y) / handSize;

    // 1. Pinch: thumb and index tips are very close (< 0.35)
    if (thumbIndexDist < 0.35) {
      return 'pinch';
    }

    // 2. Fist: all fingers folded (tips closer to wrist than PIP)
    if (!indexExtended && !middleExtended && !ringExtended && !pinkyExtended) {
      return 'fist';
    }

    // 3. Point: ONLY index extended, middle, ring, pinky folded
    if (indexExtended && !middleExtended && !ringExtended && !pinkyExtended) {
      return 'point';
    }

    // 4. Open: index, middle, ring, and pinky all extended
    if (indexExtended && middleExtended && ringExtended && pinkyExtended) {
      return 'open';
    }

    return 'none';
  }

  public getSmoothedDeltas(
    currentPos: { x: number; y: number },
    type: 'point' | 'open'
  ): { dx: number; dy: number } {
    const last = type === 'point' ? this.lastFingertipPos : this.lastPalmPos;
    if (!last) {
      if (type === 'point') this.lastFingertipPos = currentPos;
      else this.lastPalmPos = currentPos;
      return { dx: 0, dy: 0 };
    }

    const rawDx = currentPos.x - last.x;
    const rawDy = currentPos.y - last.y;

    // Ignore tiny jitter
    const threshold = 0.003;
    const cleanDx = Math.abs(rawDx) < threshold ? 0 : rawDx;
    const cleanDy = Math.abs(rawDy) < threshold ? 0 : rawDy;

    // Exponential smoothing (alpha = 0.6)
    const alpha = 0.6;
    const smoothedDx = cleanDx * alpha;
    const smoothedDy = cleanDy * alpha;

    if (type === 'point') this.lastFingertipPos = currentPos;
    else this.lastPalmPos = currentPos;

    return { dx: smoothedDx, dy: smoothedDy };
  }

  public resetTracking(): void {
    this.recentGestures = [];
    this.lastFingertipPos = null;
    this.lastPalmPos = null;
  }

  public close(): void {
    if (this.landmarker) {
      this.landmarker.close();
      this.landmarker = null;
    }
    this.initPromise = null;
    this.resetTracking();
  }
}

export const gestureService = GestureService.getInstance();
