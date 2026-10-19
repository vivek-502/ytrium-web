import { create } from 'zustand';
import { authProvider } from '../providers/authProvider';
import { setUnauthorizedHandler } from '../providers/http';
import { flushSaves, migrateScopedData, setStorageScope } from '../lib/storage';
import type { AdminUser, AuthUser } from '../types';

/**
 * Session + account state.
 *
 * `boot`  - the session is being restored (App shows a splash)
 * `anon`  - nobody is signed in (App shows the sign-in screen)
 * `authed`- a session exists; local storage is scoped to that user
 */
export type AuthStatus = 'boot' | 'anon' | 'authed';

interface AuthState {
  user: AuthUser | null;
  status: AuthStatus;

  /** Restores the session once on first load. */
  init: () => Promise<void>;
  /** Signs in, then scopes local data to that account. Throws on failure. */
  login: (username: string, password: string) => Promise<void>;
  /** Ends the session and returns to the sign-in screen. */
  logout: () => Promise<void>;
  /** Applies a refreshed payload (after the user changed their credentials). */
  setUser: (user: AuthUser) => void;

  /* ------------------------------------------------------ admin accounts */

  adminUsers: AdminUser[] | null;
  adminUsersError: string | null;
  loadAdminUsers: () => Promise<void>;
  /** Password is set here, at creation - it can never be reset later. */
  createAdminUser: (username: string, password: string) => Promise<AdminUser>;
  /** Deleting requires the target user's own password. */
  deleteAdminUser: (userId: string, password: string) => Promise<void>;
}

let bootStarted = false;

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  status: 'boot',
  adminUsers: null,
  adminUsersError: null,

  init: async () => {
    if (bootStarted) return;
    bootStarted = true;
    try {
      const { user } = await authProvider.me();
      if (user) {
        setStorageScope(user.id);
        await migrateScopedData();
        set({ user, status: 'authed' });
      } else {
        set({ status: 'anon' });
      }
    } catch (err) {
      // Server unreachable or signed out - show the sign-in screen; the form
      // surfaces connectivity errors when it is submitted.
      console.error('[auth] session check failed', err);
      set({ status: 'anon' });
    }
  },

  login: async (username, password) => {
    const { user } = await authProvider.login(username.trim(), password);
    setStorageScope(user.id);
    await migrateScopedData();
    set({ user, status: 'authed', adminUsers: null, adminUsersError: null });
  },

  logout: async () => {
    flushSaves();
    try {
      await authProvider.logout();
    } catch {
      // The session may already be gone server-side; a reload cleans up anyway.
    }
    window.location.reload();
  },

  setUser: (user) => set({ user }),

  /* ------------------------------------------------------ admin accounts */

  loadAdminUsers: async () => {
    set({ adminUsersError: null });
    try {
      const { users } = await authProvider.listUsers();
      set({ adminUsers: users });
    } catch (err) {
      set({
        adminUsersError: err instanceof Error ? err.message : 'Could not load users.',
      });
    }
  },

  createAdminUser: async (username, password) => {
    const { user } = await authProvider.createUser(username.trim(), password);
    const users = get().adminUsers;
    if (users) {
      set({ adminUsers: [...users, user].sort((a, b) => a.createdAt - b.createdAt) });
    }
    return user;
  },

  deleteAdminUser: async (userId, password) => {
    await authProvider.deleteUser(userId, password);
    const users = get().adminUsers;
    if (users) set({ adminUsers: users.filter((u) => u.id !== userId) });
  },
}));

/** Any API 401 means the session is gone - drop back to the sign-in screen. */
setUnauthorizedHandler(() => {
  if (useAuthStore.getState().status !== 'authed') return;
  flushSaves();
  window.location.reload();
});
