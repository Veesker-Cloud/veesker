<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { EditorState } from "@codemirror/state";
  import { EditorView, keymap } from "@codemirror/view";
  import { defaultKeymap } from "@codemirror/commands";
  import { sql, PLSQL } from "@codemirror/lang-sql";
  import { oneDark } from "@codemirror/theme-one-dark";
  import { basicSetup } from "codemirror";

  type Props = {
    value: string;
    onChange: (sql: string) => void;
    onRun: () => void;
  };
  let { value, onChange, onRun }: Props = $props();

  let host: HTMLDivElement | undefined = $state();
  let view: EditorView | null = null;

  onMount(() => {
    if (!host) return;
    view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          sql({ dialect: PLSQL }),
          oneDark,
          keymap.of([
            { key: "Mod-Enter", run: () => { onRun(); return true; } },
            ...defaultKeymap,
          ]),
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
