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

  function previewData() {
    if (selected && selected.kind !== "SEQUENCE") {
      void sqlEditor.openPreview(selected.owner, selected.name);
    }
  }
</script>

<section class="details">
  {#if !selected}
    <div class="empty">Select a table or view from the tree on the left.</div>
  {:else if selected.kind === "SEQUENCE"}
    <header>
      <h2>{selected.owner}.{selected.name}</h2>
      <p class="muted">SEQUENCE</p>
    </header>
    {#if detailError}
      <p class="detail-error">{detailError}</p>
    {/if}
    <p class="muted">Sequences expose only metadata in this view.</p>
    <!-- DATA FLOW section -->
    <h3>Data Flow</h3>
    {#if dataflowLoading}
      <p class="muted">Loading…</p>
    {:else if dataflowError}
      <p class="detail-error">{dataflowError}</p>
    {:else if dataflow}
      <DataFlow result={dataflow} onNavigate={onNavigateDataflow} />
    {/if}
  {:else if details.kind === "loading"}
    <header>
      <h2>{selected.owner}.{selected.name}</h2>
    </header>
    <p class="muted">Loading…</p>
  {:else if details.kind === "err"}
    <header>
      <h2>{selected.owner}.{selected.name}</h2>
    </header>
    {#if sessionLost && onReconnect}
      <div class="banner">
        <strong>Connection dropped.</strong>
        <span>{details.message}</span>
        <button onclick={onReconnect}>Reconnect</button>
      </div>
    {:else}
      <div class="err-card">
        <strong>Failed to load details.</strong>
        <span>{details.message}</span>
        <button onclick={onRetry}>Retry</button>
      </div>
    {/if}
  {:else if details.kind === "ok"}
    {@const d = details.value}
    <header>
      <div class="title-row">
        <h2>{selected.owner}.{selected.name}</h2>
        {#if selected.kind === "TABLE" || selected.kind === "VIEW"}
          <button class="preview-btn" onclick={previewData}>Preview data →</button>
        {/if}
      </div>
      <p class="muted">
        {#if d.rowCount === null}
          ~ unknown rows
        {:else}
          ~ {d.rowCount.toLocaleString()} rows
        {/if}
      </p>
    </header>

    <h3>Columns</h3>
    <table class="cols">
      <thead>
        <tr><th>Name</th><th>Type</th><th>Nullable</th><th>Default</th><th>Comments</th></tr>
      </thead>
      <tbody>
        {#each d.columns as c (c.name)}
          <tr>
            <td class="mono">
              {c.name}
              {#if c.isPk}<span class="pk">PK</span>{/if}
            </td>
            <td class="mono">{c.dataType}</td>
            <td>{c.nullable ? "YES" : "NO"}</td>
            <td class="mono">{c.dataDefault ?? ""}</td>
            <td>{c.comments ?? ""}</td>
          </tr>
        {/each}
      </tbody>
    </table>

    <h3>Indexes</h3>
    {#if d.indexes.length === 0}
      <p class="muted">No indexes.</p>
    {:else}
      <table class="cols">
        <thead>
          <tr><th>Name</th><th>Unique</th><th>Columns</th></tr>
        </thead>
        <tbody>
          {#each d.indexes as i (i.name)}
            <tr>
              <td class="mono">{i.name}</td>
              <td>{i.isUnique ? "UNIQUE" : ""}</td>
              <td class="mono">{i.columns.join(", ")}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}

    <!-- DATA FLOW section -->
    {#if detailError}
      <p class="detail-error">{detailError}</p>
    {/if}
    <h3>Data Flow</h3>
    {#if dataflowLoading}
      <p class="muted">Loading…</p>
    {:else if dataflowError}
      <p class="detail-error">{dataflowError}</p>
    {:else if dataflow}
      <DataFlow result={dataflow} onNavigate={onNavigateDataflow} />
    {/if}
  {:else if details.kind === "idle"}
    <!-- PL/SQL objects: details not loaded, show header + DATA FLOW -->
    {#if selected}
      <header>
        <h2>{selected.owner}.{selected.name}</h2>
        <p class="muted">{selected.kind}</p>
      </header>
      {#if detailError}
        <p class="detail-error">{detailError}</p>
      {/if}
      <!-- DATA FLOW section -->
      <h3>Data Flow</h3>
      {#if dataflowLoading}
        <p class="muted">Loading…</p>
      {:else if dataflowError}
        <p class="detail-error">{dataflowError}</p>
      {:else if dataflow}
        <DataFlow result={dataflow} onNavigate={onNavigateDataflow} />
      {/if}
    {/if}
  {/if}
</section>

<style>
  .details {
    flex: 1;
    overflow-y: auto;
    padding: 1rem 1.5rem;
    background: #fff;
    box-sizing: border-box;
    font-size: 13px;
    font-family: "Inter", -apple-system, system-ui, sans-serif;
  }
  .empty, .muted {
    color: rgba(26, 22, 18, 0.5);
    font-size: 12px;
  }
  .detail-error {
    color: #7a2a14;
    font-size: 12px;
    margin: 0.5rem 0;
  }
  header { margin-bottom: 1rem; }
  h2 {
    font-family: "Space Grotesk", sans-serif;
    font-weight: 500;
    font-size: 18px;
    margin: 0;
  }
  h3 {
    font-family: "Space Grotesk", sans-serif;
    font-weight: 500;
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: rgba(26, 22, 18, 0.6);
    margin: 1.25rem 0 0.5rem;
  }
  table.cols {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }
  table.cols th {
    text-align: left;
    font-weight: 600;
    color: rgba(26, 22, 18, 0.6);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    border-bottom: 1px solid rgba(26, 22, 18, 0.1);
    padding: 0.4rem 0.5rem;
  }
  table.cols td {
    padding: 0.35rem 0.5rem;
    border-bottom: 1px solid rgba(26, 22, 18, 0.05);
    vertical-align: top;
  }
  .mono {
    font-family: "JetBrains Mono", "SF Mono", monospace;
    font-size: 11.5px;
  }
  .pk {
    display: inline-block;
    margin-left: 0.4rem;
    background: rgba(179, 62, 31, 0.12);
    color: #7a2a14;
    font-family: "Space Grotesk", sans-serif;
    font-size: 9px;
    padding: 0.05rem 0.35rem;
    border-radius: 3px;
    letter-spacing: 0.06em;
  }
  .banner, .err-card {
    background: rgba(179, 62, 31, 0.08);
    color: #7a2a14;
    border: 1px solid rgba(179, 62, 31, 0.3);
    padding: 0.85rem 1rem;
    border-radius: 6px;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    font-size: 12px;
  }
  .banner button, .err-card button {
    margin-left: auto;
    background: #1a1612;
    color: #f6f1e8;
    border: none;
    padding: 0.4rem 0.85rem;
    border-radius: 4px;
    font-family: "Space Grotesk", sans-serif;
    font-size: 11px;
    cursor: pointer;
  }
  .title-row {
    display: flex;
    align-items: baseline;
    gap: 1rem;
  }
  .preview-btn {
    background: #b33e1f;
    color: #f6f1e8;
    border: none;
    padding: 0.3rem 0.7rem;
    border-radius: 4px;
    font-family: "Space Grotesk", sans-serif;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    cursor: pointer;
  }
  .preview-btn:hover { background: #7a2a14; }
</style>
