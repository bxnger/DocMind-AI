/**
 * Keeps the user's own PDF in this browser (IndexedDB). The backend serves a file only once a
 * document is `ready`, and it does not finish processing yet, so this copy is what makes the
 * viewer work for real uploads. The UI labels it as a browser copy.
 */
const DB_NAME = 'docmind';
const STORE = 'files';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB is unavailable'));
  });
}

async function run<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = action(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
    });
  } finally {
    db.close();
  }
}

export async function saveLocalFile(id: string, file: Blob): Promise<void> {
  await run('readwrite', (store) => store.put(file, id));
}

export async function getLocalFile(id: string): Promise<Blob | null> {
  const value: unknown = await run('readonly', (store) => store.get(id));
  return value instanceof Blob ? value : null;
}

export async function deleteLocalFile(id: string): Promise<void> {
  await run('readwrite', (store) => store.delete(id));
}

export async function clearLocalFiles(): Promise<void> {
  await run('readwrite', (store) => store.clear());
}
