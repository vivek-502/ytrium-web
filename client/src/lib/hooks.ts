import { useCallback, useEffect, useRef, useState } from 'react';

/** Debounce a fast-changing value (search inputs, filters). */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

/** Reactive media query (responsive layouts). */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false,
  );
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    setMatches(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

export function useIsMobile(): boolean {
  return useMediaQuery('(max-width: 767px)');
}

export function useIsTablet(): boolean {
  return useMediaQuery('(min-width: 768px) and (max-width: 1099px)');
}

/** Close menus/popovers when clicking or focusing outside. */
export function useClickOutside<T extends HTMLElement>(
  active: boolean,
  onOutside: () => void,
) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    if (!active) return;
    const handler = (e: Event) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside();
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('focusin', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('focusin', handler);
    };
  }, [active, onOutside]);
  return ref;
}

/** Stable callback ref that always sees the latest closure. */
export function useEventCallback<A extends unknown[], R>(fn: (...args: A) => R) {
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args: A) => ref.current(...args), []);
}

/** Save a value to localStorage when it changes (small UI preferences). */
export function usePersistentState<T>(key: string, initial: T): [T, (v: T | ((p: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (v: T | ((p: T) => T)) => {
      setValue((prev) => {
        const next = typeof v === 'function' ? (v as (p: T) => T)(prev) : v;
        try {
          localStorage.setItem(key, JSON.stringify(next));
        } catch {
          /* noop */
        }
        return next;
      });
    },
    [key],
  );
  return [value, set];
}
