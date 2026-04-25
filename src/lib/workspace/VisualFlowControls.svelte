<script lang="ts">
  import { onMount } from "svelte";

  type Props = {
    currentStepIndex: number;
    totalSteps: number;
    isPlaying: boolean;
    onPrev: () => void;
    onNext: () => void;
    onFirst: () => void;
    onLast: () => void;
    onSetStep: (i: number) => void;
    onTogglePlay: () => void;
    onClose: () => void;
  };
  let {
    currentStepIndex,
    totalSteps,
    isPlaying,
    onPrev,
    onNext,
    onFirst,
    onLast,
    onSetStep,
    onTogglePlay,
    onClose,
  }: Props = $props();

  function handleKey(e: KeyboardEvent): void {
    const t = e.target as HTMLElement | null;
    if (t && (
      t.tagName === "INPUT" ||
      t.tagName === "TEXTAREA" ||
      t.tagName === "SELECT" ||
      t.tagName === "BUTTON" ||
      t.isContentEditable
    )) return;
    if (e.key === "ArrowRight" || e.key === " ") { e.preventDefault(); onNext(); }
    else if (e.key === "ArrowLeft" || e.key === "Backspace") { e.preventDefault(); onPrev(); }
    else if (e.key === "Home") { e.preventDefault(); onFirst(); }
    else if (e.key === "End") { e.preventDefault(); onLast(); }
    else if (e.key === "Escape") { e.preventDefault(); onClose(); }
    else if ((e.ctrlKey || e.metaKey) && e.key === ".") {
      e.preventDefault();
      if (isPlaying) onTogglePlay();
    }
    else if (e.key === "p" || e.key === "P") { e.preventDefault(); onTogglePlay(); }
  }

  onMount(() => {
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  });

  function handleScrub(e: Event): void {
    const target = e.target as HTMLInputElement;
    onSetStep(Number(target.value));
  }
</script>

<footer class="controls">
  <div class="row">
    <button type="button" onclick={onFirst} aria-label="First step" disabled={currentStepIndex === 0}>⏮</button>
    <button type="button" onclick={onPrev} aria-label="Previous step" disabled={currentStepIndex === 0}>◀</button>
    <button type="button" class="play" onclick={onTogglePlay} aria-label={isPlaying ? "Pause" : "Play"}>
      {isPlaying ? "⏸" : "▶"}
    </button>
    <button type="button" onclick={onNext} aria-label="Next step" disabled={currentStepIndex >= totalSteps - 1}>▶</button>
    <button type="button" onclick={onLast} aria-label="Last step" disabled={currentStepIndex >= totalSteps - 1}>⏭</button>
  </div>
  <input
    type="range"
    min="0"
    max={Math.max(0, totalSteps - 1)}
    value={currentStepIndex}
    oninput={handleScrub}
    aria-label="Step scrubber"
    class="scrub"
  />
</footer>

<style>
  .controls {
    border-top: 1px solid var(--border);
    background: var(--bg-surface);
    padding: 8px 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .row {
    display: flex;
    gap: 4px;
    justify-content: center;
  }
  button {
    background: var(--bg-surface-alt);
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 4px 10px;
    cursor: pointer;
    font-size: 14px;
  }
  button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  button.play {
    background: var(--accent);
    color: #fff;
    border-color: var(--accent);
  }
  .scrub {
    width: 100%;
    accent-color: var(--accent);
  }
</style>
