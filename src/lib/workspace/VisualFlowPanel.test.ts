import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import VisualFlowPanel from "./VisualFlowPanel.svelte";
import { visualFlow } from "$lib/stores/visual-flow.svelte";
import type { FlowTraceResult } from "$lib/workspace";

const trace: FlowTraceResult = {
  kind: "plsql",
  startedAt: "2026-04-25T10:00:00Z",
  totalElapsedMs: 30,
  events: [
    { kind: "plsql.frame", stepIndex: 0, objectOwner: "HR", objectName: "P", lineNumber: 1, sourceLine: "BEGIN", enteredAtMs: 0, exitedAtMs: 10, stack: [], variables: [{ name: "p_id", type: "NUMBER", value: "100" }] },
    { kind: "plsql.frame", stepIndex: 1, objectOwner: "HR", objectName: "P", lineNumber: 2, sourceLine: "v := 1;", enteredAtMs: 10, exitedAtMs: null, stack: [], variables: [{ name: "p_id", type: "NUMBER", value: "100" }, { name: "v", type: "NUMBER", value: "1" }] },
  ],
};

describe("VisualFlowPanel", () => {
  beforeEach(() => visualFlow.open(trace));
  afterEach(() => visualFlow.close());

  it("renders header with step counter", () => {
    const { getByText } = render(VisualFlowPanel);
    expect(getByText(/Step 1\s*\/\s*2/)).toBeTruthy();
  });

  it("clicking next advances the store", async () => {
    const { getByLabelText, getByText } = render(VisualFlowPanel);
    expect(visualFlow.currentStepIndex).toBe(0);
    await fireEvent.click(getByLabelText("Next step"));
    expect(visualFlow.currentStepIndex).toBe(1);
    expect(getByText(/Step 2\s*\/\s*2/)).toBeTruthy();
  });

  it("clicking close hides the panel", async () => {
    const { getByLabelText } = render(VisualFlowPanel);
    expect(visualFlow.isOpen).toBe(true);
    await fireEvent.click(getByLabelText("Close panel"));
    expect(visualFlow.isOpen).toBe(false);
  });

  it("renders the truncated banner when trace.truncated=true", () => {
    visualFlow.open({ ...trace, truncated: true });
    const { getByText } = render(VisualFlowPanel);
    expect(getByText(/truncated/i)).toBeTruthy();
  });

  it("renders the error banner when trace.error is set", () => {
    visualFlow.open({ ...trace, error: { code: -32004, message: "Trace timed out" } });
    const { getByText } = render(VisualFlowPanel);
    expect(getByText(/timed out/i)).toBeTruthy();
  });
});
