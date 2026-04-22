<script lang="ts">
  type Props = { onCancel: () => void };
  let { onCancel }: Props = $props();
</script>
<div class="overlay">
  <button class="cancel-btn" onclick={onCancel}>
    <span class="icon">⏹</span>
    Cancel <kbd>⌘.</kbd>
  </button>
</div>
<style>
  .overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none; /* let underlying placeholder spinner show */
  }
  .cancel-btn {
    pointer-events: auto;
    background: #b33e1f;
    color: #f6f1e8;
    border: none;
    border-radius: 6px;
    padding: 0.6rem 1rem;
    font-family: "Space Grotesk", sans-serif;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    box-shadow: 0 2px 8px rgba(179, 62, 31, 0.25);
  }
  .cancel-btn:hover { background: #d94a26; }
  .icon { font-size: 11px; }
  kbd {
    font-family: "JetBrains Mono", monospace;
    font-size: 11px;
    opacity: 0.8;
    background: rgba(0,0,0,0.15);
    padding: 0.05rem 0.3rem;
    border-radius: 3px;
  }
</style>
