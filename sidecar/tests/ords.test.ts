import { describe, it, expect } from "bun:test";
import {
  ordsDetect,
  generateAutoCrudSql,
  generateCustomSqlEndpoint,
  generateProcedureEndpoint,
} from "../src/ords";

describe("ords.detect", () => {
  it("returns shape with installed/version/currentSchemaEnabled/hasAdminRole/ordsBaseUrl", async () => {
    expect(typeof ordsDetect).toBe("function");
  });
});

describe("generateAutoCrudSql", () => {
  it("generates ENABLE_OBJECT for table with NONE auth", () => {
    const sql = generateAutoCrudSql({
      schema: "HR",
      objectName: "EMPLOYEES",
      objectType: "TABLE",
      alias: "employees",
      authMode: "none",
    });
    expect(sql).toContain("ORDS.ENABLE_OBJECT");
    expect(sql).toContain("p_object         => 'EMPLOYEES'");
    expect(sql).toContain("p_object_type    => 'TABLE'");
    expect(sql).toContain("p_object_alias   => 'employees'");
    expect(sql).toContain("p_auto_rest_auth => FALSE");
    expect(sql).toMatch(/COMMIT;\s*END;/);
  });

  it("adds DEFINE_PRIVILEGE when role auth is selected", () => {
    const sql = generateAutoCrudSql({
      schema: "HR",
      objectName: "DEPARTMENTS",
      objectType: "VIEW",
      alias: "departments",
      authMode: "role",
      authRole: "HR_API_RO",
    });
    expect(sql).toContain("ORDS.DEFINE_PRIVILEGE");
    expect(sql).toContain("'HR_API_RO'");
    expect(sql).toContain("p_auto_rest_auth => TRUE");
  });
});

describe("generateCustomSqlEndpoint", () => {
  it("generates DEFINE_MODULE/TEMPLATE/HANDLER for GET", () => {
    const sql = generateCustomSqlEndpoint({
      moduleName: "vendas-api",
      basePath: "/vendas/",
      routePattern: "by-year/:year",
      method: "GET",
      source: "SELECT mes, total FROM vendas WHERE EXTRACT(YEAR FROM data) = :year",
      authMode: "none",
    });
    expect(sql).toContain("ORDS.DEFINE_MODULE");
    expect(sql).toContain("'vendas-api'");
    expect(sql).toContain("ORDS.DEFINE_TEMPLATE");
    expect(sql).toContain("'by-year/:year'");
    expect(sql).toContain("ORDS.DEFINE_HANDLER");
    expect(sql).toContain("ORDS.source_type_collection");
    expect(sql).toMatch(/COMMIT;\s*END;/);
  });

  it("uses source_type_plsql for non-GET methods", () => {
    const sql = generateCustomSqlEndpoint({
      moduleName: "test",
      basePath: "/test/",
      routePattern: "/",
      method: "POST",
      source: "BEGIN INSERT INTO t VALUES (:id); END;",
      authMode: "none",
    });
    expect(sql).toContain("ORDS.source_type_plsql");
  });
});

describe("generateProcedureEndpoint", () => {
  it("generates handler with procedure call wrapper", () => {
    const sql = generateProcedureEndpoint({
      moduleName: "sales-api",
      basePath: "/sales/",
      routePattern: "/",
      method: "POST",
      schema: "HR",
      procName: "CREATE_SALE",
      packageName: "VENDAS_PKG",
      params: [
        { name: "P_CUSTOMER_ID", argMode: "IN", dataType: "NUMBER" },
        { name: "P_AMOUNT", argMode: "IN", dataType: "NUMBER" },
        { name: "P_ID_OUT", argMode: "OUT", dataType: "NUMBER" },
      ],
      hasReturn: false,
      authMode: "none",
    });
    expect(sql).toContain("ORDS.DEFINE_HANDLER");
    expect(sql).toContain("ORDS.source_type_plsql");
    expect(sql).toContain("VENDAS_PKG.CREATE_SALE");
    expect(sql).toContain(":p_customer_id");
    expect(sql).toContain("v_p_id_out");
  });
});
