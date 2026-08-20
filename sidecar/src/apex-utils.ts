// Copyright 2022-2026 Geraldo Ferreira Viana Junior
// Licensed under the Apache License, Version 2.0
// https://github.com/veesker-cloud/veesker-community-edition

export type ApexCapability = {
  view: string;
  minVersion: string;
  enabled: boolean;
};

const APEX_CAPABILITY_DEFS: Array<{ view: string; minVersion: string }> = [
  { view: "APEX_WORKSPACES", minVersion: "19.2" },
  { view: "APEX_APPLICATIONS", minVersion: "19.2" },
  { view: "APEX_APPLICATION_PAGES", minVersion: "19.2" },
  { view: "APEX_APPLICATION_PAGE_REGIONS", minVersion: "19.2" },
  { view: "APEX_APPLICATION_PAGE_ITEMS", minVersion: "19.2" },
  { view: "APEX_APPLICATION_PAGE_PROC", minVersion: "19.2" },
  { view: "APEX_APPLICATION_PAGE_COMP", minVersion: "19.2" },
  { view: "APEX_APPLICATION_PAGE_VAL", minVersion: "19.2" },
  { view: "APEX_APPLICATION_PAGE_DA", minVersion: "19.2" },
  { view: "APEX_APPLICATION_PAGE_DA_ACTS", minVersion: "19.2" },
  { view: "APEX_APPLICATION_LOVS", minVersion: "19.2" },
];

function versionParts(version: string | null): [number, number] | null {
  const m = String(version ?? "").match(/^(\d+)(?:\.(\d+))?/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2] ?? 0)];
}

export function isApexVersionAtLeast(version: string | null, minVersion: string): boolean {
  const v = versionParts(version);
  const min = versionParts(minVersion);
  if (!v || !min) return false;
  if (v[0] !== min[0]) return v[0] > min[0];
  return v[1] >= min[1];
}

export function apexCapabilitiesForVersion(version: string | null): ApexCapability[] {
  return APEX_CAPABILITY_DEFS.map((cap) => ({
    ...cap,
    enabled: isApexVersionAtLeast(version, cap.minVersion),
  }));
}

export function findApexBindVariables(source: string): string[] {
  const binds = new Set<string>();
  const re = /(^|[^:]):([A-Za-z][A-Za-z0-9_$#]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    binds.add(m[2].toUpperCase());
  }
  return [...binds].sort();
}

export function buildApexExtractHeader(input: {
  appId?: number | string | null;
  pageId?: number | string | null;
  componentType: string;
  componentName: string;
  sourceView: string;
  sourceColumn: string;
  extractedAt: string;
  apexVersion: string | null;
  connectionName: string;
  source: string;
}): string {
  const location = [
    input.appId != null ? `App ${input.appId}` : null,
    input.pageId != null ? `Page ${input.pageId}` : null,
    `${input.componentType} "${input.componentName}"`,
  ].filter(Boolean).join(" - ");
  const binds = findApexBindVariables(input.source);
  const bindBlock = binds.length === 0
    ? "-- APEX binds: none detected"
    : [
        "-- APEX binds detected. Replace values before running outside APEX:",
        ...binds.map((b) => `-- DEFINE ${b} = '<value>'`),
      ].join("\n");

  return [
    "-- Veesker APEX Studio - read-only extract",
    `-- ${location}`,
    `-- Source: ${input.sourceView}.${input.sourceColumn}`,
    `-- Extracted: ${input.extractedAt} - APEX ${input.apexVersion ?? "unknown"} - conn: ${input.connectionName}`,
    bindBlock,
    "",
  ].join("\n");
}
