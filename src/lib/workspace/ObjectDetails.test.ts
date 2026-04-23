import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import ObjectDetails from "./ObjectDetails.svelte";
import { sqlEditor } from "$lib/stores/sql-editor.svelte";

vi.mock("$lib/sql-query", () => ({
  queryExecute: vi.fn().mockResolvedValue({
    ok: true,
    data: { columns: [], rows: [], rowCount: 0, elapsedMs: 1 },
  }),
}));

vi.mock("$lib/workspace", async (importOriginal) => {
  const mod = await importOriginal<typeof import("$lib/workspace")>();
  return {
    ...mod,
    aiKeyGet: vi.fn().mockResolvedValue(null),
    aiKeySave: vi.fn().mockResolvedValue(undefined),
    tableCountRows: vi.fn().mockResolvedValue({ count: 0 }),
    vectorIndexList: vi.fn().mockResolvedValue({ indexes: [] }),
    vectorSearch: vi.fn().mockResolvedValue({ columns: [], rows: [] }),
    vectorIndexCreate: vi.fn().mockResolvedValue({}),
    vectorIndexDrop: vi.fn().mockResolvedValue({}),
    embedCountPending: vi.fn().mockResolvedValue({ count: 0 }),
    embedBatch: vi.fn().mockResolvedValue({}),
  };
});

beforeEach(() => sqlEditor.reset());

const okDetails = {
  kind: "ok" as const,
  value: { columns: [], indexes: [], rowCount: 100, lastAnalyzed: null },
};

describe("ObjectDetails Preview data button", () => {
  it("shows Preview data button for TABLE", () => {
    render(ObjectDetails, {
      props: {
        selected: { owner: "SYS", name: "DUAL", kind: "TABLE" },
        details: okDetails,
        onRetry: () => {},
      },
    });
    expect(screen.getByRole("button", { name: /preview data/i })).toBeInTheDocument();
  });

  it("shows Preview data button for VIEW", () => {
    render(ObjectDetails, {
      props: {
        selected: { owner: "SYS", name: "V$VERSION", kind: "VIEW" },
        details: okDetails,
        onRetry: () => {},
      },
    });
    expect(screen.getByRole("button", { name: /preview data/i })).toBeInTheDocument();
  });

  it("does NOT show Preview data button for SEQUENCE", () => {
    render(ObjectDetails, {
      props: {
        selected: { owner: "SYS", name: "SEQ1", kind: "SEQUENCE" },
        details: { kind: "idle" },
        onRetry: () => {},
      },
    });
    expect(screen.queryByRole("button", { name: /preview data/i })).toBeNull();
  });

  it("clicking Preview data calls sqlEditor.openPreview", async () => {
    render(ObjectDetails, {
      props: {
        selected: { owner: "SYSTEM", name: "HELP", kind: "TABLE" },
        details: okDetails,
        onRetry: () => {},
      },
    });
    const btn = screen.getByRole("button", { name: /preview data/i });
    await fireEvent.click(btn);
    await new Promise((r) => setTimeout(r, 0));
    expect(sqlEditor.tabs.length).toBe(1);
    expect(sqlEditor.tabs[0].title).toBe("SYSTEM.HELP");
    expect(sqlEditor.drawerOpen).toBe(true);
  });
});
