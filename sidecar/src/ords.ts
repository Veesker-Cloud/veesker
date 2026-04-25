import oracledb from "oracledb";
import { getActiveSession } from "./state";

export type OrdsDetectResult = {
  installed: boolean;          // ORDS package exists somewhere in DB
  userHasAccess: boolean;      // Current user can call ORDS/OAUTH packages
  version: string | null;
  currentSchemaEnabled: boolean;
  hasAdminRole: boolean;
  ordsBaseUrl: string | null;
};

// ORA-00942: table or view does not exist
// ORA-04043: object does not exist
// PLS-00201: identifier must be declared
function isOrdsNotAccessible(err: any): boolean {
  const msg = String(err?.message ?? err);
  return msg.includes("ORA-00942") || msg.includes("ORA-04043") || msg.includes("PLS-00201");
}

export async function ordsDetect(_params: Record<string, unknown> = {}): Promise<OrdsDetectResult> {
  const conn = getActiveSession();

  // Stage 1: ORDS package exists anywhere in the DB?
  let installed = false;
  try {
    const r = await conn.execute<any>(
      `SELECT COUNT(*) AS cnt FROM all_objects
       WHERE object_name='ORDS' AND object_type='PACKAGE' AND ROWNUM=1`,
      [],
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const row = r.rows?.[0];
    installed = ((row?.CNT ?? row?.cnt ?? 0) as number) > 0;
  } catch {
    installed = false;
  }

  // Stage 2: Can the current user actually call ORDS APIs?
  // Probes the dictionary view that comes with ORDS-enabled schemas.
  let userHasAccess = false;
  if (installed) {
    try {
      await conn.execute(
        `SELECT 1 FROM user_ords_schemas WHERE ROWNUM=0`,
        [],
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      userHasAccess = true;
    } catch (e) {
      if (!isOrdsNotAccessible(e)) throw e;
      userHasAccess = false;
    }
  }

  if (!installed || !userHasAccess) {
    return {
      installed,
      userHasAccess,
      version: null,
      currentSchemaEnabled: false,
      hasAdminRole: false,
      ordsBaseUrl: null,
    };
  }

  let version: string | null = null;
  try {
    const verRes = await conn.execute<{ V: string; v?: string }>(
      `SELECT ords.installed_version AS v FROM dual`,
      [],
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const verRow = verRes.rows?.[0];
    version = (verRow?.V ?? verRow?.v ?? null) as string | null;
  } catch {
    version = null;
  }

  let currentSchemaEnabled = false;
  try {
    const enabledRes = await conn.execute<{ CNT: number; cnt?: number }>(
      `SELECT COUNT(*) AS cnt FROM user_ords_schemas`,
      [],
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const enabledRow = enabledRes.rows?.[0];
    const enabledCnt = (enabledRow?.CNT ?? enabledRow?.cnt ?? 0) as number;
    currentSchemaEnabled = enabledCnt > 0;
  } catch {
    /* not enabled */
  }

  let hasAdminRole = false;
  try {
    const privRes = await conn.execute<{ CNT: number; cnt?: number }>(
      `SELECT COUNT(*) AS cnt FROM session_roles
       WHERE role IN ('ORDS_ADMINISTRATOR_ROLE', 'DBA')`,
      [],
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const privRow = privRes.rows?.[0];
    const privCnt = (privRow?.CNT ?? privRow?.cnt ?? 0) as number;
    hasAdminRole = privCnt > 0;
  } catch {
    /* assume false */
  }

  let ordsBaseUrl: string | null = null;
  try {
    const urlRes = await conn.execute<{ V: string; v?: string }>(
      `SELECT value AS v FROM ords_metadata.ords_properties
       WHERE name='security.host.url'`,
      [],
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const urlRow = urlRes.rows?.[0];
    ordsBaseUrl = (urlRow?.V ?? urlRow?.v ?? null) as string | null;
  } catch {
    /* user may not have access */
  }

  return { installed, userHasAccess, version, currentSchemaEnabled, hasAdminRole, ordsBaseUrl };
}

export async function ordsModulesList(params: { owner: string }): Promise<{ name: string; basePath: string; status: string; itemsPerPage: number | null; comments: string | null }[]> {
  const conn = getActiveSession();
  const sql = `
    SELECT name, base_path AS "basePath", status,
           items_per_page AS "itemsPerPage", comments
    FROM   all_ords_modules
    WHERE  parsing_schema = :owner
    ORDER  BY name`;
  let res: any;
  try {
    res = await conn.execute<any>(
      sql,
      { owner: params.owner.toUpperCase() },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
  } catch (e) {
    if (isOrdsNotAccessible(e)) return [];
    throw e;
  }
  return (res.rows ?? []).map((r: any) => ({
    name: r.NAME ?? r.name,
    basePath: r.basePath ?? r.BASEPATH ?? r.BASE_PATH ?? r.base_path,
    status: r.STATUS ?? r.status,
    itemsPerPage: r.itemsPerPage ?? r.ITEMSPERPAGE ?? r.ITEMS_PER_PAGE ?? r.items_per_page ?? null,
    comments: r.COMMENTS ?? r.comments ?? null,
  }));
}

export async function ordsModuleGet(params: { owner: string; name: string }): Promise<{
  module: { name: string; basePath: string; status: string; itemsPerPage: number | null; comments: string | null };
  templates: { uriTemplate: string; priority: number; handlers: { method: string; sourceType: string; source: string; itemsPerPage: number | null }[] }[];
  privileges: { name: string; roles: string[]; patterns: string[] }[];
}> {
  const conn = getActiveSession();

  let modRes: any;
  try {
    modRes = await conn.execute<any>(
      `SELECT name, base_path, status, items_per_page, comments
       FROM   all_ords_modules
       WHERE  parsing_schema = :owner AND name = :name`,
      { owner: params.owner.toUpperCase(), name: params.name },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
  } catch (e) {
    if (isOrdsNotAccessible(e)) {
      throw { code: -32014, message: "ORDS not configured for this schema. Use the ORDS bootstrap modal to enable it." };
    }
    throw e;
  }
  if (!modRes.rows || modRes.rows.length === 0) {
    throw { code: -32012, message: `Module ${params.name} not found` };
  }
  const m = modRes.rows[0];

  const tplRes = await conn.execute<any>(
    `SELECT t.id AS template_id, t.uri_template, t.priority,
            h.method, h.source_type, h.source,
            h.items_per_page AS handler_items_per_page
     FROM   all_ords_templates t
     LEFT JOIN all_ords_handlers h ON h.template_id = t.id
     WHERE  t.parsing_schema = :owner AND t.module_name = :name
     ORDER  BY t.uri_template, h.method`,
    { owner: params.owner.toUpperCase(), name: params.name },
    { outFormat: oracledb.OUT_FORMAT_OBJECT }
  );

  const templatesMap = new Map<string, any>();
  for (const row of (tplRes.rows ?? [])) {
    const uri = row.URI_TEMPLATE ?? row.uri_template;
    if (!templatesMap.has(uri)) {
      templatesMap.set(uri, {
        uriTemplate: uri,
        priority: row.PRIORITY ?? row.priority ?? 0,
        handlers: [],
      });
    }
    const method = row.METHOD ?? row.method;
    if (method) {
      templatesMap.get(uri).handlers.push({
        method,
        sourceType: row.SOURCE_TYPE ?? row.source_type,
        source: row.SOURCE ?? row.source ?? "",
        itemsPerPage: row.handler_items_per_page ?? row.HANDLER_ITEMS_PER_PAGE ?? null,
      });
    }
  }

  const privRes = await conn.execute<any>(
    `SELECT p.name,
            LISTAGG(DISTINCT pr.role, ',') WITHIN GROUP (ORDER BY pr.role) AS roles,
            LISTAGG(DISTINCT pp.pattern, ',') WITHIN GROUP (ORDER BY pp.pattern) AS patterns
     FROM   all_ords_privileges p
     LEFT JOIN all_ords_privileges_roles pr ON pr.privilege_id = p.id
     LEFT JOIN all_ords_privileges_patterns pp ON pp.privilege_id = p.id
     WHERE  p.parsing_schema = :owner
     GROUP  BY p.name`,
    { owner: params.owner.toUpperCase() },
    { outFormat: oracledb.OUT_FORMAT_OBJECT }
  );
  const privileges = (privRes.rows ?? []).map((r: any) => ({
    name: r.NAME ?? r.name,
    roles: ((r.ROLES ?? r.roles ?? "") as string).split(",").filter(Boolean),
    patterns: ((r.PATTERNS ?? r.patterns ?? "") as string).split(",").filter(Boolean),
  }));

  return {
    module: {
      name: m.NAME ?? m.name,
      basePath: m.BASE_PATH ?? m.base_path,
      status: m.STATUS ?? m.status,
      itemsPerPage: m.ITEMS_PER_PAGE ?? m.items_per_page ?? null,
      comments: m.COMMENTS ?? m.comments ?? null,
    },
    templates: Array.from(templatesMap.values()),
    privileges,
  };
}

export async function ordsEnableSchema(_params: Record<string, unknown> = {}): Promise<{ ok: true }> {
  const conn = getActiveSession();
  await conn.execute(`BEGIN ORDS.ENABLE_SCHEMA(p_enabled => TRUE); COMMIT; END;`, []);
  return { ok: true };
}

export async function ordsModuleExportSql(params: { owner: string; name: string }): Promise<{ sql: string }> {
  const detail = await ordsModuleGet(params);
  const lines: string[] = [];
  const today = new Date().toISOString().slice(0, 10);
  lines.push(`-- Generated by Veesker VRAS on ${today}`);
  lines.push(`-- Module: ${detail.module.name}`);
  lines.push(`-- Source schema: ${params.owner}`);
  lines.push("");
  lines.push("BEGIN");
  lines.push(`  ORDS.DEFINE_MODULE(`);
  lines.push(`    p_module_name    => ${sqlString(detail.module.name)},`);
  lines.push(`    p_base_path      => ${sqlString(detail.module.basePath)},`);
  if (detail.module.itemsPerPage !== null) {
    lines.push(`    p_items_per_page => ${detail.module.itemsPerPage},`);
  }
  lines.push(`    p_status         => ${sqlString(detail.module.status)});`);
  lines.push("");

  for (const tpl of detail.templates) {
    lines.push(`  ORDS.DEFINE_TEMPLATE(`);
    lines.push(`    p_module_name => ${sqlString(detail.module.name)},`);
    lines.push(`    p_pattern     => ${sqlString(tpl.uriTemplate)});`);
    for (const h of tpl.handlers) {
      lines.push(`  ORDS.DEFINE_HANDLER(`);
      lines.push(`    p_module_name => ${sqlString(detail.module.name)},`);
      lines.push(`    p_pattern     => ${sqlString(tpl.uriTemplate)},`);
      lines.push(`    p_method      => ${sqlString(h.method)},`);
      lines.push(`    p_source_type => ${sqlString(h.sourceType)},`);
      lines.push(`    p_source      => ${sqlMultiline(h.source)});`);
    }
    lines.push("");
  }

  for (const priv of detail.privileges) {
    if (priv.roles.length === 0 && priv.patterns.length === 0) continue;
    lines.push(`  ORDS.DEFINE_PRIVILEGE(`);
    lines.push(`    p_privilege_name => ${sqlString(priv.name)},`);
    if (priv.roles.length > 0) {
      const rolesArr = priv.roles.map(sqlString).join(", ");
      lines.push(`    p_roles          => ORDS_TYPES.role_array(${rolesArr}),`);
    }
    if (priv.patterns.length > 0) {
      const patternsArr = priv.patterns.map(sqlString).join(", ");
      lines.push(`    p_patterns       => ORDS_TYPES.pattern_array(${patternsArr}));`);
    } else {
      lines.push(`    p_patterns       => ORDS_TYPES.pattern_array());`);
    }
    lines.push("");
  }

  lines.push("  COMMIT;");
  lines.push("END;");
  lines.push("/");

  return { sql: lines.join("\n") };
}

export async function ordsRolesList(_params: Record<string, unknown> = {}): Promise<{ roles: string[] }> {
  const conn = getActiveSession();
  let res: any;
  try {
    res = await conn.execute<any>(
      `SELECT role_name FROM all_ords_roles ORDER BY role_name`,
      [],
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
  } catch (e) {
    if (isOrdsNotAccessible(e)) return { roles: [] };
    throw e;
  }
  return { roles: (res.rows ?? []).map((r: any) => (r.ROLE_NAME ?? r.role_name) as string) };
}

/**
 * Applies an ORDS endpoint by REGENERATING the SQL server-side from the same
 * config that was passed to ordsGenerateSql. This closes a privilege-escalation
 * hole where a compromised renderer could submit arbitrary PL/SQL via the
 * earlier `{ sql: string }` contract — bypassing every validator in the
 * generators above.
 *
 * The frontend passes back the original config (not a SQL string) and the
 * server is the single source of truth for what executes.
 */
export async function ordsApply(params: any): Promise<{ ok: true; sql: string }> {
  const { sql } = await ordsGenerateSql(params);
  const conn = getActiveSession();
  try {
    await conn.execute(sql, []);
  } catch (e) {
    if (isOrdsNotAccessible(e)) {
      throw {
        code: -32014,
        message: "ORDS package not accessible. Enable the schema for ORDS first (Bootstrap ORDS).",
      };
    }
    throw e;
  }
  return { ok: true, sql };
}

function sqlString(s: string): string {
  if (s === null || s === undefined) return "''";
  // Escape single quotes by doubling. Reject control characters and embedded NULs
  // that would break the SQL parser or produce surprising behavior.
  if (/[ --]/.test(s)) {
    throw { code: -32602, message: "ORDS string contains illegal control characters" };
  }
  return `'${s.replace(/'/g, "''")}'`;
}

function sqlMultiline(s: string): string {
  if (s === null || s === undefined) return "''";
  // q'[...]'  — choose a closer the source body cannot contain. Try several brackets
  // before falling back to single-quote escaping. Plus reject NUL bytes.
  if (/ /.test(s)) {
    throw { code: -32602, message: "ORDS source body contains NUL byte" };
  }
  for (const [open, close] of [["[", "]"], ["{", "}"], ["(", ")"], ["<", ">"]]) {
    if (!s.includes(`${close}'`)) {
      return `q'${open}${s}${close}'`;
    }
  }
  return sqlString(s);
}

/**
 * Validates that `s` is a safe Oracle identifier (schema/object/alias/module name)
 * before being interpolated into a generator. Rejects empty strings, leading
 * digits, and anything outside [A-Za-z0-9_$#-/]. The leniency on '-' and '/' is
 * required for ORDS aliases and route patterns; everything else is strict
 * Oracle identifier shape.
 */
function validateOrdsName(kind: string, s: unknown): string {
  if (typeof s !== "string" || s.length === 0) {
    throw { code: -32602, message: `ORDS ${kind} is required` };
  }
  if (s.length > 128) {
    throw { code: -32602, message: `ORDS ${kind} too long (max 128 chars)` };
  }
  if (!/^[A-Za-z0-9_$#\-./]+$/.test(s)) {
    throw {
      code: -32602,
      message: `ORDS ${kind} contains illegal characters (allowed: A-Z 0-9 _ $ # - . /)`,
    };
  }
  return s;
}

/**
 * Normalizes an authMode + authRole pair, defaulting to oauth when not specified
 * (defense-in-depth — never publish unauthenticated endpoints by accident).
 * Use `none` only when params.authConfirmedNone === true AND authMode is explicitly "none".
 */
function normalizeAuth(params: any): { authMode: "none" | "role" | "oauth"; authRole: string | null } {
  const requested = params?.authMode;
  if (requested === "none") {
    if (params.authConfirmedNone !== true) {
      throw {
        code: -32602,
        message:
          "Refusing to publish unauthenticated ORDS endpoint without explicit confirmation. Pass authConfirmedNone:true to override.",
      };
    }
    return { authMode: "none", authRole: null };
  }
  if (requested === "role") {
    const role = validateOrdsName("authRole", params?.authRole);
    return { authMode: "role", authRole: role };
  }
  // Default: oauth (safest)
  return { authMode: "oauth", authRole: null };
}

// ── SQL Generators ────────────────────────────────────────────────────────────

export type AutoCrudParams = {
  schema: string;
  objectName: string;
  objectType: "TABLE" | "VIEW";
  alias: string;
  authMode: "none" | "role" | "oauth";
  authRole?: string | null;
};

export function generateAutoCrudSql(p: AutoCrudParams): string {
  const lines: string[] = ["BEGIN"];
  lines.push("  ORDS.ENABLE_OBJECT(");
  lines.push("    p_enabled        => TRUE,");
  lines.push(`    p_schema         => ${sqlString(p.schema)},`);
  lines.push(`    p_object         => ${sqlString(p.objectName)},`);
  lines.push(`    p_object_type    => ${sqlString(p.objectType)},`);
  lines.push(`    p_object_alias   => ${sqlString(p.alias)},`);
  lines.push(`    p_auto_rest_auth => ${p.authMode === "none" ? "FALSE" : "TRUE"});`);
  if (p.authMode === "role" && p.authRole) {
    lines.push("");
    lines.push("  ORDS.DEFINE_PRIVILEGE(");
    lines.push(`    p_privilege_name => ${sqlString(p.alias + "_priv")},`);
    lines.push(`    p_roles          => ORDS_TYPES.role_array(${sqlString(p.authRole)}),`);
    lines.push(`    p_patterns       => ORDS_TYPES.pattern_array(${sqlString("/" + p.alias + "/*")}));`);
  }
  lines.push("");
  lines.push("  COMMIT;");
  lines.push("END;");
  return lines.join("\n");
}

export type CustomSqlParams = {
  moduleName: string;
  basePath: string;
  routePattern: string;
  method: string;
  source: string;
  authMode: "none" | "role" | "oauth";
  authRole?: string | null;
};

export function generateCustomSqlEndpoint(p: CustomSqlParams): string {
  const lines: string[] = ["BEGIN"];
  lines.push("  ORDS.DEFINE_MODULE(");
  lines.push(`    p_module_name    => ${sqlString(p.moduleName)},`);
  lines.push(`    p_base_path      => ${sqlString(p.basePath)},`);
  lines.push("    p_items_per_page => 25);");
  lines.push("");
  lines.push("  ORDS.DEFINE_TEMPLATE(");
  lines.push(`    p_module_name => ${sqlString(p.moduleName)},`);
  lines.push(`    p_pattern     => ${sqlString(p.routePattern)});`);
  lines.push("");
  const sourceType = p.method.toUpperCase() === "GET"
    ? "ORDS.source_type_collection"
    : "ORDS.source_type_plsql";
  lines.push("  ORDS.DEFINE_HANDLER(");
  lines.push(`    p_module_name => ${sqlString(p.moduleName)},`);
  lines.push(`    p_pattern     => ${sqlString(p.routePattern)},`);
  lines.push(`    p_method      => ${sqlString(p.method.toUpperCase())},`);
  lines.push(`    p_source_type => ${sourceType},`);
  lines.push(`    p_source      => ${sqlMultiline(p.source)});`);
  if (p.authMode === "role" && p.authRole) {
    lines.push("");
    lines.push("  ORDS.DEFINE_PRIVILEGE(");
    lines.push(`    p_privilege_name => ${sqlString(p.moduleName + "_priv")},`);
    lines.push(`    p_roles          => ORDS_TYPES.role_array(${sqlString(p.authRole)}),`);
    lines.push(`    p_patterns       => ORDS_TYPES.pattern_array(${sqlString(p.basePath.replace(/\/$/, "") + "/*")}));`);
  }
  lines.push("");
  lines.push("  COMMIT;");
  lines.push("END;");
  return lines.join("\n");
}

export type ProcedureEndpointParams = {
  moduleName: string;
  basePath: string;
  routePattern: string;
  method: string;
  schema: string;
  procName: string;
  packageName: string | null;
  params: { name: string; argMode: "IN" | "OUT" | "IN/OUT"; dataType: string }[];
  hasReturn: boolean;
  authMode: "none" | "role" | "oauth";
  authRole?: string | null;
};

function normalizePlsqlType(dt: string): string {
  const t = dt.toUpperCase().trim();
  if (t === "REF CURSOR" || t === "PL/SQL CURSOR" || t === "CURSOR") return "SYS_REFCURSOR";
  if (t === "VARCHAR2" || t === "VARCHAR" || t === "CHAR" || t === "NVARCHAR2") return `${t}(4000)`;
  return t;
}

export function generateProcedureEndpoint(p: ProcedureEndpointParams): string {
  const lines: string[] = ["BEGIN"];
  lines.push("  ORDS.DEFINE_MODULE(");
  lines.push(`    p_module_name    => ${sqlString(p.moduleName)},`);
  lines.push(`    p_base_path      => ${sqlString(p.basePath)});`);
  lines.push("");
  lines.push("  ORDS.DEFINE_TEMPLATE(");
  lines.push(`    p_module_name => ${sqlString(p.moduleName)},`);
  lines.push(`    p_pattern     => ${sqlString(p.routePattern)});`);

  const fqn = p.packageName ? `${p.packageName}.${p.procName}` : p.procName;
  const outParams = p.params.filter((x) => x.argMode === "OUT" || x.argMode === "IN/OUT");

  const declareLines: string[] = [];
  for (const op of outParams) {
    declareLines.push(`  v_${op.name.toLowerCase()} ${normalizePlsqlType(op.dataType)};`);
  }
  if (p.hasReturn) declareLines.push("  v_result NUMBER;");

  const callArgs = p.params.map((par) => {
    const lower = par.name.toLowerCase();
    if (par.argMode === "OUT") return `    ${par.name} => v_${lower}`;
    if (par.argMode === "IN/OUT") return `    ${par.name} => v_${lower}`;
    return `    ${par.name} => :${lower}`;
  });

  // Build JSON output via APEX_JSON — handles VARCHAR2, NUMBER, DATE,
  // BOOLEAN, and SYS_REFCURSOR natively (cursors become JSON arrays).
  const printLines: string[] = [];
  printLines.push("  APEX_JSON.open_object;");
  for (const op of outParams) {
    const lower = op.name.toLowerCase();
    printLines.push(`  APEX_JSON.write('${lower}', v_${lower});`);
  }
  printLines.push("  APEX_JSON.close_object;");

  const wrapper = [
    "DECLARE",
    ...declareLines,
    "BEGIN",
    `  ${fqn}(`,
    callArgs.join(",\n"),
    "  );",
    "  :status_code := 200;",
    "  OWA_UTIL.mime_header('application/json', false);",
    "  OWA_UTIL.http_header_close;",
    ...printLines,
    "END;",
  ].join("\n");

  lines.push("");
  lines.push("  ORDS.DEFINE_HANDLER(");
  lines.push(`    p_module_name => ${sqlString(p.moduleName)},`);
  lines.push(`    p_pattern     => ${sqlString(p.routePattern)},`);
  lines.push(`    p_method      => ${sqlString(p.method.toUpperCase())},`);
  lines.push("    p_source_type => ORDS.source_type_plsql,");
  lines.push(`    p_source      => ${sqlMultiline(wrapper)});`);

  if (p.authMode === "role" && p.authRole) {
    lines.push("");
    lines.push("  ORDS.DEFINE_PRIVILEGE(");
    lines.push(`    p_privilege_name => ${sqlString(p.moduleName + "_priv")},`);
    lines.push(`    p_roles          => ORDS_TYPES.role_array(${sqlString(p.authRole)}),`);
    lines.push(`    p_patterns       => ORDS_TYPES.pattern_array(${sqlString(p.basePath.replace(/\/$/, "") + "/*")}));`);
  }

  lines.push("");
  lines.push("  COMMIT;");
  lines.push("END;");
  return lines.join("\n");
}

// ── Dispatcher RPC ────────────────────────────────────────────────────────────
// Translates from frontend BuilderConfig shape to generator-specific params.

import { procDescribe } from "./oracle";

export async function ordsGenerateSql(params: any): Promise<{ sql: string }> {
  const auth = normalizeAuth(params);

  if (params.type === "auto-crud") {
    if (!params.sourceObject) {
      throw { code: -32602, message: "Missing sourceObject for auto-crud endpoint" };
    }
    const schema = validateOrdsName("schema", params.sourceObject.owner);
    const objectName = validateOrdsName("objectName", params.sourceObject.name);
    const objectType = params.sourceObject.kind === "VIEW" ? "VIEW" : "TABLE";
    const aliasRaw = String(params.sourceObject.name).toLowerCase().replace(/_/g, "-");
    const alias = validateOrdsName("alias", aliasRaw);
    return {
      sql: generateAutoCrudSql({
        schema,
        objectName,
        objectType,
        alias,
        authMode: auth.authMode,
        authRole: auth.authRole,
      }),
    };
  }

  if (params.type === "custom-sql") {
    const moduleName = validateOrdsName("moduleName", params.moduleName);
    const basePath = validateOrdsName("basePath", params.basePath);
    const routePattern = validateOrdsName("routePattern", params.routePattern);
    const method = String(params.method ?? "GET").toUpperCase();
    if (!["GET", "POST", "PUT", "DELETE", "PATCH"].includes(method)) {
      throw { code: -32602, message: `Invalid HTTP method: ${method}` };
    }
    return {
      sql: generateCustomSqlEndpoint({
        moduleName,
        basePath,
        routePattern,
        method,
        source: params.sourceSql ?? "",
        authMode: auth.authMode,
        authRole: auth.authRole,
      }),
    };
  }

  if (params.type === "procedure") {
    if (!params.sourceObject) {
      throw { code: -32602, message: "Missing sourceObject for procedure endpoint" };
    }
    const moduleName = validateOrdsName("moduleName", params.moduleName);
    const basePath = validateOrdsName("basePath", params.basePath);
    const routePattern = validateOrdsName("routePattern", params.routePattern);
    const schema = validateOrdsName("schema", params.sourceObject.owner);
    const procName = validateOrdsName("procName", params.sourceObject.name);
    const method = String(params.method ?? "POST").toUpperCase();
    if (!["GET", "POST", "PUT", "DELETE", "PATCH"].includes(method)) {
      throw { code: -32602, message: `Invalid HTTP method: ${method}` };
    }
    const desc = await procDescribe({ owner: schema, name: procName });
    const procParams = (desc.params ?? []).map((p: any) => {
      // Procedure parameter names also flow into PL/SQL — validate them too.
      const name = validateOrdsName("procParam", p.name);
      return {
        name,
        argMode: (p.direction === "IN/OUT" ? "IN/OUT" : (p.direction as "IN" | "OUT" | "IN/OUT")),
        dataType: p.dataType as string,
      };
    });
    return {
      sql: generateProcedureEndpoint({
        moduleName,
        basePath,
        routePattern,
        method,
        schema,
        procName,
        packageName: null,
        params: procParams,
        hasReturn: false,
        authMode: auth.authMode,
        authRole: auth.authRole,
      }),
    };
  }

  throw { code: -32602, message: `Unknown endpoint type: ${params.type}` };
}

// ── OAuth Clients ─────────────────────────────────────────────────────────────

export type RestClient = {
  name: string;
  description: string | null;
  createdOn: string | null;
};

export async function ordsClientsList(_params: Record<string, unknown> = {}): Promise<{ clients: RestClient[] }> {
  const conn = getActiveSession();
  let res: any;
  try {
    res = await conn.execute<any>(
      `SELECT name, description, created_on FROM user_ords_clients ORDER BY name`,
      [],
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
  } catch (e) {
    if (isOrdsNotAccessible(e)) return { clients: [] };
    throw e;
  }
  return {
    clients: (res.rows ?? []).map((r: any) => ({
      name: r.NAME ?? r.name,
      description: r.DESCRIPTION ?? r.description ?? null,
      createdOn: r.CREATED_ON ? String(r.CREATED_ON) : (r.created_on ? String(r.created_on) : null),
    })),
  };
}

export async function ordsClientsCreate(params: {
  name: string;
  description: string;
  roles: string[];
}): Promise<{ clientId: string; clientSecret: string }> {
  const conn = getActiveSession();

  const sqlCreate = `BEGIN
    OAUTH.CREATE_CLIENT(
      p_name            => :name,
      p_grant_type      => 'client_credentials',
      p_owner           => USER,
      p_description     => :description,
      p_support_email   => NULL,
      p_privilege_names => NULL);
    COMMIT;
  END;`;
  try {
    await conn.execute(sqlCreate, {
      name: params.name,
      description: params.description ?? "",
    });
  } catch (e) {
    if (isOrdsNotAccessible(e)) {
      throw { code: -32014, message: "ORDS/OAUTH packages not accessible to this schema. Enable the schema for ORDS via the Bootstrap modal." };
    }
    throw e;
  }

  for (const role of params.roles) {
    await conn.execute(
      `BEGIN OAUTH.GRANT_CLIENT_ROLE(p_client_name => :n, p_role_name => :r); COMMIT; END;`,
      { n: params.name, r: role }
    );
  }

  const credsRes = await conn.execute<any>(
    `SELECT client_id, client_secret FROM user_ords_clients WHERE name = :name`,
    { name: params.name },
    { outFormat: oracledb.OUT_FORMAT_OBJECT }
  );
  const row = credsRes.rows?.[0];
  return {
    clientId: (row?.CLIENT_ID ?? row?.client_id ?? "") as string,
    clientSecret: (row?.CLIENT_SECRET ?? row?.client_secret ?? "") as string,
  };
}

export async function ordsClientsRevoke(params: { name: string }): Promise<{ ok: true }> {
  const conn = getActiveSession();
  await conn.execute(
    `BEGIN OAUTH.DELETE_CLIENT(p_name => :n); COMMIT; END;`,
    { n: params.name }
  );
  return { ok: true };
}
