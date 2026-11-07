import { useEffect, useRef } from 'react';
import { CircleAlert, FileText, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TextBlock } from '@/api/documents';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { StateBlock } from '@/components/ui/StateBlock';
import { useDocumentBlocks } from '@/features/documents/useDocumentContent';
import { useErrorMessage } from '@/features/system/useErrorMessage';
import { cn } from '@/lib/cn';
import type { DocumentModel } from '@/types/document';
import { markParts, quoteParts, type QuoteMark } from './quoteParts';

export interface DocxTarget {
  /** Block `index` from GET /documents/{id}/text. */
  paragraph: number;
  quote: string;
  /** Changes on every pick, so opening the same source again moves the reader again. */
  nonce: number;
}

interface Props {
  doc: DocumentModel;
  target: DocxTarget | null;
  /** A floating panel covers the lower part, so the end of the text needs room to move clear of it. */
  roomForInspector: boolean;
  /** Changes to mark, for a comparison. Only text really found in a block is marked. */
  marks?: readonly QuoteMark[];
}

function BlockText({ block, quote, marks }: { block: TextBlock; quote: string | null; marks: readonly QuoteMark[] }) {
  const parts = quote === null ? null : quoteParts(block.text, quote);
  const others = markParts(block.text, marks);
  if (!parts) return others.map((part, index) => (part.className ? <mark key={index} className={part.className}>{part.text}</mark> : part.text));
  return (
    <>
      {parts[0]}
      <mark data-testid="docx-quote" className="docx-quote">{parts[1]}</mark>
      {parts[2]}
    </>
  );
}

const NO_MARKS: readonly QuoteMark[] = [];

const BLOCK_STYLE: Record<TextBlock['kind'], string> = {
  heading: 'mt-7 first:mt-0 font-display text-lg leading-7 font-semibold',
  paragraph: 'mt-3 text-[15px] leading-[25px]',
  table_row: 'border-b border-line py-1.5 text-sm leading-[22px] tabular',
  page: 'mt-3 text-[15px] leading-[25px]',
};

/** A reader of the extracted text. It shows what the server returned: no pages, and no PDF coordinates. */
export function DocxReader({ doc, target, roomForInspector, marks = NO_MARKS }: Props) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const query = useDocumentBlocks(doc.id, true);
  const scroller = useRef<HTMLDivElement>(null);
  const blocks = query.data;

  useEffect(() => {
    if (!target || !blocks) return;
    const element = scroller.current?.querySelector(`[data-block="${target.paragraph}"]`);
    element?.scrollIntoView({ block: 'start' });
  }, [target?.nonce, target?.paragraph, blocks]); // eslint-disable-line react-hooks/exhaustive-deps

  if (query.isPending) {
    return (
      <div role="status" aria-label={t('docx.loading')} className="mx-auto w-full max-w-2xl space-y-3 p-6">
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
      </div>
    );
  }
  if (query.isError) {
    return (
      <div className="flex h-full items-center justify-center overflow-y-auto">
        <StateBlock
          tone="danger"
          icon={<CircleAlert size={18} aria-hidden />}
          title={t('docx.errorTitle')}
          description={errorMessage(query.error)}
          actions={<Button icon={<RotateCcw size={14} aria-hidden />} loading={query.isFetching} onClick={() => void query.refetch()}>{t('common.retry')}</Button>}
        />
      </div>
    );
  }
  if (!blocks?.length) {
    return (
      <div className="flex h-full items-center justify-center overflow-y-auto">
        <StateBlock icon={<FileText size={18} aria-hidden />} title={t('docx.emptyTitle')} />
      </div>
    );
  }

  return (
    <div ref={scroller} data-testid="docx-reader" tabIndex={0} aria-label={t('docx.label')} className="h-full overflow-y-auto outline-offset-[-2px]">
      <article lang={doc.language && doc.language !== 'mixed' ? doc.language : undefined} className="mx-auto w-full max-w-2xl break-words [overflow-wrap:anywhere] px-4 py-5 sm:px-6">
        <p lang={undefined} className="mb-5 border-b border-line pb-3 text-xs text-muted">{t('docx.note')}</p>
        {blocks.map((block) => {
          const active = target?.paragraph === block.index;
          const Tag = block.kind === 'heading' ? 'h2' : 'p';
          return (
            <Tag
              key={block.index}
              data-block={block.index}
              data-kind={block.kind}
              data-active={active || undefined}
              className={cn(BLOCK_STYLE[block.kind], 'scroll-mt-4', active && 'rounded-sm shadow-[-10px_0_0_var(--color-bg),-12px_0_0_var(--color-accent-2-line)]')}
            >
              <BlockText block={block} quote={active && target ? target.quote : null} marks={marks} />
            </Tag>
          );
        })}
        {roomForInspector && <div data-testid="inspector-room" aria-hidden className="h-[55vh]" />}
      </article>
    </div>
  );
}
