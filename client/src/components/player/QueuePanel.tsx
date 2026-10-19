import React, { useState } from "react";
import { Artwork, EmptyState, IconButton, cx } from "../common/UI";
import { formatTime } from "../../lib/format";
import { usePlayerStore } from "../../stores/playerStore";
import { useUiStore } from "../../stores/uiStore";
import { openTrackMenu } from "../tracks/trackMenu";
import type { Track } from "../../types";

const QueueRow: React.FC<{
  track: Track;
  index: number;
  isCurrent: boolean;
  draggable: boolean;
  onDragStart: (i: number) => void;
  onDragEnter: (i: number) => void;
  onDrop: (i: number) => void;
  isDragged: boolean;
  isDropTarget: boolean;
}> = ({ track, index, isCurrent, draggable, onDragStart, onDragEnter, onDrop, isDragged, isDropTarget }) => {
  const player = usePlayerStore();
  const isPlaying = usePlayerStore((s) => s.isPlaying);

  return (
    <div
      className={cx("queue-row", isCurrent && "is-current", isDragged && "is-dragging", isDropTarget && "is-drop-target")}
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", String(index));
        onDragStart(index);
      }}
      onDragOver={(e) => {
        if (!draggable) return;
        e.preventDefault();
        onDragEnter(index);
      }}
      onDrop={(e) => {
        if (!draggable) return;
        e.preventDefault();
        onDrop(index);
      }}
      onClick={(e) => {
        if (e.target instanceof HTMLElement && e.target.closest("button, a")) return;
        player.jumpTo(index);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          player.jumpTo(index);
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        openTrackMenu(e, track, {});
      }}
      role="listitem"
      tabIndex={0}
      aria-label={`${track.title} by ${track.artist}`}
    >
      <Artwork src={track.thumbnail} alt="" className="queue-row__art" />
      <div className="queue-row__meta">
        <div className="queue-row__title truncate">{track.title}</div>
        <div className="queue-row__artist truncate">{track.artist}</div>
      </div>
      {isCurrent && (
        <span className={cx("eq", !isPlaying && "paused")} aria-hidden>
          <span />
          <span />
          <span />
        </span>
      )}
      <span className="text-muted" style={{ fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}>
        {track.duration ? formatTime(track.duration) : "—"}
      </span>
      <div className="queue-row__actions">
        <IconButton
          icon="x"
          label={`Remove ${track.title} from queue`}
          size={15}
          disabled={isCurrent}
          onClick={() => player.removeFromQueue(index)}
        />
        <IconButton
          icon="more-horizontal"
          label={`Options for ${track.title}`}
          size={15}
          onClick={(e) => {
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            openTrackMenu({ clientX: rect.right - 230, clientY: rect.bottom + 6 }, track, {});
          }}
        />
      </div>
    </div>
  );
};

export const QueuePanel: React.FC = () => {
  const open = useUiStore((s) => s.queueOpen);
  const setOpen = useUiStore((s) => s.setQueueOpen);
  const { queue, queueIndex, clearUpcoming, moveQueueItem } = usePlayerStore();
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  if (!open) return null;

  const upcoming = queue.slice(queueIndex + 1).map((t, i) => ({ track: t, index: queueIndex + 1 + i }));
  const current = queueIndex >= 0 ? queue[queueIndex] : null;

  const drop = (to: number) => {
    if (dragIndex !== null) moveQueueItem(dragIndex, to);
    setDragIndex(null);
    setOverIndex(null);
  };

  return (
    <aside className="queue-panel" role="dialog" aria-label="Play queue">
      <div className="queue-panel__head">
        <h2 className="queue-panel__title">Queue</h2>
        <div className="queue-panel__actions">
          <button
            type="button"
            className="btn btn--soft btn--sm"
            onClick={clearUpcoming}
            disabled={upcoming.length === 0}
          >
            Clear
          </button>
          <IconButton icon="x" label="Close queue" onClick={() => setOpen(false)} />
        </div>
      </div>

      <div className="queue-panel__body">
        {current ? (
          <>
            <div className="queue-section-label">Now playing</div>
            <QueueRow
              track={current}
              index={queueIndex}
              isCurrent
              draggable={false}
              onDragStart={() => {}}
              onDragEnter={() => {}}
              onDrop={() => {}}
              isDragged={false}
              isDropTarget={false}
            />
          </>
        ) : (
          <EmptyState
            icon="queue"
            title="Your queue is empty"
            message="Play a song, album or playlist and it will show up here."
          />
        )}

        {upcoming.length > 0 && (
          <>
            <div className="queue-section-label">Next up</div>
            <div role="list" onDragLeave={() => setOverIndex(null)}>
              {upcoming.map(({ track, index }) => (
                <QueueRow
                  key={`${track.id}-${index}`}
                  track={track}
                  index={index}
                  isCurrent={false}
                  draggable
                  onDragStart={setDragIndex}
                  onDragEnter={setOverIndex}
                  onDrop={drop}
                  isDragged={dragIndex === index}
                  isDropTarget={overIndex === index && dragIndex !== null && dragIndex !== index}
                />
              ))}
            </div>
          </>
        )}

        {current && upcoming.length === 0 && (
          <p className="text-muted" style={{ padding: "10px 8px", fontSize: 13.5 }}>
            Nothing queued after this track. Enable autoplay or add songs to keep the music going.
          </p>
        )}
      </div>
    </aside>
  );
};

export default QueuePanel;
