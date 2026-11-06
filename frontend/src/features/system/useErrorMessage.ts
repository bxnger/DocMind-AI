import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { AppError, ERROR_NETWORK } from '@/api/client';
import type { DocumentModel } from '@/types/document';
import { useCapabilities } from './useSystem';

/** Every code in docs/api-contract.md that has its own explanation. */
const KNOWN_CODES = [
  'RATE_LIMITED', 'LLM_UNAVAILABLE', 'LLM_TIMEOUT', 'EMPTY_MESSAGE', 'MESSAGE_TOO_LONG',
  'DOCUMENT_NOT_READY', 'SAME_DOCUMENT', 'DOCUMENT_TOO_LARGE_FOR_COMPARISON', 'COMPARISON_NOT_FOUND', 'PREVIEW_UNAVAILABLE',
  'PAGE_NOT_FOUND', 'PARSE_FAILED', 'PASSWORD_PROTECTED', 'NO_TEXT_FOUND', 'OCR_FAILED', 'INDEXING_FAILED',
  'INTERNAL_ERROR', 'STREAM_INTERRUPTED', 'REQUEST_TIMEOUT',
  'UNAUTHORIZED', 'SESSION_EXPIRED', 'DEMO_READ_ONLY', 'QUOTA_EXCEEDED', 'AI_SESSION_BUDGET_EXCEEDED', 'AI_BUDGET_EXCEEDED',
  'STORAGE_FULL', 'DOCUMENT_TOO_COMPLEX', 'DOCX_TOO_LARGE', 'CONVERSATION_NOT_FOUND',
] as const;

type KnownCode = (typeof KNOWN_CODES)[number];
const isKnown = (code: string): code is KnownCode => (KNOWN_CODES as readonly string[]).includes(code);

export function useCodeMessage(): (code: string | null | undefined) => string {
  const { t } = useTranslation();
  return useCallback(
    (code) => {
      if (!code) return t('errors.unexpected');
      if (isKnown(code)) return t(`errors.codes.${code}`);
      switch (code) {
        case ERROR_NETWORK:
          return t('errors.network');
        case 'UNSUPPORTED_TYPE':
          return t('errors.unsupportedType');
        case 'FILE_TOO_LARGE':
          return t('errors.tooLargeGeneric');
        case 'VALIDATION_ERROR':
          return t('errors.invalidFile');
        case 'DOCUMENT_NOT_FOUND':
          return t('errors.documentNotFound');
        default:
          return t('errors.unexpected');
      }
    },
    [t],
  );
}

/** Why a document failed. "No text" reads differently when the server does have OCR. */
export function useDocumentFailure(): (doc: DocumentModel) => string {
  const { t } = useTranslation();
  const forCode = useCodeMessage();
  const capabilities = useCapabilities();
  return useCallback(
    (doc) => (doc.error?.code === 'NO_TEXT_FOUND' && capabilities.data?.ocr ? t('errors.noTextWithOcr') : forCode(doc.error?.code)),
    [capabilities.data?.ocr, forCode, t],
  );
}

/** Maps backend and network errors to localized text. Raw server text is never shown. */
export function useErrorMessage(): (error: unknown) => string {
  const { t } = useTranslation();
  const forCode = useCodeMessage();
  return useCallback(
    (error: unknown) => {
      if (!(error instanceof AppError)) return t('errors.unexpected');
      if (error.code === 'RATE_LIMITED' && error.retryAfter !== null) return t('errors.rateLimitedWait', { seconds: Math.max(1, Math.ceil(error.retryAfter)) });
      const text = forCode(error.code);
      return text === t('errors.unexpected') && error.status !== null && error.status >= 500 ? t('errors.server') : text;
    },
    [forCode, t],
  );
}
