<!--
  Copyright 2022-2026 Geraldo Ferreira Viana Júnior
  Licensed under the Apache License, Version 2.0
  https://github.com/veesker-cloud/veesker-community-edition
-->

<script lang="ts">
  import {
    apexApplicationsList,
    apexPagesList,
    apexWorkspacesList,
    type ApexApplicationRow,
    type ApexDetectResult,
    type ApexPageRow,
    type ApexWorkspaceRow,
    type ObjectKind,
    type Loadable,
  } from "$lib/workspace";
  import { Table, Eye, Hash, Cog, SquareFunction, Package, Zap, FileType, Webhook, Database, Link2, Folder, Inbox, Clock, User as UserIcon, Shield, Boxes } from "lucide-svelte";

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
    onKindExpand?: (owner: string, kind: ObjectKind) => void;
    onRefresh?: () => void;
    refreshing?: boolean;
    onExecuteProc?: (owner: string, name: string, objectType: "PROCEDURE" | "FUNCTION") => void;
    onTestWindow?: (owner: string, name: string, kind: ObjectKind) => void;
    onExposeAsRest?: (owner: string, name: string, kind: "TABLE" | "VIEW" | "PROCEDURE" | "FUNCTION") => void;
    apex?: ApexDetectResult | null;
  };
  let { schemas, selected, onToggle, onSelect, onRetry, onKindExpand, onRefresh, refreshing = false, onExecuteProc, onTestWindow, onExposeAsRest, apex = null }: Props = $props();

  let search = $state("");
  let hiddenKinds = $state<Set<ObjectKind>>(new Set());
  let density = $state<"compact" | "comfortable">("compact");
  let showSystemSchemas = $state(false);
  let contextMenu = $state<{ x: number; y: number; owner: string; name: string; kind: ObjectKind } | null>(null);
  let apexExpanded = $state(false);
  let apexWorkspaces = $state<Loadable<ApexWorkspaceRow[]>>({ kind: "idle" });
  let openApexWorkspaces = $state<Set<string>>(new Set());
  let apexApplications = $state<Record<string, Loadable<ApexApplicationRow[]>>>({});
  let openApexApplications = $state<Set<number>>(new Set());
  let apexPages = $state<Record<number, Loadable<ApexPageRow[]>>>({});

  const VIRTUALIZE_THRESHOLD = 100;
  const ROW_HEIGHT = 24;
  const OVERSCAN = 10;
  const VIRT_VISIBLE_ROWS = 12;
  const VIRT_CONTAINER_H = VIRT_VISIBLE_ROWS * ROW_HEIGHT;

  const SYSTEM_SCHEMAS = new Set([
    "ANONYMOUS", "APPQOSYS", "AUDSYS", "CTXSYS", "DBSFWUSER", "DBSNMP",
    "DGPDB_INT", "DIP", "DVF", "DVSYS", "EXFSYS", "GGSHAREDCAP", "GGSYS",
    "GSMADMIN_INTERNAL", "GSMCATUSER", "GSMUSER", "LBACSYS", "MDDATA",
    "MDSYS", "MGMT_VIEW", "OJVMSYS", "OLAPSYS", "ORDDATA", "ORDPLUGINS",
    "ORDSYS", "OUTLN", "OWBSYS", "OWBSYS_AUDIT", "REMOTE_SCHEDULER_AGENT",
    "SI_INFORMTN_SCHEMA", "SYS", "SYSBACKUP", "SYSDG", "SYSKM", "SYSRAC",
    "SYSMAN", "SYSTEM", "WMSYS", "XDB", "XS$NULL",
  ]);

  const apexVisible = $derived(
    !!apex?.installed && !!apex.userHasAccess && !!apex.supported
  );

  const KIND_LABELS: Record<ObjectKind, string> = {
    TABLE: "Tables", VIEW: "Views", SEQUENCE: "Sequences",
    PROCEDURE: "Procedures", FUNCTION: "Functions",
    PACKAGE: "Packages", TRIGGER: "Triggers", TYPE: "Types",
    REST_MODULE: "REST Modules",
    MATERIALIZED_VIEW: "Materialized Views", SYNONYM: "Synonyms", DB_LINK: "DB Links",
    DIRECTORY: "Directories", QUEUE: "Queues", SCHEDULER_JOB: "Scheduler Jobs",
    DB_USER: "Users", PRIVILEGE: "Privileges",
  };


  function toggleKind(kind: ObjectKind) {
    const next = new Set(hiddenKinds);
    if (next.has(kind)) next.delete(kind);
    else next.add(kind);
    hiddenKinds = next;
  }

  const KIND_GROUPS: { label: string; kinds: ObjectKind[] }[] = [
    { label: "Data",        kinds: ["TABLE", "VIEW", "SEQUENCE", "MATERIALIZED_VIEW"] },
    { label: "Code",        kinds: ["PROCEDURE", "FUNCTION", "PACKAGE", "TRIGGER", "TYPE"] },
    { label: "Integration", kinds: ["REST_MODULE", "SYNONYM", "DB_LINK", "DIRECTORY", "QUEUE"] },
    { label: "Admin",       kinds: ["SCHEDULER_JOB", "DB_USER", "PRIVILEGE"] },
  ];

  const KIND_ORDER: ObjectKind[] = KIND_GROUPS.flatMap(g => g.kinds);

  const KIND_COLOR: Record<ObjectKind, string> = {
    TABLE: "#4a9eda", VIEW: "#4a9eda", SEQUENCE: "#4a9eda",
    PROCEDURE: "#e67e22", FUNCTION: "#e67e22", PACKAGE: "#e67e22", TRIGGER: "#e67e22", TYPE: "#e67e22",
    REST_MODULE: "#1a9ca6",
    MATERIALIZED_VIEW: "#4a9eda", SYNONYM: "#1a9ca6", DB_LINK: "#1a9ca6",
    DIRECTORY: "#1a9ca6", QUEUE: "#1a9ca6", SCHEDULER_JOB: "#9b59b6",
    DB_USER: "#9b59b6", PRIVILEGE: "#9b59b6",
  };

  const KIND_ICON: Record<ObjectKind, any> = {
    TABLE: Table, VIEW: Eye, SEQUENCE: Hash,
    PROCEDURE: Cog, FUNCTION: SquareFunction, PACKAGE: Package, TRIGGER: Zap, TYPE: FileType,
    REST_MODULE: Webhook,
    MATERIALIZED_VIEW: Database, SYNONYM: Link2, DB_LINK: Link2,
    DIRECTORY: Folder, QUEUE: Inbox, SCHEDULER_JOB: Clock,
    DB_USER: UserIcon, PRIVILEGE: Shield,
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

  const activeSchema = $derived(
    schemas.find(s => s.isCurrent && s.expanded) ??
    schemas.find(s => s.expanded) ??
    schemas.find(s => s.isCurrent)
  );

  let openKinds = $state<Set<string>>(new Set());

  function kindOpenKey(owner: string, kind: ObjectKind): string {
    return `${owner}::${kind}`;
  }

  function isKindOpen(owner: string, kind: ObjectKind, loadable: Loadable<Array<{ name: string; status?: string }>>, schemaExpanded: boolean): boolean {
    if (!schemaExpanded) return false;
    const key = kindOpenKey(owner, kind);
    return openKinds.has(key);
  }

  function handleKindToggle(owner: string, kind: ObjectKind, loadable: Loadable<Array<{ name: string; status?: string }>>, open: boolean) {
    const key = kindOpenKey(owner, kind);
    if (open) {
      openKinds.add(key);
      openKinds = new Set(openKinds);
      if (loadable.kind === "idle" && onKindExpand) {
        onKindExpand(owner, kind);
      }
    } else {
      openKinds.delete(key);
      openKinds = new Set(openKinds);
    }
  }

  let virtScrollTops = $state<Map<string, number>>(new Map());

  function virtKey(owner: string, kind: ObjectKind): string {
    return `${owner}::${kind}`;
  }

  function getScrollTop(owner: string, kind: ObjectKind): number {
    return virtScrollTops.get(virtKey(owner, kind)) ?? 0;
  }

  function setScrollTop(owner: string, kind: ObjectKind, v: number) {
    virtScrollTops.set(virtKey(owner, kind), v);
    virtScrollTops = new Map(virtScrollTops);
  }

  function virtSlice(total: number, scrollTop: number): { start: number; end: number; topPad: number; botPad: number } {
    if (total === 0) return { start: 0, end: 0, topPad: 0, botPad: 0 };
    const clampedTop = Math.max(0, Math.min(scrollTop, Math.max(0, (total - VIRT_VISIBLE_ROWS) * ROW_HEIGHT)));
    const start = Math.max(0, Math.floor(clampedTop / ROW_HEIGHT) - OVERSCAN);
    const end = Math.min(total, Math.ceil((clampedTop + VIRT_CONTAINER_H) / ROW_HEIGHT) + OVERSCAN);
    return { start, end, topPad: start * ROW_HEIGHT, botPad: (total - end) * ROW_HEIGHT };
  }

  async function loadApexWorkspaces(): Promise<void> {
    if (apexWorkspaces.kind === "loading" || apexWorkspaces.kind === "ok") return;
    apexWorkspaces = { kind: "loading" };
    const res = await apexWorkspacesList();
    if (!res.ok) {
      apexWorkspaces = { kind: "err", message: res.error.message };
      return;
    }
    apexWorkspaces = res.data.accessDenied
      ? { kind: "err", message: "APEX dictionary access denied" }
      : { kind: "ok", value: res.data.workspaces };
  }

  async function toggleApexRoot(): Promise<void> {
    apexExpanded = !apexExpanded;
    if (apexExpanded) await loadApexWorkspaces();
  }

  async function toggleApexWorkspace(workspace: string): Promise<void> {
    const next = new Set(openApexWorkspaces);
    if (next.has(workspace)) {
      next.delete(workspace);
      openApexWorkspaces = next;
      return;
    }
    next.add(workspace);
    openApexWorkspaces = next;
    if (apexApplications[workspace]?.kind === "ok" || apexApplications[workspace]?.kind === "loading") return;
    apexApplications = { ...apexApplications, [workspace]: { kind: "loading" } };
    const res = await apexApplicationsList(workspace);
    apexApplications = {
      ...apexApplications,
      [workspace]: !res.ok
        ? { kind: "err", message: res.error.message }
        : res.data.accessDenied
          ? { kind: "err", message: "APEX applications access denied" }
          : { kind: "ok", value: res.data.applications },
    };
  }

  async function toggleApexApplication(applicationId: number): Promise<void> {
    const next = new Set(openApexApplications);
    if (next.has(applicationId)) {
      next.delete(applicationId);
      openApexApplications = next;
      return;
    }
    next.add(applicationId);
    openApexApplications = next;
    if (apexPages[applicationId]?.kind === "ok" || apexPages[applicationId]?.kind === "loading") return;
    apexPages = { ...apexPages, [applicationId]: { kind: "loading" } };
    const res = await apexPagesList(applicationId);
    apexPages = {
      ...apexPages,
      [applicationId]: !res.ok
        ? { kind: "err", message: res.error.message }
        : res.data.accessDenied
          ? { kind: "err", message: "APEX pages access denied" }
          : { kind: "ok", value: res.data.pages },
    };
  }

  $effect(() => {
    const validOwners = new Set(schemas.map(s => s.name));
    for (const k of [...virtScrollTops.keys()]) {
      const [owner] = k.split("::");
      if (!validOwners.has(owner)) virtScrollTops.delete(k);
    }
    for (const k of [...openKinds]) {
      const [owner] = k.split("::");
      if (!validOwners.has(owner)) openKinds.delete(k);
    }
  });
</script>

<nav class="tree" class:comfortable={density === "comfortable"}>
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
    <button
      class="density-btn"
      class:active={density === "comfortable"}
      onclick={() => density = density === "compact" ? "comfortable" : "compact"}
      title={density === "compact" ? "Comfortable spacing" : "Compact spacing"}
      aria-pressed={density === "comfortable"}
    >⊞</button>
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

  <div class="kind-toolbar">
    <div class="toolbar-actions">
      <button class="toolbar-text-btn" onclick={() => hiddenKinds = new Set()}>All</button>
      <button class="toolbar-text-btn" onclick={() => hiddenKinds = new Set(KIND_ORDER)}>None</button>
    </div>
    {#each KIND_GROUPS as group}
      <div class="toolbar-row">
        <span class="toolbar-group-label">{group.label}</span>
        <div class="toolbar-icons">
          {#each group.kinds as kind}
            {@const isOff = hiddenKinds.has(kind)}
            {@const count = activeSchema?.kindCounts?.[kind]}
            {@const KindIcon = KIND_ICON[kind]}
            <button
              class="kind-icon-btn"
              class:off={isOff}
              style="--gc:{KIND_COLOR[kind]}"
              onclick={() => toggleKind(kind)}
              title={KIND_LABELS[kind] + (count !== undefined ? ` · ${count}` : "")}
              aria-label={"Filter: " + KIND_LABELS[kind] + (count !== undefined ? ` (${count})` : "") + (isOff ? ", disabled" : ", enabled")}
              aria-pressed={!isOff}
            >
              <KindIcon size={16} />
            </button>
          {/each}
        </div>
      </div>
    {/each}
  </div>

  {#if apexVisible}
    <div class="apex-block">
      <button
        class="schema-row apex-root"
        onclick={() => { void toggleApexRoot(); }}
        title="Oracle APEX"
      >
        <span class="chev" aria-hidden="true">{apexExpanded ? "â–¾" : "â–¸"}</span>
        <Boxes size={13} />
        <span class="schema-name">APEX {apex?.version ? `(${apex.version})` : ""}</span>
      </button>

      {#if apexExpanded}
        <div class="kinds apex-body">
          {#if apexWorkspaces.kind === "idle"}
            <div class="muted-row">â€”</div>
          {:else if apexWorkspaces.kind === "loading"}
            <div class="muted-row">loadingâ€¦</div>
          {:else if apexWorkspaces.kind === "err"}
            <div class="err-row">
              <span class="err-msg">{apexWorkspaces.message}</span>
              <button class="retry-btn" onclick={() => { apexWorkspaces = { kind: "idle" }; void loadApexWorkspaces(); }}>retry</button>
            </div>
          {:else}
            {#each apexWorkspaces.value as ws}
              <div class="apex-level">
                <button class="apex-row" onclick={() => { void toggleApexWorkspace(ws.workspace); }} title={ws.workspace}>
                  <span class="chev" aria-hidden="true">{openApexWorkspaces.has(ws.workspace) ? "â–¾" : "â–¸"}</span>
                  <span class="obj-name">{ws.workspace}</span>
                </button>
                {#if openApexWorkspaces.has(ws.workspace)}
                  {@const apps = apexApplications[ws.workspace] ?? { kind: "idle" }}
                  <div class="apex-children">
                    {#if apps.kind === "loading"}
                      <div class="muted-row">loading applicationsâ€¦</div>
                    {:else if apps.kind === "err"}
                      <div class="err-row"><span class="err-msg">{apps.message}</span></div>
                    {:else if apps.kind === "ok"}
                      {#each apps.value as app}
                        <div class="apex-level">
                          <button class="apex-row" onclick={() => { void toggleApexApplication(app.applicationId); }} title={`App ${app.applicationId} - ${app.name}`}>
                            <span class="chev" aria-hidden="true">{openApexApplications.has(app.applicationId) ? "â–¾" : "â–¸"}</span>
                            <span class="obj-name">{app.applicationId} - {app.name}</span>
                          </button>
                          {#if openApexApplications.has(app.applicationId)}
                            {@const pages = apexPages[app.applicationId] ?? { kind: "idle" }}
                            <div class="apex-children">
                              {#if pages.kind === "loading"}
                                <div class="muted-row">loading pagesâ€¦</div>
                              {:else if pages.kind === "err"}
                                <div class="err-row"><span class="err-msg">{pages.message}</span></div>
                              {:else if pages.kind === "ok"}
                                {#each pages.value as page}
                                  <div class="apex-leaf" title={`Page ${page.pageId} - ${page.name}`}>
                                    <span class="obj-name">p{page.pageId} - {page.name}</span>
                                  </div>
                                {:else}
                                  <div class="muted-row">â€” no pages â€”</div>
                                {/each}
                              {/if}
                            </div>
                          {/if}
                        </div>
                      {:else}
                        <div class="muted-row">â€” no applications â€”</div>
                      {/each}
                    {/if}
                  </div>
                {/if}
              </div>
            {:else}
              <div class="muted-row">â€” no workspaces â€”</div>
            {/each}
          {/if}
        </div>
      {/if}
    </div>
  {/if}

  {#each schemas as s}
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
              {#if kindVisible(loadable, passThrough) && !(loadable.kind === "ok" && filtered.length === 0)}
              <details
                class="kind"
                open={isKindOpen(s.name, kind, loadable, s.expanded)}
                ontoggle={(e) => handleKindToggle(s.name, kind, loadable, (e.currentTarget as HTMLDetailsElement).open)}
              >
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
                  {#if loadable.kind === "idle"}
                    <div class="muted-row">—</div>
                  {:else if loadable.kind === "loading"}
                    <div class="muted-row">loading…</div>
                  {:else if loadable.kind === "err"}
                    <div class="err-row">
                      <span class="err-msg">{loadable.message}</span>
                      <button class="retry-btn" onclick={() => onRetry(s.name, kind)}>retry</button>
                    </div>
                  {:else if loadable.kind === "ok"}
                    {#if filtered.length > VIRTUALIZE_THRESHOLD}
                      {@const st = getScrollTop(s.name, kind)}
                      {@const slice = virtSlice(filtered.length, st)}
                      <div
                        class="kind-virt"
                        onscroll={(e) => setScrollTop(s.name, kind, (e.currentTarget as HTMLDivElement).scrollTop)}
                      >
                        <div class="kind-virt-inner" style="height:{filtered.length * ROW_HEIGHT}px">
                          <div style="position:absolute;top:{slice.topPad}px;left:0;right:0">
                            {#each filtered.slice(slice.start, slice.end) as o}
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
                            {/each}
                          </div>
                        </div>
                      </div>
                    {:else}
                      {#each filtered as o}
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
          {contextMenu.kind === 'TABLE' || contextMenu.kind === 'VIEW' ? 'Expose as REST API…' : 'Expose as REST endpoint…'}
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
  .density-btn {
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 3px;
    color: var(--text-muted);
    font-size: 11px;
    line-height: 1;
    padding: 1px 4px;
    cursor: pointer;
    flex-shrink: 0;
    transition: color 0.12s, border-color 0.12s, background 0.12s;
  }
  .density-btn:hover { color: var(--text-secondary); border-color: var(--border-strong); }
  .density-btn.active {
    color: #7ec96a;
    border-color: rgba(126,201,106,0.35);
    background: rgba(126,201,106,0.08);
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

  /* ── Kind icon toolbar ───────────────────────────────────── */
  .kind-toolbar { padding: 0 0.6rem 0.5rem; display: flex; flex-direction: column; gap: 3px; }
  .toolbar-actions { display: flex; gap: 8px; margin-bottom: 1px; }
  .toolbar-text-btn { background: none; border: none; color: var(--text-muted); font-size: 10px; font-family: "Inter", sans-serif; font-weight: 500; cursor: pointer; padding: 0; transition: color 0.1s; }
  .toolbar-text-btn:hover { color: var(--text-primary); text-decoration: underline; }
  .toolbar-row { display: flex; align-items: center; gap: 4px; }
  .toolbar-group-label { font-size: 9px; color: var(--text-muted); font-family: "Inter", sans-serif; letter-spacing: 0.08em; text-transform: uppercase; width: 80px; flex-shrink: 0; }
  .toolbar-icons { display: flex; align-items: center; gap: 6px; }
  .kind-icon-btn { display: flex; align-items: center; justify-content: center; background: none; border: none; padding: 3px; border-radius: 3px; cursor: pointer; color: var(--gc); transition: background 0.1s, transform 0.08s, opacity 0.1s; outline: none; }
  .kind-icon-btn:hover { background: rgba(255, 255, 255, 0.05); }
  .kind-icon-btn:active { transform: scale(0.95); }
  .kind-icon-btn:focus-visible { outline: 1px solid var(--gc); outline-offset: 1px; }
  .kind-icon-btn.off { color: var(--text-muted); opacity: 0.3; }

  .apex-block {
    border-top: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
    margin: 0.15rem 0 0.4rem;
    padding: 0.2rem 0;
  }
  .apex-root { color: #7ec96a; }
  .apex-body { padding-left: 0.4rem; }
  .apex-level { min-width: 0; }
  .apex-row,
  .apex-leaf {
    width: 100%;
    min-height: 24px;
    display: flex;
    align-items: center;
    gap: 0.35rem;
    background: transparent;
    border: none;
    color: var(--text-secondary);
    font-family: "Inter", sans-serif;
    font-size: 11px;
    text-align: left;
    padding: 0.24rem 0.7rem 0.24rem 1rem;
    box-sizing: border-box;
  }
  .apex-row { cursor: pointer; }
  .apex-row:hover {
    background: var(--row-hover);
    color: var(--text-primary);
  }
  .apex-children {
    margin-left: 0.8rem;
    border-left: 1px solid rgba(255,255,255,0.06);
  }
  .apex-leaf { color: var(--text-muted); }

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
    padding: 0.25rem 0.7rem 0.25rem calc(1.4rem - 2px);
    border-left: 2px solid color-mix(in srgb, var(--kc) 35%, transparent);
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
  /* fixed height — nested virt containers make ResizeObserver impractical; 12 rows × 24px */
  .kind-virt {
    height: 288px;
    overflow-y: auto;
    overflow-x: hidden;
  }
  .kind-virt-inner {
    position: relative;
  }
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
    width: 100%;
    height: 24px;
    box-sizing: border-box;
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

  /* ── Density: comfortable ─────────────────────────────────── */
  .tree.comfortable .schema-row { padding: 0.55rem 0.7rem; }
  .tree.comfortable .kind-head { padding: 0.35rem 0.7rem 0.35rem calc(1.4rem - 2px); }
  .tree.comfortable .object { padding: 0.28rem 0.7rem 0.28rem 1.8rem; }
  .tree.comfortable .muted-row { padding: 0.18rem 0.7rem 0.18rem 1.8rem; }
  .tree.comfortable .err-row { padding: 0.22rem 0.7rem 0.22rem 1.8rem; }

  /* ── Cloud tier overrides ─────────────────────────────────── */
  :global([data-tier="cloud"]) .search:focus {
    border-color: rgba(43, 180, 238, 0.55);
  }
</style>
