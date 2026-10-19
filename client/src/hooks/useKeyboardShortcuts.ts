import { useEffect } from "react";
import { usePlayerStore } from "../stores/playerStore";
import { useUiStore } from "../stores/uiStore";

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

/**
 * Global playback shortcuts. Text fields keep their native key behaviour;
 * Escape is handled by dialogs/menus/the full player themselves.
 */
export function useKeyboardShortcuts() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const player = usePlayerStore.getState();
      const ui = useUiStore.getState();

      if (e.key === "?" || (e.key === "/" && e.shiftKey)) {
        e.preventDefault();
        ui.openDialog({ type: "shortcuts" });
        return;
      }

      if (isTypingTarget(e.target)) return;

      switch (e.key) {
        case " ":
          e.preventDefault();
          void player.togglePlay();
          break;
        case "ArrowLeft":
          e.preventDefault();
          player.seekBy(e.shiftKey ? -10 : -5);
          break;
        case "ArrowRight":
          e.preventDefault();
          player.seekBy(e.shiftKey ? 10 : 5);
          break;
        case "ArrowUp":
          e.preventDefault();
          player.nudgeVolume(0.05);
          break;
        case "ArrowDown":
          e.preventDefault();
          player.nudgeVolume(-0.05);
          break;
        case "m":
        case "M":
          player.toggleMute();
          break;
        case "n":
        case "N":
          void player.next();
          break;
        case "p":
        case "P":
          player.previous();
          break;
        case "s":
        case "S":
          if (player.currentTrack) player.toggleShuffle();
          break;
        case "r":
        case "R":
          if (player.currentTrack) player.cycleRepeat();
          break;
        case "q":
        case "Q":
          ui.toggleQueue();
          break;
        case "f":
        case "F":
          if (player.currentTrack) ui.setFullPlayerOpen(!ui.fullPlayerOpen);
          break;
        case "/":
          e.preventDefault();
          ui.focusSearch();
          break;
        default:
          break;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
