import { describe, expect, test } from "bun:test";
import {
  apexCapabilitiesForVersion,
  buildApexExtractHeader,
  findApexBindVariables,
  isApexVersionAtLeast,
} from "./apex-utils";

describe("apex version capabilities", () => {
  test("supports APEX 19.2 and newer", () => {
    expect(isApexVersionAtLeast("19.1", "19.2")).toBe(false);
    expect(isApexVersionAtLeast("19.2", "19.2")).toBe(true);
    expect(isApexVersionAtLeast("24.2.0", "19.2")).toBe(true);
  });

  test("disables capabilities when version is unknown", () => {
    expect(apexCapabilitiesForVersion(null).every((cap) => cap.enabled === false)).toBe(true);
  });
});

describe("apex extract helpers", () => {
  test("finds APEX bind variables once and sorted", () => {
    const binds = findApexBindVariables(`
      select * from orders where user_name = :APP_USER and status = :P10_STATUS
      and created_by = :app_user and note = 'literal :P10_STATUS'
    `);
    expect(binds).toEqual(["APP_USER", "P10_STATUS"]);
  });

  test("builds provenance header with bind comments", () => {
    const header = buildApexExtractHeader({
      appId: 100,
      pageId: 10,
      componentType: "Region",
      componentName: "Pending Orders",
      sourceView: "APEX_APPLICATION_PAGE_REGIONS",
      sourceColumn: "REGION_SOURCE",
      extractedAt: "2026-08-18 09:20 -03",
      apexVersion: "24.2",
      connectionName: "DEV",
      source: "select * from orders where status = :P10_STATUS",
    });
    expect(header).toContain("-- Veesker APEX Studio - read-only extract");
    expect(header).toContain("-- App 100 - Page 10 - Region \"Pending Orders\"");
    expect(header).toContain("-- DEFINE P10_STATUS = '<value>'");
  });
});
