import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Icon, { type IconName } from "./Icon";
import type { MenuItem } from "../../stores/uiStore";

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/* ------------------------------------------------------------------ Button */

export type ButtonVariant = "primary" | "accent" | "ghost" | "soft" | "danger";
export const Button: React.FC<
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: ButtonVariant;
    icon?: IconName;
    small?: boolean;
    large?: boolean;
    block?: boolean;
  }
> = ({ variant = "primary", icon, small, large, block, className, children, ...rest }) => (
  <button
    className={cx(
      "btn",
      variant !== "primary" && `btn--${variant}`,
      small && "btn--sm",
      large && "btn--lg",
      className,
    )}
    style={block ? { width: "100%" } : undefined}
    {...rest}
  >
    {icon && <Icon name={icon} size={small ? 15 : 16} />}
    {children !== undefined && children !== null && <span>{children}</span>}
  </button>
);

/* --------------------------------------------------------------- IconButton */

export const IconButton: React.FC<
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    icon: IconName;
    label: string;
    active?: boolean;
    /** Visual size of the glyph. */
    size?: 14 | 15 | 16 | 17 | 18 | 20 | 22 | 24;
    /** Box size variant: default 36px, md 44px, lg 52px. */
    box?: "default" | "md" | "lg";
    filled?: boolean;
  }
> = ({ icon, label, active, size = 18, box = "default", filled, className, ...rest }) => (
  <button
    className={cx(
      "icon-btn",
      active && "icon-btn--active",
      box !== "default" && `icon-btn--${box}`,
      filled && "icon-btn--filled",
      className,
    )}
    aria-label={label}
    title={label}
    aria-pressed={active === undefined ? undefined : active}
    {...rest}
  >
    <Icon name={icon} size={size} />
  </button>
);

/* ----------------------------------------------------------------- Spinner */

export const Spinner: React.FC<{ large?: boolean; className?: string; label?: string }> = ({
  large,
  className,
  label = "Loading",
}) => (
  <span className={cx("spinner", large && "spinner--lg", className)} role="status" aria-label={label} />
);

/* ---------------------------------------------------------------- Skeleton */

export const Skeleton: React.FC<{
  w?: string | number;
  h?: string | number;
  r?: number;
  art?: boolean;
  className?: string;
}> = ({ w = "100%", h, r, art, className }) => (
  <span
    className={cx("skeleton", art ? "skeleton--art" : "skeleton--text", className)}
    style={{
      width: w,
      height: art ? undefined : h,
      borderRadius: r,
    }}
  />
);

export const CardSkeleton: React.FC = () => (
  <div className="skeleton-card" aria-hidden>
    <Skeleton art />
    <Skeleton w="72%" />
    <Skeleton w="45%" />
  </div>
);

export const RowSkeleton: React.FC = () => (
  <div className="track-row" aria-hidden>
    <Skeleton w={18} h={13} className="track-row__index" />
    <div className="track-row__main">
      <Skeleton w={40} h={40} r={6} />
      <div style={{ flex: 1 }}>
        <Skeleton w="70%" />
        <span style={{ display: "block", height: 6 }} />
        <Skeleton w="40%" />
      </div>
    </div>
    <Skeleton w="60%" className="track-row__album" />
    <Skeleton w="50%" className="track-row__date" />
    <Skeleton w="34px" className="track-row__duration" />
    <span className="track-row__actions" />
  </div>
);

/* -------------------------------------------------------------- EmptyState */

export const EmptyState: React.FC<{
  icon?: IconName;
  title: string;
  message?: string;
  action?: React.ReactNode;
}> = ({ icon = "music", title, message, action }) => (
  <div className="empty-state" role="status">
    <span className="empty-state__icon">
      <Icon name={icon} size={26} />
    </span>
    <h3 className="empty-state__title">{title}</h3>
    {message && <p className="empty-state__text">{message}</p>}
    {action}
  </div>
);

export const ErrorBanner: React.FC<{ message: string; action?: React.ReactNode }> = ({
  message,
  action,
}) => (
  <div className="error-banner" role="alert">
    <span className="error-banner__icon">
      <Icon name="warning" size={18} />
    </span>
    <span style={{ flex: 1 }}>{message}</span>
    {action}
  </div>
);

/* ----------------------------------------------------------------- Artwork */

export const Artwork: React.FC<{
  src?: string | null;
  alt: string;
  /** Any CSS length; defaults to filling the parent. */
  size?: number | string;
  className?: string;
  icon?: IconName;
  badge?: string;
  onClick?: React.MouseEventHandler<HTMLElement>;
}> = ({ src, alt, size, className, icon = "music", badge, onClick }) => {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const style: React.CSSProperties =
    size !== undefined ? { width: size, height: size } : {};

  if (!src || failed) {
    return (
      <div
        className={cx("artwork", "artwork--fallback", className)}
        style={style}
        role="img"
        aria-label={alt}
        onClick={onClick}
      >
        <Icon name={icon} size={typeof size === "number" ? Math.max(16, size * 0.36) : 22} />
        {badge && <span className="artwork__badge">{badge}</span>}
      </div>
    );
  }
  return (
    <div className={cx("artwork", className)} style={style} role="img" aria-label={alt} onClick={onClick}>
      <img src={src} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setFailed(true)} />
      {badge && <span className="artwork__badge">{badge}</span>}
    </div>
  );
};

/* ----------------------------------------------------------------- Slider */

export function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

export const Slider: React.FC<{
  /** 0..1 */
  value: number;
  onChange: (v: number) => void;
  onCommit?: (v: number) => void;
  label: string;
  step?: number;
  className?: string;
  muted?: boolean;
  ariaValueText?: (v: number) => string;
}> = ({ value, onChange, onCommit, label, className, muted, ariaValueText }) => {
  const [dragging, setDragging] = useState(false);
  const [local, setLocal] = useState(value);
  const shown = dragging ? local : value;
  const pct = clamp(shown, 0, 1) * 100;

  const commit = (v: number) => {
    setDragging(false);
    onCommit?.(v);
  };

  return (
    <div
      className={cx("slider", muted && "slider--muted", className)}
      onPointerDown={(e) => {
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        setDragging(true);
        const rect = e.currentTarget.getBoundingClientRect();
        const v = clamp((e.clientX - rect.left) / rect.width, 0, 1);
        setLocal(v);
        onChange(v);
      }}
      onPointerMove={(e) => {
        if (!dragging) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const v = clamp((e.clientX - rect.left) / rect.width, 0, 1);
        setLocal(v);
        onChange(v);
      }}
      onPointerUp={(e) => {
        if (!dragging) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const v = clamp((e.clientX - rect.left) / rect.width, 0, 1);
        setLocal(v);
        commit(v);
      }}
      onPointerCancel={() => dragging && commit(local)}
      onKeyDown={(e) => {
        let next = shown;
        if (e.key === "ArrowRight" || e.key === "ArrowUp") next = shown + 0.05;
        else if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = shown - 0.05;
        else if (e.key === "Home") next = 0;
        else if (e.key === "End") next = 1;
        else return;
        e.preventDefault();
        next = clamp(next, 0, 1);
        setLocal(next);
        onChange(next);
        onCommit?.(next);
      }}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      aria-valuetext={ariaValueText ? ariaValueText(shown) : `${Math.round(pct)}%`}
    >
      <div className="slider__track">
        <div className="slider__fill" style={{ width: `${pct}%` }} />
        <div className="slider__thumb" style={{ left: `${pct}%` }} />
      </div>
    </div>
  );
};

/* ------------------------------------------------------------- DropdownMenu */

/**
 * Menu entries use the shared uiStore `MenuItem` shape so the dropdown and the
 * global context menu render identical content.
 */
export type MenuEntry = MenuItem;

function renderEntries(entries: MenuEntry[], onPick: () => void, keyPrefix: string) {
  return entries.map((entry, i) => {
    const key = `${keyPrefix}-${i}`;
    if (entry.separator || !entry.label)
      return <div key={key} className="menu__separator" role="separator" />;
    if (!entry.onSelect)
      return (
        <div key={key} className="menu__label">
          {entry.label}
        </div>
      );
    return (
      <button
        key={key}
        type="button"
        role="menuitem"
        className={cx("menu__item", entry.danger && "menu__item--danger")}
        disabled={entry.disabled}
        onClick={() => {
          onPick();
          entry.onSelect?.();
        }}
      >
        <span className="menu__icon">{entry.icon ?? null}</span>
        <span>{entry.label}</span>
      </button>
    );
  });
}

/** Button-triggered dropdown menu (used for toolbars and inline actions). */
export const DropdownMenu: React.FC<{
  entries: MenuEntry[];
  trigger: (open: () => void) => React.ReactNode;
  align?: "start" | "end";
  className?: string;
  ariaLabel?: string;
}> = ({ entries, trigger, align = "end", className, ariaLabel = "Menu" }) => {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  /**
   * The menu is `position: fixed`, so it is measured against the viewport.
   * Cards apply a hover transform, which makes them a containing block for
   * fixed descendants - rendering the menu inside the card would place it
   * relative to the card instead of the window. A portal into <body> keeps
   * the coordinates honest.
   */
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const node = menuRef.current;
    const width = node?.offsetWidth || 240;
    const height = node?.offsetHeight || 200;
    let x = align === "end" ? rect.right - width : rect.left;
    let y = rect.bottom + 6;
    x = clamp(x, 8, Math.max(8, window.innerWidth - width - 8));
    // Flip above the trigger when there is no room below.
    if (y + height > window.innerHeight - 8) {
      y = Math.max(8, rect.top - height - 6);
    }
    setPos({ x, y });
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (wrapRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onScroll = () => setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onScroll);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onScroll);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className={cx("menu-wrap", className)} style={{ position: "relative", display: "inline-flex" }}>
      {trigger(() => setOpen((o) => !o))}
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="menu"
            role="menu"
            aria-label={ariaLabel}
            style={
              pos
                ? { left: pos.x, top: pos.y, visibility: "visible" }
                : {
                    left: align === "end" ? "auto" : 0,
                    right: align === "end" ? 0 : "auto",
                    top: 0,
                    visibility: "hidden",
                  }
            }
          >
            {renderEntries(entries, () => setOpen(false), "mi")}
          </div>,
          document.body
        )}
    </div>
  );
};

export { renderEntries };
