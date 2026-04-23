<script lang="ts">
  import type { TableDetails, TableRelated, ObjectKind, Loadable, DataFlowResult, VectorIndex, VectorSearchResult, EmbedConfig, EmbedProvider } from "$lib/workspace";
  import { tableCountRows, vectorIndexList, vectorSearch } from "$lib/workspace";
  import { sqlEditor } from "$lib/stores/sql-editor.svelte";
  import DataFlow from "./DataFlow.svelte";

  type Props = {
    selected: { owner: string; name: string; kind: ObjectKind } | null;
    details: Loadable<TableDetails>;
    related?: Loadable<TableRelated>;
    onRetry: () => void;
    onReconnect?: () => void;
    sessionLost?: boolean;
    detailError?: string | null;
    dataflow?: DataFlowResult | null;
    dataflowLoading?: boolean;
    dataflowError?: string | null;
    canGoBack?: boolean;
    backLabel?: string;
    onBack?: () => void;
    onNavigateDataflow?: (owner: string, objectType: string, name: string) => void;
    onNavigate?: (owner: string, kind: string, name: string) => void;
    onViewDdl?: (owner: string, kind: string, name: string) => void;
  };
  let {
    selected,
    details,
    related = { kind: "idle" },
    onRetry,
    onReconnect,
    sessionLost = false,
    detailError = null,
    dataflow = null,
    dataflowLoading = false,
    dataflowError = null,
    canGoBack = false,
    backLabel,
    onBack,
    onNavigateDataflow,
    onNavigate,
    onViewDdl,
  }: Props = $props();

  let liveCount = $state<number | null>(null);
  let liveCountLoading = $state(false);
  let columnSearch = $state("");

  async function countRows() {
    if (!selected) return;
    liveCountLoading = true;
    const res = await tableCountRows(selected.owner, selected.name);
    liveCountLoading = false;
    if (res.ok) liveCount = res.data.count;
  }

  // Reset live count + column search + empty-section toggles when object changes
  $effect(() => { void selected; liveCount = null; liveCountLoading = false; columnSearch = ""; relShowEmpty = new Set(); });

  type Tab = "overview" | "columns" | "indexes" | "related" | "dataflow" | "vectors";
  let activeTab = $state<Tab>("columns");

  // Vector indexes (loaded lazily when Vectors tab is selected)
  let vectorIndexes = $state<Loadable<VectorIndex[]>>({ kind: "idle" });

  // Vector search state
  const PROVIDER_DEFAULTS: Record<EmbedProvider, { model: string; baseUrl?: string }> = {
    ollama:  { model: "nomic-embed-text", baseUrl: "http://localhost:11434" },
    openai:  { model: "text-embedding-3-small" },
    voyage:  { model: "voyage-3-lite" },
    custom:  { model: "" },
  };
  const PROVIDER_LABELS: Record<EmbedProvider, string> = {
    ollama: "Ollama (local)", openai: "OpenAI", voyage: "Voyage AI", custom: "Custom URL",
  };
  const DISTANCE_OPTIONS = ["COSINE", "EUCLIDEAN", "DOT"] as const;

  function loadEmbedConfig(): EmbedConfig {
    try { return JSON.parse(localStorage.getItem("veesker_embed_cfg") ?? "{}"); } catch { return {} as EmbedConfig; }
  }
  function saveEmbedConfig(cfg: EmbedConfig) {
    localStorage.setItem("veesker_embed_cfg", JSON.stringify(cfg));
  }

  let embedProvider  = $state<EmbedProvider>((loadEmbedConfig().provider) ?? "ollama");
  let embedModel     = $state(loadEmbedConfig().model || PROVIDER_DEFAULTS["ollama"].model);
  let embedBaseUrl   = $state(loadEmbedConfig().baseUrl || PROVIDER_DEFAULTS["ollama"].baseUrl || "");
  let embedApiKey    = $state(loadEmbedConfig().apiKey || "");
  let embedDistance  = $state<"COSINE" | "EUCLIDEAN" | "DOT">("COSINE");
  let embedLimit     = $state(10);
  let vectorColName  = $state("");
  let searchText     = $state("");
  let searchResult   = $state<Loadable<VectorSearchResult>>({ kind: "idle" });
  let showEmbedCfg   = $state(false);
  let showConfigBar  = $state(true);
  let expandedRow    = $state<number | null>(null);

  $effect(() => {
    void selected;
    vectorIndexes = { kind: "idle" };
    searchResult = { kind: "idle" };
    searchText = "";
    vectorColName = "";
  });

  // Auto-select first VECTOR column when entering Vectors tab
  $effect(() => {
    if (activeTab === "vectors" && !vectorColName && details.kind === "ok") {
      const first = details.value.columns.find(c => c.isVector);
      if (first) vectorColName = first.name;
    }
  });

  $effect(() => {
    const defaults = PROVIDER_DEFAULTS[embedProvider];
    embedModel = loadEmbedConfig().provider === embedProvider
      ? (loadEmbedConfig().model || defaults.model)
      : defaults.model;
    if (defaults.baseUrl) embedBaseUrl = loadEmbedConfig().provider === embedProvider
      ? (loadEmbedConfig().baseUrl || defaults.baseUrl)
      : defaults.baseUrl;
  });

  function persistEmbed() {
    saveEmbedConfig({ provider: embedProvider, model: embedModel, baseUrl: embedBaseUrl, apiKey: embedApiKey });
  }

  async function runVectorSearch() {
    if (!selected || !searchText.trim() || !vectorColName) return;
    searchResult = { kind: "loading" };
    expandedRow = null;
    persistEmbed();
    const res = await vectorSearch(
      { provider: embedProvider, model: embedModel, baseUrl: embedBaseUrl || undefined, apiKey: embedApiKey || undefined },
      searchText.trim(),
      selected.owner, selected.name, vectorColName, embedDistance, embedLimit,
    );
    searchResult = res.ok ? { kind: "ok", value: res.data } : { kind: "err", message: res.error.message };
  }

  async function loadVectorIndexes() {
    if (!selected || vectorIndexes.kind === "loading" || vectorIndexes.kind === "ok") return;
    vectorIndexes = { kind: "loading" };
    const res = await vectorIndexList(selected.owner, selected.name);
    vectorIndexes = res.ok ? { kind: "ok", value: res.data.indexes } : { kind: "err", message: res.error.message };
  }

  // Related tab: which empty sections are expanded
  let relShowEmpty = $state<Set<string>>(new Set());

  // Reset tab when object changes
  $effect(() => {
    void selected;
    if (selected?.kind === "TABLE" || selected?.kind === "VIEW") {
      activeTab = "columns";
    } else {
      activeTab = "dataflow";
    }
  });

  const tabs = $derived.by((): Array<{ id: Tab; label: string; count?: number }> => {
    if (!selected) return [];
    if (selected.kind === "TABLE" || selected.kind === "VIEW") {
      const rel = related.kind === "ok" ? related.value : null;
      const relCount = rel
        ? rel.triggers.length + rel.fksOut.length + rel.fksIn.length +
          rel.dependents.length + rel.constraints.length + rel.grants.length
        : undefined;
      const hasVectorCols = details.kind === "ok" && details.value.columns.some(c => c.isVector);
      return [
        { id: "columns", label: "Columns" },
        { id: "indexes", label: "Indexes" },
        { id: "related", label: "Related", count: relCount },
        { id: "dataflow", label: "Graph" },
        ...(hasVectorCols ? [{ id: "vectors" as Tab, label: "Vectors" }] : []),
      ];
    }
    return [{ id: "dataflow", label: "Graph" }];
  });

  function previewData() {
    if (!selected || selected.kind === "SEQUENCE") return;
    const pkCols = details.kind === "ok"
      ? details.value.columns.filter(c => c.isPk).map(c => c.name)
      : [];
    void sqlEditor.openPreview(selected.owner, selected.name, pkCols);
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

  function daysAgo(iso: string): string {
    const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
    if (diff === 0) return "today";
    if (diff === 1) return "1d ago";
    return `${diff}d ago`;
  }

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
      <img src="/veesker-sheep.png" class="empty-watermark" alt="" aria-hidden="true" />
      <p>Select an object from the tree</p>
    </div>
  {:else}
    <!-- Object header -->
    <div class="obj-header">
      {#if canGoBack}
        <div class="back-row">
          <button class="back-btn" onclick={onBack} title="Go back">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path d="M8 2L4 6l4 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            {backLabel ?? "Back"}
          </button>
        </div>
      {/if}
      <div class="obj-title-row">
        <span class="kind-chip" style="--kc:{kindColor(selected.kind)}">{kindLabel(selected.kind)}</span>
        <h2 class="obj-title">
          <span class="obj-owner">{selected.owner}</span>
          <span class="obj-sep">.</span>
          <span class="obj-name">{selected.name}</span>
        </h2>
      </div>
      <div class="obj-meta-row">
        {#if liveCount !== null}
          <span class="stat-chip">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
              <rect x="1" y="3" width="8" height="1.2" rx="0.4" fill="currentColor" opacity="0.7"/>
              <rect x="1" y="5.2" width="8" height="1.2" rx="0.4" fill="currentColor" opacity="0.5"/>
              <rect x="1" y="7.4" width="5" height="1.2" rx="0.4" fill="currentColor" opacity="0.3"/>
            </svg>
            {liveCount.toLocaleString()} rows
          </span>
        {:else if details.kind === "ok" && details.value.rowCount !== null}
          <span class="stat-chip">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
              <rect x="1" y="3" width="8" height="1.2" rx="0.4" fill="currentColor" opacity="0.7"/>
              <rect x="1" y="5.2" width="8" height="1.2" rx="0.4" fill="currentColor" opacity="0.5"/>
              <rect x="1" y="7.4" width="5" height="1.2" rx="0.4" fill="currentColor" opacity="0.3"/>
            </svg>
            ~{details.value.rowCount.toLocaleString()} rows
          </span>
        {:else if details.kind === "loading"}
          <span class="stat-chip muted-chip">loading…</span>
        {/if}

        {#if selected.kind === "TABLE" && details.kind === "ok"}
          {#if liveCountLoading}
            <span class="stat-chip muted-chip count-loading"><span class="spinner-xs"></span> counting…</span>
          {:else}
            <button class="preview-btn" onclick={countRows}>Count</button>
          {/if}
        {/if}

        {#if details.kind === "ok" && details.value.lastAnalyzed}
          <span class="stat-chip muted-chip" title="Statistics last analyzed: {details.value.lastAnalyzed}">
            stats: {daysAgo(details.value.lastAnalyzed)}
          </span>
        {/if}

        {#if (selected.kind === "TABLE" || selected.kind === "VIEW") && details.kind === "ok"}
          <button class="preview-btn" onclick={previewData}>
            Preview data
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
              <path d="M2 9L9 2M9 2H4.5M9 2v4.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <button class="preview-btn" onclick={() => onViewDdl?.(selected!.owner, selected!.kind, selected!.name)}>
            View DDL
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
              <polyline points="2 3.5 5 6.5 2 9.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
              <line x1="6" y1="9.5" x2="10" y2="9.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
            </svg>
          </button>
        {/if}
      </div>
    </div>

    <!-- Tabs -->
    {#if tabs.length > 1}
      <div class="tabs" role="tablist">
        {#each tabs as t}
          <button
            class="tab"
            class:active={activeTab === t.id}
            role="tab"
            aria-selected={activeTab === t.id}
            onclick={() => activeTab = t.id}
          >
            {t.label}
            {#if t.count !== undefined && t.count > 0}
              <span class="tab-count">{t.count}</span>
            {/if}
          </button>
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
      <img src="/veesker-sheep.png" class="tab-watermark" alt="" aria-hidden="true" />
      {#if activeTab === "columns" && (selected.kind === "TABLE" || selected.kind === "VIEW")}
        {#if details.kind === "loading"}
          <div class="loading-row">
            <span class="spinner"></span> Loading columns…
          </div>
        {:else if details.kind === "ok"}
          {@const d = details.value}
          {#if d.columns.length > 8}
            <div class="col-search-wrap">
              <svg class="col-search-icon" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <circle cx="5" cy="5" r="3.5" stroke="currentColor" stroke-width="1.2"/>
                <path d="M8 8l2.5 2.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
              </svg>
              <input
                type="search"
                placeholder="Filter columns…"
                bind:value={columnSearch}
                class="col-search"
              />
              {#if columnSearch}
                <span class="col-search-count">
                  {d.columns.filter(c => c.name.toLowerCase().includes(columnSearch.toLowerCase())).length} / {d.columns.length}
                </span>
              {/if}
            </div>
          {/if}
          {@const filtered = columnSearch
            ? d.columns.filter(c => c.name.toLowerCase().includes(columnSearch.toLowerCase()))
            : d.columns}
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
                {#each filtered as c, i (c.name)}
                  <tr class:pk-row={c.isPk}>
                    <td class="col-num">{i + 1}</td>
                    <td class="col-name">
                      {c.name}
                      {#if c.isPk}
                        <svg class="pk-icon" width="10" height="10" viewBox="0 0 10 10" fill="none" aria-label="Primary Key">
                          <circle cx="4" cy="4" r="3" stroke="#e8c547" stroke-width="1.2"/>
                          <path d="M6.5 6.5l2 2" stroke="#e8c547" stroke-width="1.2" stroke-linecap="round"/>
                        </svg>
                      {/if}
                    </td>
                    <td class="col-type">
                      <span class="type-badge" style="color:{typeColor(c.dataType)};border-color:{typeColor(c.dataType)}20;background:{typeColor(c.dataType)}10">{c.dataType}</span>
                      {#if c.isVector}
                        <span class="vector-badge" title="Oracle VECTOR column">⬡ VECTOR</span>
                      {/if}
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

      {:else if activeTab === "related"}
        {#if related.kind === "loading"}
          <div class="loading-row"><span class="spinner"></span> Loading related objects…</div>
        {:else if related.kind === "err"}
          <div class="banner banner-err"><span>{related.message}</span></div>
        {:else if related.kind === "ok"}
          {@const r = related.value}

          <!-- Triggers -->
          {#if r.triggers.length > 0 || relShowEmpty.has("triggers")}
          <div class="rel-section">
            <div class="rel-header">
              <svg class="rel-icon" width="13" height="13" viewBox="0 0 13 13" fill="none">
                <path d="M7 1L1 7.5h5L4 12l8-7H7V1z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
              </svg>
              <span>Triggers</span>
              <span class="rel-count">{r.triggers.length}</span>
            </div>
            {#if r.triggers.length === 0}
              <div class="rel-empty">None</div>
            {:else}
              <table class="rel-table">
                <thead><tr><th>Name</th><th>Type</th><th>Event</th><th>Status</th></tr></thead>
                <tbody>
                  {#each r.triggers as t (t.name)}
                    <tr>
                      <td>
                        <button class="nav-link" onclick={() => onNavigate?.(selected!.owner, "TRIGGER", t.name)}>{t.name}</button>
                      </td>
                      <td><span class="badge-neutral">{t.triggerType}</span></td>
                      <td class="mono rel-event">{t.event}</td>
                      <td>
                        <span class="badge-status" class:enabled={t.status === "ENABLED"}>{t.status}</span>
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            {/if}
          </div>
          {/if}

          <!-- Outgoing FKs -->
          {#if r.fksOut.length > 0 || relShowEmpty.has("fksOut")}
          <div class="rel-section">
            <div class="rel-header">
              <svg class="rel-icon" width="13" height="13" viewBox="0 0 13 13" fill="none">
                <path d="M2 6.5h9M7.5 3l4 3.5-4 3.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              <span>References</span>
              <span class="rel-count">{r.fksOut.length}</span>
              <span class="rel-sub">FK out — tables this object points to</span>
            </div>
            {#if r.fksOut.length === 0}
              <div class="rel-empty">None</div>
            {:else}
              {#each r.fksOut as fk (fk.constraintName)}
                <div class="fk-row">
                  <div class="fk-row-main">
                    <span class="fk-cols mono">{fk.columns}</span>
                    <svg class="fk-arrow" width="14" height="10" viewBox="0 0 14 10" fill="none">
                      <path d="M1 5h10M8 2l3 3-3 3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                    <button class="nav-link fk-table" onclick={() => onNavigate?.(fk.refOwner, "TABLE", fk.refTable)}>
                      {fk.refOwner !== selected!.owner ? `${fk.refOwner}.` : ""}{fk.refTable}
                    </button>
                    <span class="fk-dot" aria-hidden="true">·</span>
                    <span class="fk-cols mono">{fk.refColumns}</span>
                  </div>
                  <div class="fk-row-meta">
                    <span class="fk-constraint-name mono">{fk.constraintName}</span>
                    <span class="badge-neutral">{fk.deleteRule}</span>
                  </div>
                </div>
              {/each}
            {/if}
          </div>
          {/if}

          <!-- Incoming FKs -->
          {#if r.fksIn.length > 0 || relShowEmpty.has("fksIn")}
          <div class="rel-section">
            <div class="rel-header">
              <svg class="rel-icon" width="13" height="13" viewBox="0 0 13 13" fill="none">
                <path d="M11 6.5H2M5.5 3L1.5 6.5 5.5 10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              <span>Referenced By</span>
              <span class="rel-count">{r.fksIn.length}</span>
              <span class="rel-sub">FK in — tables that point to this object</span>
            </div>
            {#if r.fksIn.length === 0}
              <div class="rel-empty">None</div>
            {:else}
              {#each r.fksIn as fk (fk.constraintName)}
                <div class="fk-row">
                  <div class="fk-row-main">
                    <button class="nav-link fk-table" onclick={() => onNavigate?.(fk.fkOwner, "TABLE", fk.fkTable)}>
                      {fk.fkOwner !== selected!.owner ? `${fk.fkOwner}.` : ""}{fk.fkTable}
                    </button>
                    <svg class="fk-arrow fk-arrow-in" width="14" height="10" viewBox="0 0 14 10" fill="none">
                      <path d="M13 5H3M6 2L3 5l3 3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                    <span class="fk-cols mono">{fk.columns}</span>
                  </div>
                  <div class="fk-row-meta">
                    <span class="fk-constraint-name mono">{fk.constraintName}</span>
                    <span class="badge-neutral">{fk.deleteRule}</span>
                  </div>
                </div>
              {/each}
            {/if}
          </div>
          {/if}

          <!-- Dependent objects -->
          {#if r.dependents.length > 0 || relShowEmpty.has("dependents")}
          <div class="rel-section">
            <div class="rel-header">
              <svg class="rel-icon" width="13" height="13" viewBox="0 0 13 13" fill="none">
                <circle cx="2.5" cy="6.5" r="1.5" stroke="currentColor" stroke-width="1.2"/>
                <circle cx="10.5" cy="2.5" r="1.5" stroke="currentColor" stroke-width="1.2"/>
                <circle cx="10.5" cy="10.5" r="1.5" stroke="currentColor" stroke-width="1.2"/>
                <line x1="4" y1="6" x2="9" y2="3" stroke="currentColor" stroke-width="1.1"/>
                <line x1="4" y1="7" x2="9" y2="10" stroke="currentColor" stroke-width="1.1"/>
              </svg>
              <span>Used by</span>
              <span class="rel-count">{r.dependents.length}</span>
              <span class="rel-sub">Views, procedures, packages that depend on this object</span>
            </div>
            {#if r.dependents.length === 0}
              <div class="rel-empty">None</div>
            {:else}
              {@const byType = r.dependents.reduce<Record<string, typeof r.dependents>>((acc, d) => {
                (acc[d.type] ??= []).push(d); return acc;
              }, {})}
              {#each Object.entries(byType) as [type, items]}
                <div class="dep-group">
                  <span class="dep-type-label" style="color:{kindColor(type)}">{type}</span>
                  <div class="dep-chips">
                    {#each items as d (d.owner + "." + d.name)}
                      <button
                        class="dep-chip"
                        style="--dc:{kindColor(d.type)}"
                        onclick={() => onNavigate?.(d.owner, d.type, d.name)}
                        title="Open {d.owner}.{d.name}"
                      >{d.owner !== selected!.owner ? `${d.owner}.` : ""}{d.name}</button>
                    {/each}
                  </div>
                </div>
              {/each}
            {/if}
          </div>
          {/if}

          <!-- Constraints -->
          {#if r.constraints.length > 0 || relShowEmpty.has("constraints")}
          <div class="rel-section">
            <div class="rel-header">
              <svg class="rel-icon" width="13" height="13" viewBox="0 0 13 13" fill="none">
                <rect x="1.5" y="4.5" width="10" height="6" rx="1.5" stroke="currentColor" stroke-width="1.2"/>
                <path d="M4.5 4.5V3a2 2 0 014 0v1.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
              </svg>
              <span>Constraints</span>
              <span class="rel-count">{r.constraints.length}</span>
              <span class="rel-sub">Check and unique (PK shown in Columns tab)</span>
            </div>
            {#if r.constraints.length === 0}
              <div class="rel-empty">None</div>
            {:else}
              <table class="rel-table">
                <thead><tr><th>Name</th><th>Type</th><th>Columns</th><th>Condition</th><th>Status</th></tr></thead>
                <tbody>
                  {#each r.constraints as c (c.name)}
                    <tr>
                      <td class="mono">{c.name}</td>
                      <td>
                        {#if c.type === "U"}
                          <span class="unique-badge">UNIQUE</span>
                        {:else}
                          <span class="badge-neutral">CHECK</span>
                        {/if}
                      </td>
                      <td class="mono">{c.columns}</td>
                      <td class="mono cond-cell">{c.condition}</td>
                      <td><span class="badge-status" class:enabled={c.status === "ENABLED"}>{c.status}</span></td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            {/if}
          </div>
          {/if}

          <!-- Grants -->
          {#if r.grants.length > 0 || relShowEmpty.has("grants")}
          <div class="rel-section">
            <div class="rel-header">
              <svg class="rel-icon" width="13" height="13" viewBox="0 0 13 13" fill="none">
                <circle cx="6.5" cy="4" r="2.5" stroke="currentColor" stroke-width="1.2"/>
                <path d="M1.5 11c0-2.5 2.2-4.5 5-4.5s5 2 5 4.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
              </svg>
              <span>Grants</span>
              <span class="rel-count">{r.grants.length}</span>
            </div>
            {#if r.grants.length === 0}
              <div class="rel-empty">None</div>
            {:else}
              <table class="rel-table">
                <thead><tr><th>Grantee</th><th>Privilege</th><th>Grantor</th><th>With Grant</th></tr></thead>
                <tbody>
                  {#each r.grants as g (`${g.grantee}:${g.privilege}`)}
                    <tr>
                      <td class="mono bold">{g.grantee}</td>
                      <td><span class="badge-priv">{g.privilege}</span></td>
                      <td class="mono">{g.grantor}</td>
                      <td>{g.grantable === "YES" ? "✓" : ""}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            {/if}
          </div>
          {/if}

          <!-- Show empty sections toggle -->
          {@const emptySections = [
            { key: "triggers", label: "Triggers", count: r.triggers.length },
            { key: "fksOut", label: "References", count: r.fksOut.length },
            { key: "fksIn", label: "Referenced By", count: r.fksIn.length },
            { key: "dependents", label: "Used by", count: r.dependents.length },
            { key: "constraints", label: "Constraints", count: r.constraints.length },
            { key: "grants", label: "Grants", count: r.grants.length },
          ].filter(s => s.count === 0 && !relShowEmpty.has(s.key))}
          {#if emptySections.length > 0}
            <div class="rel-empty-toggle">
              {#each emptySections as s}
                <button
                  class="rel-empty-btn"
                  onclick={() => { relShowEmpty = new Set([...relShowEmpty, s.key]); }}
                >+ {s.label}</button>
              {/each}
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

      {:else if activeTab === "vectors"}
        {@const vectorCols = details.kind === "ok" ? details.value.columns.filter(c => c.isVector) : []}
        <div class="vec-panel">

          <!-- Config toggle strip -->
          <div class="vec-config-strip">
            <button class="vec-config-toggle" class:active={showConfigBar} onclick={() => { showConfigBar = !showConfigBar; showEmbedCfg = false; }} title="Search settings">
              <svg width="12" height="12" viewBox="0 0 13 13" fill="none">
                <circle cx="6.5" cy="6.5" r="2" stroke="currentColor" stroke-width="1.2"/>
                <path d="M6.5 1v1.2M6.5 10.8V12M1 6.5h1.2M10.8 6.5H12M2.6 2.6l.85.85M9.55 9.55l.85.85M2.6 10.4l.85-.85M9.55 3.45l.85-.85" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
              </svg>
              {PROVIDER_LABELS[embedProvider]} · {embedDistance} · {vectorColName || "…"}
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style="margin-left:2px;transition:transform 0.15s" style:transform={showConfigBar ? "rotate(180deg)" : "rotate(0deg)"}>
                <path d="M2 3.5l3 3 3-3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
          </div>

          <!-- Provider config bar (collapsible) -->
          {#if showConfigBar}
            <div class="vec-config-bar">
              <div class="vec-config-left">
                <span class="vec-label">Column</span>
                <select class="vec-select" bind:value={vectorColName}>
                  {#each vectorCols as vc}
                    <option value={vc.name}>⬡ {vc.name}</option>
                  {/each}
                </select>
                <span class="vec-label">Distance</span>
                <select class="vec-select" bind:value={embedDistance}>
                  {#each DISTANCE_OPTIONS as d}
                    <option value={d}>{d}</option>
                  {/each}
                </select>
                <span class="vec-label">Limit</span>
                <input class="vec-limit" type="number" min="1" max="100" bind:value={embedLimit} />
              </div>
              <button class="vec-cfg-btn" class:active={showEmbedCfg} onclick={() => showEmbedCfg = !showEmbedCfg} title="Embedding provider settings">
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                  <circle cx="6.5" cy="6.5" r="2" stroke="currentColor" stroke-width="1.2"/>
                  <path d="M6.5 1v1.2M6.5 10.8V12M1 6.5h1.2M10.8 6.5H12M2.6 2.6l.85.85M9.55 9.55l.85.85M2.6 10.4l.85-.85M9.55 3.45l.85-.85" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
                </svg>
                {PROVIDER_LABELS[embedProvider]}
              </button>
            </div>

            <!-- Embedding provider config (collapsible) -->
            {#if showEmbedCfg}
              <div class="vec-embed-cfg">
                <div class="vec-cfg-row">
                  <span class="vec-label">Provider</span>
                  <select class="vec-select" bind:value={embedProvider}>
                    {#each Object.entries(PROVIDER_LABELS) as [val, label]}
                      <option value={val}>{label}</option>
                    {/each}
                  </select>
                  <span class="vec-label">Model</span>
                  <input class="vec-model-input" type="text" bind:value={embedModel} placeholder={PROVIDER_DEFAULTS[embedProvider].model} />
                </div>
                {#if embedProvider === "ollama" || embedProvider === "custom"}
                  <div class="vec-cfg-row">
                    <span class="vec-label">Base URL</span>
                    <input class="vec-url-input" type="text" bind:value={embedBaseUrl} placeholder={PROVIDER_DEFAULTS[embedProvider].baseUrl ?? "http://…"} />
                  </div>
                {/if}
                {#if embedProvider === "openai" || embedProvider === "voyage"}
                  <div class="vec-cfg-row">
                    <span class="vec-label">API Key</span>
                    <input class="vec-url-input" type="password" bind:value={embedApiKey} placeholder="sk-…" />
                  </div>
                {/if}
              </div>
            {/if}
          {/if}

          <!-- Search input -->
          <div class="vec-search-row">
            <textarea
              class="vec-search-input"
              placeholder="Describe what you're looking for… (Enter or ⌘↵ to search)"
              rows={2}
              bind:value={searchText}
              onkeydown={(e) => { if (e.key === "Enter" && (e.metaKey || !e.shiftKey)) { e.preventDefault(); void runVectorSearch(); } }}
            ></textarea>
            <button
              class="vec-search-btn"
              disabled={searchResult.kind === "loading" || !searchText.trim() || !vectorColName}
              onclick={() => void runVectorSearch()}
            >
              {#if searchResult.kind === "loading"}
                <span class="vec-spinner"></span>
              {:else}
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <circle cx="5.5" cy="5.5" r="4" stroke="currentColor" stroke-width="1.4"/>
                  <line x1="8.5" y1="8.5" x2="12.5" y2="12.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
                </svg>
              {/if}
              Search
            </button>
          </div>

          <!-- Results -->
          <div class="vec-results">
            {#if searchResult.kind === "loading"}
              <div class="loading-row"><span class="spinner"></span> Generating embedding and searching…</div>
            {:else if searchResult.kind === "err"}
              <div class="banner banner-err"><span>{searchResult.message}</span></div>
            {:else if searchResult.kind === "ok"}
              {@const scoreCol = searchResult.value.columns.findIndex(c => c.name === "VD_SCORE")}
              {@const dataCols = searchResult.value.columns.filter(c => c.name !== "VD_SCORE")}
              {#if searchResult.value.rows.length === 0}
                <div class="vec-empty-results">No similar rows found for this query.</div>
              {:else}
                <div class="col-table-wrap">
                  <table class="col-table vec-result-table">
                    <thead>
                      <tr>
                        <th class="score-th">Score</th>
                        {#each dataCols as col}<th>{col.name}</th>{/each}
                      </tr>
                    </thead>
                    <tbody>
                      {#each searchResult.value.rows as row, i}
                        {@const score = scoreCol >= 0 ? Number((row as any[])[scoreCol]) : null}
                        {@const similarity = score != null ? (1 - score) : 0}
                        {@const dataVals = (row as any[]).filter((_, idx) => idx !== scoreCol)}
                        <tr
                          class="vec-result-row"
                          class:vec-row-expanded={expandedRow === i}
                          onclick={() => expandedRow = expandedRow === i ? null : i}
                          title="Click to expand"
                        >
                          <td class="score-cell">
                            <div class="score-bar-wrap">
                              <div class="score-bar" style="width:{Math.round(similarity * 100)}%"></div>
                              <span class="score-num">{similarity.toFixed(3)}</span>
                            </div>
                          </td>
                          {#each dataVals as v, ci}
                            <td class="mono vec-result-cell" class:vec-cell-expanded={expandedRow === i}>{String(v ?? "")}</td>
                          {/each}
                        </tr>
                        {#if expandedRow === i}
                          <tr class="vec-detail-row">
                            <td colspan={dataCols.length + 1}>
                              <div class="vec-detail-grid">
                                <div class="vec-detail-item">
                                  <span class="vec-detail-label">Score</span>
                                  <span class="vec-detail-value mono">{similarity.toFixed(6)}</span>
                                </div>
                                {#each dataCols as col, ci}
                                  <div class="vec-detail-item" class:vec-detail-full={String(dataVals[ci] ?? "").length > 60}>
                                    <span class="vec-detail-label">{col.name}</span>
                                    <span class="vec-detail-value">{String(dataVals[ci] ?? "")}</span>
                                  </div>
                                {/each}
                              </div>
                            </td>
                          </tr>
                        {/if}
                      {/each}
                    </tbody>
                  </table>
                </div>
              {/if}
            {:else}
              <!-- Idle: show vector indexes info -->
              {#if vectorIndexes.kind === "idle"}
                {@const __ = loadVectorIndexes()}
              {/if}
              {#if vectorIndexes.kind === "loading"}
                <div class="loading-row"><span class="spinner"></span> Loading…</div>
              {:else if vectorIndexes.kind === "ok" && vectorIndexes.value.length > 0}
                <div class="vec-index-hint">
                  <span class="vec-label">Vector indexes</span>
                  {#each vectorIndexes.value as vi}
                    <span class="vector-col-chip" title="{vi.indexType} · {vi.distanceMetric}">
                      ⬡ {vi.indexName} on {vi.targetColumn}
                    </span>
                  {/each}
                </div>
              {:else if vectorIndexes.kind === "ok"}
                <div class="empty-section" style="font-size:12px">
                  No VECTOR indexes yet — search still works (full scan).<br>
                  <small style="opacity:0.6">For performance, create one: <code>CREATE VECTOR INDEX idx ON {selected.name}({vectorColName}) ORGANIZATION INMEMORY NEIGHBOR GRAPH DISTANCE COSINE;</code></small>
                </div>
              {/if}
            {/if}
          </div>
        </div>
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
  .empty-watermark {
    width: 140px;
    height: 140px;
    object-fit: contain;
    opacity: 0.12;
    pointer-events: none;
    user-select: none;
  }

  /* ── Back button ──────────────────────────────────────────── */
  .back-row {
    margin-bottom: 0.35rem;
  }
  .back-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    background: transparent;
    border: none;
    padding: 0;
    font-family: "Space Grotesk", sans-serif;
    font-size: 11px;
    color: rgba(26,22,18,0.4);
    cursor: pointer;
    transition: color 0.12s;
  }
  .back-btn:hover { color: #b33e1f; }

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
    position: relative;
  }
  .tab-watermark {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 200px;
    height: 200px;
    object-fit: contain;
    opacity: 0.05;
    pointer-events: none;
    user-select: none;
    z-index: 0;
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
  .vector-badge {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    font-size: 9.5px;
    font-weight: 600;
    color: #a78bfa;
    background: rgba(167,139,250,0.1);
    border: 1px solid rgba(167,139,250,0.25);
    border-radius: 3px;
    padding: 1px 5px;
    margin-left: 4px;
    white-space: nowrap;
  }
  /* ── Vector Search Panel ─────────────────────────────────────────────── */
  .vec-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }
  .vec-config-strip {
    display: flex;
    align-items: center;
    padding: 0.3rem 0.75rem;
    border-bottom: 1px solid rgba(26,22,18,0.06);
    flex-shrink: 0;
  }
  .vec-config-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 10.5px;
    font-family: "Space Grotesk", sans-serif;
    font-weight: 500;
    color: rgba(26,22,18,0.4);
    background: none;
    border: none;
    padding: 2px 4px;
    cursor: pointer;
    border-radius: 3px;
    transition: color 0.1s;
  }
  .vec-config-toggle:hover, .vec-config-toggle.active {
    color: #7c3aed;
  }
  .vec-config-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid rgba(26,22,18,0.08);
    background: rgba(26,22,18,0.03);
    flex-shrink: 0;
    flex-wrap: wrap;
  }
  .vec-config-left {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-wrap: wrap;
  }
  .vec-label {
    font-size: 10.5px;
    font-weight: 600;
    color: rgba(26,22,18,0.45);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    white-space: nowrap;
  }
  .vec-select {
    font-size: 11.5px;
    font-family: "Inter", sans-serif;
    background: #fff;
    border: 1px solid rgba(26,22,18,0.15);
    border-radius: 4px;
    padding: 2px 6px;
    color: rgba(26,22,18,0.8);
    cursor: pointer;
  }
  .vec-limit {
    width: 48px;
    font-size: 11.5px;
    font-family: "JetBrains Mono", monospace;
    background: #fff;
    border: 1px solid rgba(26,22,18,0.15);
    border-radius: 4px;
    padding: 2px 6px;
    color: rgba(26,22,18,0.8);
    text-align: center;
  }
  .vec-cfg-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 11px;
    font-family: "Space Grotesk", sans-serif;
    font-weight: 500;
    color: rgba(26,22,18,0.5);
    background: rgba(26,22,18,0.05);
    border: 1px solid rgba(26,22,18,0.12);
    border-radius: 4px;
    padding: 3px 8px;
    cursor: pointer;
    transition: all 0.1s;
    white-space: nowrap;
  }
  .vec-cfg-btn:hover, .vec-cfg-btn.active {
    background: rgba(167,139,250,0.1);
    border-color: rgba(167,139,250,0.3);
    color: #7c3aed;
  }
  .vec-embed-cfg {
    padding: 0.5rem 0.75rem;
    background: rgba(167,139,250,0.04);
    border-bottom: 1px solid rgba(167,139,250,0.12);
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    flex-shrink: 0;
  }
  .vec-cfg-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .vec-model-input, .vec-url-input {
    flex: 1;
    min-width: 160px;
    font-size: 11.5px;
    font-family: "JetBrains Mono", monospace;
    background: #fff;
    border: 1px solid rgba(26,22,18,0.15);
    border-radius: 4px;
    padding: 3px 8px;
    color: rgba(26,22,18,0.85);
    outline: none;
  }
  .vec-model-input:focus, .vec-url-input:focus {
    border-color: rgba(167,139,250,0.5);
  }
  .vec-search-row {
    display: flex;
    gap: 0.5rem;
    padding: 0.6rem 0.75rem;
    border-bottom: 1px solid rgba(26,22,18,0.08);
    flex-shrink: 0;
    align-items: flex-end;
  }
  .vec-search-input {
    flex: 1;
    font-family: "Inter", sans-serif;
    font-size: 12.5px;
    background: #fff;
    border: 1px solid rgba(26,22,18,0.15);
    border-radius: 6px;
    padding: 0.45rem 0.65rem;
    resize: none;
    outline: none;
    color: rgba(26,22,18,0.85);
    transition: border-color 0.12s;
    line-height: 1.45;
  }
  .vec-search-input:focus { border-color: rgba(167,139,250,0.5); }
  .vec-search-input::placeholder { color: rgba(26,22,18,0.3); }
  .vec-search-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    background: #7c3aed;
    border: none;
    color: #fff;
    font-family: "Space Grotesk", sans-serif;
    font-size: 12px;
    font-weight: 600;
    padding: 0.45rem 0.9rem;
    border-radius: 6px;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.12s;
    height: fit-content;
  }
  .vec-search-btn:hover:not(:disabled) { background: #6d28d9; }
  .vec-search-btn:disabled { opacity: 0.45; cursor: default; }
  .vec-spinner {
    width: 11px; height: 11px;
    border: 1.5px solid rgba(255,255,255,0.3);
    border-top-color: #fff;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
    flex-shrink: 0;
  }
  .vec-results {
    flex: 1;
    overflow-y: auto;
  }
  .score-th { width: 80px; }
  .vec-result-table tbody tr { cursor: pointer; }
  .vec-result-row:hover td { background: rgba(124,58,237,0.04); }
  .vec-row-expanded td { background: rgba(124,58,237,0.06) !important; }
  .score-cell { padding: 6px 8px !important; }
  .score-bar-wrap {
    position: relative;
    display: flex;
    align-items: center;
    height: 20px;
    background: rgba(124,58,237,0.06);
    border-radius: 4px;
    overflow: hidden;
    min-width: 64px;
  }
  .score-bar {
    position: absolute;
    left: 0; top: 0; bottom: 0;
    background: rgba(124,58,237,0.18);
    transition: width 0.3s ease;
    border-radius: 4px;
  }
  .score-num {
    position: relative;
    font-family: "JetBrains Mono", monospace;
    font-size: 11px;
    font-weight: 600;
    color: #7c3aed;
    padding: 0 6px;
    white-space: nowrap;
  }
  .vec-result-cell {
    max-width: 320px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .vec-cell-expanded {
    white-space: normal;
    overflow: visible;
    text-overflow: unset;
  }
  .vec-detail-row td {
    padding: 0 !important;
    border-bottom: 1px solid rgba(124,58,237,0.15) !important;
  }
  .vec-detail-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 0;
    padding: 0.6rem 0.75rem;
    background: rgba(124,58,237,0.03);
  }
  .vec-detail-item {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 0.35rem 0.6rem;
    min-width: 120px;
    flex: 0 0 auto;
  }
  .vec-detail-full {
    flex: 1 1 100%;
  }
  .vec-detail-label {
    font-size: 9.5px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: rgba(26,22,18,0.35);
  }
  .vec-detail-value {
    font-size: 12px;
    color: rgba(26,22,18,0.85);
    line-height: 1.5;
    word-break: break-word;
  }
  .vec-empty-results {
    padding: 1.5rem 1rem;
    font-size: 12px;
    color: rgba(26,22,18,0.35);
    text-align: center;
  }
  .vec-index-hint {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.4rem;
    padding: 0.6rem 0.75rem;
  }
  .vector-col-chip {
    font-family: "JetBrains Mono", monospace;
    font-size: 11px;
    color: #a78bfa;
    background: rgba(167,139,250,0.1);
    border: 1px solid rgba(167,139,250,0.2);
    border-radius: 4px;
    padding: 2px 8px;
  }
  .empty-section small code {
    font-family: "JetBrains Mono", monospace;
    font-size: 10px;
    background: rgba(26,22,18,0.06);
    padding: 2px 4px;
    border-radius: 3px;
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

  /* ── Tab count badge ──────────────────────────────────────── */
  .tab-count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    border-radius: 8px;
    background: rgba(26,22,18,0.08);
    color: rgba(26,22,18,0.5);
    font-family: "JetBrains Mono", monospace;
    font-size: 9px;
    font-weight: 600;
    margin-left: 4px;
  }
  .tab.active .tab-count {
    background: rgba(179,62,31,0.12);
    color: #b33e1f;
  }

  /* ── Related tab ──────────────────────────────────────────── */
  .rel-section {
    border-bottom: 1px solid rgba(26,22,18,0.06);
  }
  .rel-section:last-child { border-bottom: none; }
  .rel-header {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.6rem 1.25rem;
    background: rgba(26,22,18,0.02);
    border-bottom: 1px solid rgba(26,22,18,0.05);
    font-family: "Space Grotesk", sans-serif;
    font-size: 11px;
    font-weight: 600;
    color: rgba(26,22,18,0.7);
    letter-spacing: 0.03em;
    cursor: default;
  }
  .rel-icon {
    color: rgba(26,22,18,0.35);
    flex-shrink: 0;
  }
  .rel-count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 18px;
    height: 16px;
    padding: 0 4px;
    border-radius: 8px;
    background: rgba(26,22,18,0.07);
    color: rgba(26,22,18,0.55);
    font-family: "JetBrains Mono", monospace;
    font-size: 9px;
    font-weight: 600;
  }
  .rel-sub {
    color: rgba(26,22,18,0.35);
    font-size: 10px;
    font-weight: 400;
    letter-spacing: 0;
    margin-left: 0.15rem;
  }
  .rel-empty {
    padding: 0.5rem 1.25rem;
    font-size: 11px;
    color: rgba(26,22,18,0.3);
    font-style: italic;
  }
  .rel-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 11.5px;
  }
  .rel-table th {
    text-align: left;
    font-family: "Space Grotesk", sans-serif;
    font-weight: 600;
    font-size: 9.5px;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: rgba(26,22,18,0.35);
    padding: 0.3rem 1.25rem;
    white-space: nowrap;
    border-bottom: 1px solid rgba(26,22,18,0.05);
  }
  .rel-table td {
    padding: 0.3rem 1.25rem;
    border-bottom: 1px solid rgba(26,22,18,0.04);
    vertical-align: middle;
  }
  .rel-table tr:last-child td { border-bottom: none; }
  .rel-table tr:hover td { background: rgba(26,22,18,0.02); }
  .bold { font-weight: 600; color: #1a1612; }
  .cond-cell { max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: rgba(26,22,18,0.55); }

  .badge-neutral {
    font-family: "Space Grotesk", sans-serif;
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0.05em;
    color: rgba(26,22,18,0.5);
    background: rgba(26,22,18,0.06);
    border: 1px solid rgba(26,22,18,0.1);
    border-radius: 3px;
    padding: 1px 5px;
    white-space: nowrap;
  }
  .badge-status {
    font-family: "Space Grotesk", sans-serif;
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0.05em;
    color: rgba(26,22,18,0.35);
    background: rgba(26,22,18,0.05);
    border: 1px solid rgba(26,22,18,0.08);
    border-radius: 3px;
    padding: 1px 5px;
  }
  .badge-status.enabled {
    color: #27ae60;
    background: rgba(39,174,96,0.08);
    border-color: rgba(39,174,96,0.2);
  }
  .badge-priv {
    font-family: "JetBrains Mono", monospace;
    font-size: 9.5px;
    font-weight: 500;
    color: #4a9eda;
    background: rgba(74,158,218,0.08);
    border: 1px solid rgba(74,158,218,0.18);
    border-radius: 3px;
    padding: 1px 5px;
    white-space: nowrap;
  }

  /* ── Dependents chip layout ───────────────────────────────── */
  .dep-group {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 0.4rem 1.25rem;
    border-bottom: 1px solid rgba(26,22,18,0.04);
  }
  .dep-group:last-child { border-bottom: none; }
  .dep-type-label {
    font-family: "Space Grotesk", sans-serif;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: rgba(26,22,18,0.35);
    min-width: 90px;
    padding-top: 2px;
    flex-shrink: 0;
  }
  .dep-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
  }
  .dep-chip {
    font-family: "JetBrains Mono", "SF Mono", monospace;
    font-size: 10.5px;
    color: var(--dc, #4a9eda);
    background: color-mix(in srgb, var(--dc, #4a9eda) 8%, transparent);
    border: 1px solid color-mix(in srgb, var(--dc, #4a9eda) 20%, transparent);
    border-radius: 4px;
    padding: 2px 8px;
    white-space: nowrap;
    cursor: pointer;
    transition: background 0.1s, border-color 0.1s;
  }
  .dep-chip:hover {
    background: color-mix(in srgb, var(--dc, #4a9eda) 16%, transparent);
    border-color: color-mix(in srgb, var(--dc, #4a9eda) 35%, transparent);
  }

  /* ── FK row layout ────────────────────────────────────────── */
  .fk-row {
    padding: 0.45rem 1.25rem;
    border-bottom: 1px solid rgba(26,22,18,0.04);
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .fk-row:last-child { border-bottom: none; }
  .fk-row:hover { background: rgba(26,22,18,0.02); }
  .fk-row-main {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    flex-wrap: wrap;
  }
  .fk-row-meta {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding-left: 0.05rem;
  }
  .fk-arrow {
    color: rgba(26,22,18,0.3);
    flex-shrink: 0;
  }
  .fk-cols {
    color: rgba(26,22,18,0.65);
    font-size: 11px;
  }
  .fk-table {
    font-size: 12px;
  }
  .fk-dot {
    color: rgba(26,22,18,0.25);
    font-size: 12px;
  }
  .fk-constraint-name {
    color: rgba(26,22,18,0.35);
    font-size: 10px;
  }
  .rel-event {
    font-size: 11px;
    color: rgba(26,22,18,0.6);
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* ── Empty sections toggle ────────────────────────────────── */
  .rel-empty-toggle {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    padding: 0.75rem 1.25rem;
    border-top: 1px solid rgba(26,22,18,0.05);
  }
  .rel-empty-btn {
    background: transparent;
    border: 1px dashed rgba(26,22,18,0.15);
    color: rgba(26,22,18,0.4);
    font-family: "Space Grotesk", sans-serif;
    font-size: 10.5px;
    padding: 2px 8px;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.1s;
  }
  .rel-empty-btn:hover {
    border-color: rgba(26,22,18,0.3);
    color: rgba(26,22,18,0.65);
    background: rgba(26,22,18,0.03);
  }

  .nav-link {
    font-family: "JetBrains Mono", "SF Mono", monospace;
    font-size: 11.5px;
    font-weight: 600;
    color: #4a9eda;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    text-decoration: underline;
    text-decoration-color: rgba(74,158,218,0.35);
    text-underline-offset: 2px;
    transition: color 0.1s;
  }
  .nav-link:hover { color: #2980b9; }

  /* ── Column search ────────────────────────────────────────── */
  .col-search-wrap {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid rgba(26,22,18,0.06);
    background: rgba(26,22,18,0.01);
  }
  .col-search-icon {
    color: rgba(26,22,18,0.3);
    flex-shrink: 0;
  }
  .col-search {
    flex: 1;
    border: none;
    background: transparent;
    font-family: "Space Grotesk", sans-serif;
    font-size: 12px;
    color: #1a1612;
    outline: none;
    min-width: 0;
  }
  .col-search::placeholder { color: rgba(26,22,18,0.3); }
  .col-search-count {
    font-family: "JetBrains Mono", monospace;
    font-size: 10px;
    color: rgba(26,22,18,0.35);
    white-space: nowrap;
  }

  /* ── Inline count loading ─────────────────────────────────── */
  .count-loading {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }
  .spinner-xs {
    width: 9px; height: 9px;
    border: 1.5px solid rgba(26,22,18,0.12);
    border-top-color: #b33e1f;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    flex-shrink: 0;
    display: inline-block;
  }
</style>
