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
      const res = await queryExecute({ sql: sql.endsWith(";") ? sql.slice(0, -1) : sql });
      if ("results" in res) {
        const first = (res as any).results?.[0];
        return JSON.stringify({ columns: first?.columns, rows: first?.rows?.slice(0, 50) }, null, 2);
      }
      return JSON.stringify({ columns: (res as any).columns, rows: (res as any).rows?.slice(0, 50) }, null, 2);
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

function buildSystem(ctx: AiContext): string {
  const ctxLines: string[] = [];
  if (ctx.currentSchema) ctxLines.push(`Current schema: ${ctx.currentSchema}`);
  if (ctx.selectedOwner && ctx.selectedName) {
    ctxLines.push(`Selected object: ${ctx.selectedKind ?? "OBJECT"} ${ctx.selectedOwner}.${ctx.selectedName}`);
  }
  if (ctx.activeSql?.trim()) {
    // Strip triple-backtick sequences that could break the code fence
    const safeSql = ctx.activeSql.slice(0, 800).replace(/`{3,}/g, "~~~");
    ctxLines.push(`Active SQL in editor:\n\`\`\`sql\n${safeSql}\n\`\`\``);
  }

  return `You are Veesker's Oracle database assistant — a knowledgeable, concise expert with the persona of a cyberpunk sheep mascot. You help developers understand Oracle schemas, debug queries, write PL/SQL, optimise performance, and give design insights.

You have live access to the connected Oracle database via tools. Use them proactively — describe tables before suggesting queries, run a quick SELECT to verify assumptions, fetch DDL when discussing objects.

Rules:
- Keep responses concise and actionable
- Use \`\`\`sql code blocks for all SQL
- Never suggest or execute DML/DDL via run_query — only SELECT/WITH
- Prefer using tools to verify before asserting
${ctxLines.length > 0 ? "\n[Current IDE context]\n" + ctxLines.join("\n") : ""}`;
}

async function aiChatViaCli(params: AiChatParams): Promise<AiChatResult> {
  const system = buildSystem(params.context);
  const lastUser = params.messages.filter((m) => m.role === "user").pop()?.content ?? "";

  const history = params.messages.slice(0, -1).map((m) =>
    `${m.role === "user" ? "Human" : "Assistant"}: ${m.content}`
  ).join("\n\n");

  // Embed system context + history into the prompt (claude CLI has no --system flag)
  const fullPrompt = [
    system,
    history ? `\n\n${history}\n\nHuman: ${lastUser}` : lastUser,
  ].join("\n\n");

  const proc = Bun.spawn(
    ["claude", "-p", fullPrompt],
    { stdout: "pipe", stderr: "pipe" }
  );

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;

  if (proc.exitCode !== 0) {
    const errMsg = stderr.trim() || "claude CLI returned non-zero exit code";
    throw new Error(`claude CLI error: ${errMsg}`);
  }

  return { content: stdout.trim(), toolsUsed: [] };
}

export async function aiChat(params: AiChatParams): Promise<AiChatResult> {
  const key = params.apiKey || process.env.ANTHROPIC_API_KEY;

  // No API key — try the locally installed claude CLI (uses Claude Code auth)
  if (!key) return aiChatViaCli(params);

  const client = new Anthropic({ apiKey: key });

  const messages: Anthropic.MessageParam[] = params.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const toolsUsed: string[] = [];
  const system = buildSystem(params.context);

  let response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2048,
    system,
    tools: TOOLS,
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
      tools: TOOLS,
      messages,
    });
  }

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  return { content: text, toolsUsed };
}
