<script lang="ts">
  import { page } from "$app/state";
  import { goto } from "$app/navigation";
  import { onMount } from "svelte";
  import StatusBar from "$lib/workspace/StatusBar.svelte";
  import SchemaTree, { type SchemaNode } from "$lib/workspace/SchemaTree.svelte";
  import ObjectDetails from "$lib/workspace/ObjectDetails.svelte";
  import SqlDrawer from "$lib/workspace/SqlDrawer.svelte";
  import CommandPalette from "$lib/workspace/CommandPalette.svelte";
  import SheepChat from "$lib/workspace/SheepChat.svelte";
  import { sqlEditor, addProcResults, activeResult } from "$lib/stores/sql-editor.svelte";
  import DashboardTab from "$lib/workspace/DashboardTab.svelte";
  import ProcExecModal from "$lib/workspace/ProcExecModal.svelte";
  import {
    workspaceOpen,
    workspaceClose,
    schemaList,
    objectsList,
    objectsListPlsql,
    objectDdlGet,
    objectDataflowGet,
    tableDescribe,
    tableRelated,
    schemaKindCounts,
    vectorTablesInSchema,
    SESSION_LOST,
    type WorkspaceInfo,
    type ObjectKind,
    type TableDetails,
    type TableRelated,
    type Loadable,
    type DataFlowResult,
  } from "$lib/workspace";
  import { getConnection, type ConnectionMeta } from "$lib/connections";
  import { theme } from "$lib/stores/theme.svelte";

  const PLSQL_KINDS: ObjectKind[] = ["PROCEDURE", "FUNCTION", "PACKAGE", "TRIGGER", "TYPE"];

  let meta     = $state<ConnectionMeta | null>(null);
  let info     = $state<WorkspaceInfo | null>(null);
  let schemas  = $state<SchemaNode[]>([]);
  let selected = $state<{ owner: string; name: string; kind: ObjectKind } | null>(null);
  let navHistory = $state<Array<{ owner: string; name: string; kind: ObjectKind }>>([]);
  let details  = $state<Loadable<TableDetails>>({ kind: "idle" });
  let fatal    = $state<string | null>(null);
  let sessionLost = $state(false);
  let showPalette = $state(false);
  let showChat = $state(false);
  let chatPendingMessage = $state("");
  let analyzePayload = $state<{
    sessionId: string;
    columns: { name: string; dataType: string }[];
    rows: unknown[][];
    sql: string;
  } | null>(null);
  let refreshing = $state(false);
  let procExecTarget = $state<{ owner: string; name: string; objectType: "PROCEDURE" | "FUNCTION" } | null>(null);
  let detailError = $state<string | null>(null);
  let dataflow = $state<DataFlowResult | null>(null);
  let dataflowLoading = $state(false);
  let dataflowError = $state<string | null>(null);
  let related = $state<Loadable<TableRelated>>({ kind: "idle" });
  let activeWsTab = $state<"schema" | "dashboard">("schema");

  // ── Panel resize (persisted) ─────────────────────────────────────────────────
  let schemaWidth = $state(Number(localStorage.getItem("veesker_schema_w") ?? 256));
  let chatWidth   = $state(Number(localStorage.getItem("veesker_chat_w") ?? 340));

  function makeHorizResizer(
    getStart: () => number,
    onUpdate: (w: number) => void,
    min: number,
    max: number,
    dir: 1 | -1 = 1
  ) {
    let startX = 0;
    let startW = 0;
    return {
      onpointerdown(e: PointerEvent) {
        const el = e.currentTarget as HTMLDivElement;
        el.setPointerCapture(e.pointerId);
        startX = e.clientX;
        startW = getStart();
      },
      onpointermove(e: PointerEvent) {
        const el = e.currentTarget as HTMLDivElement;
        if (!el.hasPointerCapture(e.pointerId)) return;
        const w = Math.max(min, Math.min(max, startW + dir * (e.clientX - startX)));
        onUpdate(w);
      },
      onpointerup(e: PointerEvent) {
        const el = e.currentTarget as HTMLDivElement;
        if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      },
    };
  }

  const schemaResizer = makeHorizResizer(() => schemaWidth, (w) => { schemaWidth = w; localStorage.setItem("veesker_schema_w", String(w)); }, 160, 480, 1);
  const chatResizer   = makeHorizResizer(() => chatWidth,   (w) => { chatWidth = w;   localStorage.setItem("veesker_chat_w",   String(w)); }, 240, 620, -1);

  function userLabel(m: ConnectionMeta): string {
    if (m.authType === "basic") {
      return `${m.username} @ ${m.host}:${m.port}/${m.serviceName}`;
    }
    return `${m.username} @ ${m.connectAlias}`;
  }

  function newSchemaNode(name: string, isCurrent: boolean): SchemaNode {
    return {
      name,
      isCurrent,
      expanded: isCurrent,
      kinds: {
        TABLE: { kind: "idle" },
        VIEW: { kind: "idle" },
        SEQUENCE: { kind: "idle" },
        PROCEDURE: { kind: "idle" },
        FUNCTION: { kind: "idle" },
        PACKAGE: { kind: "idle" },
        TRIGGER: { kind: "idle" },
        TYPE: { kind: "idle" },
      },
    };
  }

  async function loadKind(node: SchemaNode, kind: ObjectKind): Promise<void> {
    node.kinds[kind] = { kind: "loading" };
    schemas = [...schemas];
    if (PLSQL_KINDS.includes(kind)) {
      const res = await objectsListPlsql(node.name, kind);
      if (res.ok) {
        node.kinds[kind] = { kind: "ok", value: res.data };
      } else {
        if (res.error.code === SESSION_LOST) sessionLost = true;
        node.kinds[kind] = { kind: "err", message: res.error.message };
      }
    } else {
      const res = await objectsList(node.name, kind);
      if (res.ok) {
        node.kinds[kind] = { kind: "ok", value: res.data };
      } else {
        if (res.error.code === SESSION_LOST) sessionLost = true;
        node.kinds[kind] = { kind: "err", message: res.error.message };
      }
    }
    schemas = [...schemas];
  }

  function expandIfNeeded(node: SchemaNode): void {
    const kinds: ObjectKind[] = [
      "TABLE", "VIEW", "SEQUENCE",
      "PROCEDURE", "FUNCTION", "PACKAGE", "TRIGGER", "TYPE",
    ];
    void Promise.all(
      kinds
        .filter((k) => node.kinds[k]?.kind === "idle")
        .map((k) => loadKind(node, k))
    );
    if (!node.kindCounts) {
      void schemaKindCounts(node.name).then((res) => {
        if (res.ok) {
          node.kindCounts = res.data.counts;
          schemas = [...schemas];
        }
      });
    }
    if (!node.vectorTables) {
      void vectorTablesInSchema(node.name).then((res) => {
        if (res.ok) {
          node.vectorTables = new Set(res.data.columns.map((c) => c.tableName));
          schemas = [...schemas];
        }
      });
    }
  }

  function onToggle(owner: string): void {
    const node = schemas.find((s) => s.name === owner);
    if (!node) return;
    node.expanded = !node.expanded;
    schemas = [...schemas];
    if (node.expanded) expandIfNeeded(node);
  }

  function onRetryKind(owner: string, kind: ObjectKind): void {
    const node = schemas.find((s) => s.name === owner);
    if (!node) return;
    void loadKind(node, kind);
  }

  async function loadDataflow(owner: string, objectType: string, objectName: string): Promise<void> {
    dataflow = null;
    dataflowLoading = true;
    dataflowError = null;
    const res = await objectDataflowGet(owner, objectType, objectName);
    dataflowLoading = false;
    if (res.ok) {
      dataflow = res.data;
    } else {
      dataflowError = res.error.message;
    }
  }

  async function loadDetails(owner: string, name: string, kind: ObjectKind): Promise<void> {
    details = { kind: "loading" };
    related = { kind: "loading" };
    const [res, relRes] = await Promise.all([
      tableDescribe(owner, name),
      tableRelated(owner, name),
    ]);
    if (res.ok) {
      details = { kind: "ok", value: res.data };
    } else {
      if (res.error.code === SESSION_LOST) sessionLost = true;
      details = { kind: "err", message: res.error.message };
    }
    related = relRes.ok
      ? { kind: "ok", value: relRes.data }
      : { kind: "err", message: relRes.error.message };
    void loadDataflow(owner, kind, name);
  }

  function selectObject(owner: string, name: string, kind: ObjectKind): void {
    selected = { owner, name, kind };
    detailError = null;
    dataflow = null;
    dataflowLoading = false;
    dataflowError = null;
    related = { kind: "idle" };
    if (PLSQL_KINDS.includes(kind)) {
      details = { kind: "idle" };
      void (async () => {
        const res = await objectDdlGet(owner, kind, name);
        if (res.ok) {
          sqlEditor.openWithDdl(`${owner}.${name}`, res.data);
        } else {
          if (res.error.code === SESSION_LOST) {
            sessionLost = true;
          } else {
            detailError = `Failed to load DDL: ${res.error.message}`;
          }
        }
      })();
      void loadDataflow(owner, kind, name);
      return;
    }
    if (kind === "SEQUENCE") {
      details = { kind: "idle" };
      void loadDataflow(owner, kind, name);
      return;
    }
    void loadDetails(owner, name, kind);
  }

  function onSelect(owner: string, name: string, kind: ObjectKind): void {
    if (selected) navHistory = [...navHistory, { owner: selected.owner, name: selected.name, kind: selected.kind }];
    selectObject(owner, name, kind);
  }

  function onBack(): void {
    if (navHistory.length === 0) return;
    const prev = navHistory[navHistory.length - 1];
    navHistory = navHistory.slice(0, -1);
    selectObject(prev.owner, prev.name, prev.kind);
  }

  function onRetryDetails(): void {
    if (selected && selected.kind !== "SEQUENCE" && !PLSQL_KINDS.includes(selected.kind)) {
      void loadDetails(selected.owner, selected.name, selected.kind);
    }
  }

  async function bootstrap(): Promise<void> {
    fatal = null;
    sessionLost = false;
    const id = page.params.id!;

    const metaRes = await getConnection(id);
    if (!metaRes.ok) {
      fatal = `Could not load connection: ${metaRes.error.message}`;
      return;
    }
    meta = metaRes.data.meta;
    sqlEditor.setConnectionId(meta.id);

    const openRes = await workspaceOpen(id);
    if (!openRes.ok) {
      fatal = openRes.error.message;
      return;
    }
    info = openRes.data;

    const schemaRes = await schemaList();
    if (!schemaRes.ok) {
      fatal = schemaRes.error.message;
      return;
    }
    schemas = schemaRes.data.map((s) => newSchemaNode(s.name, s.isCurrent));
    const current = schemas.find((s) => s.isCurrent);
    if (current) expandIfNeeded(current);
  }

  async function onReconnect(): Promise<void> {
    sessionLost = false;
    await bootstrap();
    if (selected && selected.kind !== "SEQUENCE" && !PLSQL_KINDS.includes(selected.kind)) {
      await loadDetails(selected.owner, selected.name, selected.kind);
    }
  }

  async function onDisconnect(): Promise<void> {
    await workspaceClose();
    await goto("/");
  }

  async function onSwitchConnection(): Promise<void> {
    await workspaceClose();
    await goto("/");
  }

  async function refreshSchemas(): Promise<void> {
    if (refreshing) return;
    refreshing = true;
    try {
      const expandedNames = new Set(schemas.filter(s => s.expanded).map(s => s.name));
      const schemaRes = await schemaList();
      if (!schemaRes.ok) return;
      schemas = schemaRes.data.map((s) => newSchemaNode(s.name, s.isCurrent));
      for (const node of schemas) {
        if (expandedNames.has(node.name)) {
          node.expanded = true;
          expandIfNeeded(node);
        }
      }
      schemas = [...schemas];
    } finally {
      refreshing = false;
    }
  }

  function handleAnalyze() {
    const tab = sqlEditor.active;
    if (!tab) return;
    const ar = activeResult(tab);
    if (!ar?.result) return;
    analyzePayload = {
      sessionId: `${tab.id}-${Date.now()}`,
      columns: ar.result.columns,
      rows: ar.result.rows,
      sql: tab.sql,
    };
    showChat = true;
    Promise.resolve().then(() => { analyzePayload = null; });
  }

  function onKeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "i") {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      e.preventDefault();
      showChat = !showChat;
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      e.preventDefault();
      showPalette = true;
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "o") {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      e.preventDefault();
      void sqlEditor.openFromFile();
      return;
    }
    // Cmd+Shift+S → Save As; Cmd+S → Save (check Shift first — order matters)
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "s") {
      e.preventDefault();
      void sqlEditor.saveAsActive();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "s") {
      e.preventDefault();
      void sqlEditor.saveActive();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
      e.preventDefault();
      sqlEditor.toggleDrawer();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "e") {
      e.preventDefault();
      if (!sqlEditor.drawerOpen) sqlEditor.toggleDrawer();
      sqlEditor.toggleEditorExpanded();
      return;
    }
    // Cmd+W (or Ctrl+W) closes the active SQL tab when the drawer is open
    // and a tab is focused. Falls through to the OS / window when no tab.
    if (
      (e.metaKey || e.ctrlKey) &&
      e.key.toLowerCase() === "w" &&
      sqlEditor.drawerOpen &&
      sqlEditor.activeId !== null
    ) {
      e.preventDefault();
      sqlEditor.closeTab(sqlEditor.activeId);
    }
    // Cmd+. (or Ctrl+.) cancels an in-flight query.
    if (
      (e.metaKey || e.ctrlKey) &&
      e.key === "." &&
      sqlEditor.drawerOpen &&
      sqlEditor.active !== null &&
      sqlEditor.active.runningRequestId !== null
    ) {
      e.preventDefault();
      void sqlEditor.cancelActive();
    }
  }

  onMount(() => {
    void bootstrap();
    window.addEventListener("keydown", onKeydown);
    return () => {
      window.removeEventListener("keydown", onKeydown);
      sqlEditor.reset();
      void workspaceClose();
    };
  });
</script>


{#if fatal}
  <main class="fatal">
    <div class="card">
      <strong>Failed to open workspace.</strong>
      <span>{fatal}</span>
      <button onclick={() => goto("/")}>Back to connections</button>
    </div>
  </main>
{:else if !meta || !info}
  <main class="loading">Loading workspace…</main>
{:else}
  <div class="shell">
    <StatusBar
      connectionName={meta.name}
      userLabel={userLabel(meta)}
      schema={info.currentSchema}
      serverVersion={info.serverVersion}
      hasPendingTx={sqlEditor.pendingTx}
      chatOpen={showChat}
      onToggleChat={() => showChat = !showChat}
      onDisconnect={onDisconnect}
      onSwitchConnection={onSwitchConnection}
      theme={theme.current}
      onToggleTheme={() => theme.toggle()}
    />
    <div class="body" class:body-collapsed={sqlEditor.editorExpanded}>
      <div class="panel-wrap" style="width: {schemaWidth}px; min-width: 160px; max-width: 480px;">
        <SchemaTree
          {schemas}
          {selected}
          onToggle={onToggle}
          onSelect={onSelect}
          onRetry={onRetryKind}
          onRefresh={refreshSchemas}
          {refreshing}
          onExecuteProc={(owner, name, objectType) => {
            procExecTarget = { owner, name, objectType };
          }}
        />
      </div>
      <div
        class="resize-handle"
        role="separator"
        aria-orientation="vertical"
        tabindex="-1"
        onpointerdown={schemaResizer.onpointerdown}
        onpointermove={schemaResizer.onpointermove}
        onpointerup={schemaResizer.onpointerup}
        onpointercancel={schemaResizer.onpointerup}
      ></div>
      <div class="main-panel">
        <div class="ws-tab-bar">
          <button
            class="ws-tab"
            class:active={activeWsTab === "schema"}
            onclick={() => (activeWsTab = "schema")}
          >Schema</button>
          <button
            class="ws-tab"
            class:active={activeWsTab === "dashboard"}
            onclick={() => (activeWsTab = "dashboard")}
          >📊 Dashboard</button>
        </div>
        {#if activeWsTab === "schema"}
          <ObjectDetails
            {selected}
            {details}
            {related}
            onRetry={onRetryDetails}
            onReconnect={onReconnect}
            sessionLost={sessionLost}
            detailError={detailError}
            dataflow={dataflow}
            dataflowLoading={dataflowLoading}
            dataflowError={dataflowError}
            canGoBack={navHistory.length > 0}
            backLabel={navHistory.length > 0 ? navHistory[navHistory.length - 1].name : undefined}
            onBack={onBack}
            onNavigateDataflow={(owner, objectType, name) => onSelect(owner, name, objectType as ObjectKind)}
            onNavigate={(owner, kind, name) => onSelect(owner, name, kind as ObjectKind)}
            onViewDdl={async (owner, kind, name) => {
              const res = await objectDdlGet(owner, kind as any, name);
              if (res.ok) sqlEditor.openWithDdl(`${owner}.${name}`, res.data);
              else if (res.error.code === SESSION_LOST) sessionLost = true;
            }}
          />
        {/if}
        {#if activeWsTab === "dashboard"}
          <DashboardTab />
        {/if}
      </div>
      {#if showChat}
        <div
          class="resize-handle"
          role="separator"
          aria-orientation="vertical"
          tabindex="-1"
          onpointerdown={chatResizer.onpointerdown}
          onpointermove={chatResizer.onpointermove}
          onpointerup={chatResizer.onpointerup}
          onpointercancel={chatResizer.onpointerup}
        ></div>
        <div class="panel-wrap" style="width: {chatWidth}px; min-width: 240px; max-width: 620px;">
          <SheepChat
            context={{
              currentSchema: info.currentSchema,
              selectedOwner: selected?.owner,
              selectedName: selected?.name,
              selectedKind: selected?.kind,
              activeSql: sqlEditor.active?.sql ?? undefined,
            }}
            onClose={() => showChat = false}
            pendingMessage={chatPendingMessage}
            {analyzePayload}
            onChartAdded={() => { activeWsTab = "dashboard"; }}
          />
        </div>
      {/if}
    </div>
    <SqlDrawer
      onCancel={() => void sqlEditor.cancelActive()}
      onExplainWithAI={(msg) => {
        chatPendingMessage = msg;
        showChat = true;
        Promise.resolve().then(() => { chatPendingMessage = ""; });
      }}
      onAnalyze={handleAnalyze}
    />
  </div>
  {#if showPalette}
    <CommandPalette
      onSelect={(owner, name, kind) => { showPalette = false; onSelect(owner, name, kind); }}
      onClose={() => showPalette = false}
    />
  {/if}
  {#if procExecTarget}
    <ProcExecModal
      owner={procExecTarget.owner}
      name={procExecTarget.name}
      objectType={procExecTarget.objectType}
      onClose={() => (procExecTarget = null)}
      onResult={(result) => {
        addProcResults(result);
        procExecTarget = null;
      }}
    />
  {/if}
{/if}

<style>
  :global(body) {
    margin: 0;
    background: #18140f;
    color: var(--text-primary);
    font-family: "Inter", -apple-system, system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .shell {
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
  }
  .body {
    display: flex;
    flex: 1;
    min-height: 0;
    background: var(--bg-page);
    overflow: hidden;
    transition: flex 0.18s ease;
  }
  .body-collapsed {
    flex: 0 0 0px !important;
    overflow: hidden;
    min-height: 0 !important;
  }
  .panel-wrap {
    flex-shrink: 0;
    min-width: 0;
    overflow: hidden;
    height: 100%;
  }
  .resize-handle {
    width: 4px;
    flex-shrink: 0;
    cursor: col-resize;
    background: transparent;
    position: relative;
    z-index: 10;
    transition: background 0.15s;
    user-select: none;
  }
  .resize-handle:hover,
  .resize-handle:active {
    background: rgba(179, 62, 31, 0.5);
  }
  .fatal {
    max-width: 480px;
    margin: 4rem auto;
    padding: 0 2rem;
  }
  .fatal .card {
    background: rgba(179, 62, 31, 0.08);
    color: #7a2a14;
    border: 1px solid rgba(179, 62, 31, 0.3);
    padding: 1rem;
    border-radius: 6px;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .fatal button {
    align-self: flex-start;
    background: var(--text-primary);
    color: var(--bg-surface);
    border: none;
    padding: 0.55rem 0.9rem;
    border-radius: 4px;
    font-family: "Space Grotesk", sans-serif;
    cursor: pointer;
  }
  .loading {
    max-width: 480px;
    margin: 4rem auto;
    color: var(--text-muted);
    font-size: 13px;
  }
  .main-panel {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .ws-tab-bar {
    display: flex;
    gap: 0;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    background: var(--bg-surface);
  }
  .ws-tab {
    font-size: 11px;
    padding: 5px 12px;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--text-muted);
    cursor: pointer;
    margin-bottom: -1px;
  }
  .ws-tab:hover {
    color: var(--text-primary);
  }
  .ws-tab.active {
    color: var(--text-primary);
    border-bottom-color: rgba(179, 62, 31, 0.7);
  }
</style>
