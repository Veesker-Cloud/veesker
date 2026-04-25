import oracledb from "oracledb";
import { getActiveSession } from "./state";

export type OrdsDetectResult = {
  installed: boolean;
  version: string | null;
  currentSchemaEnabled: boolean;
  hasAdminRole: boolean;
  ordsBaseUrl: string | null;
};

export async function ordsDetect(_params: Record<string, unknown> = {}): Promise<OrdsDetectResult> {
  const conn = getActiveSession();

  const installedRes = await conn.execute<{ CNT: number; cnt?: number }>(
    `SELECT COUNT(*) AS cnt FROM all_objects
     WHERE owner='ORDS' AND object_name='ORDS' AND object_type='PACKAGE'`,
    [],
    { outFormat: oracledb.OUT_FORMAT_OBJECT }
  );
  const installedRow = installedRes.rows?.[0];
  const installedCnt = (installedRow?.CNT ?? installedRow?.cnt ?? 0) as number;
  const installed = installedCnt > 0;

  if (!installed) {
    return {
      installed: false,
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

  return { installed, version, currentSchemaEnabled, hasAdminRole, ordsBaseUrl };
}

export async function ordsModulesList(params: { owner: string }): Promise<{ name: string; basePath: string; status: string; itemsPerPage: number | null; comments: string | null }[]> {
  const conn = getActiveSession();
  const sql = `
    SELECT name, base_path AS "basePath", status,
           items_per_page AS "itemsPerPage", comments
    FROM   all_ords_modules
    WHERE  parsing_schema = :owner
    ORDER  BY name`;
  const res = await conn.execute<any>(
    sql,
    { owner: params.owner.toUpperCase() },
    { outFormat: oracledb.OUT_FORMAT_OBJECT }
  );
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

  const modRes = await conn.execute<any>(
    `SELECT name, base_path, status, items_per_page, comments
     FROM   all_ords_modules
     WHERE  parsing_schema = :owner AND name = :name`,
    { owner: params.owner.toUpperCase(), name: params.name },
    { outFormat: oracledb.OUT_FORMAT_OBJECT }
  );
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
