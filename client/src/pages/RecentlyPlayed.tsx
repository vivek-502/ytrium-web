import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLibraryStore } from "../stores/libraryStore";
import { ui } from "../stores/uiStore";
import { confirmDialog } from "../components/common/Overlay";
import { TrackList } from "../components/tracks/TrackList";
import { context } from "../components/tracks/trackMenu";
import { Button, EmptyState, RowSkeleton } from "../components/common/UI";
import { formatDayLabel, formatDurationSeconds, formatTime, pluralize } from "../lib/format";
import type { HistoryEntry } from "../types";

interface DayGroup {
  label: string;
  entries: HistoryEntry[];
}

const RecentlyPlayed: React.FC = () => {
  const history = useLibraryStore((s) => s.history);
  const clearHistory = useLibraryStore((s) => s.clearHistory);
  const removeHistoryEntry = useLibraryStore((s) => s.removeHistoryEntry);
  const hydrated = useLibraryStore((s) => s.hydrated);
  const navigate = useNavigate();
  const [clearing, setClearing] = useState(false);

  const groups = useMemo<DayGroup[]>(() => {
    const out: DayGroup[] = [];
    for (const entry of history) {
      const label = formatDayLabel(entry.playedAt);
      const last = out[out.length - 1];
      if (last && last.label === label) last.entries.push(entry);
      else out.push({ label, entries: [entry] });
    }
    return out;
  }, [history]);

  const totalListened = useMemo(
    () => history.reduce((sum, h) => sum + h.durationPlayed, 0),
    [history]
  );

  const clearAll = async () => {
    const ok = await confirmDialog({
      title: "Clear listening history?",
      message:
        "Every entry under Recently played will be removed from this device. Liked songs and playlists are not affected.",
      confirmLabel: "Clear history",
      danger: true,
    });
    if (!ok) return;
    setClearing(true);
    try {
      clearHistory();
      ui.toast("Listening history cleared", "success");
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="page">
      <header className="page-header page-header--icon">
        <div className="page-header__art page-header__art--icon" style={{ display: "grid", placeItems: "center" }} aria-hidden>
          <span className="empty-state__icon" style={{ margin: 0 }}>
            <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7.5V12l3 2" />
            </svg>
          </span>
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="page-header__kind">History</div>
          <h1 className="page-header__title">Recently played</h1>
          <div className="page-header__meta">
            <strong>{pluralize(history.length, "session")}</strong>
            {totalListened > 0 && (
              <>
                <span>·</span>
                <span>{formatDurationSeconds(Math.round(totalListened / 1000))} listened</span>
              </>
            )}
          </div>
          <div className="page-header__actions">
            <Button
              variant="ghost"
              icon="trash"
              onClick={() => void clearAll()}
              disabled={!history.length || clearing}
            >
              Clear history
            </Button>
          </div>
        </div>
      </header>

      {!hydrated ? (
        <div aria-hidden>
          {Array.from({ length: 6 }).map((_, i) => (
            <RowSkeleton key={i} />
          ))}
        </div>
      ) : history.length === 0 ? (
        <EmptyState
          icon="clock"
          title="No listening history yet"
          message="Songs you play show up here, grouped by day, so you can jump back into anything you heard."
          action={
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
              <Button variant="accent" icon="search" onClick={() => navigate("/search")}>
                Find something to play
              </Button>
              <Button variant="ghost" icon="trending" onClick={() => navigate("/search?browse=1")}>
                Browse charts
              </Button>
            </div>
          }
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {groups.map((group) => (
            <section key={group.label} aria-label={`Played ${group.label}`}>
              <div className="day-label">{group.label}</div>
              <TrackList
                tracks={group.entries.map((e) => e.track)}
                context={context("Recently played", "history", "/recently-played")}
                showHeader={false}
                showAlbum
                dateLabels={group.entries.map((e) =>
                  e.count > 1
                    ? `${formatTime(e.durationPlayed / 1000)} · ${e.count}×`
                    : new Date(e.playedAt).toLocaleTimeString(undefined, {
                        hour: "numeric",
                        minute: "2-digit",
                      })
                )}
                entryIds={group.entries.map((e) => e.id)}
                onRemove={(_track, index) => {
                  const entry = group.entries[index];
                  if (!entry) return;
                  removeHistoryEntry(entry.id);
                  ui.toast("Removed from history");
                }}
                virtualHeight={Math.min(group.entries.length * 54, 720)}
              />
            </section>
          ))}
        </div>
      )}
    </div>
  );
};

export default RecentlyPlayed;
