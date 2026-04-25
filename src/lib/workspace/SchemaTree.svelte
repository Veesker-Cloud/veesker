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
    onTestWindow?: (owner: string, name: string, kind: ObjectKind) => void;
    onExposeAsRest?: (owner: string, name: string, kind: "TABLE" | "VIEW" | "PROCEDURE" | "FUNCTION") => void;
  };
  let { schemas, selected, onToggle, onSelect, onRetry, onRefresh, refreshing = false, onExecuteProc, onTestWindow, onExposeAsRest }: Props = $props();

  let search = $state("");
  let hiddenKinds = $state<Set<ObjectKind>>(new Set());
  let showSystemSchemas = $state(false);
  let contextMenu = $state<{ x: number; y: number; owner: string; name: string; kind: ObjectKind } | null>(null);

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
    REST_MODULE: "REST Modules",
  };

  const KIND_SHORT: Record<ObjectKind, string> = {
    TABLE: "Tbl", VIEW: "View", SEQUENCE: "Seq",
    PROCEDURE: "Proc", FUNCTION: "Func",
    PACKAGE: "Pkg", TRIGGER: "Trig", TYPE: "Type",
    REST_MODULE: "API",
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
    "REST_MODULE",
  ];

  const KIND_COLOR: Record<ObjectKind, string> = {
    TABLE:       "#4a9eda",
    VIEW:        "#27ae60",
    SEQUENCE:    "#2ecc71",
    PROCEDURE:   "#e67e22",
    FUNCTION:    "#f39c12",
    PACKAGE:     "#9b59b6",
    TRIGGER:     "#e74c3c",
    TYPE:        "#3498db",
    REST_MODULE: "#f5a08a",
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
                          oncontextmenu={(e) => {
                            if (!['PROCEDURE', 'FUNCTION', 'PACKAGE', 'TABLE', 'VIEW'].includes(kind as string)) return;
                            e.preventDefault();
                            contextMenu = { x: e.clientX, y: e.clientY, owner: s.name, name: o.name, kind: kind as ObjectKind };
                          }}
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

  {#if contextMenu}
    <div
      class="ctx-backdrop"
      role="presentation"
      onclick={() => { contextMenu = null; }}
      onkeydown={() => { contextMenu = null; }}
    ></div>
    <div class="ctx-menu" style="left: {contextMenu.x}px; top: {contextMenu.y}px;">
      {#if onTestWindow}
        <button
          class="ctx-item"
          onclick={() => {
            onTestWindow!(contextMenu!.owner, contextMenu!.name, contextMenu!.kind);
            contextMenu = null;
          }}
        >
          Test Window
        </button>
      {/if}
      {#if (contextMenu.kind === 'PROCEDURE' || contextMenu.kind === 'FUNCTION') && onExecuteProc}
        <button
          class="ctx-item"
          onclick={() => {
            onExecuteProc!(contextMenu!.owner, contextMenu!.name, contextMenu!.kind as "PROCEDURE" | "FUNCTION");
            contextMenu = null;
          }}
        >
          Execute…
        </button>
      {/if}
      {#if (contextMenu.kind === 'TABLE' || contextMenu.kind === 'VIEW' || contextMenu.kind === 'PROCEDURE' || contextMenu.kind === 'FUNCTION') && onExposeAsRest}
        <button
          class="ctx-item"
          onclick={() => {
            onExposeAsRest!(
              contextMenu!.owner,
              contextMenu!.name,
              contextMenu!.kind as "TABLE" | "VIEW" | "PROCEDURE" | "FUNCTION"
            );
            contextMenu = null;
          }}
        >
          {contextMenu.kind === 'TABLE' || contextMenu.kind === 'VIEW' ? 'Expor como API REST…' : 'Expor como endpoint REST…'}
        </button>
      {/if}
    </div>
  {/if}
</nav>

<style>
  .tree {
    width: 100%;
    height: 100%;
    min-width: 0;
    background: var(--bg-page);
    border-right: 1px solid var(--border);
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
    color: var(--text-muted);
    pointer-events: none;
  }
  .search {
    width: 100%;
    background: var(--bg-surface-alt);
    border: 1px solid var(--border);
    border-radius: 5px;
    color: var(--text-primary);
    font-family: "Inter", sans-serif;
    font-size: 11px;
    padding: 0.3rem 1.6rem 0.3rem 1.8rem;
    outline: none;
    box-sizing: border-box;
    transition: border-color 0.12s, background 0.12s;
  }
  .search::placeholder { color: var(--text-muted); }
  .search:focus {
    border-color: rgba(179, 62, 31, 0.6);
    background: var(--bg-surface);
  }
  .search::-webkit-search-cancel-button { display: none; }
  .search-clear {
    position: absolute;
    right: 0.9rem;
    background: transparent;
    border: none;
    color: var(--text-muted);
    font-size: 14px;
    line-height: 1;
    cursor: pointer;
    padding: 0;
  }
  .search-clear:hover { color: var(--text-secondary); }
  .sys-btn {
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 3px;
    color: var(--text-muted);
    font-size: 9px;
    font-family: "Inter", sans-serif;
    letter-spacing: 0.04em;
    padding: 2px 5px;
    cursor: pointer;
    flex-shrink: 0;
    transition: color 0.12s, border-color 0.12s, background 0.12s;
  }
  .sys-btn:hover { color: var(--text-secondary); border-color: var(--border-strong); }
  .sys-btn.active {
    color: #e8d5a0;
    border-color: rgba(232,213,160,0.35);
    background: rgba(232,213,160,0.08);
  }

  .refresh-btn {
    background: transparent;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    padding: 2px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 3px;
    flex-shrink: 0;
    transition: color 0.12s, background 0.12s;
  }
  .refresh-btn:hover { color: var(--text-primary); background: var(--row-hover); }
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
    color: color-mix(in srgb, var(--kc) 75%, var(--text-secondary));
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
    border-color: var(--border);
    color: var(--text-muted);
  }
  .kind-pill.off .pill-dot { background: var(--border-strong); }
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
    color: var(--text-secondary);
    font-family: "Space Grotesk", sans-serif;
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    border-radius: 0;
    transition: background 0.1s;
  }
  .schema-row:hover { background: var(--row-hover); color: var(--text-primary); }
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
    color: var(--text-muted);
    transition: color 0.1s;
    user-select: none;
  }
  .kind-head::-webkit-details-marker { display: none; }
  .kind-head::marker { display: none; }
  .kind-head:hover { color: var(--text-secondary); }
  .kind-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    flex-shrink: 0;
    opacity: 0.7;
  }
  .kind-label { flex: 1 1 auto; }
  .kind-count {
    background: var(--row-alt);
    color: var(--text-muted);
    font-size: 9px;
    padding: 1px 5px;
    border-radius: 8px;
    font-family: "Inter", sans-serif;
    letter-spacing: 0;
  }
  .pre-count { opacity: 0.55; }
  .kind-spinner {
    width: 8px; height: 8px;
    border: 1.5px solid var(--border);
    border-top-color: var(--text-muted);
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
    color: var(--text-secondary);
    cursor: pointer;
    transition: background 0.08s, color 0.08s;
    gap: 0.35rem;
  }
  .object:hover {
    background: var(--row-hover);
    color: var(--text-primary);
  }
  .object.selected {
    background: color-mix(in srgb, var(--kc) 18%, transparent);
    color: var(--text-primary);
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
    color: var(--text-muted);
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

  .ctx-backdrop { position: fixed; inset: 0; z-index: 900; }
  .ctx-menu {
    position: fixed; z-index: 901; background: var(--bg-surface);
    border: 1px solid var(--border); border-radius: 4px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.4); min-width: 140px; padding: 4px 0;
  }
  .ctx-item {
    display: block; width: 100%; background: none; border: none;
    color: var(--text-primary); cursor: pointer; font-size: 12px;
    padding: 6px 14px; text-align: left;
  }
  .ctx-item:hover { background: var(--row-hover); }
</style>
