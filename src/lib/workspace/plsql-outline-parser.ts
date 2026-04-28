export type OutlineItem = {
  kind: "PROCEDURE" | "FUNCTION" | "section";
  label: string;
  line: number;
};

const SUBPROGRAM_RE = /^\s*(PROCEDURE|FUNCTION)\s+(\w+)/i;
const SECTION_STANDALONE_RE = /^\s*(BEGIN|EXCEPTION)\s*$/i;
const SECTION_INLINE_RE = /\b(IS|AS)\s*$/i;
const HEADER_NAME_RE = /(?:PROCEDURE|FUNCTION|TRIGGER|TYPE)\s+(\w+)/i;

export function extractSubprograms(ddl: string): OutlineItem[] {
  const lines = ddl.split("\n");
  const items: OutlineItem[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = SUBPROGRAM_RE.exec(lines[i]);
    if (m) {
      items.push({
        kind: m[1].toUpperCase() as "PROCEDURE" | "FUNCTION",
        label: m[2].toUpperCase(),
        line: i + 1,
      });
    }
  }
  return items;
}

export function extractSections(ddl: string): OutlineItem[] {
  const lines = ddl.split("\n");
  const headerMatch = HEADER_NAME_RE.exec(lines[0] ?? "");
  const items: OutlineItem[] = [
    { kind: "section", label: headerMatch ? headerMatch[1].toUpperCase() : "Definition", line: 1 },
  ];
  const inlineOnFirst = SECTION_INLINE_RE.exec(lines[0] ?? "");
  if (inlineOnFirst) {
    items.push({ kind: "section", label: inlineOnFirst[1].toUpperCase(), line: 1 });
  }
  for (let i = 1; i < lines.length; i++) {
    const ms = SECTION_STANDALONE_RE.exec(lines[i]);
    if (ms) {
      items.push({ kind: "section", label: ms[1].toUpperCase(), line: i + 1 });
      continue;
    }
    const mi = SECTION_INLINE_RE.exec(lines[i]);
    if (mi) {
      items.push({ kind: "section", label: mi[1].toUpperCase(), line: i + 1 });
    }
  }
  return items;
}
