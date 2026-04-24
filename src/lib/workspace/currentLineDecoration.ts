import { Decoration, EditorView } from "@codemirror/view";
import { StateField, StateEffect } from "@codemirror/state";

export const setCurrentLineEffect = StateEffect.define<number | null>();

const currentLineState = StateField.define<number | null>({
  create() {
    return null;
  },
  update(val, tr) {
    for (const e of tr.effects) {
      if (e.is(setCurrentLineEffect)) return e.value;
    }
    return val;
  },
});

const currentLineMark = Decoration.line({ class: "cm-debug-current-line" });

export const currentLineDecoration = [
  currentLineState,
  EditorView.decorations.compute([currentLineState], (state) => {
    const lineNum = state.field(currentLineState);
    if (!lineNum || lineNum < 1 || lineNum > state.doc.lines) {
      return Decoration.none;
    }
    const line = state.doc.line(lineNum);
    return Decoration.set([currentLineMark.range(line.from)]);
  }),
  EditorView.baseTheme({
    ".cm-debug-current-line": {
      backgroundColor: "rgba(255, 200, 0, 0.18)",
      borderLeft: "3px solid #f1c40f",
    },
  }),
];

export { currentLineState };
