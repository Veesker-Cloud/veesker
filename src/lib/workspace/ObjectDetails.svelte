<script lang="ts">
  import type { TableDetails, ObjectKind, Loadable, DataFlowResult } from "$lib/workspace";
  import { sqlEditor } from "$lib/stores/sql-editor.svelte";
  import DataFlow from "./DataFlow.svelte";

  type Props = {
    selected: { owner: string; name: string; kind: ObjectKind } | null;
    details: Loadable<TableDetails>;
    onRetry: () => void;
    onReconnect?: () => void;
    sessionLost?: boolean;
    detailError?: string | null;
    dataflow?: DataFlowResult | null;
    dataflowLoading?: boolean;
    dataflowError?: string | null;
    onNavigateDataflow?: (owner: string, objectType: string, name: string) => void;
  };
  let {
    selected,
    details,
    onRetry,
    onReconnect,
    sessionLost = false,
    detailError = null,
    dataflow = null,
    dataflowLoading = false,
    dataflowError = null,
    onNavigateDataflow,
  }: Props = $props();

  type Tab = "overview" | "columns" | "indexes" | "dataflow";
  let activeTab = $state<Tab>("columns");

  // Reset tab when object changes
  $effect(() => {
    void selected;
    if (selected?.kind === "TABLE" || selected?.kind === "VIEW") {
      activeTab = "columns";
    } else {
      activeTab = "dataflow";
    }
  });

  const tabs = $derived((): Array<{ id: Tab; label: string }> => {
    if (!selected) return [];
    if (selected.kind === "TABLE" || selected.kind === "VIEW") {
      return [
        { id: "columns", label: "Columns" },
        { id: "indexes", label: "Indexes" },
        { id: "dataflow", label: "Data Flow" },
      ];
    }
    return [{ id: "dataflow", label: "Data Flow" }];
  });

  function previewData() {
    if (selected && selected.kind !== "SEQUENCE") {
      void sqlEditor.openPreview(selected.owner, selected.name);
    }
  }

  const KIND_COLOR: Record<string, string> = {
    TABLE: "#4a9eda", VIEW: "#27ae60", SEQUENCE: "#2ecc71",
    PROCEDURE: "#e67e22", FUNCTION: "#f39c12", PACKAGE: "#9b59b6",
    TRIGGER: "#e74c3c", TYPE: "#3498db",
  };
  const KIND_LABEL: Record<string, string> = {
    TABLE: "TABLE", VIEW: "VIEW", SEQUENCE: "SEQ",
    PROCEDURE: "PROC", FUNCTION: "FN", PACKAGE: "PKG",
    TRIGGER: "TRG", TYPE: "TYPE",
  };

  function kindColor(k: string) { return KIND_COLOR[k?.toUpperCase()] ?? "#888"; }
  function kindLabel(k: string) { return KIND_LABEL[k?.toUpperCase()] ?? k?.slice(0,4).toUpperCase() ?? "?"; }

  // Data type color hints
  function typeColor(dt: string): string {
    const u = dt?.toUpperCase() ?? "";
    if (u.startsWith("NUMBER") || u.startsWith("INTEGER") || u.startsWith("FLOAT")) return "#4a9eda";
    if (u.startsWith("VARCHAR") || u.startsWith("CHAR") || u.startsWith("CLOB") || u.startsWith("NVAR")) return "#27ae60";
    if (u.startsWith("DATE") || u.startsWith("TIMESTAMP")) return "#e67e22";
    if (u.startsWith("BLOB") || u.startsWith("RAW")) return "#9b59b6";
    return "#888";
  }
</script>

<section class="details">
  {#if !selected}
    <div class="empty">
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none" aria-hidden="true">
        <circle cx="24" cy="24" r="22" stroke="currentColor" stroke-width="1.5" opacity="0.15"/>
        <path d="M16 24h16M24 16v16" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity="0.2"/>
      </svg>
      <p>Select an object from the tree</p>
    </div>
  {:else}
    <!-- Object header -->
    <div class="obj-header">
      <div class="obj-title-row">
        <span class="kind-chip" style="--kc:{kindColor(selected.kind)}">{kindLabel(selected.kind)}</span>
        <h2 class="obj-title">
          <span class="obj-owner">{selected.owner}</span>
          <span class="obj-sep">.</span>
          <span class="obj-name">{selected.name}</span>
        </h2>
      </div>
      <div class="obj-meta-row">
        {#if details.kind === "ok" && details.value.rowCount !== null}
          <span class="stat-chip">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
              <rect x="1" y="3" width="8" height="1.2" rx="0.4" fill="currentColor" opacity="0.7"/>
              <rect x="1" y="5.2" width="8" height="1.2" rx="0.4" fill="currentColor" opacity="0.5"/>
              <rect x="1" y="7.4" width="5" height="1.2" rx="0.4" fill="currentColor" opacity="0.3"/>
            </svg>
            {details.value.rowCount.toLocaleString()} rows
          </span>
        {:else if details.kind === "ok" && details.value.rowCount === null}
          <span class="stat-chip muted-chip">~ rows unknown</span>
        {:else if details.kind === "loading"}
          <span class="stat-chip muted-chip">loading…</span>
        {/if}
        {#if (selected.kind === "TABLE" || selected.kind === "VIEW") && details.kind === "ok"}
          <button class="preview-btn" onclick={previewData}>
            Preview data
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
              <path d="M2 9L9 2M9 2H4.5M9 2v4.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        {/if}
      </div>
    </div>

    <!-- Tabs -->
    {#if tabs().length > 1}
      <div class="tabs" role="tablist">
        {#each tabs() as t}
          <button
            class="tab"
            class:active={activeTab === t.id}
            role="tab"
            aria-selected={activeTab === t.id}
            onclick={() => activeTab = t.id}
          >{t.label}</button>
        {/each}
      </div>
    {/if}

    <!-- Error banners -->
    {#if sessionLost && onReconnect}
      <div class="banner banner-warn">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <circle cx="7" cy="7" r="6" stroke="currentColor" stroke-width="1.3"/>
          <line x1="7" y1="4.5" x2="7" y2="7.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
          <circle cx="7" cy="9.5" r="0.6" fill="currentColor"/>
        </svg>
        <span>Connection dropped.</span>
        <button onclick={onReconnect}>Reconnect</button>
      </div>
    {:else if details.kind === "err"}
      <div class="banner banner-err">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <circle cx="7" cy="7" r="6" stroke="currentColor" stroke-width="1.3"/>
          <line x1="4.5" y1="4.5" x2="9.5" y2="9.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
          <line x1="9.5" y1="4.5" x2="4.5" y2="9.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
        </svg>
        <span>{details.message}</span>
        <button onclick={onRetry}>Retry</button>
      </div>
    {:else if detailError}
      <div class="banner banner-warn">
        <span>{detailError}</span>
      </div>
    {/if}

    <!-- Tab content -->
    <div class="tab-content">
      {#if activeTab === "columns" && (selected.kind === "TABLE" || selected.kind === "VIEW")}
        {#if details.kind === "loading"}
          <div class="loading-row">
            <span class="spinner"></span> Loading columns…
          </div>
        {:else if details.kind === "ok"}
          {@const d = details.value}
          <div class="col-table-wrap">
            <table class="col-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Null</th>
                  <th>Default</th>
                  <th>Comments</th>
                </tr>
              </thead>
              <tbody>
                {#each d.columns as c, i (c.name)}
                  <tr class:pk-row={c.isPk}>
                    <td class="col-num">{i + 1}</td>
                    <td class="col-name">
                      {c.name}
                      {#if c.isPk}
                        <svg class="pk-icon" width="10" height="10" viewBox="0 0 10 10" fill="none" title="Primary Key" aria-label="Primary Key">
                          <circle cx="4" cy="4" r="3" stroke="#e8c547" stroke-width="1.2"/>
                          <path d="M6.5 6.5l2 2" stroke="#e8c547" stroke-width="1.2" stroke-linecap="round"/>
                        </svg>
                      {/if}
                    </td>
                    <td class="col-type">
                      <span class="type-badge" style="color:{typeColor(c.dataType)};border-color:{typeColor(c.dataType)}20;background:{typeColor(c.dataType)}10">{c.dataType}</span>
                    </td>
                    <td class="col-null">
                      {#if c.nullable}
                        <span class="null-yes">YES</span>
                      {:else}
                        <span class="null-no">NOT NULL</span>
                      {/if}
                    </td>
                    <td class="col-default mono">{c.dataDefault ?? ""}</td>
                    <td class="col-comment">{c.comments ?? ""}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}

      {:else if activeTab === "indexes" && (selected.kind === "TABLE" || selected.kind === "VIEW")}
        {#if details.kind === "loading"}
          <div class="loading-row"><span class="spinner"></span> Loading…</div>
        {:else if details.kind === "ok"}
          {@const d = details.value}
          {#if d.indexes.length === 0}
            <div class="empty-section">No indexes defined.</div>
          {:else}
            <div class="col-table-wrap">
              <table class="col-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Columns</th>
                  </tr>
                </thead>
                <tbody>
                  {#each d.indexes as idx (idx.name)}
                    <tr>
                      <td class="mono">{idx.name}</td>
                      <td>
                        {#if idx.isUnique}
                          <span class="unique-badge">UNIQUE</span>
                        {:else}
                          <span class="idx-type">INDEX</span>
                        {/if}
                      </td>
                      <td class="mono col-idx-cols">{idx.columns.join(", ")}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
        {/if}

      {:else if activeTab === "dataflow"}
        {#if dataflowLoading}
          <div class="loading-row"><span class="spinner"></span> Analyzing dependencies…</div>
        {:else if dataflowError}
          <div class="banner banner-err"><span>{dataflowError}</span></div>
        {:else if dataflow}
          <DataFlow result={dataflow} objectName={selected.name} objectType={selected.kind} onNavigate={onNavigateDataflow} />
        {:else}
          <div class="empty-section">No data flow information available.</div>
        {/if}
      {/if}
    </div>
  {/if}
</section>

<style>
  .details {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    background: #faf7f2;
    font-family: "Inter", -apple-system, system-ui, sans-serif;
    font-size: 13px;
  }

  /* ── Empty ────────────────────────────────────────────────── */
  .empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    color: rgba(26, 22, 18, 0.3);
    font-size: 13px;
  }
  .empty p { margin: 0; }

  /* ── Object header ────────────────────────────────────────── */
  .obj-header {
    padding: 1rem 1.5rem 0.75rem;
    border-bottom: 1px solid rgba(26,22,18,0.08);
    background: #fff;
    flex-shrink: 0;
  }
  .obj-title-row {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    margin-bottom: 0.4rem;
  }
  .kind-chip {
    font-family: "JetBrains Mono", monospace;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.08em;
    color: var(--kc);
    background: color-mix(in srgb, var(--kc) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--kc) 30%, transparent);
    padding: 2px 7px;
    border-radius: 4px;
    flex-shrink: 0;
  }
  .obj-title {
    font-family: "Space Grotesk", sans-serif;
    font-weight: 600;
    font-size: 17px;
    margin: 0;
    line-height: 1.2;
    display: flex;
    align-items: baseline;
    gap: 0;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .obj-owner { color: rgba(26,22,18,0.45); font-weight: 400; }
  .obj-sep { color: rgba(26,22,18,0.25); margin: 0 0.05rem; }
  .obj-name { color: #1a1612; }

  .obj-meta-row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }
  .stat-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 11px;
    color: rgba(26,22,18,0.55);
    background: rgba(26,22,18,0.05);
    border: 1px solid rgba(26,22,18,0.08);
    border-radius: 4px;
    padding: 2px 7px;
  }
  .muted-chip { color: rgba(26,22,18,0.35); }
  .preview-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    background: transparent;
    border: 1px solid rgba(26,22,18,0.15);
    color: rgba(26,22,18,0.6);
    font-family: "Space Grotesk", sans-serif;
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.12s;
  }
  .preview-btn:hover {
    background: #1a1612;
    color: #f6f1e8;
    border-color: #1a1612;
  }

  /* ── Tabs ─────────────────────────────────────────────────── */
  .tabs {
    display: flex;
    border-bottom: 1px solid rgba(26,22,18,0.08);
    background: #fff;
    padding: 0 1.5rem;
    flex-shrink: 0;
    gap: 0;
  }
  .tab {
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    padding: 0.55rem 1rem;
    font-family: "Space Grotesk", sans-serif;
    font-size: 12px;
    font-weight: 500;
    color: rgba(26,22,18,0.5);
    cursor: pointer;
    margin-bottom: -1px;
    transition: color 0.12s, border-color 0.12s;
    letter-spacing: 0.02em;
  }
  .tab:hover { color: rgba(26,22,18,0.8); }
  .tab.active {
    color: #1a1612;
    border-bottom-color: #b33e1f;
  }

  /* ── Banners ──────────────────────────────────────────────── */
  .banner {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    font-size: 12px;
    padding: 0.6rem 1.5rem;
    flex-shrink: 0;
  }
  .banner button {
    margin-left: auto;
    background: #1a1612;
    color: #f6f1e8;
    border: none;
    padding: 0.3rem 0.75rem;
    border-radius: 4px;
    font-family: "Space Grotesk", sans-serif;
    font-size: 11px;
    cursor: pointer;
  }
  .banner-warn { background: rgba(230,126,34,0.08); color: #7a4f14; border-bottom: 1px solid rgba(230,126,34,0.15); }
  .banner-err  { background: rgba(179,62,31,0.07);  color: #7a2a14; border-bottom: 1px solid rgba(179,62,31,0.12); }

  /* ── Tab content area ─────────────────────────────────────── */
  .tab-content {
    flex: 1 1 auto;
    overflow-y: auto;
    padding: 0;
  }

  /* ── Loading ─────────────────────────────────────────────── */
  .loading-row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 1.5rem;
    color: rgba(26,22,18,0.5);
    font-size: 12px;
  }
  .spinner {
    width: 13px; height: 13px;
    border: 2px solid rgba(26,22,18,0.1);
    border-top-color: #b33e1f;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    flex-shrink: 0;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* ── Empty section ────────────────────────────────────────── */
  .empty-section {
    padding: 1.5rem;
    color: rgba(26,22,18,0.4);
    font-size: 12px;
    font-style: italic;
  }

  /* ── Column table ─────────────────────────────────────────── */
  .col-table-wrap {
    overflow-x: auto;
  }
  .col-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }
  .col-table thead tr {
    border-bottom: 1px solid rgba(26,22,18,0.08);
    background: rgba(26,22,18,0.02);
  }
  .col-table th {
    text-align: left;
    font-family: "Space Grotesk", sans-serif;
    font-weight: 600;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: rgba(26,22,18,0.45);
    padding: 0.5rem 0.75rem;
    white-space: nowrap;
  }
  .col-table td {
    padding: 0.35rem 0.75rem;
    border-bottom: 1px solid rgba(26,22,18,0.04);
    vertical-align: middle;
  }
  .col-table tr:hover td { background: rgba(26,22,18,0.02); }
  .pk-row td { background: rgba(232,197,71,0.04); }
  .pk-row:hover td { background: rgba(232,197,71,0.08); }

  .col-num {
    color: rgba(26,22,18,0.25);
    font-size: 10px;
    text-align: right;
    width: 28px;
    font-family: "JetBrains Mono", monospace;
  }
  .col-name {
    font-family: "JetBrains Mono", "SF Mono", monospace;
    font-size: 11.5px;
    font-weight: 500;
    color: #1a1612;
    display: flex;
    align-items: center;
    gap: 0.3rem;
    white-space: nowrap;
  }
  .pk-icon { flex-shrink: 0; }
  .col-type { white-space: nowrap; }
  .type-badge {
    font-family: "JetBrains Mono", monospace;
    font-size: 10.5px;
    font-weight: 500;
    border: 1px solid;
    border-radius: 3px;
    padding: 1px 5px;
    white-space: nowrap;
  }
  .col-null { white-space: nowrap; }
  .null-yes { color: rgba(26,22,18,0.35); font-size: 11px; }
  .null-no {
    font-size: 10px;
    font-weight: 600;
    color: #4a9eda;
    background: rgba(74,158,218,0.08);
    border-radius: 3px;
    padding: 1px 5px;
  }
  .col-default, .mono {
    font-family: "JetBrains Mono", "SF Mono", monospace;
    font-size: 11px;
    color: rgba(26,22,18,0.6);
  }
  .col-comment { color: rgba(26,22,18,0.5); font-size: 11.5px; max-width: 240px; }
  .col-idx-cols { max-width: 280px; }

  /* ── Index table ──────────────────────────────────────────── */
  .unique-badge {
    font-family: "Space Grotesk", sans-serif;
    font-size: 9.5px;
    font-weight: 700;
    letter-spacing: 0.06em;
    color: #e67e22;
    background: rgba(230,126,34,0.1);
    border: 1px solid rgba(230,126,34,0.25);
    border-radius: 3px;
    padding: 1px 6px;
  }
  .idx-type {
    font-family: "Space Grotesk", sans-serif;
    font-size: 9.5px;
    color: rgba(26,22,18,0.4);
    letter-spacing: 0.04em;
  }
</style>
