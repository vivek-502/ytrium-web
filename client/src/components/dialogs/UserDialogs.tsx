import React, { useState } from "react";
import { Button } from "../common/UI";
import { Dialog } from "../common/Overlay";
import { useUiStore, ui } from "../../stores/uiStore";
import { useAuthStore } from "../../stores/authStore";
import { ApiError } from "../../providers/http";

/**
 * Admin delete-user confirmation. Deleting a user is only allowed with THAT
 * user's password - the admin neither knows nor can reset it, so the dialog
 * asks for it explicitly and shows server-side rejections inline.
 */
export const DeleteUserDialog: React.FC<{ userId: string; username: string }> = ({
  userId,
  username,
}) => {
  const closeDialog = useUiStore((s) => s.closeDialog);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    if (!password) {
      setError(`Enter ${username}'s password to confirm.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await useAuthStore.getState().deleteAdminUser(userId, password);
      ui.toast(`User “${username}” deleted`, "success");
      closeDialog();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Could not delete that user. Please try again."
      );
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={closeDialog}
      title={`Delete ${username}?`}
      icon="trash"
      footer={
        <>
          <Button variant="ghost" onClick={closeDialog} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => void submit()} disabled={busy}>
            {busy ? "Deleting…" : "Delete user"}
          </Button>
        </>
      }
    >
      <p style={{ fontSize: 14.5, color: "var(--text-secondary)", lineHeight: 1.6 }}>
        {username} will no longer be able to sign in. This needs {username}'s own password - admin
        accounts can delete users but can never see or reset their passwords.
      </p>
      <label className="field">
        <span className="field__label">{username}'s password</span>
        <input
          className="input"
          type="password"
          value={password}
          autoFocus
          autoComplete="off"
          maxLength={200}
          aria-label={`Password of ${username}`}
          onChange={(e) => {
            setPassword(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(e) => e.key === "Enter" && void submit()}
        />
      </label>
      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
};

export default DeleteUserDialog;
