<script lang="ts">
  import { ordsModuleGet, type RestModuleDetail } from "$lib/workspace";

  type Props = {
    owner: string;
    moduleName: string;
    onTest: (modulePath: string, templateUri: string, method: string) => void;
    onOpenDocs: (modulePath: string) => void;
    onAddEndpoint: () => void;
    onExportSql: () => void;
  };
  let { owner, moduleName, onTest, onOpenDocs, onAddEndpoint, onExportSql }: Props = $props();

  let detail = $state<RestModuleDetail | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let expandedHandlers = $state<Set<string>>(new Set());

  $effect(() => {
    void load(owner, moduleName);
  });

  async function load(o: string, n: string) {
    loading = true;
    error = null;
    detail = null;
    const res = await ordsModuleGet(o, n);
    loading = false;
    if (res.ok) detail = res.data;
    else error = res.error.message;
  }

  function toggleHandler(key: string) {
    const s = new Set(expandedHandlers);
    if (s.has(key)) s.delete(key); else s.add(key);
    expandedHandlers = s;
  }
</script>

<div class="rest-details">
  {#if loading}
    <div class="state-msg">Carregando módulo…</div>
  {:else if error}
    <div class="state-msg error">{error}</div>
  {:else if detail}
    <div class="header">
      <div class="title-row">
        <span class="title">📦 {detail.module.name}</span>
        <div class="actions">
          <button class="btn" onclick={() => onTest(detail.module.basePath, "", "GET")}>Test</button>
          <button class="btn" onclick={() => onOpenDocs(detail.module.basePath)}>Docs ↗</button>
        </div>
      </div>
      <div class="meta">
        <span>Base: <code>{detail.module.basePath}</code></span>
        <span>·</span>
        <span>Status: {detail.module.status}</span>
        {#if detail.module.itemsPerPage !== null}
          <span>·</span>
          <span>Page: {detail.module.itemsPerPage}</span>
        {/if}
      </div>
      {#if detail.module.comments}
        <div class="comments">{detail.module.comments}</div>
      {/if}
    </div>

    <div class="section">
      <h3>Templates ({detail.templates.length})</h3>
      {#if detail.templates.length === 0}
        <div class="empty">Este módulo não tem templates definidos.</div>
      {/if}
      {#each detail.templates as tpl (tpl.uriTemplate)}
        <div class="template">
          <div class="tpl-uri"><code>{tpl.uriTemplate || "/"}</code></div>
          {#if tpl.handlers.length === 0}
            <div class="empty sub">Nenhum handler neste template.</div>
          {/if}
          {#each tpl.handlers as h (tpl.uriTemplate + "-" + h.method)}
            {@const key = `${tpl.uriTemplate}-${h.method}`}
            <div class="handler">
              <div class="handler-row">
                <span class="method method-{h.method.toLowerCase()}">{h.method}</span>
                <span class="src-type">{h.sourceType}</span>
                <button class="link-btn" onclick={() => toggleHandler(key)}>
                  {expandedHandlers.has(key) ? "▴ hide source" : "▾ view source"}
                </button>
              </div>
              {#if expandedHandlers.has(key)}
                <pre class="source">{h.source}</pre>
              {/if}
            </div>
          {/each}
        </div>
      {/each}
    </div>

    {#if detail.privileges.length > 0}
      <div class="section">
        <h3>Privileges ({detail.privileges.length})</h3>
        {#each detail.privileges as p (p.name)}
          <div class="priv">
            <code>{p.name}</code>
            <span class="priv-meta">roles: {p.roles.join(", ") || "—"}</span>
          </div>
        {/each}
      </div>
    {/if}

    <div class="footer">
      <button class="btn" onclick={onExportSql}>Export as SQL</button>
      <button class="btn primary" onclick={onAddEndpoint}>Add new endpoint</button>
    </div>
  {/if}
</div>

<style>
  .rest-details {
    padding: 12px;
    color: var(--text-primary);
    overflow-y: auto;
    height: 100%;
    box-sizing: border-box;
  }
  .state-msg { padding: 20px; color: var(--text-muted); font-size: 12px; }
  .state-msg.error { color: #f5a08a; }
  .header {
    padding-bottom: 10px;
    border-bottom: 1px solid var(--border);
    margin-bottom: 12px;
  }
  .title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .title { font-size: 14px; font-weight: 600; }
  .actions { display: flex; gap: 6px; }
  .meta {
    display: flex;
    gap: 6px;
    margin-top: 6px;
    font-size: 11px;
    color: var(--text-muted);
    flex-wrap: wrap;
  }
  .comments {
    margin-top: 6px;
    font-size: 11px;
    color: var(--text-muted);
    font-style: italic;
  }
  code {
    font-family: "JetBrains Mono", monospace;
    background: var(--bg-surface-alt);
    padding: 1px 5px;
    border-radius: 3px;
    font-size: 11px;
  }
  .section { margin-bottom: 14px; }
  .section h3 {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
    margin: 0 0 8px;
  }
  .empty {
    font-size: 11px;
    color: var(--text-muted);
    font-style: italic;
    padding: 4px 0;
  }
  .empty.sub { padding-left: 8px; }
  .template {
    background: var(--bg-surface-alt);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 8px;
    margin-bottom: 6px;
  }
  .tpl-uri { margin-bottom: 6px; font-size: 12px; }
  .handler {
    padding: 4px 0;
    border-top: 1px solid var(--border);
  }
  .handler:first-of-type { border-top: none; }
  .handler-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
  }
  .method {
    font-family: monospace;
    font-weight: 700;
    padding: 1px 6px;
    border-radius: 3px;
    font-size: 10px;
    min-width: 46px;
    text-align: center;
  }
  .method-get    { background: rgba(74,158,218,0.2);   color: #4a9eda; }
  .method-post   { background: rgba(139,196,168,0.2);  color: #8bc4a8; }
  .method-put    { background: rgba(195,166,110,0.2);  color: #c3a66e; }
  .method-delete { background: rgba(245,160,138,0.2);  color: #f5a08a; }
  .src-type { color: var(--text-muted); font-size: 10.5px; }
  .link-btn {
    margin-left: auto;
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 10px;
  }
  .link-btn:hover { color: var(--text-primary); }
  .source {
    background: var(--bg-page);
    border: 1px solid var(--border);
    border-radius: 3px;
    padding: 8px;
    font-size: 10.5px;
    font-family: monospace;
    white-space: pre-wrap;
    margin: 6px 0 2px;
    max-height: 200px;
    overflow-y: auto;
  }
  .priv {
    font-size: 11px;
    padding: 4px 0;
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .priv-meta { color: var(--text-muted); font-size: 10.5px; }
  .footer {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    margin-top: 16px;
    padding-top: 10px;
    border-top: 1px solid var(--border);
  }
  .btn {
    background: var(--bg-surface-alt);
    border: 1px solid var(--border);
    color: var(--text-primary);
    padding: 4px 10px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 11px;
  }
  .btn:hover { background: var(--row-hover); }
  .btn.primary {
    background: rgba(179,62,31,0.2);
    border-color: rgba(179,62,31,0.45);
    color: #f5a08a;
  }
  .btn.primary:hover { background: rgba(179,62,31,0.35); }
</style>
