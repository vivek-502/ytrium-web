import React from "react";
import { useNavigate } from "react-router-dom";
import Icon from "../common/Icon";
import { Artwork, Slider, cx } from "../common/UI";
import { formatTime } from "../../lib/format";
import { usePlayerStore } from "../../stores/playerStore";
import { useLibraryStore } from "../../stores/libraryStore";
import { useUiStore } from "../../stores/uiStore";
import { openTrackMenu } from "../tracks/trackMenu";

const RepeatIcon: React.FC<{ mode: "off" | "one" | "all" }> = ({ mode }) => (
  <Icon name={mode === "one" ? "repeat-1" : "repeat"} size={17} />
);

export const PlayerBar: React.FC = () => {
  const navigate = useNavigate();
  const s = usePlayerStore();
  const liked = useLibraryStore((st) => Boolean(s.currentTrack && st.liked[s.currentTrack.id]));
  const toggleLike = useLibraryStore((st) => st.toggleLike);
  const setQueueOpen = useUiStore((st) => st.setQueueOpen);
  const queueOpen = useUiStore((st) => st.queueOpen);
  const setFullPlayerOpen = useUiStore((st) => st.setFullPlayerOpen);

  const track = s.currentTrack;
  const duration = s.duration || track?.duration || 0;
  const progress = duration > 0 ? Math.min(1, s.currentTime / duration) : 0;

  const togglePlay = () => void s.togglePlay();
  const openFull = () => setFullPlayerOpen(true);

  const volumeIcon = s.isMuted || s.volume === 0 ? "volume-mute" : s.volume < 0.5 ? "volume-low" : "volume-high";

  return (
    <div className="player-bar" role="region" aria-label="Player">
      {s.error && (
        <div className="player-bar__status player-bar__status--error" role="alert">
          <span className="player-bar__status-icon">
            <Icon name="warning" size={15} />
          </span>
          <span>{s.error}</span>
          <button type="button" className="player-bar__status-action" onClick={s.retry}>
            Retry
          </button>
          <button type="button" className="player-bar__status-action" onClick={s.dismissError}>
            Dismiss
          </button>
        </div>
      )}
      {!s.error && s.buffering && track && (
        <div className="player-bar__status" role="status">
          <span className="buffering-dot" />
          <span>Buffering…</span>
        </div>
      )}

      {/* ------------------------------------------------------ left / now */}
      <div className="player-bar__left">
        <Artwork
          src={track?.thumbnail}
          alt={track ? `${track.title} artwork` : "Nothing playing"}
          className="player-bar__art"
          onClick={track ? openFull : undefined}
        />
        {track ? (
          <div className="player-bar__info" onClick={openFull}>
            <div className="player-bar__title truncate" title={track.title}>
              {track.title}
            </div>
            <button
              type="button"
              className="player-bar__artist truncate"
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/artist/${encodeURIComponent(track.artist)}`);
              }}
            >
              {track.artist}
            </button>
          </div>
        ) : (
          <div className="player-bar__info">
            <div className="player-bar__title truncate">Nothing playing</div>
            <div className="player-bar__artist truncate">Pick a song to start</div>
          </div>
        )}
      </div>

      {/* ---------------------------------------------------- center / transport */}
      <div className="player-bar__center">
        <div className="player-bar__controls">
          <button
            type="button"
            className={cx("icon-btn", s.shuffle && "icon-btn--active")}
            aria-label="Toggle shuffle"
            aria-pressed={s.shuffle}
            disabled={!track}
            onClick={s.toggleShuffle}
          >
            <Icon name="shuffle" size={17} />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Previous track"
            disabled={!track}
            onClick={s.previous}
          >
            <Icon name="skip-prev" size={19} />
          </button>
          <button
            type="button"
            className="player-bar__play"
            aria-label={s.isPlaying ? "Pause" : "Play"}
            disabled={!track && s.queue.length === 0}
            onClick={togglePlay}
          >
            <Icon
              name={s.loading || s.buffering ? "refresh" : s.isPlaying ? "pause" : "play"}
              size={18}
            />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Next track"
            disabled={!track}
            onClick={() => void s.next()}
          >
            <Icon name="skip-next" size={19} />
          </button>
          <button
            type="button"
            className={cx("icon-btn", s.repeatMode !== "off" && "icon-btn--active")}
            aria-label={`Repeat: ${s.repeatMode}`}
            aria-pressed={s.repeatMode !== "off"}
            disabled={!track}
            onClick={s.cycleRepeat}
          >
            <RepeatIcon mode={s.repeatMode} />
          </button>
        </div>

        <div className="player-bar__progress">
          <span className="player-bar__time">{formatTime(s.currentTime)}</span>
          <Slider
            value={progress}
            label="Seek"
            ariaValueText={(v) => `${formatTime(v * duration)} of ${formatTime(duration)}`}
            onChange={(v) => s.seek(v * duration)}
            className="slider--seek"
          />
          <span className="player-bar__time">{formatTime(duration)}</span>
        </div>
      </div>

      {/* ------------------------------------------------------ right / volume */}
      <div className="player-bar__right">
        <button
          type="button"
          className={cx("icon-btn", liked && "icon-btn--active")}
          aria-label={liked ? "Unlike" : "Like this song"}
          aria-pressed={liked}
          disabled={!track}
          onClick={() => track && toggleLike(track)}
        >
          <Icon name={liked ? "heart-filled" : "heart"} size={17} />
        </button>
        <button
          type="button"
          className={cx("icon-btn", queueOpen && "icon-btn--active")}
          aria-label="Show queue"
          aria-pressed={queueOpen}
          onClick={() => setQueueOpen(!queueOpen)}
        >
          <Icon name="queue" size={17} />
        </button>
        <div className="player-bar__volume">
          <button
            type="button"
            className="icon-btn"
            aria-label={s.isMuted ? "Unmute" : "Mute"}
            onClick={s.toggleMute}
          >
            <Icon name={volumeIcon} size={17} />
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
          className="icon-btn"
          aria-label="More options for current track"
          disabled={!track}
          onClick={(e) => {
            if (!track) return;
            const rect = e.currentTarget.getBoundingClientRect();
            openTrackMenu({ clientX: rect.right - 230, clientY: rect.top - 220 }, track);
          }}
        >
          <Icon name="more-horizontal" size={17} />
        </button>
        <button type="button" className="icon-btn" aria-label="Expand player" onClick={openFull}>
          <Icon name="expand" size={16} />
        </button>
      </div>

      {/* -------------------------------------------------------- mobile bits */}
      <div className="player-bar__mobile-controls">
        <button
          type="button"
          className="icon-btn"
          aria-label={s.isPlaying ? "Pause" : "Play"}
          disabled={!track}
          onClick={togglePlay}
        >
          <Icon name={s.isPlaying ? "pause" : "play"} size={20} />
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label="Next track"
          disabled={!track}
          onClick={() => void s.next()}
        >
          <Icon name="skip-next" size={20} />
        </button>
      </div>
      <div className="player-bar__mobile-line" style={{ width: `${progress * 100}%` }} aria-hidden />
    </div>
  );
};

export default PlayerBar;
