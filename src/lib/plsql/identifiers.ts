const KEYWORDS = new Set([
  "procedure","function","package","body","trigger","type","object",
  "is","as","begin","end","declare","return","returns",
  "in","out","number","varchar2","varchar","char","nchar","nvarchar2","date","boolean","timestamp",
  "pls_integer","binary_integer","integer","float","decimal","long","clob","blob","nclob",
  "rowid","urowid","raw","sys_refcursor","ref","cursor","subtype","record","table","varray",
  "if","then","else","elsif","loop","for","while","exit","continue",
  "exception","when","others","null","true","false","default",
  "insert","update","delete","select","from","where","and","or","not","between","like",
  "into","values","set","commit","rollback","savepoint","lock","order","by","group","having",
  "union","intersect","minus","distinct","all","asc","desc","join","on","left","right","outer","inner",
  "raise","raise_application_error","pragma","autonomous_transaction",
  "case","open","close","fetch","bulk","collect","forall","using","execute","immediate",
  "sql","sqlcode","sqlerrm","dual","with","connect","prior","start","level",
  "pipelined","deterministic","result_cache",
  "constant","nocopy","any","array","authid","current_user","definer",
]);

function isKeyword(word: string): boolean {
  return KEYWORDS.has(word.toLowerCase());
}

function isValidIdent(word: string): boolean {
  return /^[a-zA-Z_]\w*$/.test(word) && !isKeyword(word);
}

export function extractPlsqlIdentifiers(source: string): string[] {
  const clean = source
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ");

  const names = new Set<string>();

  const sig = /\b(?:PROCEDURE|FUNCTION)\s+[a-zA-Z_]\w*\s*\(([\s\S]*?)\)(?:\s+RETURN\s+[\w\s.%()]+?)?\s*(?:IS|AS)\b/i.exec(clean);
  if (sig) {
    for (const rawLine of sig[1].split(",")) {
      const m = /^\s*([a-zA-Z_]\w*)\s+/.exec(rawLine);
      if (m && isValidIdent(m[1])) names.add(m[1].toLowerCase());
    }
  }

  const decl = /\b(?:IS|AS)\b([\s\S]*?)\bBEGIN\b/i.exec(clean);
  if (decl) {
    for (const stmt of decl[1].split(";")) {
      const m = /^\s*([a-zA-Z_]\w*)\s+(?:CONSTANT\s+)?[a-zA-Z_]/i.exec(stmt.trim());
      if (m && isValidIdent(m[1])) names.add(m[1].toLowerCase());
    }
  }

  return [...names];
}

export function identifierAt(line: string, col: number): { word: string; start: number; end: number } | null {
  let start = col, end = col;
  while (start > 0 && /\w/.test(line[start - 1])) start--;
  while (end < line.length && /\w/.test(line[end])) end++;
  if (start === end) return null;
  const word = line.slice(start, end);
  if (!isValidIdent(word)) return null;
  return { word, start, end };
}
