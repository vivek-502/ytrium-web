import React, { useEffect, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { buildHomeModel } from "../rec/engine";
import { useLibraryStore } from "../stores/libraryStore";
import { useDiscoveryStore } from "../stores/discoveryStore";
import { usePlayerStore } from "../stores/playerStore";
import { HomeSectionView, Section, playPlaylistNow } from "../components/sections/Section";
import { QuickPickTile } from "../components/cards/Cards";
import { Button, CardSkeleton, EmptyState, ErrorBanner, Spinner } from "../components/common/UI";
import { greetingForHour, pluralize } from "../lib/format";
import { context } from "../components/tracks/trackMenu";
import { ui } from "../stores/uiStore";

const Home: React.FC = () => {
  const library = useLibraryStore();
  const discovery = useDiscoveryStore();
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const navigate = useNavigate();

  useEffect(() => {
    void discovery.loadCharts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Seed the provider radio from local artist affinity (once charts are in). */
  const seeds = useMemo(() => {
    const counts = new Map<string, { id: string; name: string; score: number }>();
    const bump = (artistId: string, name: string, delta: number) => {
      const e = counts.get(artistId) ?? { id: artistId, name, score: 0 };
      e.score += delta;
      counts.set(artistId, e);
    };
    for (const [id, sig] of Object.entries(library.signals)) {
      const track = library.catalog[id];
      if (track) bump(track.artistId, track.artist, sig.playCount + sig.completeCount * 2);
    }
    for (const { track } of Object.values(library.liked)) bump(track.artistId, track.artist, 6);
    return [...counts.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((a) => a.name);
  }, [library.signals, library.liked, library.catalog]);

  useEffect(() => {
    if (discovery.radioStatus !== "idle") return;
    void discovery.loadRadio(seeds).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discovery.radioStatus]);

  const model = useMemo(
    () =>
      buildHomeModel({
        signals: library.signals,
        liked: library.liked,
        history: library.history,
        searchHistory: library.searchHistory,
        playlists: library.playlists,
        catalog: Object.values(library.catalog),
        charts: discovery.charts,
        radio: discovery.radioTracks,
      }),
    [
      library.signals,
      library.liked,
      library.history,
      library.searchHistory,
      library.playlists,
      library.catalog,
      discovery.charts,
      discovery.radioTracks,
    ]
  );

  const loading = discovery.chartsStatus === "loading" && !discovery.charts;
  const playPick = (pick: import("../rec/engine").QuickPick) => {
    const player = usePlayerStore.getState();
    if (pick.kind === "playlist" && pick.playlist) {
      playPlaylistNow(pick.playlist);
      return;
    }
    if (pick.track) void player.playTracks([pick.track], 0, context(pick.title, "search"));
  };

  return (
    <div className="page">
      <header style={{ padding: "18px 0 6px" }}>
        <p className="text-muted" style={{ fontSize: 13.5, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase" }}>
          {greetingForHour()}
        </p>
        <h1 style={{ fontSize: "clamp(26px, 4vw, 38px)", fontWeight: 900, letterSpacing: "-0.03em", marginTop: 4 }}>
          {model.isNewUser ? "Welcome to Ytrium" : `Good to hear you again${currentTrack ? "" : "."}`}
        </h1>
        <p className="text-secondary" style={{ marginTop: 6, fontSize: 14.5 }}>
          {model.isNewUser
            ? "Search for a song or browse the charts - everything you play stays on this device."
            : model.topSeedArtist
              ? `Picked up from what you listen to, especially ${model.topSeedArtist}.`
              : "Your library, history and mixes are ready."}
        </p>
      </header>

      {discovery.chartsStatus === "error" && (
        <div style={{ margin: "14px 0" }}>
          <ErrorBanner
            message={discovery.chartsError ?? "Charts could not be loaded."}
            action={
              <Button small variant="soft" icon="refresh" onClick={() => void discovery.loadCharts(true)}>
                Retry
              </Button>
            }
          />
        </div>
      )}

      {/* --------------------------------------------------------- quick picks */}
      {model.quickPicks.length > 0 && (
        <section className="section" aria-label="Quick picks">
          <div className="card-grid card-grid--tight" style={{ gap: 12 }}>
            {model.quickPicks.map((pick) => (
              <QuickPickTile
                key={pick.id}
                kind={pick.kind}
                title={pick.title}
                subtitle={pick.subtitle}
                image={pick.image}
                onPlay={() => playPick(pick)}
                onOpen={
                  pick.kind === "playlist" && pick.playlist
                    ? () => navigate(`/playlist/${pick.playlist!.id}`)
                    : undefined
                }
              />
            ))}
          </div>
        </section>
      )}

      {/* ------------------------------------------------------------- sections */}
      {model.sections.map((section) => (
        <HomeSectionView key={section.id} section={section} />
      ))}

      {/* ------------------------------------------------------- loading state */}
      {loading && model.sections.length === 0 && (
        <section className="section" aria-label="Loading charts">
          <div className="section__head">
            <div className="section__title">Loading the charts…</div>
            <Spinner />
          </div>
          <div className="card-grid">
            {Array.from({ length: 6 }).map((_, i) => (
              <CardSkeleton key={i} />
            ))}
          </div>
        </section>
      )}

      {/* -------------------------------------------------------- empty state */}
      {!loading && model.sections.length === 0 && model.quickPicks.length === 0 && (
        <EmptyState
          icon="sparkle"
          title="Your home feed is just getting started"
          message="Play a few songs, like a track or two, and Ytrium will build mixes, recommendations and a trending feed around your taste."
          action={
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
              <Button variant="accent" icon="search" onClick={() => navigate("/search")}>
                Search for music
              </Button>
              <Button variant="ghost" icon="trending" onClick={() => navigate("/search?browse=1")}>
                Browse the charts
              </Button>
            </div>
          }
        />
      )}

      {/* ------------------------------------------------------- footer extras */}
      {model.sections.length > 0 && (
        <Section title="Keep exploring" layout="carousel">
          <div className="card" style={{ justifyContent: "center", alignItems: "flex-start", gap: 8 }}>
            <div className="card__title">Your library</div>
            <div className="card__subtitle" style={{ marginTop: 0 }}>
              {pluralize(library.playlists.length, "playlist")} ·{" "}
              {pluralize(Object.keys(library.liked).length, "liked song")}
            </div>
            <Link className="section__link" to="/library" style={{ paddingLeft: 0 }}>
              Open library ›
            </Link>
          </div>
          <div className="card" style={{ justifyContent: "center", alignItems: "flex-start", gap: 8 }}>
            <div className="card__title">Recently played</div>
            <div className="card__subtitle" style={{ marginTop: 0 }}>
              {pluralize(library.history.length, "session")} on this device
            </div>
            <Link className="section__link" to="/recently-played" style={{ paddingLeft: 0 }}>
              See history ›
            </Link>
          </div>
          <div className="card" style={{ justifyContent: "center", alignItems: "flex-start", gap: 8 }}>
            <div className="card__title">Keyboard shortcuts</div>
            <div className="card__subtitle" style={{ marginTop: 0 }}>
              Control playback without the mouse
            </div>
            <button
              type="button"
              className="section__link"
              style={{ paddingLeft: 0 }}
              onClick={() => ui.openDialog({ type: "shortcuts" })}
            >
              View shortcuts ›
            </button>
          </div>
        </Section>
      )}
    </div>
  );
};

export default Home;
