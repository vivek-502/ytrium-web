import { idb } from './idb';

/**
 * Storage abstraction.
 *
 * All persistence flows through this module (`storage.get/save/update/
 * delete/clear`). Components never touch IndexedDB or localStorage directly.
 *
 * Multi-user scoping: every data key is namespaced with the signed-in user's
 * id (`library.v1::<userId>`), so each account on this device gets its own
 * library, history, queue and settings. Nothing is written until a user is
 * signed in (`setStorageScope`) - stores hydrate after that.
 */
export const LIBRARY_KEY = 'library.v1';
export const HISTORY_KEY = 'history.v1';
export const PLAYER_KEY = 'player.v1';
export const SETTINGS_KEY = 'ytrium-web.settings.v1';
/** localStorage settings keys written before the rename (scoped and not). */
const LEGACY_SETTINGS_BASES = ['yttrium.settings.v1', 'sonare.settings.v1'];

/** Separator between a base data key and the owning user's id. */
const SCOPE_SEP = '::';

let scope: string | null = null;

function keyFor(base: string): string {
  return scope ? `${base}${SCOPE_SEP}${scope}` : base;
}

/**
 * Points persistence at one user's namespace. Pending debounced writes are
 * flushed first (under the old scope) so no write ever lands in the wrong
 * account's bucket.
 */
export function setStorageScope(userId: string | null): void {
  flushSaves();
  scope = userId;
}

/**
 * First sign-in on this device: hand pre-account and pre-rename local data
 * to whichever user signs in first, so existing libraries survive upgrades.
 * Runs on every sign-in but only acts while legacy keys exist - they are
 * removed as soon as they are claimed.
 */
export async function migrateScopedData(): Promise<void> {
  if (!scope) return;
  try {
    // 1) Settings written under a previous key name, scoped to this user.
    for (const base of LEGACY_SETTINGS_BASES) {
      const legacyKey = `${base}${SCOPE_SEP}${scope}`;
      const legacy = localStorage.getItem(legacyKey);
      if (legacy !== null && localStorage.getItem(keyFor(SETTINGS_KEY)) === null) {
        localStorage.setItem(keyFor(SETTINGS_KEY), legacy);
      }
    }
    // 2) Unscoped settings leftovers (pre-account era, any key name).
    for (const base of [SETTINGS_KEY, ...LEGACY_SETTINGS_BASES]) {
      const legacy = localStorage.getItem(base);
      if (legacy !== null && localStorage.getItem(keyFor(SETTINGS_KEY)) === null) {
        localStorage.setItem(keyFor(SETTINGS_KEY), legacy);
      }
    }
    // 3) Structured IndexedDB data (unscoped pre-account keys -> this user).
    //    The pre-rename DATABASE itself was already copied by `idb` on open.
    for (const base of [LIBRARY_KEY, HISTORY_KEY, PLAYER_KEY]) {
      const legacy = await idb.get(base);
      if (legacy === undefined) continue;
      if ((await idb.get(keyFor(base))) === undefined) {
        await idb.set(keyFor(base), legacy);
      }
      await idb.delete(base);
    }
  } catch (err) {
    console.error('[storage] legacy migration failed', err);
  }
}

export const storage = {
  async get<T>(key: string): Promise<T | undefined> {
    try {
      return await idb.get<T>(keyFor(key));
    } catch (err) {
      console.error('[storage] get failed', key, err);
      return undefined;
    }
  },

  async save<T>(key: string, value: T): Promise<void> {
    try {
      await idb.set(keyFor(key), value);
    } catch (err) {
      console.error('[storage] save failed', key, err);
    }
  },

  async update<T>(key: string, updater: (prev: T | undefined) => T): Promise<T | undefined> {
    try {
      const next = updater(await idb.get<T>(keyFor(key)));
      await idb.set(keyFor(key), next);
      return next;
    } catch (err) {
      console.error('[storage] update failed', key, err);
      return undefined;
    }
  },

  async delete(key: string): Promise<void> {
    try {
      await idb.delete(keyFor(key));
    } catch (err) {
      console.error('[storage] delete failed', key, err);
    }
  },

  /**
   * Clears this user's data (library, history, player state) plus any
   * unscoped leftovers. Other accounts' namespaces on this device stay
   * untouched - a reset only ever affects the signed-in account.
   */
  async clear(): Promise<void> {
    try {
      const keys = await idb.keys();
      for (const k of keys) {
        const key = String(k);
        const mine =
          !key.includes(SCOPE_SEP) || (scope !== null && key.endsWith(`${SCOPE_SEP}${scope}`));
        if (mine) await idb.delete(key);
      }
      localStorage.removeItem(keyFor(SETTINGS_KEY));
      localStorage.removeItem(SETTINGS_KEY); // pre-account settings
      for (const base of LEGACY_SETTINGS_BASES) {
        localStorage.removeItem(base);
      }
    } catch (err) {
      console.error('[storage] clear failed', err);
    }
  },
};

/* -------- Small preferences: localStorage only (tiny, synchronous). ------ */

export const prefStorage = {
  get<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(keyFor(key));
      if (raw === null) return fallback;
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  },
  set<T>(key: string, value: T): void {
    try {
      localStorage.setItem(keyFor(key), JSON.stringify(value));
    } catch {
      // Quota / private mode - preferences simply do not persist.
    }
  },
  remove(key: string): void {
    try {
      localStorage.removeItem(keyFor(key));
    } catch {
      /* noop */
    }
  },
};

/* ------------------- Debounced persistence helpers ----------------------- */

const pending = new Map<string, { timer: ReturnType<typeof setTimeout>; write: () => void }>();

/** Coalesces rapid state changes into one IndexedDB write per key. */
export function saveDebounced<T>(key: string, value: T, delay = 600): void {
  const existing = pending.get(key);
  if (existing) clearTimeout(existing.timer);
  const timer = setTimeout(() => {
    pending.delete(key);
    void storage.save(key, value);
  }, delay);
  pending.set(key, { timer, write: () => void storage.save(key, value) });
}

/** Flushes any pending debounced writes immediately. */
export function flushSaves(): void {
  for (const [, entry] of pending) {
    clearTimeout(entry.timer);
    entry.write();
  }
  pending.clear();
}
