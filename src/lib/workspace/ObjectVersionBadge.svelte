<script lang="ts">
  import { onMount } from "svelte";
  import { objectVersionList } from "$lib/object-versions";

  type Props = {
    connectionId: string;
    owner: string;
    objectType: string;
    objectName: string;
    onOpen: () => void;
  };

  let { connectionId, owner, objectType, objectName, onOpen }: Props = $props();

  let count = $state(0);
  let latestAt = $state<string | null>(null);

  async function refresh() {
    const res = await objectVersionList(connectionId, owner, objectType, objectName);
    if (res.ok && res.data.length > 0) {
      count = res.data.length;
      latestAt = res.data[0].capturedAt;
    } else {
      count = 0;
      latestAt = null;
    }
  }

  function timeAgo(iso: string): string {
    const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (diff < 60) return `${diff}s`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
    return `${Math.floor(diff / 86400)}d`;
  }

  onMount(refresh);

  export function reloadVersions() {
    void refresh();
  }
</script>

{#if count > 0}
  <button class="ver-btn" title="Version history" onclick={onOpen}>
    <span class="ver-dot"></span>
    v{count}{latestAt ? ` · ${timeAgo(latestAt)}` : ""}
  </button>
{/if}

<style>
  .ver-btn {
    background: transparent;
    border: none;
    border-right: 1px solid rgba(255,255,255,0.04);
    padding: 0 0.65rem;
    color: #7ec96a;
    cursor: pointer;
    font-size: 10.5px;
    font-family: "Space Grotesk", sans-serif;
    white-space: nowrap;
    display: flex;
    align-items: center;
    gap: 0.35rem;
    opacity: 0.7;
    transition: background 0.1s, opacity 0.1s;
  }
  .ver-btn:hover {
    background: rgba(126,201,106,0.08);
    opacity: 1;
  }
  .ver-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: #7ec96a;
    flex-shrink: 0;
  }
</style>
