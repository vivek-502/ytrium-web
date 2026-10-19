import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Icon from "../common/Icon";
import { Artwork, Button, EmptyState, IconButton, Spinner, cx } from "../common/UI";
import { Dialog, confirmDialog } from "../common/Overlay";
import { useUiStore, ui } from "../../stores/uiStore";
import { useLibraryStore } from "../../stores/libraryStore";
import { usePlayerStore } from "../../stores/playerStore";
import { provider } from "../../providers/apiProvider";
import { useDebouncedValue } from "../../lib/hooks";
import { pluralize } from "../../lib/format";
import type { Track } from "../../types";

/* ------------------------------------------------------ track id resolution */

/** Finds a Track object for an id across local stores, then the provider. */
async function resolveTracksById(ids: string[]): Promise<Track[]> {
  const library = useLibraryStore.getState();
  const queue = usePlayerStore.getState().queue;
  const out: Track[] = [];

  for (const id of ids) {
    const local =
      library.catalog[id] ??
      queue.find((t) => t.id === id) ??
      library.history.find((h) => h.track.id === id)?.track ??
      Object.values(library.liked).find((e) => e.track.id === id)?.track ??
      library.playlists.flatMap((p) => p.tracks).find((t) => t.id === id);

    if (local) {
      out.push(local as Track);
      continue;
    }
    try {
      const remote = await provider.getTrack(id);
      if (remote) out.push(remote);
    } catch {
      /* skip unresolvable ids */
    }
  }
  return out;
}

/* ---------------------------------------------------------- create playlist */

export const CreatePlaylistDialog: React.FC<{
  trackIdHint?: string;
  pendingTrackIds?: string[];
}> = ({ trackIdHint, pendingTrackIds }) => {
  const closeDialog = useUiStore((s) => s.closeDialog);
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const library = useLibraryStore.getState();
      const playlist = library.createPlaylist(name, description);
      const ids = pendingTrackIds ?? (trackIdHint ? [trackIdHint] : []);
      if (ids.length) {
        const tracks = await resolveTracksById(ids);
        for (const t of tracks) library.addToPlaylist(playlist.id, t);
      }
      ui.toast(`Playlist “${playlist.name}” created`, "success");
      closeDialog();
      if (!pendingTrackIds && !trackIdHint) navigate(`/playlist/${playlist.id}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={closeDialog}
      title="Create playlist"
      icon="folder-plus"
      footer={
        <>
          <Button variant="ghost" onClick={closeDialog}>
            Cancel
          </Button>
          <Button variant="accent" onClick={() => void submit()} disabled={!name.trim() || busy}>
            {busy ? "Creating…" : "Create"}
          </Button>
        </>
      }
    >
      <label className="field">
        <span className="field__label">Playlist name</span>
        <input
          className="input"
          value={name}
          autoFocus
          maxLength={80}
          placeholder="Road trip, Focus, Favorites…"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void submit()}
        />
        {!name.trim() && <span className="field__hint">Give your playlist a name.</span>}
      </label>
      <label className="field">
        <span className="field__label">Description (optional)</span>
        <textarea
          className="input"
          value={description}
          maxLength={240}
          placeholder="What's this playlist about?"
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      {pendingTrackIds?.length ? (
        <p className="field__hint">{pluralize(pendingTrackIds.length, "song")} will be added.</p>
      ) : null}
    </Dialog>
  );
};

/* --------------------------------------------------------- add to playlist */

export const AddToPlaylistDialog: React.FC<{ trackIds: string[] }> = ({ trackIds }) => {
  const closeDialog = useUiStore((s) => s.closeDialog);
  const playlists = useLibraryStore((s) => s.playlists);
  const addToPlaylist = useLibraryStore((s) => s.addToPlaylist);
  const [tracks, setTracks] = useState<Track[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    void resolveTracksById(trackIds).then((resolved) => {
      if (!alive) return;
      setTracks(resolved);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [trackIds]);

  const add = (playlistId: string, playlistName: string) => {
    if (!tracks) return;
    let added = 0;
    for (const t of tracks) if (addToPlaylist(playlistId, t)) added += 1;
    ui.toast(
      added ? `Added ${pluralize(added, "song")} to ${playlistName}` : `Already in ${playlistName}`,
      added ? "success" : "info"
    );
    closeDialog();
  };

  return (
    <Dialog
      open
      onClose={closeDialog}
      title="Add to playlist"
      icon="folder-plus"
      footer={
        <>
          <Button
            variant="ghost"
            icon="plus"
            onClick={() =>
              useUiStore
                .getState()
                .openDialog({ type: "createPlaylist", trackIdHint: trackIds[0] })
            }
          >
            New playlist
          </Button>
          <Button variant="soft" onClick={closeDialog}>
            Done
          </Button>
        </>
      }
    >
      {loading ? (
        <div style={{ display: "grid", placeItems: "center", padding: 26 }}>
          <Spinner large label="Loading playlists" />
        </div>
      ) : playlists.length === 0 ? (
        <EmptyState
          icon="folder-plus"
          title="No playlists yet"
          message="Create your first playlist to start collecting songs."
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {playlists.map((playlist) => {
            const alreadyHas = playlist.tracks.some((t) => trackIds.includes(t.id));
            return (
              <button
                key={playlist.id}
                type="button"
                className={cx("sidebar__playlist")}
                style={{ padding: 10 }}
                onClick={() => add(playlist.id, playlist.name)}
              >
                <Artwork src={playlist.image} alt="" size={42} className="sidebar__playlist-art" />
                <span style={{ minWidth: 0, flex: 1, textAlign: "left" }}>
                  <span className="truncate" style={{ display: "block", fontWeight: 650 }}>
                    {playlist.name}
                  </span>
                  <span className="text-muted" style={{ fontSize: 12.5 }}>
                    {pluralize(playlist.tracks.length, "song")}
                  </span>
                </span>
                {alreadyHas ? (
                  <span className="text-muted" style={{ fontSize: 12.5 }}>
                    <Icon name="check" size={16} />
                  </span>
                ) : (
                  <Icon name="plus" size={16} />
                )}
              </button>
            );
          })}
        </div>
      )}
    </Dialog>
  );
};

/* ---------------------------------------------------------- edit playlist */

export const EditPlaylistDialog: React.FC<{ playlistId: string }> = ({ playlistId }) => {
  const closeDialog = useUiStore((s) => s.closeDialog);
  const navigate = useNavigate();
  const playlist = useLibraryStore((s) => s.playlists.find((p) => p.id === playlistId));
  const updatePlaylist = useLibraryStore((s) => s.updatePlaylist);
  const [name, setName] = useState(playlist?.name ?? "");
  const [description, setDescription] = useState(playlist?.description ?? "");

  if (!playlist) return null;

  const save = () => {
    updatePlaylist(playlistId, { name: name.trim() || playlist.name, description });
    ui.toast("Playlist updated", "success");
    closeDialog();
  };

  const remove = async () => {
    const ok = await confirmDialog({
      title: "Delete playlist?",
      message: `“${playlist.name}” and its ${pluralize(playlist.tracks.length, "song")} will be removed from your library.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    useLibraryStore.getState().deletePlaylist(playlistId);
    ui.toast("Playlist deleted", "success");
    closeDialog();
    navigate("/library");
  };

  return (
    <Dialog
      open
      onClose={closeDialog}
      title="Edit playlist details"
      icon="edit"
      footer={
        <>
          <Button variant="ghost" icon="trash" onClick={() => void remove()}>
            Delete
          </Button>
          <span className="spacer" />
          <Button variant="soft" onClick={closeDialog}>
            Cancel
          </Button>
          <Button variant="accent" onClick={save} disabled={!name.trim()}>
            Save
          </Button>
        </>
      }
    >
      <label className="field">
        <span className="field__label">Name</span>
        <input
          className="input"
          value={name}
          autoFocus
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="field">
        <span className="field__label">Description</span>
        <textarea
          className="input"
          value={description}
          maxLength={240}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      <p className="field__hint">
        {pluralize(playlist.tracks.length, "song")} · updated{" "}
        {new Date(playlist.updatedAt).toLocaleDateString()}
      </p>
    </Dialog>
  );
};

/* --------------------------------------------------------- add songs to it */

export const AddSongsToPlaylistDialog: React.FC<{ playlistId: string }> = ({ playlistId }) => {
  const closeDialog = useUiStore((s) => s.closeDialog);
  const playlist = useLibraryStore((s) => s.playlists.find((p) => p.id === playlistId));
  const addToPlaylist = useLibraryStore((s) => s.addToPlaylist);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Track[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const debounced = useDebouncedValue(query, 320);

  useEffect(() => {
    const q = debounced.trim();
    if (q.length < 2) {
      setResults([]);
      setStatus("idle");
      return;
    }
    let alive = true;
    setStatus("loading");
    provider
      .search(q, 15)
      .then((res) => {
        if (!alive) return;
        setResults(res.tracks);
        setStatus("ready");
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setError(err instanceof Error ? err.message : "Search failed");
        setStatus("error");
      });
    return () => {
      alive = false;
    };
  }, [debounced]);

  if (!playlist) return null;

  const add = (track: Track) => {
    const added = addToPlaylist(playlistId, track);
    ui.toast(
      added ? `Added to ${playlist.name}` : `${track.title} is already in this playlist`,
      added ? "success" : "info"
    );
  };

  return (
    <Dialog
      open
      onClose={closeDialog}
      title={`Add songs to ${playlist.name}`}
      icon="plus"
      wide
      footer={
        <Button variant="accent" onClick={closeDialog}>
          Done
        </Button>
      }
    >
      <div className="search-field" style={{ maxWidth: "none" }}>
        <span className="search-field__icon">
          <Icon name="search" size={16} />
        </span>
        <input
          className="input"
          style={{ height: 42, borderRadius: 999, paddingLeft: 42 }}
          value={query}
          autoFocus
          placeholder="Search for songs to add"
          aria-label="Search songs to add"
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {status === "loading" && (
        <div style={{ display: "grid", placeItems: "center", padding: 24 }}>
          <Spinner label="Searching" />
        </div>
      )}
      {status === "error" && <p className="field__error">{error}</p>}
      {status === "idle" && (
        <p className="field__hint">
          Search by song title or artist. Results come from the music provider.
        </p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {results.map((track) => {
          const inPlaylist = playlist.tracks.some((t) => t.id === track.id);
          return (
            <div key={track.id} className="queue-row">
              <Artwork src={track.thumbnail} alt="" className="queue-row__art" />
              <div className="queue-row__meta">
                <div className="queue-row__title truncate">{track.title}</div>
                <div className="queue-row__artist truncate">{track.artist}</div>
              </div>
              <IconButton
                icon={inPlaylist ? "check" : "plus"}
                label={inPlaylist ? "Already in playlist" : `Add ${track.title}`}
                active={inPlaylist}
                disabled={inPlaylist}
                onClick={() => add(track)}
              />
            </div>
          );
        })}
        {status === "ready" && results.length === 0 && (
          <EmptyState icon="search" title="No results" message={`Nothing found for “${debounced}”.`} />
        )}
      </div>
    </Dialog>
  );
};
