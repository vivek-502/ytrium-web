import Icon from "../common/Icon";
import { ui } from "../../stores/uiStore";
import { useLibraryStore } from "../../stores/libraryStore";
import { usePlayerStore } from "../../stores/playerStore";
import type { PlayContext, Track } from "../../types";

export interface TrackMenuOptions {
  /** Enables "Remove from this playlist" + "Reorder" hints. */
  playlistId?: string;
  /** Enables "Remove from history". */
  historyEntryId?: string;
  /** Extra entries injected before the default block. */
  extra?: Array<{ label: string; icon?: string; danger?: boolean; onSelect: () => void }>;
}

/**
 * Builds and opens the standard track context menu. Shared by track rows,
 * queue rows, the full player and card menus so behaviour is identical.
 */
export function openTrackMenu(
  event: { clientX: number; clientY: number },
  track: Track,
  opts: TrackMenuOptions = {}
) {
  const player = usePlayerStore.getState();
  const library = useLibraryStore.getState();
  const navigate = navigateTo;
  const liked = library.isLiked(track.id);

  const items: Parameters<typeof ui.openMenu>[0]["items"] = [];

  items.push(
    { label: "Play", icon: <Icon name="play" size={15} />, onSelect: () => void player.playTrack(track) },
    {
      label: "Play next",
      icon: <Icon name="skip-next" size={15} />,
      onSelect: () => player.addToQueue(track, { playNext: true }),
    },
    { label: "Add to queue", icon: <Icon name="queue" size={15} />, onSelect: () => player.addToQueue(track) },
    { separator: true },
    {
      label: liked ? "Remove from Liked songs" : "Save to Liked songs",
      icon: <Icon name={liked ? "heart-filled" : "heart"} size={15} />,
      onSelect: () => {
        const nowLiked = library.toggleLike(track);
        ui.toast(nowLiked ? "Added to Liked songs" : "Removed from Liked songs", "success");
      },
    },
    {
      label: "Add to playlist",
      icon: <Icon name="folder-plus" size={15} />,
      onSelect: () => ui.openDialog({ type: "addToPlaylist", trackIds: [track.id] }),
    },
  );

  if (opts.playlistId) {
    items.push({
      label: "Remove from this playlist",
      icon: <Icon name="trash" size={15} />,
      danger: true,
      onSelect: () => {
        library.removeFromPlaylist(opts.playlistId!, track.id);
        ui.toast("Removed from playlist", "success");
      },
    });
  }

  if (opts.historyEntryId) {
    items.push({
      label: "Remove from history",
      icon: <Icon name="trash" size={15} />,
      danger: true,
      onSelect: () => {
        library.removeHistoryEntry(opts.historyEntryId!);
        ui.toast("Removed from history", "success");
      },
    });
  }

  items.push({ separator: true });

  if (opts.extra?.length) {
    for (const extra of opts.extra) {
      items.push({
        label: extra.label,
        icon: extra.icon ? <Icon name={extra.icon} size={15} /> : undefined,
        danger: extra.danger,
        onSelect: extra.onSelect,
      });
    }
  }

  items.push(
    {
      label: "Go to artist",
      icon: <Icon name="mic" size={15} />,
      onSelect: () => navigate(`/artist/${encodeURIComponent(track.artist)}`),
    },
    ...(track.album
      ? [
          {
            label: "Go to album",
            icon: <Icon name="disc" size={15} />,
            onSelect: () =>
              navigate(
                `/album/${encodeURIComponent(track.artist)}/${encodeURIComponent(track.album!)}`
              ),
          },
        ]
      : []),
    {
      label: "Open source page",
      icon: <Icon name="external" size={15} />,
      onSelect: () => {
        if (track.url) window.open(track.url, "_blank", "noopener,noreferrer");
        else ui.toast("No source link for this track", "info");
      },
    },
  );

  ui.openMenu({ x: event.clientX, y: event.clientY, label: `Actions for ${track.title}`, items });
}

/* Context menus need navigation, but this module is outside React. The hook
 * wrapper below keeps a module-level navigator assigned by the app shell. */
let navigateFn: ((to: string) => void) | null = null;

export function setMenuNavigator(fn: (to: string) => void) {
  navigateFn = fn;
}

function navigateTo(to: string) {
  if (navigateFn) navigateFn(to);
}

/** Play context factory used across pages. */
export function context(label: string, kind: PlayContext["kind"], href?: string | null): PlayContext {
  return { label, kind, href: href ?? null };
}
