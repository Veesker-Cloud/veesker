<!--
  Copyright 2022-2026 Geraldo Ferreira Viana Júnior
  Licensed under the Apache License, Version 2.0
  https://github.com/gevianajr/veesker
-->

<script lang="ts">
  import { sqlEditor, COMPILE_REGEX, runExplain, setActiveResult } from "$lib/stores/sql-editor.svelte";
  import { formatSql } from "$lib/workspace/format-sql";
  import { createPerfAnalyzer } from "$lib/stores/perf-analyzer.svelte";
  import { flowTraceSql } from "$lib/workspace";
  import { visualFlow } from "$lib/stores/visual-flow.svelte";
  import SqlEditor from "./SqlEditor.svelte";
  import DmlConfirmModal from "./DmlConfirmModal.svelte";
  import UnsafeDmlModal from "./UnsafeDmlModal.svelte";
  import ResultGrid from "./ResultGrid.svelte";
  import ExecutionLog from "./ExecutionLog.svelte";
  import QueryHistory from "./QueryHistory.svelte";
  import CompileErrors from "./CompileErrors.svelte";
  import ExplainPlan from "./ExplainPlan.svelte";
  import PerfBanner from "./PerfBanner.svelte";
  import type { CostBadgeData } from "./CostBadgeGutter";
  import ObjectVersionBadge from "./ObjectVersionBadge.svelte";
  import ObjectVersionFlyout from "./ObjectVersionFlyout.svelte";
  import PlsqlOutline from "./PlsqlOutline.svelte";

  type Props = {
    onCancel: () => void;
    onExplainWithAI: (msg: string) => void;
    onAnalyze?: () => void;
    completionSchema?: Record<string, string[]>;
    getColumns?: (table: string, owner: string | null) => Promise<string[]>;
  };
  let { onCancel, onExplainWithAI, onAnalyze, completionSchema, getColumns }: Props = $props();

  // ── Refs ────────────────────────────────────────────────────────────────────
  let drawerEl: HTMLDivElement | undefined = $state();
  let tabbarEl: HTMLDivElement | undefined = $state();
  let editorRef: SqlEditor | null = $state(null);
  let flowError = $state<string | null>(null);
  let flyoutOpen = $state(false);

  // ── Perf analyzer ────────────────────────────────────────────────────────────
  const perf = createPerfAnalyzer();
  let perfEnabled = $state(true);

  $effect(() => {
    perf.setSessionBusy(!!active?.running);
  });

  $effect(() => {
    // Reset when switching tabs; the editor update listener fires onChange
    // for the new tab's SQL, which re-triggers scheduleAnalysis automatically.
    sqlEditor.activeId;
    perf.reset();
  });

  let costBadge = $derived.by<CostBadgeData | null>(() => {
    if (perf.state.kind !== "analyzed") return null;
    return { line: 1, cost: perf.state.plan[0]?.cost ?? null, costClass: perf.state.costClass };
  });

  function formatWhySlowMessage(): string {
    if (perf.state.kind !== "analyzed") return "";
    const { plan, redFlags, staleStats, sql } = perf.state;
    const lines: string[] = [];
    lines.push("**Performance Analysis**");
    lines.push("");
    const snippet = sql.slice(0, 300);
    lines.push(`**SQL:**\n\`\`\`sql\n${snippet}${sql.length > 300 ? "\n-- (truncated)" : ""}\n\`\`\``);
    lines.push("");
    const root = plan[0];
    if (root) {
      lines.push(`**Estimated cost:** ${root.cost?.toLocaleString("en-US") ?? "unknown"}`);
      if (root.cardinality !== null) lines.push(`**Expected rows:** ${root.cardinality.toLocaleString("en-US")}`);
      lines.push("");
    }
    if (redFlags.length > 0) {
      lines.push("**Red flags:**");
      for (const f of redFlags) {
        lines.push(`- [${f.id}] **${f.severity}**: ${f.message}`);
        if (f.suggestion) lines.push(`  → ${f.suggestion}`);
      }
      lines.push("");
    }
    if (staleStats.length > 0) {
      lines.push("**Stale statistics:**");
      for (const s of staleStats) {
        const age = s.ageDays !== null ? `${s.ageDays} days old` : "never analyzed";
        lines.push(`- ${s.table}: ${age}`);
      }
      lines.push("");
    }
    lines.push("Why is this query slow? What specific optimizations would you recommend?");
    return lines.join("\n");
  }

  function handleWhySlow() {
    onExplainWithAI(formatWhySlowMessage());
  }

  function handleTogglePerfEnabled() {
    perfEnabled = !perfEnabled;
    perf.setEnabled(perfEnabled);
    if (perfEnabled && active?.sql) perf.scheduleAnalysis(active.sql);
  }

  // ── Active result ────────────────────────────────────────────────────────────
  const active = $derived(sqlEditor.active);
  let activeTabResult = $derived(
    active ? active.results.find((r) => r.id === active.activeResultId) ?? null : null
  );

  // ── Top drag handle (resizes drawer height) ──────────────────────────────
  let topDragStartY = 0;
  let topDragStartHeight = 0;

  function onTopPointerDown(e: PointerEvent) {
    const handle = e.currentTarget as HTMLDivElement;
    handle.setPointerCapture(e.pointerId);
    topDragStartY = e.clientY;
    topDragStartHeight = sqlEditor.drawerHeight;
  }

  function onTopPointerMove(e: PointerEvent) {
    if (!(e.currentTarget as HTMLDivElement).hasPointerCapture(e.pointerId)) return;
    const newHeight = topDragStartHeight + (topDragStartY - e.clientY);
    const max = typeof window !== "undefined" ? window.innerHeight * 0.9 : 2000;
    sqlEditor.setDrawerHeight(Math.max(120, Math.min(max, newHeight)));
  }

  function onTopPointerUp(e: PointerEvent) {
    const handle = e.currentTarget as HTMLDivElement;
    if (handle.hasPointerCapture(e.pointerId)) {
      handle.releasePointerCapture(e.pointerId);
    }
    // Final value already persisted by setDrawerHeight
  }

  function onTopKeyDown(e: KeyboardEvent) {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      const max = typeof window !== "undefined" ? window.innerHeight * 0.9 : 2000;
      sqlEditor.setDrawerHeight(Math.min(max, sqlEditor.drawerHeight + 10));
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      sqlEditor.setDrawerHeight(Math.max(120, sqlEditor.drawerHeight - 10));
    }
  }

  // ── Middle drag handle (resizes editor/grid ratio) ───────────────────────
  function onMidPointerDown(e: PointerEvent) {
    const handle = e.currentTarget as HTMLDivElement;
    handle.setPointerCapture(e.pointerId);
  }

  function onMidPointerMove(e: PointerEvent) {
    if (!(e.currentTarget as HTMLDivElement).hasPointerCapture(e.pointerId)) return;
    if (!drawerEl || !tabbarEl) return;
    const drawerRect = drawerEl.getBoundingClientRect();
    const tabbarHeight = tabbarEl.clientHeight;
    const contentHeight = drawerRect.height - tabbarHeight - 4; // 4px = top handle
    const offsetInContent = e.clientY - drawerRect.top - tabbarHeight - 4;
    const ratio = offsetInContent / contentHeight;
    sqlEditor.setEditorRatio(ratio);
  }

  function onMidPointerUp(e: PointerEvent) {
    const handle = e.currentTarget as HTMLDivElement;
    if (handle.hasPointerCapture(e.pointerId)) {
      handle.releasePointerCapture(e.pointerId);
    }
  }

  function onMidKeyDown(e: KeyboardEvent) {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      sqlEditor.setEditorRatio(sqlEditor.editorRatio - 10 / sqlEditor.drawerHeight);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      sqlEditor.setEditorRatio(sqlEditor.editorRatio + 10 / sqlEditor.drawerHeight);
    }
  }

  function triggerExplain(sql: string) {
    if (sql.trim()) void runExplain(sql);
  }

  function handleFormat() {
    const t = sqlEditor.active;
    if (!t) return;
    const current = t.packageActiveTab === "spec" ? (t.packageSpec ?? t.sql) : t.sql;
    if (!current.trim()) return;
    try {
      const formatted = formatSql(current, !!t.plsqlMeta);
      if (t.packageActiveTab === "spec") {
        sqlEditor.updatePackageSpec(t.id, formatted);
      } else {
        sqlEditor.updateSql(t.id, formatted);
      }
    } catch {
      // sql-formatter throws on severely malformed input — leave the editor unchanged
    }
  }

  async function explainWithVisualFlow(withRuntimeStats: boolean): Promise<void> {
    const sql = active?.sql ?? "";
    if (!sql.trim()) return;

    const head = sql.replace(/^\s*\/\*[\s\S]*?\*\//g, "").replace(/^\s*--[^\n]*\n?/g, "").trim().slice(0, 32).toUpperCase();
    if (/^(CREATE|ALTER|DROP|GRANT|REVOKE|TRUNCATE|RENAME|BEGIN|DECLARE)\b/.test(head)) {
      flowError = "This is procedure/DDL code — Visual Flow buttons here are for SELECT/DML only. To trace a procedure's execution, open it from the schema browser and use 'Run with Visual Flow' in the Execute modal.";
      return;
    }

    flowError = null;
    const result = await flowTraceSql({ sql, withRuntimeStats });
    if (!result.ok) {
      flowError = `Visual Flow failed: ${result.error.message}`;
      return;
    }
    visualFlow.open(result.data);
  }
</script>

{#if !sqlEditor.drawerOpen}
  <button
    class="strip"
    aria-label="Expand SQL drawer"
    onclick={() => sqlEditor.toggleDrawer()}
  >
    <span class="label">SQL</span>
    <span class="arrow">▲</span>
  </button>
{:else}
  <!-- Top resize handle (hidden when expanded) -->
  {#if !sqlEditor.editorExpanded}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      class="top-handle"
      role="separator"
      aria-orientation="horizontal"
      tabindex="0"
      onpointerdown={onTopPointerDown}
      onpointermove={onTopPointerMove}
      onpointerup={onTopPointerUp}
      onpointercancel={onTopPointerUp}
      onkeydown={onTopKeyDown}
    ></div>
  {/if}

  <div
    class="drawer"
    class:drawer-expanded={sqlEditor.editorExpanded}
    style={sqlEditor.editorExpanded ? "" : `height: ${sqlEditor.drawerHeight}px`}
    bind:this={drawerEl}
  >
    <div class="tabbar" bind:this={tabbarEl}>
      <button
        class="history-toggle"
        aria-label="Toggle query history"
        onclick={() => sqlEditor.toggleHistoryPanel()}
      >{sqlEditor.historyPanelOpen ? "◀" : "▶"}</button>
      <div class="tabs" role="tablist">
        {#each sqlEditor.tabs as t (t.id)}
          <div
            role="tab"
            class="tab"
            class:active={sqlEditor.activeId === t.id}
            tabindex="0"
            onclick={() => sqlEditor.setActive(t.id)}
            onkeydown={(e) => { if (e.key === "Enter") sqlEditor.setActive(t.id); }}
          >
            {#if t.running}<span class="tab-spinner"></span>{/if}
            <span class="tab-title">{t.isDirty ? `● ${t.title}` : t.title}</span>
            <button
              class="tab-close"
              aria-label="Close {t.title}"
              onclick={(e) => { e.stopPropagation(); sqlEditor.closeTab(t.id); }}
            >×</button>
          </div>
        {/each}
        <button class="plus" aria-label="New query" onclick={() => sqlEditor.openBlank()}>+</button>
      </div>
      {#if active?.plsqlMeta}
        {@const badgeMeta = (active.packageActiveTab === "spec" && active.specMeta) ? active.specMeta : active.plsqlMeta}
        <div style="position:relative; display:flex; align-items:stretch;">
          <ObjectVersionBadge
            connectionId={badgeMeta.connectionId}
            owner={badgeMeta.owner}
            objectType={badgeMeta.objectType}
            objectName={badgeMeta.objectName}
            onOpen={() => { flyoutOpen = true; }}
          />
          {#if flyoutOpen}
            <ObjectVersionFlyout
              connectionId={badgeMeta.connectionId}
              owner={badgeMeta.owner}
              objectType={badgeMeta.objectType}
              objectName={badgeMeta.objectName}
              onLoadInEditor={(ddl) => {
                if (active) {
                  if (active.packageActiveTab === "spec") sqlEditor.updatePackageSpec(active.id, ddl);
                  else sqlEditor.updateSql(active.id, ddl);
                }
                flyoutOpen = false;
              }}
              onClose={() => { flyoutOpen = false; }}
            />
          {/if}
        </div>
      {/if}
      <button
        class="collapse"
        aria-label="Collapse drawer"
        onclick={() => { if (sqlEditor.editorExpanded) sqlEditor.toggleEditorExpanded(); sqlEditor.toggleDrawer(); }}
      >▼</button>
    </div>

    <div class="drawer-body">
      {#if sqlEditor.historyPanelOpen}
        <QueryHistory />
      {/if}
      {#if active?.plsqlMeta}
        <PlsqlOutline
          sql={active.sql}
          packageSpec={active.packageSpec}
          objectType={active.plsqlMeta.objectType}
          activeTab={active.packageActiveTab}
          onNavigate={(line) => editorRef?.gotoLine(line)}
          onTabChange={(tab) => { if (active) sqlEditor.setPackageActiveTab(active.id, tab); }}
        />
      {/if}

      <div class="main-area">
        {#if sqlEditor.activeId === null}
          <div class="empty">Click + to open a new query.</div>
        {:else}
          {@const tab = sqlEditor.active}
          <div class="editor-pane" style="flex: 0 0 {sqlEditor.editorRatio * 100}%">
            {#if tab}
              {#if tab.packageSpec != null}
                <div class="pkg-subtabs">
                  <button
                    class="pkg-subtab"
                    class:pkg-subtab-active={tab.packageActiveTab === "spec"}
                    onclick={() => sqlEditor.setPackageActiveTab(tab.id, "spec")}
                  >Spec</button>
                  <button
                    class="pkg-subtab"
                    class:pkg-subtab-active={tab.packageActiveTab === "body"}
                    onclick={() => sqlEditor.setPackageActiveTab(tab.id, "body")}
                  >Body</button>
                </div>
              {/if}
              {@const editorSql = tab.packageActiveTab === "spec" ? (tab.packageSpec ?? tab.sql) : tab.sql}
              <SqlEditor
                bind:this={editorRef}
                value={editorSql}
                compileErrors={activeTabResult?.compileErrors ?? null}
                {costBadge}
                onChange={(s) => {
                  if (tab.packageActiveTab === "spec") {
                    sqlEditor.updatePackageSpec(tab.id, s);
                  } else {
                    sqlEditor.updateSql(tab.id, s);
                    perf.scheduleAnalysis(s);
                  }
                }}
                onRunCursor={(selection, cursorPos, docText) => {
                  if (selection !== null) {
                    void sqlEditor.runSelection(selection);
                  } else {
                    void sqlEditor.runStatementAtCursor(docText, cursorPos);
                  }
                }}
                onRunAll={() => void sqlEditor.runActiveAll()}
                onSave={() => void sqlEditor.saveActive()}
                onSaveAs={() => void sqlEditor.saveAsActive()}
                onExplain={triggerExplain}
                {completionSchema}
                {getColumns}
              />
              <div class="dock" aria-label="Editor actions">
                <button class="dock-btn" title="New query (⌘N)" aria-label="New query" onclick={() => sqlEditor.openBlank()}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M4 2.5h5.5L13 6v7.5H4V2.5z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
                    <path d="M9.5 2.5V6.5H13" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
                    <line x1="6.5" y1="9.5" x2="9.5" y2="9.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
                    <line x1="8" y1="8" x2="8" y2="11" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
                  </svg>
                </button>
                <button class="dock-btn" title="Open file (⌘O)" aria-label="Open file" onclick={() => void sqlEditor.openFromFile()}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M2 7.5h12V13H2V7.5z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
                    <path d="M2 7.5V5H5.5l1.5 2.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </button>
                <button class="dock-btn" title="Save (⌘S)" aria-label="Save" onclick={() => void sqlEditor.saveActive()}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <rect x="2" y="2" width="12" height="12" rx="1.5" stroke="currentColor" stroke-width="1.3"/>
                    <rect x="5" y="2" width="6" height="4.5" stroke="currentColor" stroke-width="1.1"/>
                    <rect x="3.5" y="9" width="9" height="5" rx="0.5" stroke="currentColor" stroke-width="1.1"/>
                    <line x1="8.5" y1="2.5" x2="8.5" y2="6" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
                  </svg>
                </button>
                <button class="dock-btn" title="Save as… (⌘⇧S)" aria-label="Save as" onclick={() => void sqlEditor.saveAsActive()}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <rect x="1.5" y="2" width="10.5" height="12" rx="1.5" stroke="currentColor" stroke-width="1.3"/>
                    <rect x="4.5" y="2" width="5" height="4" stroke="currentColor" stroke-width="1.1"/>
                    <rect x="3" y="8.5" width="7.5" height="4.5" rx="0.5" stroke="currentColor" stroke-width="1.1"/>
                    <path d="M14 6l2.5 3-2.5 3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
                    <line x1="11.5" y1="9" x2="16" y2="9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
                  </svg>
                </button>
                <div class="dock-sep"></div>
                <button class="dock-btn dock-format" title="Beautify / Format code" aria-label="Format code" disabled={!tab.sql?.trim()} onclick={handleFormat}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M2.5 13.5L9.5 6.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                    <rect x="1.2" y="12.2" width="2.8" height="2.8" rx="0.4" transform="rotate(-45 2.6 13.6)" stroke="currentColor" stroke-width="1.1" fill="none"/>
                    <line x1="10.5" y1="4" x2="10.5" y2="7" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
                    <line x1="9" y1="5.5" x2="12" y2="5.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
                    <line x1="13.5" y1="1.5" x2="13.5" y2="3.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
                    <line x1="12.5" y1="2.5" x2="14.5" y2="2.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
                  </svg>
                </button>
                <div class="dock-sep"></div>
                {#if COMPILE_REGEX.test(tab.packageActiveTab === "spec" ? (tab.packageSpec ?? tab.sql) : tab.sql)}
                  <button class="dock-btn dock-compile" title="Compile" aria-label="Compile" onclick={() => void sqlEditor.runActiveAll()}>
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                      <polygon points="3,2 14,8 3,14"/>
                    </svg>
                  </button>
                  <div class="dock-sep"></div>
                {/if}
                {#if !tab.plsqlMeta}
                  <button class="dock-btn" title="Explain Plan (F6)" aria-label="Explain Plan" onclick={() => triggerExplain(tab.sql)}>
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.3"/>
                      <line x1="10.2" y1="10.2" x2="14.5" y2="14.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
                      <line x1="7" y1="4.5" x2="7" y2="9.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
                      <line x1="4.5" y1="7" x2="9.5" y2="7" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
                    </svg>
                  </button>
                  <button class="dock-btn" title="Visual Flow — static trace" aria-label="Visual Flow (static)" disabled={!tab.sql?.trim()} onclick={() => void explainWithVisualFlow(false)}>
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <circle cx="2.5" cy="8" r="1.8" stroke="currentColor" stroke-width="1.2"/>
                      <circle cx="8" cy="3.5" r="1.8" stroke="currentColor" stroke-width="1.2"/>
                      <circle cx="13.5" cy="8" r="1.8" stroke="currentColor" stroke-width="1.2"/>
                      <circle cx="8" cy="12.5" r="1.8" stroke="currentColor" stroke-width="1.2"/>
                      <line x1="4.3" y1="8" x2="11.7" y2="8" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
                      <line x1="3.4" y1="6.5" x2="6.4" y2="4.9" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
                      <line x1="9.6" y1="4.9" x2="12.6" y2="6.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
                      <line x1="3.4" y1="9.5" x2="6.4" y2="11.1" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
                      <line x1="9.6" y1="11.1" x2="12.6" y2="9.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
                    </svg>
                  </button>
                  <button class="dock-btn" title="Visual Flow + runtime stats" aria-label="Visual Flow with stats" disabled={!tab.sql?.trim()} onclick={() => void explainWithVisualFlow(true)}>
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <circle cx="2.5" cy="8" r="1.8" stroke="currentColor" stroke-width="1.2"/>
                      <circle cx="7" cy="3.5" r="1.8" stroke="currentColor" stroke-width="1.2"/>
                      <circle cx="11" cy="8" r="1.8" stroke="currentColor" stroke-width="1.2"/>
                      <line x1="4.3" y1="8" x2="9.2" y2="8" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
                      <line x1="3.4" y1="6.5" x2="5.5" y2="4.9" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
                      <line x1="8.5" y1="4.9" x2="11" y2="6.2" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
                      <path d="M14 5l-1.8 3h1.4l-1.8 4.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                  </button>
                  <div class="dock-sep"></div>
                {/if}
                <button class="dock-btn dock-commit" title="Commit transaction" aria-label="Commit" disabled={!sqlEditor.pendingTx} onclick={() => void sqlEditor.commit().catch(e => { window.alert("Commit failed: " + String(e)); })}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <circle cx="8" cy="8" r="5.5" stroke="currentColor" stroke-width="1.3"/>
                    <polyline points="5,8 7.5,10.5 11.5,5.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </button>
                <button class="dock-btn dock-rollback" title="Rollback transaction" aria-label="Rollback" disabled={!sqlEditor.pendingTx} onclick={() => void sqlEditor.rollback().catch(e => { window.alert("Rollback failed: " + String(e)); })}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M5.5 4C8 1.5 14 2.5 14 8s-6 6.5-8.5 4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
                    <polyline points="2,8.5 5.5,4 9,7.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </button>
                <div class="dock-sep"></div>
                <button class="dock-btn" title={sqlEditor.editorExpanded ? "Restore (⌘⇧E)" : "Expand (⌘⇧E)"} aria-label={sqlEditor.editorExpanded ? "Restore editor" : "Expand editor"} onclick={() => sqlEditor.toggleEditorExpanded()}>
                  {#if sqlEditor.editorExpanded}
                    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <path d="M6 1v5H1M10 1v5h5M6 15v-5H1M10 15v-5h5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                  {:else}
                    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <path d="M1 6V1h5M15 6V1h-5M1 10v5h5M15 10v5h-5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                  {/if}
                </button>
              </div>
            {/if}
          </div>

          {#if activeTabResult?.compileErrors?.length}
            <CompileErrors
              errors={activeTabResult.compileErrors}
              onGoto={(line) => editorRef?.gotoLine(line)}
            />
          {/if}
          {#if flowError}
            <div class="flow-error">
              <span>{flowError}</span>
              <button class="flow-error-close" aria-label="Dismiss" onclick={() => { flowError = null; }}>×</button>
            </div>
          {/if}

          <PerfBanner
            state={perf.state}
            onWhySlow={handleWhySlow}
            enabled={perfEnabled}
            onToggleEnabled={handleTogglePerfEnabled}
          />

          <!-- Middle resize handle -->
          <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
          <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
          <div
            class="mid-handle"
            role="separator"
            aria-orientation="horizontal"
            tabindex="0"
            onpointerdown={onMidPointerDown}
            onpointermove={onMidPointerMove}
            onpointerup={onMidPointerUp}
            onpointercancel={onMidPointerUp}
            onkeydown={onMidKeyDown}
          ></div>

          <div class="grid-pane" style="flex: 1 1 auto">
            {#if tab}
              <ExecutionLog {tab} />
            {/if}
            <div class="grid-host">
              {#if activeTabResult?.status === "explain" && activeTabResult.explainNodes !== null}
                <ExplainPlan
                  nodes={activeTabResult.explainNodes}
                  onBack={() => {
                    if (!active) return;
                    const prev =
                      active.results.findLast(
                        (r) => r.id !== active!.activeResultId && r.status !== "explain"
                      ) ?? active.results.findLast((r) => r.id !== active!.activeResultId);
                    if (prev) setActiveResult(active.id, prev.id);
                  }}
                  {onExplainWithAI}
                />
              {:else}
                <ResultGrid
                  {tab}
                  {onCancel}
                  {onAnalyze}
                  onFetchAll={() => void sqlEditor.fetchAllForActiveResult()}
                />
              {/if}
            </div>
          </div>
        {/if}
      </div>
    </div>
  </div>
  {#if sqlEditor.pendingConfirm}
    <DmlConfirmModal
      sql={sqlEditor.pendingConfirm.sql}
      ops={sqlEditor.pendingConfirm.ops}
      onConfirm={() => sqlEditor.confirmRun(true)}
      onCancel={() => sqlEditor.confirmRun(false)}
    />
  {/if}
  {#if sqlEditor.pendingUnsafeDml}
    <UnsafeDmlModal
      sql={sqlEditor.pendingUnsafeDml.sql}
      message={sqlEditor.pendingUnsafeDml.message}
      onConfirm={() => sqlEditor.resolveUnsafeDml(true)}
      onCancel={() => sqlEditor.resolveUnsafeDml(false)}
    />
  {/if}
{/if}

<style>
  .strip {
    height: 28px;
    width: 100%;
    background: var(--bg-page);
    border: none;
    border-top: 1px solid rgba(255,255,255,0.06);
    color: rgba(255,255,255,0.4);
    font-family: "Space Grotesk", sans-serif;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 1rem;
    cursor: pointer;
    transition: background 0.1s, color 0.1s;
  }
  .strip:hover { background: var(--bg-surface-alt); color: rgba(255,255,255,0.7); }

  /* ── Top resize handle ─────────────────────────────────────────────────── */
  .top-handle {
    height: 4px;
    width: 100%;
    cursor: ns-resize;
    background: transparent;
    flex-shrink: 0;
  }
  .top-handle:hover {
    background: rgba(179, 62, 31, 0.4);
  }
  .top-handle:focus-visible {
    outline: 2px solid #b33e1f;
    outline-offset: -1px;
  }

  /* ── Drawer ─────────────────────────────────────────────────────────────── */
  .drawer {
    min-height: 120px;
    background: var(--bg-surface);
    border-top: 1px solid rgba(179, 62, 31, 0.5);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 -2px 12px rgba(0,0,0,0.08);
  }
  .drawer-expanded {
    flex: 1 1 auto !important;
    min-height: 0 !important;
    height: auto !important;
  }
  .tabbar {
    display: flex;
    align-items: stretch;
    background: var(--bg-page);
    border-bottom: 1px solid rgba(255,255,255,0.06);
  }
  .tabs {
    display: flex;
    flex: 1;
    overflow-x: auto;
  }
  .tab {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.4rem 0.85rem;
    border-right: 1px solid rgba(255,255,255,0.05);
    background: transparent;
    cursor: pointer;
    font-size: 11.5px;
    font-family: "Space Grotesk", sans-serif;
    color: rgba(255,255,255,0.45);
    user-select: none;
    transition: background 0.1s, color 0.1s;
  }
  .tab:hover { background: rgba(255,255,255,0.05); color: rgba(255,255,255,0.75); }
  .tab.active {
    background: rgba(255,255,255,0.08);
    color: #f6f1e8;
    border-bottom: 2px solid #b33e1f;
    margin-bottom: -1px;
  }
  .tab-spinner {
    width: 8px; height: 8px;
    border: 1.5px solid rgba(255,255,255,0.15);
    border-top-color: rgba(255,255,255,0.6);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .tab-close {
    background: transparent;
    border: none;
    color: inherit;
    opacity: 0.5;
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    padding: 0 0.1rem;
    border-radius: 3px;
  }
  .tab-close:hover { opacity: 1; background: rgba(255,255,255,0.1); }
  .plus, .collapse, .history-toggle {
    background: transparent;
    border: none;
    padding: 0 0.7rem;
    color: rgba(255,255,255,0.35);
    cursor: pointer;
    font-size: 14px;
    font-family: "Space Grotesk", sans-serif;
    transition: background 0.1s, color 0.1s;
  }
  .plus:hover, .collapse:hover, .history-toggle:hover {
    background: rgba(255,255,255,0.06);
    color: rgba(255,255,255,0.8);
  }
  .history-toggle {
    font-size: 10px;
    padding: 0 0.6rem;
    border-right: 1px solid rgba(255,255,255,0.05);
  }

  /* ── 3-pane body layout ─────────────────────────────────────────────────── */
  .drawer-body {
    flex: 1 1 auto;
    display: flex;
    flex-direction: row;
    min-height: 0;
    overflow: hidden;
  }
  .main-area {
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    min-width: 0;
    overflow: hidden;
  }

  .empty {
    padding: 1.5rem;
    color: rgba(26, 22, 18, 0.5);
    font-size: 12px;
  }
  .editor-pane {
    position: relative;
    min-height: 80px;
    border-bottom: 1px solid rgba(26, 22, 18, 0.1);
    overflow: hidden;
  }

  /* ── Floating dock ──────────────────────────────────────────────────────── */
  .dock {
    position: absolute;
    bottom: 12px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 40;
    display: flex;
    align-items: center;
    gap: 1px;
    padding: 4px 6px;
    background: rgba(14, 12, 10, 0.84);
    backdrop-filter: blur(18px) saturate(160%);
    -webkit-backdrop-filter: blur(18px) saturate(160%);
    border: 1px solid rgba(255, 255, 255, 0.09);
    border-radius: 14px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.55), 0 1px 0 rgba(255,255,255,0.06) inset;
    white-space: nowrap;
    pointer-events: auto;
  }
  .dock-btn {
    background: transparent;
    border: none;
    width: 30px;
    height: 30px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: rgba(255,255,255,0.48);
    cursor: pointer;
    transition: background 0.12s, color 0.12s, transform 0.1s;
    flex-shrink: 0;
  }
  .dock-btn:hover:not(:disabled) {
    background: rgba(255,255,255,0.10);
    color: rgba(255,255,255,0.92);
    transform: scale(1.15) translateY(-2px);
  }
  .dock-btn:active:not(:disabled) { transform: scale(1.04); }
  .dock-btn:disabled { opacity: 0.22; cursor: default; }
  .dock-sep {
    width: 1px;
    height: 18px;
    background: rgba(255,255,255,0.10);
    margin: 0 3px;
    flex-shrink: 0;
  }
  .dock-format { color: #a0c4ff; }
  .dock-format:hover:not(:disabled) { background: rgba(100,160,255,0.14); color: #c4d9ff; transform: scale(1.15) translateY(-2px); }
  .dock-compile { color: #f5a08a; }
  .dock-compile:hover:not(:disabled) { background: rgba(179,62,31,0.18); color: #f5c4a8; transform: scale(1.15) translateY(-2px); }
  .dock-commit { color: #7ec96a; }
  .dock-commit:hover:not(:disabled) { background: rgba(126,201,106,0.15); color: #9fe88a; transform: scale(1.15) translateY(-2px); }
  .dock-rollback { color: #f5a08a; }
  .dock-rollback:hover:not(:disabled) { background: rgba(245,160,138,0.15); color: #f5c4a8; transform: scale(1.15) translateY(-2px); }

  /* ── Middle resize handle ──────────────────────────────────────────────── */
  .mid-handle {
    height: 4px;
    width: 100%;
    cursor: ns-resize;
    background: transparent;
    flex-shrink: 0;
  }
  .mid-handle:hover {
    background: rgba(179, 62, 31, 0.4);
  }
  .mid-handle:focus-visible {
    outline: 2px solid #b33e1f;
    outline-offset: -1px;
  }

  .grid-pane {
    min-height: 80px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .grid-host {
    flex: 1 1 auto;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .flow-error {
    padding: 4px 12px;
    font-size: 11px;
    color: #e74c3c;
    background: rgba(231, 76, 60, 0.08);
    border-top: 1px solid rgba(231, 76, 60, 0.2);
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .flow-error span { flex: 1; }
  .flow-error-close {
    background: none;
    border: none;
    color: #e74c3c;
    font-size: 14px;
    line-height: 1;
    padding: 0 2px;
    cursor: pointer;
    opacity: 0.7;
    flex-shrink: 0;
  }
  .flow-error-close:hover { opacity: 1; }
  .pkg-subtabs {
    display: flex;
    background: var(--bg-page);
    border-bottom: 1px solid rgba(255,255,255,0.05);
    flex-shrink: 0;
  }
  .pkg-subtab {
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    padding: 3px 12px;
    font-size: 10px;
    font-family: "Space Grotesk", sans-serif;
    color: rgba(255,255,255,0.35);
    cursor: pointer;
    transition: color 0.1s;
  }
  .pkg-subtab:hover { color: rgba(255,255,255,0.7); }
  .pkg-subtab-active {
    color: #f6f1e8;
    border-bottom-color: #7ec96a;
  }
</style>
