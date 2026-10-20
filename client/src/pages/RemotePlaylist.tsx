import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
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
  cx,
} from "../components/common/UI";
import Icon from "../components/common/Icon";
import { formatDurationSeconds, pluralize } from "../lib/format";
import type { Track } from "../types";

type Status = "loading" | "ready" | "error";

/**
 * A public YouTube playlist, opened from search.
 *
 * The tracks live on YouTube, so they are fetched on open. Nothing is written
 * to the library until the user asks for it - "Save to library" stores a normal
 * local playlist (tagged with `sourcePlaylistId`), after which the header links
 * to the saved copy.
 */
const RemotePlaylist: React.FC = () => {
  const { playlistId = "" } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const title = params.get("title") ?? "";
  const owner = params.get("owner") ?? "";
  const image = params.get("image");

  const savedPlaylist = useLibraryStore((s) =>
    s.playlists.find((p) => p.sourcePlaylistId === playlistId)
  );
  const saveRemotePlaylist = useLibraryStore((s) => s.saveRemotePlaylist);

  const [tracks, setTracks] = useState<Track[]>([]);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!playlistId) {
      setError("No playlist was specified.");
      setStatus("error");
      return;
    }
    setStatus("loading");
    setError(null);
    try {
      const res = await provider.getPlaylistTracks(playlistId);
      setTracks(res);
      setStatus("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load this playlist.");
      setStatus("error");
    }
  }, [playlistId]);

  useEffect(() => {
    void load();
  }, [load]);

  /* Keep the tab title in sync. */
  useEffect(() => {
    const prev = document.title;
    if (title) document.title = `${title} · Ytrium`;
    return () => {
      document.title = prev;
    };
  }, [title]);

  const totalDuration = useMemo(
    () => tracks.reduce((sum, t) => sum + (t.duration || 0), 0),
    [tracks]
  );

  const cover = savedPlaylist?.image ?? image ?? tracks[0]?.thumbnail ?? null;
  const displayTitle = savedPlaylist?.name ?? title ?? "YouTube playlist";
  const displayOwner = savedPlaylist?.sourceOwner ?? owner;

  const playAll = (shuffle: boolean) => {
    if (!tracks.length) {
      ui.toast("This playlist has no songs", "info");
      return;
    }
    const player = usePlayerStore.getState();
    if (shuffle !== player.shuffle) player.toggleShuffle();
    void player.playTracks(
      tracks,
      0,
      context(displayTitle, "playlist", window.location.pathname)
    );
  };

  const saveToLibrary = async () => {
    if (saving) return;
    setSaving(true);
    try {
      let source = tracks;
      if (!source.length) source = await provider.getPlaylistTracks(playlistId);
      if (!source.length) {
        ui.toast("This playlist has no playable songs", "error");
        return;
      }
      const created = saveRemotePlaylist(
        {
          id: playlistId,
          title: displayTitle,
          owner: owner || "YouTube",
          image: cover,
          official: false,
          source: "youtube",
        },
        source
      );
      ui.toast(`Saved “${created.name}” to your library`, "success");
      navigate(`/playlist/${created.id}`);
    } catch (err) {
      ui.toast(
        err instanceof Error ? err.message : "Could not save this playlist",
        "error"
      );
    } finally {
      setSaving(false);
    }
  };

  /* ------------------------------------------------------------- loading */
  if (status === "loading") {
    return (
      <div className="page" aria-busy="true">
        <header className={cx("page-header", !cover && "page-header--icon")}>
          <div
            className={cx("page-header__art skeleton skeleton--art")}
            style={
              cover
                ? { backgroundImage: `url(${cover})`, backgroundSize: "cover", backgroundPosition: "center" }
                : undefined
            }
            aria-hidden
          />
          <div style={{ flex: 1 }}>
            <div className="skeleton skeleton--text" style={{ width: 90, height: 12, marginBottom: 12 }} />
            <div className="skeleton skeleton--text" style={{ width: "55%", height: 34 }} />
          </div>
        </header>
        {Array.from({ length: 6 }).map((_, i) => (
          <RowSkeleton key={i} />
        ))}
      </div>
    );
  }

  /* --------------------------------------------------------------- error */
  if (status === "error") {
    return (
      <div className="page">
        <header style={{ padding: "18px 0 6px" }}>
          <button
            type="button"
            className="section__link"
            onClick={() => navigate(-1)}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 12 }}
          >
            <Icon name="chevron-left" size={15} /> Back
          </button>
          <h1 className="page-header__title">{displayTitle}</h1>
        </header>
        <ErrorBanner
          message={error ?? "Could not load this playlist."}
          action={
            <Button small variant="soft" icon="refresh" onClick={() => void load()}>
              Retry
            </Button>
          }
        />
        <EmptyState
          icon="music"
          title="Playlist unavailable"
          message="It may be private, region-locked, or removed. Try another playlist from search."
          action={
            <Button variant="accent" icon="search" onClick={() => navigate("/search")}>
              Back to search
            </Button>
          }
        />
      </div>
    );
  }

  /* --------------------------------------------------------------- ready */
  const hasCover = Boolean(cover);

  return (
    <div className="page">
      <header className={cx("page-header", !hasCover && "page-header--icon")}>
        <div
          className={cx("page-header__art", !hasCover && "page-header__art--icon")}
          style={
            hasCover
              ? {
                  backgroundImage: `url(${cover})`,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                }
              : { display: "grid", placeItems: "center" }
          }
          aria-hidden={!hasCover}
          role={hasCover ? "img" : undefined}
          aria-label={hasCover ? `${displayTitle} cover` : undefined}
        >
          {!hasCover && (
            <span className="empty-state__icon" style={{ margin: 0, color: "var(--accent)" }}>
              <Icon name="list" size={56} />
            </span>
          )}
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="page-header__kind">YouTube playlist</div>
          <h1 className="page-header__title">{displayTitle}</h1>
          {displayOwner && <p className="page-header__desc">by {displayOwner}</p>}
          <div className="page-header__meta">
            <strong>{pluralize(tracks.length, "song")}</strong>
            {totalDuration > 0 && (
              <>
                <span>·</span>
                <span>{formatDurationSeconds(totalDuration)}</span>
              </>
            )}
            {savedPlaylist && (
              <>
                <span>·</span>
                <span style={{ color: "var(--accent)", fontWeight: 700 }}>In your library</span>
              </>
            )}
          </div>
          <div className="page-header__actions">
            <Button
              variant="accent"
              icon="play"
              onClick={() => playAll(false)}
              disabled={!tracks.length}
            >
              Play
            </Button>
            <Button
              variant="soft"
              icon="shuffle"
              onClick={() => playAll(true)}
              disabled={!tracks.length}
            >
              Shuffle
            </Button>
            {savedPlaylist ? (
              <Button
                variant="ghost"
                icon="check"
                onClick={() => navigate(`/playlist/${savedPlaylist.id}`)}
              >
                Open saved copy
              </Button>
            ) : (
              <Button
                variant="ghost"
                icon="plus"
                onClick={() => void saveToLibrary()}
                disabled={saving}
              >
                {saving ? "Saving…" : "Save to library"}
              </Button>
            )}
            <IconButton
              icon="external"
              label="Open on YouTube"
              onClick={() =>
                window.open(
                  `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}`,
                  "_blank",
                  "noopener,noreferrer"
                )
              }
            />
          </div>
        </div>
      </header>

      {tracks.length === 0 ? (
        <EmptyState
          icon="music"
          title="No songs in this playlist"
          message="YouTube returned no playable videos for this playlist."
        />
      ) : (
        <TrackList
          tracks={tracks}
          context={context(displayTitle, "playlist", window.location.pathname)}
          showHeader
          virtualHeight={Math.min(tracks.length * 54 + 48, 900)}
        />
      )}
    </div>
  );
};

export default RemotePlaylist;
