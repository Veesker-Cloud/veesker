<!--
  Copyright 2022-2026 Geraldo Ferreira Viana Júnior
  Licensed under the Apache License, Version 2.0
  https://github.com/gevianajr/veesker
-->

<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { EditorState, Compartment, Prec } from "@codemirror/state";
  import { EditorView, keymap } from "@codemirror/view";
  import { sql, PLSQL } from "@codemirror/lang-sql";
  import { oneDark } from "@codemirror/theme-one-dark";
  import { basicSetup } from "codemirror";
  import { lintGutter, setDiagnostics } from "@codemirror/lint";
  import { showMinimap } from "@replit/codemirror-minimap";
  import type { CompileError } from "$lib/workspace";
  import { costBadgeGutter, setCostBadgeEffect, type CostBadgeData } from "./CostBadgeGutter";
  import { makeAliasCompletionExtension } from "./sql-alias-completion";

  type Props = {
    value: string;
    onChange: (sql: string) => void;
    /** Called for Mod+Enter. selection is the selected text (or null if no selection). */
    onRunCursor: (selection: string | null, cursorPos: number, docText: string) => void;
    /** Called for Mod+Shift+Enter and F5 — runs all statements. */
    onRunAll: () => void;
    onSave: () => void;
    onSaveAs: () => void;
    onExplain: (sql: string) => void;
    compileErrors?: CompileError[] | null;
    completionSchema?: Record<string, string[]>;
    getColumns?: (table: string) => Promise<string[]>;
    costBadge?: CostBadgeData | null;
  };
  let { value, onChange, onRunCursor, onRunAll, onSave, onSaveAs, onExplain, compileErrors = null, completionSchema, getColumns, costBadge = null }: Props = $props();

  let host: HTMLDivElement | undefined = $state();
  let view: EditorView | null = null;
  const sqlLangCompartment = new Compartment();
  const aliasCompletionCompartment = new Compartment();

  export function gotoLine(n: number): void {
    if (!view) return;
    const lineNum = Math.max(1, Math.min(n, view.state.doc.lines));
    const line = view.state.doc.line(lineNum);
    view.dispatch({ selection: { anchor: line.from }, scrollIntoView: true });
    view.focus();
  }

  onMount(() => {
    if (!host) return;
    view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: value,
        extensions: [
          Prec.highest(
            keymap.of([
              {
                key: "Mod-Enter",
                preventDefault: true,
                run: (v) => {
                  const sel = v.state.selection.main;
                  if (sel.from !== sel.to) {
                    onRunCursor(v.state.sliceDoc(sel.from, sel.to), sel.from, v.state.doc.toString());
                  } else {
                    onRunCursor(null, sel.from, v.state.doc.toString());
                  }
                  return true;
                },
              },
              {
                key: "Mod-Shift-Enter",
                preventDefault: true,
                run: () => {
                  onRunAll();
                  return true;
                },
              },
              {
                key: "F5",
                preventDefault: true,
                run: () => {
                  onRunAll();
                  return true;
                },
              },
              {
                key: "Mod-s",
                preventDefault: true,
                run: () => { onSave(); return true; },
              },
              {
                key: "Mod-Shift-s",
                preventDefault: true,
                run: () => { onSaveAs(); return true; },
              },
              {
                key: "F6",
                preventDefault: true,
                run: (v) => {
                  const sel = v.state.selection.main;
                  const sql = sel.from !== sel.to
                    ? v.state.sliceDoc(sel.from, sel.to)
                    : v.state.doc.toString();
                  onExplain(sql);
                  return true;
                },
              },
            ])
          ),
          basicSetup,
          sqlLangCompartment.of(sql({ dialect: PLSQL })),
          aliasCompletionCompartment.of([]),
          oneDark,
          lintGutter(),
          costBadgeGutter(),
          showMinimap.of({
            create: () => ({ dom: document.createElement("div") }),
            displayText: "characters",
            showOverlay: "always",
          }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChange(u.state.doc.toString());
          }),
        ],
      }),
    });
  });

  onDestroy(() => {
    view?.destroy();
    view = null;
  });

  $effect(() => {
    if (view && view.state.doc.toString() !== value) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
      });
    }
  });

  $effect(() => {
    if (!view) return;
    if (!compileErrors || compileErrors.length === 0) {
      view.dispatch(setDiagnostics(view.state, []));
      return;
    }
    const diagnostics = compileErrors.map((err) => {
      const lineNum = Math.max(1, Math.min(err.line, view!.state.doc.lines));
      const line = view!.state.doc.line(lineNum);
      return {
        from: line.from,
        to: line.to,
        severity: "error" as const,
        message: err.text,
      };
    });
    view.dispatch(setDiagnostics(view.state, diagnostics));
  });

  $effect(() => {
    if (!view) return;
    view.dispatch({
      effects: sqlLangCompartment.reconfigure(
        completionSchema
          ? sql({ dialect: PLSQL, schema: completionSchema })
          : sql({ dialect: PLSQL })
      ),
    });
  });

  $effect(() => {
    if (!view) return;
    view.dispatch({
      effects: aliasCompletionCompartment.reconfigure(
        getColumns ? makeAliasCompletionExtension(getColumns) : []
      ),
    });
  });

  $effect(() => {
    if (!view) return;
    view.dispatch({ effects: setCostBadgeEffect.of(costBadge ?? null) });
  });
</script>

<div bind:this={host} class="editor-host"></div>

<style>
  .editor-host {
    height: 100%;
    width: 100%;
    overflow: hidden;
  }
  :global(.editor-host .cm-editor) {
    height: 100%;
    font-family: "JetBrains Mono", "SF Mono", monospace;
    font-size: 12.5px;
  }
  :global(.editor-host .cm-scroller) {
    overflow: auto;
  }
  :global(.editor-host .cm-cost-badge-gutter) {
    width: 38px;
    min-width: 38px;
  }
  :global(.editor-host .cost-badge) {
    display: inline-block;
    font-size: 9px;
    font-family: "JetBrains Mono", "SF Mono", monospace;
    border-radius: 3px;
    padding: 1px 4px;
    line-height: 14px;
    font-weight: 600;
    cursor: default;
    white-space: nowrap;
  }
  :global(.editor-host .cost-badge.cost-green) { background: rgba(126,201,106,0.15); color: #7ec96a; }
  :global(.editor-host .cost-badge.cost-yellow) { background: rgba(245,190,80,0.15); color: #f5be50; }
  :global(.editor-host .cost-badge.cost-red) { background: rgba(231,76,60,0.15); color: #e74c3c; }
  :global(.editor-host .cost-badge.cost-unknown) { background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.28); }
</style>
