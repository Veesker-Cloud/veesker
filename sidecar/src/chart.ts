export type ChartType = "bar" | "bar-h" | "line" | "pie" | "kpi" | "table";
export type ChartAggregation = "none" | "sum" | "avg" | "count" | "max" | "min";

export type ChartConfig = {
  type: ChartType | null;
  xColumn: string | null;
  yColumns: string[];
  aggregation: ChartAggregation;
  title: string | null;
};

export type PreviewData = {
  labels: string[];
  datasets: { label: string; data: number[] }[];
};

export type ChartConfigureResult = {
  config: ChartConfig;
  previewData: PreviewData | null;
  ready: boolean;
};

type ConfigureParams = {
  sessionId: string;
  patch: Partial<ChartConfig>;
  columns: { name: string; dataType: string }[];
  rows: unknown[][];
};

const sessions = new Map<string, ChartConfig>();

function emptyConfig(): ChartConfig {
  return { type: null, xColumn: null, yColumns: [], aggregation: "none", title: null };
}

function colIndex(columns: { name: string }[], name: string): number {
  return columns.findIndex((c) => c.name === name);
}

function applyAgg(values: number[], agg: ChartAggregation): number {
  if (values.length === 0) return 0;
  switch (agg) {
    case "sum": return values.reduce((a, b) => a + b, 0);
    case "avg": return values.reduce((a, b) => a + b, 0) / values.length;
    case "count": return values.length;
    case "max": return Math.max(...values);
    case "min": return Math.min(...values);
    default: return values[0];
  }
}

function buildPreview(
  config: ChartConfig,
  columns: { name: string; dataType: string }[],
  rows: unknown[][]
): PreviewData | null {
  if (!config.type || config.yColumns.length === 0) return null;
  if (config.type === "table") return null;

  if (config.type === "kpi") {
    const datasets = config.yColumns.map((yCol) => {
      const yi = colIndex(columns, yCol);
      if (yi === -1) return { label: yCol, data: [0] };
      const values = rows.map((r) => Number(r[yi]) || 0);
      return { label: yCol, data: [applyAgg(values, config.aggregation)] };
    });
    return { labels: [], datasets };
  }

  if (!config.xColumn) return null;
  const xi = colIndex(columns, config.xColumn);
  if (xi === -1) return null;

  const labelSet: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const label = String(row[xi] ?? "");
    if (!seen.has(label)) {
      seen.add(label);
      labelSet.push(label);
    }
  }

  const datasets = config.yColumns.map((yCol) => {
    const yi = colIndex(columns, yCol);
    if (yi === -1) return { label: yCol, data: labelSet.map(() => 0) };
    const groups = new Map<string, number[]>();
    for (const label of labelSet) groups.set(label, []);
    for (const row of rows) {
      const label = String(row[xi] ?? "");
      if (groups.has(label)) groups.get(label)!.push(Number(row[yi]) || 0);
    }
    const data = labelSet.map((label) => applyAgg(groups.get(label)!, config.aggregation));
    return { label: yCol, data };
  });

  return { labels: labelSet, datasets };
}

function isReady(config: ChartConfig): boolean {
  if (!config.type || config.yColumns.length === 0 || !config.title) return false;
  if (config.type === "kpi" || config.type === "table") return true;
  return config.xColumn !== null;
}

export async function chartConfigure(p: ConfigureParams): Promise<ChartConfigureResult> {
  const config = sessions.get(p.sessionId) ?? emptyConfig();
  const patch = p.patch;

  if (patch.type !== undefined && patch.type !== null) config.type = patch.type;
  if (patch.xColumn !== undefined && patch.xColumn !== null) config.xColumn = patch.xColumn;
  if (patch.yColumns !== undefined) config.yColumns = patch.yColumns;
  if (patch.aggregation !== undefined && patch.aggregation !== null) config.aggregation = patch.aggregation;
  if (patch.title !== undefined && patch.title !== null) config.title = patch.title;

  sessions.set(p.sessionId, config);

  const previewData = buildPreview(config, p.columns, p.rows);
  const ready = isReady(config) && (previewData !== null || config.type === "table");

  return { config: { ...config }, previewData, ready };
}

export function chartReset(p: { sessionId: string }): { ok: true } {
  sessions.delete(p.sessionId);
  return { ok: true };
}
