// Veesker Add-on: Audit Log Shipper
//
// Ships audit log entries to external destinations.
// Loaded by Veesker's plugin system via register(api) below.
//
// © Veesker Inc — proprietary, see LICENSE in this folder.

import type { AuditEntry } from "../../src/lib/plugins";

// ── Settings shape (stored via plugin settings API) ─────────────────────────

type DestinationConfig =
  | { type: "splunk-hec"; url: string; token: string; index?: string; sourcetype?: string }
  | { type: "datadog"; site: "us1" | "us3" | "us5" | "eu" | "ap1"; apiKey: string; service?: string }
  | { type: "webhook"; url: string; headers?: Record<string, string> }
  | { type: "s3"; bucket: string; region: string; accessKeyId: string; secretAccessKey: string; prefix?: string };

type ShipperSettings = {
  enabled: boolean;
  destinations: DestinationConfig[];
  filter: {
    onlyDdl: boolean;
    onlyDml: boolean;
    onlyFailures: boolean;
    minElapsedMs: number;
  };
  buffer: {
    maxQueueSize: number;
    flushIntervalMs: number;
    maxBatchSize: number;
  };
};

const DEFAULT_SETTINGS: ShipperSettings = {
  enabled: false,
  destinations: [],
  filter: {
    onlyDdl: false,
    onlyDml: false,
    onlyFailures: false,
    minElapsedMs: 0,
  },
  buffer: {
    maxQueueSize: 10000,
    flushIntervalMs: 30000,
    maxBatchSize: 100,
  },
};

// ── Plugin entry point ──────────────────────────────────────────────────────

interface PluginAPI {
  registerAuditDestination: (d: {
    id: string;
    ship: (entry: AuditEntry) => Promise<void>;
  }) => void;
  settings: {
    get<T>(key: string, fallback?: T): T | undefined;
    set<T>(key: string, value: T): void;
  };
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  log: { info(msg: string): void; warn(msg: string): void; error(msg: string): void };
}

export function register(api: PluginAPI): void {
  const settings = loadSettings(api);
  if (!settings.enabled || settings.destinations.length === 0) {
    api.log.info("audit-shipper: disabled or no destinations configured");
    return;
  }

  const shipper = new BufferedShipper(api, settings);

  api.registerAuditDestination({
    id: "audit-shipper",
    ship: (entry) => shipper.enqueue(entry),
  });

  api.log.info(`audit-shipper: active with ${settings.destinations.length} destination(s)`);
}

// ── Buffered shipper with retry ─────────────────────────────────────────────

class BufferedShipper {
  private queue: AuditEntry[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private flushing = false;

  constructor(
    private api: PluginAPI,
    private settings: ShipperSettings,
  ) {
    this.flushTimer = setInterval(
      () => void this.flush(),
      settings.buffer.flushIntervalMs,
    );
  }

  async enqueue(entry: AuditEntry): Promise<void> {
    if (!this.passesFilter(entry)) return;
    if (this.queue.length >= this.settings.buffer.maxQueueSize) {
      this.queue.shift();
      this.api.log.warn("audit-shipper: queue full, dropping oldest entry");
    }
    this.queue.push(entry);
    if (this.queue.length >= this.settings.buffer.maxBatchSize) {
      void this.flush();
    }
  }

  private passesFilter(entry: AuditEntry): boolean {
    const f = this.settings.filter;
    if (f.onlyFailures && entry.success) return false;
    if (f.minElapsedMs > 0 && entry.elapsedMs < f.minElapsedMs) return false;
    if (f.onlyDdl && !isDdl(entry.sql)) return false;
    if (f.onlyDml && !isDml(entry.sql)) return false;
    return true;
  }

  async flush(): Promise<void> {
    if (this.flushing || this.queue.length === 0) return;
    this.flushing = true;
    const batch = this.queue.splice(0, this.settings.buffer.maxBatchSize);
    try {
      for (const dest of this.settings.destinations) {
        await this.shipBatch(dest, batch);
      }
    } catch (e: any) {
      this.api.log.error(`audit-shipper: flush failed: ${e?.message ?? e}`);
      this.queue.unshift(...batch);
    } finally {
      this.flushing = false;
    }
  }

  private async shipBatch(dest: DestinationConfig, batch: AuditEntry[]): Promise<void> {
    switch (dest.type) {
      case "splunk-hec":  return this.shipSplunk(dest, batch);
      case "datadog":     return this.shipDatadog(dest, batch);
      case "webhook":     return this.shipWebhook(dest, batch);
      case "s3":          return this.shipS3(dest, batch);
    }
  }

  private async shipSplunk(d: Extract<DestinationConfig, { type: "splunk-hec" }>, batch: AuditEntry[]) {
    const events = batch.map((entry) => ({
      time: Math.floor(new Date(entry.timestamp).getTime() / 1000),
      event: entry,
      index: d.index,
      sourcetype: d.sourcetype ?? "veesker:audit",
      source: "veesker",
    }));
    const body = events.map((e) => JSON.stringify(e)).join("\n");
    const res = await this.api.fetch(d.url, {
      method: "POST",
      headers: {
        Authorization: `Splunk ${d.token}`,
        "Content-Type": "application/json",
      },
      body,
    });
    if (!res.ok) throw new Error(`splunk-hec ${res.status}: ${await res.text()}`);
  }

  private async shipDatadog(d: Extract<DestinationConfig, { type: "datadog" }>, batch: AuditEntry[]) {
    const intake = `https://http-intake.logs.${ddSiteHost(d.site)}/api/v2/logs`;
    const payload = batch.map((entry) => ({
      ddsource: "veesker",
      service: d.service ?? "veesker-audit",
      timestamp: new Date(entry.timestamp).toISOString(),
      message: entry.sql.slice(0, 500),
      ...entry,
    }));
    const res = await this.api.fetch(intake, {
      method: "POST",
      headers: {
        "DD-API-KEY": d.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`datadog ${res.status}: ${await res.text()}`);
  }

  private async shipWebhook(d: Extract<DestinationConfig, { type: "webhook" }>, batch: AuditEntry[]) {
    const res = await this.api.fetch(d.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(d.headers ?? {}),
      },
      body: JSON.stringify({ source: "veesker", batch }),
    });
    if (!res.ok) throw new Error(`webhook ${res.status}: ${await res.text()}`);
  }

  private async shipS3(_d: Extract<DestinationConfig, { type: "s3" }>, _batch: AuditEntry[]) {
    // S3 requires AWS Signature V4 — implementation deferred to plugin v0.2
    throw new Error("S3 destination not yet implemented");
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function loadSettings(api: PluginAPI): ShipperSettings {
  const stored = api.settings.get<ShipperSettings>("config");
  return stored ?? DEFAULT_SETTINGS;
}

function isDdl(sql: string): boolean {
  return /^\s*(CREATE|ALTER|DROP|TRUNCATE|RENAME|GRANT|REVOKE)\s/i.test(sql);
}

function isDml(sql: string): boolean {
  return /^\s*(INSERT|UPDATE|DELETE|MERGE)\s/i.test(sql);
}

function ddSiteHost(site: string): string {
  switch (site) {
    case "us1": return "datadoghq.com";
    case "us3": return "us3.datadoghq.com";
    case "us5": return "us5.datadoghq.com";
    case "eu":  return "datadoghq.eu";
    case "ap1": return "ap1.datadoghq.com";
    default:    return "datadoghq.com";
  }
}
