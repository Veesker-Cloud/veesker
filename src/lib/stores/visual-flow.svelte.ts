import type { FlowTraceResult } from "$lib/workspace";

class VisualFlowStore {
  trace = $state.raw<FlowTraceResult | null>(null);
  currentStepIndex = $state(0);
  isPlaying = $state(false);
  panelWidth = $state(360);

  get isOpen(): boolean {
    return this.trace !== null;
  }

  get totalSteps(): number {
    return this.trace?.events.length ?? 0;
  }

  get currentEvent() {
    if (!this.trace) return null;
    return this.trace.events[this.currentStepIndex] ?? null;
  }

  open(trace: FlowTraceResult): void {
    this.trace = trace;
    this.currentStepIndex = 0;
    this.isPlaying = false;
  }

  close(): void {
    this.trace = null;
    this.currentStepIndex = 0;
    this.isPlaying = false;
  }

  next(): void {
    if (!this.trace) return;
    if (this.currentStepIndex < this.trace.events.length - 1) {
      this.currentStepIndex++;
    }
  }

  prev(): void {
    if (!this.trace) return;
    if (this.currentStepIndex > 0) {
      this.currentStepIndex--;
    }
  }

  first(): void {
    this.currentStepIndex = 0;
  }

  last(): void {
    if (!this.trace) return;
    this.currentStepIndex = Math.max(0, this.trace.events.length - 1);
  }

  setStep(index: number): void {
    if (!this.trace) return;
    const max = Math.max(0, this.trace.events.length - 1);
    this.currentStepIndex = Math.max(0, Math.min(max, index));
  }

  togglePlay(): void {
    this.isPlaying = !this.isPlaying;
  }
}

export const visualFlow = new VisualFlowStore();
