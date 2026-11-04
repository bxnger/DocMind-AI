import type { TopicGraph } from './buildGraph';

export interface Point {
  x: number;
  y: number;
}

export const WORLD = { width: 1000, height: 700 };
const MARGIN = 70;
const ITERATIONS = 300;

/** Force-directed layout. It uses no randomness, so the same document always gives the same map. */
export function layoutGraph(graph: TopicGraph): Map<string, Point> {
  const count = graph.nodes.length;
  const positions = new Map<string, Point>();
  graph.nodes.forEach((node, index) => {
    const angle = index * 2.399963; // Golden angle: an even start with no random seed.
    const radius = 30 + 280 * Math.sqrt((index + 0.5) / Math.max(count, 1));
    positions.set(node.id, { x: WORLD.width / 2 + radius * 1.3 * Math.cos(angle), y: WORLD.height / 2 + radius * Math.sin(angle) });
  });
  const ideal = Math.sqrt(((WORLD.width - 2 * MARGIN) * (WORLD.height - 2 * MARGIN)) / Math.max(count, 1)) * 0.75;
  for (let step = 0; step < ITERATIONS; step += 1) {
    const heat = 40 * (1 - step / ITERATIONS) + 0.5;
    const moves = new Map(graph.nodes.map((node) => [node.id, { x: 0, y: 0 }]));
    const push = (id: string, x: number, y: number) => {
      const move = moves.get(id);
      if (move) {
        move.x += x;
        move.y += y;
      }
    };
    graph.nodes.forEach((a, i) => {
      for (const b of graph.nodes.slice(i + 1)) {
        const pa = positions.get(a.id);
        const pb = positions.get(b.id);
        if (!pa || !pb) continue;
        const dx = pa.x - pb.x || 0.01;
        const dy = pa.y - pb.y || 0.01;
        const distance = Math.max(Math.hypot(dx, dy), 1);
        const force = (ideal * ideal) / distance / distance;
        push(a.id, dx * force, dy * force);
        push(b.id, -dx * force, -dy * force);
      }
    });
    for (const edge of graph.edges) {
      const pa = positions.get(edge.source);
      const pb = positions.get(edge.target);
      if (!pa || !pb) continue;
      const dx = pa.x - pb.x;
      const dy = pa.y - pb.y;
      const force = Math.hypot(dx, dy) / ideal;
      push(edge.source, -dx * force, -dy * force);
      push(edge.target, dx * force, dy * force);
    }
    for (const [id, move] of moves) {
      const point = positions.get(id);
      if (!point) continue;
      const length = Math.max(Math.hypot(move.x, move.y), 0.01);
      const limited = Math.min(length, heat) / length;
      point.x = Math.min(WORLD.width - MARGIN, Math.max(MARGIN, point.x + move.x * limited));
      point.y = Math.min(WORLD.height - MARGIN, Math.max(MARGIN, point.y + move.y * limited));
    }
  }
  return positions;
}

export interface View {
  x: number;
  y: number;
  k: number;
}

export const MIN_ZOOM = 0.3;
export const MAX_ZOOM = 4;

export function fitView(width: number, height: number): View {
  const k = Math.max(MIN_ZOOM, Math.min(width / WORLD.width, height / WORLD.height, MAX_ZOOM));
  return { k, x: (width - WORLD.width * k) / 2, y: (height - WORLD.height * k) / 2 };
}

/** Zooms around a screen point, which stays under the pointer. */
export function zoomAt(view: View, factor: number, cx: number, cy: number): View {
  const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.k * factor));
  const ratio = k / view.k;
  return { k, x: cx - (cx - view.x) * ratio, y: cy - (cy - view.y) * ratio };
}

/** Moves the view so that a world point sits at the centre of the screen. */
export function centerOn(view: View, point: Point, width: number, height: number): View {
  return { k: view.k, x: width / 2 - point.x * view.k, y: height / 2 - point.y * view.k };
}
