<script lang="ts">
  import { sqlEditor } from "$lib/stores/sql-editor.svelte";
  import VeeskerMark from "$lib/VeeskerMark.svelte";

  type Props = {
    connectionName: string;
    userLabel: string;
    schema: string;
    serverVersion: string;
    hasPendingTx?: boolean;
    chatOpen?: boolean;
    onToggleChat?: () => void;
    onDisconnect: () => void;
    onSwitchConnection: () => void;
  };
  let { connectionName, userLabel, schema, serverVersion, hasPendingTx = false, chatOpen = false, onToggleChat, onDisconnect, onSwitchConnection }: Props = $props();

  // Shorten version: "Oracle AI Database 26ai Free Release 23.26.1.0.0 – ..." → "23.26.1.0.0"
  const shortVersion = $derived(() => {
    const m = serverVersion.match(/(\d+\.\d+[\d.]*)/);
    return m ? m[1] : serverVersion.split(" ").slice(0, 3).join(" ");
  });
</script>

<div class="bar">
  <!-- Left: connection identity -->
  <div class="bar-left">
    <VeeskerMark size={22} bg={false} class="bar-mark" />
    <span class="bar-divider" aria-hidden="true"></span>
    <span class="conn-dot" aria-label="Connected"></span>
    <span class="conn-name">{connectionName}</span>
    {#if hasPendingTx}
      <span class="tx-badge" title="Uncommitted transaction pending — remember to COMMIT or ROLLBACK">
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
          <circle cx="4" cy="4" r="3.5" fill="#e8c547"/>
        </svg>
        TX
      </span>
    {/if}
    <span class="divider" aria-hidden="true"></span>
    <svg class="icon" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <ellipse cx="6" cy="4" rx="4.5" ry="1.8" stroke="currentColor" stroke-width="1.1"/>
      <path d="M1.5 4v4c0 1 2 1.8 4.5 1.8S10.5 9 10.5 8V4" stroke="currentColor" stroke-width="1.1"/>
    </svg>
    <span class="meta">{schema}</span>
    <span class="divider" aria-hidden="true"></span>
    <svg class="icon" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <circle cx="6" cy="6" r="4.5" stroke="currentColor" stroke-width="1.1"/>
      <line x1="6" y1="3" x2="6" y2="6.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
      <circle cx="6" cy="8" r="0.6" fill="currentColor"/>
    </svg>
    <span class="meta version" title={serverVersion}>{shortVersion()}</span>
  </div>

  <!-- Right: actions -->
  <div class="bar-right">
    <button
      class="action-btn ai-btn"
      class:active={chatOpen}
      aria-label="Toggle AI assistant (⌘I)"
      title="Toggle AI assistant (⌘I)"
      onclick={onToggleChat}
    >
      <img src="/veesker-sheep.png" class="ai-btn-sheep" alt="" aria-hidden="true" />
      AI
    </button>
    <button
      class="action-btn sql-btn"
      class:active={sqlEditor.drawerOpen}
      aria-label="Toggle SQL drawer (⌘J)"
      title="Toggle SQL drawer (⌘J)"
      onclick={() => sqlEditor.toggleDrawer()}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <path d="M1.5 3.5l3 2.5-3 2.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
        <line x1="6" y1="8.5" x2="10.5" y2="8.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
      </svg>
      SQL
    </button>
    <button
      class="action-btn switch-btn"
      aria-label="Switch connection"
      title="Switch connection"
      onclick={onSwitchConnection}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <path d="M2 4h8M8 2l2 2-2 2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M10 8H2M4 6l-2 2 2 2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      Switch
    </button>
    <button
      class="action-btn disconnect-btn"
      aria-label="Disconnect"
      title="Disconnect"
      onclick={onDisconnect}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <path d="M5 2H2a.5.5 0 00-.5.5v7A.5.5 0 002 10h3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
        <path d="M8 4l2.5 2L8 8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
        <line x1="4.5" y1="6" x2="10.5" y2="6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
      </svg>
      Disconnect
    </button>
  </div>
</div>

<style>
  .bar {
    background: #100e0b;
    border-bottom: 1px solid rgba(255,255,255,0.07);
    color: rgba(255,255,255,0.75);
    padding: 0 0.85rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 38px;
    box-sizing: border-box;
    font-family: "Inter", -apple-system, system-ui, sans-serif;
    font-size: 12px;
    flex-shrink: 0;
  }

  /* ── Left cluster ─────────────────────────────────────────── */
  .bar-left {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    overflow: hidden;
    min-width: 0;
  }
  :global(.bar-mark) {
    flex-shrink: 0;
    opacity: 0.9;
  }
  .bar-divider {
    width: 1px;
    height: 14px;
    background: rgba(255,255,255,0.1);
    flex-shrink: 0;
  }
  .conn-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #7ec96a;
    box-shadow: 0 0 5px rgba(126,201,106,0.5);
    flex-shrink: 0;
  }
  .conn-name {
    font-family: "Space Grotesk", sans-serif;
    font-weight: 600;
    font-size: 12.5px;
    color: #f6f1e8;
    white-space: nowrap;
  }
  .tx-badge {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-family: "Space Grotesk", sans-serif;
    font-size: 9.5px;
    font-weight: 700;
    letter-spacing: 0.06em;
    color: #e8c547;
    background: rgba(232,197,71,0.12);
    border: 1px solid rgba(232,197,71,0.3);
    border-radius: 4px;
    padding: 1px 6px;
    flex-shrink: 0;
    animation: tx-pulse 2s ease-in-out infinite;
  }
  @keyframes tx-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.65; }
  }
  .divider {
    width: 1px;
    height: 14px;
    background: rgba(255,255,255,0.12);
    flex-shrink: 0;
    margin: 0 0.1rem;
  }
  .icon {
    color: rgba(255,255,255,0.35);
    flex-shrink: 0;
  }
  .meta {
    font-family: "JetBrains Mono", "SF Mono", monospace;
    font-size: 11px;
    color: rgba(255,255,255,0.55);
    white-space: nowrap;
  }
  .version {
    font-size: 10.5px;
    color: rgba(255,255,255,0.35);
    max-width: 100px;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: default;
  }

  /* ── Right cluster ────────────────────────────────────────── */
  .bar-right {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-shrink: 0;
  }
  .action-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    background: rgba(255,255,255,0.07);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 5px;
    color: rgba(255,255,255,0.65);
    font-family: "Space Grotesk", sans-serif;
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.03em;
    padding: 0.25rem 0.6rem;
    cursor: pointer;
    transition: background 0.12s, color 0.12s, border-color 0.12s;
  }
  .action-btn:hover {
    background: rgba(255,255,255,0.12);
    color: rgba(255,255,255,0.9);
    border-color: rgba(255,255,255,0.18);
  }
  .ai-btn-sheep {
    width: 14px;
    height: 14px;
    object-fit: contain;
    flex-shrink: 0;
  }
  .ai-btn.active {
    background: rgba(179,62,31,0.25);
    border-color: rgba(179,62,31,0.5);
    color: #f5a08a;
  }
  .ai-btn.active:hover { background: rgba(179,62,31,0.35); }
  .sql-btn.active {
    background: #b33e1f;
    border-color: #b33e1f;
    color: #fff;
  }
  .sql-btn.active:hover { background: #c94b28; }
  .switch-btn:hover {
    background: rgba(255,255,255,0.12);
    color: rgba(255,255,255,0.9);
  }
  .disconnect-btn:hover {
    background: rgba(179, 62, 31, 0.25);
    border-color: rgba(179, 62, 31, 0.5);
    color: #f5a08a;
  }
</style>
