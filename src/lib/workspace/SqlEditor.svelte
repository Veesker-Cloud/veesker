<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { EditorState, Prec } from "@codemirror/state";
  import { EditorView, keymap } from "@codemirror/view";
  import { sql, PLSQL } from "@codemirror/lang-sql";
  import { oneDark } from "@codemirror/theme-one-dark";
  import { basicSetup } from "codemirror";

  type Props = {
    value: string;
    onChange: (sql: string) => void;
    /** Called for Mod+Enter. selection is the selected text (or null if no selection). */
    onRunCursor: (selection: string | null, cursorPos: number, docText: string) => void;
    /** Called for Mod+Shift+Enter and F5 — runs all statements. */
    onRunAll: () => void;
  };
  let { value, onChange, onRunCursor, onRunAll }: Props = $props();

  let host: HTMLDivElement | undefined = $state();
  let view: EditorView | null = null;

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
            ])
          ),
          basicSetup,
          sql({ dialect: PLSQL }),
          oneDark,
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
</style>
