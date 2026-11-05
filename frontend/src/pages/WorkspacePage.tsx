import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, FileQuestion, HardDrive, RotateCcw, Trash2 } from 'lucide-react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { AnimatePresence } from 'motion/react';
import { AppError, isRecord } from '@/api/client';
import { Button, buttonClasses } from '@/components/ui/Button';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { IconButton } from '@/components/ui/IconButton';
import { Skeleton } from '@/components/ui/Skeleton';
import { StateBlock } from '@/components/ui/StateBlock';
import { AssistantPanel } from '@/features/chat/AssistantPanel';
import { useChat } from '@/features/chat/useChat';
import { DeleteDocumentDialog } from '@/features/documents/DeleteDocumentDialog';
import { StatusBadge } from '@/features/documents/StatusBadge';
import { isStaleProcessing, useDocument } from '@/features/documents/useDocuments';
import { useErrorMessage } from '@/features/system/useErrorMessage';
import { EvidenceProvider, type EvidenceApi } from '@/features/evidence/EvidenceContext';
import { EvidenceInspector } from '@/features/evidence/EvidenceInspector';
import { sourceJump } from '@/features/evidence/evidenceState';
import { evidenceStatus, type ViewerAvailability } from '@/features/evidence/status';
import { useEvidence } from '@/features/evidence/useEvidence';
import type { Fragment, TopicNode } from '@/features/knowledgeMap/buildGraph';
import { KnowledgeMap } from '@/features/knowledgeMap/KnowledgeMap';
import { locateEvidence } from '@/features/viewer/lib/locate';
import type { JumpRequest } from '@/features/viewer/PdfViewer';
import { usePdfDocument, type PdfInput } from '@/features/viewer/usePdfDocument';
import { ResizeHandle } from '@/features/workspace/ResizeHandle';
import { useAssistant } from '@/features/workspace/useAssistant';
import { useDocumentSource } from '@/features/workspace/useDocumentSource';
import { ViewerPane } from '@/features/workspace/ViewerPane';
import { SPLIT_PANE_QUERY, useMediaQuery } from '@/hooks/useMediaQuery';
import { usePersistentState } from '@/hooks/usePersistentState';
import { cn } from '@/lib/cn';
import { formatBytes } from '@/lib/format';
import { markOpened } from '@/services/recents';
import { isSampleDocument } from '@/services/sampleDocument';
import type { AssistantMessage, ChatMode } from '@/types/chat';
import type { DocumentModel } from '@/types/document';

const DEFAULT_CHAT_WIDTH = 420;
const MIN_CHAT_WIDTH = 340;
const MAX_CHAT_WIDTH = 640;

type Pane = 'document' | 'assistant';

/** A topic's fragments in the shape Evidence Jump reads. It has no answer text and never enters the chat. */
function fragmentMessage(node: TopicNode, doc: DocumentModel): AssistantMessage {
  return {
    id: `map:${node.id}`,
    role: 'assistant',
    question: node.label,
    mode: 'demo',
    text: '',
    status: 'done',
    answerStatus: 'answered',
    sources: node.fragments.map((fragment, index) => ({
      index: index + 1,
      documentId: doc.id,
      documentName: doc.name,
      page: fragment.page,
      location: null,
      quote: fragment.quote,
    })),
  };
}

function RegionCrash({ reset }: { reset: () => void }) {
  const { t } = useTranslation();
  return (
    <StateBlock
      tone="danger"
      icon={<AlertTriangle size={18} aria-hidden />}
      title={t('workspace.crashTitle')}
      description={t('workspace.crashBody')}
      actions={<Button onClick={reset}>{t('common.retry')}</Button>}
      className="my-auto"
    />
  );
}

function WorkspaceView({ doc }: { doc: DocumentModel }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const split = useMediaQuery(SPLIT_PANE_QUERY);
  const routerLocation = useLocation();
  const [pane, setPane] = useState<Pane>(routerLocation.state ? 'document' : 'assistant');
  const [chatWidth, setChatWidth] = usePersistentState('docmind.workspace.chatWidth', DEFAULT_CHAT_WIDTH);
  const [attempt, setAttempt] = useState(0);
  const [mode, setMode] = useState<ChatMode>('live');
  // Opening a document from a comparison passes the page to show.
  const [routeJump, setRouteJump] = useState<JumpRequest | null>(() => {
    const state: unknown = routerLocation.state;
    if (!isRecord(state) || !isRecord(state.jump) || typeof state.jump.page !== 'number') return null;
    return { page: state.jump.page, quote: typeof state.jump.quote === 'string' ? state.jump.quote : null, nonce: 0 };
  });
  const [deleting, setDeleting] = useState(false);

  const source = useDocumentSource(doc);
  const input: PdfInput | null = source.kind === 'pdf' ? source.input : null;
  const pdf = usePdfDocument(input, attempt);
  const { text, adapter, availability, mode: effectiveMode } = useAssistant(doc, source, pdf, mode);
  const chat = useChat(doc.id, doc.name, adapter);

  // Fragments from the map go through the same Evidence Jump as answers, as a source list kept outside the chat.
  const [view, setView] = useState<'document' | 'map'>(() => {
    const state: unknown = routerLocation.state;
    return isRecord(state) && state.view === 'map' ? 'map' : 'document';
  });
  const [mapEvidence, setMapEvidence] = useState<AssistantMessage | null>(null);
  const evidenceMessages = useMemo(() => (mapEvidence ? [...chat.messages, mapEvidence] : chat.messages), [chat.messages, mapEvidence]);
  const evidence = useEvidence(evidenceMessages);
  const { selection, open: openEvidence } = evidence;
  const picked = selection?.source ?? null;
  const pickedNonce = selection?.nonce ?? 0;

  // A picked source decides what the viewer shows. Until one is picked, a page handed over by the comparison page applies.
  const evidenceJump = useMemo(() => sourceJump(picked, pickedNonce, doc.id), [picked, pickedNonce, doc.id]);
  const jump = evidenceJump ?? routeJump;

  const evidenceApi = useMemo<EvidenceApi>(
    () => ({
      selected: selection ? { messageId: selection.messageId, sourceIndex: selection.source.index } : null,
      open: (messageId, opened) => {
        setRouteJump(null);
        openEvidence(messageId, opened);
        setView('document');
        // On a narrow screen the document is its own tab.
        setPane('document');
      },
    }),
    [openEvidence, selection],
  );

  const openFragment = (node: TopicNode, fragment: Fragment) => {
    const message = fragmentMessage(node, doc);
    const opened = message.sources.find((candidate) => candidate.page === fragment.page && candidate.quote === fragment.quote);
    if (!opened) return;
    setMapEvidence(message);
    setRouteJump(null);
    openEvidence(message.id, opened);
    setView('document');
    setPane('document');
  };
  const fromMap = selection?.messageId === mapEvidence?.id;

  const viewer: ViewerAvailability =
    source.kind === 'unavailable' ? 'unavailable' : source.kind === 'checking' ? 'loading' : pdf.status === 'error' ? 'error' : pdf.status === 'ready' ? 'ready' : 'loading';
  const located = useMemo(() => (picked ? locateEvidence(picked, text) : null), [picked, text]);
  const status = picked && located ? evidenceStatus({ kind: located.kind, viewer, foreign: picked.documentId !== doc.id }) : null;

  const origin = source.kind === 'pdf' ? source.origin : null;
  const isSample = isSampleDocument(doc.id);
  const stale = isStaleProcessing(doc);

  const viewSwitch = (
    <div role="group" aria-label={t('map.views')} className="inline-flex shrink-0 rounded-[10px] border border-line bg-card p-0.5">
      {(['document', 'map'] as const).map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={view === value}
          onClick={() => setView(value)}
          className={cn('pressable h-7 rounded-lg px-3 text-xs font-medium', view === value ? 'bg-accent text-on-accent' : 'text-muted hover:text-fg')}
        >
          {t(`map.view.${value}`)}
        </button>
      ))}
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-line py-1 pr-2 pl-2">
        <Link to="/documents" aria-label={t('workspace.back')} title={t('workspace.back')} className={cn(buttonClasses('ghost', 'sm'), 'w-8 px-0! pointer-coarse:size-11')}>
          <ArrowLeft size={16} aria-hidden />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-[15px] leading-5 font-semibold" title={doc.name}>{doc.name}</h1>
          <p className="tabular truncate text-xs leading-4 text-muted">
            {[doc.kind.toUpperCase(), doc.pageCount !== null ? t('documents.pages', { count: doc.pageCount }) : null, formatBytes(doc.sizeBytes, i18n.language)].filter(Boolean).join(' · ')}
          </p>
        </div>
        {split && viewSwitch}
        {isSample && <span className="rounded-full border border-accent-line px-2 text-xs text-accent-strong">{t('documents.sampleTag')}</span>}
        {!isSample && <StatusBadge doc={doc} />}
        {origin === 'browser' && (
          <span
            title={t('workspace.browserCopyHint')}
            className="hidden items-center gap-1 rounded-full border border-line px-2 text-xs text-muted sm:inline-flex"
          >
            <HardDrive size={12} aria-hidden />
            {t('workspace.browserCopy')}
          </span>
        )}
        {!split && (
          <div role="tablist" aria-label={t('workspace.panes')} className="order-last flex w-full rounded-[10px] border border-line bg-card p-0.5 [@media(max-height:500px)]:order-none [@media(max-height:500px)]:w-56">
            {(['document', 'assistant'] as const).map((value) => (
              <button
                key={value}
                role="tab"
                type="button"
                aria-selected={pane === value}
                onClick={() => setPane(value)}
                className={cn('pressable h-9 flex-1 rounded-lg text-sm font-medium', pane === value ? 'bg-accent-tint text-fg' : 'text-muted')}
              >
                {t(`workspace.pane.${value}`)}
              </button>
            ))}
          </div>
        )}
        {!isSample && (
          <IconButton label={t('common.delete')} icon={<Trash2 size={16} aria-hidden />} onClick={() => setDeleting(true)} />
        )}
      </header>

      {origin === 'browser' && (
        <p className="shrink-0 border-b border-line bg-sidebar px-4 py-1 text-xs text-muted [@media(max-height:500px)]:hidden">
          {stale ? t('workspace.staleHint') : t('workspace.browserCopyHint')}
        </p>
      )}

      <div className="flex min-h-0 flex-1">
        <div className={cn('flex min-w-0 flex-1 flex-col', !split && pane !== 'document' && 'hidden')}>
          {!split && <div className="flex shrink-0 items-center border-b border-line bg-sidebar px-2 py-1">{viewSwitch}</div>}
          <div className="relative min-h-0 flex-1">
          {/* Stays mounted, so coming back from a fragment keeps the topic and zoom. */}
          <div className={cn('h-full', view !== 'map' && 'hidden')}>
            <ErrorBoundary fallback={(reset) => <RegionCrash reset={reset} />}>
              <KnowledgeMap
                text={text}
                unavailable={doc.kind === 'docx' ? 'docx' : source.kind === 'unavailable' || pdf.status === 'error' ? 'other' : null}
                onOpenFragment={openFragment}
              />
            </ErrorBoundary>
          </div>
          <div className={cn('h-full', view !== 'document' && 'hidden')}>
          <ErrorBoundary fallback={(reset) => <RegionCrash reset={reset} />}>
            <ViewerPane
              doc={doc}
              source={source}
              pdf={pdf}
              text={text}
              jump={jump}
              citedPages={chat.citedPages}
              quoteNotice={selection === null}
              onRetry={() => setAttempt(attempt + 1)}
            />
          </ErrorBoundary>
          </div>
          <AnimatePresence>
            {view === 'document' && selection && status && (
              <EvidenceInspector
                key="inspector"
                evidence={selection}
                status={status}
                onSelect={evidence.select}
                onStep={evidence.step}
                onRefocus={evidence.refocus}
                onClose={evidence.close}
                onBack={fromMap ? () => setView('map') : split ? null : () => setPane('assistant')}
                backLabel={fromMap ? t('map.back') : undefined}
              />
            )}
          </AnimatePresence>
          </div>
        </div>
        {split && (
          <ResizeHandle
            width={chatWidth}
            min={MIN_CHAT_WIDTH}
            max={MAX_CHAT_WIDTH}
            onChange={setChatWidth}
            onReset={() => setChatWidth(DEFAULT_CHAT_WIDTH)}
          />
        )}
        <div
          className={cn('min-w-0', split ? 'shrink-0' : 'flex-1', !split && pane !== 'assistant' && 'hidden')}
          style={split ? { width: chatWidth } : undefined}
        >
          <ErrorBoundary fallback={(reset) => <RegionCrash reset={reset} />}>
            <EvidenceProvider value={evidenceApi}>
            <AssistantPanel mode={effectiveMode} canSwitchMode={!isSample} onModeChange={setMode} doc={doc} availability={availability} chat={chat} autoFocus={split} />
            </EvidenceProvider>
          </ErrorBoundary>
        </div>
      </div>

      <DeleteDocumentDialog doc={deleting ? doc : null} onClose={() => setDeleting(false)} onDeleted={() => navigate('/documents')} />
    </div>
  );
}

export function WorkspacePage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const errorMessage = useErrorMessage();
  const documentQuery = useDocument(id);
  const doc = documentQuery.data;

  useEffect(() => {
    if (doc) markOpened(doc.id);
  }, [doc?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const notFound = useMemo(
    () => documentQuery.error instanceof AppError && documentQuery.error.status === 404,
    [documentQuery.error],
  );

  if (documentQuery.isPending) {
    return (
      <div role="status" aria-label={t('common.loading')} className="flex h-full flex-col">
        <div className="h-12 border-b border-line" />
        <div className="flex min-h-0 flex-1 gap-4 p-4">
          <Skeleton className="flex-1" />
          <Skeleton className="w-[380px] max-lg:hidden" />
        </div>
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="flex h-full items-center justify-center">
        <StateBlock
          tone={notFound ? 'neutral' : 'danger'}
          icon={<FileQuestion size={18} aria-hidden />}
          title={notFound ? t('workspace.notFoundTitle') : t('workspace.loadErrorTitle')}
          description={notFound ? t('workspace.notFoundBody') : errorMessage(documentQuery.error)}
          actions={
            <>
              <Link to="/documents" className={buttonClasses('secondary')}>
                {t('workspace.back')}
              </Link>
              {!notFound && (
                <Button icon={<RotateCcw size={14} aria-hidden />} loading={documentQuery.isFetching} onClick={() => void documentQuery.refetch()}>
                  {t('common.retry')}
                </Button>
              )}
            </>
          }
        />
      </div>
    );
  }

  // Keyed so that switching documents resets the chat, viewer and panes together.
  return <WorkspaceView key={doc.id} doc={doc} />;
}
