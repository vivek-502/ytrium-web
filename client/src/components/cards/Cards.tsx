import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import Icon from "../common/Icon";
import { Artwork, DropdownMenu, cx, type MenuEntry } from "../common/UI";
import { ui } from "../../stores/uiStore";
import { usePlayerStore } from "../../stores/playerStore";
import { useLibraryStore } from "../../stores/libraryStore";
import { provider } from "../../providers/apiProvider";
import { context } from "../tracks/trackMenu";
import { pluralize } from "../../lib/format";
import type { Album, Artist, DailyMix, Playlist, RemotePlaylist, Track } from "../../types";

/* ------------------------------------------------------------------- base */

interface MediaCardProps {
  title: string;
  subtitle?: React.ReactNode;
  image?: string | null;
  /** Round artwork (artists). */
  round?: boolean;
  href?: string;
  onOpen?: () => void;
  onPlay?: () => void | Promise<void>;
  menu?: MenuEntry[];
  badge?: string;
  ariaLabel?: string;
}

export const MediaCard: React.FC<MediaCardProps> = ({
  title,
  subtitle,
  image,
  round,
  href,
  onOpen,
  onPlay,
  menu,
  badge,
  ariaLabel,
}) => {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const open = () => {
    if (onOpen) onOpen();
    else if (href) navigate(href);
  };

  const play = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onPlay || busy) return;
    setBusy(true);
    try {
      await onPlay();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={cx("card", round && "card--round")}
      role="button"
      tabIndex={0}
      aria-label={ariaLabel ?? title}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      }}
      onContextMenu={(e) => {
        if (!menu) return;
        e.preventDefault();
        const rect = e.currentTarget.getBoundingClientRect();
        ui.openMenu({
          x: Math.min(e.clientX, window.innerWidth - 250),
          y: Math.min(e.clientY, window.innerHeight - 260),
          label: `Actions for ${title}`,
          items: menu,
        });
        void rect;
      }}
    >
      <div className="card__art-wrap">
        <Artwork src={image} alt={title} className="card__art-inner" icon={round ? "mic" : "disc"} />
        {badge && <span className="artwork__badge">{badge}</span>}
        {onPlay && (
          <button
            type="button"
            className="card__play"
            aria-label={`Play ${title}`}
            disabled={busy}
            onClick={play}
          >
            <Icon name={busy ? "refresh" : "play"} size={20} />
          </button>
        )}
      </div>
      <div className="card__title truncate" title={typeof title === "string" ? title : undefined}>
        {title}
      </div>
      {subtitle !== undefined && subtitle !== null && (
        <div className="card__subtitle truncate" title={typeof subtitle === "string" ? subtitle : undefined}>
          {subtitle}
        </div>
      )}
      {menu && (
        <div style={{ position: "absolute", top: 8, right: 8 }} onClick={(e) => e.stopPropagation()}>
          <DropdownMenu
            ariaLabel={`${title} options`}
            align="end"
            entries={menu}
            trigger={(openMenu) => (
              <button type="button" className="icon-btn" aria-label={`Options for ${title}`} onClick={openMenu}>
                <Icon name="more-horizontal" size={16} />
              </button>
            )}
          />
        </div>
      )}
    </div>
  );
};

/* ----------------------------------------------------------------- Album */

export const AlbumCard: React.FC<{ album: Album }> = ({ album }) => {
  const navigate = useNavigate();
  const href = `/album/${encodeURIComponent(album.artist)}/${encodeURIComponent(album.title)}`;
  const playAlbum = async () => {
    try {
      const detail = await provider.getAlbum(album.artist, album.title);
      if (!detail.tracks.length) {
        ui.toast("No playable tracks found for this album", "error");
        return;
      }
      usePlayerStore
        .getState()
        .playTracks(detail.tracks, 0, context(album.title, "album", href));
    } catch (err) {
      ui.toast(err instanceof Error ? err.message : "Could not load this album", "error");
    }
  };
  return (
    <MediaCard
      title={album.title}
      subtitle={album.artist}
      image={album.image}
      href={href}
      onPlay={() => playAlbum()}
      menu={[
        { label: "Play album", icon: <Icon name="play" size={15} />, onSelect: () => void playAlbum() },
        {
          label: "Go to artist",
          icon: <Icon name="mic" size={15} />,
          onSelect: () => navigate(`/artist/${encodeURIComponent(album.artist)}`),
        },
      ]}
    />
  );
};

/* ---------------------------------------------------------------- Artist */

export const ArtistCard: React.FC<{ artist: Artist }> = ({ artist }) => (
  <MediaCard
    round
    title={artist.name}
    subtitle="Artist"
    image={artist.image}
    href={`/artist/${encodeURIComponent(artist.name)}`}
    ariaLabel={`Open artist ${artist.name}`}
  />
);

/* -------------------------------------------------------------- Playlist */

export const PlaylistCard: React.FC<{ playlist: Playlist }> = ({ playlist }) => {
  const navigate = useNavigate();
  const playPlaylist = () => {
    const tracks = playlist.tracks;
    if (!tracks.length) {
      ui.toast("This playlist is empty", "info");
      navigate(`/playlist/${playlist.id}`);
      return;
    }
    void usePlayerStore
      .getState()
      .playTracks(tracks, 0, context(playlist.name, "playlist", `/playlist/${playlist.id}`));
  };
  return (
    <MediaCard
      title={playlist.name}
      subtitle={playlist.tracks.length ? pluralize(playlist.tracks.length, "song") : "Playlist"}
      image={playlist.image}
      href={`/playlist/${playlist.id}`}
      onPlay={playPlaylist}
      menu={[
        { label: "Play playlist", icon: <Icon name="play" size={15} />, onSelect: playPlaylist },
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
        { separator: true },
        {
          label: "Delete playlist",
          icon: <Icon name="trash" size={15} />,
          danger: true,
          onSelect: () =>
            ui.openDialog({
              type: "confirm",
              title: "Delete playlist?",
              message: `“${playlist.name}” and its ${playlist.tracks.length} songs will be removed from your library.`,
              confirmLabel: "Delete",
              danger: true,
              onConfirm: () => {
                useLibraryStore.getState().deletePlaylist(playlist.id);
                ui.toast("Playlist deleted", "success");
                if (window.location.pathname.includes(`/playlist/${playlist.id}`)) navigate("/library");
              },
            }),
        },
      ]}
    />
  );
};

/* --------------------------------------------------- YouTube (remote) playlist */

/**
 * A public YouTube playlist from search.
 *
 * Its tracks live on YouTube, so both play and save fetch them first. Saving
 * stores a normal local playlist (with `sourcePlaylistId`), so it then appears
 * in Library > Playlists and works like any other playlist.
 */
export const RemotePlaylistCard: React.FC<{ playlist: RemotePlaylist }> = ({ playlist }) => {
  const navigate = useNavigate();
  const saved = useLibraryStore((s) => s.hasRemotePlaylist(playlist.id));
  const save = useLibraryStore((s) => s.saveRemotePlaylist);
  const [busy, setBusy] = useState(false);

  /** Clicking the card opens the playlist page; it fetches the songs there. */
  const href = `/ytplaylist/${encodeURIComponent(playlist.id)}?${new URLSearchParams({
    title: playlist.title,
    owner: playlist.owner || "",
    ...(playlist.image ? { image: playlist.image } : {}),
  }).toString()}`;

  const loadTracks = async (): Promise<Track[] | null> => {
    try {
      const tracks = await provider.getPlaylistTracks(playlist.id);
      if (!tracks.length) {
        ui.toast("This playlist has no playable songs", "error");
        return null;
      }
      return tracks;
    } catch (err) {
      ui.toast(
        err instanceof Error ? err.message : "Could not load this playlist",
        "error"
      );
      return null;
    }
  };

  /** The play button streams straight away, without opening the page. */
  const play = async () => {
    setBusy(true);
    const tracks = await loadTracks();
    setBusy(false);
    if (!tracks) return;
    void usePlayerStore
      .getState()
      .playTracks(
        tracks,
        0,
        context(playlist.title, "playlist", null)
      );
  };

  const saveToLibrary = async () => {
    if (saved) {
      ui.toast("Already in your library", "info");
      return;
    }
    setBusy(true);
    const tracks = await loadTracks();
    setBusy(false);
    if (!tracks) return;
    save(playlist, tracks);
    ui.toast(`Saved “${playlist.title}” to your library`, "success");
  };

  const subtitle = saved
    ? "In your library"
    : playlist.owner || "YouTube playlist";

  return (
    <MediaCard
      title={playlist.title}
      subtitle={subtitle}
      image={playlist.image}
      badge={playlist.official ? "Official" : undefined}
      ariaLabel={`Open YouTube playlist ${playlist.title}`}
      href={href}
      onPlay={busy ? undefined : () => void play()}
      menu={[
        {
          label: "Open playlist",
          icon: <Icon name="list" size={15} />,
          onSelect: () => navigate(href),
        },
        {
          label: "Play now",
          icon: <Icon name="play" size={15} />,
          onSelect: () => void play(),
        },
        saved
          ? {
              label: "In your library",
              icon: <Icon name="check" size={15} />,
              disabled: true,
              onSelect: () => {},
            }
          : {
              label: "Save to library",
              icon: <Icon name="plus" size={15} />,
              onSelect: () => void saveToLibrary(),
            },
      ]}
    />
  );
};

/* ------------------------------------------------------------------- Mix */

export const MixCard: React.FC<{ mix: DailyMix }> = ({ mix }) => {
  const playMix = () =>
    void usePlayerStore.getState().playTracks(mix.tracks, 0, context(mix.name, "playlist"));
  return (
    <MediaCard
      title={mix.name}
      subtitle={mix.subtitle}
      image={mix.image}
      badge="Mix"
      onOpen={() => playMix()}
      onPlay={playMix}
    />
  );
};

/* ------------------------------------------------------------- QuickPick */

export const QuickPickTile: React.FC<{
  kind: "track" | "playlist" | "album";
  title: string;
  subtitle: string;
  image: string | null;
  onPlay: () => void;
  onOpen?: () => void;
}> = ({ title, subtitle, image, onPlay, onOpen }) => {
  return (
    <div
      className="card"
      style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 10 }}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen?.();
        }
      }}
    >
      <Artwork src={image} alt={title} size={52} icon="music" />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="card__title truncate">{title}</div>
        <div className="card__subtitle truncate" style={{ marginTop: 0 }}>
          {subtitle}
        </div>
      </div>
      <button
        type="button"
        className="icon-btn"
        aria-label={`Play ${title}`}
        onClick={(e) => {
          e.stopPropagation();
          onPlay();
        }}
      >
        <Icon name="play" size={17} />
      </button>
    </div>
  );
};

/* ------------------------------------------------------ track card (grid) */

export const TrackCard: React.FC<{ track: Track }> = ({ track }) => {
  const player = usePlayerStore.getState();
  return (
    <MediaCard
      title={track.title}
      subtitle={track.artist}
      image={track.thumbnail}
      onPlay={() => void player.playTrack(track, [track], context("Track", "search"))}
    />
  );
};
