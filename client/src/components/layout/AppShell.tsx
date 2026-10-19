import React, { useEffect, useMemo, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import Icon, { type IconName } from "../common/Icon";
import Logo from "../common/Logo";
import { Artwork, cx } from "../common/UI";
import { useUiStore } from "../../stores/uiStore";
import { useLibraryStore } from "../../stores/libraryStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { setMenuNavigator } from "../tracks/trackMenu";
import { useDebouncedValue } from "../../lib/hooks";
import PlayerBar from "../player/PlayerBar";

/* ------------------------------------------------------------------ Sidebar */

const NAV: Array<{ to: string; label: string; icon: IconName; end?: boolean }> = [
  { to: "/", label: "Home", icon: "home", end: true },
  { to: "/search", label: "Search", icon: "search" },
  { to: "/library", label: "Your Library", icon: "library" },
  { to: "/liked", label: "Liked songs", icon: "heart" },
  { to: "/recently-played", label: "Recently played", icon: "clock" },
];

const Sidebar: React.FC = () => {
  const navigate = useNavigate();
  const playlists = useLibraryStore((s) => s.playlists);
  const location = useLocation();

  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <span className="sidebar__logo" aria-hidden>
          <Logo size={34} />
        </span>
        <span className="sidebar__name">
          Ytri<span>um</span>
        </span>
      </div>

      <nav className="sidebar__nav" aria-label="Primary">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => cx("nav-item", isActive && "active")}
          >
            <span className="nav-item__icon">
              <Icon name={item.icon} size={19} />
            </span>
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="sidebar__section">
        <div className="sidebar__label">Playlists</div>
        <div className="sidebar__playlist-scroll">
          {playlists.length === 0 && (
            <p className="text-muted" style={{ fontSize: 13, padding: "4px 12px" }}>
              No playlists yet.
            </p>
          )}
          {playlists.map((playlist) => (
            <NavLink
              key={playlist.id}
              to={`/playlist/${playlist.id}`}
              className={({ isActive }) =>
                cx("sidebar__playlist", (isActive || location.pathname === `/playlist/${playlist.id}`) && "active")
              }
            >
              <Artwork src={playlist.image} alt="" size={34} className="sidebar__playlist-art" icon="music" />
              <span className="truncate">{playlist.name}</span>
            </NavLink>
          ))}
        </div>
        <button
          type="button"
          className="sidebar__create"
          onClick={() => navigate("/library?new=1")}
          aria-label="Create playlist"
        >
          <Icon name="plus" size={17} />
          <span>Create playlist</span>
        </button>
      </div>
    </aside>
  );
};

/* ------------------------------------------------------------------- TopBar */

export const TopBar: React.FC<{ scrolled: boolean }> = ({ scrolled }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const focusNonce = useUiStore((s) => s.searchFocusNonce);
  const theme = useSettingsStore((s) => s.settings.theme);
  const updateSettings = useSettingsStore((s) => s.update);
  const inputRef = useRef<HTMLInputElement>(null);

  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const urlQuery = location.pathname === "/search" ? params.get("q") ?? "" : "";
  const [text, setText] = useState(urlQuery);
  const debounced = useDebouncedValue(text, 250);

  // Keep the field in sync when the route changes (back/forward, chips).
  useEffect(() => {
    setText(urlQuery);
  }, [urlQuery, location.pathname]);

  // Push the typed query into the URL (search page reacts to ?q=).
  useEffect(() => {
    if (location.pathname !== "/search") return;
    if (debounced === urlQuery) return;
    navigate(debounced ? `/search?q=${encodeURIComponent(debounced)}` : "/search", { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  useEffect(() => {
    if (focusNonce > 0) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [focusNonce]);

  return (
    <header className={cx("topbar", scrolled && "scrolled")}>
      <div className="topbar__nav-buttons">
        <button
          type="button"
          className="icon-btn"
          aria-label="Go back"
          onClick={() => window.history.back()}
          disabled={!window.history.state?.idx}
        >
          <Icon name="chevron-left" size={19} />
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label="Go forward"
          onClick={() => window.history.forward()}
        >
          <Icon name="chevron-right" size={19} />
        </button>
      </div>

      <div className="search-field">
        <span className="search-field__icon">
          <Icon name="search" size={17} />
        </span>
        <input
          ref={inputRef}
          type="search"
          value={text}
          placeholder="Songs, artists, albums…"
          aria-label="Search music"
          onChange={(e) => setText(e.target.value)}
          onFocus={() => {
            if (location.pathname !== "/search") navigate(text ? `/search?q=${encodeURIComponent(text)}` : "/search");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              navigate(text ? `/search?q=${encodeURIComponent(text)}` : "/search");
            }
            if (e.key === "Escape") (e.target as HTMLInputElement).blur();
          }}
        />
        {text && (
          <button
            type="button"
            className="icon-btn search-field__clear"
            aria-label="Clear search"
            onClick={() => {
              setText("");
              if (location.pathname === "/search") navigate("/search");
            }}
          >
            <Icon name="x" size={15} />
          </button>
        )}
      </div>

      <div className="spacer" />

      <button
        type="button"
        className="icon-btn"
        aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
        title={theme === "dark" ? "Light theme" : "Dark theme"}
        onClick={() => updateSettings({ theme: theme === "dark" ? "light" : "dark" })}
      >
        <Icon name={theme === "dark" ? "sun" : "moon"} size={18} />
      </button>
      <NavLink to="/settings" className={({ isActive }) => cx("icon-btn", "topbar__settings-btn", isActive && "icon-btn--active")} aria-label="Settings" title="Settings">
        <Icon name="settings" size={18} />
      </NavLink>
    </header>
  );
};

/* -------------------------------------------------------------- Bottom nav */

const BOTTOM_NAV: Array<{ to: string; label: string; icon: IconName; end?: boolean }> = [
  { to: "/", label: "Home", icon: "home", end: true },
  { to: "/search", label: "Search", icon: "search" },
  { to: "/library", label: "Library", icon: "library" },
  { to: "/recently-played", label: "History", icon: "clock" },
  { to: "/settings", label: "Settings", icon: "settings" },
];

export const BottomNav: React.FC = () => (
  <nav className="bottom-nav" aria-label="Primary mobile">
    {BOTTOM_NAV.map((item) => (
      <NavLink
        key={item.to}
        to={item.to}
        end={item.end}
        className={({ isActive }) => cx("bottom-nav__item", isActive && "active")}
      >
        <Icon name={item.icon} size={20} />
        <span>{item.label}</span>
      </NavLink>
    ))}
  </nav>
);

/* ----------------------------------------------------------------- AppShell */

export const AppShell: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [scrolled, setScrolled] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const collapsed = useUiStore((s) => s.sidebarCollapsed);

  // Context menus navigate without React context - wire the module navigator.
  useEffect(() => {
    setMenuNavigator(navigate);
  }, [navigate]);

  // Reset scroll on route change (keep position for in-page query updates).
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [location.pathname]);

  return (
    <div className={cx("app-shell", collapsed && "sidebar-collapsed")}>
      <Sidebar />
      <div className="main-column">
        <TopBar scrolled={scrolled} />
        <main
          className="main-scroll"
          ref={scrollRef}
          onScroll={(e) => setScrolled((e.target as HTMLDivElement).scrollTop > 6)}
          id="main-content"
        >
          <Outlet />
        </main>
        <PlayerBar />
      </div>
      <BottomNav />
    </div>
  );
};

export default AppShell;
