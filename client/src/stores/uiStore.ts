import { create } from 'zustand';
import type { ReactNode } from 'react';
import { uid } from '../lib/format';

/* ------------------------------- toasts --------------------------------- */

export type ToastKind = 'info' | 'success' | 'error';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: string;
  message: string;
  kind: ToastKind;
  action?: ToastAction;
}

/* ----------------------------- context menu ------------------------------ */

export interface MenuItem {
  id?: string;
  label?: string;
  icon?: ReactNode;
  onSelect?: () => void;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
}

export interface MenuState {
  x: number;
  y: number;
  items: MenuItem[];
  /** Optional aria label for the menu. */
  label?: string;
}

/* ------------------------------- dialogs --------------------------------- */

export type DialogState =
  | { type: 'createPlaylist'; trackIdHint?: string }
  | { type: 'addToPlaylist'; trackIds: string[] }
  | { type: 'editPlaylist'; playlistId: string }
  | { type: 'addSongsToPlaylist'; playlistId: string }
  | {
      type: 'confirm';
      title: string;
      message: string;
      confirmLabel?: string;
      danger?: boolean;
      onConfirm: () => void;
    }
  | { type: 'deleteUser'; userId: string; username: string }
  | { type: 'shortcuts' };

/* -------------------------------- store ---------------------------------- */

interface UiState {
  toasts: Toast[];
  menu: MenuState | null;
  dialog: DialogState | null;
  queueOpen: boolean;
  fullPlayerOpen: boolean;
  /** Full-player lyrics panel (Spotify-style side/toggle panel). */
  lyricsOpen: boolean;
  sidebarCollapsed: boolean;
  /** Bumped to focus the global search field (TopBar / mobile search). */
  searchFocusNonce: number;

  toast: (message: string, kind?: ToastKind, action?: ToastAction) => void;
  dismissToast: (id: string) => void;

  openMenu: (menu: MenuState) => void;
  closeMenu: () => void;

  openDialog: (dialog: DialogState) => void;
  closeDialog: () => void;

  setQueueOpen: (open: boolean) => void;
  toggleQueue: () => void;
  setFullPlayerOpen: (open: boolean) => void;
  setLyricsOpen: (open: boolean) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  focusSearch: () => void;
}

const TOAST_DURATION = 4200;

export const useUiStore = create<UiState>((set, get) => ({
  toasts: [],
  menu: null,
  dialog: null,
  queueOpen: false,
  fullPlayerOpen: false,
  lyricsOpen: true,
  sidebarCollapsed: false,
  searchFocusNonce: 0,

  toast: (message, kind = 'info', action) => {
    const t: Toast = { id: uid('toast'), message, kind, action };
    set((s) => ({ toasts: [...s.toasts.slice(-3), t] }));
    setTimeout(() => get().dismissToast(t.id), TOAST_DURATION);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  openMenu: (menu) => set({ menu }),
  closeMenu: () => set({ menu: null }),

  openDialog: (dialog) => set({ dialog }),
  closeDialog: () => set({ dialog: null }),

  setQueueOpen: (open) => set({ queueOpen: open }),
  toggleQueue: () => set((s) => ({ queueOpen: !s.queueOpen })),
  setFullPlayerOpen: (open) => set({ fullPlayerOpen: open }),
  setLyricsOpen: (open) => set({ lyricsOpen: open }),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  focusSearch: () => set((s) => ({ searchFocusNonce: s.searchFocusNonce + 1 })),
}));

/** Imperative helpers usable outside React (stores, engines, menus). */
export const ui = {
  toast: (message: string, kind?: ToastKind, action?: ToastAction) =>
    useUiStore.getState().toast(message, kind, action),
  openMenu: (menu: MenuState) => useUiStore.getState().openMenu(menu),
  closeMenu: () => useUiStore.getState().closeMenu(),
  openDialog: (dialog: DialogState) => useUiStore.getState().openDialog(dialog),
  closeDialog: () => useUiStore.getState().closeDialog(),
};
