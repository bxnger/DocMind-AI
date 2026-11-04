import { Trash2 } from 'lucide-react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { IconButton } from '@/components/ui/IconButton';
import { formatBytes, formatDate } from '@/lib/format';
import type { DocumentModel } from '@/types/document';
import { DocumentIcon } from './DocumentIcon';
import { StatusBadge } from './StatusBadge';

interface DocumentRowProps {
  doc: DocumentModel;
  /** Replaces the created date, for example with "opened 2 hours ago". */
  meta?: string;
  /** Shown next to the name, for example the Sample label. */
  tag?: string;
  onDelete?: (doc: DocumentModel) => void;
}

export function DocumentRow({ doc, meta, tag, onDelete }: DocumentRowProps) {
  const { t, i18n } = useTranslation();
  return (
    <li className="group relative flex min-h-14 items-center gap-3 border-b border-line px-3 py-2 last:border-b-0 hover:bg-hover focus-within:bg-hover">
      <DocumentIcon kind={doc.kind} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {/* The stretched link makes the whole row clickable while staying one real link. */}
          <Link
            to={`/documents/${doc.id}`}
            title={doc.name}
            className="min-w-0 truncate font-medium text-fg after:absolute after:inset-0 after:content-['']"
          >
            {doc.name}
          </Link>
          {tag && (
            <span className="shrink-0 rounded-full border border-accent-line px-2 text-xs text-accent-strong">{tag}</span>
          )}
        </div>
        <p className="tabular truncate text-xs text-muted">
          {[
            formatBytes(doc.sizeBytes, i18n.language),
            doc.pageCount !== null ? t('documents.pages', { count: doc.pageCount }) : null,
            meta ?? formatDate(doc.createdAt, i18n.language),
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </div>
      <StatusBadge doc={doc} />
      {onDelete && (
        <IconButton
          label={t('documents.deleteNamed', { name: doc.name })}
          icon={<Trash2 size={16} aria-hidden />}
          onClick={() => onDelete(doc)}
          className="relative z-10 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100 pointer-fine:focus-visible:opacity-100"
        />
      )}
    </li>
  );
}

export function DocumentRowSkeleton() {
  return (
    <li className="flex h-14 items-center gap-3 border-b border-line px-3 last:border-b-0">
      <div className="skeleton size-9 shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="skeleton h-3 w-1/2" />
        <div className="skeleton h-2 w-1/4" />
      </div>
    </li>
  );
}
