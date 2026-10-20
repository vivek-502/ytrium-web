import React, { Suspense, lazy, useEffect } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import AppShell from "./components/layout/AppShell";
import { ToastHost } from "./components/common/ToastHost";
import { MenuHost } from "./components/common/MenuHost";
import { DialogHost } from "./components/dialogs/DialogHost";
import QueuePanel from "./components/player/QueuePanel";
import FullPlayer from "./components/player/FullPlayer";
import { Spinner, EmptyState, Button } from "./components/common/UI";
import Logo from "./components/common/Logo";
import SignIn from "./components/auth/SignIn";
import { useLibraryStore } from "./stores/libraryStore";
import { useSettingsStore } from "./stores/settingsStore";
import { usePlayerStore } from "./stores/playerStore";
import { useAuthStore } from "./stores/authStore";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";

/* Code-split every page: only the shell loads up front. */
const Home = lazy(() => import("./pages/Home"));
const Search = lazy(() => import("./pages/Search"));
const Library = lazy(() => import("./pages/Library"));
const Liked = lazy(() => import("./pages/Liked"));
const RecentlyPlayed = lazy(() => import("./pages/RecentlyPlayed"));
const Playlist = lazy(() => import("./pages/Playlist"));
const RemotePlaylist = lazy(() => import("./pages/RemotePlaylist"));
const Album = lazy(() => import("./pages/Album"));
const Artist = lazy(() => import("./pages/Artist"));
const Settings = lazy(() => import("./pages/Settings"));

const NotFound = () => {
  const navigate = useNavigate();
  return (
    <div className="page">
      <EmptyState
        icon="search"
        title="Page not found"
        message="That page doesn't exist. Head back home and keep listening."
        action={
          <Button variant="accent" onClick={() => navigate("/")}>
            Go home
          </Button>
        }
      />
    </div>
  );
};

const PageFallback = () => (
  <div className="page" style={{ display: "grid", placeItems: "center", minHeight: "40vh" }}>
    <Spinner large label="Loading page" />
  </div>
);

const BootSplash = () => (
  <div className="signin signin--boot" role="status" aria-label="Loading Ytrium">
    <div className="signin__boot">
      <span className="signin__logo" aria-hidden>
        <Logo size={32} />
      </span>
      <span className="signin__wordmark">
        Ytri<span>um</span>
      </span>
      <Spinner large label="Loading Ytrium" />
    </div>
  </div>
);

/** The signed-in app: hydrates this user's local data, then mounts the shell. */
const AppRoot: React.FC = () => {
  const hydrateSettings = useSettingsStore((s) => s.hydrate);
  const hydrateLibrary = useLibraryStore((s) => s.hydrate);
  const hydratePlayer = usePlayerStore((s) => s.hydrate);

  useEffect(() => {
    hydrateSettings();
    void hydrateLibrary();
    void hydratePlayer();
  }, [hydrateSettings, hydrateLibrary, hydratePlayer]);

  useKeyboardShortcuts();

  return (
    <>
      <a className="sr-only" href="#main-content">
        Skip to main content
      </a>
      <Routes>
        <Route element={<AppShell />}>
          <Route
            index
            element={
              <Suspense fallback={<PageFallback />}>
                <Home />
              </Suspense>
            }
          />
          <Route
            path="search"
            element={
              <Suspense fallback={<PageFallback />}>
                <Search />
              </Suspense>
            }
          />
          <Route
            path="library"
            element={
              <Suspense fallback={<PageFallback />}>
                <Library />
              </Suspense>
            }
          />
          <Route
            path="liked"
            element={
              <Suspense fallback={<PageFallback />}>
                <Liked />
              </Suspense>
            }
          />
          <Route
            path="recently-played"
            element={
              <Suspense fallback={<PageFallback />}>
                <RecentlyPlayed />
              </Suspense>
            }
          />
          <Route
            path="playlist/:playlistId"
            element={
              <Suspense fallback={<PageFallback />}>
                <Playlist />
              </Suspense>
            }
          />
          <Route
            path="ytplaylist/:playlistId"
            element={
              <Suspense fallback={<PageFallback />}>
                <RemotePlaylist />
              </Suspense>
            }
          />
          <Route
            path="album/:artist/:title"
            element={
              <Suspense fallback={<PageFallback />}>
                <Album />
              </Suspense>
            }
          />
          <Route
            path="artist/:artistName"
            element={
              <Suspense fallback={<PageFallback />}>
                <Artist />
              </Suspense>
            }
          />
          <Route
            path="settings"
            element={
              <Suspense fallback={<PageFallback />}>
                <Settings />
              </Suspense>
            }
          />
          <Route path="home" element={<Navigate to="/" replace />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>

      {/* Global overlays */}
      <QueuePanel />
      <FullPlayer />
      <MenuHost />
      <DialogHost />
      <ToastHost />
    </>
  );
};

/**
 * Root component. Restores the session first, then either shows the
 * sign-in screen (nobody signed in) or the application itself. The shell,
 * routes, player and global shortcuts only exist behind a session.
 */
export const App: React.FC = () => {
  const status = useAuthStore((s) => s.status);

  useEffect(() => {
    void useAuthStore.getState().init();
  }, []);

  if (status === "boot") return <BootSplash />;
  if (status !== "authed") {
    return (
      <>
        <SignIn />
        <ToastHost />
      </>
    );
  }
  return <AppRoot />;
};

export default App;
