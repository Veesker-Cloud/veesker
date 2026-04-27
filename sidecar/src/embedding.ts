// Copyright 2022-2026 Geraldo Ferreira Viana Júnior
// Licensed under the Apache License, Version 2.0
// https://github.com/gevianajr/veesker

export type EmbedProvider = "ollama" | "openai" | "voyage" | "custom";

export type EmbedParams = {
  provider: EmbedProvider;
  model: string;
  text: string;
  baseUrl?: string; // ollama default: http://localhost:11434, custom: any
  apiKey?: string;  // openai / voyage
};

const BLOCKED_HOSTS = new Set([
  "169.254.169.254",           // AWS/Azure/GCP link-local metadata
  "metadata.google.internal",  // GCP metadata
  "metadata.internal",
  "instance-data",
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
]);

// RFC1918 private ranges — block to prevent SSRF scanning internal networks
function isPrivateIp(host: string): boolean {
  const v4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.\d+$/);
  if (v4) {
    const [, a, b] = v4.map(Number);
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  // IPv6 link-local fe80::/10
  if (host.toLowerCase().startsWith("fe80:")) return true;
  return false;
}

function validateEmbedUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid embed URL: ${JSON.stringify(url)}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Embed URL must use http or https (got ${parsed.protocol})`);
  }
  const host = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(host) || isPrivateIp(host)) {
    throw new Error(`Embed URL targets a blocked host: ${host}`);
  }
}

export async function embedText(params: EmbedParams): Promise<number[]> {
  switch (params.provider) {
    case "ollama":  return embedOllama(params);
    case "openai":  return embedOpenAi(params);
    case "voyage":  return embedVoyage(params);
    case "custom":  return embedCustom(params);
    default: throw new Error(`Unknown embedding provider: ${params.provider}`);
  }
}

const EMBED_TIMEOUT_MS = 30_000;

async function embedOllama(p: EmbedParams): Promise<number[]> {
  const base = (p.baseUrl ?? "http://localhost:11434").replace(/\/$/, "");
  if (p.baseUrl) validateEmbedUrl(base);
  const res = await fetch(`${base}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: p.model || "nomic-embed-text", prompt: p.text }),
    signal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Ollama error ${res.status}: ${await res.text()}`);
  const data = await res.json() as { embedding?: unknown };
  if (!Array.isArray(data.embedding)) throw new Error("Ollama returned no embedding");
  return data.embedding as number[];
}

async function embedOpenAi(p: EmbedParams): Promise<number[]> {
  if (!p.apiKey) throw new Error("OpenAI API key required");
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${p.apiKey}`,
    },
    body: JSON.stringify({ model: p.model || "text-embedding-3-small", input: p.text }),
    signal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`OpenAI error ${res.status}: ${await res.text()}`);
  const data = await res.json() as { data?: unknown };
  if (!Array.isArray((data as any)?.data) || !Array.isArray((data as any).data[0]?.embedding)) {
    throw new Error("OpenAI returned unexpected embedding response shape");
  }
  return (data as any).data[0].embedding as number[];
}

async function embedVoyage(p: EmbedParams): Promise<number[]> {
  if (!p.apiKey) throw new Error("Voyage API key required");
  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${p.apiKey}`,
    },
    body: JSON.stringify({ model: p.model || "voyage-3-lite", input: [p.text] }),
    signal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Voyage error ${res.status}: ${await res.text()}`);
  const data = await res.json() as { data?: unknown };
  if (!Array.isArray((data as any)?.data) || !Array.isArray((data as any).data[0]?.embedding)) {
    throw new Error("Voyage returned unexpected embedding response shape");
  }
  return (data as any).data[0].embedding as number[];
}

async function embedCustom(p: EmbedParams): Promise<number[]> {
  if (!p.baseUrl) throw new Error("Custom provider URL required");
  validateEmbedUrl(p.baseUrl);
  const res = await fetch(p.baseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: p.model, input: p.text, text: p.text }),
    signal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Custom embed error ${res.status}: ${await res.text()}`);
  const data = await res.json() as any;
  // Accept: { embedding: [] } | { data: [{ embedding: [] }] } | number[]
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.embedding)) return data.embedding;
  if (Array.isArray(data.data?.[0]?.embedding)) return data.data[0].embedding;
  throw new Error("Could not parse embedding from custom provider response");
}
