import React, { useState } from "react";
import Logo from "../common/Logo";
import { Button } from "../common/UI";
import { ApiError } from "../../providers/http";
import { useAuthStore } from "../../stores/authStore";

/**
 * Full-screen sign-in gate. Shown whenever no session exists; the app shell,
 * shortcuts and player only mount after a user is signed in.
 */
const SignIn: React.FC = () => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!username.trim() || !password) {
      setError("Enter your username and password.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await useAuthStore.getState().login(username, password);
      // Signed in - the store flips status and the app shell takes over.
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Sign-in failed. Check that the server is running and try again."
      );
      setBusy(false);
    }
  };

  return (
    <main className="signin">
      <div className="signin__card">
        <div className="signin__brand">
          <span className="signin__logo" aria-hidden>
            <Logo size={26} />
          </span>
          <span className="signin__wordmark">
            Ytri<span>um</span>
          </span>
        </div>

        <h1 className="signin__title">Sign in</h1>
        <p className="signin__sub">
          Use the username and password for this instance to reach your library.
        </p>

        <form className="signin__form" onSubmit={(e) => void submit(e)} noValidate>
          <label className="field">
            <span className="field__label">Username</span>
            <input
              className="input"
              value={username}
              aria-label="Username"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              maxLength={64}
              autoFocus
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>

          <label className="field">
            <span className="field__label">Password</span>
            <input
              className="input"
              type="password"
              value={password}
              aria-label="Password"
              autoComplete="current-password"
              maxLength={200}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>

          {error && (
            <p className="field__error signin__error" role="alert">
              {error}
            </p>
          )}

          <Button
            type="submit"
            variant="accent"
            large
            className="signin__submit"
            disabled={busy}
          >
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>

        <p className="signin__footnote">
          Local instance · each account keeps its own library on this device.
        </p>
      </div>
    </main>
  );
};

export default SignIn;
