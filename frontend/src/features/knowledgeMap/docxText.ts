import type { TextBlock } from '@/api/documents';
import type { DocumentText } from '@/services/chat/demo/textIndex';

/**
 * The text of a DOCX in the shape the map reads. Word has no pages, so each block stands in for one and
 * `page` is only its position: block index + 1. It is never shown as a page number.
 */
export function blocksToMapText(blocks: readonly TextBlock[]): DocumentText {
  return blocks.map((block) => ({ page: block.index + 1, text: block.text, items: [block.text] })) as DocumentText;
}
