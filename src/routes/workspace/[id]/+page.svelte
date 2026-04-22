<script lang="ts">
  import { page } from "$app/state";
  import { goto } from "$app/navigation";
  import { onMount } from "svelte";
  import StatusBar from "$lib/workspace/StatusBar.svelte";
  import SchemaTree, { type SchemaNode } from "$lib/workspace/SchemaTree.svelte";
  import ObjectDetails from "$lib/workspace/ObjectDetails.svelte";
  import SqlDrawer from "$lib/workspace/SqlDrawer.svelte";
  import { sqlEditor } from "$lib/stores/sql-editor.svelte";
  import {
    workspaceOpen,
    workspaceClose,
    schemaList,
    objectsList,
    objectsListPlsql,
    objectDdlGet,
    objectDataflowGet,
    tableDescribe,
    SESSION_LOST,
    type WorkspaceInfo,
    type ObjectKind,
    type TableDetails,
    type Loadable,
    type DataFlowResult,
  } from "$lib/workspace";
  import { getConnection, type ConnectionMeta } from "$lib/connections";

  const PLSQL_KINDS: ObjectKind[] = ["PROCEDURE", "FUNCTION", "PACKAGE", "TRIGGER", "TYPE"];

  let meta     = $state<ConnectionMeta | null>(null);
  let info     = $state<WorkspaceInfo | null>(null);
  let schemas  = $state<SchemaNode[]>([]);
  let selected = $state<{ owner: string; name: string; kind: ObjectKind } | null>(null);
  let details  = $state<Loadable<TableDetails>>({ kind: "idle" });
  let fatal    = $state<string | null>(null);
  let sessionLost = $state(false);
  let detailError = $state<string | null>(null);
  let dataflow = $state<DataFlowResult | null>(null);
  let dataflowLoading = $state(false);
  let dataflowError = $state<string | null>(null);

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
    const res = await tableDescribe(owner, name);
    if (res.ok) {
      details = { kind: "ok", value: res.data };
    } else {
      if (res.error.code === SESSION_LOST) sessionLost = true;
      details = { kind: "err", message: res.error.message };
    }
    void loadDataflow(owner, kind, name);
  }

  function onSelect(owner: string, name: string, kind: ObjectKind): void {
    selected = { owner, name, kind };
    detailError = null;
    dataflow = null;
    dataflowLoading = false;
    dataflowError = null;
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

  function onKeydown(e: KeyboardEvent) {
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

<svelte:head>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
  <link
    href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&family=Inter:wght@400;500;600&display=swap"
    rel="stylesheet"
  />
</svelte:head>

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
      onDisconnect={onDisconnect}
    />
    <div class="body">
      <SchemaTree
        {schemas}
        {selected}
        onToggle={onToggle}
        onSelect={onSelect}
        onRetry={onRetryKind}
      />
      <ObjectDetails
        {selected}
        {details}
        onRetry={onRetryDetails}
        onReconnect={onReconnect}
        sessionLost={sessionLost}
        detailError={detailError}
        dataflow={dataflow}
        dataflowLoading={dataflowLoading}
        dataflowError={dataflowError}
        onNavigateDataflow={(owner, objectType, name) => onSelect(owner, name, objectType as ObjectKind)}
      />
    </div>
    <SqlDrawer />
  </div>
{/if}

<style>
  :global(body) {
    margin: 0;
    background: #18140f;
    color: #1a1612;
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
    background: #faf7f2;
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
    background: #1a1612;
    color: #f6f1e8;
    border: none;
    padding: 0.55rem 0.9rem;
    border-radius: 4px;
    font-family: "Space Grotesk", sans-serif;
    cursor: pointer;
  }
  .loading {
    max-width: 480px;
    margin: 4rem auto;
    color: rgba(26, 22, 18, 0.5);
    font-size: 13px;
  }
</style>
