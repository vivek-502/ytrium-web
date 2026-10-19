import React, { useEffect, useRef } from "react";
import Icon, { type IconName } from "./Icon";
import { cx } from "./UI";
import { useUiStore } from "../../stores/uiStore";

/** Keeps Tab focus inside the container while `active`; Escape closes. */
export function useFocusTrap(active: boolean, onClose?: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!active) return;
    const node = ref.current;
    const prev = document.activeElement as HTMLElement | null;
    const focusables = () =>
      Array.from(
        node?.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        ) ?? []
      ).filter((el) => !el.hasAttribute("disabled") && el.offsetParent !== null);
    const t = window.setTimeout(() => focusables()[0]?.focus(), 10);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && onClose) {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const list = focusables();
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("keydown", onKey, true);
      prev?.focus?.();
    };
  }, [active, onClose]);
  return ref;
}

/* ------------------------------------------------------------------ Dialog */

export const Dialog: React.FC<{
  open: boolean;
  onClose: () => void;
  title?: string;
  icon?: IconName;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}> = ({ open, onClose, title, icon, children, footer, wide }) => {
  const ref = useFocusTrap(open, onClose);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;
  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className={cx("dialog", wide && "dialog--wide")}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        {title && (
          <header className="dialog__head">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {icon && <Icon name={icon} size={18} />}
              <h2 className="dialog__title">{title}</h2>
            </div>
            <button className="icon-btn" aria-label="Close dialog" onClick={onClose} type="button">
              <Icon name="x" size={17} />
            </button>
          </header>
        )}
        <div className="dialog__body">{children}</div>
        {footer && <footer className="dialog__foot">{footer}</footer>}
      </div>
    </div>
  );
};

/* ------------------------------------------------------- confirmDialog flow
 * Promise-based confirm that rides on the shared uiStore dialog state so every
 * confirmation renders through the single DialogHost.
 */

let pendingConfirm: ((result: boolean) => void) | null = null;

function settleConfirm(result: boolean) {
  const fn = pendingConfirm;
  pendingConfirm = null;
  fn?.(result);
}

export function confirmDialog(opts: {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
}): Promise<boolean> {
  settleConfirm(false); // a previous dangling confirm resolves as cancelled
  return new Promise<boolean>((resolve) => {
    pendingConfirm = resolve;
    useUiStore.getState().openDialog({
      type: "confirm",
      title: opts.title,
      message: opts.message,
      confirmLabel: opts.confirmLabel,
      danger: opts.danger,
      onConfirm: () => settleConfirm(true),
    });
  });
}

/** Resolves the pending confirm promise when the dialog is dismissed. */
export function notifyConfirmClosed() {
  settleConfirm(false);
}
