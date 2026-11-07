import type { TopicGraph } from './buildGraph';

export interface Point {
  x: number;
  y: number;
}

export const WORLD = { width: 1000, height: 700 };
/** The document itself, at the centre of its map. */
export const DOCUMENT_NODE = '__document__';
const MARGIN = 70;
const ITERATIONS = 300;
const ROOT_GRAVITY = 0.012;

/** A larger map gets more room, so that fifty topics are as readable as twenty when zoomed in. */
export function worldFor(count: number): { width: number; height: number } {
  const scale = Math.max(1, Math.sqrt(count / 25));
  return { width: WORLD.width * scale, height: WORLD.height * scale };
}

interface SimOptions {
  world: { width: number; height: number };
  /** Nodes that the simulation may not move. */
  fixed?: ReadonlySet<string>;
  iterations?: number;
  startHeat?: number;
  /** Pull towards the centre instead of walls, so a map becomes a cloud and not a ring along its edges. */
  gravity?: number;
}

function simulate(ids: readonly string[], edges: ReadonlyArray<{ source: string; target: string }>, positions: Map<string, Point>, { world, fixed, iterations = ITERATIONS, startHeat = 40, gravity = 0 }: SimOptions) {
  const ideal = Math.sqrt(((world.width - 2 * MARGIN) * (world.height - 2 * MARGIN)) / Math.max(ids.length, 1)) * 0.75;
  for (let step = 0; step < iterations; step += 1) {
    const heat = startHeat * (1 - step / iterations) + 0.5;
    const moves = new Map(ids.map((id) => [id, { x: 0, y: 0 }]));
    const push = (id: string, x: number, y: number) => {
      const move = moves.get(id);
      if (move) {
        move.x += x;
        move.y += y;
      }
    };
    ids.forEach((a, i) => {
      for (const b of ids.slice(i + 1)) {
        const pa = positions.get(a);
        const pb = positions.get(b);
        if (!pa || !pb) continue;
        const dx = pa.x - pb.x || 0.01;
        const dy = pa.y - pb.y || 0.01;
        const distance = Math.max(Math.hypot(dx, dy), 1);
        const force = (ideal * ideal) / distance / distance;
        push(a, dx * force, dy * force);
        push(b, -dx * force, -dy * force);
      }
    });
    for (const edge of edges) {
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
      if (!point || fixed?.has(id)) continue;
      if (gravity) {
        move.x += (world.width / 2 - point.x) * gravity * ideal;
        move.y += (world.height / 2 - point.y) * gravity * ideal;
      }
      const length = Math.max(Math.hypot(move.x, move.y), 0.01);
      const limited = Math.min(length, heat) / length;
      point.x += move.x * limited;
      point.y += move.y * limited;
      if (!gravity) {
        point.x = Math.min(world.width - MARGIN, Math.max(MARGIN, point.x));
        point.y = Math.min(world.height - MARGIN, Math.max(MARGIN, point.y));
      }
    }
  }
}

/** Force-directed layout. It uses no randomness, so the same document always gives the same map. */
export function layoutGraph(graph: TopicGraph, hubs: readonly string[] = []): Map<string, Point> {
  const withRoot = hubs.length > 0;
  const ids = [...(withRoot ? [DOCUMENT_NODE] : []), ...graph.nodes.map((node) => node.id)];
  const world = withRoot ? worldFor(ids.length) : WORLD;
  const positions = new Map<string, Point>();
  ids.forEach((id, index) => {
    const angle = index * 2.399963; // Golden angle: an even start with no random seed.
    const radius = (30 + 280 * Math.sqrt((index + 0.5) / Math.max(ids.length, 1))) * (world.width / WORLD.width);
    positions.set(id, { x: world.width / 2 + radius * 1.3 * Math.cos(angle), y: world.height / 2 + radius * Math.sin(angle) });
  });
  if (withRoot) positions.set(DOCUMENT_NODE, { x: world.width / 2, y: world.height / 2 });
  const edges = [...graph.edges, ...hubs.map((hub) => ({ source: DOCUMENT_NODE, target: hub }))];
  simulate(ids, edges, positions, { world, fixed: withRoot ? new Set([DOCUMENT_NODE]) : undefined, gravity: withRoot ? ROOT_GRAVITY : 0 });
  return positions;
}

/**
 * After a node is dropped: only the listed nodes may adjust, briefly, so the rest of the map stays where the user
 * left it. Pinned nodes are never in the list. Returns new positions; the input is not touched.
 */
export function relaxAround(positions: ReadonlyMap<string, Point>, graph: TopicGraph, movable: ReadonlySet<string>): Map<string, Point> {
  const copy = new Map([...positions].map(([id, point]) => [id, { ...point }]));
  const ids = [...copy.keys()];
  const fixed = new Set(ids.filter((id) => !movable.has(id)));
  simulate(ids, graph.edges, copy, { world: worldFor(ids.length), fixed, iterations: 24, startHeat: 6, gravity: ROOT_GRAVITY });
  return copy;
}

export const interpolate = (from: ReadonlyMap<string, Point>, to: ReadonlyMap<string, Point>, t: number): Map<string, Point> =>
  new Map([...to].map(([id, end]) => {
    const start = from.get(id) ?? end;
    return [id, { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t }];
  }));

export interface View {
  x: number;
  y: number;
  k: number;
}

export const MIN_ZOOM = 0.3;
export const MAX_ZOOM = 4;
const MAX_FIT_ZOOM = 1.5;

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
/** The view that shows all the given points. A few points are not blown up to fill the screen. */
export function fitPoints(points: readonly Point[], width: number, height: number, padding = 70): View {
  if (points.length === 0) return { k: 1, x: width / 2, y: height / 2 };
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const [left, right, top, bottom] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const k = Math.max(MIN_ZOOM, Math.min(MAX_FIT_ZOOM, (width - 2 * padding) / Math.max(right - left, 1), (height - 2 * padding) / Math.max(bottom - top, 1)));
  return { k, x: width / 2 - ((left + right) / 2) * k, y: height / 2 - ((top + bottom) / 2) * k };
}

/** Where a screen position is on the map. */
export const toWorld = (view: View, x: number, y: number): Point => ({ x: (x - view.x) / view.k, y: (y - view.y) / view.k });

export function centerOn(view: View, point: Point, width: number, height: number): View {
  return { k: view.k, x: width / 2 - point.x * view.k, y: height / 2 - point.y * view.k };
}

export interface LabelInput {
  id: string;
  label: string;
  x: number;
  y: number;
  /** Radius of the node in world units, already scaled. */
  r: number;
  /** Selected and search-matched labels always show; the others only where there is room. */
  forced: boolean;
  priority: number;
}

export interface LabelPlacement {
  dx: number;
  dy: number;
  anchor: 'middle' | 'start' | 'end';
}

const CHAR_WIDTH = 7.4;
const LABEL_HEIGHT = 16;
const LABEL_GAP = 8;

type Box = { left: number; right: number; top: number; bottom: number };

/**
 * Picks a free side for each label: above, below, right or left of its node, avoiding other labels and
 * other nodes. Only the drawing changes: the document's analysis and the node positions stay the same.
 * Offsets are in world units; `scale` is how much a node and its label are enlarged on screen.
 */
export function placeLabels(items: readonly LabelInput[], scale = 1): Map<string, LabelPlacement> {
  const placed: Box[] = [];
  const result = new Map<string, LabelPlacement>();
  const hitsNode = (box: Box, own: string) =>
    items.some((node) => {
      if (node.id === own) return false;
      const nearestX = Math.max(box.left, Math.min(node.x, box.right));
      const nearestY = Math.max(box.top, Math.min(node.y, box.bottom));
      return (nearestX - node.x) ** 2 + (nearestY - node.y) ** 2 < node.r ** 2;
    });
  const hitsLabel = (box: Box) => placed.some((other) => box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top);

  const order = [...items].sort((a, b) => Number(b.forced) - Number(a.forced) || b.priority - a.priority);
  for (const item of order) {
    const width = item.label.length * CHAR_WIDTH * scale;
    const height = LABEL_HEIGHT * scale;
    const gap = item.r + LABEL_GAP * scale;
    const sides: (LabelPlacement & { box: Box })[] = [
      { dx: 0, dy: -gap, anchor: 'middle', box: { left: item.x - width / 2, right: item.x + width / 2, top: item.y - gap - height, bottom: item.y - gap } },
      { dx: 0, dy: gap + height * 0.8, anchor: 'middle', box: { left: item.x - width / 2, right: item.x + width / 2, top: item.y + gap, bottom: item.y + gap + height } },
      { dx: gap, dy: height * 0.3, anchor: 'start', box: { left: item.x + gap, right: item.x + gap + width, top: item.y - height / 2, bottom: item.y + height / 2 } },
      { dx: -gap, dy: height * 0.3, anchor: 'end', box: { left: item.x - gap - width, right: item.x - gap, top: item.y - height / 2, bottom: item.y + height / 2 } },
    ];
    const free = sides.find((side) => !hitsLabel(side.box) && !hitsNode(side.box, item.id));
    const chosen = free ?? (item.forced ? sides[0] : undefined);
    if (!chosen) continue;
    placed.push(chosen.box);
    result.set(item.id, { dx: chosen.dx, dy: chosen.dy, anchor: chosen.anchor });
  }
  return result;
}
