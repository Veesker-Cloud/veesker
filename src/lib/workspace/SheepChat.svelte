<script lang="ts">
  import { aiChat, aiKeySave, aiKeyGet, type AiMessage, type AiContext, chartConfigureRpc, chartResetRpc, type ChartConfig, type PreviewData } from "$lib/workspace";
  import { addChart } from "$lib/stores/dashboard.svelte";
  import ChartWidget from "./ChartWidget.svelte";
  import { tick, onMount } from "svelte";

  type AnalyzePayload = {
    sessionId: string;
    columns: { name: string; dataType: string }[];
    rows: unknown[][];
    sql: string;
  };

  type ChatMessage = {
    role: "user" | "assistant";
    content: string;
    chartPreview?: { config: ChartConfig; previewData: PreviewData | null };
  };

  type Props = {
    context: AiContext;
    onClose: () => void;
    pendingMessage?: string;
    analyzePayload?: AnalyzePayload | null;
    onChartAdded?: () => void;
  };
  let { context, onClose, pendingMessage = "", analyzePayload = null, onChartAdded }: Props = $props();

  let messages = $state<ChatMessage[]>([]);
  let input = $state("");
  let loading = $state(false);
  let error = $state<string | null>(null);
  let showSettings = $state(false);
  let apiKey = $state("");
  let messagesEl = $state<HTMLDivElement | null>(null);

  let analyzeStep = $state<"type" | "xColumn" | "yColumns" | "aggregation" | "title" | "confirm" | null>(null);
  let currentAnalyzePayload = $state<AnalyzePayload | null>(null);

  $effect(() => {
    if (pendingMessage) input = pendingMessage;
  });

  $effect(() => {
    if (analyzePayload && analyzePayload.sessionId !== currentAnalyzePayload?.sessionId) {
      void startAnalyze(analyzePayload);
    }
  });

  onMount(async () => {
    apiKey = (await aiKeyGet("anthropic")) ?? "";
  });

  async function saveKey() {
    await aiKeySave("anthropic", apiKey);
    showSettings = false;
  }

  async function scrollToBottom() {
    await tick();
    if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function pushAssistant(content: string, chartPreview?: ChatMessage["chartPreview"]) {
    messages = [...messages, { role: "assistant" as const, content, chartPreview }];
  }

  const CHART_TYPES: Record<string, string> = {
    bar: "bar", "bar-h": "bar-h", barh: "bar-h", horizontal: "bar-h",
    line: "line", trend: "line",
    pie: "pie", donut: "pie",
    kpi: "kpi", card: "kpi", number: "kpi",
    table: "table", raw: "table",
  };

  const AGG_MAP: Record<string, string> = {
    sum: "sum", total: "sum",
    avg: "avg", average: "avg", mean: "avg",
    count: "count", cnt: "count",
    max: "max", maximum: "max",
    min: "min", minimum: "min",
    none: "none",
  };

  async function startAnalyze(payload: AnalyzePayload) {
    await chartResetRpc(payload.sessionId);
    currentAnalyzePayload = payload;
    analyzeStep = "type";
    messages = [];
    const colList = payload.columns.map((c) => c.name).join(", ");
    pushAssistant(
      `I'll help you build a chart from this result (${payload.columns.length} columns, ${payload.rows.length} rows).\n\n` +
      `**What type of chart would you like?**\n` +
      `- bar — vertical bars\n- bar-h — horizontal bars\n- line — trend line\n- pie — donut/pie\n- kpi — big number cards\n- table — formatted table\n\nAvailable columns: \`${colList}\``
    );
    await scrollToBottom();
  }

  async function handleAnalyzeAnswer(text: string, payload: AnalyzePayload) {
    const lower = text.toLowerCase().trim();

    if (analyzeStep === "type") {
      const matched = Object.entries(CHART_TYPES).find(([k]) => lower.includes(k));
      if (!matched) {
        pushAssistant("I didn't catch that — please say one of: bar, bar-h, line, pie, kpi, table.");
        return;
      }
      const r = await chartConfigureRpc({ sessionId: payload.sessionId, patch: { type: matched[1] as any }, columns: payload.columns, rows: payload.rows });
      if (!r.ok) {
        pushAssistant("Something went wrong. Please try again.");
        return;
      }
      if (matched[1] === "kpi" || matched[1] === "table") {
        analyzeStep = "yColumns";
        const numericCols = payload.columns.filter((c) => /NUMBER|FLOAT|INT/i.test(c.dataType));
        pushAssistant(
          `Got it — **${matched[1]}** chart.\n\n**Which column(s) for the values?** (comma-separated if multiple)\nNumeric columns: \`${numericCols.map((c) => c.name).join(", ") || payload.columns.map((c) => c.name).join(", ")}\``,
          { config: r.data.config, previewData: r.data.previewData }
        );
      } else {
        analyzeStep = "xColumn";
        pushAssistant(
          `Got it — **${matched[1]}** chart.\n\n**Which column for the X axis (labels)?**\nColumns: \`${payload.columns.map((c) => c.name).join(", ")}\``,
          { config: r.data.config, previewData: r.data.previewData }
        );
      }

    } else if (analyzeStep === "xColumn") {
      const col = payload.columns.find((c) => lower.includes(c.name.toLowerCase()));
      if (!col) {
        pushAssistant(`Column not found. Available: \`${payload.columns.map((c) => c.name).join(", ")}\``);
        return;
      }
      const r = await chartConfigureRpc({ sessionId: payload.sessionId, patch: { xColumn: col.name }, columns: payload.columns, rows: payload.rows });
      if (!r.ok) {
        pushAssistant("Something went wrong. Please try again.");
        return;
      }
      analyzeStep = "yColumns";
      const numericCols = payload.columns.filter((c) => /NUMBER|FLOAT|INT/i.test(c.dataType));
      pushAssistant(
        `X axis: **${col.name}**\n\n**Which column(s) for the Y axis (values)?** (comma-separated)\nNumeric columns: \`${numericCols.map((c) => c.name).join(", ") || payload.columns.map((c) => c.name).join(", ")}\``,
        { config: r.data.config, previewData: r.data.previewData }
      );

    } else if (analyzeStep === "yColumns") {
      const parts = text.split(",").map((s) => s.trim());
      const matched = parts
        .map((p) => payload.columns.find((c) => c.name.toLowerCase() === p.toLowerCase() || p.toLowerCase().includes(c.name.toLowerCase())))
        .filter((c): c is NonNullable<typeof c> => c !== undefined);
      if (matched.length === 0) {
        pushAssistant(`No columns matched. Available: \`${payload.columns.map((c) => c.name).join(", ")}\``);
        return;
      }
      const r = await chartConfigureRpc({ sessionId: payload.sessionId, patch: { yColumns: matched.map((c) => c.name) }, columns: payload.columns, rows: payload.rows });
      if (!r.ok) {
        pushAssistant("Something went wrong. Please try again.");
        return;
      }
      analyzeStep = "aggregation";
      pushAssistant(
        `Y axis: **${matched.map((c) => c.name).join(", ")}**\n\n**Aggregation for duplicate X values?**\nOptions: sum, avg, count, max, min, none`,
        { config: r.data.config, previewData: r.data.previewData }
      );

    } else if (analyzeStep === "aggregation") {
      const agg = Object.entries(AGG_MAP).find(([k]) => lower.includes(k));
      if (!agg) {
        pushAssistant("Please choose: sum, avg, count, max, min, or none.");
        return;
      }
      const r = await chartConfigureRpc({ sessionId: payload.sessionId, patch: { aggregation: agg[1] as any }, columns: payload.columns, rows: payload.rows });
      if (!r.ok) {
        pushAssistant("Something went wrong. Please try again.");
        return;
      }
      analyzeStep = "title";
      pushAssistant(
        `Aggregation: **${agg[1]}**\n\n**Give your chart a title:**`,
        { config: r.data.config, previewData: r.data.previewData }
      );

    } else if (analyzeStep === "title") {
      const r = await chartConfigureRpc({ sessionId: payload.sessionId, patch: { title: text }, columns: payload.columns, rows: payload.rows });
      if (!r.ok) {
        pushAssistant("Something went wrong. Please try again.");
        return;
      }
      analyzeStep = "confirm";
      pushAssistant(
        `Title: **${text}**\n\nHere's your chart — **add it to the Dashboard?** (yes / no)`,
        { config: r.data.config, previewData: r.data.previewData }
      );

    } else if (analyzeStep === "confirm") {
      if (lower.includes("yes") || lower === "y" || lower.includes("add")) {
        const r = await chartConfigureRpc({ sessionId: payload.sessionId, patch: {}, columns: payload.columns, rows: payload.rows });
        if (!r.ok) {
          pushAssistant("Something went wrong. Please try again.");
          return;
        }
        addChart({ config: r.data.config, previewData: r.data.previewData, sql: payload.sql, columns: payload.columns, rows: payload.rows });
        analyzeStep = null;
        currentAnalyzePayload = null;
        pushAssistant("✅ Chart added to Dashboard! Switch to the **📊 Dashboard** tab to see it.\n\nWant to add another chart from this result? Just ask.");
        onChartAdded?.();
      } else {
        analyzeStep = "type";
        pushAssistant("No problem — let's start over. **What type of chart would you like?**");
      }
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || loading) return;

    input = "";
    error = null;
    messages = [...messages, { role: "user" as const, content: text }];
    await scrollToBottom();

    if (analyzeStep !== null && currentAnalyzePayload) {
      await handleAnalyzeAnswer(text, currentAnalyzePayload);
      await scrollToBottom();
      return;
    }

    loading = true;
    const res = await aiChat(apiKey, messages.map(({ role, content }) => ({ role, content })), context);
    loading = false;

    if (res.ok) {
      messages = [...messages, { role: "assistant" as const, content: res.data.content }];
    } else {
      error = (res.error as any)?.message ?? "Unknown error";
    }
    await scrollToBottom();
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  function escapeHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  // Simple markdown: code blocks, inline code, bold, newlines
  // Code blocks are extracted first so surrounding text can be safely HTML-escaped.
  function renderMarkdown(text: string): string {
    const blocks: string[] = [];
    text = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
      const ph = `\x00CODE${blocks.length}\x00`;
      blocks.push(`<pre class="md-code" data-lang="${escapeHtml(lang || 'sql')}"><code>${escapeHtml(code).trimEnd()}</code></pre>`);
      return ph;
    });
    text = escapeHtml(text);
    text = text.replace(/`([^`\x00]+)`/g, '<code class="md-inline">$1</code>');
    text = text.replace(/\*\*([^*\x00]+)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/\n/g, '<br>');
    text = text.replace(/\x00CODE(\d+)\x00/g, (_, i) => blocks[Number(i)]);
    return text;
  }

  const ctxLabel = $derived(
    context.selectedOwner && context.selectedName
      ? `${context.selectedKind ?? ""} ${context.selectedOwner}.${context.selectedName}`
      : context.currentSchema ? `Schema: ${context.currentSchema}` : null
  );
</script>

<aside class="sheep-panel">
  <!-- Header -->
  <div class="panel-head">
    <div class="head-left">
      <img src="/veesker-sheep.png" class="head-sheep" alt="Veesker AI" />
      <span class="head-title">Veesker AI</span>
      {#if ctxLabel}
        <span class="ctx-chip">{ctxLabel}</span>
      {/if}
    </div>
    <div class="head-right">
      <button
        class="icon-btn"
        class:active={showSettings}
        onclick={() => showSettings = !showSettings}
        title="API settings"
        aria-label="Settings"
      >
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
          <circle cx="6.5" cy="6.5" r="2" stroke="currentColor" stroke-width="1.2"/>
          <path d="M6.5 1v1.2M6.5 10.8V12M1 6.5h1.2M10.8 6.5H12M2.6 2.6l.85.85M9.55 9.55l.85.85M2.6 10.4l.85-.85M9.55 3.45l.85-.85"
            stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
        </svg>
      </button>
      <button class="icon-btn" onclick={onClose} title="Close" aria-label="Close">
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
          <path d="M3 3l7 7M10 3l-7 7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
        </svg>
      </button>
    </div>
  </div>

  <!-- Settings pane -->
  {#if showSettings}
    <div class="settings-pane">
      <label class="settings-label">Anthropic API Key</label>
      <input
        class="settings-input"
        type="password"
        placeholder="sk-ant-… (leave empty to use ANTHROPIC_API_KEY env var)"
        bind:value={apiKey}
        onkeydown={(e) => e.key === "Enter" && void saveKey()}
      />
      <div class="settings-row">
        <span class="settings-hint">
          {apiKey ? "Stored in OS keychain" : "Will use ANTHROPIC_API_KEY from environment"}
        </span>
        <button class="save-btn" onclick={() => void saveKey()}>Save</button>
      </div>
    </div>
  {/if}

  <!-- Messages -->
  <div class="messages" bind:this={messagesEl}>
    {#if messages.length === 0 && !loading}
      <div class="empty-chat">
        <img src="/veesker-sheep.png" class="empty-sheep" alt="" aria-hidden="true" />
        <p>Ask me anything about your Oracle database — schema, queries, PL/SQL, performance.</p>
        <div class="suggestions">
          {#each [
            "What tables are in this schema?",
            "Explain this SQL query",
            "How do I write a MERGE statement?",
            "What indexes does this table have?",
          ] as s}
            <button class="suggestion" onclick={() => { input = s; void send(); }}>{s}</button>
          {/each}
        </div>
      </div>
    {:else}
      {#each messages as msg (msg)}
        <div class="msg" class:user={msg.role === "user"} class:assistant={msg.role === "assistant"}>
          {#if msg.role === "assistant"}
            <img src="/veesker-sheep.png" class="msg-avatar" alt="AI" />
          {/if}
          <div class="bubble" class:user-bubble={msg.role === "user"} class:ai-bubble={msg.role === "assistant"}>
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            {@html renderMarkdown(msg.content)}
            {#if msg.role === "assistant" && msg.chartPreview}
              <div class="msg-chart-preview">
                <ChartWidget config={msg.chartPreview.config} previewData={msg.chartPreview.previewData} compact={true} />
              </div>
            {/if}
          </div>
        </div>
      {/each}

      {#if loading}
        <div class="msg assistant">
          <img src="/veesker-sheep.png" class="msg-avatar" alt="AI" />
          <div class="bubble ai-bubble thinking">
            <span class="dots"><span></span><span></span><span></span></span>
          </div>
        </div>
      {/if}

      {#if error}
        <div class="error-msg">{error}</div>
      {/if}
    {/if}
  </div>

  <!-- Input -->
  <div class="input-row">
    <textarea
      class="chat-input"
      placeholder="Ask the sheep…"
      bind:value={input}
      onkeydown={onKeydown}
      rows={1}
      disabled={loading}
    ></textarea>
    <button class="send-btn" onclick={() => void send()} disabled={loading || !input.trim()} aria-label="Send">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M2 7h10M8.5 3.5L12 7l-3.5 3.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>
  </div>
</aside>

<style>
  .sheep-panel {
    width: 100%;
    height: 100%;
    min-width: 0;
    background: #1c1710;
    border-left: 1px solid rgba(255,255,255,0.07);
    display: flex;
    flex-direction: column;
    font-family: "Inter", -apple-system, system-ui, sans-serif;
    font-size: 12.5px;
    overflow: hidden;
  }

  /* ── Header ───────────────────────────────────────────────── */
  .panel-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.55rem 0.75rem;
    border-bottom: 1px solid rgba(255,255,255,0.07);
    background: #100e0b;
    flex-shrink: 0;
  }
  .head-left {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
    overflow: hidden;
  }
  .head-sheep {
    width: 24px;
    height: 24px;
    object-fit: contain;
    flex-shrink: 0;
  }
  .head-title {
    font-family: "Space Grotesk", sans-serif;
    font-weight: 600;
    font-size: 12.5px;
    color: rgba(255,255,255,0.85);
    white-space: nowrap;
    flex-shrink: 0;
  }
  .ctx-chip {
    font-family: "JetBrains Mono", monospace;
    font-size: 9.5px;
    color: rgba(255,255,255,0.4);
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.09);
    border-radius: 4px;
    padding: 1px 6px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 140px;
  }
  .head-right {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    flex-shrink: 0;
  }
  .icon-btn {
    background: transparent;
    border: none;
    color: rgba(255,255,255,0.35);
    padding: 4px;
    border-radius: 4px;
    cursor: pointer;
    display: flex;
    align-items: center;
    transition: color 0.1s, background 0.1s;
  }
  .icon-btn:hover, .icon-btn.active { color: rgba(255,255,255,0.75); background: rgba(255,255,255,0.07); }

  /* ── Settings ─────────────────────────────────────────────── */
  .settings-pane {
    padding: 0.75rem;
    background: rgba(0,0,0,0.25);
    border-bottom: 1px solid rgba(255,255,255,0.07);
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    flex-shrink: 0;
  }
  .settings-label {
    font-family: "Space Grotesk", sans-serif;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: rgba(255,255,255,0.4);
  }
  .settings-input {
    background: rgba(255,255,255,0.07);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 5px;
    color: rgba(255,255,255,0.8);
    font-family: "JetBrains Mono", monospace;
    font-size: 11px;
    padding: 0.35rem 0.6rem;
    outline: none;
    transition: border-color 0.12s;
  }
  .settings-input:focus { border-color: rgba(179,62,31,0.6); }
  .settings-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }
  .settings-hint {
    font-size: 10px;
    color: rgba(255,255,255,0.25);
    flex: 1;
  }
  .save-btn {
    background: #b33e1f;
    border: none;
    color: #fff;
    font-family: "Space Grotesk", sans-serif;
    font-size: 11px;
    font-weight: 600;
    padding: 0.25rem 0.7rem;
    border-radius: 4px;
    cursor: pointer;
    flex-shrink: 0;
  }
  .save-btn:hover { background: #c94b28; }

  /* ── Messages ─────────────────────────────────────────────── */
  .messages {
    flex: 1;
    overflow-y: auto;
    padding: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
    scroll-behavior: smooth;
  }
  .empty-chat {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
    padding: 1rem 0.5rem;
    text-align: center;
  }
  .empty-sheep {
    width: 64px;
    height: 64px;
    object-fit: contain;
    opacity: 0.6;
  }
  .empty-chat p {
    margin: 0;
    color: rgba(255,255,255,0.4);
    font-size: 12px;
    line-height: 1.5;
  }
  .suggestions {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    width: 100%;
  }
  .suggestion {
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.09);
    border-radius: 6px;
    color: rgba(255,255,255,0.5);
    font-family: "Inter", sans-serif;
    font-size: 11px;
    padding: 0.4rem 0.6rem;
    text-align: left;
    cursor: pointer;
    transition: all 0.1s;
  }
  .suggestion:hover {
    background: rgba(255,255,255,0.09);
    color: rgba(255,255,255,0.8);
    border-color: rgba(255,255,255,0.15);
  }

  .msg {
    display: flex;
    align-items: flex-end;
    gap: 0.5rem;
  }
  .msg.user { flex-direction: row-reverse; }
  .msg-avatar {
    width: 26px;
    height: 26px;
    object-fit: contain;
    flex-shrink: 0;
    margin-bottom: 2px;
  }
  .bubble {
    max-width: 88%;
    min-width: 0;
    padding: 0.55rem 0.75rem;
    border-radius: 10px;
    line-height: 1.55;
    font-size: 12.5px;
    word-break: break-word;
  }
  .user-bubble {
    background: #b33e1f;
    color: #fff;
    border-bottom-right-radius: 3px;
    align-self: flex-end;
  }
  .ai-bubble {
    background: rgba(255,255,255,0.07);
    color: rgba(255,255,255,0.85);
    border-bottom-left-radius: 3px;
  }
  .thinking {
    padding: 0.6rem 0.85rem;
  }

  /* Typing dots */
  .dots {
    display: inline-flex;
    gap: 4px;
    align-items: center;
  }
  .dots span {
    width: 5px; height: 5px;
    background: rgba(255,255,255,0.4);
    border-radius: 50%;
    animation: dotpulse 1.2s ease-in-out infinite;
  }
  .dots span:nth-child(2) { animation-delay: 0.2s; }
  .dots span:nth-child(3) { animation-delay: 0.4s; }
  @keyframes dotpulse {
    0%, 80%, 100% { transform: scale(0.7); opacity: 0.4; }
    40% { transform: scale(1); opacity: 1; }
  }

  @keyframes spin { to { transform: rotate(360deg); } }

  .error-msg {
    background: rgba(179,62,31,0.15);
    border: 1px solid rgba(179,62,31,0.3);
    color: #f5a08a;
    font-size: 11.5px;
    padding: 0.5rem 0.75rem;
    border-radius: 6px;
  }

  /* ── Markdown rendering ───────────────────────────────────── */
  :global(.md-code) {
    background: rgba(0,0,0,0.35);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 6px;
    padding: 0.6rem 0.75rem;
    overflow-x: auto;
    margin: 0.4rem -0.1rem;
    font-family: "JetBrains Mono", "SF Mono", monospace;
    font-size: 11px;
    line-height: 1.5;
    white-space: pre;
    max-width: 100%;
    box-sizing: border-box;
  }
  :global(.ai-bubble .md-code) {
    background: rgba(0,0,0,0.4);
  }
  :global(.user-bubble .md-code) {
    background: rgba(0,0,0,0.25);
  }
  :global(.md-inline) {
    font-family: "JetBrains Mono", monospace;
    font-size: 11px;
    background: rgba(255,255,255,0.1);
    border-radius: 3px;
    padding: 1px 4px;
  }
  :global(.user-bubble .md-inline) {
    background: rgba(255,255,255,0.2);
  }

  /* ── Input row ────────────────────────────────────────────── */
  .input-row {
    display: flex;
    align-items: flex-end;
    gap: 0.4rem;
    padding: 0.6rem 0.75rem;
    border-top: 1px solid rgba(255,255,255,0.07);
    background: #100e0b;
    flex-shrink: 0;
  }
  .chat-input {
    flex: 1;
    background: rgba(255,255,255,0.07);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 8px;
    color: rgba(255,255,255,0.85);
    font-family: "Inter", sans-serif;
    font-size: 12.5px;
    padding: 0.45rem 0.65rem;
    outline: none;
    resize: none;
    min-height: 36px;
    max-height: 120px;
    line-height: 1.45;
    transition: border-color 0.12s;
  }
  .chat-input:focus { border-color: rgba(179,62,31,0.5); }
  .chat-input::placeholder { color: rgba(255,255,255,0.25); }
  .chat-input:disabled { opacity: 0.5; }
  .send-btn {
    background: #b33e1f;
    border: none;
    color: #fff;
    border-radius: 7px;
    width: 34px;
    height: 34px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background 0.12s;
    flex-shrink: 0;
  }
  .send-btn:hover:not(:disabled) { background: #c94b28; }
  .send-btn:disabled { opacity: 0.4; cursor: default; }
  .msg-chart-preview { margin-top: 8px; }
</style>
