import { describe, test, expect } from "bun:test";
import { getTools, buildSystem } from "./ai";

describe("getTools", () => {
  test("returns empty array when tools disabled (CE mode)", () => {
    expect(getTools(false)).toEqual([]);
  });

  test("returns 4 tools when tools enabled (Cloud mode)", () => {
    const tools = getTools(true);
    expect(tools).toHaveLength(4);
    const names = tools.map((t) => t.name);
    expect(names).toContain("describe_object");
    expect(names).toContain("run_query");
    expect(names).toContain("get_ddl");
    expect(names).toContain("list_objects");
  });
});

describe("buildSystem", () => {
  const fullCtx = {
    currentSchema: "HR",
    selectedOwner: "HR",
    selectedName: "EMPLOYEES",
    selectedKind: "TABLE",
    activeSql: "SELECT * FROM EMPLOYEES",
  };

  test("CE mode: includes activeSql but NOT schema or object context", () => {
    const sys = buildSystem(fullCtx, false);
    expect(sys).toContain("SELECT * FROM EMPLOYEES");
    expect(sys).not.toContain("Current schema:");
    expect(sys).not.toContain("Selected object:");
  });

  test("Cloud mode: includes all context fields", () => {
    const sys = buildSystem(fullCtx, true);
    expect(sys).toContain("Current schema: HR");
    expect(sys).toContain("Selected object: TABLE HR.EMPLOYEES");
    expect(sys).toContain("SELECT * FROM EMPLOYEES");
  });

  test("CE mode: no activeSql → no context section injected", () => {
    const sys = buildSystem({ currentSchema: "HR" }, false);
    expect(sys).not.toContain("Current schema:");
  });

  test("CE mode: system prompt mentions text-only assistant", () => {
    const sys = buildSystem({}, false);
    expect(sys).toContain("text-only assistant");
    expect(sys).not.toContain("live access to the connected Oracle database");
  });

  test("Cloud mode: system prompt mentions live database access", () => {
    const sys = buildSystem({}, true);
    expect(sys).toContain("live access to the connected Oracle database");
  });
});
