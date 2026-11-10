import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useDocuments } from '@/features/documents/useDocuments';
import { useUpload } from '@/features/upload/UploadProvider';
import type { ProcurementStep } from '@/features/procurement/WorkflowStepper';
import { setUserMode } from '@/features/userModes/useUserMode';
import { DEMO_DOCUMENT, fetchDemoFile } from '@/services/industryDemo';

/** Opens a document at its parts and purchase workflow, whichever mode the person was in. */
export function useOpenWorkflow() {
  const navigate = useNavigate();
  return (documentId: string, step?: ProcurementStep) => {
    setUserMode('procurement');
    void navigate(`/documents/${encodeURIComponent(documentId)}`, { state: { view: 'procurement', ...(step ? { step } : {}) } });
  };
}

/**
 * The two ways in from the home page. Both are ordinary uploads, with the file's real progress and errors in the upload
 * tray, followed by a jump to the workflow when this upload has finished.
 */
export function useWorkflowStart() {
  const { items, openPicker, addFiles, dismiss } = useUpload();
  const documents = useDocuments();
  const open = useOpenWorkflow();
  const [watchFrom, setWatchFrom] = useState<number | null>(null);
  const [demoState, setDemoState] = useState<'idle' | 'busy' | 'failed'>('idle');
  const lastId = items.reduce((highest, item) => Math.max(highest, item.id), 0);
  const watched = watchFrom === null ? [] : items.filter((item) => item.id > watchFrom);
  const finished = watched.find((item) => item.phase.status === 'success');
  const documentId = finished?.phase.status === 'success' ? finished.phase.documentId : null;
  const uploadFailed = watched.some((item) => item.phase.status === 'error');

  useEffect(() => {
    if (!documentId || !finished) return;
    dismiss(finished.id);
    open(documentId);
    // `open` only navigates. The upload finishing is what this waits for.
  }, [documentId]); // eslint-disable-line react-hooks/exhaustive-deps

  const analyze = () => {
    setWatchFrom(lastId);
    openPicker();
  };
  const demo = async () => {
    const existing = documents.data?.find((doc) => doc.name === DEMO_DOCUMENT.name && doc.status !== 'failed');
    if (existing) {
      open(existing.id);
      return;
    }
    setDemoState('busy');
    try {
      const file = await fetchDemoFile(DEMO_DOCUMENT.url, DEMO_DOCUMENT.name, 'application/pdf');
      setWatchFrom(lastId);
      addFiles([file]);
      setDemoState('idle');
    } catch {
      setDemoState('failed');
    }
  };
  return { analyze, demo, demoBusy: demoState === 'busy' || (watched.length > 0 && !finished && !uploadFailed), demoFailed: demoState === 'failed' };
}
