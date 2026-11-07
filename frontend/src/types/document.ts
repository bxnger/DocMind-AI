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
  /** Public and read-only: every guest can read and ask about it, nobody can delete it. */
  isDemo: boolean;
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
  /** New functions the server has. Absent on an older server, which then reads as all false. */
  features: { claimCheck: boolean; parts: boolean; photoIdentify: boolean; priceLists: boolean; procurement: boolean; hr: boolean };
  limits: {
    maxFileSizeBytes: number;
    maxPages: number;
    maxDocumentsPerConversation: number;
    maxImageBytes: number | null;
  };
}
