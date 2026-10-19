import React from "react";
import { useNavigate } from "react-router-dom";
import Icon from "../common/Icon";
import { Artwork, cx } from "../common/UI";
import { formatTime } from "../../lib/format";
import { useLibraryStore } from "../../stores/libraryStore";
import { usePlayerStore } from "../../stores/playerStore";
import { ui } from "../../stores/uiStore";
import { openTrackMenu } from "./trackMenu";
import type { PlayContext, Track } from "../../types";

export interface TrackRowProps {
  track: Track;
  index: number;
  /** The full list this row belongs to; playing starts at `index` in it. */
  contextTracks: Track[];
  context?: PlayContext | null;
  /** Hide the album column (still used as a spacer for the grid). */
  showAlbum?: boolean;
  /** Text for the "date added" column (playlists, history). */
  dateLabel?: string;
  playlistId?: string;
  historyEntryId?: string;
  onRemove?: () => void;
  draggable?: boolean;
  onDragStart?: (index: number) => void;
  onDragEnter?: (index: number) => void;
  onDropRow?: (index: number) => void;
  isDragged?: boolean;
  isDropTarget?: boolean;
  style?: React.CSSProperties;
}

export const TrackRow: React.FC<TrackRowProps> = ({
  track,
  index,
  contextTracks,
  context,
  showAlbum = true,
  dateLabel,
  playlistId,
  historyEntryId,
  onRemove,
  draggable,
  onDragStart,
  onDragEnter,
  onDropRow,
  isDragged,
  isDropTarget,
  style,
}) => {
  const navigate = useNavigate();
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const playTracks = usePlayerStore((s) => s.playTracks);
  const liked = useLibraryStore((s) => Boolean(s.liked[track.id]));
  const toggleLike = useLibraryStore((s) => s.toggleLike);

  const isCurrent = currentTrack?.id === track.id;
  const play = () => void playTracks(contextTracks, index, context ?? null);

  const goToArtist = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigate(`/artist/${encodeURIComponent(track.artist)}`);
  };
  const goToAlbum = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!track.album) return;
    navigate(`/album/${encodeURIComponent(track.artist)}/${encodeURIComponent(track.album)}`);
  };

  return (
    <div
      className={cx(
        "track-row",
        isCurrent && "is-current",
        isDragged && "is-dragging",
        isDropTarget && "is-drop-target"
      )}
      style={style}
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", String(index));
        onDragStart?.(index);
      }}
      onDragOver={(e) => {
        if (!draggable) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        onDragEnter?.(index);
      }}
      onDrop={(e) => {
        if (!draggable) return;
        e.preventDefault();
        onDropRow?.(index);
      }}
      onDoubleClick={play}
      onContextMenu={(e) => {
        e.preventDefault();
        openTrackMenu(e, track, { playlistId, historyEntryId });
      }}
      aria-label={`${track.title} by ${track.artist}`}
    >
      <div className="track-row__index">
        {isCurrent ? (
          <span className={cx("eq", !isPlaying && "paused")} aria-label={isPlaying ? "Now playing" : "Paused"}>
            <span />
            <span />
            <span />
          </span>
        ) : (
          <>
            <span className="track-row__index-num">{index + 1}</span>
            <span className="track-row__play-hint">
              <button
                type="button"
                className="icon-btn"
                style={{ width: 26, height: 26 }}
                aria-label={`Play ${track.title}`}
                onClick={(e) => {
                  e.stopPropagation();
                  play();
                }}
              >
                <Icon name="play" size={15} />
              </button>
            </span>
          </>
        )}
      </div>

      <div className="track-row__main">
        <Artwork src={track.thumbnail} alt={track.title} className="track-row__art" />
        <div className="track-row__meta">
          <div className="track-row__title truncate" title={track.title}>
            {track.title}
          </div>
          <button type="button" className="track-row__artist truncate" onClick={goToArtist} title={track.artist}>
            {track.artist}
          </button>
        </div>
      </div>

      <div className="track-row__album truncate">
        {showAlbum && track.album ? (
          <button
            type="button"
            className="track-row__album"
            title={track.album}
            onClick={goToAlbum}
            style={{ background: "none", textAlign: "left", width: "100%" }}
          >
            {track.album}
          </button>
        ) : (
          <span className="text-muted">—</span>
        )}
      </div>

      <div className="track-row__date truncate">{dateLabel ?? ""}</div>
      <div className="track-row__duration">{track.duration ? formatTime(track.duration) : "—:—"}</div>

      <div className="track-row__actions">
        <button
          type="button"
          className={cx("icon-btn", "track-row__like", liked && "is-liked")}
          aria-label={liked ? `Unlike ${track.title}` : `Like ${track.title}`}
          aria-pressed={liked}
          onClick={(e) => {
            e.stopPropagation();
            const nowLiked = toggleLike(track);
            if (nowLiked) ui.toast(`Liked ${track.title}`, "success");
          }}
        >
          <Icon name={liked ? "heart-filled" : "heart"} size={16} />
        </button>
        {onRemove && (
          <button
            type="button"
            className="icon-btn"
            aria-label={`Remove ${track.title} from this list`}
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
          >
            <Icon name="x" size={16} />
          </button>
        )}
        <button
          type="button"
          className="icon-btn"
          aria-label={`More options for ${track.title}`}
          onClick={(e) => {
            e.stopPropagation();
            const rect = e.currentTarget.getBoundingClientRect();
            openTrackMenu(
              { clientX: Math.max(8, rect.right - 230), clientY: rect.bottom + 6 },
              track,
              { playlistId, historyEntryId }
            );
          }}
        >
          <Icon name="more-horizontal" size={16} />
        </button>
      </div>
    </div>
  );
};

export default TrackRow;
