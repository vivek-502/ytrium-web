import React from "react";
import { Button } from "../common/UI";
import { Dialog, notifyConfirmClosed } from "../common/Overlay";
import { useUiStore } from "../../stores/uiStore";
import {
  AddSongsToPlaylistDialog,
  AddToPlaylistDialog,
  CreatePlaylistDialog,
  EditPlaylistDialog,
} from "./PlaylistDialogs";
import { DeleteUserDialog } from "./UserDialogs";

/* --------------------------------------------------------------- shortcuts */

const SHORTCUTS: Array<[keys: string, action: string]> = [
  ["Space", "Play / pause"],
  ["← / →", "Seek 5 seconds"],
  ["Shift + ← / →", "Seek 10 seconds"],
  ["↑ / ↓", "Volume up / down"],
  ["M", "Mute / unmute"],
  ["N / P", "Next / previous track"],
  ["S", "Toggle shuffle"],
  ["R", "Cycle repeat mode"],
  ["Q", "Show / hide queue"],
  ["F", "Expand full player"],
  ["/", "Focus search"],
  ["?", "This help"],
  ["Esc", "Close dialog, menu or player"],
];

export const ShortcutsDialog: React.FC = () => {
  const closeDialog = useUiStore((s) => s.closeDialog);
  return (
    <Dialog
      open
      onClose={closeDialog}
      title="Keyboard shortcuts"
      icon="keyboard"
      wide
      footer={
        <Button variant="accent" onClick={closeDialog}>
          Got it
        </Button>
      }
    >
      <div className="chip-row" style={{ display: "grid", gap: 8 }}>
        {SHORTCUTS.map(([keys, action]) => (
          <div
            key={keys}
            className="hstack"
            style={{ justifyContent: "space-between", gap: 16, padding: "7px 2px" }}
          >
            <span style={{ fontSize: 14 }}>{action}</span>
            <kbd className="mono" style={{ color: "var(--text)", background: "var(--bg-3)", padding: "3px 9px", borderRadius: 7, border: "1px solid var(--border)" }}>
              {keys}
            </kbd>
          </div>
        ))}
      </div>
    </Dialog>
  );
};

/* ------------------------------------------------------------ confirm view */

const ConfirmView: React.FC<{
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
}> = ({ title, message, confirmLabel, danger, onConfirm }) => {
  const closeDialog = useUiStore((s) => s.closeDialog);
  const cancel = () => {
    closeDialog();
    notifyConfirmClosed();
  };
  return (
    <Dialog
      open
      onClose={cancel}
      title={title}
      icon={danger ? "trash" : "check"}
      footer={
        <>
          <Button variant="ghost" onClick={cancel}>
            Cancel
          </Button>
          <Button
            variant={danger ? "danger" : "accent"}
            onClick={() => {
              onConfirm();
              closeDialog();
              notifyConfirmClosed();
            }}
          >
            {confirmLabel ?? "Confirm"}
          </Button>
        </>
      }
    >
      <p style={{ fontSize: 14.5, color: "var(--text-secondary)", lineHeight: 1.6 }}>{message}</p>
    </Dialog>
  );
};

/* ------------------------------------------------------------------- host */

export const DialogHost: React.FC = () => {
  const dialog = useUiStore((s) => s.dialog);

  if (!dialog) return null;
  switch (dialog.type) {
    case "createPlaylist":
      return <CreatePlaylistDialog trackIdHint={dialog.trackIdHint} />;
    case "addToPlaylist":
      return <AddToPlaylistDialog trackIds={dialog.trackIds} />;
    case "editPlaylist":
      return <EditPlaylistDialog playlistId={dialog.playlistId} />;
    case "addSongsToPlaylist":
      return <AddSongsToPlaylistDialog playlistId={dialog.playlistId} />;
    case "deleteUser":
      return <DeleteUserDialog userId={dialog.userId} username={dialog.username} />;
    case "shortcuts":
      return <ShortcutsDialog />;
    case "confirm":
      return (
        <ConfirmView
          title={dialog.title}
          message={dialog.message}
          confirmLabel={dialog.confirmLabel}
          danger={dialog.danger}
          onConfirm={dialog.onConfirm}
        />
      );
    default:
      return null;
  }
};

export default DialogHost;
