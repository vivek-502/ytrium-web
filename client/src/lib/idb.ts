/**
 * Minimal IndexedDB key/value store.
 *
 * IndexedDB is used for structured/local data (library, history, queue,
 * playlists). localStorage is reserved for tiny preferences only and must
 * never be used directly from components - go through `storage`.
 */

const DB_NAME = 'yttrium';
/** Database written by builds before the rename; copied over once, then left. */
const LEGACY_DB_NAME = 'sonare';
const DB_VERSION = 1;
export const KV_STORE = 'kv';
/** Written once so the legacy copy never runs (or overwrites) twice. */
const MIGRATED_FLAG = '__migrated_from_legacy_db';

let dbPromise: Promise<IDBDatabase> | null = null;

function openOnce(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(KV_STORE)) db.createObjectStore(KV_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'));
    req.onblocked = () => reject(new Error('indexedDB blocked by another tab'));
  });
}

/* ------------------------------------------------------------------------
 * Raw helpers that take an explicit database handle.
 *
 * The one-time legacy migration below must never call `idb.*` / `tx()`:
 * those go through `openDb()`, which is still resolving while we run, and
 * waiting on it would deadlock.
 * --------------------------------------------------------------------- */

function dbGet(db: IDBDatabase, key: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(KV_STORE, 'readonly').objectStore(KV_STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexedDB get failed'));
  });
}

function dbSet(db: IDBDatabase, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(KV_STORE, 'readwrite');
    t.objectStore(KV_STORE).put(value, key);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error ?? new Error('indexedDB put failed'));
    t.onabort = () => reject(t.error ?? new Error('indexedDB put aborted'));
  });
}

function dbKeys(db: IDBDatabase): Promise<IDBValidKey[]> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(KV_STORE, 'readonly').objectStore(KV_STORE).getAllKeys();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexedDB getAllKeys failed'));
  });
}

/** Opens the pre-rename database, or null when it does not exist. */
function openLegacy(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(LEGACY_DB_NAME);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      // No legacy database exists - opening would CREATE an empty one.
      // Abort the upgrade so nothing is left behind (the request then
      // fails with AbortError, handled in onerror below).
      req.transaction?.abort();
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null); // AbortError or not: no legacy data
    req.onblocked = () => resolve(null);
  });
}

/** One-time copy of every entry from the pre-rename database. */
function migrateLegacyData(db: IDBDatabase): Promise<void> {
  return (async () => {
    try {
      if ((await dbGet(db, MIGRATED_FLAG)) !== undefined) return;
      const legacy = await openLegacy();
      if (legacy) {
        try {
      // The copy runs in a single pass; if target already populated (another
      // tab or older logic) we skip.
      const empty = (await dbKeys(db)).length === 0;
          if (empty) {
            const pairs = await new Promise<Array<[IDBValidKey, unknown]>>((resolve, reject) => {
              const out: Array<[IDBValidKey, unknown]> = [];
              const req = legacy.transaction(KV_STORE, 'readonly').objectStore(KV_STORE).openCursor();
              req.onsuccess = () => {
                const cur = req.result;
                if (cur) {
                  out.push([cur.key, cur.value]);
                  cur.continue();
                } else {
                  resolve(out);
                }
              };
              req.onerror = () => reject(req.error ?? new Error('legacy read failed'));
            });
            if (pairs.length) {
              await new Promise<void>((resolve, reject) => {
                const t = db.transaction(KV_STORE, 'readwrite');
                const store = t.objectStore(KV_STORE);
                for (const [key, value] of pairs) store.put(value, key);
                t.oncomplete = () => resolve();
                t.onerror = () => reject(t.error ?? new Error('legacy copy failed'));
                t.onabort = () => reject(t.error ?? new Error('legacy copy aborted'));
              });
            }
          }
        } finally {
          legacy.close();
        }
      }
      await dbSet(db, MIGRATED_FLAG, Date.now());
    } catch (err) {
      // Never block boot: the flag stays unset, so the copy retries next run.
      console.error('[idb] legacy database migration failed', err);
    }
  })();
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = openOnce().then(async (db) => {
    await migrateLegacyData(db);
    return db;
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(KV_STORE, mode);
        const req = run(t.objectStore(KV_STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('indexedDB request failed'));
        t.onabort = () => reject(t.error ?? new Error('indexedDB transaction aborted'));
      }),
  );
}

export const idb = {
  async get<T>(key: string): Promise<T | undefined> {
    const value = await tx<unknown>('readonly', (s) => s.get(key));
    return value as T | undefined;
  },
  set<T>(key: string, value: T): Promise<IDBValidKey> {
    return tx<IDBValidKey>('readwrite', (s) => s.put(value, key));
  },
  delete(key: string): Promise<undefined> {
    return tx<undefined>('readwrite', (s) => s.delete(key));
  },
  keys(): Promise<IDBValidKey[]> {
    return tx<IDBValidKey[]>('readonly', (s) => s.getAllKeys());
  },
  async entries<T>(): Promise<Array<[string, T]>> {
    const [keys] = await Promise.all([this.keys()]);
    const out: Array<[string, T]> = [];
    for (const k of keys) {
      const v = await this.get<T>(String(k));
      if (v !== undefined) out.push([String(k), v]);
    }
    return out;
  },
  clear(): Promise<undefined> {
    return tx<undefined>('readwrite', (s) => s.clear());
  },
};
