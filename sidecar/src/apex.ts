// Copyright 2022-2026 Geraldo Ferreira Viana Junior
// Licensed under the Apache License, Version 2.0
// https://github.com/veesker-cloud/veesker-community-edition

import oracledb from "oracledb";
import { withActiveSession } from "./oracle";
import {
  apexCapabilitiesForVersion,
  isApexVersionAtLeast,
  type ApexCapability,
} from "./apex-utils";

export type ApexDetectResult = {
  installed: boolean;
  userHasAccess: boolean;
  version: string | null;
  supported: boolean;
  minSupportedVersion: "19.2";
  capabilities: ApexCapability[];
};

export type ApexWorkspaceRow = {
  workspace: string;
  workspaceId: number | null;
};

export type ApexApplicationRow = {
  workspace: string;
  applicationId: number;
  name: string;
  alias: string | null;
  owner: string | null;
};

export type ApexPageRow = {
  applicationId: number;
  pageId: number;
  name: string;
  alias: string | null;
  pageMode: string | null;
};

function isMissingOrDenied(err: unknown): boolean {
  const oraNum = (err as { errorNum?: number }).errorNum;
  return oraNum === 942 || oraNum === 1031 || oraNum === 904;
}

async function apexReleaseObjectExists(conn: oracledb.Connection): Promise<boolean> {
  const res = await conn.execute<Record<string, unknown>>(
    `SELECT COUNT(*) AS CNT
       FROM ALL_OBJECTS
      WHERE OBJECT_NAME = 'APEX_RELEASE'
        AND OBJECT_TYPE IN ('VIEW', 'SYNONYM')`,
    {},
    { outFormat: oracledb.OUT_FORMAT_OBJECT },
  );
  return Number(res.rows?.[0]?.CNT ?? 0) > 0;
}

export async function apexDetect(): Promise<ApexDetectResult> {
  return withActiveSession(async (conn) => {
    let version: string | null = null;
    let installed = false;

    try {
      const res = await conn.execute<Record<string, unknown>>(
        `SELECT VERSION_NO FROM APEX_RELEASE`,
        {},
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      version = res.rows?.[0]?.VERSION_NO != null ? String(res.rows[0].VERSION_NO) : null;
      installed = true;
    } catch (err) {
      if (!isMissingOrDenied(err)) throw err;
      installed = await apexReleaseObjectExists(conn);
    }

    let userHasAccess = false;
    if (installed) {
      try {
        await conn.execute(
          `SELECT 1 FROM APEX_WORKSPACES WHERE ROWNUM = 1`,
          {},
          { outFormat: oracledb.OUT_FORMAT_OBJECT },
        );
        userHasAccess = true;
      } catch (err) {
        if (!isMissingOrDenied(err)) throw err;
      }
    }

    const supported = isApexVersionAtLeast(version, "19.2");
    return {
      installed,
      userHasAccess,
      version,
      supported,
      minSupportedVersion: "19.2",
      capabilities: apexCapabilitiesForVersion(version),
    };
  });
}

export async function apexWorkspacesList(): Promise<{
  workspaces: ApexWorkspaceRow[];
  accessDenied: boolean;
}> {
  return withActiveSession(async (conn) => {
    try {
      const res = await conn.execute<Record<string, unknown>>(
        `SELECT WORKSPACE, WORKSPACE_ID
           FROM APEX_WORKSPACES
          ORDER BY WORKSPACE`,
        {},
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      return {
        accessDenied: false,
        workspaces: (res.rows ?? []).map((r) => ({
          workspace: String(r.WORKSPACE ?? ""),
          workspaceId: r.WORKSPACE_ID != null ? Number(r.WORKSPACE_ID) : null,
        })),
      };
    } catch (err) {
      if (isMissingOrDenied(err)) return { workspaces: [], accessDenied: true };
      throw err;
    }
  });
}

export async function apexApplicationsList(p: { workspace: string }): Promise<{
  applications: ApexApplicationRow[];
  accessDenied: boolean;
}> {
  return withActiveSession(async (conn) => {
    try {
      const res = await conn.execute<Record<string, unknown>>(
        `SELECT WORKSPACE, APPLICATION_ID, APPLICATION_NAME, ALIAS, OWNER
           FROM APEX_APPLICATIONS
          WHERE WORKSPACE = :workspace
          ORDER BY APPLICATION_ID`,
        { workspace: p.workspace },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      return {
        accessDenied: false,
        applications: (res.rows ?? []).map((r) => ({
          workspace: String(r.WORKSPACE ?? p.workspace),
          applicationId: Number(r.APPLICATION_ID),
          name: String(r.APPLICATION_NAME ?? ""),
          alias: r.ALIAS != null ? String(r.ALIAS) : null,
          owner: r.OWNER != null ? String(r.OWNER) : null,
        })),
      };
    } catch (err) {
      if (isMissingOrDenied(err)) return { applications: [], accessDenied: true };
      throw err;
    }
  });
}

export async function apexPagesList(p: { applicationId: number }): Promise<{
  pages: ApexPageRow[];
  accessDenied: boolean;
}> {
  return withActiveSession(async (conn) => {
    try {
      const res = await conn.execute<Record<string, unknown>>(
        `SELECT APPLICATION_ID, PAGE_ID, PAGE_NAME, PAGE_ALIAS, PAGE_MODE
           FROM APEX_APPLICATION_PAGES
          WHERE APPLICATION_ID = :applicationId
          ORDER BY PAGE_ID`,
        { applicationId: p.applicationId },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      return {
        accessDenied: false,
        pages: (res.rows ?? []).map((r) => ({
          applicationId: Number(r.APPLICATION_ID ?? p.applicationId),
          pageId: Number(r.PAGE_ID),
          name: String(r.PAGE_NAME ?? ""),
          alias: r.PAGE_ALIAS != null ? String(r.PAGE_ALIAS) : null,
          pageMode: r.PAGE_MODE != null ? String(r.PAGE_MODE) : null,
        })),
      };
    } catch (err) {
      if (isMissingOrDenied(err)) return { pages: [], accessDenied: true };
      throw err;
    }
  });
}
