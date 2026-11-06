import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { AnimatePresence } from 'motion/react';
import { FileText, Maximize2, Minus, Network, Pin, Plus, RotateCcw, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { IconButton } from '@/components/ui/IconButton';
import { Skeleton } from '@/components/ui/Skeleton';
import { StateBlock } from '@/components/ui/StateBlock';
import { cn } from '@/lib/cn';
import type { DocumentText } from '@/services/chat/demo/textIndex';
import { buildTopicGraph, hubsOf, neighbours, searchTopics, visibleTopics, type Fragment, type TopicNode } from './buildGraph';
import { DOCUMENT_NODE, centerOn, fitPoints, placeLabels, toWorld, zoomAt, type Point, type View } from './layout';
import { MapMinimap } from './MapMinimap';
import { DocumentPanel, TopicPanel } from './MapPanel';
import { useMapLayout } from './useMapLayout';

const GROUP_FILL = ['fill-accent', 'fill-accent-2-line', 'fill-plum', 'fill-slate', 'fill-fg'];
const KEY_PAN = 40;
const KEY_MOVE = 24;
const MIN_NODE_ZOOM = 0.75;
/** Half of a comfortable finger target, in screen pixels. */
const TOUCH_RADIUS = 22;
/** Less movement than this between press and release is a click, not a drag. */
const DRAG_THRESHOLD = 4;
const DENSITIES = [15, 30, Infinity];
const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

interface Props {
  /** Undefined while the text is being read. */
  text: DocumentText | undefined;
  unavailable: 'other' | null;
  documentName: string;
  /** Gives a fragment's place in words. Without it, places are pages. */
  placeOf?: (fragment: Fragment) => string | null;
  onOpenFragment: (node: TopicNode, fragment: Fragment) => void;
}

export function KnowledgeMap({ text, unavailable, documentName, placeOf, onOpenFragment }: Props) {
  const { t } = useTranslation();
  if (unavailable) {
    return (
      <div className="flex h-full items-center justify-center overflow-y-auto">
        <StateBlock icon={<Network size={18} aria-hidden />} title={t('map.unavailableTitle')} description={t('map.unavailableOther')} />
      </div>
    );
  }
  if (!text) {
    return (
      <div role="status" aria-label={t('map.reading')} className="h-full p-6">
        <Skeleton className="h-full" />
      </div>
    );
  }
  return <MapCanvas text={text} documentName={documentName} placeOf={placeOf} onOpenFragment={onOpenFragment} />;
}

type Press =
  | { kind: 'pan'; x: number; y: number; view: View; moved: boolean }
  | { kind: 'node'; id: string; x: number; y: number; moved: boolean };

function MapCanvas({ text, documentName, placeOf, onOpenFragment }: Omit<Props, 'unavailable' | 'text'> & { text: DocumentText }) {
  const { t } = useTranslation();
  const graph = useMemo(() => buildTopicGraph(text), [text]);
  const hubs = useMemo(() => hubsOf(graph), [graph]);
  const layout = useMapLayout(graph, hubs);
  const { positions, pinned } = layout;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [density, setDensity] = useState(30);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [moved, setMoved] = useState<View | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const press = useRef<Press | null>(null);
  const justDragged = useRef(false);

  const selected = graph.nodes.find((node) => node.id === selectedId) ?? null;
  const related = useMemo(() => (selectedId ? neighbours(graph, selectedId) : []), [graph, selectedId]);
  const relatedIds = new Set(related.map((item) => item.node.id));
  const matches = useMemo(() => searchTopics(graph, query), [graph, query]);
  const matchIds = new Set(matches.map((node) => node.id));
  const searching = query.trim().length > 0;
  // What the user is looking at is always drawn, whatever the density.
  const shown = visibleTopics(graph, density, [...matchIds, ...relatedIds, ...(selectedId && selectedId !== DOCUMENT_NODE ? [selectedId] : [])]);
  const shownNodes = graph.nodes.filter((node) => shown.has(node.id));
  const shownEdges = graph.edges.filter((edge) => shown.has(edge.source) && shown.has(edge.target));
  const shownPoints = [...shownNodes.map((node) => positions.get(node.id)), positions.get(DOCUMENT_NODE)].filter((point): point is Point => Boolean(point));

  // The search row covers the top, so the map fits in what is left, and no node starts out under it.
  const topInset = (size.width || 1000) < 640 ? 112 : 44;
  const fitted = fitPoints(shownPoints, size.width || 1000, (size.height || 700) - topInset);
  const view = moved ?? { ...fitted, y: fitted.y + topInset };
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  });

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const observer = new ResizeObserver(() => setSize({ width: svg.clientWidth, height: svg.clientHeight }));
    observer.observe(svg);
    // React's wheel listener is passive, and a map must stop the page from scrolling.
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const box = svg.getBoundingClientRect();
      setMoved(zoomAt(viewRef.current, Math.exp(-event.deltaY * 0.0015), event.clientX - box.left, event.clientY - box.top));
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      observer.disconnect();
      svg.removeEventListener('wheel', onWheel);
    };
  }, [graph]);

  // By the real count, so that a topic mentioned three times does not look large just for being the most mentioned.
  const radius = (node: TopicNode) => 5 + Math.min(15, 2.4 * Math.sqrt(node.mentions));
  const narrow = size.width > 0 && size.width < 640;
  const labelled = new Set([...shownNodes].sort((a, b) => b.mentions - a.mentions).slice(0, view.k > 1.2 ? 50 : narrow ? 6 : 14).map((node) => node.id));
  // Fit-to-screen on a phone shrinks the world a lot. Nodes and labels keep a usable size on screen.
  const nodeScale = view.k < MIN_NODE_ZOOM ? MIN_NODE_ZOOM / view.k : 1;
  const hitRadius = (node: TopicNode) => Math.max(radius(node) + 7, TOUCH_RADIUS / (view.k * nodeScale));
  const focusId = hoverId ?? selectedId;
  const focusNear = useMemo(() => new Set(focusId ? neighbours(graph, focusId).map((item) => item.node.id) : []), [focusId, graph]);

  const labelPlaces = placeLabels(
    shownNodes.flatMap((node) => {
      const point = positions.get(node.id);
      if (!point) return [];
      const named = labelled.has(node.id) || node.id === focusId || focusNear.has(node.id) || matchIds.has(node.id);
      // Every node takes part, so no label lands on one. Unnamed nodes just have no text to place.
      return [{ id: node.id, label: named ? node.label : '', x: point.x, y: point.y, r: radius(node) * nodeScale, forced: node.id === focusId || matchIds.has(node.id), priority: node.mentions + (focusNear.has(node.id) ? 1000 : 0) }];
    }),
    nodeScale,
  );

  const center = (point: Point) => {
    if (size.width) setMoved(centerOn(view, point, size.width, narrow ? size.height * 0.45 : size.height));
  };
  const select = (node: TopicNode) => {
    setSelectedId(node.id);
    const point = positions.get(node.id);
    if (point) center(point);
  };
  const selectDocument = () => setSelectedId(DOCUMENT_NODE);
  const zoomButton = (factor: number) => setMoved(zoomAt(view, factor, size.width / 2, size.height / 2));
  const onReset = () => {
    layout.reset();
    setMoved(null);
  };

  const localPoint = (event: PointerEvent) => {
    const box = event.currentTarget.getBoundingClientRect();
    return toWorld(view, event.clientX - box.left, event.clientY - box.top);
  };
  const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    justDragged.current = false;
    const nodeId = event.target instanceof Element ? event.target.closest<SVGGElement>('[data-node]')?.dataset.node : undefined;
    press.current = nodeId && nodeId !== DOCUMENT_NODE
      ? { kind: 'node', id: nodeId, x: event.clientX, y: event.clientY, moved: false }
      : { kind: 'pan', x: event.clientX, y: event.clientY, view, moved: false };
  };
  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const start = press.current;
    if (!start) return;
    if (!start.moved) {
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) < DRAG_THRESHOLD) return;
      // Captured only now: a capture from the first touch would take the click away from the node,
      // and selecting on release instead lets that click land on the panel which has just opened under the finger.
      start.moved = true;
      justDragged.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    if (start.kind === 'pan') {
      setMoved({ ...start.view, x: start.view.x + event.clientX - start.x, y: start.view.y + event.clientY - start.y });
      return;
    }
    // The view stops following its fit once a node is placed by hand, so the map does not shift under the pointer.
    setMoved(view);
    layout.moveNode(start.id, localPoint(event));
  };
  const onPointerUp = () => {
    const start = press.current;
    press.current = null;
    if (start?.kind === 'node' && start.moved) layout.dropNode(start.id);
  };
  /** A drag also ends in a click, which must not count as choosing. */
  const unlessDragged = (action: () => void) => () => {
    if (justDragged.current) justDragged.current = false;
    else action();
  };
  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    const delta = ARROWS[event.key];
    if (delta) {
      event.preventDefault();
      setMoved({ ...view, x: view.x - delta[0] * KEY_PAN, y: view.y - delta[1] * KEY_PAN });
    } else if (event.key === '+' || event.key === '=') zoomButton(1.25);
    else if (event.key === '-') zoomButton(0.8);
    else if (event.key === 'Escape') setSelectedId(null);
  };
  /** The keyboard's way to do what a drag does: arrows place the node, P pins it. */
  const onNodeKey = (event: KeyboardEvent<SVGGElement>, node: TopicNode) => {
    const delta = ARROWS[event.key];
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      select(node);
    } else if (delta) {
      event.preventDefault();
      event.stopPropagation();
      const point = positions.get(node.id);
      if (point) {
        setMoved(view);
        layout.moveNode(node.id, { x: point.x + delta[0] * KEY_MOVE, y: point.y + delta[1] * KEY_MOVE });
        if (!pinned.has(node.id)) layout.togglePin(node.id);
      }
    } else if (event.key.toLowerCase() === 'p') {
      event.stopPropagation();
      layout.togglePin(node.id);
    }
  };

  if (graph.nodes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center overflow-y-auto">
        <StateBlock icon={<Network size={18} aria-hidden />} title={t('map.emptyTitle')} description={t('map.emptyBody')} />
      </div>
    );
  }

  const root = positions.get(DOCUMENT_NODE);
  const dimmed = (id: string) => (searching ? !matchIds.has(id) : Boolean(focusId) && focusId !== DOCUMENT_NODE && id !== focusId && !focusNear.has(id));
  const densities = DENSITIES.filter((_value, index) => index === 0 || (DENSITIES[index - 1] ?? 0) < graph.nodes.length);
  const hasMore = graph.nodes.length > shownNodes.length;

  return (
    <div data-testid="knowledge-map" className="relative h-full overflow-hidden bg-bg">
      <svg
        ref={svgRef}
        role="group"
        aria-label={t('map.canvas')}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (press.current = null)}
        onKeyDown={onKeyDown}
        className="h-full w-full cursor-grab touch-none outline-offset-[-2px] active:cursor-grabbing"
      >
        <g data-testid="map-world" transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {root && hubs.filter((hub) => shown.has(hub)).map((hub) => {
            const point = positions.get(hub);
            return point ? <line key={`root-${hub}`} data-root-link x1={root.x} y1={root.y} x2={point.x} y2={point.y} vectorEffect="non-scaling-stroke" strokeWidth={1} strokeDasharray="3 4" className={cn('stroke-line-strong transition-opacity duration-150', focusId && focusId !== DOCUMENT_NODE ? 'opacity-15' : 'opacity-70')} /> : null;
          })}
          {shownEdges.map((edge) => {
            const a = positions.get(edge.source);
            const b = positions.get(edge.target);
            if (!a || !b) return null;
            const lit = edge.source === focusId || edge.target === focusId;
            const dim = (focusId && focusId !== DOCUMENT_NODE && !lit) || (searching && !(matchIds.has(edge.source) || matchIds.has(edge.target)));
            return (
              <line
                key={`${edge.source}|${edge.target}`}
                data-edge
                x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                vectorEffect="non-scaling-stroke"
                strokeWidth={lit ? 1.75 : 0.75 + Math.min(edge.weight, 4) * 0.2}
                className={cn('transition-opacity duration-150', lit ? 'stroke-accent' : 'stroke-line-strong', dim ? 'opacity-15' : lit ? 'opacity-100' : 'opacity-60')}
              />
            );
          })}
          {shownNodes.map((node) => {
            const point = positions.get(node.id);
            if (!point) return null;
            const isSelected = node.id === selectedId;
            const near = focusNear.has(node.id);
            const place = labelPlaces.get(node.id);
            const match = matchIds.has(node.id);
            const isPinned = pinned.has(node.id);
            const r = radius(node);
            return (
              <g
                key={node.id}
                data-node={node.id}
                data-pinned={isPinned || undefined}
                role="button"
                tabIndex={0}
                aria-pressed={isSelected}
                aria-label={t(isPinned ? 'map.nodeLabelPinned' : 'map.nodeLabel', { label: node.label, count: node.mentions })}
                transform={`translate(${point.x} ${point.y}) scale(${nodeScale})`}
                onPointerEnter={() => setHoverId(node.id)}
                onPointerLeave={() => setHoverId(null)}
                onClick={unlessDragged(() => select(node))}
                onKeyDown={(event) => onNodeKey(event, node)}
                className={cn('group cursor-pointer outline-none transition-opacity duration-150', dimmed(node.id) ? 'opacity-25' : 'opacity-100')}
              >
                <circle r={hitRadius(node)} fill="transparent" />
                <circle r={r + 5} className={cn(GROUP_FILL[node.group], 'opacity-0 transition-opacity duration-150 group-hover:opacity-25 group-focus-visible:opacity-40', (isSelected || near) && 'opacity-20')} />
                {(isSelected || match) && <circle r={r + 4} fill="none" strokeWidth={2} className={match && !isSelected ? 'stroke-accent-2' : 'stroke-fg'} />}
                <circle r={r} className={GROUP_FILL[node.group]} />
                {isPinned && <circle data-pin-mark cx={r * 0.72} cy={-r * 0.72} r={3.5} strokeWidth={1.5} className="fill-fg stroke-bg" />}
                {(labelled.has(node.id) || node.id === focusId || near || match) && place && (
                  <text x={place.dx / nodeScale} y={place.dy / nodeScale} textAnchor={place.anchor} className={cn('pointer-events-none text-[13px] font-medium', isSelected || node.id === hoverId ? 'fill-fg' : 'fill-muted')} style={{ paintOrder: 'stroke', stroke: 'var(--color-bg)', strokeWidth: 3 }}>
                    {node.label}
                  </text>
                )}
              </g>
            );
          })}
          {root && (
            <g
              data-node={DOCUMENT_NODE}
              role="button"
              tabIndex={0}
              aria-label={t('map.documentNode', { name: documentName })}
              aria-pressed={selectedId === DOCUMENT_NODE}
              transform={`translate(${root.x} ${root.y}) scale(${nodeScale})`}
              onClick={unlessDragged(selectDocument)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  event.stopPropagation();
                  selectDocument();
                }
              }}
              className="cursor-pointer outline-none"
            >
              <rect x={-17} y={-17} width={34} height={34} rx={9} strokeWidth={selectedId === DOCUMENT_NODE ? 2.5 : 1.5} className="fill-card stroke-accent" />
              <FileText x={-9} y={-9} width={18} height={18} className="pointer-events-none text-accent" aria-hidden />
            </g>
          )}
        </g>
      </svg>

      <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-wrap items-center gap-2">
        <label className="pointer-events-auto flex h-9 w-full max-w-64 items-center gap-2 rounded-control border border-line bg-card px-3 focus-within:border-accent">
          <Search size={14} className="shrink-0 text-muted" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              const first = matches[0];
              if (event.key === 'Enter' && first) select(first);
            }}
            aria-label={t('map.search')}
            placeholder={t('map.search')}
            className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
          />
        </label>
        <p aria-live="polite" data-testid="map-counts" className={cn('tabular rounded-control border border-line bg-card px-3 py-1.5 text-xs text-muted', selected && 'max-sm:hidden')}>
          {searching ? t('map.matches', { count: matches.length }) : hasMore ? t('map.countsShown', { shown: shownNodes.length, nodes: graph.nodes.length, links: shownEdges.length }) : t('map.counts', { nodes: graph.nodes.length, links: graph.edges.length })}
        </p>
        {densities.length > 1 && (
          <div role="group" aria-label={t('map.density')} className={cn('pointer-events-auto inline-flex rounded-control border border-line bg-card p-0.5', selected && 'max-sm:hidden')}>
            {densities.map((value) => (
              <button key={value} type="button" aria-pressed={density === value || (value === Infinity && density >= graph.nodes.length)} onClick={() => setDensity(value)} className={cn('pressable tabular h-7 min-w-8 rounded-lg px-2 text-xs font-medium pointer-coarse:h-9', density === value ? 'bg-accent-tint text-fg' : 'text-muted hover:text-fg')}>
                {value === Infinity ? t('map.densityAll') : value}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className={cn('absolute bottom-3 left-3 flex flex-col items-start gap-2', selected && 'max-sm:hidden', selectedId === DOCUMENT_NODE && 'max-sm:hidden')}>
        <div className="max-md:hidden"><MapMinimap points={shownPoints} view={view} size={size} onCenter={(point) => setMoved(centerOn(view, point, size.width, size.height))} /></div>
        <div role="toolbar" aria-label={t('map.controls')} className="flex w-fit rounded-control border border-line bg-card p-0.5">
          <IconButton dense label={t('viewer.zoomOut')} icon={<Minus size={16} aria-hidden />} onClick={() => zoomButton(0.8)} />
          <IconButton dense label={t('viewer.zoomIn')} icon={<Plus size={16} aria-hidden />} onClick={() => zoomButton(1.25)} />
          <IconButton dense label={t('map.fit')} icon={<Maximize2 size={15} aria-hidden />} onClick={() => setMoved(null)} />
          <IconButton dense label={t('map.resetLayout')} disabled={!layout.moved} icon={<RotateCcw size={15} aria-hidden />} onClick={onReset} />
        </div>
        {pinned.size > 0 && (
          <p data-testid="map-pinned" className="tabular inline-flex w-fit items-center gap-1 rounded-control border border-line bg-card px-2 py-1 text-xs text-muted">
            <Pin size={11} aria-hidden />
            {t('map.pinnedCount', { count: pinned.size })}
          </p>
        )}
        <p className="w-fit rounded-control border border-line bg-card px-2 py-1 text-xs font-medium sm:hidden">{t('map.noticeShort')}</p>
        <p data-testid="map-notice" className="max-w-72 rounded-control border border-line bg-card px-3 py-1.5 text-xs text-muted max-sm:hidden [@media(max-height:800px)]:hidden">
          <strong className="font-medium text-fg">{t('map.noticeTitle')}</strong> {t('map.noticeBody')}
        </p>
      </div>

      <AnimatePresence>
        {selected && (
          <TopicPanel
            key="topic"
            node={selected}
            related={related}
            pinned={pinned.has(selected.id)}
            usesPages={!placeOf}
            placeOf={(fragment) => placeOf?.(fragment) ?? t('sources.page', { page: fragment.page })}
            onPin={() => layout.togglePin(selected.id)}
            onClose={() => setSelectedId(null)}
            onSelect={select}
            onOpenFragment={(fragment) => onOpenFragment(selected, fragment)}
          />
        )}
        {selectedId === DOCUMENT_NODE && (
          <DocumentPanel
            key="document"
            name={documentName}
            total={graph.nodes.length}
            links={graph.edges.length}
            topics={[...graph.nodes].sort((a, b) => b.mentions - a.mentions).slice(0, 10)}
            onClose={() => setSelectedId(null)}
            onSelect={select}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
