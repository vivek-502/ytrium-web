import { http } from './http';
import type { AdminUser, AuthUser } from '../types';

/**
 * Auth API - username/password sign-in for the local multi-user setup.
 * All calls are same-origin, so the session cookie rides along automatically.
 */
export const authProvider = {
  /** Current session; `{ user: null }` when nobody is signed in. */
  me: () => http.get<{ user: AuthUser | null }>('/api/auth/me'),

  login: (username: string, password: string) =>
    http.post<{ user: AuthUser }>('/api/auth/login', { username, password }),

  logout: () => http.post<{ ok: true }>('/api/auth/logout', {}),

  /** Changes the signed-in user's own username and/or password. */
  changeCredentials: (body: { currentPassword: string; newUsername?: string; newPassword?: string }) =>
    http.post<{ user: AuthUser }>('/api/auth/change-credentials', body),

  /* ------------------------------------------------------------ admin */

  listUsers: () => http.get<{ users: AdminUser[] }>('/api/admin/users'),

  /** Password is set once, here - it can never be reset by an admin later. */
  createUser: (username: string, password: string) =>
    http.post<{ user: AdminUser }>('/api/admin/users', { username, password }),

  /** Deleting requires the target user's password (privacy rule). */
  deleteUser: (userId: string, password: string) =>
    http.delete<{ ok: true }>(`/api/admin/users/${encodeURIComponent(userId)}`, { password }),
};
