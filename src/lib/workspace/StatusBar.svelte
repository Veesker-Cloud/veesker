<script lang="ts">
  import { sqlEditor } from "$lib/stores/sql-editor.svelte";

  type Props = {
    connectionName: string;
    userLabel: string;
    schema: string;
    serverVersion: string;
    onDisconnect: () => void;
  };
  let { connectionName, userLabel, schema, serverVersion, onDisconnect }: Props = $props();
</script>

<div class="bar">
  <span class="dot" aria-hidden="true"></span>
  <strong>{connectionName}</strong>
  <span class="sep">·</span>
  <span class="meta">{userLabel}/{schema}</span>
  <span class="sep">·</span>
  <span class="meta">{serverVersion}</span>
  <button
    class="sql-toggle"
    class:active={sqlEditor.drawerOpen}
    aria-label="Toggle SQL drawer"
    title="Toggle SQL drawer (⌘J)"
    onclick={() => sqlEditor.toggleDrawer()}
  >
    SQL
  </button>
  <button class="disconnect" onclick={onDisconnect}>Disconnect</button>
</div>

<style>
  .bar {
    background: #1a1612;
    color: #f6f1e8;
    padding: 0.5rem 1rem;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    font-size: 12px;
    font-family: "Inter", -apple-system, system-ui, sans-serif;
    height: 36px;
    box-sizing: border-box;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #7ec96a;
    display: inline-block;
  }
  strong { font-weight: 600; }
  .sep { opacity: 0.4; }
  .meta {
    opacity: 0.75;
    font-family: "JetBrains Mono", "SF Mono", monospace;
    font-size: 11px;
  }
  .sql-toggle {
    margin-left: auto;
    background: transparent;
    border: 1px solid rgba(246, 241, 232, 0.25);
    color: #f6f1e8;
    font-family: "Space Grotesk", sans-serif;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 0.25rem 0.6rem;
    border-radius: 4px;
    cursor: pointer;
  }
  .sql-toggle:hover { background: rgba(246, 241, 232, 0.08); }
  .sql-toggle.active {
    background: #b33e1f;
    border-color: #b33e1f;
  }
  .disconnect {
    background: transparent;
    border: 1px solid rgba(246, 241, 232, 0.25);
    color: #f6f1e8;
    font-family: "Space Grotesk", sans-serif;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 0.25rem 0.6rem;
    border-radius: 4px;
    cursor: pointer;
  }
  .disconnect:hover {
    background: #b33e1f;
    border-color: #b33e1f;
  }
</style>
