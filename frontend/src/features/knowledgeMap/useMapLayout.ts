import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotionConfig } from 'motion/react';
import type { TopicGraph } from './buildGraph';
import { DOCUMENT_NODE, interpolate, layoutGraph, relaxAround, type Point } from './layout';

const SETTLE_MS = 260;
const NO_PINS: ReadonlySet<string> = new Set();

interface Moved {
  base: ReadonlyMap<string, Point>;
  positions: ReadonlyMap<string, Point>;
  pinned: ReadonlySet<string>;
}

/** Where every node is. Nothing moves by itself: only a drop, a pin change or a reset does, and then it stops. */
export function useMapLayout(graph: TopicGraph, hubs: readonly string[]) {
  const base = useMemo(() => layoutGraph(graph, hubs), [graph, hubs]);
  const [moved, setMoved] = useState<Moved | null>(null);
  const current = moved?.base === base ? moved : null;
  const positions = current?.positions ?? base;
  const pinned = current?.pinned ?? NO_PINS;
  const reduced = useReducedMotionConfig();
  const frame = useRef(0);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const animate = useCallback(
    (from: ReadonlyMap<string, Point>, to: ReadonlyMap<string, Point>, nextPinned: ReadonlySet<string>) => {
      cancelAnimationFrame(frame.current);
      if (reduced) {
        setMoved({ base, positions: to, pinned: nextPinned });
        return;
      }
      const started = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - started) / SETTLE_MS);
        const eased = 1 - (1 - t) ** 3;
        setMoved({ base, positions: t === 1 ? to : interpolate(from, to, eased), pinned: nextPinned });
        if (t < 1) frame.current = requestAnimationFrame(tick);
      };
      frame.current = requestAnimationFrame(tick);
    },
    [base, reduced],
  );

  /** Follows the pointer exactly, with nothing else moving. */
  const moveNode = useCallback(
    (id: string, point: Point) => {
      cancelAnimationFrame(frame.current);
      setMoved((state) => {
        const live = state?.base === base ? state : { base, positions: base, pinned: NO_PINS };
        return { ...live, positions: new Map(live.positions).set(id, point) };
      });
    },
    [base],
  );

  /** A dropped node stays where it was put. Its direct neighbours make a little room, unless they are pinned. */
  const dropNode = useCallback(
    (id: string) => {
      const nextPinned = new Set(pinned).add(id);
      const movable = new Set(
        graph.edges.flatMap((edge) => (edge.source === id ? [edge.target] : edge.target === id ? [edge.source] : [])).filter((other) => !nextPinned.has(other) && other !== DOCUMENT_NODE),
      );
      animate(positions, relaxAround(positions, graph, movable), nextPinned);
    },
    [animate, graph, pinned, positions],
  );

  const togglePin = useCallback(
    (id: string) => {
      setMoved((state) => {
        const live = state?.base === base ? state : { base, positions: base, pinned: NO_PINS };
        const next = new Set(live.pinned);
        if (!next.delete(id)) next.add(id);
        return { ...live, pinned: next };
      });
    },
    [base],
  );

  const reset = useCallback(() => animate(positions, base, NO_PINS), [animate, base, positions]);

  return { positions, pinned, moved: current !== null, moveNode, dropNode, togglePin, reset };
}
