export type { ChatAdapter, ChatEvent, ChatRequest } from './types';
export { createLiveChatAdapter, deleteLiveConversation } from './live/liveChatAdapter';
export { createDemoChatAdapter } from './demo/demoChatAdapter';
export { extractDocumentText, hasSearchableText } from './demo/textIndex';
export type { DocumentText, PageText } from './demo/textIndex';
export { frequentTerms } from './demo/retrieval';
