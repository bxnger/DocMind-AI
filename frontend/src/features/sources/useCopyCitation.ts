import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/ui/Toast';
import type { EvidenceSource } from '@/types/chat';

/** Copies a quote together with where it comes from, so it can be pasted somewhere without losing its source. */
export function useCopyCitation(source: EvidenceSource) {
  const { t } = useTranslation();
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    const citation =
      source.page === null
        ? t('sources.copyFormatSection', { quote: source.quote, name: source.documentName, location: source.location ?? '' })
        : t('sources.copyFormat', { quote: source.quote, name: source.documentName, page: source.page });
    try {
      await navigator.clipboard.writeText(citation);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (error) {
      console.warn('Clipboard write failed', error);
      toast.show(t('sources.copyFailed'), 'error');
    }
  };

  return { copied, copy };
}
