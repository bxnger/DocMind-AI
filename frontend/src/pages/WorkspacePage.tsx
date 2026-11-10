import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, FileQuestion, HardDrive, RotateCcw, ScanLine, Trash2 } from 'lucide-react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { AnimatePresence } from 'motion/react';
import { AppError, isRecord } from '@/api/client';
import { toSource } from '@/api/conversations';
import { Button, buttonClasses } from '@/components/ui/Button';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { IconButton } from '@/components/ui/IconButton';
import { Skeleton } from '@/components/ui/Skeleton';
import { StateBlock } from '@/components/ui/StateBlock';
import { AssistantPanel } from '@/features/chat/AssistantPanel';
import type { ComposerHandle } from '@/features/chat/Composer';
import { useChat } from '@/features/chat/useChat';
import type { TextBlock } from '@/api/documents';
import { useDocumentBlocks, useDocumentFacts } from '@/features/documents/useDocumentContent';
import { blocksToMapText } from '@/features/knowledgeMap/docxText';
import { FactsPanel, factMessage } from '@/features/facts/FactsPanel';
import { isProcurementStep } from '@/features/procurement/WorkflowStepper';
import { VerifyPanel } from '@/features/verify/VerifyPanel';
import { ProcurementPanel } from '@/features/procurement/ProcurementPanel';
import { useUserMode } from '@/features/userModes/useUserMode';
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
import { ThemeToggle } from '@/features/settings/ThemeToggle';
import { ViewerPane } from '@/features/workspace/ViewerPane';
import { HIDDEN_PANE, LEFT_VIEWS, SEGMENTS, applySegment, segmentOf, type LeftView, type Pane } from '@/features/workspace/workspaceView';
import { SPLIT_PANE_QUERY, useMediaQuery } from '@/hooks/useMediaQuery';
import { usePersistentState } from '@/hooks/usePersistentState';
import { cn } from '@/lib/cn';
import { formatBytes } from '@/lib/format';
import { markOpened } from '@/services/recents';
import { isSampleDocument } from '@/services/sampleDocument';
import type { AssistantMessage, ChatMode, EvidenceSource } from '@/types/chat';
import type { DocumentModel } from '@/types/document';

const DEFAULT_CHAT_WIDTH = 420;
const MIN_CHAT_WIDTH = 340;
const MAX_CHAT_WIDTH = 640;

/** A topic's fragments in the shape Evidence Jump reads. It has no answer text and never enters the chat. */
function fragmentMessage(node: TopicNode, doc: DocumentModel, blocks: readonly TextBlock[] | undefined): AssistantMessage {
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
      // A DOCX has no pages: on its map, `page` is the position of the block.
      ...(doc.kind === 'docx'
        ? { page: null, paragraph: fragment.page - 1, location: blocks?.[fragment.page - 1]?.section ?? null }
        : { page: fragment.page, location: null }),
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
  const startState: unknown = routerLocation.state;
  // A question handed over from the home page, for the user to read and send.
  const prefill = isRecord(startState) && typeof startState.prefill === 'string' ? startState.prefill : null;
  const [pane, setPane] = useState<Pane>(startState && !prefill ? 'document' : 'assistant');
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
  const initialStep = isRecord(startState) && isProcurementStep(startState.step) ? startState.step : undefined;

  const source = useDocumentSource(doc);
  const input: PdfInput | null = source.kind === 'pdf' ? source.input : null;
  const pdf = usePdfDocument(input, attempt);
  const { text, adapter, availability, mode: effectiveMode } = useAssistant(doc, source, pdf, mode);
  const chat = useChat(doc.id, doc.name, adapter);
  const composer = useRef<ComposerHandle>(null);
  const docxBlocks = useDocumentBlocks(doc.id, doc.kind === 'docx' && doc.status === 'ready');
  const docxMapText = useMemo(() => (docxBlocks.data ? blocksToMapText(docxBlocks.data) : undefined), [docxBlocks.data]);
  const placeOfBlock = (fragment: Fragment) => docxBlocks.data?.[fragment.page - 1]?.section ?? t('compare.inText');
  const isSampleDoc = isSampleDocument(doc.id);
  const userMode = useUserMode();
  const leftViews = LEFT_VIEWS(isSampleDoc, userMode);
  useEffect(() => {
    if (prefill) composer.current?.insert(prefill);
    // Only once, when the document opens.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const facts = useDocumentFacts(doc.id, doc.status === 'ready' && !isSampleDoc);
  const suggestedQuestions = facts.data?.suggestedQuestions ?? [];

  // Fragments from the map go through the same Evidence Jump as answers, as a source list kept outside the chat.
  const [view, setView] = useState<LeftView>(() => {
    const state: unknown = routerLocation.state;
    if (!isRecord(state)) return 'document';
    return state.view === 'map' || state.view === 'procurement' || state.view === 'verify' ? state.view : 'document';
  });
  // Once opened, the workflow stays mounted, so a source and back keep the photo and the step. Opening it is what starts the extraction.
  const [procurementOpened, setProcurementOpened] = useState(false);
  if (view === 'procurement' && !procurementOpened) setProcurementOpened(true);
  const [mapEvidence, setMapEvidence] = useState<AssistantMessage | null>(null);
  const evidenceMessages = useMemo(() => (mapEvidence ? [...chat.messages, mapEvidence] : chat.messages), [chat.messages, mapEvidence]);
  const evidence = useEvidence(evidenceMessages);
  const { selection, open: openEvidence } = evidence;
  const picked = selection?.source ?? null;
  const pickedNonce = selection?.nonce ?? 0;

  // A picked source decides what the viewer shows. Until one is picked, a page handed over by the comparison page applies.
  const evidenceJump = useMemo(() => sourceJump(picked, pickedNonce, doc.id), [picked, pickedNonce, doc.id]);
  const jump = evidenceJump ?? routeJump;

  const selectedMessage = selection?.messageId ?? null;
  const selectedIndex = selection?.source.index ?? null;
  const evidenceApi = useMemo<EvidenceApi>(
    () => ({
      selected: selectedMessage !== null && selectedIndex !== null ? { messageId: selectedMessage, sourceIndex: selectedIndex } : null,
      open: (messageId, opened) => {
        setRouteJump(null);
        openEvidence(messageId, opened);
        setView('document');
        // On a narrow screen the document is its own tab.
        setPane('document');
      },
    }),
    [openEvidence, selectedIndex, selectedMessage, setView],
  );

  const openFragment = (node: TopicNode, fragment: Fragment) => {
    const message = fragmentMessage(node, doc, docxBlocks.data);
    const opened = message.sources[node.fragments.indexOf(fragment)];
    if (!opened) return;
    setMapEvidence(message);
    setRouteJump(null);
    openEvidence(message.id, opened);
    setView('document');
    setPane('document');
  };
  const picksExtra = selection?.messageId === mapEvidence?.id;
  const fromFacts = picksExtra && Boolean(mapEvidence?.id.startsWith('facts:'));
  const fromProcurement = picksExtra && Boolean(mapEvidence?.id.startsWith('procurement:'));
  const fromHr = picksExtra && Boolean(mapEvidence?.id.startsWith('hr:'));
  const fromVerify = picksExtra && Boolean(mapEvidence?.id.startsWith('verify:'));
  const fromMap = picksExtra && !fromFacts && !fromProcurement && !fromHr && !fromVerify;

  const openFact = (factSource: EvidenceSource, prefix = 'facts') => {
    const message = factMessage(factSource, prefix);
    setMapEvidence(message);
    setRouteJump(null);
    openEvidence(message.id, factSource);
    setView('document');
    setPane('document');
  };

  // A source handed over from the resume and vacancy page opens as usual, and "back" returns there.
  useEffect(() => {
    // Only once, when the document opens. It reuses the hook that highlights a source, so it can't be initial state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (isRecord(startState) && isRecord(startState.source)) openFact(toSource(startState.source), 'hr');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Only fills the composer, for the user to edit and send. Prompts are for the AI, so demo mode gives way to it.
  const askSuggested = (question: string) => {
    setMode('live');
    setPane('assistant');
    requestAnimationFrame(() => composer.current?.insert(question));
  };

  const docxTarget = picked && picked.page === null && picked.documentId === doc.id && picked.paragraph !== undefined
    ? { paragraph: picked.paragraph, quote: picked.quote, nonce: pickedNonce }
    : null;

  const viewer: ViewerAvailability =
    source.kind === 'unavailable' ? 'unavailable' : source.kind === 'checking' ? 'loading' : pdf.status === 'error' ? 'error' : pdf.status === 'ready' ? 'ready' : 'loading';
  const located = useMemo(() => (picked ? locateEvidence(picked, text) : null), [picked, text]);
  const status = picked && located ? evidenceStatus({ kind: located.kind, viewer, foreign: picked.documentId !== doc.id }) : null;

  const origin = source.kind === 'pdf' ? source.origin : null;
  const isSample = isSampleDocument(doc.id);
  const stale = isStaleProcessing(doc);

  const viewSwitch = (
    <div role="group" aria-label={t('map.views')} className="inline-flex shrink-0 rounded-[10px] border border-line bg-card p-0.5">
      {leftViews.map((value) => (
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
            {[doc.kind.toUpperCase(), doc.pageCount !== null ? t('documents.pages', { count: doc.pageCount }) : null, formatBytes(doc.sizeBytes, i18n.language), doc.ocrUsed ? 'OCR' : null].filter(Boolean).join(' · ')}
          </p>
        </div>
        {split && viewSwitch}
        {isSample && <span className="rounded-full border border-accent-line px-2 text-xs text-accent-strong">{t('documents.sampleTag')}</span>}
        {doc.isDemo && <span data-testid="demo-tag" className="rounded-full border border-accent-line px-2 text-xs text-accent-strong">{t('documents.demoTag')}</span>}
        {!isSample && <StatusBadge doc={doc} compact={!split} />}
        {origin === 'browser' && (
          <span
            title={t('workspace.browserCopyHint')}
            className="hidden items-center gap-1 rounded-full border border-line px-2 text-xs text-muted sm:inline-flex"
          >
            <HardDrive size={12} aria-hidden />
            {t('workspace.browserCopy')}
          </span>
        )}
        {!split && <ThemeToggle />}
        {!isSample && !doc.isDemo && (
          <IconButton label={t('common.delete')} icon={<Trash2 size={16} aria-hidden />} onClick={() => setDeleting(true)} />
        )}
        {!split && (
          <div role="tablist" aria-label={t('workspace.panes')} className="order-last flex w-full overflow-x-auto [scrollbar-width:none] rounded-[10px] border border-line bg-card p-0.5 [@media(max-height:500px)]:order-none [@media(max-height:500px)]:w-64">
            {SEGMENTS.filter((value) => value === 'assistant' || (leftViews.includes(value) && !(value === 'facts' && userMode === 'procurement'))).map((value) => (
              <button
                key={value}
                role="tab"
                type="button"
                aria-selected={segmentOf(pane, view) === value}
                onClick={() => {
                  const next = applySegment(value, view);
                  setPane(next.pane);
                  setView(next.view);
                }}
                className={cn('pressable h-9 shrink-0 grow whitespace-nowrap rounded-lg px-2 text-sm font-medium max-[400px]:text-xs', segmentOf(pane, view) === value ? 'bg-accent text-on-accent' : 'text-muted')}
              >
                {t(`workspace.segments.${value}`)}
              </button>
            ))}
          </div>
        )}
      </header>

      {origin === 'browser' && (
        <p className="shrink-0 border-b border-line bg-sidebar px-4 py-1 text-xs text-muted [@media(max-height:500px)]:hidden">
          {stale ? t('workspace.staleHint') : t('workspace.browserCopyHint')}
        </p>
      )}

      {doc.ocrUsed && (
        <p data-testid="ocr-notice" className="flex shrink-0 items-start gap-2 border-b border-line bg-warning-tint px-4 py-1.5 text-xs text-warning [@media(max-height:500px)]:hidden">
          <ScanLine size={14} className="mt-px shrink-0" aria-hidden />
          {t('workspace.ocrNotice')}
        </p>
      )}

      <div className="relative flex min-h-0 flex-1">
        <div className={cn('flex min-w-0 flex-1 flex-col', !split && pane !== 'document' && HIDDEN_PANE)}>
          <div className="relative min-h-0 flex-1">
          {/* Stays mounted, so coming back from a fragment keeps the topic and zoom. */}
          <div className={cn('h-full', view !== 'map' && HIDDEN_PANE)}>
            <ErrorBoundary fallback={(reset) => <RegionCrash reset={reset} />}>
              <KnowledgeMap
                text={doc.kind === 'docx' ? docxMapText : text}
                unavailable={doc.kind === 'docx' ? (docxBlocks.isError ? 'other' : null) : source.kind === 'unavailable' || pdf.status === 'error' ? 'other' : null}
                documentName={doc.name}
                placeOf={doc.kind === 'docx' ? placeOfBlock : undefined}
                onOpenFragment={openFragment}
              />
            </ErrorBoundary>
          </div>
          <div className={cn('h-full', view !== 'document' && HIDDEN_PANE)}>
          <ErrorBoundary fallback={(reset) => <RegionCrash reset={reset} />}>
            <ViewerPane
              doc={doc}
              source={source}
              pdf={pdf}
              text={text}
              jump={jump}
              docxTarget={docxTarget}
              citedPages={chat.citedPages}
              quoteNotice={selection === null}
              roomForInspector={selection !== null}
              onRetry={() => setAttempt(attempt + 1)}
            />
          </ErrorBoundary>
          </div>
          {view === 'facts' && (
            <div className="absolute inset-0 bg-bg">
              <ErrorBoundary fallback={(reset) => <RegionCrash reset={reset} />}>
                <FactsPanel doc={doc} query={facts} onOpen={openFact} onAsk={askSuggested} />
              </ErrorBoundary>
            </div>
          )}
          {procurementOpened && leftViews.includes('procurement') && (
            <div className={cn('absolute inset-0 bg-bg', view !== 'procurement' && HIDDEN_PANE)}>
              <ErrorBoundary fallback={(reset) => <RegionCrash reset={reset} />}>
                <ProcurementPanel doc={doc} pdfText={text} initialStep={initialStep} onOpenSource={(partSource) => openFact(partSource, 'procurement')} onOpenDocument={() => setView('document')} />
              </ErrorBoundary>
            </div>
          )}
          {leftViews.includes('verify') && (
            <div className={cn('absolute inset-0 bg-bg', view !== 'verify' && HIDDEN_PANE)}>
              <ErrorBoundary fallback={(reset) => <RegionCrash reset={reset} />}>
                <VerifyPanel doc={doc} onOpenSource={(claimSource) => openFact(claimSource, 'verify')} />
              </ErrorBoundary>
            </div>
          )}
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
                onBack={fromMap ? () => setView('map') : fromFacts ? () => setView('facts') : fromProcurement ? () => setView('procurement') : fromVerify ? () => setView('verify') : fromHr ? () => void navigate(-1) : split ? null : () => setPane('assistant')}
                backLabel={fromMap ? t('map.back') : fromFacts ? t('facts.back') : fromProcurement ? t('procurement.back') : fromVerify ? t('verify.back') : fromHr ? t('hr.back') : undefined}
                ocrUsed={doc.ocrUsed === true}
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
          className={cn('min-w-0', split ? 'shrink-0' : 'flex-1', !split && pane !== 'assistant' && HIDDEN_PANE)}
          style={split ? { width: chatWidth } : undefined}
        >
          <ErrorBoundary fallback={(reset) => <RegionCrash reset={reset} />}>
            <EvidenceProvider value={evidenceApi}>
            <AssistantPanel mode={effectiveMode} canSwitchMode={!isSample} onModeChange={setMode} doc={doc} availability={availability} chat={chat} autoFocus={split} composerRef={composer} suggestedQuestions={suggestedQuestions} />
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
