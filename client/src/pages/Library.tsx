import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  selectLibraryAlbums,
  selectLibraryArtists,
  useLibraryStore,
} from "../stores/libraryStore";
import { useUiStore, ui } from "../stores/uiStore";
import { AlbumCard, ArtistCard, PlaylistCard } from "../components/cards/Cards";
import { Button, EmptyState, cx } from "../components/common/UI";
import Icon from "../components/common/Icon";
import { pluralize } from "../lib/format";

type Tab = "playlists" | "artists" | "albums";

const Library: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>("playlists");
  const [filter, setFilter] = useState("");

  const playlists = useLibraryStore((s) => s.playlists);
  const artists = useLibraryStore(selectLibraryArtists);
  const albums = useLibraryStore(selectLibraryAlbums);
  const openDialog = useUiStore((s) => s.openDialog);

  /* ?new=1 (sidebar "Create playlist") opens the dialog once. */
  useEffect(() => {
    if (params.get("new") === "1") {
      openDialog({ type: "createPlaylist" });
      const next = new URLSearchParams(params);
      next.delete("new");
      setParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const q = filter.trim().toLowerCase();
  const filteredPlaylists = useMemo(
    () => (q ? playlists.filter((p) => p.name.toLowerCase().includes(q)) : playlists),
    [playlists, q]
  );
  const filteredArtists = useMemo(
    () => (q ? artists.filter((a) => a.name.toLowerCase().includes(q)) : artists),
    [artists, q]
  );
  const filteredAlbums = useMemo(
    () => (q ? albums.filter((a) => a.title.toLowerCase().includes(q)) : albums),
    [albums, q]
  );

  const counts: Record<Tab, number> = {
    playlists: playlists.length,
    artists: artists.length,
    albums: albums.length,
  };

  const emptyCopy: Record<Tab, { title: string; message: string }> = {
    playlists: {
      title: "No playlists yet",
      message: "Create a playlist to keep the songs you want together.",
    },
    artists: { title: "No artists saved", message: "Like songs or save artists to see them here." },
    albums: { title: "No albums saved", message: "Albums from your likes and playlists show up here." },
  };

  return (
    <div className="page">
      <header style={{ padding: "18px 0 6px" }}>
        <div className="hstack" style={{ justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ fontSize: "clamp(26px, 4vw, 36px)", fontWeight: 900, letterSpacing: "-0.03em" }}>
              Your Library
            </h1>
            <p className="text-muted" style={{ fontSize: 13.5, marginTop: 4 }}>
              {pluralize(playlists.length, "playlist")} · {pluralize(artists.length, "artist")} ·{" "}
              {pluralize(albums.length, "album")} stored on this device
            </p>
          </div>
          <Button variant="accent" icon="plus" onClick={() => openDialog({ type: "createPlaylist" })}>
            Create playlist
          </Button>
        </div>
      </header>

      <div className="hstack" style={{ gap: 12, margin: "10px 0 4px", flexWrap: "wrap" }}>
        <div className="search-field" style={{ maxWidth: 320 }}>
          <span className="search-field__icon">
            <Icon name="search" size={16} />
          </span>
          <input
            type="search"
            value={filter}
            placeholder="Filter your library"
            aria-label="Filter your library"
            onChange={(e) => setFilter(e.target.value)}
          />
          {filter && (
            <button
              type="button"
              className="icon-btn search-field__clear"
              aria-label="Clear filter"
              onClick={() => setFilter("")}
            >
              <Icon name="x" size={15} />
            </button>
          )}
        </div>
      </div>

      <div className="tabs" role="tablist" aria-label="Library sections">
        {(["playlists", "artists", "albums"] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            className={cx("tab", tab === t && "is-active")}
            onClick={() => setTab(t)}
          >
            {t === "playlists" ? "Playlists" : t === "artists" ? "Artists" : "Albums"}
            <span className="text-muted" style={{ fontWeight: 600 }}>
              {" "}
              {counts[t]}
            </span>
          </button>
        ))}
      </div>

      <div style={{ marginTop: 18 }}>
        {tab === "playlists" &&
          (filteredPlaylists.length ? (
            <div className="card-grid">
              <button
                type="button"
                className="card"
                style={{ alignItems: "center", justifyContent: "center", gap: 10, minHeight: 200 }}
                onClick={() => ui.openDialog({ type: "createPlaylist" })}
              >
                <span className="empty-state__icon" style={{ marginBottom: 0 }}>
                  <Icon name="plus" size={26} />
                </span>
                <span className="card__title">New playlist</span>
                <span className="card__subtitle" style={{ marginTop: 0 }}>
                  Start collecting songs
                </span>
              </button>
              {filteredPlaylists.map((playlist) => (
                <PlaylistCard key={playlist.id} playlist={playlist} />
              ))}
            </div>
          ) : (
            <EmptyState
              icon="folder-plus"
              title={q ? `No playlists match “${filter}”` : emptyCopy.playlists.title}
              message={q ? "Try a different filter." : emptyCopy.playlists.message}
              action={
                q ? (
                  <Button variant="ghost" onClick={() => setFilter("")}>
                    Clear filter
                  </Button>
                ) : (
                  <Button variant="accent" icon="plus" onClick={() => ui.openDialog({ type: "createPlaylist" })}>
                    Create playlist
                  </Button>
                )
              }
            />
          ))}

        {tab === "artists" &&
          (filteredArtists.length ? (
            <div className="card-grid">
              {filteredArtists.map((artist) => (
                <ArtistCard key={artist.id} artist={artist} />
              ))}
            </div>
          ) : (
            <EmptyState icon="mic" title={emptyCopy.artists.title} message={emptyCopy.artists.message} />
          ))}

        {tab === "albums" &&
          (filteredAlbums.length ? (
            <div className="card-grid">
              {filteredAlbums.map((album) => (
                <AlbumCard key={album.id} album={album} />
              ))}
            </div>
          ) : (
            <EmptyState icon="disc" title={emptyCopy.albums.title} message={emptyCopy.albums.message} />
          ))}
      </div>
    </div>
  );
};

export default Library;
