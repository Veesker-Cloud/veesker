<!--
  Copyright 2022-2026 Geraldo Ferreira Viana Júnior
  Licensed under the Apache License, Version 2.0
  https://github.com/veesker-cloud/veesker-community-edition
-->

<script lang="ts">
  import { page } from "$app/state";
  import { goto } from "$app/navigation";
  import { onMount, onDestroy, getContext } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { listen, type UnlistenFn } from "@tauri-apps/api/event";
  import StatusBar from "$lib/workspace/StatusBar.svelte";
  import SchemaTree, { type SchemaNode } from "$lib/workspace/SchemaTree.svelte";
  import ObjectDetails from "$lib/workspace/ObjectDetails.svelte";
  import RestModuleDetails from "$lib/workspace/RestModuleDetails.svelte";
  import RestApiBuilder, { type BuilderConfig } from "$lib/workspace/RestApiBuilder.svelte";
  import RestApiPreview from "$lib/workspace/RestApiPreview.svelte";
  import RestTestPanel from "$lib/workspace/RestTestPanel.svelte";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import SqlDrawer from "$lib/workspace/SqlDrawer.svelte";
  import CommandPalette from "$lib/workspace/CommandPalette.svelte";
  import SheepChat from "$lib/workspace/SheepChat.svelte";
  import { sqlEditor, addProcResults, activeResult } from "$lib/stores/sql-editor.svelte";
  import DashboardTab from "$lib/workspace/DashboardTab.svelte";
  import ProcExecModal from "$lib/workspace/ProcExecModal.svelte";
  import TestWindow from "$lib/workspace/TestWindow.svelte";
  import { debugStore } from "$lib/stores/debug.svelte";
  import {
    tableRelated,
    schemaKindCounts,
    vectorTablesInSchema,
    ordsModulesList,
    ordsGenerateSql,
    ordsApply,
    ordsEnableSchema,
    ordsModuleExportSql,
    SESSION_LOST,
    type WorkspaceInfo,
    type ObjectKind,
    type TableDetails,
    type TableRelated,
    type Loadable,
    type DataFlowResult,
  } from "$lib/workspace";
  import type { WorkspaceSource, SourceError } from "$lib/workspace/sources/types";
  import { SandboxWorkspaceSource } from "$lib/workspace/sources/sandbox";
  import { getConnection, type ConnectionMeta } from "$lib/connections";
  import { theme } from "$lib/stores/theme.svelte";
  import { ordsStore } from "$lib/stores/ords.svelte";
  import OrdsBootstrapModal from "$lib/workspace/OrdsBootstrapModal.svelte";
  import OAuthClientsPanel from "$lib/workspace/OAuthClientsPanel.svelte";
  import AiApprovalModal from "$lib/workspace/AiApprovalModal.svelte";
  import FetchProgressBar from "$lib/workspace/FetchProgressBar.svelte";
  import { fetchProgress } from "$lib/stores/fetch-progress.svelte";
  import { aiApproval } from "$lib/stores/ai-approval.svelte";
  import { objectVersionCapture } from "$lib/object-versions";
  import { logout } from "$lib/services/auth";
  import { FEATURES } from "$lib/services/features";
  import LoginModal from "$lib/workspace/LoginModal.svelte";
  import AuditLogPanel from "$lib/workspace/AuditLogPanel.svelte";
  import OperationsPanel from "$lib/workspace/OperationsPanel.svelte";
  import { operationsPanel } from "$lib/stores/operations-panel.svelte";
  import { sandboxes } from "$lib/stores/sandboxes.svelte";
  import { toasts } from "$lib/stores/toasts.svelte";
  import { envTheme } from "$lib/workspace/EnvTheme.svelte";

  const authCtx = getContext<{ tier: "ce" | "cloud"; email: string }>("auth");

  let { data }: { data: { source: WorkspaceSource } } = $props();
  const source = $derived(data.source);

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
    owner: string | null;
    objectName: string | null;
    objectType: string | null;
  } | null>(null);
  let refreshing = $state(false);
  let completionSchema = $state<Record<string, string[]>>({});
  let colCache = new Map<string, string[]>();
  let txActionInFlight = $state(false);

  const schemaSnapshot = $derived((() => {
    const current = schemas.find((s) => s.isCurrent);
    if (!current) return undefined;
    const lines: string[] = [`Schema: ${current.name}`];
    for (const [kind, loadable] of Object.entries(current.kinds)) {
      if (loadable?.kind === "ok" && loadable.value.length > 0) {
        lines.push(`${kind}: ${loadable.value.map((o) => o.name).join(", ")}`);
      }
    }
    return lines.length > 1 ? lines.join("\n") : undefined;
  })());

  async function getColumns(table: string, owner: string | null = null): Promise<string[]> {
    const effectiveOwner = owner ?? schemas.find((s) => s.isCurrent)?.name ?? null;
    if (!effectiveOwner) return [];
    const cacheKey = `${effectiveOwner}.${table}`;
    if (colCache.has(cacheKey)) return colCache.get(cacheKey)!;
    let cols: string[] = [];
    try {
      const td = await source.describeTable(effectiveOwner, table);
      cols = td.columns.map((c) => c.name);
    } catch {
      cols = [];
    }
    colCache.set(cacheKey, cols);
    return cols;
  }
  let procExecTarget = $state<{ owner: string; name: string; objectType: "PROCEDURE" | "FUNCTION" } | null>(null);
  let detailError = $state<string | null>(null);
  let dataflow = $state<DataFlowResult | null>(null);
  let dataflowLoading = $state(false);
  let dataflowError = $state<string | null>(null);
  let related = $state<Loadable<TableRelated>>({ kind: "idle" });
  let activeWsTab = $state<"schema" | "dashboard">("schema");

  // Sandbox sources don't expose a Dashboard tab (capabilities.tabs = ["schema"]).
  // If a previous Oracle session left activeWsTab on "dashboard", bring it back
  // to "schema" before the dashboard button gating hides it for the sandbox.
  $effect(() => {
    if (!source.capabilities.tabs.includes(activeWsTab)) {
      activeWsTab = "schema";
    }
  });

  $effect(() => {
    envTheme.setFromEnv(meta?.env);
  });
  let ddlLoading = $state<{ owner: string; name: string } | null>(null);
  let testWindowOpen = $state(false);
  let showOrdsBootstrap = $state(false);
  let showApiBuilder = $state(false);
  let apiBuilderInitial = $state<{ kind: "table" | "view" | "procedure" | "function"; obj: { owner: string; name: string } } | null>(null);
  let previewSql = $state<string | null>(null);
  let testPanelOpen = $state<{ basePath: string } | null>(null);
  let showOAuthPanel = $state(false);
  let showLogin = $state(false);
  let showAuditLog = $state(false);

  // ── Panel resize (persisted) ─────────────────────────────────────────────────
  function loadPanelWidth(key: string, def: number): number {
    const n = Number(localStorage.getItem(key));
    return Number.isFinite(n) && n > 0 ? n : def;
  }
  let schemaWidth = $state(loadPanelWidth("veesker_schema_w", 256));
  let chatWidth   = $state(loadPanelWidth("veesker_chat_w", 340));

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
        REST_MODULE: { kind: "idle" },
      },
    };
  }

  async function loadKind(node: SchemaNode, kind: ObjectKind): Promise<void> {
    node.kinds[kind] = { kind: "loading" };
    if (kind === "REST_MODULE") {
      const res = await ordsModulesList(node.name);
      if (res.ok) {
        node.kinds[kind] = { kind: "ok", value: res.data.map((m) => ({ name: m.name })) };
      } else {
        if (res.error.code === SESSION_LOST) sessionLost = true;
        node.kinds[kind] = { kind: "err", message: res.error.message };
      }
    } else {
      try {
        const data = await source.listObjects(node.name, kind);
        node.kinds[kind] = { kind: "ok", value: data };
      } catch (e) {
        const err = e as SourceError;
        if (err?.code === SESSION_LOST) sessionLost = true;
        node.kinds[kind] = { kind: "err", message: err?.message ?? String(e) };
      }
    }
  }

  function expandIfNeeded(node: SchemaNode): void {
    const kinds: ObjectKind[] = [
      "TABLE", "VIEW", "SEQUENCE",
      "PROCEDURE", "FUNCTION", "PACKAGE", "TRIGGER", "TYPE",
      "REST_MODULE",
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
        }
      });
    }
    if (!node.vectorTables) {
      void vectorTablesInSchema(node.name).then((res) => {
        if (res.ok) {
          node.vectorTables = new Set(res.data.columns.map((c) => c.tableName));
        }
      });
    }
  }

  function onToggle(owner: string): void {
    const node = schemas.find((s) => s.name === owner);
    if (!node) return;
    node.expanded = !node.expanded;
    if (node.expanded) expandIfNeeded(node);
  }

  function onKindExpand(owner: string, kind: ObjectKind): void {
    const node = schemas.find((s) => s.name === owner);
    if (!node) return;
    if (node.kinds[kind]?.kind === "idle") {
      void loadKind(node, kind);
    }
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
    const res = await source.loadDataflow(owner, objectName, objectType as ObjectKind);
    dataflowLoading = false;
    if (res.kind === "ok") {
      dataflow = res.data;
    } else if (res.kind === "unsupported") {
      dataflow = null;
      dataflowError = null;
    } else {
      dataflowError = res.error;
    }
  }

  async function loadDetails(owner: string, name: string, kind: ObjectKind): Promise<void> {
    details = { kind: "loading" };
    related = { kind: "loading" };
    const [descSettled, relRes] = await Promise.all([
      source.describeTable(owner, name).then(
        (data) => ({ ok: true as const, data }),
        (e) => ({ ok: false as const, err: e as SourceError }),
      ),
      tableRelated(owner, name),
    ]);
    if (descSettled.ok) {
      details = { kind: "ok", value: descSettled.data };
    } else {
      if (descSettled.err?.code === SESSION_LOST) sessionLost = true;
      details = { kind: "err", message: descSettled.err?.message ?? String(descSettled.err) };
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
      ddlLoading = { owner, name };
      void (async () => {
        const res = await source.loadDdl(owner, name, kind);
        if (ddlLoading?.owner === owner && ddlLoading?.name === name) ddlLoading = null;
        if (res.kind === "ok") {
          const connId = page.params.id!;
          if (kind === "PACKAGE" && res.spec && res.body) {
            sqlEditor.openWithDdl(`${owner}.${name}`, res.body, {
              connectionId: connId,
              owner,
              objectType: "PACKAGE BODY",
              objectName: name,
            });
            const activeTab = sqlEditor.active;
            if (activeTab) {
              sqlEditor.setPackageSpec(activeTab.id, res.spec, {
                connectionId: connId,
                owner,
                objectType: "PACKAGE",
                objectName: name,
              });
            }
            void objectVersionCapture(connId, owner, "PACKAGE", name, res.spec, "baseline");
            void objectVersionCapture(connId, owner, "PACKAGE BODY", name, res.body, "baseline");
          } else {
            sqlEditor.openWithDdl(`${owner}.${name}`, res.ddl, {
              connectionId: connId,
              owner,
              objectType: kind,
              objectName: name,
            });
            void objectVersionCapture(connId, owner, kind, name, res.ddl, "baseline");
          }
        } else if (res.kind === "unsupported") {
          detailError = "DDL not available for this source";
        } else {
          if (res.code === SESSION_LOST) {
            sessionLost = true;
          } else if (/ORA-31603/.test(res.error)) {
            detailError = `DDL not available for ${owner}.${name} — Oracle built-in objects cannot be exported via DBMS_METADATA.`;
          } else {
            detailError = `Failed to load DDL: ${res.error}`;
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
    if (kind === "REST_MODULE") {
      details = { kind: "idle" };
      return;
    }
    void loadDetails(owner, name, kind);
  }

  function onSelect(owner: string, name: string, kind: ObjectKind): void {
    if (selected) navHistory = [...navHistory, { owner: selected.owner, name: selected.name, kind: selected.kind }];
    selectObject(owner, name, kind);
  }

  // Hold the last config used for preview so we can pass it (not the SQL string)
  // to ordsApply — server regenerates SQL from the config to prevent the renderer
  // from submitting a different/modified PL/SQL block than what was previewed.
  let previewConfig: BuilderConfig | null = $state(null);

  async function handleBuilderPreview(config: BuilderConfig) {
    const res = await ordsGenerateSql(config as unknown as Record<string, unknown>);
    if (res.ok) {
      previewSql = res.data.sql;
      previewConfig = config;
    } else {
      toasts.error("Failed to generate SQL: " + res.error.message);
    }
  }

  async function handlePreviewApply(): Promise<void> {
    if (!previewConfig) return;
    const res = await ordsApply(previewConfig as unknown as Record<string, unknown>);
    if (!res.ok) {
      throw new Error(res.error.message);
    }
    const current = schemas.find((s) => s.isCurrent);
    if (current) await loadKind(current, "REST_MODULE");
    previewSql = null;
    previewConfig = null;
    showApiBuilder = false;
    apiBuilderInitial = null;
  }

  function handleCopyToTab() {
    if (!previewSql) return;
    sqlEditor.openWithDdl("VRAS Generated", previewSql);
    previewSql = null;
    showApiBuilder = false;
    apiBuilderInitial = null;
  }

  function openApiBuilder(initial: typeof apiBuilderInitial = null) {
    apiBuilderInitial = initial;
    showApiBuilder = true;
  }

  async function onTestWindow(owner: string, name: string, kind: ObjectKind) {
    testWindowOpen = true;
    await debugStore.open(owner, name, kind, kind === "PACKAGE" ? name : null);
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
    colCache.clear();
    const id = page.params.id!;

    // Oracle-only metadata lookup. Sandbox sources don't have a row in the
    // connection store — Plan 12 routes them through the source strategy
    // directly. Skip getConnection + sqlEditor.setConnectionContext + ords
    // wiring when the source isn't an Oracle connection.
    if (source.meta.kind === "oracle") {
      const metaRes = await getConnection(id);
      if (!metaRes.ok) {
        fatal = `Could not load connection: ${metaRes.error.message}`;
        return;
      }
      meta = metaRes.data.meta;
      const hostOrAlias = meta.authType === "basic" ? meta.host : meta.connectAlias;
      // PROD-002 (audit 2026-04-30): forward env so the audit uploader can
      // switch to metadata-only mode automatically for prod-tagged connections.
      // L3.2 (Onda 3): forward autoExplainMode so runActive can decide whether
      // to fire EXPLAIN PLAN in parallel with the user's statement.
      sqlEditor.setConnectionContext(
        meta.id,
        meta.name,
        meta.username,
        hostOrAlias,
        meta.env ?? null,
        meta.autoExplainMode ?? "always",
      );
    } else {
      // Sandbox path: no Oracle connection meta. Set a minimal sql editor
      // context so audit log + status bar render the sandbox identity.
      sqlEditor.setConnectionContext(source.meta.id, source.meta.displayName, "", "", null);
    }

    const openRes = await source.open();
    if (!openRes.ok) {
      fatal = openRes.error;
      return;
    }
    if (openRes.info) info = openRes.info;

    try {
      schemas = await source.listSchemas();
    } catch (e) {
      fatal = (e as SourceError)?.message ?? String(e);
      return;
    }
    const current = schemas.find((s) => s.isCurrent);
    if (current) expandIfNeeded(current);
    if (source.meta.kind === "oracle" && meta) {
      ordsStore.setConnectionId(meta.id);
      void ordsStore.refresh().then(() => {
        const s = ordsStore.state;
        if (!s) return;
        if (!s.installed || !s.userHasAccess || !s.currentSchemaEnabled || !s.hasAdminRole || !s.ordsBaseUrl) {
          showOrdsBootstrap = true;
        }
      });
    }

    if (current) {
      const [tablesSettled, viewsSettled] = await Promise.allSettled([
        source.listObjects(current.name, "TABLE"),
        source.listObjects(current.name, "VIEW"),
      ]);
      const schema: Record<string, string[]> = {};
      if (tablesSettled.status === "fulfilled")
        for (const t of tablesSettled.value) schema[t.name] = [];
      if (viewsSettled.status === "fulfilled")
        for (const v of viewsSettled.value) schema[v.name] = [];
      completionSchema = schema;
    }
  }

  async function onReconnect(): Promise<void> {
    sessionLost = false;
    await bootstrap();
    if (selected && selected.kind !== "SEQUENCE" && !PLSQL_KINDS.includes(selected.kind)) {
      await loadDetails(selected.owner, selected.name, selected.kind);
    }
  }

  async function handleLogout(): Promise<void> {
    await logout();
    authCtx.tier = "ce";
    authCtx.email = "";
  }

  async function onDisconnect(): Promise<void> {
    await source.close();
    await goto("/");
  }

  async function onSwitchConnection(): Promise<void> {
    await source.close();
    await goto("/");
  }

  async function refreshSchemas(): Promise<void> {
    if (refreshing) return;
    refreshing = true;
    try {
      const expandedNames = new Set(schemas.filter(s => s.expanded).map(s => s.name));
      let nodes: SchemaNode[];
      try {
        nodes = await source.listSchemas();
      } catch {
        return;
      }
      schemas = nodes;
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

  async function handleRollbackWithConfirm() {
    if (txActionInFlight || !sqlEditor.pendingTx) return;
    txActionInFlight = true;
    try {
      const ok = await invoke<boolean>("confirm_rollback_tx");
      if (ok) await sqlEditor.rollback();
    } catch (e) {
      toasts.error("Rollback failed: " + String(e));
    } finally {
      txActionInFlight = false;
    }
  }

  async function handleCommit() {
    if (txActionInFlight || !sqlEditor.pendingTx) return;
    txActionInFlight = true;
    try {
      await sqlEditor.commit();
    } catch (e) {
      toasts.error("Commit failed: " + String(e));
    } finally {
      txActionInFlight = false;
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
      owner: selected?.owner ?? null,
      objectName: selected?.name ?? null,
      objectType: selected?.kind ?? null,
    };
    showChat = true;
    Promise.resolve().then(() => { analyzePayload = null; });
  }

  function onKeydown(e: KeyboardEvent) {
    // Skip shortcuts when typing into a form field so editing flows aren't hijacked.
    const tagName = (e.target as HTMLElement).tagName;
    const inEditableField = tagName === "INPUT" || tagName === "TEXTAREA";
    // L3.5 — F10 Commit / F11 Rollback (PSDPM parity)
    if (!inEditableField && e.key === "F10") {
      e.preventDefault();
      if (sqlEditor.pendingTx) void handleCommit();
      return;
    }
    if (!inEditableField && e.key === "F11") {
      e.preventDefault(); // also blocks WebView fullscreen
      if (sqlEditor.pendingTx) handleRollbackWithConfirm();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "i") {
      if (inEditableField) return;
      e.preventDefault();
      showChat = !showChat;
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      if (inEditableField) return;
      e.preventDefault();
      showPalette = true;
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "o") {
      if (inEditableField) return;
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
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "l") {
      e.preventDefault();
      operationsPanel.toggle();
      return;
    }
  }

  let unlistenQueryProgress: UnlistenFn | null = null;
  let unlistenAiApprovalReq: UnlistenFn | null = null;

  onMount(() => {
    bootstrap().catch((e) => {
      fatal = `Unexpected error: ${e instanceof Error ? e.message : String(e)}`;
    });
    window.addEventListener("keydown", onKeydown);
    // L3.1 (Onda 3): subscribe to streaming row-fetch progress emitted by the
    // sidecar. Best-effort — if the listener fails to register the bar simply
    // never animates; query execution itself is unaffected.
    void (async () => {
      try {
        unlistenQueryProgress = await listen<{
          requestId: string;
          rowsFetched: number;
          elapsedMs: number;
          state: "running" | "complete" | "error" | "cancelled";
        }>("query-progress", (e) => {
          const p = e.payload;
          if (p.state === "running") {
            if (fetchProgress.activeRequestId !== p.requestId) {
              fetchProgress.start(p.requestId);
            }
            fetchProgress.update({
              requestId: p.requestId,
              rowsFetched: p.rowsFetched,
              elapsedMs: p.elapsedMs,
            });
          } else {
            fetchProgress.stop();
          }
        });
      } catch {
        // best-effort: no progress bar without listener
      }
      // L3.4 (Onda 3): subscribe to AI tool-approval requests from the sidecar.
      // Best-effort — if the listener fails the sidecar still enforces its
      // 5-minute timeout default, which falls through to deny.
      try {
        unlistenAiApprovalReq = await listen<{
          requestId: string;
          tool: string;
          input: Record<string, unknown>;
        }>("ai-approval-request", (e) => {
          aiApproval.enqueue({
            requestId: e.payload.requestId,
            tool: e.payload.tool,
            input: e.payload.input,
          });
        });
      } catch {
        // best-effort: AI approvals fall back to sidecar 5-min timeout
      }
    })();
    return async () => {
      window.removeEventListener("keydown", onKeydown);
      sqlEditor.reset();
      if (debugStore.status !== 'idle') await debugStore.stop();
      await source.close();
    };
  });

  onDestroy(() => {
    if (unlistenQueryProgress) unlistenQueryProgress();
    if (unlistenAiApprovalReq) unlistenAiApprovalReq();
    fetchProgress.reset();
    aiApproval.reset();
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
{:else if source.meta.kind === "oracle" && (!meta || !info)}
  <main class="loading">Loading workspace…</main>
{:else}
  <div class="shell" style={envTheme.cssVar}>
    <StatusBar
      {source}
      schema={info?.currentSchema ?? ""}
      serverVersion={info?.serverVersion ?? ""}
      hasPendingTx={sqlEditor.pendingTx}
      pendingTxCount={sqlEditor.txState.pendingStatements}
      username={info?.user ?? ""}
      serviceName={info?.serviceName ?? ""}
      onCommit={handleCommit}
      onRollback={handleRollbackWithConfirm}
      chatOpen={showChat}
      onToggleChat={() => showChat = !showChat}
      onDisconnect={onDisconnect}
      onSwitchConnection={onSwitchConnection}
      theme={theme.current}
      onToggleTheme={() => theme.toggle()}
      env={meta?.env}
      readOnly={meta?.readOnly ?? false}
      airgap={meta?.airgapMode ?? false}
      psdpm={meta?.psdpmMode ?? (meta?.env === "prod" || meta?.env === "staging")}
      onSignIn={() => { showLogin = true; }}
      onAuditLog={() => { showAuditLog = true; }}
      onSignOut={handleLogout}
      warnings={source.meta.kind === "sandbox" ? (source as SandboxWorkspaceSource).getWarnings() : []}
      onDelete={async () => {
        if (source.meta.kind !== "sandbox") return;
        await sandboxes.delete(source.meta.id);
        await goto("/");
      }}
      onLeave={async () => {
        if (source.meta.kind !== "sandbox") return;
        await sandboxes.leave(source.meta.id);
        await goto("/");
      }}
    />
    <div class="body" class:body-collapsed={sqlEditor.editorExpanded}>
      <div class="panel-wrap" style="width: {schemaWidth}px; min-width: 160px; max-width: 480px;">
        <SchemaTree
          {schemas}
          {selected}
          onToggle={onToggle}
          onSelect={onSelect}
          onRetry={onRetryKind}
          onKindExpand={onKindExpand}
          onRefresh={refreshSchemas}
          {refreshing}
          apex={info?.apex ?? null}
          onExecuteProc={(owner, name, objectType) => {
            procExecTarget = { owner, name, objectType };
          }}
          onTestWindow={onTestWindow}
          onExposeAsRest={(owner, name, kind) => {
            const lower = kind.toLowerCase() as "table" | "view" | "procedure" | "function";
            openApiBuilder({ kind: lower, obj: { owner, name } });
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
          {#if source.capabilities.tabs.includes("dashboard")}
            <button
              class="ws-tab"
              class:active={activeWsTab === "dashboard"}
              onclick={() => (activeWsTab = "dashboard")}
            >📊 Dashboard</button>
          {/if}
          {#if source.capabilities.kinds.has("REST_MODULE")}
            <button
              class="ws-tab"
              onclick={() => (showOAuthPanel = true)}
              title="Manage OAuth Clients"
            >🔐 OAuth</button>
          {/if}
        </div>
        {#if activeWsTab === "schema"}
          {#if selected && selected.kind === "REST_MODULE"}
            <RestModuleDetails
              owner={selected.owner}
              moduleName={selected.name}
              onTest={(modulePath) => {
                testPanelOpen = { basePath: modulePath };
              }}
              onOpenDocs={(modulePath) => {
                const baseUrl = ordsStore.state?.ordsBaseUrl?.replace(/\/$/, "") ?? "";
                const schema = (selected?.owner ?? "").toLowerCase();
                if (!baseUrl) {
                  toasts.warning("ORDS base URL not configured. Open the bootstrap modal to set it.");
                  return;
                }
                void openUrl(`${baseUrl}/${schema}/open-api-catalog${modulePath}`);
              }}
              onAddEndpoint={() => openApiBuilder(null)}
              onExportSql={async () => {
                if (!selected) return;
                const res = await ordsModuleExportSql(selected.owner, selected.name);
                if (res.ok) {
                  sqlEditor.openWithDdl(`Export: ${selected.name}`, res.data.sql);
                } else {
                  toasts.error("Export failed: " + res.error.message);
                }
              }}
            />
          {:else}
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
              connectionId={page.params.id}
              onSignIn={() => { showLogin = true; }}
              onViewDdl={async (owner, kind, name) => {
                ddlLoading = { owner, name };
                try {
                  const res = await source.loadDdl(owner, name, kind as ObjectKind);
                  if (res.kind === "ok") {
                    const connId = page.params.id!;
                    if (kind === "PACKAGE" && res.spec && res.body) {
                      sqlEditor.openWithDdl(`${owner}.${name}`, res.body, {
                        connectionId: connId,
                        owner,
                        objectType: "PACKAGE BODY",
                        objectName: name,
                      });
                      const activeTab = sqlEditor.active;
                      if (activeTab) {
                        sqlEditor.setPackageSpec(activeTab.id, res.spec, {
                          connectionId: connId,
                          owner,
                          objectType: "PACKAGE",
                          objectName: name,
                        });
                      }
                      void objectVersionCapture(connId, owner, "PACKAGE", name, res.spec, "baseline");
                      void objectVersionCapture(connId, owner, "PACKAGE BODY", name, res.body, "baseline");
                    } else {
                      sqlEditor.openWithDdl(`${owner}.${name}`, res.ddl, {
                        connectionId: connId,
                        owner,
                        objectType: kind,
                        objectName: name,
                      });
                      void objectVersionCapture(connId, owner, kind, name, res.ddl, "baseline");
                    }
                  } else if (res.kind === "unsupported") {
                    detailError = "DDL not available for this source";
                  } else if (res.code === SESSION_LOST) {
                    sessionLost = true;
                  } else if (/ORA-31603/.test(res.error)) {
                    detailError = `DDL not available for ${owner}.${name} — Oracle built-in objects cannot be exported via DBMS_METADATA.`;
                  } else {
                    detailError = `Failed to load DDL: ${res.error}`;
                  }
                } finally {
                  if (ddlLoading?.owner === owner && ddlLoading?.name === name) ddlLoading = null;
                }
              }}
            />
          {/if}
        {/if}
        {#if activeWsTab === "dashboard"}
          <DashboardTab owner={selected?.owner ?? null} objectName={selected?.name ?? null} objectType={selected?.kind ?? null} />
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
              currentSchema: info?.currentSchema ?? source.meta.displayName,
              selectedOwner: selected?.owner,
              selectedName: selected?.name,
              selectedKind: selected?.kind,
              activeSql: sqlEditor.active?.sql ?? undefined,
              schemaObjects: schemaSnapshot,
            }}
            connectionEnv={meta?.env ?? null}
            connectionName={meta?.name ?? source.meta.displayName}
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
      {completionSchema}
      {getColumns}
      env={meta?.env}
      connectionName={meta?.name}
      connectionUser={info?.user ?? null}
      connectionService={info?.serviceName ?? null}
      connectionVersion={info?.serverVersion ?? null}
      isProductionLocked={meta?.psdpmMode ?? (meta?.env === "prod" || meta?.env === "staging")}
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
  {#if testWindowOpen}
    <TestWindow onClose={() => { testWindowOpen = false; void debugStore.stop(); }} />
  {/if}
  {#if showApiBuilder}
    <RestApiBuilder
      owner={schemas.find((s) => s.isCurrent)?.name ?? selected?.owner ?? ""}
      initialKind={apiBuilderInitial?.kind ?? null}
      initialObject={apiBuilderInitial?.obj ?? null}
      onCancel={() => { showApiBuilder = false; apiBuilderInitial = null; }}
      onPreview={(config) => void handleBuilderPreview(config)}
    />
  {/if}
  {#if previewSql !== null}
    <RestApiPreview
      sql={previewSql}
      connectionLabel={meta ? userLabel(meta) : ""}
      onCancel={() => { previewSql = null; }}
      onApply={handlePreviewApply}
      onCopyToTab={handleCopyToTab}
    />
  {/if}
  {#if showOrdsBootstrap && ordsStore.state}
    <OrdsBootstrapModal
      result={ordsStore.state}
      schemaName={schemas.find((s) => s.isCurrent)?.name ?? ""}
      onEnableSchema={async () => {
        const res = await ordsEnableSchema();
        if (!res.ok) {
          toasts.error("Failed to enable schema: " + res.error.message);
          return;
        }
        await ordsStore.refresh();
        if (ordsStore.state?.currentSchemaEnabled) showOrdsBootstrap = false;
      }}
      onSetBaseUrl={(url) => {
        ordsStore.setBaseUrl(url);
        showOrdsBootstrap = false;
      }}
      onClose={() => showOrdsBootstrap = false}
    />
  {/if}
  {#if testPanelOpen}
    <div class="test-panel-wrap">
      <RestTestPanel
        baseUrl={ordsStore.state?.ordsBaseUrl ?? ""}
        moduleBasePath={testPanelOpen.basePath}
        schemaName={selected?.owner ?? ""}
        onClose={() => testPanelOpen = null}
      />
    </div>
  {/if}
  {#if showOAuthPanel}
    <OAuthClientsPanel
      onClose={() => showOAuthPanel = false}
      onOpenBootstrap={() => { showOAuthPanel = false; showOrdsBootstrap = true; }}
    />
  {/if}
  {#if showLogin}
    <LoginModal onClose={async () => {
      showLogin = false;
      const { invoke: inv } = await import("@tauri-apps/api/core");
      const token = await inv<string | null>("auth_token_get");
      if (token) {
        try {
          const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
          authCtx.tier = "cloud";
          authCtx.email = payload.email ?? "";
        } catch { /* ignore */ }
      }
    }} />
  {/if}
  {#if showAuditLog}
    <AuditLogPanel onClose={() => { showAuditLog = false; }} />
  {/if}
  {#if operationsPanel.isOpen}
    <div class="activity-ledger-wrap">
      <OperationsPanel onClose={() => operationsPanel.close()} />
    </div>
  {:else}
    <button
      class="activity-ledger-toggle"
      onclick={() => operationsPanel.open()}
      title="Show Operations Panel (Ctrl+Shift+L)"
      aria-label="Show Operations Panel"
    >
      <span class="al-dot"></span>
      Activity
    </button>
  {/if}
  {#if ddlLoading}
    <div class="ddl-toast" role="status" aria-live="polite">
      <span class="ddl-spinner"></span>
      <span class="ddl-msg">Loading DDL <code>{ddlLoading.owner}.{ddlLoading.name}</code>…</span>
    </div>
  {/if}
  <FetchProgressBar />
  <AiApprovalModal />
{/if}

<style>
  :global(body) {
    margin: 0;
    background: var(--bg-page);
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
  .test-panel-wrap {
    position: fixed;
    top: 0; right: 0; bottom: 0;
    z-index: 900;
    box-shadow: -8px 0 24px rgba(0,0,0,0.3);
  }
  .ddl-toast {
    position: fixed; bottom: 24px; right: 24px; z-index: 1100;
    display: flex; align-items: center; gap: 10px;
    padding: 10px 14px;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.35);
    font-size: 12px;
    color: var(--text-primary);
    animation: ddl-slide-in 200ms cubic-bezier(0.2, 0.9, 0.3, 1.0);
  }
  .ddl-msg code {
    font-family: monospace;
    color: #7dcfff;
    background: var(--bg-surface-alt);
    padding: 1px 5px;
    border-radius: 3px;
  }
  .ddl-spinner {
    width: 14px; height: 14px;
    border: 2px solid var(--border);
    border-top-color: #f97316;
    border-radius: 50%;
    animation: ddl-spin 0.8s linear infinite;
  }
  @keyframes ddl-spin { to { transform: rotate(360deg); } }
  @keyframes ddl-slide-in {
    from { transform: translateX(20px); opacity: 0; }
    to   { transform: translateX(0);     opacity: 1; }
  }

  /* ── Cloud tier overrides ─────────────────────────────────── */
  :global([data-tier="cloud"]) .ws-tab.active {
    border-bottom-color: rgba(43, 180, 238, 0.8);
  }
  :global([data-tier="cloud"]) .resize-handle:hover,
  :global([data-tier="cloud"]) .resize-handle:active {
    background: rgba(43, 180, 238, 0.25);
  }

  /* ── L2.5 Activity Ledger panel + floating toggle ──────────────── */
  .activity-ledger-wrap {
    position: fixed;
    top: 32px;
    right: 0;
    bottom: 0;
    width: 360px;
    max-width: 50vw;
    z-index: 90;
    box-shadow: -2px 0 12px rgba(0, 0, 0, 0.18);
    animation: slide-in-r 0.18s ease-out;
  }
  .activity-ledger-toggle {
    position: fixed;
    bottom: 16px;
    right: 16px;
    z-index: 80;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    color: var(--text-muted);
    padding: 6px 12px;
    border-radius: 18px;
    cursor: pointer;
    font-size: 11px;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 6px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  }
  .activity-ledger-toggle:hover {
    color: var(--text-primary);
    border-color: var(--border-strong);
  }
  .al-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #16a34a;
    box-shadow: 0 0 0 2px rgba(22, 163, 74, 0.18);
    animation: al-pulse 2s ease-in-out infinite;
  }
  @keyframes al-pulse {
    0%, 100% { opacity: 1; }
    50%      { opacity: 0.4; }
  }
  @keyframes slide-in-r {
    from { transform: translateX(20px); opacity: 0; }
    to   { transform: translateX(0);    opacity: 1; }
  }
</style>
