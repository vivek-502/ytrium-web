import React, { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { selectLikedTracks, useLibraryStore } from "../stores/libraryStore";
import { usePlayerStore } from "../stores/playerStore";
import { TrackList } from "../components/tracks/TrackList";
import { Button, EmptyState, IconButton } from "../components/common/UI";
import Icon from "../components/common/Icon";
import { context } from "../components/tracks/trackMenu";
import { formatTotalDuration, pluralize } from "../lib/format";

const Liked: React.FC = () => {
  const liked = useLibraryStore(selectLikedTracks);
  const shuffleSeed = usePlayerStore((s) => s.shuffle);
  const navigate = useNavigate();

  const totalDuration = useMemo(() => formatTotalDuration(liked), [liked]);
  const playAll = (shuffle: boolean) => {
    const player = usePlayerStore.getState();
    if (shuffle && !player.shuffle) player.toggleShuffle();
    if (!shuffle && player.shuffle) player.toggleShuffle();
    void player.playTracks(liked, 0, context("Liked songs", "liked", "/liked"));
  };

  return (
    <div className="page">
      <header className="page-header">
        <div
          className="page-header__art"
          style={{
            display: "grid",
            placeItems: "center",
            background: "linear-gradient(140deg, var(--accent) 0%, var(--accent-strong) 100%)",
            color: "var(--accent-contrast)",
          }}
          aria-hidden
        >
          <Icon name="heart-filled" size={64} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="page-header__kind">Playlist</div>
          <h1 className="page-header__title">Liked songs</h1>
          <div className="page-header__meta">
            <strong>{pluralize(liked.length, "song")}</strong>
            {liked.length > 0 && (
              <>
                <span>·</span>
                <span>{totalDuration}</span>
              </>
            )}
          </div>
          <div className="page-header__actions">
            <Button variant="accent" icon="play" onClick={() => playAll(false)} disabled={!liked.length}>
              Play
            </Button>
            <Button variant="soft" icon="shuffle" onClick={() => playAll(true)} disabled={!liked.length}>
              Shuffle
            </Button>
            <IconButton
              icon="search"
              label="Find in liked songs"
              onClick={() => navigate("/search")}
            />
          </div>
        </div>
      </header>

      {liked.length === 0 ? (
        <EmptyState
          icon="heart"
          title="No liked songs yet"
          message="Tap the heart on any track to save it here. Your likes stay on this device."
          action={
            <div style={{ display: "flex", gap: 10 }}>
              <Button variant="accent" icon="search" onClick={() => navigate("/search")}>
                Find something to like
              </Button>
              <Link className="btn btn--ghost" to="/search?browse=1" style={{ textDecoration: "none" }}>
                <span>Browse charts</span>
              </Link>
            </div>
          }
        />
      ) : (
        <TrackList
          tracks={liked}
          context={context("Liked songs", "liked", "/liked")}
          virtualHeight={Math.min(720, liked.length * 54 + 48)}
        />
      )}
      {shuffleSeed && liked.length > 0 && (
        <p className="text-muted" style={{ fontSize: 12.5, marginTop: 10 }}>
          Shuffle is on - new queues start shuffled.
        </p>
      )}
    </div>
  );
};

export default Liked;
