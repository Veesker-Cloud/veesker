// Copyright 2022-2026 Geraldo Ferreira Viana Júnior
// Licensed under the Apache License, Version 2.0
// https://github.com/gevianajr/veesker

import Anthropic from "@anthropic-ai/sdk";
import { tableDescribe, objectDdl, objectsList, queryExecute } from "./oracle";

export type AiMessage = { role: "user" | "assistant"; content: string };

export type AiContext = {
  currentSchema?: string;
  selectedOwner?: string;
  selectedName?: string;
  selectedKind?: string;
  activeSql?: string;
};

export type AiChatParams = {
  apiKey: string;
  messages: AiMessage[];
  context: AiContext;
};

export type AiChatResult = {
  content: string;
  toolsUsed: string[];
};

const TOOLS: Anthropic.Tool[] = [
  {
    name: "describe_object",
    description: "Get columns, indexes, constraints, and stats for a table or view in the Oracle database",
    input_schema: {
      type: "object" as const,
      properties: {
        owner: { type: "string", description: "Schema owner (e.g. SYSTEM, HR)" },
        name: { type: "string", description: "Object name" },
      },
      required: ["owner", "name"],
    },
  },
  {
    name: "run_query",
    description: "Execute a SELECT or WITH query against Oracle and return up to 50 rows",
    input_schema: {
      type: "object" as const,
      properties: {
        sql: { type: "string", description: "A read-only SELECT or WITH statement" },
      },
      required: ["sql"],
    },
  },
  {
    name: "get_ddl",
    description: "Get the full DDL (CREATE statement) for any Oracle object",
    input_schema: {
      type: "object" as const,
      properties: {
        owner: { type: "string" },
        kind: { type: "string", description: "TABLE, VIEW, PROCEDURE, FUNCTION, PACKAGE, TRIGGER, TYPE, or SEQUENCE" },
        name: { type: "string" },
      },
      required: ["owner", "kind", "name"],
    },
  },
  {
    name: "list_objects",
    description: "List objects of a given kind in a schema",
    input_schema: {
      type: "object" as const,
      properties: {
        schema: { type: "string", description: "Schema name" },
        kind: { type: "string", description: "TABLE, VIEW, PROCEDURE, FUNCTION, PACKAGE, TRIGGER, TYPE, or SEQUENCE" },
      },
      required: ["schema", "kind"],
    },
  },
];

/**
 * Strip SQL comments then verify the statement is read-only.
 * Blocks leading comments before DML, WITH...DELETE/INSERT, and any
 * explicit DML/DDL keyword regardless of position.
 */
function isReadOnlySql(raw: string): boolean {
  const stripped = raw
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const first = /^(\w+)/i.exec(stripped)?.[1]?.toUpperCase();
  if (first !== "SELECT" && first !== "WITH") return false;

  const dangerous = /\b(INSERT|UPDATE|DELETE|MERGE|CREATE|DROP|ALTER|TRUNCATE|RENAME|GRANT|REVOKE|EXECUTE|EXEC|CALL|BEGIN|DECLARE|COMMIT|ROLLBACK|UPSERT|REPLACE)\b/i;
  return !dangerous.test(stripped);
}

async function executeTool(name: string, input: Record<string, string>): Promise<string> {
  switch (name) {
    case "describe_object": {
      const res = await tableDescribe({ owner: input.owner, name: input.name });
      return JSON.stringify(res, null, 2);
    }
    case "run_query": {
      const sql = input.sql.trim();
      if (!isReadOnlySql(sql)) {
        return "Error: only read-only SELECT or WITH queries are permitted";
      }
      // Use a dedicated requestId so AI tool runs don't masquerade as a user query.
      // queryExecute will refuse with a clean error if a user query is already running
      // (rather than racing on the shared connection).
      const requestId = `ai:${crypto.randomUUID()}`;
      try {
        const res = await queryExecute({
          sql: sql.endsWith(";") ? sql.slice(0, -1) : sql,
          requestId,
        });
        if ("results" in res) {
          const first = (res as any).results?.[0];
          return JSON.stringify({ columns: first?.columns, rows: first?.rows?.slice(0, 50) }, null, 2);
        }
        return JSON.stringify({ columns: (res as any).columns, rows: (res as any).rows?.slice(0, 50) }, null, 2);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return `Error executing query: ${msg}`;
      }
    }
    case "get_ddl": {
      const res = await objectDdl({ owner: input.owner, kind: input.kind as any, name: input.name });
      return (res as any).ddl ?? JSON.stringify(res);
    }
    case "list_objects": {
      const items = await objectsList({ owner: input.schema, kind: input.kind as any });
      return JSON.stringify(items.objects.map((o) => o.name), null, 2);
    }
    default:
      return `Unknown tool: ${name}`;
  }
}

export function getTools(enabled: boolean): Anthropic.Tool[] {
  return enabled ? TOOLS : [];
}

export function buildSystem(ctx: AiContext, tools: boolean): string {
  const ctxLines: string[] = [];
  // Schema/object context only when tools are enabled (Cloud mode)
  if (tools) {
    if (ctx.currentSchema) ctxLines.push(`Current schema: ${ctx.currentSchema}`);
    if (ctx.selectedOwner && ctx.selectedName) {
      ctxLines.push(`Selected object: ${ctx.selectedKind ?? "OBJECT"} ${ctx.selectedOwner}.${ctx.selectedName}`);
    }
  }
  // Active SQL always included — user is asking about what's on screen
  if (ctx.activeSql?.trim()) {
    const safeSql = ctx.activeSql.slice(0, 800).replace(/`{3,}/g, "~~~");
    ctxLines.push(`Active SQL in editor:\n\`\`\`sql\n${safeSql}\n\`\`\``);
  }

  return `You are Veesker's Oracle database assistant — a knowledgeable, concise expert with the persona of a cyberpunk sheep mascot. You help developers understand Oracle schemas, debug queries, write PL/SQL, optimise performance, and give design insights.
${tools ? "\nYou have live access to the connected Oracle database via tools. Use them proactively — describe tables before suggesting queries, run a quick SELECT to verify assumptions, fetch DDL when discussing objects." : "\nYou work as a text-only assistant. You do not have access to the database. Explain and generate SQL based on what the user describes and the active SQL shown below."}

Rules:
- Always respond in English, regardless of the language used in the user's message
- Keep responses concise and actionable
- Use \`\`\`sql code blocks for all SQL
- Never suggest or execute DML/DDL via run_query — only SELECT/WITH
- Prefer using tools to verify before asserting
${ctxLines.length > 0 ? "\n[Current IDE context]\n" + ctxLines.join("\n") : ""}`;
}

/**
 * Probe for the locally-installed `claude` CLI. We only fall back to it if the
 * binary is actually present — otherwise users without the CLI got an opaque
 * spawn error instead of a clear "configure your API key" message.
 */
async function claudeCliAvailable(): Promise<boolean> {
  try {
    const proc = Bun.spawn(["claude", "--version"], { stdout: "ignore", stderr: "ignore" });
    await proc.exited;
    return proc.exitCode === 0;
  } catch {
    return false;
  }
}

async function aiChatViaCli(params: AiChatParams, tools: boolean): Promise<AiChatResult> {
  const system = buildSystem(params.context, tools);
  const lastUser = params.messages.filter((m) => m.role === "user").pop()?.content ?? "";

  const history = params.messages.slice(0, -1).map((m) =>
    `${m.role === "user" ? "Human" : "Assistant"}: ${m.content}`
  ).join("\n\n");

  const stdinPayload = [
    system,
    history ? `\n\n${history}\n\nHuman: ${lastUser}` : lastUser,
  ].join("\n\n");

  const proc = Bun.spawn(["claude", "-p", "-"], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  proc.stdin.write(stdinPayload);
  proc.stdin.end();

  const timeout = AbortSignal.timeout(120_000);
  try {
    const [stdout, stderr] = await Promise.race([
      Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]),
      new Promise<never>((_, reject) => timeout.addEventListener("abort", () => reject(new Error("claude CLI timed out after 120s")))),
    ]);
    await proc.exited;

    if (proc.exitCode !== 0) {
      const errMsg = stderr.trim() || "claude CLI returned non-zero exit code";
      throw new Error(`claude CLI error: ${errMsg}`);
    }

    return { content: stdout.trim(), toolsUsed: [] };
  } finally {
    // Kill the process if still running (e.g. timeout fired before stdout drained)
    proc.kill();
  }
}

export async function aiChat(params: AiChatParams, tools: boolean = false): Promise<AiChatResult> {
  const key = params.apiKey || process.env.ANTHROPIC_API_KEY;

  // No API key — try the locally installed claude CLI (uses Claude Code auth).
  // If the CLI isn't installed either, throw a structured error the renderer
  // can show as a "configure your API key" prompt instead of a cryptic spawn error.
  if (!key) {
    if (await claudeCliAvailable()) return aiChatViaCli(params, tools);
    throw {
      code: -32603,
      message:
        "Anthropic API key not configured and no local `claude` CLI found. " +
        "Add an ANTHROPIC_API_KEY in Settings or install the Claude CLI.",
    };
  }

  const client = new Anthropic({ apiKey: key });

  const messages: Anthropic.MessageParam[] = params.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const toolsUsed: string[] = [];
  const activeTools = getTools(tools);
  const system = buildSystem(params.context, tools);

  let response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2048,
    system,
    tools: activeTools,
    messages,
  });

  while (response.stop_reason === "tool_use") {
    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUseBlocks) {
      toolsUsed.push(tu.name);
      let result: string;
      try {
        result = await executeTool(tu.name, tu.input as Record<string, string>);
      } catch (e) {
        result = `Error: ${e instanceof Error ? e.message : String(e)}`;
      }
      toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: result });
    }

    messages.push({ role: "assistant", content: response.content });
    messages.push({ role: "user", content: toolResults });

    response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      system,
      tools: activeTools,
      messages,
    });
  }

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  return { content: text, toolsUsed };
}

const ENDPOINT_SYSTEM_PROMPT = `You are an Oracle ORDS expert helping a developer design a REST endpoint. Always respond in English.

Given the user's description and the available database objects, suggest the best endpoint configuration.

Output ONLY valid JSON matching this schema (no markdown, no prose):
{
  "type": "auto-crud" | "custom-sql" | "procedure",
  "reasoning": string,
  "sourceObjectName": string?,
  "sourceObjectKind": "TABLE" | "VIEW" | "PROCEDURE" | "FUNCTION"?,
  "sourceSql": string?,
  "routePattern": string?,
  "method": "GET" | "POST" | "PUT" | "DELETE"?,
  "moduleName": string?,
  "basePath": string?,
  "authMode": "none" | "role" | "oauth"?
}

Rules:
- "auto-crud" requires sourceObjectName + sourceObjectKind ("TABLE" | "VIEW")
- "custom-sql" requires sourceSql + routePattern + method (use :name for path params and bind variables in SQL)
- "procedure" requires sourceObjectName + sourceObjectKind ("PROCEDURE" | "FUNCTION") + routePattern + method (POST for procedures by default, GET for functions)
- Always suggest moduleName as kebab-case "<topic>-api"
- basePath should match the topic (e.g., "/sales/" for sales)
- Default authMode is "none" unless user mentions auth/protected/secured`;

export async function aiSuggestEndpoint(params: {
  apiKey: string | null;
  description: string;
  schemaName: string;
  availableTables: string[];
  availableViews: string[];
  availableProcedures: string[];
  availableFunctions: string[];
}): Promise<{ suggestion: unknown }> {
  const key = params.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw { code: -32603, message: "Anthropic API key not configured. Set it in Settings or via ANTHROPIC_API_KEY env var." };
  }

  const userContent = `Description: ${params.description}

Available in schema ${params.schemaName}:
- Tables: ${params.availableTables.slice(0, 100).join(", ") || "(none)"}
- Views: ${params.availableViews.slice(0, 100).join(", ") || "(none)"}
- Procedures: ${params.availableProcedures.slice(0, 100).join(", ") || "(none)"}
- Functions: ${params.availableFunctions.slice(0, 100).join(", ") || "(none)"}

Output ONLY the JSON config object.`;

  const client = new Anthropic({ apiKey: key });
  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    system: ENDPOINT_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  let suggestion: unknown;
  try {
    const cleaned = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/, "").trim();
    suggestion = JSON.parse(cleaned);
  } catch {
    throw { code: -32603, message: "AI returned invalid JSON: " + text.slice(0, 200) };
  }
  return { suggestion };
}
