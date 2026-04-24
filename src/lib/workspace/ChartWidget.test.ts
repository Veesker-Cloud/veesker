import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/svelte";
import ChartWidget from "./ChartWidget.svelte";
import type { ChartConfig, PreviewData } from "$lib/workspace";

const barConfig: ChartConfig = {
  type: "bar", xColumn: "DEPT", yColumns: ["SALARY"],
  aggregation: "sum", title: "Salary by Dept",
};
const lineConfig: ChartConfig = { ...barConfig, type: "line" };
const pieConfig: ChartConfig  = { ...barConfig, type: "pie" };
const barHConfig: ChartConfig = { ...barConfig, type: "bar-h" };

const previewData: PreviewData = {
  labels: ["IT", "HR", "FIN"],
  datasets: [{ label: "SALARY", data: [15000, 5000, 9000] }],
};

const kpiConfig: ChartConfig = {
  type: "kpi", xColumn: null, yColumns: ["SALARY", "HEADCOUNT"],
  aggregation: "sum", title: "KPIs",
};
const kpiData: PreviewData = {
  labels: [],
  datasets: [
    { label: "SALARY", data: [29000] },
    { label: "HEADCOUNT", data: [78] },
  ],
};

const tableConfig: ChartConfig = {
  type: "table", xColumn: null, yColumns: [],
  aggregation: "none", title: "Raw Data",
};

describe("ChartWidget", () => {
  it("renders a canvas for bar type", () => {
    render(ChartWidget, { props: { config: barConfig, previewData, rows: [] } });
    expect(document.querySelector("canvas")).toBeTruthy();
  });

  it("renders a canvas for line type", () => {
    render(ChartWidget, { props: { config: lineConfig, previewData, rows: [] } });
    expect(document.querySelector("canvas")).toBeTruthy();
  });

  it("renders a canvas for pie type", () => {
    render(ChartWidget, { props: { config: pieConfig, previewData, rows: [] } });
    expect(document.querySelector("canvas")).toBeTruthy();
  });

  it("renders a canvas for bar-h type", () => {
    render(ChartWidget, { props: { config: barHConfig, previewData, rows: [] } });
    expect(document.querySelector("canvas")).toBeTruthy();
  });

  it("renders KPI cards for kpi type — no canvas", () => {
    render(ChartWidget, { props: { config: kpiConfig, previewData: kpiData, rows: [] } });
    expect(document.querySelector("canvas")).toBeFalsy();
    expect(screen.getByText("SALARY")).toBeInTheDocument();
    expect(screen.getByText("29k")).toBeInTheDocument();
  });

  it("renders a table for table type — no canvas", () => {
    const cols = [{ name: "DEPT", dataType: "VARCHAR2" }, { name: "SALARY", dataType: "NUMBER" }];
    const rows = [["IT", 8000], ["HR", 5000]];
    render(ChartWidget, { props: { config: tableConfig, previewData: null, columns: cols, rows } });
    expect(document.querySelector("canvas")).toBeFalsy();
    expect(document.querySelector("table")).toBeTruthy();
    expect(screen.getByText("DEPT")).toBeInTheDocument();
    expect(screen.getByText("IT")).toBeInTheDocument();
  });

  it("applies compact class when compact=true", () => {
    const { container } = render(ChartWidget, {
      props: { config: kpiConfig, previewData: kpiData, rows: [], compact: true },
    });
    expect(container.querySelector(".chart-widget.compact")).toBeTruthy();
  });
});
