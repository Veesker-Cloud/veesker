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
    tableDescribe,
    SESSION_LOST,
    type WorkspaceInfo,
    type ObjectKind,
    type TableDetails,
    type Loadable,
  } from "$lib/workspace";
  import { getConnection, type ConnectionMeta } from "$lib/connections";

  let meta     = $state<ConnectionMeta | null>(null);
  let info     = $state<WorkspaceInfo | null>(null);
  let schemas  = $state<SchemaNode[]>([]);
  let selected = $state<{ owner: string; name: string; kind: ObjectKind } | null>(null);
  let details  = $state<Loadable<TableDetails>>({ kind: "idle" });
  let fatal    = $state<string | null>(null);
  let sessionLost = $state(false);

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
      },
    };
  }

  async function loadKind(node: SchemaNode, kind: ObjectKind): Promise<void> {
    node.kinds[kind] = { kind: "loading" };
    schemas = [...schemas];
    const res = await objectsList(node.name, kind);
    if (res.ok) {
      node.kinds[kind] = { kind: "ok", value: res.data };
    } else {
      if (res.error.code === SESSION_LOST) sessionLost = true;
      node.kinds[kind] = { kind: "err", message: res.error.message };
    }
    schemas = [...schemas];
  }

  function expandIfNeeded(node: SchemaNode): void {
    const kinds: ObjectKind[] = ["TABLE", "VIEW", "SEQUENCE"];
    void Promise.all(
      kinds
        .filter((k) => node.kinds[k].kind === "idle")
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

  async function loadDetails(owner: string, name: string): Promise<void> {
    details = { kind: "loading" };
    const res = await tableDescribe(owner, name);
    if (res.ok) {
      details = { kind: "ok", value: res.data };
    } else {
      if (res.error.code === SESSION_LOST) sessionLost = true;
      details = { kind: "err", message: res.error.message };
    }
  }

  function onSelect(owner: string, name: string, kind: ObjectKind): void {
    selected = { owner, name, kind };
    if (kind === "SEQUENCE") {
      details = { kind: "idle" };
      return;
    }
    void loadDetails(owner, name);
  }

  function onRetryDetails(): void {
    if (selected && selected.kind !== "SEQUENCE") {
      void loadDetails(selected.owner, selected.name);
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
    if (selected && selected.kind !== "SEQUENCE") {
      await loadDetails(selected.owner, selected.name);
    }
  }

  async function onDisconnect(): Promise<void> {
    await workspaceClose();
    await goto("/");
  }

  function onKeydown(e: KeyboardEvent) {
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
      />
    </div>
    <SqlDrawer />
  </div>
{/if}

<style>
  :global(body) {
    margin: 0;
    background: #f6f1e8;
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
