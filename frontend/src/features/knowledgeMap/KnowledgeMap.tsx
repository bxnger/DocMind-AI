import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CornerDownRight, FileText, Maximize2, Minus, Network, Plus, Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { IconButton } from '@/components/ui/IconButton';
import { Skeleton } from '@/components/ui/Skeleton';
import { StateBlock } from '@/components/ui/StateBlock';
import { cn } from '@/lib/cn';
import type { DocumentText } from '@/services/chat/demo/textIndex';
import { buildTopicGraph, neighbours, searchTopics, type Fragment, type TopicNode } from './buildGraph';
import { centerOn, fitView, layoutGraph, zoomAt, type View } from './layout';

const GROUP_FILL = ['fill-accent', 'fill-accent-2-line', 'fill-plum', 'fill-slate', 'fill-fg'];
const GROUP_BG = ['bg-accent', 'bg-accent-2-line', 'bg-plum', 'bg-slate', 'bg-fg'];
const KEY_PAN = 40;

interface Props {
  /** Undefined while the text is being read. */
  text: DocumentText | undefined;
  unavailable: 'docx' | 'other' | null;
  onOpenFragment: (node: TopicNode, fragment: Fragment) => void;
}

export function KnowledgeMap({ text, unavailable, onOpenFragment }: Props) {
  const { t } = useTranslation();
  if (unavailable) {
    return (
      <div className="flex h-full items-center justify-center overflow-y-auto">
        <StateBlock icon={<Network size={18} aria-hidden />} title={t('map.unavailableTitle')} description={t(unavailable === 'docx' ? 'map.unavailableDocx' : 'map.unavailableOther')} />
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
  return <MapCanvas text={text} onOpenFragment={onOpenFragment} />;
}

function MapCanvas({ text, onOpenFragment }: { text: DocumentText; onOpenFragment: Props['onOpenFragment'] }) {
  const { t } = useTranslation();
  const graph = useMemo(() => buildTopicGraph(text), [text]);
  const positions = useMemo(() => layoutGraph(graph), [graph]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [moved, setMoved] = useState<View | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; view: View } | null>(null);

  const view = moved ?? fitView(size.width || 1000, size.height || 700);
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

  const selected = graph.nodes.find((node) => node.id === selectedId) ?? null;
  const related = useMemo(() => (selectedId ? neighbours(graph, selectedId) : []), [graph, selectedId]);
  const relatedIds = new Set(related.map((item) => item.node.id));
  const matches = useMemo(() => searchTopics(graph, query), [graph, query]);
  const matchIds = new Set(matches.map((node) => node.id));
  const searching = query.trim().length > 0;
  const maxMentions = Math.max(1, ...graph.nodes.map((node) => node.mentions));
  const radius = (node: TopicNode) => 7 + 15 * Math.sqrt(node.mentions / maxMentions);
  const labelled = new Set([...graph.nodes].sort((a, b) => b.mentions - a.mentions).slice(0, view.k > 1.2 ? 30 : 12).map((node) => node.id));

  const select = (node: TopicNode) => {
    setSelectedId(node.id);
    const point = positions.get(node.id);
    if (point && size.width) setMoved(centerOn(view, point, size.width, size.height));
  };
  const zoomButton = (factor: number) => setMoved(zoomAt(view, factor, size.width / 2, size.height / 2));

  const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (event.target instanceof Element && event.target.closest('[data-node]')) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, view };
  };
  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const start = drag.current;
    if (start) setMoved({ ...start.view, x: start.view.x + event.clientX - start.x, y: start.view.y + event.clientY - start.y });
  };
  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    const pan: Record<string, [number, number]> = { ArrowLeft: [KEY_PAN, 0], ArrowRight: [-KEY_PAN, 0], ArrowUp: [0, KEY_PAN], ArrowDown: [0, -KEY_PAN] };
    const delta = pan[event.key];
    if (delta) {
      event.preventDefault();
      setMoved({ ...view, x: view.x + delta[0], y: view.y + delta[1] });
    } else if (event.key === '+' || event.key === '=') zoomButton(1.25);
    else if (event.key === '-') zoomButton(0.8);
    else if (event.key === 'Escape') setSelectedId(null);
  };

  if (graph.nodes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center overflow-y-auto">
        <StateBlock icon={<Network size={18} aria-hidden />} title={t('map.emptyTitle')} description={t('map.emptyBody')} />
      </div>
    );
  }

  return (
    <div data-testid="knowledge-map" className="relative h-full overflow-hidden bg-bg">
      <svg
        ref={svgRef}
        role="group"
        aria-label={t('map.canvas')}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        onKeyDown={onKeyDown}
        className="h-full w-full cursor-grab touch-none outline-offset-[-2px] active:cursor-grabbing"
      >
        <g data-testid="map-world" transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {graph.edges.map((edge) => {
            const a = positions.get(edge.source);
            const b = positions.get(edge.target);
            if (!a || !b) return null;
            const lit = edge.source === selectedId || edge.target === selectedId;
            const dim = (selectedId && !lit) || (searching && !(matchIds.has(edge.source) || matchIds.has(edge.target)));
            return (
              <line
                key={`${edge.source}|${edge.target}`}
                x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                vectorEffect="non-scaling-stroke"
                strokeWidth={lit ? 2 : 1 + Math.min(edge.weight, 3) * 0.25}
                className={cn('transition-opacity duration-150', lit ? 'stroke-accent' : 'stroke-line-strong', dim ? 'opacity-20' : 'opacity-100')}
              />
            );
          })}
          {graph.nodes.map((node) => {
            const point = positions.get(node.id);
            if (!point) return null;
            const isSelected = node.id === selectedId;
            const near = relatedIds.has(node.id);
            const match = matchIds.has(node.id);
            const dim = searching ? !match : Boolean(selectedId) && !isSelected && !near;
            const r = radius(node);
            return (
              <g
                key={node.id}
                data-node={node.id}
                role="button"
                tabIndex={0}
                aria-pressed={isSelected}
                aria-label={t('map.nodeLabel', { label: node.label, count: node.mentions })}
                transform={`translate(${point.x} ${point.y})`}
                onClick={() => select(node)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    event.stopPropagation();
                    select(node);
                  }
                }}
                className={cn('group cursor-pointer outline-none transition-opacity duration-150', dim ? 'opacity-25' : 'opacity-100')}
              >
                <circle r={r + 7} className={cn(GROUP_FILL[node.group], 'opacity-15 transition-opacity duration-150 group-hover:opacity-40 group-focus-visible:opacity-60')} />
                {(isSelected || match) && <circle r={r + 5} fill="none" strokeWidth={2} className={match && !isSelected ? 'stroke-accent-2' : 'stroke-fg'} />}
                <circle r={r} className={GROUP_FILL[node.group]} />
                {(labelled.has(node.id) || isSelected || near || match) && (
                  <text y={-r - 9} textAnchor="middle" className={cn('pointer-events-none text-[13px] font-medium', isSelected ? 'fill-fg' : 'fill-muted')} style={{ paintOrder: 'stroke', stroke: 'var(--color-bg)', strokeWidth: 3 }}>
                    {node.label}
                  </text>
                )}
              </g>
            );
          })}
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
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
          />
        </label>
        <p aria-live="polite" className="tabular rounded-control border border-line bg-card px-3 py-1.5 text-xs text-muted">
          {searching ? t('map.matches', { count: matches.length }) : t('map.counts', { nodes: graph.nodes.length, links: graph.edges.length })}
        </p>
      </div>

      <div className="absolute bottom-3 left-3 flex flex-col gap-2">
        <div role="toolbar" aria-label={t('map.controls')} className="flex w-fit rounded-control border border-line bg-card p-0.5">
          <IconButton dense label={t('viewer.zoomOut')} icon={<Minus size={16} aria-hidden />} onClick={() => zoomButton(0.8)} />
          <IconButton dense label={t('viewer.zoomIn')} icon={<Plus size={16} aria-hidden />} onClick={() => zoomButton(1.25)} />
          <IconButton dense label={t('map.fit')} icon={<Maximize2 size={15} aria-hidden />} onClick={() => setMoved(null)} />
        </div>
        <p data-testid="map-notice" className="max-w-72 rounded-control border border-line bg-card px-3 py-1.5 text-xs text-muted max-sm:hidden">
          <strong className="font-medium text-fg">{t('map.noticeTitle')}</strong> {t('map.noticeBody')}
        </p>
      </div>

      <AnimatePresence>
        {selected && (
          <motion.aside
            key="panel"
            aria-label={t('map.panel')}
            data-testid="map-panel"
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 8, transition: { duration: 0.12 } }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="absolute top-3 right-3 bottom-3 flex w-[300px] flex-col rounded-panel border border-line bg-card shadow-float max-sm:inset-x-2 max-sm:top-auto max-sm:bottom-2 max-sm:max-h-[55%] max-sm:w-auto"
          >
            <header className="flex items-start gap-2 border-b border-line p-3">
              <span className={cn('mt-1.5 size-2.5 shrink-0 rounded-full', GROUP_BG[selected.group])} aria-hidden />
              <div className="min-w-0 flex-1">
                <h2 className="font-semibold break-words">{selected.label}</h2>
                <p className="tabular text-xs text-muted">{t('map.stats', { count: selected.mentions, pages: selected.pages.length })}</p>
              </div>
              <IconButton dense label={t('map.closePanel')} icon={<X size={16} aria-hidden />} onClick={() => setSelectedId(null)} />
            </header>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
              <section>
                <h3 className="micro-label mb-2 text-accent-2">{t('map.fragments')}</h3>
                <ul className="space-y-2">
                  {selected.fragments.map((fragment) => (
                    <li key={`${fragment.page}-${fragment.quote}`}>
                      <button
                        type="button"
                        onClick={() => onOpenFragment(selected, fragment)}
                        aria-label={t('map.openFragment', { page: fragment.page })}
                        className="pressable w-full rounded-control border border-line bg-sidebar p-2 text-left hover:border-accent-2-line"
                      >
                        <span className="tabular mb-1 flex items-center gap-1 text-xs font-medium text-fg">
                          <FileText size={12} className="text-muted" aria-hidden />
                          {t('sources.page', { page: fragment.page })}
                        </span>
                        <span className="line-clamp-3 border-l-2 border-accent-2 pl-2 font-quote text-[14px] leading-[21px] break-words text-fg/90">{fragment.quote}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
              {related.length > 0 && (
                <section>
                  <h3 className="micro-label mb-2">{t('map.related')}</h3>
                  <ul className="space-y-1">
                    {related.map(({ node, weight }) => (
                      <li key={node.id}>
                        <button type="button" onClick={() => select(node)} className="pressable flex min-h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-sm hover:bg-hover">
                          <CornerDownRight size={12} className="shrink-0 text-muted" aria-hidden />
                          <span className="min-w-0 flex-1 truncate">{node.label}</span>
                          <span className="tabular shrink-0 text-xs text-muted">{t('map.together', { count: weight })}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  );
}
