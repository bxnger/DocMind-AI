import { describe, expect, it } from 'vitest';
import { PREVIEW_MAX_HEIGHT, PREVIEW_WIDTH, placePreview } from './placement';

const viewport = { width: 1200, height: 800 };
const marker = (left: number, top: number) => ({ left, top, right: left + 20, bottom: top + 18 });

describe('placePreview', () => {
  it('opens below the marker, centred on it', () => {
    const placed = placePreview(marker(500, 300), viewport);
    expect(placed.top).toBe(326);
    expect(placed.bottom).toBeUndefined();
    expect(placed.left).toBe(510 - PREVIEW_WIDTH / 2);
  });

  it('flips above when there is no room below', () => {
    const placed = placePreview(marker(500, 800 - PREVIEW_MAX_HEIGHT / 2), viewport);
    expect(placed.top).toBeUndefined();
    expect(placed.bottom).toBe(viewport.height - (800 - PREVIEW_MAX_HEIGHT / 2) + 8);
  });

  it('stays inside the viewport at both edges', () => {
    expect(placePreview(marker(0, 100), viewport).left).toBe(8);
    expect(placePreview(marker(1190, 100), viewport).left).toBe(1200 - PREVIEW_WIDTH - 8);
  });

  it('still fits on a 360px phone', () => {
    const placed = placePreview(marker(300, 100), { width: 360, height: 640 });
    expect(placed.left).toBeGreaterThanOrEqual(8);
    expect(placed.left + PREVIEW_WIDTH).toBeLessThanOrEqual(360 - 8);
  });

  it('opens below when it fits neither way, so it is never pushed off the top', () => {
    expect(placePreview(marker(100, 40), { width: 600, height: 200 }).top).toBeDefined();
  });
});
