import React from "react";
import { useNavigate } from "react-router-dom";
import Icon from "../common/Icon";
import { Artwork, Slider, cx } from "../common/UI";
import { formatTime } from "../../lib/format";
import { usePlayerStore } from "../../stores/playerStore";
import { useLibraryStore } from "../../stores/libraryStore";
import { useUiStore } from "../../stores/uiStore";
import { openTrackMenu } from "../tracks/trackMenu";
import { LyricsPanel } from "./LyricsPanel";

/** Escape closes the full player; the queue drawer stays independent. */
function useEscape(onClose: () => void) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
}

export const FullPlayer: React.FC = () => {
  const navigate = useNavigate();
  const open = useUiStore((s) => s.fullPlayerOpen);
  const setOpen = useUiStore((s) => s.setFullPlayerOpen);
  const queueOpen = useUiStore((s) => s.queueOpen);
  const setQueueOpen = useUiStore((s) => s.setQueueOpen);
  const lyricsOpen = useUiStore((s) => s.lyricsOpen);
  const setLyricsOpen = useUiStore((s) => s.setLyricsOpen);

  const s = usePlayerStore();
  const liked = useLibraryStore((st) => Boolean(s.currentTrack && st.liked[s.currentTrack.id]));
  const toggleLike = useLibraryStore((st) => st.toggleLike);

  const close = React.useCallback(() => setOpen(false), [setOpen]);
  useEscape(close);

  if (!open || !s.currentTrack) return null;
  const track = s.currentTrack;
  const duration = s.duration || track.duration || 0;
  const progress = duration > 0 ? Math.min(1, s.currentTime / duration) : 0;
  const volumeIcon = s.isMuted || s.volume === 0 ? "volume-mute" : s.volume < 0.5 ? "volume-low" : "volume-high";

  return (
    <div
      className={cx("full-player", !lyricsOpen && "full-player--no-lyrics")}
      role="dialog"
      aria-modal="true"
      aria-label="Now playing"
    >
      {track.thumbnail && (
        // Immersive backdrop: the artwork blown up + blurred behind the UI.
        <img className="full-player__bg-img" src={track.thumbnail} alt="" aria-hidden="true" draggable={false} />
      )}
      <div className="full-player__bg-tint" aria-hidden="true" />
      <div className="full-player__top">
        <button type="button" className="icon-btn" aria-label="Close full player" onClick={close}>
          <Icon name="chevron-down" size={22} />
        </button>
        <div style={{ textAlign: "center" }}>
          <div className="full-player__context">
            {s.context?.label ? `Playing from ${s.context.label}` : "Now playing"}
          </div>
        </div>
        <button
          type="button"
          className="icon-btn"
          aria-label="Track options"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            openTrackMenu({ clientX: Math.max(8, rect.right - 230), clientY: rect.bottom + 8 }, track, {});
          }}
        >
          <Icon name="more-horizontal" size={20} />
        </button>
      </div>

      <div className="full-player__body">
        <div className="full-player__art-wrap">
          <Artwork src={track.thumbnail} alt={`${track.title} artwork`} className="full-player__art" icon="music" />
        </div>

        <div className="full-player__details">
          <div>
            <h1 className="full-player__title clamp-2">{track.title}</h1>
            <button
              type="button"
              className="full-player__artist"
              onClick={() => {
                close();
                navigate(`/artist/${encodeURIComponent(track.artist)}`);
              }}
            >
              {track.artist}
            </button>
            {track.album && (
              <div className="full-player__album-meta">
                <button
                  type="button"
                  onClick={() => {
                    close();
                    navigate(
                      `/album/${encodeURIComponent(track.artist)}/${encodeURIComponent(track.album!)}`
                    );
                  }}
                  style={{ background: "none" }}
                >
                  {track.album}
                </button>
              </div>
            )}
          </div>

          <div className="full-player__progress">
            <Slider
              value={progress}
              label="Seek"
              ariaValueText={(v) => `${formatTime(v * duration)} of ${formatTime(duration)}`}
              onChange={(v) => s.seek(v * duration)}
            />
            <div className="full-player__times">
              <span>{formatTime(s.currentTime)}</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>

          <div className="full-player__controls">
            <button
              type="button"
              className={cx("icon-btn", s.shuffle && "icon-btn--active")}
              aria-label="Toggle shuffle"
              aria-pressed={s.shuffle}
              onClick={s.toggleShuffle}
            >
              <Icon name="shuffle" size={20} />
            </button>
            <button type="button" className="icon-btn" aria-label="Previous track" onClick={s.previous}>
              <Icon name="skip-prev" size={24} />
            </button>
            <button
              type="button"
              className="full-player__play"
              aria-label={s.isPlaying ? "Pause" : "Play"}
              onClick={() => void s.togglePlay()}
            >
              <Icon name={s.isPlaying ? "pause" : "play"} size={26} />
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label="Next track"
              onClick={() => void s.next()}
            >
              <Icon name="skip-next" size={24} />
            </button>
            <button
              type="button"
              className={cx("icon-btn", s.repeatMode !== "off" && "icon-btn--active")}
              aria-label={`Repeat: ${s.repeatMode}`}
              aria-pressed={s.repeatMode !== "off"}
              onClick={s.cycleRepeat}
            >
              <Icon name={s.repeatMode === "one" ? "repeat-1" : "repeat"} size={20} />
            </button>
          </div>

          <div className="full-player__secondary">
            <button
              type="button"
              className={cx("icon-btn", liked && "icon-btn--active")}
              aria-label={liked ? "Unlike this song" : "Like this song"}
              aria-pressed={liked}
              onClick={() => toggleLike(track)}
            >
              <Icon name={liked ? "heart-filled" : "heart"} size={20} />
            </button>

            <button
              type="button"
              className={cx("icon-btn", lyricsOpen && "icon-btn--active")}
              aria-label={lyricsOpen ? "Hide lyrics" : "Show lyrics"}
              aria-pressed={lyricsOpen}
              onClick={() => setLyricsOpen(!lyricsOpen)}
            >
              <Icon name="mic" size={20} />
            </button>

            <div className="player-bar__volume" style={{ width: 160 }}>
              <button
                type="button"
                className="icon-btn"
                aria-label={s.isMuted ? "Unmute" : "Mute"}
                onClick={s.toggleMute}
              >
                <Icon name={volumeIcon} size={18} />
              </button>
              <Slider
                value={s.isMuted ? 0 : s.volume}
                label="Volume"
                ariaValueText={(v) => `Volume ${Math.round(v * 100)}%`}
                onChange={(v) => s.setVolume(v)}
                muted={s.isMuted || s.volume === 0}
              />
            </div>

            <button
              type="button"
              className={cx("icon-btn", queueOpen && "icon-btn--active")}
              aria-label="Toggle queue"
              aria-pressed={queueOpen}
              onClick={() => setQueueOpen(!queueOpen)}
            >
              <Icon name="queue" size={20} />
            </button>
          </div>

          {s.error && (
            <div className="error-banner" role="alert">
              <span className="error-banner__icon">
                <Icon name="warning" size={18} />
              </span>
              <span style={{ flex: 1 }}>{s.error}</span>
              <button type="button" className="btn btn--soft btn--sm" onClick={s.retry}>
                Retry
              </button>
            </div>
          )}
        </div>

        {lyricsOpen && (
          <div className="full-player__lyrics" role="region" aria-label="Lyrics">
            <LyricsPanel track={track} />
          </div>
        )}
      </div>
    </div>
  );
};

export default FullPlayer;
