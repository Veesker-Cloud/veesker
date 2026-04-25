import { describe, it, expect, beforeEach } from "vitest";
import { visualFlow } from "./visual-flow.svelte";
import type { FlowTraceResult } from "$lib/workspace";

const sampleTrace: FlowTraceResult = {
  kind: "plsql",
  startedAt: "2026-04-25T10:00:00Z",
  totalElapsedMs: 50,
  events: [
    { kind: "plsql.frame", stepIndex: 0, objectOwner: "HR", objectName: "P", lineNumber: 1, sourceLine: "BEGIN", enteredAtMs: 0, exitedAtMs: 10, stack: [], variables: [] },
    { kind: "plsql.frame", stepIndex: 1, objectOwner: "HR", objectName: "P", lineNumber: 2, sourceLine: "v := 1;", enteredAtMs: 10, exitedAtMs: 30, stack: [], variables: [] },
    { kind: "plsql.frame", stepIndex: 2, objectOwner: "HR", objectName: "P", lineNumber: 3, sourceLine: "END;", enteredAtMs: 30, exitedAtMs: null, stack: [], variables: [] },
  ],
};

describe("visualFlow store", () => {
  beforeEach(() => {
    visualFlow.close();
  });

  it("opens with a trace, currentStep starts at 0", () => {
    visualFlow.open(sampleTrace);
    expect(visualFlow.isOpen).toBe(true);
    expect(visualFlow.trace).toBe(sampleTrace);
    expect(visualFlow.currentStepIndex).toBe(0);
  });

  it("next advances and clamps at last step", () => {
    visualFlow.open(sampleTrace);
    visualFlow.next();
    expect(visualFlow.currentStepIndex).toBe(1);
    visualFlow.next();
    visualFlow.next();
    visualFlow.next();
    expect(visualFlow.currentStepIndex).toBe(2);
  });

  it("prev decrements and clamps at 0", () => {
    visualFlow.open(sampleTrace);
    visualFlow.next();
    visualFlow.prev();
    expect(visualFlow.currentStepIndex).toBe(0);
    visualFlow.prev();
    expect(visualFlow.currentStepIndex).toBe(0);
  });

  it("first/last jump to extremes", () => {
    visualFlow.open(sampleTrace);
    visualFlow.last();
    expect(visualFlow.currentStepIndex).toBe(2);
    visualFlow.first();
    expect(visualFlow.currentStepIndex).toBe(0);
  });

  it("close resets state", () => {
    visualFlow.open(sampleTrace);
    visualFlow.close();
    expect(visualFlow.isOpen).toBe(false);
    expect(visualFlow.trace).toBeNull();
  });

  it("setStep clamps to valid range", () => {
    visualFlow.open(sampleTrace);
    visualFlow.setStep(99);
    expect(visualFlow.currentStepIndex).toBe(2);
    visualFlow.setStep(-5);
    expect(visualFlow.currentStepIndex).toBe(0);
  });
});
