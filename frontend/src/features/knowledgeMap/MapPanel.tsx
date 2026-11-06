import { CornerDownRight, FileText, Pin, PinOff, X } from 'lucide-react';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { IconButton } from '@/components/ui/IconButton';
import { cn } from '@/lib/cn';
import type { Fragment, TopicNode } from './buildGraph';

export const GROUP_BG = ['bg-accent', 'bg-accent-2-line', 'bg-plum', 'bg-slate', 'bg-fg'];

const PANEL = 'absolute top-3 right-3 bottom-3 z-10 flex w-[300px] flex-col rounded-panel border border-line bg-card shadow-float max-sm:inset-x-2 max-sm:top-auto max-sm:bottom-2 max-sm:h-[55%] max-sm:w-auto';

function Shell({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <motion.aside
      key="panel"
      aria-label={t('map.panel')}
      data-testid="map-panel"
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 8, transition: { duration: 0.12 } }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      className={PANEL}
    >
      {children}
    </motion.aside>
  );
}

function RelatedList({ title, items, onSelect }: { title: string; items: Array<{ node: TopicNode; note: string }>; onSelect: (node: TopicNode) => void }) {
  return (
    <section>
      <h3 className="micro-label mb-2">{title}</h3>
      <ul className="space-y-1">
        {items.map(({ node, note }) => (
          <li key={node.id}>
            <button type="button" onClick={() => onSelect(node)} className="pressable flex min-h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-sm hover:bg-hover pointer-coarse:min-h-10">
              <CornerDownRight size={12} className="shrink-0 text-muted" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{node.label}</span>
              <span className="tabular shrink-0 text-xs text-muted">{note}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

interface TopicProps {
  node: TopicNode;
  related: Array<{ node: TopicNode; weight: number }>;
  pinned: boolean;
  /** Label of where a fragment is. A DOCX has sections, not pages. */
  placeOf: (fragment: Fragment) => string;
  usesPages: boolean;
  onPin: () => void;
  onClose: () => void;
  onSelect: (node: TopicNode) => void;
  onOpenFragment: (fragment: Fragment) => void;
}

export function TopicPanel({ node, related, pinned, placeOf, usesPages, onPin, onClose, onSelect, onOpenFragment }: TopicProps) {
  const { t } = useTranslation();
  return (
    <Shell>
      <header className="flex items-start gap-2 border-b border-line p-3">
        <span className={cn('mt-1.5 size-2.5 shrink-0 rounded-full', GROUP_BG[node.group])} aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold break-words">{node.label}</h2>
          <p className="tabular text-xs text-muted">{usesPages ? t('map.stats', { count: node.mentions, pages: node.pages.length }) : t('map.statsText', { count: node.mentions })}</p>
        </div>
        <IconButton dense label={t(pinned ? 'map.unpin' : 'map.pin')} aria-pressed={pinned} icon={pinned ? <PinOff size={15} aria-hidden /> : <Pin size={15} aria-hidden />} onClick={onPin} />
        <IconButton dense label={t('map.closePanel')} icon={<X size={16} aria-hidden />} onClick={onClose} />
      </header>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
        <section>
          <h3 className="micro-label mb-2 text-accent-2">{t('map.fragments')}</h3>
          <ul className="space-y-2">
            {node.fragments.map((fragment) => (
              <li key={`${fragment.page}-${fragment.quote}`}>
                <button
                  type="button"
                  onClick={() => onOpenFragment(fragment)}
                  aria-label={t('map.openFragmentAt', { place: placeOf(fragment) })}
                  className="pressable w-full rounded-control border border-line bg-sidebar p-2 text-left hover:border-accent-2-line"
                >
                  <span className="tabular mb-1 flex items-center gap-1 text-xs font-medium text-fg">
                    <FileText size={12} className="shrink-0 text-muted" aria-hidden />
                    <span className="min-w-0 truncate">{placeOf(fragment)}</span>
                  </span>
                  <span className="line-clamp-3 border-l-2 border-accent-2 pl-2 font-quote text-[14px] leading-[21px] break-words text-fg/90">{fragment.quote}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
        {related.length > 0 && <RelatedList title={t('map.related')} items={related.map(({ node: other, weight }) => ({ node: other, note: t('map.together', { count: weight }) }))} onSelect={onSelect} />}
      </div>
    </Shell>
  );
}

interface DocumentProps {
  name: string;
  topics: TopicNode[];
  total: number;
  links: number;
  onClose: () => void;
  onSelect: (node: TopicNode) => void;
}

/** The document's own node: what the map says about the whole, from the same real counts. */
export function DocumentPanel({ name, topics, total, links, onClose, onSelect }: DocumentProps) {
  const { t } = useTranslation();
  return (
    <Shell>
      <header className="flex items-start gap-2 border-b border-line p-3">
        <FileText size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold break-words [overflow-wrap:anywhere]">{name}</h2>
          <p className="tabular text-xs text-muted">{t('map.counts', { nodes: total, links })}</p>
        </div>
        <IconButton dense label={t('map.closePanel')} icon={<X size={16} aria-hidden />} onClick={onClose} />
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <RelatedList title={t('map.mainTopics')} items={topics.map((node) => ({ node, note: `${node.mentions}×` }))} onSelect={onSelect} />
      </div>
    </Shell>
  );
}
