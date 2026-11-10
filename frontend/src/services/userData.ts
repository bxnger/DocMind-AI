import { removeStored, removeStoredByPrefix } from '@/lib/storage';
import { clearLocalFiles } from './localFiles';
import { clearRecents } from './recents';

/**
 * Everything in this browser that belongs to one guest. Theme, language, mode and panel widths stay: they are
 * preferences, not data. `shared`: also what other tabs use, which only the tab making the change clears.
 */
export async function clearUserData(shared: boolean): Promise<void> {
  removeStoredByPrefix('session', 'docmind.chat.');
  clearRecents();
  if (!shared) return;
  removeStored('local', 'docmind.conversations');
  await clearLocalFiles().catch(() => undefined); // no IndexedDB means no copies to remove
}
