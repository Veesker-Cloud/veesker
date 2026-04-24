import oracledb from "oracledb";
import { getActiveSession, setSession, clearSession, hasSession } from "./state";
import { RpcCodedError, SESSION_LOST, ORACLE_ERR } from "./errors";

// ── Types ──────────────────────────────────────────────────────────────────

export type ParamDef = {
  name: string;
  dataType: string;
  inOut: "IN" | "OUT" | "IN/OUT";
  position: number;
};

export type DebugBreakpoint = {
  id: number;
  owner: string;
  objectName: string;
  objectType: string;
  line: number;
};

export type StackFrame = {
  owner: string;
  objectName: string;
  objectType: string;
  line: number;
};

export type VarValue = {
  name: string;
  value: string | null;
};

export type PauseInfo = {
  status: "paused" | "completed" | "error";
  frame: StackFrame | null;
  reason: number;
  errorMessage?: string;
};

// ── Block generator ────────────────────────────────────────────────────────

const COMPLEX_TYPES = new Set([
  "RECORD", "TABLE", "VARRAY", "OBJECT", "REF",
]);

function lowerBind(name: string): string {
  return name.toLowerCase();
}

export function generateTestBlock(
  owner: string,
  procName: string,
  packageName: string | null,
  params: ParamDef[]
): string {
  const callTarget = packageName
    ? `${owner}.${packageName}.${procName}`
    : `${owner}.${procName}`;

  if (params.length === 0) {
    return `BEGIN\n  ${callTarget}();\nEND;`;
  }

  const declares: string[] = [];
  const callArgs: string[] = [];
  const postCall: string[] = [];

  for (const p of params) {
    const bind = lowerBind(p.name);
    const localVar = `v_${bind}`;
    const dt = p.dataType.toUpperCase();

    if (dt === "BOOLEAN") {
      declares.push(`  ${localVar} BOOLEAN;`);
      declares.push(
        `  ${localVar} := CASE UPPER(:${bind}) WHEN 'TRUE' THEN TRUE WHEN 'FALSE' THEN FALSE ELSE NULL END;`
      );
      callArgs.push(`    ${bind} => ${localVar}`);
    } else if (COMPLEX_TYPES.has(dt)) {
      declares.push(`  ${localVar} ${p.dataType}; -- fill in`);
      callArgs.push(`    ${bind} => ${localVar}`);
    } else if (p.inOut === "IN") {
      callArgs.push(`    ${bind} => :${bind}`);
    } else if (p.inOut === "OUT") {
      const safeType =
        dt === "NUMBER" || dt === "INTEGER" || dt === "BINARY_INTEGER"
          ? "NUMBER"
          : dt === "DATE"
            ? "DATE"
            : `VARCHAR2(32767)`;
      declares.push(`  ${localVar} ${safeType};`);
      callArgs.push(`    ${bind} => ${localVar}`);
      postCall.push(`  :out_${bind} := ${localVar};`);
    } else {
      // IN/OUT
      const safeType =
        dt === "NUMBER" || dt === "INTEGER"
          ? "NUMBER"
          : dt === "DATE"
            ? "DATE"
            : `VARCHAR2(32767)`;
      declares.push(`  ${localVar} ${safeType};`);
      declares.push(`  ${localVar} := :${bind};`);
      callArgs.push(`    ${bind} => ${localVar}`);
      postCall.push(`  :out_${bind} := ${localVar};`);
    }
  }

  const declSection =
    declares.length > 0 ? `DECLARE\n${declares.join("\n")}\n` : "";
  const callSection = `  ${callTarget}(\n${callArgs.join(",\n")}\n  );`;
  const postSection = postCall.length > 0 ? "\n" + postCall.join("\n") : "";

  return `${declSection}BEGIN\n${callSection}${postSection}\nEND;`;
}
