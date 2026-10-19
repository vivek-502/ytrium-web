import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import Icon from "./Icon";
import { useUiStore } from "../../stores/uiStore";

const VIEW_MARGIN = 8;
const ESTIMATED_W = 240;

/**
 * Renders the uiStore context menu (opened via `ui.openMenu`). Items use the
 * store's shape: `{ label, icon: ReactNode, onSelect, danger, separator }`.
 */
export const MenuHost: React.FC = () => {
  const menu = useUiStore((s) => s.menu);
  const closeMenu = useUiStore((s) => s.closeMenu);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    if (!menu) {
      setPos(null);
      return;
    }
    const node = ref.current;
    const w = node?.offsetWidth || ESTIMATED_W;
    const h = node?.offsetHeight || 220;
    let x = menu.x;
    let y = menu.y;
    if (x + w > window.innerWidth - VIEW_MARGIN) x = Math.max(VIEW_MARGIN, menu.x - w);
    if (y + h > window.innerHeight - VIEW_MARGIN) y = Math.max(VIEW_MARGIN, menu.y - h);
    setPos({ x, y });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) closeMenu();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMenu();
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const items = Array.from(
          ref.current?.querySelectorAll<HTMLButtonElement>(".menu__item:not(:disabled)") ?? []
        );
        if (!items.length) return;
        e.preventDefault();
        const idx = items.indexOf(document.activeElement as HTMLButtonElement);
        const next =
          e.key === "ArrowDown"
            ? items[(idx + 1) % items.length]
            : items[(idx - 1 + items.length) % items.length];
        next.focus();
      }
    };
    const onScroll = () => closeMenu();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onScroll);
    window.addEventListener("wheel", onScroll, { passive: true });
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("wheel", onScroll);
    };
  }, [menu, closeMenu]);

  useEffect(() => {
    if (!menu) return;
    const t = window.setTimeout(() => {
      ref.current?.querySelector<HTMLButtonElement>(".menu__item:not(:disabled)")?.focus();
    }, 0);
    return () => window.clearTimeout(t);
  }, [menu]);

  if (!menu) return null;

  return (
    <div
      ref={ref}
      className="menu"
      role="menu"
      aria-label={menu.label ?? "Context menu"}
      style={{
        left: pos ? pos.x : menu.x,
        top: pos ? pos.y : menu.y,
        visibility: pos ? "visible" : "hidden",
      }}
    >
      {menu.items.map((item, i) => {
        const key = `cm-${i}`;
        if (item.separator || !item.label)
          return <div key={key} className="menu__separator" role="separator" />;
        if (!item.onSelect)
          return (
            <div key={key} className="menu__label">
              {item.label}
            </div>
          );
        return (
          <button
            key={key}
            type="button"
            role="menuitem"
            className={["menu__item", item.danger ? "menu__item--danger" : ""].join(" ")}
            disabled={item.disabled}
            onClick={() => {
              closeMenu();
              item.onSelect?.();
            }}
          >
            <span className="menu__icon">{item.icon ?? <Icon name="chevron-right" size={14} />}</span>
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
};
