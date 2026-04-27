// Copyright 2022-2026 Geraldo Ferreira Viana Júnior
// Licensed under the Apache License, Version 2.0
// https://github.com/gevianajr/veesker

import { gutter, GutterMarker } from "@codemirror/view";
import { StateField, StateEffect } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import type { CostClass } from "$lib/perf/perf-rules";

export type CostBadgeData = {
  line: number;
  cost: number | null;
  costClass: CostClass;
};

export const setCostBadgeEffect = StateEffect.define<CostBadgeData | null>();

class CostBadgeMarker extends GutterMarker {
  constructor(private readonly data: CostBadgeData) {
    super();
  }
  override eq(other: GutterMarker): boolean {
    if (!(other instanceof CostBadgeMarker)) return false;
    return (
      this.data.cost === other.data.cost &&
      this.data.costClass === other.data.costClass
    );
  }
  override toDOM(): HTMLElement {
    const el = document.createElement("span");
    el.className = `cost-badge cost-${this.data.costClass}`;
    el.textContent = formatCost(this.data.cost);
    el.title = this.data.cost === null
      ? "Cost: unknown"
      : `Estimated cost: ${this.data.cost.toLocaleString("en-US")}`;
    return el;
  }
}

function formatCost(cost: number | null): string {
  if (cost === null) return "?";
  if (cost >= 1_000_000) return `${(cost / 1_000_000).toFixed(1)}M`;
  if (cost >= 1_000) return `${(cost / 1_000).toFixed(0)}k`;
  return String(cost);
}

const costBadgeField = StateField.define<CostBadgeData | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setCostBadgeEffect)) {
        return e.value;
      }
    }
    return value;
  },
});

export function costBadgeGutter(): Extension {
  return [
    costBadgeField,
    gutter({
      class: "cm-cost-badge-gutter",
      lineMarker(view, line) {
        const data = view.state.field(costBadgeField);
        if (data === null) return null;
        if (view.state.doc.lineAt(line.from).number !== data.line) return null;
        return new CostBadgeMarker(data);
      },
      initialSpacer: () => new CostBadgeMarker({ line: 1, cost: 999_999, costClass: "yellow" }),
    }),
  ];
}
