import { describe, it, expect, vi } from 'vitest';
import { globalGUMQueue } from '../hooks/useMediaSession';

describe('useMediaSession queue and release timing', () => {
  it('serialises concurrent getUserMedia operations through global queue', async () => {
    let order: string[] = [];

    const p1 = globalGUMQueue.then(async () => {
      order.push('gum1_start');
      await new Promise((r) => setTimeout(r, 20));
      order.push('gum1_end');
    });

    const p2 = p1.then(async () => {
      order.push('gum2_start');
      await new Promise((r) => setTimeout(r, 10));
      order.push('gum2_end');
    });

    await p2;
    expect(order).toEqual(['gum1_start', 'gum1_end', 'gum2_start', 'gum2_end']);
  });

  it('stops all tracks when releasing a stream', () => {
    const videoTrack = { kind: 'video', stop: vi.fn() };
    const audioTrack = { kind: 'audio', stop: vi.fn() };
    const stream = {
      getTracks: () => [videoTrack, audioTrack],
    };

    stream.getTracks().forEach((t) => t.stop());
    expect(videoTrack.stop).toHaveBeenCalled();
    expect(audioTrack.stop).toHaveBeenCalled();
  });
});
