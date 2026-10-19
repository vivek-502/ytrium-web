import React, { useCallback, useMemo, useRef, useState } from "react";
import { EmptyState } from "../common/UI";
import Icon from "../common/Icon";
import { TrackRow } from "./TrackRow";
import type { PlayContext, Track } from "../../types";

const ROW_HEIGHT = 54;
const OVERSCAN = 8;

export interface TrackListProps {
  tracks: Track[];
  context?: PlayContext | null;
  /** Sticky column header row (# / Title / Album / Date / Time). */
  showHeader?: boolean;
  showAlbum?: boolean;
  /** "Date added" style label per row; either a static label or a mapper. */
  dateLabels?: string[] | ((index: number) => string | undefined);
  /** Enables drag & drop reordering. */
  onReorder?: (from: number, to: number) => void;
  /** Called instead of playing when a row is removed (X button). */
  onRemove?: (track: Track, index: number) => void;
  playlistId?: string;
  /** Per-row history entry ids (enables "Remove from history" in row menus). */
  entryIds?: string[];
  /** Fixed viewport height enabling windowing for long lists. */
  virtualHeight?: number;
  emptyTitle?: string;
  emptyMessage?: string;
  emptyAction?: React.ReactNode;
}

export const TrackList: React.FC<TrackListProps> = ({
  tracks,
  context,
  showHeader = true,
  showAlbum = true,
  dateLabels,
  onReorder,
  onRemove,
  playlistId,
  entryIds,
  virtualHeight,
  emptyTitle = "Nothing here yet",
  emptyMessage,
  emptyAction,
}) => {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualized = Boolean(virtualHeight) && tracks.length > 40;
  const dateFor = useCallback(
    (i: number): string | undefined => {
      if (!dateLabels) return undefined;
      return typeof dateLabels === "function" ? dateLabels(i) : dateLabels[i];
    },
    [dateLabels]
  );

  const window_ = useMemo(() => {
    if (!virtualized || !virtualHeight) return { start: 0, end: tracks.length };
    const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
    const end = Math.min(tracks.length, Math.ceil((scrollTop + virtualHeight) / ROW_HEIGHT) + OVERSCAN);
    return { start, end };
  }, [virtualized, virtualHeight, scrollTop, tracks.length]);

  const handleDrop = useCallback(
    (to: number) => {
      if (dragIndex !== null && onReorder) onReorder(dragIndex, to);
      setDragIndex(null);
      setOverIndex(null);
    },
    [dragIndex, onReorder]
  );

  if (!tracks.length) {
    return (
      <EmptyState icon="music" title={emptyTitle} message={emptyMessage} action={emptyAction} />
    );
  }

  const header = showHeader ? (
    <div className="track-head" role="row">
      <div style={{ textAlign: "center" }}>#</div>
      <div>Title</div>
      <div>{showAlbum ? "Album" : ""}</div>
      <div>{dateLabels ? "Date" : ""}</div>
      <div style={{ textAlign: "right" }}>
        <Icon name="clock" size={14} />
      </div>
      <div />
    </div>
  ) : null;

  const rows: React.ReactNode[] = [];
  for (let i = window_.start; i < window_.end; i++) {
    const track = tracks[i];
    if (!track) continue;
    rows.push(
      <TrackRow
        key={`${track.id}-${i}`}
        track={track}
        index={i}
        contextTracks={tracks}
        context={context}
        showAlbum={showAlbum}
        dateLabel={dateFor(i)}
        playlistId={playlistId}
        historyEntryId={entryIds ? entryIds[i] : undefined}
        onRemove={onRemove ? () => onRemove(track, i) : undefined}
        draggable={Boolean(onReorder)}
        onDragStart={setDragIndex}
        onDragEnter={setOverIndex}
        onDropRow={handleDrop}
        isDragged={dragIndex === i}
        isDropTarget={overIndex === i && dragIndex !== null && dragIndex !== i}
        style={
          virtualized
            ? { position: "absolute", top: i * ROW_HEIGHT, left: 0, right: 0, height: ROW_HEIGHT }
            : undefined
        }
      />
    );
  }

  const listBody = virtualized ? (
    <div
      ref={scrollRef}
      className="virt-list"
      style={{ height: virtualHeight }}
      onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
      role="rowgroup"
    >
      <div style={{ position: "relative", height: tracks.length * ROW_HEIGHT }}>{rows}</div>
    </div>
  ) : (
    <div className="track-list" role="rowgroup">
      {rows}
    </div>
  );

  return (
    <div className="track-list-wrap" style={{ minWidth: 0 }}>
      {header}
      {listBody}
    </div>
  );
};
