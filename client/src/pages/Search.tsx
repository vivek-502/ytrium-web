import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { provider } from "../providers/apiProvider";
import { useDiscoveryStore } from "../stores/discoveryStore";
import { useLibraryStore } from "../stores/libraryStore";
import { usePlayerStore } from "../stores/playerStore";
import { TrackList } from "../components/tracks/TrackList";
import { AlbumCard, ArtistCard, MediaCard } from "../components/cards/Cards";
import { Section } from "../components/sections/Section";
import { Button, CardSkeleton, EmptyState, ErrorBanner, RowSkeleton, cx } from "../components/common/UI";
import Icon from "../components/common/Icon";
import { context } from "../components/tracks/trackMenu";
import type { SearchResults } from "../types";

type Tab = "all" | "songs" | "artists" | "albums";
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "all", label: "All" },
  { id: "songs", label: "Songs" },
  { id: "artists", label: "Artists" },
  { id: "albums", label: "Albums" },
];

const Search: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const query = params.get("q")?.trim() ?? "";
  const browse = params.get("browse") === "1";
  const [tab, setTab] = useState<Tab>("all");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const searchHistory = useLibraryStore((s) => s.searchHistory);
  const addSearchQuery = useLibraryStore((s) => s.addSearchQuery);
  const removeSearchEntry = useLibraryStore((s) => s.removeSearchEntry);
  const clearSearchHistory = useLibraryStore((s) => s.clearSearchHistory);
  const charts = useDiscoveryStore((s) => s.charts);
  const chartsStatus = useDiscoveryStore((s) => s.chartsStatus);
  const loadCharts = useDiscoveryStore((s) => s.loadCharts);

  useEffect(() => {
    if (!query) {
      setResults(null);
      setStatus("idle");
      return;
    }
    const id = ++requestId.current;
    setStatus("loading");
    setError(null);
    provider
      .search(query, 24)
      .then((res) => {
        if (id !== requestId.current) return;
        setResults(res);
        setStatus("ready");
        addSearchQuery(query);
      })
      .catch((err: unknown) => {
        if (id !== requestId.current) return;
        setError(err instanceof Error ? err.message : "Search failed. Try again.");
        setStatus("error");
      });
  }, [query, addSearchQuery]);

  useEffect(() => {
    if (!query && (browse || !charts)) void loadCharts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, browse]);

  const allTracks = results?.tracks ?? [];
  const artists = useMemo(() => results?.artists ?? [], [results]);
  const albums = useMemo(() => results?.albums ?? [], [results]);
  const playing = usePlayerStore((s) => s.isPlaying);

  /* ------------------------------------------------------- browse (no query) */
  if (!query) {
    return (
      <div className="page">
        <header style={{ padding: "18px 0 4px" }}>
          <h1 style={{ fontSize: "clamp(26px, 4vw, 36px)", fontWeight: 900, letterSpacing: "-0.03em" }}>
            Search
          </h1>
          <p className="text-secondary" style={{ marginTop: 6, fontSize: 14.5 }}>
            Find songs, artists and albums. Results stream in from the music provider.
          </p>
        </header>

        {searchHistory.length > 0 && (
          <section className="section" aria-label="Recent searches">
            <div className="section__head">
              <div>
                <h2 className="section__title">Recent searches</h2>
              </div>
              <button type="button" className="section__link" onClick={clearSearchHistory}>
                Clear history
              </button>
            </div>
            <div className="chip-row">
              {searchHistory.map((entry) => (
                <span key={entry.id} className="chip">
                  <button
                    type="button"
                    onClick={() => setParams({ q: entry.query })}
                    style={{ background: "none", display: "inline-flex", alignItems: "center", gap: 7 }}
                  >
                    <Icon name="search" size={14} />
                    {entry.query}
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${entry.query} from history`}
                    onClick={() => removeSearchEntry(entry.id)}
                    style={{ display: "grid", placeItems: "center" }}
                  >
                    <Icon name="x" size={13} />
                  </button>
                </span>
              ))}
            </div>
          </section>
        )}

        {chartsStatus === "error" && (
          <ErrorBanner
            message="Charts are unavailable right now."
            action={
              <Button small variant="soft" icon="refresh" onClick={() => void loadCharts(true)}>
                Retry
              </Button>
            }
          />
        )}

        {chartsStatus === "loading" && !charts && (
          <section className="section">
            <div className="card-grid">
              {Array.from({ length: 6 }).map((_, i) => (
                <CardSkeleton key={i} />
              ))}
            </div>
          </section>
        )}

        {charts && charts.trending.length > 0 && (
          <>
            <Section title="Trending now" subtitle={`Source: ${charts.chartsSource}`}>
              {charts.trending.slice(0, 12).map((track) => (
                <AlbumCardOrTrack key={track.id} track={track} all={charts.trending} />
              ))}
            </Section>
            <Section title="Popular artists" layout="grid">
              {charts.popularArtists.slice(0, 12).map((artist) => (
                <ArtistCard key={artist.id} artist={artist} />
              ))}
            </Section>
            <Section title="Top albums" layout="grid">
              {charts.popularAlbums.slice(0, 12).map((album) => (
                <AlbumCard key={album.id} album={album} />
              ))}
            </Section>
          </>
        )}
      </div>
    );
  }

  /* ------------------------------------------------------------ search view */
  const showTracks = tab === "all" || tab === "songs";
  const showArtists = tab === "all" || tab === "artists";
  const showAlbums = tab === "all" || tab === "albums";

  return (
    <div className="page">
      <header style={{ padding: "18px 0 6px" }}>
        <h1 style={{ fontSize: "clamp(24px, 3.6vw, 34px)", fontWeight: 900, letterSpacing: "-0.03em" }}>
          Results for “{query}”
        </h1>
        {status === "ready" && (
          <p className="text-muted" style={{ fontSize: 13.5, marginTop: 4 }}>
            {allTracks.length} songs · {artists.length} artists · {albums.length} albums
          </p>
        )}
      </header>

      <div className="tabs" role="tablist" aria-label="Search result filters">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={cx("tab", tab === t.id && "is-active")}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {status === "loading" && (
        <div style={{ marginTop: 14 }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <RowSkeleton key={i} />
          ))}
        </div>
      )}

      {status === "error" && (
        <div style={{ marginTop: 16 }}>
          <ErrorBanner
            message={error ?? "Search failed."}
            action={
              <Button
                small
                variant="soft"
                icon="refresh"
                onClick={() => setParams({ q: query, retry: String(Date.now()) })}
              >
                Retry
              </Button>
            }
          />
        </div>
      )}

      {status === "ready" && allTracks.length === 0 && artists.length === 0 && albums.length === 0 && (
        <EmptyState
          icon="search"
          title={`No results for “${query}”`}
          message="Check the spelling, try a shorter phrase, or search for the artist name."
          action={
            <Button variant="ghost" onClick={() => setParams({})}>
              Clear search
            </Button>
          }
        />
      )}

      {status === "ready" && (
        <div style={{ marginTop: 12 }}>
          {showTracks && allTracks.length > 0 && (
            <section className="section" aria-label="Songs">
              <div className="section__head">
                <h2 className="section__title">Songs</h2>
                <button
                  type="button"
                  className="section__link"
                  onClick={() =>
                    void usePlayerStore
                      .getState()
                      .playTracks(allTracks, 0, context(`Search: ${query}`, "search"))
                  }
                >
                  Play all ›
                </button>
              </div>
              <TrackList
                tracks={allTracks}
                context={context(`Search: ${query}`, "search")}
                virtualHeight={Math.min(660, allTracks.length * 54 + 40)}
              />
            </section>
          )}

          {showArtists && artists.length > 0 && (
            <Section title="Artists" layout="grid">
              {artists.map((artist) => (
                <ArtistCard key={artist.id} artist={artist} />
              ))}
            </Section>
          )}

          {showAlbums && albums.length > 0 && (
            <Section title="Albums" layout="grid">
              {albums.map((album) => (
                <AlbumCard key={album.id} album={album} />
              ))}
            </Section>
          )}

          {showTracks && allTracks.length > 0 && playing && (
            <p className="text-muted" style={{ fontSize: 13 }}>
              Tip: double-click any row to jump straight into it.
            </p>
          )}
        </div>
      )}
    </div>
  );
};

/** Card wrapper so chart tracks are playable straight from the browse grid. */
const AlbumCardOrTrack: React.FC<{ track: import("../types").Track; all: import("../types").Track[] }> = ({
  track,
  all,
}) => (
  <MediaCard
    title={track.title}
    subtitle={track.artist}
    image={track.thumbnail}
    onPlay={() =>
      void usePlayerStore
        .getState()
        .playTracks(
          all,
          Math.max(0, all.findIndex((t) => t.id === track.id)),
          context("Trending", "search")
        )
    }
  />
);

export default Search;
