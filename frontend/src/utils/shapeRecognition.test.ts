import { describe, it, expect } from 'vitest';
import { recognizeShape, Point } from './shapeRecognition';

describe('recognizeShape', () => {
  it('recognizes a clean circle', () => {
    const points: Point[] = [];
    const radius = 0.2;
    const cx = 0.5;
    const cy = 0.5;
    const steps = 40;
    for (let i = 0; i <= steps; i++) {
      const angle = (i / steps) * 2 * Math.PI;
      points.push({
        x: cx + radius * Math.cos(angle),
        y: cy + radius * Math.sin(angle),
      });
    }

    const res = recognizeShape(points);
    expect(res.type).toBe('circle');
    expect(res.confidence).toBeGreaterThan(0.7);
  });

  it('recognizes a wobbly circle', () => {
    const points: Point[] = [];
    const baseRadius = 0.25;
    const cx = 0.5;
    const cy = 0.5;
    const steps = 36;
    for (let i = 0; i <= steps; i++) {
      const angle = (i / steps) * 2 * Math.PI;
      // 5% wobble
      const wobble = (Math.sin(i * 3) * 0.05 + 1.0) * baseRadius;
      points.push({
        x: cx + wobble * Math.cos(angle),
        y: cy + wobble * Math.sin(angle),
      });
    }

    const res = recognizeShape(points);
    expect(res.type).toBe('circle');
  });

  it('recognizes a rectangle', () => {
    const points: Point[] = [];
    // Rectangle from (0.2, 0.2) to (0.7, 0.5)
    // Top side: (0.2, 0.2) -> (0.7, 0.2)
    for (let i = 0; i <= 10; i++) points.push({ x: 0.2 + 0.05 * i, y: 0.2 });
    // Right side: (0.7, 0.2) -> (0.7, 0.5)
    for (let i = 1; i <= 6; i++) points.push({ x: 0.7, y: 0.2 + 0.05 * i });
    // Bottom side: (0.7, 0.5) -> (0.2, 0.5)
    for (let i = 1; i <= 10; i++) points.push({ x: 0.7 - 0.05 * i, y: 0.5 });
    // Left side: (0.2, 0.5) -> (0.2, 0.2)
    for (let i = 1; i <= 6; i++) points.push({ x: 0.2, y: 0.5 - 0.05 * i });

    const res = recognizeShape(points);
    expect(res.type).toBe('rectangle');
    expect(res.confidence).toBeGreaterThan(0.6);
  });

  it('rejects an open line', () => {
    const points: Point[] = [];
    for (let i = 0; i <= 20; i++) {
      points.push({ x: 0.1 + i * 0.03, y: 0.2 + i * 0.02 });
    }

    const res = recognizeShape(points);
    expect(res.type).toBe('none');
  });

  it('rejects a tiny scribble', () => {
    const points: Point[] = [
      { x: 0.100, y: 0.100 },
      { x: 0.105, y: 0.105 },
      { x: 0.102, y: 0.103 },
      { x: 0.100, y: 0.100 },
    ];

    const res = recognizeShape(points);
    expect(res.type).toBe('none');
  });

  it('rejects a triangle', () => {
    const points: Point[] = [];
    // Equilateral triangle
    const p1 = { x: 0.5, y: 0.2 };
    const p2 = { x: 0.8, y: 0.7 };
    const p3 = { x: 0.2, y: 0.7 };

    // p1 -> p2
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      points.push({ x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y) });
    }
    // p2 -> p3
    for (let i = 1; i <= 10; i++) {
      const t = i / 10;
      points.push({ x: p2.x + t * (p3.x - p2.x), y: p2.y + t * (p3.y - p2.y) });
    }
    // p3 -> p1
    for (let i = 1; i <= 10; i++) {
      const t = i / 10;
      points.push({ x: p3.x + t * (p1.x - p3.x), y: p3.y + t * (p1.y - p3.y) });
    }

    const res = recognizeShape(points);
    expect(res.type).toBe('none');
  });
});
