export type DocumentKind = 'pdf' | 'docx';
export type DocumentStatus = 'processing' | 'ready' | 'failed';
export type DocumentStage = 'queued' | 'extracting' | 'ocr' | 'indexing';
export type DocumentLanguage = 'kk' | 'ru' | 'en' | 'mixed';

export interface DocumentError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface DocumentModel {
  id: string;
  name: string;
  kind: DocumentKind;
  sizeBytes: number;
  status: DocumentStatus;
  stage: DocumentStage | null;
  pageCount: number | null;
  language: DocumentLanguage | null;
  ocrUsed: boolean | null;
  hasPreview: boolean;
  createdAt: string;
  error: DocumentError | null;
}

export interface Capabilities {
  version: string;
  languages: string[];
  ocr: boolean;
  docxPreview: 'pdf' | 'none';
  comparison: boolean;
  highlights: boolean;
  limits: {
    maxFileSizeBytes: number;
    maxPages: number;
    maxDocumentsPerConversation: number;
  };
}
