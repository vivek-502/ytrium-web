import React from "react";
import Icon from "../common/Icon";
import { Skeleton, cx } from "../common/UI";
import { useLyricsStore } from "../../stores/lyricsStore";
import { usePlayerStore } from "../../stores/playerStore";
import { useSettingsStore } from "../../stores/settingsStore";
import type { Track } from "../../types";

const SOURCE_LABELS: Record<string, string> = {
  lrclib: "LRCLIB",
  "youtube-captions": "YouTube captions",
};

/** Last synced line whose timestamp is at or before `currentTime`. */
function activeIndex(times: number[], currentTime: number): number {
  let lo = 0;
  let hi = times.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= currentTime) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

const SKELETON_WIDTHS = ["86%", "64%", "78%", "52%", "70%", "40%"];

/**
 * Lyrics card for the full player. Resolves lyrics through the (backend-bound)
 * provider once per session, then renders time-synced lines with a
 * follow-along highlight, plain text, or a graceful empty/instrumental state.
 */
export const LyricsPanel: React.FC<{ track: Track }> = ({ track }) => {
  const entry = useLyricsStore((s) => s.byId[track.id]);
  const fetchLyrics = useLyricsStore((s) => s.fetchLyrics);
  const currentTime = usePlayerStore((st) => st.currentTime);
  const reduceMotion = useSettingsStore((st) => st.settings.reduceMotion);

  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const lineRefs = React.useRef<(HTMLDivElement | null)[]>([]);
  const lastUserScroll = React.useRef(0);

  const fetch = React.useCallback(() => fetchLyrics(track), [fetchLyrics, track]);
  React.useEffect(() => {
    fetch();
  }, [fetch]);

  const status = entry?.status ?? "loading";
  const data = entry?.data ?? null;

  const synced = data?.synced && data.synced.length ? data.synced : null;
  const times = synced ? synced.map((l) => l.time) : null;
  const idx = times ? activeIndex(times, currentTime) : -1;

  // Follow-along scrolling: recenter the active line, but never fight the
  // user while they are reading ahead/behind.
  React.useLayoutEffect(() => {
    if (status !== "ready" || !synced || idx < 0) return;
    if (Date.now() - lastUserScroll.current < 4000) return;
    const box = scrollRef.current;
    const el = lineRefs.current[idx];
    if (!box || !el) return;
    const target = el.offsetTop - box.clientHeight / 2 + el.clientHeight / 2;
    box.scrollTo({
      top: Math.max(0, Math.min(target, box.scrollHeight - box.clientHeight)),
      behavior: reduceMotion ? "auto" : "smooth",
    });
  }, [idx, status, synced, reduceMotion]);

  const markUserScroll = React.useCallback(() => {
    lastUserScroll.current = Date.now();
  }, []);

  let body: React.ReactNode;

  if (status === "loading") {
    body = (
      <div className="full-player__lyrics-skeleton" aria-hidden>
        {SKELETON_WIDTHS.map((w, i) => (
          <Skeleton key={i} w={w} h={12} />
        ))}
      </div>
    );
  } else if (status === "error") {
    body = (
      <div className="full-player__lyrics-state" role="status">
        <Icon name="warning" size={20} />
        <p>{entry?.error || "Could not load lyrics."}</p>
        <button
          type="button"
          className="btn btn--soft btn--sm"
          onClick={() => fetchLyrics(track, { force: true })}
        >
          <Icon name="refresh" size={14} />
          <span>Retry</span>
        </button>
      </div>
    );
  } else if (!data || status === "missing") {
    body = (
      <div className="full-player__lyrics-state" role="status">
        <Icon name="music" size={20} />
        <p>No lyrics found for this track.</p>
      </div>
    );
  } else if (data.instrumental) {
    body = (
      <div className="full-player__lyrics-state" role="status">
        <Icon name="disc" size={20} />
        <p>Instrumental</p>
        <span className="full-player__lyrics-hint">This track has no vocals.</span>
      </div>
    );
  } else if (synced) {
    body = (
      <div
        className={cx("full-player__lyrics-body", "full-player__lyrics-body--synced")}
        ref={scrollRef}
        onWheel={markUserScroll}
        onTouchMove={markUserScroll}
      >
        {synced.map((line, i) => (
          <div
            key={`${line.time}-${i}`}
            ref={(el) => {
              lineRefs.current[i] = el;
            }}
            className={cx(
              "full-player__line",
              i === idx && "is-active",
              i < idx && "full-player__line--past",
              i > idx && "full-player__line--upcoming",
            )}
          >
            {line.text}
          </div>
        ))}
      </div>
    );
  } else if (data.plainText) {
    body = (
      <div className="full-player__lyrics-body full-player__lyrics-body--static">
        <p className="full-player__lyrics-plain">{data.plainText}</p>
      </div>
    );
  } else {
    body = (
      <div className="full-player__lyrics-state" role="status">
        <p>No lyrics found for this track.</p>
      </div>
    );
  }

  return (
    <>
      <div className="full-player__lyrics-head">
        <span className="full-player__lyrics-label">Lyrics</span>
        {status === "ready" && data && (
          <span className="full-player__lyrics-note">{SOURCE_LABELS[data.source] ?? data.source}</span>
        )}
      </div>
      {body}
    </>
  );
};

export default LyricsPanel;