import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useLibraryStore } from "../stores/libraryStore";
import { usePlayerStore } from "../stores/playerStore";
import { ui } from "../stores/uiStore";
import { confirmDialog } from "../components/common/Overlay";
import { TrackList } from "../components/tracks/TrackList";
import { context } from "../components/tracks/trackMenu";
import { Button, EmptyState, IconButton, RowSkeleton } from "../components/common/UI";
import Icon from "../components/common/Icon";
import { formatDurationSeconds, formatRelativeTime, pluralize } from "../lib/format";

const Playlist: React.FC = () => {
  const { playlistId = "" } = useParams();
  const navigate = useNavigate();

  const hydrated = useLibraryStore((s) => s.hydrated);
  const playlist = useLibraryStore((s) => s.playlists.find((p) => p.id === playlistId));
  const reorderPlaylist = useLibraryStore((s) => s.reorderPlaylist);
  const removeFromPlaylist = useLibraryStore((s) => s.removeFromPlaylist);
  const deletePlaylist = useLibraryStore((s) => s.deletePlaylist);
  const togglePlaylistLike = useLibraryStore((s) => s.togglePlaylistLike);

  const [busy, setBusy] = useState(false);

  /* Keep the tab title in sync with the playlist. */
  useEffect(() => {
    const prev = document.title;
    if (playlist) document.title = `${playlist.name} · Ytrium`;
    return () => {
      document.title = prev;
    };
  }, [playlist]);

  const tracks = useMemo(() => playlist?.tracks ?? [], [playlist]);
  const totalDuration = useMemo(
    () => tracks.reduce((sum, t) => sum + (t.duration || 0), 0),
    [tracks]
  );

  if (!hydrated) {
    return (
      <div className="page" aria-busy="true">
        <header className="page-header">
          <div className="page-header__art skeleton skeleton--art" aria-hidden />
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

  if (!playlist) {
    return (
      <div className="page">
        <EmptyState
          icon="folder-plus"
          title="Playlist not found"
          message="It may have been deleted, or the link is no longer valid."
          action={
            <Button variant="accent" onClick={() => navigate("/library")}>
              Open your library
            </Button>
          }
        />
      </div>
    );
  }

  const playAll = (shuffle: boolean) => {
    if (!tracks.length) {
      ui.toast("This playlist is empty - add songs first", "info");
      return;
    }
    const player = usePlayerStore.getState();
    if (shuffle !== player.shuffle) player.toggleShuffle();
    void player.playTracks(tracks, 0, context(playlist.name, "playlist", `/playlist/${playlist.id}`));
  };

  const remove = async () => {
    const ok = await confirmDialog({
      title: `Delete “${playlist.name}”?`,
      message: `This playlist and its ${pluralize(tracks.length, "song")} will be permanently removed from this device.`,
      confirmLabel: "Delete playlist",
      danger: true,
    });
    if (!ok) return;
    deletePlaylist(playlist.id);
    ui.toast(`Deleted “${playlist.name}”`, "success");
    navigate("/library");
  };

  const openMenu = (event: React.MouseEvent) => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    ui.openMenu({
      x: Math.max(8, rect.right - 240),
      y: rect.bottom + 6,
      label: `Options for ${playlist.name}`,
      items: [
        {
          label: "Edit details",
          icon: <Icon name="edit" size={15} />,
          onSelect: () => ui.openDialog({ type: "editPlaylist", playlistId: playlist.id }),
        },
        {
          label: "Add songs",
          icon: <Icon name="plus" size={15} />,
          onSelect: () => ui.openDialog({ type: "addSongsToPlaylist", playlistId: playlist.id }),
        },
        {
          label: playlist.liked ? "Remove from Liked playlists" : "Save to Liked playlists",
          icon: <Icon name={playlist.liked ? "heart-filled" : "heart"} size={15} />,
          onSelect: () => {
            togglePlaylistLike(playlist.id);
            ui.toast(playlist.liked ? "Removed from Liked playlists" : "Saved to Liked playlists", "success");
          },
        },
        { separator: true },
        {
          label: "Delete playlist",
          icon: <Icon name="trash" size={15} />,
          danger: true,
          onSelect: () => void remove(),
        },
      ],
    });
  };

  const hasCover = Boolean(playlist.image);

  return (
    <div className="page">
      <header className="page-header">
        <div
          className="page-header__art"
          style={{
            display: "grid",
            placeItems: "center",
            background: hasCover
              ? undefined
              : "linear-gradient(140deg, var(--accent) 0%, var(--accent-strong) 100%)",
            color: "var(--accent-contrast)",
            backgroundImage: hasCover ? `url(${playlist.image!})` : undefined,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
          aria-hidden={!hasCover}
          role={hasCover ? "img" : undefined}
          aria-label={hasCover ? `${playlist.name} cover` : undefined}
        >
          {!hasCover && <Icon name="list" size={64} />}
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="page-header__kind">Playlist</div>
          <h1 className="page-header__title">{playlist.name}</h1>
          {playlist.description && <p className="page-header__desc">{playlist.description}</p>}
          <div className="page-header__meta">
            <strong>{pluralize(tracks.length, "song")}</strong>
            {totalDuration > 0 && (
              <>
                <span>·</span>
                <span>{formatDurationSeconds(totalDuration)}</span>
              </>
            )}
            <span>·</span>
            <span>Updated {formatRelativeTime(playlist.updatedAt)}</span>
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
            <Button
              variant="ghost"
              icon="plus"
              onClick={() => ui.openDialog({ type: "addSongsToPlaylist", playlistId: playlist.id })}
            >
              Add songs
            </Button>
            <IconButton
              icon={playlist.liked ? "heart-filled" : "heart"}
              label={playlist.liked ? "Remove from Liked playlists" : "Save to Liked playlists"}
              active={Boolean(playlist.liked)}
              onClick={() => {
                togglePlaylistLike(playlist.id);
                ui.toast(
                  playlist.liked ? "Removed from Liked playlists" : "Saved to Liked playlists",
                  "success"
                );
              }}
            />
            <IconButton icon="more-horizontal" label="More options" onClick={openMenu} />
          </div>
        </div>
      </header>

      {tracks.length === 0 ? (
        <EmptyState
          icon="music"
          title="No songs in this playlist yet"
          message="Search for music and add it here - it stays saved on this device."
          action={
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
              <Button
                variant="accent"
                icon="plus"
                onClick={() => ui.openDialog({ type: "addSongsToPlaylist", playlistId: playlist.id })}
              >
                Add songs
              </Button>
              <Button variant="ghost" icon="search" onClick={() => navigate("/search")}>
                Search music
              </Button>
            </div>
          }
        />
      ) : (
        <div style={{ position: "relative" }} aria-busy={busy}>
          <TrackList
            tracks={tracks}
            context={context(playlist.name, "playlist", `/playlist/${playlist.id}`)}
            showHeader
            showAlbum
            playlistId={playlist.id}
            dateLabels={tracks.map(() => formatRelativeTime(playlist.updatedAt))}
            onReorder={(from, to) => {
              setBusy(true);
              reorderPlaylist(playlist.id, from, to);
              setBusy(false);
            }}
            onRemove={(track) => {
              removeFromPlaylist(playlist.id, track.id);
              ui.toast(`Removed “${track.title}” from ${playlist.name}`);
            }}
            virtualHeight={Math.min(tracks.length * 54 + 48, 900)}
            emptyTitle="No songs yet"
            emptyMessage="Add songs to build this playlist."
          />
        </div>
      )}
    </div>
  );
};

export default Playlist;
