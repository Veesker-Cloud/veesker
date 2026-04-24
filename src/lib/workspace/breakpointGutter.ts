import { gutter, GutterMarker, EditorView } from "@codemirror/view";
import { StateField, StateEffect, RangeSet } from "@codemirror/state";

export const toggleBreakpointEffect = StateEffect.define<number>();

export const breakpointState = StateField.define<ReadonlySet<number>>({
  create() {
    return new Set();
  },
  update(set, tr) {
    for (const e of tr.effects) {
      if (e.is(toggleBreakpointEffect)) {
        const next = new Set(set);
        if (next.has(e.value)) next.delete(e.value);
        else next.add(e.value);
        return next;
      }
    }
    return set;
  },
});

class BreakpointMarker extends GutterMarker {
  override toDOM() {
    const span = document.createElement("span");
    span.textContent = "●";
    span.className = "cm-bp-marker";
    span.style.fontSize = "10px";
    span.style.lineHeight = "1";
    return span;
  }
}

const breakpointMarker = new BreakpointMarker();

export function breakpointGutter(onToggle: (line: number) => void) {
  return [
    breakpointState,
    gutter({
      class: "cm-breakpoint-gutter",
      markers(view) {
        const bps = view.state.field(breakpointState);
        const items: Array<{ from: number; marker: GutterMarker }> = [];
        for (const lineNum of bps) {
          if (lineNum < 1 || lineNum > view.state.doc.lines) continue;
          const line = view.state.doc.line(lineNum);
          items.push({ from: line.from, marker: breakpointMarker });
        }
        return RangeSet.of(
          items.map((m) => breakpointMarker.range(m.from)),
          true,
        );
      },
      domEventHandlers: {
        mousedown(view, line) {
          const lineNum = view.state.doc.lineAt(line.from).number;
          view.dispatch({ effects: toggleBreakpointEffect.of(lineNum) });
          onToggle(lineNum);
          return true;
        },
      },
    }),
    EditorView.baseTheme({
      ".cm-bp-marker": { color: "var(--text-danger, #e74c3c)", cursor: "pointer" },
    }),
  ];
}
