import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSettingsStore } from "../stores/settingsStore";
import { useLibraryStore } from "../stores/libraryStore";
import { usePlayerStore } from "../stores/playerStore";
import { useAuthStore } from "../stores/authStore";
import { authProvider } from "../providers/authProvider";
import { ApiError } from "../providers/http";
import { ui } from "../stores/uiStore";
import { confirmDialog } from "../components/common/Overlay";
import { Button, Slider, cx } from "../components/common/UI";
import { flushSaves } from "../lib/storage";
import { applyImport, buildExportPayload, downloadExport, parseImportFile } from "../lib/exportImport";
import { pluralize } from "../lib/format";
import type { AccentKey, AudioQuality, Settings as SettingsType, Theme } from "../types";

/* ------------------------------------------------------------------ atoms */

const Switch: React.FC<{
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}> = ({ checked, onChange, label }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    className="switch"
    onClick={() => onChange(!checked)}
  />
);

const Segmented: React.FC<{
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  ariaLabel: string;
}> = ({ value, options, onChange, ariaLabel }) => (
  <div className="seg" role="radiogroup" aria-label={ariaLabel}>
    {options.map((opt) => (
      <button
        key={opt.value}
        type="button"
        role="radio"
        aria-checked={value === opt.value}
        className={cx(value === opt.value && "is-active")}
        onClick={() => onChange(opt.value)}
      >
        {opt.label}
      </button>
    ))}
  </div>
);

const SettingRow: React.FC<{
  title: string;
  desc?: string;
  control: React.ReactNode;
}> = ({ title, desc, control }) => (
  <div className="setting-row">
    <div style={{ minWidth: 0 }}>
      <div className="setting-row__title">{title}</div>
      {desc && <div className="setting-row__desc">{desc}</div>}
    </div>
    {control}
  </div>
);

/* --------------------------------------------------------- accent swatches */

const ACCENTS: Array<{ key: AccentKey; label: string; color: string }> = [
  { key: "purple", label: "Purple", color: "#757de8" },
  { key: "indigo", label: "Indigo", color: "#7986cb" },
  { key: "blue", label: "Blue", color: "#64b5f6" },
  { key: "teal", label: "Teal", color: "#4db6ac" },
  { key: "green", label: "Green", color: "#81c784" },
  { key: "pink", label: "Pink", color: "#f06292" },
];

/** Mirrors the server's username rule so obvious mistakes never round-trip. */
const USERNAME_RE = /^[A-Za-z0-9._-]{3,32}$/;

/* ------------------------------------------------------------------ page */

const Settings: React.FC = () => {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const resetSettings = useSettingsStore((s) => s.reset);

  const playlists = useLibraryStore((s) => s.playlists);
  const liked = useLibraryStore((s) => s.liked);
  const history = useLibraryStore((s) => s.history);
  const searchHistory = useLibraryStore((s) => s.searchHistory);
  const catalog = useLibraryStore((s) => s.catalog);
  const clearListeningData = useLibraryStore((s) => s.clearListeningData);
  const clearSearchHistory = useLibraryStore((s) => s.clearSearchHistory);

  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);

  /* ------------------------------------------------------------ account */
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const [newUsername, setNewUsername] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [savingAccount, setSavingAccount] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);

  /* --------------------------------------------------- admin user admin */
  const isAdmin = user?.role === "admin";
  const adminUsers = useAuthStore((s) => s.adminUsers);
  const adminUsersError = useAuthStore((s) => s.adminUsersError);
  const loadAdminUsers = useAuthStore((s) => s.loadAdminUsers);
  const [createName, setCreateName] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    if (isAdmin) void loadAdminUsers();
  }, [isAdmin, loadAdminUsers]);

  const patch = (p: Partial<SettingsType>) => update(p);

  const stats = useMemo(
    () => ({
      playlists: playlists.length,
      liked: Object.keys(liked).length,
      history: history.length,
      searches: searchHistory.length,
      catalog: Object.keys(catalog).length,
    }),
    [playlists, liked, history, searchHistory, catalog]
  );

  /* ------------------------------------------------------------ data ops */

  const exportData = async () => {
    setExporting(true);
    try {
      const payload = await buildExportPayload();
      downloadExport(payload);
      ui.toast("Library exported as JSON", "success");
    } catch {
      ui.toast("Export failed - your data was not changed", "error");
    } finally {
      setExporting(false);
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImporting(true);
    try {
      const payload = await parseImportFile(file);
      const summary = await applyImport(payload);
      const bits: string[] = [];
      if (summary.playlists) bits.push(pluralize(summary.playlists, "playlist"));
      if (summary.liked) bits.push(pluralize(summary.liked, "liked song"));
      if (summary.history) bits.push(pluralize(summary.history, "history entry"));
      if (summary.settings) bits.push("settings");
      if (bits.length === 0) {
        ui.toast("Nothing new was found in that export", "info");
        return;
      }
      ui.toast(`Imported ${bits.join(", ")}`, "success");
    } catch (err) {
      ui.toast(
        err instanceof Error && err.name === "ImportError"
          ? err.message
          : "Import failed - nothing was changed",
        "error"
      );
    } finally {
      setImporting(false);
    }
  };

  const wipeListeningData = async () => {
    const ok = await confirmDialog({
      title: "Clear listening data?",
      message:
        "History, search history and recommendation signals will be deleted. Playlists, liked songs and settings stay where they are.",
      confirmLabel: "Clear data",
      danger: true,
    });
    if (ok) clearListeningData();
  };

  const wipeSearchHistory = async () => {
    const ok = await confirmDialog({
      title: "Clear search history?",
      message: "Your recent search terms will be removed from this device.",
      confirmLabel: "Clear searches",
      danger: true,
    });
    if (ok) {
      clearSearchHistory();
      ui.toast("Search history cleared", "success");
    }
  };

  const resetEverything = async () => {
    const ok = await confirmDialog({
      title: "Reset Ytrium?",
      message:
        "This deletes EVERYTHING stored on this device - playlists, liked songs, history, settings and the player queue - and reloads the app. It cannot be undone. Export your library first if you want a backup.",
      confirmLabel: "Reset everything",
      danger: true,
    });
    if (!ok) return;
    ui.toast("Resetting Ytrium…", "info");
    flushSaves();
    await useLibraryStore.getState().resetApplication();
  };

  const restoreDefaults = async () => {
    const ok = await confirmDialog({
      title: "Restore default settings?",
      message: "Playback and appearance preferences go back to their defaults. Your library is untouched.",
      confirmLabel: "Restore defaults",
    });
    if (ok) {
      resetSettings();
      ui.toast("Settings restored to defaults", "success");
    }
  };

  /* ---------------------------------------------------------- account ops */

  const signOut = async () => {
    await useAuthStore.getState().logout();
  };

  const saveCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingAccount) return;
    const wantName = newUsername.trim();
    const wantPassword = newPassword;

    if (!currentPassword) {
      setAccountError("Enter your current password.");
      return;
    }
    if (!wantName && !wantPassword) {
      setAccountError("Enter a new username, a new password, or both.");
      return;
    }
    if (wantName && !USERNAME_RE.test(wantName)) {
      setAccountError(
        "Usernames must be 3-32 characters using letters, numbers, dots, dashes or underscores."
      );
      return;
    }
    if (wantPassword && wantPassword.length < 4) {
      setAccountError("The new password must be at least 4 characters.");
      return;
    }

    setSavingAccount(true);
    setAccountError(null);
    try {
      const { user: updated } = await authProvider.changeCredentials({
        currentPassword,
        ...(wantName ? { newUsername: wantName } : {}),
        ...(wantPassword ? { newPassword: wantPassword } : {}),
      });
      setUser(updated);
      const bits = [wantName && "username", wantPassword && "password"].filter(Boolean);
      ui.toast(`Updated your ${bits.join(" and ")}`, "success");
      setNewUsername("");
      setCurrentPassword("");
      setNewPassword("");
    } catch (err) {
      setAccountError(
        err instanceof ApiError ? err.message : "Could not save your changes. Please try again."
      );
    } finally {
      setSavingAccount(false);
    }
  };

  /* ---------------------------------------------------------- admin ops */

  const createNewUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (creating) return;
    const name = createName.trim();
    if (!name || !createPassword) {
      setCreateError("Enter a username and a password for the new user.");
      return;
    }
    if (!USERNAME_RE.test(name)) {
      setCreateError(
        "Usernames must be 3-32 characters using letters, numbers, dots, dashes or underscores."
      );
      return;
    }
    if (createPassword.length < 4) {
      setCreateError("The password must be at least 4 characters.");
      return;
    }

    setCreating(true);
    setCreateError(null);
    try {
      const created = await useAuthStore.getState().createAdminUser(name, createPassword);
      ui.toast(`User “${created.username}” created`, "success");
      setCreateName("");
      setCreatePassword("");
    } catch (err) {
      setCreateError(
        err instanceof ApiError ? err.message : "Could not create that user. Please try again."
      );
    } finally {
      setCreating(false);
    }
  };

  // Only reachable with a session, but keep the compiler honest.
  if (!user) return null;

  return (
    <div className="page" style={{ maxWidth: 860 }}>
      <header style={{ padding: "18px 0 6px" }}>
        <h1 style={{ fontSize: "clamp(26px, 4vw, 36px)", fontWeight: 900, letterSpacing: "-0.03em" }}>
          Settings
        </h1>
        <p className="text-muted" style={{ fontSize: 13.5, marginTop: 4 }}>
          Everything here belongs to your account and stays on this device - no syncing, nothing
          leaves your browser except music requests to the provider.
        </p>
      </header>

      {/* ---------------------------------------------------------- account */}
      <section className="settings-group" aria-labelledby="set-account">
        <h2 className="settings-group__title" id="set-account">
          Account
        </h2>
        <p className="settings-group__hint">
          Signed in as <strong>{user.username}</strong>
          {isAdmin && " · admin"}. Renaming yourself or changing your password always requires your
          current password - nobody else can do it for you.
        </p>

        <form className="account-form" onSubmit={(e) => void saveCredentials(e)} noValidate>
          <div className="account-form__row">
            <label className="field">
              <span className="field__label">New username</span>
              <input
                className="input"
                value={newUsername}
                placeholder={user.username}
                aria-label="New username"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={32}
                onChange={(e) => {
                  setNewUsername(e.target.value);
                  if (accountError) setAccountError(null);
                }}
              />
            </label>
            <label className="field">
              <span className="field__label">New password</span>
              <input
                className="input"
                type="password"
                value={newPassword}
                placeholder="Leave empty to keep it"
                aria-label="New password"
                autoComplete="new-password"
                maxLength={200}
                onChange={(e) => {
                  setNewPassword(e.target.value);
                  if (accountError) setAccountError(null);
                }}
              />
            </label>
          </div>
          <label className="field">
            <span className="field__label">Current password</span>
            <input
              className="input"
              type="password"
              value={currentPassword}
              placeholder="Required to save changes"
              aria-label="Current password"
              autoComplete="current-password"
              maxLength={200}
              onChange={(e) => {
                setCurrentPassword(e.target.value);
                if (accountError) setAccountError(null);
              }}
            />
          </label>

          {accountError && (
            <p className="field__error" role="alert">
              {accountError}
            </p>
          )}

          <div className="account-form__actions">
            <Button type="submit" variant="accent" disabled={savingAccount}>
              {savingAccount ? "Saving…" : "Save changes"}
            </Button>
            <span className="spacer" />
            <Button type="button" variant="ghost" icon="logout" onClick={() => void signOut()}>
              Sign out
            </Button>
          </div>
        </form>
      </section>

      {/* ------------------------------------------------- admin: accounts */}
      {isAdmin && (
        <section className="settings-group" aria-labelledby="set-admin">
          <h2 className="settings-group__title" id="set-admin">
            Users
          </h2>
          <p className="settings-group__hint">
            Create accounts for the people using this instance. A password is set once, at creation
            - you cannot see or reset it afterwards; every user changes their own from their
            settings. Deleting an account requires that user's password.
          </p>

          <form className="admin-create" onSubmit={(e) => void createNewUser(e)} noValidate>
            <label className="field">
              <span className="field__label">Username</span>
              <input
                className="input"
                value={createName}
                placeholder="e.g. mia"
                aria-label="New user username"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={32}
                onChange={(e) => {
                  setCreateName(e.target.value);
                  if (createError) setCreateError(null);
                }}
              />
            </label>
            <label className="field">
              <span className="field__label">Password</span>
              <input
                className="input"
                type="password"
                value={createPassword}
                placeholder="At least 4 characters"
                aria-label="New user password"
                autoComplete="new-password"
                maxLength={200}
                onChange={(e) => {
                  setCreatePassword(e.target.value);
                  if (createError) setCreateError(null);
                }}
              />
            </label>
            <Button type="submit" variant="accent" icon="plus" disabled={creating}>
              {creating ? "Creating…" : "Create user"}
            </Button>
          </form>

          {createError && (
            <p className="field__error" role="alert">
              {createError}
            </p>
          )}
          {adminUsersError && (
            <p className="field__error" role="alert">
              {adminUsersError}
            </p>
          )}
          {adminUsers !== null && adminUsers.length === 0 && !adminUsersError && (
            <p className="field__hint">No accounts exist yet.</p>
          )}
          {adminUsers && adminUsers.length > 0 && (
            <ul className="admin-users">
              {adminUsers.map((u) => (
                <li key={u.id} className="admin-user-row">
                  <span className="admin-user-row__name truncate">
                    <span className="admin-user-row__username">{u.username}</span>
                    {u.role === "admin" && <span className="badge badge--accent">admin</span>}
                    {u.id === user.id && <span className="badge">you</span>}
                  </span>
                  <span className="text-muted admin-user-row__meta">
                    joined {new Date(u.createdAt).toLocaleDateString()}
                  </span>
                  <Button
                    variant="ghost"
                    icon="trash"
                    small
                    disabled={u.id === user.id}
                    title={u.id === user.id ? "You cannot delete your own account" : undefined}
                    onClick={() =>
                      ui.openDialog({ type: "deleteUser", userId: u.id, username: u.username })
                    }
                  >
                    Delete
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <p className="field__hint">{pluralize(adminUsers?.length ?? 0, "account")} on this instance.</p>
        </section>
      )}

      {/* --------------------------------------------------------- playback */}
      <section className="settings-group" aria-labelledby="set-playback">
        <h2 className="settings-group__title" id="set-playback">
          Playback
        </h2>
        <p className="settings-group__hint">How the player behaves while music is running.</p>

        <SettingRow
          title="Autoplay"
          desc="When the queue runs out, keep the music going with similar tracks."
          control={
            <Switch
              label="Autoplay"
              checked={settings.autoplay}
              onChange={(v) => patch({ autoplay: v })}
            />
          }
        />

        <SettingRow
          title="Crossfade"
          desc={
            settings.crossfadeSeconds > 0
              ? `Fade ${settings.crossfadeSeconds}s into the next track.`
              : "Off - tracks play back to back with a hard cut."
          }
          control={
            <div className="range-row">
              <Slider
                value={settings.crossfadeSeconds / 12}
                label="Crossfade duration"
                ariaValueText={(v) =>
                  Math.round(v * 12) === 0 ? "Off" : `${Math.round(v * 12)} seconds`
                }
                onChange={(v) => patch({ crossfadeSeconds: Math.round(v * 12) })}
              />
              <span className="text-muted" style={{ fontSize: 13, minWidth: 52, textAlign: "right" }}>
                {settings.crossfadeSeconds === 0 ? "Off" : `${settings.crossfadeSeconds}s`}
              </span>
            </div>
          }
        />

        <SettingRow
          title="Audio quality"
          desc="High streams a clearer source when the provider offers one; low starts faster on slow connections."
          control={
            <Segmented
              ariaLabel="Audio quality"
              value={settings.audioQuality}
              options={[
                { value: "auto", label: "Auto" },
                { value: "high", label: "High" },
                { value: "low", label: "Low" },
              ]}
              onChange={(v) => patch({ audioQuality: v as AudioQuality })}
            />
          }
        />

        <SettingRow
          title="Volume normalization"
          desc="Even out loud and quiet tracks so you are not reaching for the volume."
          control={
            <Switch
              label="Volume normalization"
              checked={settings.normalizeVolume}
              onChange={(v) => patch({ normalizeVolume: v })}
            />
          }
        />
      </section>

      {/* ------------------------------------------------------- appearance */}
      <section className="settings-group" aria-labelledby="set-appearance">
        <h2 className="settings-group__title" id="set-appearance">
          Appearance
        </h2>
        <p className="settings-group__hint">Theme, accent and how dense the interface feels.</p>

        <SettingRow
          title="Theme"
          desc="Dark is kinder at night; light holds up in sunlight."
          control={
            <Segmented
              ariaLabel="Theme"
              value={settings.theme}
              options={[
                { value: "dark", label: "Dark" },
                { value: "light", label: "Light" },
              ]}
              onChange={(v) => patch({ theme: v as Theme })}
            />
          }
        />

        <SettingRow
          title="Accent color"
          desc="The highlight color used across buttons, sliders and the player."
          control={
            <div className="swatches" role="radiogroup" aria-label="Accent color">
              {ACCENTS.map((accent) => (
                <button
                  key={accent.key}
                  type="button"
                  role="radio"
                  aria-checked={settings.accent === accent.key}
                  aria-label={accent.label}
                  title={accent.label}
                  className={cx("swatch", settings.accent === accent.key && "is-active")}
                  style={{ background: accent.color }}
                  onClick={() => patch({ accent: accent.key })}
                />
              ))}
            </div>
          }
        />

        <SettingRow
          title="Compact mode"
          desc="Tighter rows and smaller gaps - more on screen at once."
          control={
            <Switch
              label="Compact mode"
              checked={settings.compactMode}
              onChange={(v) => patch({ compactMode: v })}
            />
          }
        />

        <SettingRow
          title="Reduce motion"
          desc="Turn off transitions and animated effects throughout the app."
          control={
            <Switch
              label="Reduce motion"
              checked={settings.reduceMotion}
              onChange={(v) => patch({ reduceMotion: v })}
            />
          }
        />
      </section>

      {/* ------------------------------------------------------------ data */}
      <section className="settings-group" aria-labelledby="set-data">
        <h2 className="settings-group__title" id="set-data">
          Your data
        </h2>
        <p className="settings-group__hint">
          {pluralize(stats.playlists, "playlist")} · {pluralize(stats.liked, "liked song")} ·{" "}
          {pluralize(stats.history, "history entry")} · {pluralize(stats.searches, "recent search")} ·{" "}
          {pluralize(stats.catalog, "known track")} stored locally.
        </p>

        <SettingRow
          title="Export library"
          desc="Download playlists, likes, history and settings as a JSON file."
          control={
            <Button variant="soft" icon="copy" onClick={() => void exportData()} disabled={exporting}>
              {exporting ? "Exporting…" : "Export JSON"}
            </Button>
          }
        />

        <SettingRow
          title="Import library"
          desc="Merge playlists, likes, history and settings from an export file. Nothing on this device is overwritten or removed."
          control={
            <>
              <input
                ref={importRef}
                type="file"
                accept=".json,application/json"
                aria-hidden="true"
                tabIndex={-1}
                style={{ display: "none" }}
                onChange={(e) => void handleImportFile(e)}
              />
              <Button
                variant="soft"
                icon="plus"
                onClick={() => importRef.current?.click()}
                disabled={importing}
              >
                {importing ? "Importing…" : "Import JSON"}
              </Button>
            </>
          }
        />

        <SettingRow
          title="Clear listening data"
          desc="Erase history, recent searches and the signals behind your recommendations."
          control={
            <Button variant="ghost" icon="trash" onClick={() => void wipeListeningData()}>
              Clear data
            </Button>
          }
        />

        <SettingRow
          title="Clear search history"
          desc="Remove the recent search terms shown while you type."
          control={
            <Button
              variant="ghost"
              icon="x"
              onClick={() => void wipeSearchHistory()}
              disabled={!stats.searches}
            >
              Clear searches
            </Button>
          }
        />

        <SettingRow
          title="Reset Ytrium"
          desc="Delete everything on this device and start over. This cannot be undone."
          control={
            <Button variant="danger" icon="warning" onClick={() => void resetEverything()}>
              Reset app
            </Button>
          }
        />
      </section>

      {/* --------------------------------------------------------- shortcuts */}
      <section className="settings-group" aria-labelledby="set-about">
        <h2 className="settings-group__title" id="set-about">
          About
        </h2>
        <p className="settings-group__hint">
          Ytrium is a local-first music player. Playback goes through the bundled music service - the
          browser never runs yt-dlp or handles expiring media links.
        </p>

        <SettingRow
          title="Keyboard shortcuts"
          desc="Control playback without touching the mouse."
          control={
            <Button variant="ghost" icon="keyboard" onClick={() => ui.openDialog({ type: "shortcuts" })}>
              View shortcuts
            </Button>
          }
        />

        <SettingRow
          title="Restore defaults"
          desc={
            currentTrack
              ? `Now playing: ${currentTrack.title} - the queue is kept.`
              : "Reset playback and appearance preferences only."
          }
          control={
            <Button variant="ghost" icon="refresh" onClick={() => void restoreDefaults()}>
              Restore
            </Button>
          }
        />
      </section>
    </div>
  );
};

export default Settings;
