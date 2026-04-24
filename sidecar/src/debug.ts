import oracledb from "oracledb";
import { withActiveSession } from "./oracle";

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

    if (dt === "BOOLEAN" || dt === "PL/SQL BOOLEAN") {
      declares.push(`  ${localVar} BOOLEAN;`);
      declares.push(
        `  -- Convert :${bind} ('TRUE'/'FALSE'/NULL) to BOOLEAN\n` +
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
        dt === "NUMBER" || dt === "INTEGER" || dt === "BINARY_INTEGER"
          ? "NUMBER"
          : dt === "DATE"
            ? "DATE"
            : `VARCHAR2(32767)`;
      declares.push(`  ${localVar} ${safeType} := :${bind};`);
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

// ── debug.open ─────────────────────────────────────────────────────────────

export type DebugOpenParams = {
  owner: string;
  objectName: string;
  objectType: string;
  packageName?: string | null;
};

export type DebugOpenResult = {
  script: string;
  params: ParamDef[];
  memberList?: string[];
};

export async function debugOpen(p: DebugOpenParams): Promise<DebugOpenResult> {
  return withActiveSession(async (conn) => {
    const packageBind = p.packageName ?? null;
    const res = await conn.execute<{
      ARGUMENT_NAME: string;
      DATA_TYPE: string;
      IN_OUT: string;
      POSITION: number;
    }>(
      `SELECT argument_name, data_type, in_out, position
         FROM all_arguments
        WHERE owner        = UPPER(:owner)
          AND object_name  = UPPER(:objectName)
          AND (package_name = UPPER(:packageName) OR
               (:packageName IS NULL AND package_name IS NULL))
          AND overload IS NULL
          AND argument_name IS NOT NULL
        ORDER BY position`,
      {
        owner: p.owner,
        objectName: p.objectName,
        packageName: packageBind,
      },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const params: ParamDef[] = (res.rows ?? []).map((r) => ({
      name: r.ARGUMENT_NAME,
      dataType: r.DATA_TYPE,
      inOut: r.IN_OUT as ParamDef["inOut"],
      position: r.POSITION,
    }));

    const script = generateTestBlock(
      p.owner,
      p.objectName,
      p.packageName ?? null,
      params
    );

    let memberList: string[] | undefined;
    if (p.objectType.toUpperCase() === "PACKAGE") {
      const membRes = await conn.execute<{ OBJECT_NAME: string }>(
        `SELECT DISTINCT object_name
           FROM all_arguments
          WHERE owner        = UPPER(:owner)
            AND package_name = UPPER(:packageName)
          ORDER BY object_name`,
        { owner: p.owner, packageName: p.objectName },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      memberList = (membRes.rows ?? []).map((r) => r.OBJECT_NAME);
    }

    return { script, params, memberList };
  });
}

// ── debug.getSource ────────────────────────────────────────────────────────

export type DebugGetSourceParams = {
  owner: string;
  objectName: string;
  objectType: string;
};

export async function debugGetSource(
  p: DebugGetSourceParams
): Promise<{ lines: string[] }> {
  return withActiveSession(async (conn) => {
    const res = await conn.execute<{ TEXT: string }>(
      `SELECT text
         FROM all_source
        WHERE owner = UPPER(:owner)
          AND name  = UPPER(:name)
          AND type  = UPPER(:type)
        ORDER BY line`,
      { owner: p.owner, name: p.objectName, type: p.objectType },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    return { lines: (res.rows ?? []).map((r) => r.TEXT) };
  });
}
