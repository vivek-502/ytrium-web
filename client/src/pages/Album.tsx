import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { provider } from "../providers/apiProvider";
import { useLibraryStore } from "../stores/libraryStore";
import { usePlayerStore } from "../stores/playerStore";
import { ui } from "../stores/uiStore";
import { TrackList } from "../components/tracks/TrackList";
import { context } from "../components/tracks/trackMenu";
import {
  Button,
  EmptyState,
  ErrorBanner,
  IconButton,
  RowSkeleton,
} from "../components/common/UI";
import Icon from "../components/common/Icon";
import { formatDurationSeconds, pluralize } from "../lib/format";
import type { AlbumDetail } from "../types";

type Status = "loading" | "ready" | "error";

const Album: React.FC = () => {
  const { artist = "", title = "" } = useParams();
  const navigate = useNavigate();

  const savedAlbums = useLibraryStore((s) => s.savedAlbums);
  const toggleSaveAlbum = useLibraryStore((s) => s.toggleSaveAlbum);

  const [detail, setDetail] = useState<AlbumDetail | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async () => {
      setStatus("loading");
      setError(null);
      try {
        const res = await provider.getAlbum(artist, title);
        setDetail(res);
        setStatus("ready");
        if (!res.tracks.length) {
          ui.toast("No playable tracks found for this album", "info");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "This album could not be loaded.");
        setStatus("error");
      }
    },
    [artist, title]
  );

  useEffect(() => {
    void load();
  }, [load]);

  const album = detail?.album;
  const tracks = useMemo(() => detail?.tracks ?? [], [detail]);
  const saved = Boolean(album && savedAlbums[album.id]);
  const totalDuration = useMemo(
    () => tracks.reduce((sum, t) => sum + (t.duration || 0), 0),
    [tracks]
  );

  useEffect(() => {
    const prev = document.title;
    if (album) document.title = `${album.title} · ${album.artist} · Ytrium`;
    return () => {
      document.title = prev;
    };
  }, [album]);

  const playAll = (shuffle: boolean) => {
    if (!tracks.length) return;
    const player = usePlayerStore.getState();
    if (shuffle !== player.shuffle) player.toggleShuffle();
    void player.playTracks(tracks, 0, context(album?.title ?? title, "album", window.location.pathname));
  };

  if (status === "loading") {
    return (
      <div className="page" aria-busy="true">
        <header className="page-header">
          <div className="page-header__art skeleton skeleton--art" aria-hidden />
          <div style={{ flex: 1 }}>
            <div className="skeleton skeleton--text" style={{ width: 70, height: 12, marginBottom: 12 }} />
            <div className="skeleton skeleton--text" style={{ width: "50%", height: 36 }} />
            <div className="skeleton skeleton--text" style={{ width: "32%", height: 13, marginTop: 14 }} />
          </div>
        </header>
        {Array.from({ length: 8 }).map((_, i) => (
          <RowSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (status === "error" || !album) {
    return (
      <div className="page">
        <ErrorBanner
          message={error ?? "This album could not be loaded."}
          action={
            <Button small variant="soft" icon="refresh" onClick={() => void load()}>
              Retry
            </Button>
          }
        />
        <div style={{ marginTop: 18 }}>
          <EmptyState
            icon="disc"
            title="Album unavailable"
            message="Check your connection, or head back and pick something else."
            action={
              <Button variant="accent" onClick={() => navigate("/search?browse=1")}>
                Browse charts
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  const isSaved = saved;

  return (
    <div className="page">
      <header className="page-header">
        <div
          className="page-header__art"
          style={
            album.image
              ? { backgroundImage: `url(${album.image})`, backgroundSize: "cover", backgroundPosition: "center" }
              : {
                  display: "grid",
                  placeItems: "center",
                  background: "linear-gradient(140deg, var(--accent) 0%, var(--accent-strong) 100%)",
                  color: "var(--accent-contrast)",
                }
          }
          role={album.image ? "img" : undefined}
          aria-label={album.image ? `${album.title} cover art` : undefined}
          aria-hidden={!album.image}
        >
          {!album.image && <Icon name="disc" size={64} />}
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="page-header__kind">Album</div>
          <h1 className="page-header__title">{album.title}</h1>
          <div className="page-header__meta">
            <Link
              to={`/artist/${encodeURIComponent(album.artist)}`}
              style={{ color: "var(--text)", fontWeight: 700 }}
            >
              {album.artist}
            </Link>
            {album.releaseDate && (
              <>
                <span>·</span>
                <span>{album.releaseDate.slice(0, 4)}</span>
              </>
            )}
            <span>·</span>
            <span>{pluralize(tracks.length, "song")}</span>
            {totalDuration > 0 && (
              <>
                <span>·</span>
                <span>{formatDurationSeconds(totalDuration)}</span>
              </>
            )}
          </div>
          <div className="page-header__actions">
            <Button variant="accent" icon="play" onClick={() => playAll(false)} disabled={!tracks.length}>
              Play
            </Button>
            <Button variant="soft" icon="shuffle" onClick={() => playAll(true)} disabled={!tracks.length}>
              Shuffle
            </Button>
            <IconButton
              icon={isSaved ? "heart-filled" : "heart"}
              label={isSaved ? "Remove from saved albums" : "Save album"}
              active={isSaved}
              onClick={() => {
                const nowSaved = toggleSaveAlbum(album);
                ui.toast(nowSaved ? `Saved ${album.title}` : `Removed ${album.title}`, "success");
              }}
            />
            <IconButton
              icon="more-horizontal"
              label="More options"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                ui.openMenu({
                  x: Math.max(8, rect.right - 240),
                  y: rect.bottom + 6,
                  label: `Options for ${album.title}`,
                  items: [
                    {
                      label: "Go to artist",
                      icon: <Icon name="mic" size={15} />,
                      onSelect: () => navigate(`/artist/${encodeURIComponent(album.artist)}`),
                    },
                    {
                      label: "Add to playlist",
                      icon: <Icon name="folder-plus" size={15} />,
                      disabled: !tracks.length,
                      onSelect: () =>
                        ui.openDialog({ type: "addToPlaylist", trackIds: tracks.map((t) => t.id) }),
                    },
                    { separator: true },
                    {
                      label: "Browse charts",
                      icon: <Icon name="trending" size={15} />,
                      onSelect: () => navigate("/search?browse=1"),
                    },
                  ],
                });
              }}
            />
          </div>
          {!detail?.exactMatch && (
            <p className="text-muted" style={{ fontSize: 12.5, marginTop: 10 }}>
              Closest match from the provider - track list may differ from the original release.
            </p>
          )}
        </div>
      </header>

      <TrackList
        tracks={tracks}
        context={context(album.title, "album", window.location.pathname)}
        showHeader
        showAlbum={false}
        virtualHeight={Math.min(tracks.length * 54 + 48, 900)}
        emptyTitle="No tracks for this album"
        emptyMessage="The provider returned the album without playable tracks."
        emptyAction={
          <Button variant="accent" icon="search" onClick={() => navigate(`/search?q=${encodeURIComponent(album.title)}`)}>
            Search this album
          </Button>
        }
      />
    </div>
  );
};

export default Album;
