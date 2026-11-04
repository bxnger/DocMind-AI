import { createContext, useContext, useMemo, type ComponentPropsWithoutRef } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { EvidenceSource } from '@/types/chat';
import { CitationMarker } from './CitationMarker';

const CITE_PREFIX = '#cite-';

/** Only markers with a real source become links. Anything else stays as plain text. */
function linkMarkers(text: string, sources: EvidenceSource[]): string {
  const known = new Set(sources.map((source) => source.index));
  return text.replace(/\[(\d+)\]/g, (whole, digits: string) =>
    known.has(Number(digits)) ? `[${digits}](${CITE_PREFIX}${digits})` : whole,
  );
}

interface Props {
  text: string;
  sources: EvidenceSource[];
  activeMarker: number | null;
  selectedMarker: number | null;
  onActivate: (marker: number | null) => void;
  onOpenSource: (source: EvidenceSource) => void;
}

const CitationContext = createContext<Omit<Props, 'text'> | null>(null);

function MarkdownLink({ href, children }: ComponentPropsWithoutRef<'a'>) {
  const context = useContext(CitationContext);
  if (context && href?.startsWith(CITE_PREFIX)) {
    const marker = Number(href.slice(CITE_PREFIX.length));
    const source = context.sources.find((candidate) => candidate.index === marker);
    if (source) {
      return (
        <CitationMarker
          source={source}
          active={context.activeMarker === marker}
          selected={context.selectedMarker === marker}
          onActivate={context.onActivate}
          onOpen={() => context.onOpenSource(source)}
        />
      );
    }
  }
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className="text-accent-2 underline underline-offset-2">
      {children}
    </a>
  );
}

// Constant on purpose: a new component identity would remount a marker on hover and lose the click.
const COMPONENTS: Components = { a: ({ href, children }) => <MarkdownLink href={href}>{children}</MarkdownLink> };

export function AnswerMarkdown({ text, sources, activeMarker, selectedMarker, onActivate, onOpenSource }: Props) {
  const context = useMemo(
    () => ({ sources, activeMarker, selectedMarker, onActivate, onOpenSource }),
    [activeMarker, onActivate, onOpenSource, selectedMarker, sources],
  );
  return (
    <CitationContext.Provider value={context}>
      <div className="prose-answer">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
          {linkMarkers(text, sources)}
        </ReactMarkdown>
      </div>
    </CitationContext.Provider>
  );
}
