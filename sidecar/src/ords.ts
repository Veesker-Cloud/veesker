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
