import { hoverTooltip } from "@codemirror/view";
import { debugStore } from "$lib/stores/debug.svelte";
import { debugGetValuesRpc } from "$lib/workspace";
import { identifierAt } from "$lib/plsql/identifiers";

export const debugHoverTooltip = hoverTooltip(async (view, pos) => {
  if (debugStore.status !== "paused") return null;

  const lineObj = view.state.doc.lineAt(pos);
  const col = pos - lineObj.from;
  const hit = identifierAt(lineObj.text, col);
  if (!hit) return null;

  const res = await debugGetValuesRpc([hit.word]);
  if (!res.ok) return null;
  const v = res.data.variables[0];
  if (!v || v.value === null || v.value === undefined) return null;

  return {
    pos: lineObj.from + hit.start,
    end: lineObj.from + hit.end,
    above: true,
    create() {
      const dom = document.createElement("div");
      dom.className = "cm-debug-hover";
      const name = document.createElement("span");
      name.className = "cm-debug-hover-name";
      name.textContent = hit.word;
      const sep = document.createElement("span");
      sep.className = "cm-debug-hover-sep";
      sep.textContent = " = ";
      const val = document.createElement("span");
      val.className = "cm-debug-hover-value";
      val.textContent = v.value;
      dom.append(name, sep, val);
      return { dom };
    },
  };
}, { hoverTime: 200 });
