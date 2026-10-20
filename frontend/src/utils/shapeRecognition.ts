export interface Point {
  x: number;
  y: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

export interface ShapeRecognitionResult {
  type: 'circle' | 'rectangle' | 'none';
  confidence: number;
  bounds: Bounds;
}

export function computeBounds(points: Point[]): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  const width = Math.max(0, maxX - minX);
  const height = Math.max(0, maxY - minY);

  return {
    minX,
    minY,
    maxX,
    maxY,
    width,
    height,
    centerX: minX + width / 2,
    centerY: minY + height / 2,
  };
}

export function computePerimeter(points: Point[]): number {
  let perimeter = 0;
  for (let i = 1; i < points.length; i++) {
    perimeter += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return perimeter;
}

export function computePolygonArea(points: Point[]): number {
  let area = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += points[i].x * points[j].y;
    area -= points[j].x * points[i].y;
  }
  return Math.abs(area) / 2;
}

export function countCorners(points: Point[], angleThresholdDeg = 55): number {
  if (points.length < 10) return 0;
  // Subsample to filter local micro-jitter
  const step = Math.max(1, Math.floor(points.length / 32));
  const subsampled: Point[] = [];
  for (let i = 0; i < points.length; i += step) {
    subsampled.push(points[i]);
  }
  if (subsampled.length < 5) return 0;

  let corners = 0;
  const n = subsampled.length;
  const radThreshold = (angleThresholdDeg * Math.PI) / 180;

  for (let i = 1; i < n - 1; i++) {
    const pPrev = subsampled[i - 1];
    const pCurr = subsampled[i];
    const pNext = subsampled[i + 1];

    const v1 = { x: pCurr.x - pPrev.x, y: pCurr.y - pPrev.y };
    const v2 = { x: pNext.x - pCurr.x, y: pNext.y - pCurr.y };

    const mag1 = Math.hypot(v1.x, v1.y);
    const mag2 = Math.hypot(v2.x, v2.y);

    if (mag1 < 1e-4 || mag2 < 1e-4) continue;

    const dot = (v1.x * v2.x + v1.y * v2.y) / (mag1 * mag2);
    const clampedDot = Math.max(-1, Math.min(1, dot));
    const angleChange = Math.acos(clampedDot);

    if (angleChange >= radThreshold) {
      corners++;
      // Skip next index to prevent double counting the same corner
      i++;
    }
  }

  return corners;
}

/**
 * Recognizes if a stroke sequence of points (can be [number, number][] or Point[])
 * is a circle, a rectangle, or none.
 */
export function recognizeShape(rawPoints: [number, number][] | Point[]): ShapeRecognitionResult {
  const emptyBounds: Bounds = {
    minX: 0,
    minY: 0,
    maxX: 0,
    maxY: 0,
    width: 0,
    height: 0,
    centerX: 0,
    centerY: 0,
  };

  if (!rawPoints || rawPoints.length < 12) {
    return { type: 'none', confidence: 0, bounds: emptyBounds };
  }

  const points: Point[] = Array.isArray(rawPoints[0])
    ? (rawPoints as [number, number][]).map(([x, y]) => ({ x, y }))
    : (rawPoints as Point[]);

  const bounds = computeBounds(points);
  const diag = Math.hypot(bounds.width, bounds.height);

  // Tiny scribble check: bounding box diagonal must be meaningful
  if (diag < 0.04) {
    return { type: 'none', confidence: 0, bounds };
  }

  const startPt = points[0];
  const endPt = points[points.length - 1];
  const closureDist = Math.hypot(endPt.x - startPt.x, endPt.y - startPt.y);

  // Closure distance check: start must be close to end relative to diagonal
  const closureRatio = closureDist / diag;
  if (closureRatio > 0.35) {
    // Open curve/line
    return { type: 'none', confidence: 0, bounds };
  }

  const perimeter = computePerimeter(points);
  if (perimeter < 1e-5) {
    return { type: 'none', confidence: 0, bounds };
  }

  const area = computePolygonArea(points);
  // Circularity ratio: (4 * pi * area) / (perimeter^2)
  // For a perfect circle = 1.0, for a square = pi / 4 ~= 0.785, triangle ~= 0.60
  const circularity = (4 * Math.PI * area) / (perimeter * perimeter);
  const aspectRatio = bounds.width / (bounds.height || 1e-4);

  // 1. Circle check:
  // Circularity >= 0.76 and aspect ratio between 0.65 and 1.45
  if (circularity >= 0.74 && aspectRatio >= 0.65 && aspectRatio <= 1.45) {
    const confidence = Math.min(1, Math.max(0.6, circularity));
    return { type: 'circle', confidence, bounds };
  }

  // 2. Rectangle check:
  // Corners ~ 3 to 6, circularity between 0.55 and 0.85
  const corners = countCorners(points, 50);
  const bboxArea = bounds.width * bounds.height;
  const areaFillRatio = bboxArea > 0 ? area / bboxArea : 0;

  // A rectangle typically fills ~70-100% of its bounding box and has ~4 corners
  if (
    corners >= 3 &&
    corners <= 6 &&
    areaFillRatio >= 0.65 &&
    circularity >= 0.55 &&
    circularity <= 0.88
  ) {
    const confidence = Math.min(0.95, areaFillRatio);
    return { type: 'rectangle', confidence, bounds };
  }

  return { type: 'none', confidence: 0, bounds };
}
