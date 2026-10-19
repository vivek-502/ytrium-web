import { create } from 'zustand';
import { ACCENT_KEYS, DEFAULT_SETTINGS, type Settings } from '../types';
import { prefStorage, SETTINGS_KEY } from '../lib/storage';

/**
 * Applies theme/accent/motion preferences to the document root. Unknown
 * accent keys (written by an older build) fall back to the default so the
 * UI never renders with a colour that has no token block.
 */
export function applySettingsToDom(s: Settings): void {
  const root = document.documentElement;
  root.dataset.theme = s.theme === 'light' ? 'light' : 'dark';
  root.dataset.accent = (ACCENT_KEYS as readonly string[]).includes(s.accent)
    ? s.accent
    : DEFAULT_SETTINGS.accent;
  root.dataset.compact = s.compactMode ? 'on' : 'off';
  root.dataset.motion = s.reduceMotion ? 'reduced' : 'full';
  root.style.colorScheme = s.theme;
}

interface SettingsState {
  settings: Settings;
  hydrated: boolean;
  hydrate: () => void;
  update: (patch: Partial<Settings>) => void;
  reset: () => void;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  hydrated: false,

  hydrate: () => {
    if (get().hydrated) return;
    const stored = prefStorage.get<Partial<Settings>>(SETTINGS_KEY, {});
    const settings: Settings = { ...DEFAULT_SETTINGS, ...stored };
    // Legacy/imported values may name an accent that no longer exists.
    if (!(ACCENT_KEYS as readonly string[]).includes(settings.accent)) {
      settings.accent = DEFAULT_SETTINGS.accent;
    }
    if (settings.theme !== 'light' && settings.theme !== 'dark') {
      settings.theme = DEFAULT_SETTINGS.theme;
    }
    applySettingsToDom(settings);
    set({ settings, hydrated: true });
  },

  update: (patch) => {
    const settings = { ...get().settings, ...patch };
    applySettingsToDom(settings);
    prefStorage.set(SETTINGS_KEY, settings);
    set({ settings });
  },

  reset: () => {
    applySettingsToDom(DEFAULT_SETTINGS);
    prefStorage.remove(SETTINGS_KEY);
    set({ settings: DEFAULT_SETTINGS });
  },
}));

export const getSettings = () => useSettingsStore.getState().settings;
