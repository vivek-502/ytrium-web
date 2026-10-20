import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { provider } from "../providers/apiProvider";
import { useLibraryStore } from "../stores/libraryStore";
import { usePlayerStore } from "../stores/playerStore";
import { ui } from "../stores/uiStore";
import { TrackList } from "../components/tracks/TrackList";
import { Section } from "../components/sections/Section";
import { ArtistCard, RemotePlaylistCard } from "../components/cards/Cards";
import { context } from "../components/tracks/trackMenu";
import {
  Button,
  EmptyState,
  ErrorBanner,
  IconButton,
  RowSkeleton,
} from "../components/common/UI";
import Icon from "../components/common/Icon";
import { pluralize } from "../lib/format";
import type { ArtistDetail } from "../types";

type Status = "loading" | "ready" | "error";

const Artist: React.FC = () => {
  const { artistName = "" } = useParams();
  const navigate = useNavigate();

  const savedArtists = useLibraryStore((s) => s.savedArtists);
  const toggleFollowArtist = useLibraryStore((s) => s.toggleFollowArtist);
  const rememberTracks = useLibraryStore((s) => s.rememberTracks);

  const [detail, setDetail] = useState<ArtistDetail | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      const res = await provider.getArtist(artistName);
      setDetail(res);
      setStatus("ready");
      rememberTracks(res.tracks);
    } catch (err) {
      setError(err instanceof Error ? err.message : "This artist could not be loaded.");
      setStatus("error");
    }
  }, [artistName, rememberTracks]);

  useEffect(() => {
    void load();
  }, [load]);

  const artist = detail?.artist;
  const tracks = useMemo(() => detail?.tracks ?? [], [detail]);
  const playlists = useMemo(() => detail?.playlists ?? [], [detail]);
  const related = useMemo(() => detail?.related ?? [], [detail]);
  const following = Boolean(artist && savedArtists[artist.id]);

  useEffect(() => {
    const prev = document.title;
    if (artist) document.title = `${artist.name} · Ytrium`;
    return () => {
      document.title = prev;
    };
  }, [artist]);

  const playPopular = (shuffle: boolean) => {
    if (!tracks.length) return;
    const player = usePlayerStore.getState();
    if (shuffle !== player.shuffle) player.toggleShuffle();
    void player.playTracks(tracks, 0, context(artist?.name ?? artistName, "radio", window.location.pathname));
  };

  if (status === "loading") {
    return (
      <div className="page" aria-busy="true">
        <header className="page-header">
          <div
            className="page-header__art skeleton skeleton--art"
            style={{ borderRadius: "50%" }}
            aria-hidden
          />
          <div style={{ flex: 1 }}>
            <div className="skeleton skeleton--text" style={{ width: 60, height: 12, marginBottom: 12 }} />
            <div className="skeleton skeleton--text" style={{ width: "42%", height: 36 }} />
            <div className="skeleton skeleton--text" style={{ width: "28%", height: 13, marginTop: 14 }} />
          </div>
        </header>
        {Array.from({ length: 6 }).map((_, i) => (
          <RowSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (status === "error" || !artist) {
    return (
      <div className="page">
        <ErrorBanner
          message={error ?? "This artist could not be loaded."}
          action={
            <Button small variant="soft" icon="refresh" onClick={() => void load()}>
              Retry
            </Button>
          }
        />
        <div style={{ marginTop: 18 }}>
          <EmptyState
            icon="mic"
            title="Artist unavailable"
            message="We could not reach the music provider. Check your connection and try again."
            action={
              <Button variant="accent" onClick={() => navigate("/search")}>
                Back to search
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-header">
        <div
          className="page-header__art"
          style={{
            borderRadius: "50%",
            display: "grid",
            placeItems: "center",
            overflow: "hidden",
            background: artist.image
              ? undefined
              : "linear-gradient(140deg, var(--accent) 0%, var(--accent-strong) 100%)",
            color: "var(--accent-contrast)",
            backgroundImage: artist.image ? `url(${artist.image})` : undefined,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
          role={artist.image ? "img" : undefined}
          aria-label={artist.image ? `${artist.name} photo` : undefined}
          aria-hidden={!artist.image}
        >
          {!artist.image && <Icon name="mic" size={64} />}
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="page-header__kind">Artist</div>
          <h1 className="page-header__title">{artist.name}</h1>
          {artist.description && <p className="page-header__desc">{artist.description}</p>}
          <div className="page-header__meta">
            <strong>{pluralize(tracks.length, "track")}</strong>
            {playlists.length > 0 && (
              <>
                <span>·</span>
                <span>{pluralize(playlists.length, "playlist")}</span>
              </>
            )}
            {following && (
              <>
                <span>·</span>
                <span style={{ color: "var(--accent)", fontWeight: 700 }}>Following</span>
              </>
            )}
          </div>
          <div className="page-header__actions">
            <Button variant="accent" icon="play" onClick={() => playPopular(false)} disabled={!tracks.length}>
              Play
            </Button>
            <Button variant="soft" icon="shuffle" onClick={() => playPopular(true)} disabled={!tracks.length}>
              Shuffle
            </Button>
            <Button
              variant="ghost"
              icon={following ? "check" : "plus"}
              onClick={() => {
                const nowFollowing = toggleFollowArtist(artist);
                ui.toast(
                  nowFollowing ? `Following ${artist.name}` : `Unfollowed ${artist.name}`,
                  "success"
                );
              }}
            >
              {following ? "Following" : "Follow"}
            </Button>
            <IconButton
              icon="more-horizontal"
              label="More options"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                ui.openMenu({
                  x: Math.max(8, rect.right - 240),
                  y: rect.bottom + 6,
                  label: `Options for ${artist.name}`,
                  items: [
                    {
                      label: "Add popular tracks to queue",
                      icon: <Icon name="queue" size={15} />,
                      disabled: !tracks.length,
                      onSelect: () => {
                        const player = usePlayerStore.getState();
                        for (const t of [...tracks].reverse()) player.addToQueue(t);
                        ui.toast(`Queued ${pluralize(tracks.length, "track")}`, "success");
                      },
                    },
                    {
                      label: "Add to playlist",
                      icon: <Icon name="folder-plus" size={15} />,
                      disabled: !tracks.length,
                      onSelect: () =>
                        ui.openDialog({
                          type: "addToPlaylist",
                          trackIds: tracks.slice(0, 50).map((t) => t.id),
                        }),
                    },
                    { separator: true },
                    {
                      label: "Search this artist",
                      icon: <Icon name="search" size={15} />,
                      onSelect: () => navigate(`/search?q=${encodeURIComponent(artist.name)}`),
                    },
                  ],
                });
              }}
            />
          </div>
        </div>
      </header>

      <section className="section" aria-label={`${artist.name} popular tracks`}>
        <div className="section__head">
          <h2 className="section__title">Popular</h2>
        </div>
        <TrackList
          tracks={tracks}
          context={context(artist.name, "radio", window.location.pathname)}
          showHeader
          showAlbum
          virtualHeight={Math.min(tracks.length * 54 + 48, 720)}
          emptyTitle="No tracks yet"
          emptyMessage={`We could not find playable tracks for ${artist.name}.`}
        />
      </section>

      {playlists.length > 0 && (
        <Section
          title="Playlists"
          subtitle={`Public YouTube playlists featuring ${artist.name}`}
          layout="grid"
        >
          {playlists.map((playlist) => (
            <RemotePlaylistCard key={playlist.id} playlist={playlist} />
          ))}
        </Section>
      )}

      {related.length > 0 && (
        <Section title="Fans also like" layout="grid">
          {related.map((rel) => (
            <ArtistCard key={rel.id} artist={rel} />
          ))}
        </Section>
      )}

      {tracks.length === 0 && playlists.length === 0 && related.length === 0 && (
        <EmptyState
          icon="mic"
          title={`Nothing found for ${artist.name}`}
          message="The provider returned an empty profile. Try searching for a different spelling."
          action={
            <Link className="btn btn--accent" to={`/search?q=${encodeURIComponent(artist.name)}`} style={{ textDecoration: "none" }}>
              <span>Search instead</span>
            </Link>
          }
        />
      )}
    </div>
  );
};

export default Artist;
