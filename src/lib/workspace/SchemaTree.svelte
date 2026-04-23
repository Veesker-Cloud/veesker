<script lang="ts">
  import type { ObjectKind, Loadable } from "$lib/workspace";

  export type SchemaNode = {
    name: string;
    isCurrent: boolean;
    expanded: boolean;
    kinds: Partial<Record<ObjectKind, Loadable<Array<{ name: string; status?: string }>>>>;
    kindCounts?: Partial<Record<string, number>>;
    vectorTables?: Set<string>;
  };

  type Props = {
    schemas: SchemaNode[];
    selected: { owner: string; name: string; kind: ObjectKind } | null;
    onToggle: (owner: string) => void;
    onSelect: (owner: string, name: string, kind: ObjectKind) => void;
    onRetry: (owner: string, kind: ObjectKind) => void;
    onRefresh?: () => void;
    refreshing?: boolean;
    onExecuteProc?: (owner: string, name: string, objectType: "PROCEDURE" | "FUNCTION") => void;
  };
  let { schemas, selected, onToggle, onSelect, onRetry, onRefresh, refreshing = false, onExecuteProc }: Props = $props();

  let search = $state("");
  let hiddenKinds = $state<Set<ObjectKind>>(new Set());
  let showSystemSchemas = $state(false);

  const SYSTEM_SCHEMAS = new Set([
    "ANONYMOUS", "APPQOSYS", "AUDSYS", "CTXSYS", "DBSFWUSER", "DBSNMP",
    "DGPDB_INT", "DIP", "DVF", "DVSYS", "EXFSYS", "GGSHAREDCAP", "GGSYS",
    "GSMADMIN_INTERNAL", "GSMCATUSER", "GSMUSER", "LBACSYS", "MDDATA",
    "MDSYS", "MGMT_VIEW", "OJVMSYS", "OLAPSYS", "ORDDATA", "ORDPLUGINS",
    "ORDSYS", "OUTLN", "OWBSYS", "OWBSYS_AUDIT", "REMOTE_SCHEDULER_AGENT",
    "SI_INFORMTN_SCHEMA", "SYS", "SYSBACKUP", "SYSDG", "SYSKM", "SYSRAC",
    "SYSMAN", "SYSTEM", "WMSYS", "XDB", "XS$NULL",
  ]);

  const KIND_LABELS: Record<ObjectKind, string> = {
    TABLE: "Tables", VIEW: "Views", SEQUENCE: "Sequences",
    PROCEDURE: "Procedures", FUNCTION: "Functions",
    PACKAGE: "Packages", TRIGGER: "Triggers", TYPE: "Types",
  };

  const KIND_SHORT: Record<ObjectKind, string> = {
    TABLE: "Tbl", VIEW: "View", SEQUENCE: "Seq",
    PROCEDURE: "Proc", FUNCTION: "Func",
    PACKAGE: "Pkg", TRIGGER: "Trig", TYPE: "Type",
  };

  function toggleKind(kind: ObjectKind) {
    const next = new Set(hiddenKinds);
    if (next.has(kind)) next.delete(kind);
    else next.add(kind);
    hiddenKinds = next;
  }

  const KIND_ORDER: ObjectKind[] = [
    "TABLE", "VIEW", "SEQUENCE",
    "PROCEDURE", "FUNCTION", "PACKAGE", "TRIGGER", "TYPE",
  ];

  // Accent colors per object kind
  const KIND_COLOR: Record<ObjectKind, string> = {
    TABLE:     "#4a9eda",
    VIEW:      "#27ae60",
    SEQUENCE:  "#2ecc71",
    PROCEDURE: "#e67e22",
    FUNCTION:  "#f39c12",
    PACKAGE:   "#9b59b6",
    TRIGGER:   "#e74c3c",
    TYPE:      "#3498db",
  };

  function isSystemSchema(name: string): boolean {
    return SYSTEM_SCHEMAS.has(name.toUpperCase());
  }

  function isVisible(s: SchemaNode): boolean {
    if (!showSystemSchemas && isSystemSchema(s.name) && !s.isCurrent) return false;
    return schemaVisible(s);
  }

  function isSelected(owner: string, name: string, kind: ObjectKind): boolean {
    return selected?.owner === owner && selected?.name === name && selected?.kind === kind;
  }

  const q = $derived(search.trim().toLowerCase());

  // Returns whether the schema itself should be visible in search results
  function schemaVisible(s: SchemaNode): boolean {
    if (!q) return true;
    if (s.name.toLowerCase().includes(q)) return true;
    // Also visible if any loaded objects match
    for (const kind of KIND_ORDER) {
      const loadable = s.kinds[kind];
      if (loadable?.kind === "ok" && loadable.value.some(o => o.name.toLowerCase().includes(q))) {
        return true;
      }
    }
    return false;
  }

  // When schema name itself matches, show all objects unfiltered.
  // When schema matched only via objects, filter objects by query.
  function schemaNameMatches(s: SchemaNode): boolean {
    return !q || s.name.toLowerCase().includes(q);
  }

  function filteredObjects(
    items: Array<{ name: string; status?: string }>,
    passThrough: boolean,
  ): Array<{ name: string; status?: string }> {
    if (!q || passThrough) return items;
    return items.filter(o => o.name.toLowerCase().includes(q));
  }

  function kindVisible(loadable: Loadable<Array<{ name: string }>>, passThrough: boolean): boolean {
    if (!q || passThrough) return true;
    if (loadable.kind !== "ok") return true;
    return loadable.value.some(o => o.name.toLowerCase().includes(q));
  }

  function kindCount(loadable: Loadable<Array<{ name: string }>>, filtered: Array<{ name: string }>): number | null {
    if (loadable.kind !== "ok") return null;
    return filtered.length;
  }
</script>

<nav class="tree">
  <!-- Search + Refresh -->
  <div class="search-wrap">
    <svg class="search-icon" width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
      <circle cx="5.5" cy="5.5" r="3.5" stroke="currentColor" stroke-width="1.3"/>
      <line x1="8.5" y1="8.5" x2="11.5" y2="11.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
    </svg>
    <input
      class="search"
      type="search"
      placeholder="Filter objects…"
      bind:value={search}
      aria-label="Filter objects"
    />
    {#if search}
      <button class="search-clear" onclick={() => search = ""} aria-label="Clear filter">×</button>
    {/if}
    <button
      class="sys-btn"
      class:active={showSystemSchemas}
      onclick={() => showSystemSchemas = !showSystemSchemas}
      aria-pressed={showSystemSchemas}
      title={showSystemSchemas ? "Hide system schemas" : "Show system schemas"}
    >sys</button>
    {#if onRefresh}
      <button
        class="refresh-btn"
        class:spinning={refreshing}
        onclick={onRefresh}
        aria-label="Refresh schema tree"
        title="Refresh schemas"
        disabled={refreshing}
      >
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
          <path d="M9 2A4.5 4.5 0 1 0 10 5.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
          <polyline points="8,0 10,2 8,4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    {/if}
  </div>

  <!-- Type filter pills -->
  <div class="kind-pills">
    {#each KIND_ORDER as kind}
      <button
        class="kind-pill"
        class:off={hiddenKinds.has(kind)}
        style="--kc:{KIND_COLOR[kind]}"
        onclick={() => toggleKind(kind)}
        title={KIND_LABELS[kind]}
        aria-pressed={!hiddenKinds.has(kind)}
      >
        <span class="pill-dot" aria-hidden="true"></span>
        {KIND_SHORT[kind]}
      </button>
    {/each}
  </div>

  {#each schemas as s (s.name)}
    {#if isVisible(s)}
    <div class="schema">
      <button
        class="schema-row"
        class:current={s.isCurrent}
        onclick={() => onToggle(s.name)}
        title={s.name}
      >
        <span class="chev" aria-hidden="true">{s.expanded || q ? "▾" : "▸"}</span>
        <svg class="schema-icon" width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
          <ellipse cx="6.5" cy="4.5" rx="5" ry="2" stroke="currentColor" stroke-width="1.1"/>
          <path d="M1.5 4.5v4c0 1.1 2.2 2 5 2s5-.9 5-2v-4" stroke="currentColor" stroke-width="1.1"/>
          <path d="M1.5 6.5c0 1.1 2.2 2 5 2s5-.9 5-2" stroke="currentColor" stroke-width="0.8" stroke-dasharray="1.5 1.5"/>
        </svg>
        <span class="schema-name">{s.name}</span>
        {#if s.isCurrent}
          <span class="current-badge" title="Active schema">●</span>
        {/if}
      </button>

      {#if s.expanded || q}
        {@const passThrough = schemaNameMatches(s)}
        <div class="kinds">
          {#each KIND_ORDER as kind}
            {#if s.kinds[kind] !== undefined && !hiddenKinds.has(kind)}
              {@const loadable = s.kinds[kind]!}
              {@const filtered = loadable.kind === "ok" ? filteredObjects(loadable.value, passThrough) : []}
              {#if kindVisible(loadable, passThrough)}
              <details class="kind" open>
                <summary class="kind-head" style="--kc:{KIND_COLOR[kind]}">
                  <span class="kind-dot" style="background:{KIND_COLOR[kind]}" aria-hidden="true"></span>
                  <span class="kind-label">{KIND_LABELS[kind]}</span>
                  {#if loadable.kind === "ok"}
                    <span class="kind-count">{kindCount(loadable, filtered)}</span>
                  {:else if loadable.kind === "loading"}
                    <span class="kind-spinner" aria-label="loading"></span>
                  {:else if s.kindCounts?.[kind] !== undefined}
                    <span class="kind-count pre-count">{s.kindCounts[kind]}</span>
                  {/if}
                </summary>
                <div class="kind-body">
                  {#if loadable.kind === "loading"}
                    <div class="muted-row">loading…</div>
                  {:else if loadable.kind === "err"}
                    <div class="err-row">
                      <span class="err-msg">{loadable.message}</span>
                      <button class="retry-btn" onclick={() => onRetry(s.name, kind)}>retry</button>
                    </div>
                  {:else if loadable.kind === "ok"}
                    {#each filtered as o (o.name)}
                      <div class="obj-row">
                        <button
                          class="object"
                          class:selected={isSelected(s.name, o.name, kind)}
                          style={isSelected(s.name, o.name, kind) ? `--kc:${KIND_COLOR[kind]}` : ""}
                          onclick={() => onSelect(s.name, o.name, kind)}
                          title="{s.name}.{o.name}"
                        >
                          <span class="obj-name">{o.name}</span>
                          {#if kind === "TABLE" && s.vectorTables?.has(o.name)}
                            <span class="vector-dot" title="Has VECTOR columns" aria-label="vector">⬡</span>
                          {/if}
                          {#if o.status && o.status !== "VALID"}
                            <span class="invalid-dot" title="{o.status}" aria-label="invalid"></span>
                          {/if}
                        </button>
                        {#if (kind === "PROCEDURE" || kind === "FUNCTION") && onExecuteProc}
                          <button
                            class="exec-btn"
                            onclick={(e) => { e.stopPropagation(); onExecuteProc!(s.name, o.name, kind as "PROCEDURE" | "FUNCTION"); }}
                            title="Execute {o.name}"
                            aria-label="Execute {o.name}"
                          >▶</button>
                        {/if}
                      </div>
                    {:else}
                      <div class="muted-row">— none —</div>
                    {/each}
                  {/if}
                </div>
              </details>
              {/if}
            {/if}
          {/each}
        </div>
      {/if}
    </div>
    {/if}
  {/each}
</nav>

<style>
  .tree {
    width: 100%;
    height: 100%;
    min-width: 0;
    background: #18140f;
    border-right: 1px solid rgba(255,255,255,0.06);
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    font-size: 11.5px;
    font-family: "Inter", -apple-system, system-ui, sans-serif;
    box-sizing: border-box;
    padding-bottom: 2rem;
  }

  /* ── Search ───────────────────────────────────────────────── */
  .search-wrap {
    position: relative;
    padding: 0.6rem 0.6rem 0.4rem;
    display: flex;
    align-items: center;
    gap: 0.3rem;
  }
  .search-icon {
    position: absolute;
    left: 1rem;
    color: rgba(255,255,255,0.3);
    pointer-events: none;
  }
  .search {
    width: 100%;
    background: rgba(255,255,255,0.07);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 5px;
    color: rgba(255,255,255,0.85);
    font-family: "Inter", sans-serif;
    font-size: 11px;
    padding: 0.3rem 1.6rem 0.3rem 1.8rem;
    outline: none;
    box-sizing: border-box;
    transition: border-color 0.12s, background 0.12s;
  }
  .search::placeholder { color: rgba(255,255,255,0.3); }
  .search:focus {
    border-color: rgba(179, 62, 31, 0.6);
    background: rgba(255,255,255,0.1);
  }
  .search::-webkit-search-cancel-button { display: none; }
  .search-clear {
    position: absolute;
    right: 0.9rem;
    background: transparent;
    border: none;
    color: rgba(255,255,255,0.35);
    font-size: 14px;
    line-height: 1;
    cursor: pointer;
    padding: 0;
  }
  .search-clear:hover { color: rgba(255,255,255,0.7); }
  .sys-btn {
    background: transparent;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 3px;
    color: rgba(255,255,255,0.25);
    font-size: 9px;
    font-family: "Inter", sans-serif;
    letter-spacing: 0.04em;
    padding: 2px 5px;
    cursor: pointer;
    flex-shrink: 0;
    transition: color 0.12s, border-color 0.12s, background 0.12s;
  }
  .sys-btn:hover { color: rgba(255,255,255,0.55); border-color: rgba(255,255,255,0.2); }
  .sys-btn.active {
    color: #e8d5a0;
    border-color: rgba(232,213,160,0.35);
    background: rgba(232,213,160,0.08);
  }

  .refresh-btn {
    background: transparent;
    border: none;
    color: rgba(255,255,255,0.35);
    cursor: pointer;
    padding: 2px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 3px;
    flex-shrink: 0;
    transition: color 0.12s, background 0.12s;
  }
  .refresh-btn:hover { color: rgba(255,255,255,0.75); background: rgba(255,255,255,0.07); }
  .refresh-btn:disabled { opacity: 0.4; cursor: default; }
  .refresh-btn.spinning svg { animation: spin 0.8s linear infinite; }

  /* ── Kind filter pills ───────────────────────────────────── */
  .kind-pills {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
    padding: 0 0.6rem 0.5rem;
  }
  .kind-pill {
    display: flex;
    align-items: center;
    gap: 3px;
    padding: 2px 6px;
    border-radius: 4px;
    border: 1px solid color-mix(in srgb, var(--kc) 40%, transparent);
    background: color-mix(in srgb, var(--kc) 12%, transparent);
    color: color-mix(in srgb, var(--kc) 80%, rgba(255,255,255,0.6));
    font-size: 10px;
    font-family: "Inter", sans-serif;
    cursor: pointer;
    transition: opacity 0.12s, background 0.12s, border-color 0.12s;
    user-select: none;
    line-height: 1.4;
  }
  .kind-pill:hover {
    background: color-mix(in srgb, var(--kc) 22%, transparent);
    border-color: color-mix(in srgb, var(--kc) 60%, transparent);
  }
  .kind-pill.off {
    background: transparent;
    border-color: rgba(255,255,255,0.08);
    color: rgba(255,255,255,0.25);
  }
  .kind-pill.off .pill-dot { background: rgba(255,255,255,0.15); }
  .pill-dot {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: var(--kc);
    flex-shrink: 0;
    transition: background 0.12s;
  }

  /* ── Schema row ───────────────────────────────────────────── */
  .schema { margin-bottom: 0.15rem; }
  .schema-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    width: 100%;
    background: transparent;
    border: none;
    padding: 0.45rem 0.7rem;
    cursor: pointer;
    text-align: left;
    color: rgba(255,255,255,0.5);
    font-family: "Space Grotesk", sans-serif;
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    border-radius: 0;
    transition: background 0.1s;
  }
  .schema-row:hover { background: rgba(255,255,255,0.05); color: rgba(255,255,255,0.8); }
  .schema-row.current { color: #e8d5a0; }
  .schema-icon { flex-shrink: 0; color: inherit; }
  .schema-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chev { font-size: 10px; flex-shrink: 0; }
  .current-badge {
    font-size: 8px;
    color: #7ec96a;
    flex-shrink: 0;
  }

  /* ── Kind section ─────────────────────────────────────────── */
  .kinds { padding: 0; }
  .kind { margin: 0; }
  .kind-head {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.25rem 0.7rem 0.25rem 1.4rem;
    cursor: pointer;
    list-style: none;
    font-family: "Space Grotesk", sans-serif;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgba(255,255,255,0.35);
    transition: color 0.1s;
    user-select: none;
  }
  .kind-head::-webkit-details-marker { display: none; }
  .kind-head::marker { display: none; }
  .kind-head:hover { color: rgba(255,255,255,0.6); }
  .kind-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    flex-shrink: 0;
    opacity: 0.7;
  }
  .kind-label { flex: 1 1 auto; }
  .kind-count {
    background: rgba(255,255,255,0.08);
    color: rgba(255,255,255,0.4);
    font-size: 9px;
    padding: 1px 5px;
    border-radius: 8px;
    font-family: "Inter", sans-serif;
    letter-spacing: 0;
  }
  .pre-count { opacity: 0.55; }
  .kind-spinner {
    width: 8px; height: 8px;
    border: 1.5px solid rgba(255,255,255,0.1);
    border-top-color: rgba(255,255,255,0.4);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    flex-shrink: 0;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* ── Object items ─────────────────────────────────────────── */
  .kind-body { padding-bottom: 0.2rem; }
  .object {
    display: flex;
    align-items: center;
    min-width: 0;
    text-align: left;
    background: transparent;
    border: none;
    padding: 0.2rem 0.7rem 0.2rem 1.8rem;
    border-radius: 0;
    font-family: "JetBrains Mono", "SF Mono", monospace;
    font-size: 11px;
    color: rgba(255,255,255,0.58);
    cursor: pointer;
    transition: background 0.08s, color 0.08s;
    gap: 0.35rem;
  }
  .object:hover {
    background: rgba(255,255,255,0.06);
    color: rgba(255,255,255,0.85);
  }
  .object.selected {
    background: color-mix(in srgb, var(--kc) 18%, transparent);
    color: #fff;
    font-weight: 500;
    border-left: 2px solid var(--kc);
    padding-left: calc(1.8rem - 2px);
  }
  .obj-name {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .invalid-dot {
    width: 5px; height: 5px;
    border-radius: 50%;
    background: #e74c3c;
    flex-shrink: 0;
  }
  .vector-dot {
    font-size: 9px;
    color: #a78bfa;
    flex-shrink: 0;
    line-height: 1;
  }

  /* ── States ───────────────────────────────────────────────── */
  .muted-row {
    color: rgba(255,255,255,0.2);
    font-size: 10px;
    padding: 0.1rem 0.7rem 0.1rem 1.8rem;
    font-style: italic;
  }
  .err-row {
    color: #e87565;
    font-size: 10px;
    padding: 0.15rem 0.7rem 0.15rem 1.8rem;
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .err-msg { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .retry-btn {
    background: rgba(232, 117, 101, 0.15);
    border: 1px solid rgba(232, 117, 101, 0.3);
    color: #e87565;
    font-size: 9px;
    padding: 1px 5px;
    border-radius: 3px;
    cursor: pointer;
    flex-shrink: 0;
  }

  .obj-row { display: flex; align-items: center; }
  .obj-row .object { flex: 1; }
  .exec-btn {
    flex-shrink: 0; background: none; border: none; cursor: pointer;
    color: var(--text-muted); font-size: 9px; padding: 2px 5px; border-radius: 3px;
    opacity: 0; transition: opacity 0.1s;
  }
  .obj-row:hover .exec-btn { opacity: 1; }
  .exec-btn:hover { background: rgba(179,62,31,0.15); color: #f5a08a; }
</style>
