import React from "react";
import Icon, { type IconName } from "./Icon";
import { useUiStore, type ToastKind } from "../../stores/uiStore";

const iconFor = (kind: ToastKind): IconName =>
  kind === "success" ? "check" : kind === "error" ? "warning" : "info";

export const ToastHost: React.FC = () => {
  const toasts = useUiStore((s) => s.toasts);
  const dismiss = useUiStore((s) => s.dismissToast);

  return (
    <div className="toast-host" role="region" aria-label="Notifications">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`toast toast--${t.kind}`}
          role={t.kind === "error" ? "alert" : "status"}
          aria-live={t.kind === "error" ? "assertive" : "polite"}
        >
          <span className="toast__icon">
            <Icon name={iconFor(t.kind)} size={17} />
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>{t.message}</span>
          {t.action && (
            <button
              type="button"
              className="toast__action"
              onClick={() => {
                dismiss(t.id);
                t.action?.onClick();
              }}
            >
              {t.action.label}
            </button>
          )}
          <button
            type="button"
            className="icon-btn"
            style={{ width: 26, height: 26 }}
            aria-label="Dismiss notification"
            onClick={() => dismiss(t.id)}
          >
            <Icon name="x" size={13} />
          </button>
        </div>
      ))}
    </div>
  );
};
