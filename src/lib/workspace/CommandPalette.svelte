<script lang="ts">
  import { objectsSearch, type SearchResult, type ObjectKind } from "$lib/workspace";

  type Props = {
    onSelect: (owner: string, name: string, kind: ObjectKind) => void;
    onClose: () => void;
  };
  let { onSelect, onClose }: Props = $props();

  let query = $state("");
  let results = $state<SearchResult[]>([]);
  let highlighted = $state(0);
  let loading = $state(false);
  let inputEl = $state<HTMLInputElement | null>(null);
  let debounce: ReturnType<typeof setTimeout> | null = null;

  $effect(() => { inputEl?.focus(); });

  $effect(() => {
    if (debounce) clearTimeout(debounce);
    const q = query.trim();
    if (!q) { results = []; highlighted = 0; return; }
    debounce = setTimeout(async () => {
      loading = true;
      const res = await objectsSearch(q);
      loading = false;
      if (res.ok) { results = res.data; highlighted = 0; }
    }, 180);
  });

  function select(r: SearchResult) {
    onSelect(r.owner, r.name, r.objectType as ObjectKind);
    onClose();
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") { onClose(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); highlighted = Math.min(highlighted + 1, results.length - 1); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); highlighted = Math.max(highlighted - 1, 0); return; }
    if (e.key === "Enter" && results[highlighted]) { select(results[highlighted]); return; }
  }

  const KIND_COLOR: Record<string, string> = {
    TABLE: "#4a9eda", VIEW: "#27ae60", SEQUENCE: "#2ecc71",
    PROCEDURE: "#e67e22", FUNCTION: "#f39c12", PACKAGE: "#9b59b6",
    TRIGGER: "#e74c3c", TYPE: "#3498db",
  };
  const KIND_SHORT: Record<string, string> = {
    TABLE: "TBL", VIEW: "VW", SEQUENCE: "SEQ",
    PROCEDURE: "PROC", FUNCTION: "FN", PACKAGE: "PKG",
    TRIGGER: "TRG", TYPE: "TYPE",
  };
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="backdrop" role="dialog" aria-modal="true" aria-label="Quick search" onclick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
  <div class="palette">
    <div class="search-row">
      <svg class="search-icon" width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
        <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" stroke-width="1.4"/>
        <path d="M10 10l3.5 3.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
      </svg>
      <input
        bind:this={inputEl}
        type="search"
        placeholder="Search objects… (TABLE, VIEW, PROC…)"
        bind:value={query}
        class="search-input"
        onkeydown={onKeydown}
        autocomplete="off"
        spellcheck={false}
      />
      {#if loading}
        <span class="spinner" aria-label="Searching"></span>
      {:else}
        <kbd class="esc-hint">esc</kbd>
      {/if}
    </div>

    {#if results.length > 0}
      <ul class="results" role="listbox">
        {#each results as r, i (r.owner + "." + r.name + r.objectType)}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <li
            class="result"
            class:highlighted={i === highlighted}
            role="option"
            aria-selected={i === highlighted}
            onclick={() => select(r)}
            onmouseenter={() => highlighted = i}
          >
            <span
              class="kind-chip"
              style="color:{KIND_COLOR[r.objectType] ?? '#888'};background:{KIND_COLOR[r.objectType] ?? '#888'}18;border-color:{KIND_COLOR[r.objectType] ?? '#888'}30"
            >{KIND_SHORT[r.objectType] ?? r.objectType}</span>
            <span class="result-name">{r.name}</span>
            <span class="result-owner">{r.owner}</span>
          </li>
        {/each}
      </ul>
    {:else if query.trim() && !loading}
      <div class="empty">No objects found for <strong>{query}</strong></div>
    {:else if !query.trim()}
      <div class="hint">Type to search across all accessible objects</div>
    {/if}

    <div class="footer">
      <span><kbd>↑↓</kbd> navigate</span>
      <span><kbd>↵</kbd> select</span>
      <span><kbd>esc</kbd> close</span>
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 14vh;
    z-index: 1000;
    backdrop-filter: blur(2px);
  }

  .palette {
    width: 560px;
    max-width: calc(100vw - 2rem);
    background: #1c1710;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 10px;
    box-shadow: 0 24px 64px rgba(0,0,0,0.6);
    overflow: hidden;
    font-family: "Inter", -apple-system, system-ui, sans-serif;
  }

  .search-row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.8rem 1rem;
    border-bottom: 1px solid rgba(255,255,255,0.07);
  }
  .search-icon { color: rgba(255,255,255,0.35); flex-shrink: 0; }
  .search-input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    font-size: 15px;
    font-family: "Space Grotesk", sans-serif;
    color: #f6f1e8;
    min-width: 0;
  }
  .search-input::placeholder { color: rgba(255,255,255,0.25); }
  .esc-hint {
    font-family: "JetBrains Mono", monospace;
    font-size: 10px;
    color: rgba(255,255,255,0.3);
    background: rgba(255,255,255,0.07);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 3px;
    padding: 2px 5px;
    flex-shrink: 0;
  }
  .spinner {
    width: 14px; height: 14px;
    border: 2px solid rgba(255,255,255,0.1);
    border-top-color: #b33e1f;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
    flex-shrink: 0;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .results {
    list-style: none;
    margin: 0;
    padding: 0.3rem 0;
    max-height: 320px;
    overflow-y: auto;
  }
  .result {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    padding: 0.45rem 1rem;
    cursor: pointer;
    transition: background 0.08s;
  }
  .result.highlighted { background: rgba(255,255,255,0.07); }

  .kind-chip {
    font-family: "JetBrains Mono", monospace;
    font-size: 9.5px;
    font-weight: 700;
    letter-spacing: 0.06em;
    border: 1px solid;
    border-radius: 3px;
    padding: 1px 5px;
    flex-shrink: 0;
    min-width: 34px;
    text-align: center;
  }
  .result-name {
    font-family: "JetBrains Mono", "SF Mono", monospace;
    font-size: 13px;
    font-weight: 500;
    color: #f6f1e8;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .result-owner {
    font-family: "JetBrains Mono", monospace;
    font-size: 10.5px;
    color: rgba(255,255,255,0.3);
    flex-shrink: 0;
  }

  .empty, .hint {
    padding: 1.25rem 1rem;
    font-size: 12.5px;
    color: rgba(255,255,255,0.35);
    text-align: center;
  }
  .empty strong { color: rgba(255,255,255,0.55); }

  .footer {
    display: flex;
    gap: 1.25rem;
    padding: 0.5rem 1rem;
    border-top: 1px solid rgba(255,255,255,0.06);
    font-size: 11px;
    color: rgba(255,255,255,0.25);
  }
  kbd {
    font-family: "JetBrains Mono", monospace;
    font-size: 10px;
    background: rgba(255,255,255,0.08);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 3px;
    padding: 1px 4px;
    margin-right: 2px;
  }
</style>
