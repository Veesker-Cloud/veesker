<script lang="ts">
  import { ordsTestHttp, type OrdsTestResult } from "$lib/workspace";

  type Props = {
    baseUrl: string;
    moduleBasePath: string;
    schemaName: string;
    onClose: () => void;
  };
  let { baseUrl, moduleBasePath, schemaName, onClose }: Props = $props();

  let method = $state("GET");
  let path = $state("");
  let headers = $state<[string, string][]>([["Content-Type", "application/json"]]);
  let bodyText = $state("");
  let response = $state<OrdsTestResult | null>(null);
  let sending = $state(false);
  let error = $state<string | null>(null);

  let showOAuthHelper = $state(false);
  let oauthClientId = $state("");
  let oauthClientSecret = $state("");
  let oauthFetching = $state(false);
  let oauthError = $state<string | null>(null);

  const fullUrl = $derived.by(() => {
    const cleanBase = baseUrl.replace(/\/$/, "");
    const schemaSegment = schemaName ? `/${schemaName.toLowerCase()}` : "";
    const cleanModule = moduleBasePath.startsWith("/") ? moduleBasePath : `/${moduleBasePath}`;
    const cleanPath = path.startsWith("/") ? path.slice(1) : path;
    return `${cleanBase}${schemaSegment}${cleanModule}${cleanPath}`;
  });

  async function send() {
    sending = true;
    error = null;
    response = null;
    const cleanHeaders = headers.filter(([k]) => k.trim() !== "");
    const res = await ordsTestHttp(
      method,
      fullUrl,
      cleanHeaders,
      method !== "GET" && bodyText.trim() ? bodyText : null,
      baseUrl.replace(/\/$/, ""),
    );
    sending = false;
    if (res.ok) response = res.data;
    else error = res.error.message;
  }

  function addHeader() {
    headers = [...headers, ["", ""]];
  }

  function removeHeader(i: number) {
    headers = headers.filter((_, idx) => idx !== i);
  }

  function setHeaderKey(i: number, val: string) {
    const next = headers.map((h, idx) => idx === i ? [val, h[1]] as [string, string] : h);
    headers = next;
  }

  function setHeaderVal(i: number, val: string) {
    const next = headers.map((h, idx) => idx === i ? [h[0], val] as [string, string] : h);
    headers = next;
  }

  async function fetchToken() {
    if (!oauthClientId.trim() || !oauthClientSecret.trim()) return;
    oauthFetching = true;
    oauthError = null;

    const cleanBase = baseUrl.replace(/\/$/, "");
    const tokenUrl = schemaName
      ? `${cleanBase}/${schemaName.toLowerCase()}/oauth/token`
      : `${cleanBase}/oauth/token`;

    const body = "grant_type=client_credentials";
    const auth = "Basic " + btoa(`${oauthClientId.trim()}:${oauthClientSecret.trim()}`);

    const res = await ordsTestHttp(
      "POST",
      tokenUrl,
      [
        ["Authorization", auth],
        ["Content-Type", "application/x-www-form-urlencoded"],
      ],
      body,
      baseUrl.replace(/\/$/, ""),
    );

    oauthFetching = false;
    if (!res.ok) {
      oauthError = res.error.message;
      return;
    }
    if (res.data.status >= 400) {
      oauthError = `Token request failed (${res.data.status}): ${res.data.body.slice(0, 300)}`;
      return;
    }

    let token: string | null = null;
    try {
      const parsed = JSON.parse(res.data.body);
      token = parsed.access_token ?? null;
    } catch {
      oauthError = "Resposta sem JSON válido: " + res.data.body.slice(0, 200);
      return;
    }
    if (!token) {
      oauthError = "Resposta não contém access_token";
      return;
    }

    const filtered = headers.filter(([k]) => k.toLowerCase() !== "authorization");
    headers = [["Authorization", `Bearer ${token}`], ...filtered];
    showOAuthHelper = false;
    oauthClientId = "";
    oauthClientSecret = "";
  }

  const prettyBody = $derived.by(() => {
    if (!response) return "";
    try {
      return JSON.stringify(JSON.parse(response.body), null, 2);
    } catch {
      return response.body;
    }
  });
</script>

<div class="panel">
  <div class="head">
    <span class="title">Test Endpoint</span>
    <button class="close" onclick={onClose} aria-label="Close">✕</button>
  </div>

  <div class="body">
    <div class="row">
      <select class="method-sel method-{method.toLowerCase()}" bind:value={method}>
        <option>GET</option><option>POST</option><option>PUT</option><option>DELETE</option><option>PATCH</option>
      </select>
      <input class="path-input" bind:value={path} placeholder="endpoint path…" />
    </div>
    <div class="full-url" title={fullUrl}>{fullUrl}</div>

    <h4>Headers</h4>
    {#each headers as h, i (i)}
      <div class="hdr-row">
        <input class="input sm" placeholder="Header" value={h[0]} oninput={(e) => setHeaderKey(i, (e.target as HTMLInputElement).value)} />
        <input class="input sm" placeholder="Value" value={h[1]} oninput={(e) => setHeaderVal(i, (e.target as HTMLInputElement).value)} />
        <button class="rm-btn" onclick={() => removeHeader(i)} aria-label="Remove header">✕</button>
      </div>
    {/each}
    <button class="add-btn" onclick={addHeader}>+ adicionar header</button>

    <button class="oauth-btn" onclick={() => showOAuthHelper = !showOAuthHelper}>
      {showOAuthHelper ? "▾ Ocultar OAuth" : "▸ Obter Bearer token (OAuth)"}
    </button>

    {#if showOAuthHelper}
      <div class="oauth-card">
        <div class="oauth-row">
          <span class="oauth-label">Client ID:</span>
          <input class="input sm" bind:value={oauthClientId} placeholder="..." />
        </div>
        <div class="oauth-row">
          <span class="oauth-label">Client Secret:</span>
          <input class="input sm" type="password" bind:value={oauthClientSecret} placeholder="..." />
        </div>
        {#if oauthError}<div class="oauth-err">{oauthError}</div>{/if}
        <button
          class="oauth-fetch"
          onclick={() => void fetchToken()}
          disabled={oauthFetching || !oauthClientId.trim() || !oauthClientSecret.trim()}
        >
          {oauthFetching ? "Solicitando…" : "Solicitar token e injetar header"}
        </button>
        <div class="oauth-hint">
          O token será obtido via <code>POST /oauth/token</code> (grant <code>client_credentials</code>) e adicionado como <code>Authorization: Bearer ...</code> nos headers.
        </div>
      </div>
    {/if}

    {#if method !== "GET"}
      <h4>Body (JSON)</h4>
      <textarea class="body-area" bind:value={bodyText} rows="4" placeholder={'{"key": "value"}'}></textarea>
    {/if}

    <button class="send-btn" onclick={() => void send()} disabled={sending}>
      {sending ? "Enviando…" : "▶ Send"}
    </button>

    {#if error}
      <div class="error"><strong>Erro:</strong> {error}</div>
    {/if}

    {#if response}
      <h4>Response</h4>
      <div class="status">
        <span class="status-code" class:ok={response.status >= 200 && response.status < 300}>
          {response.status}
        </span>
        <span class="ms">{response.elapsedMs}ms</span>
        <span class="size">{(response.body.length / 1024).toFixed(1)} KB</span>
      </div>
      <pre class="resp-body">{prettyBody}</pre>
    {/if}
  </div>
</div>

<style>
  .panel {
    width: 380px; height: 100%;
    background: var(--bg-surface); border-left: 1px solid var(--border);
    display: flex; flex-direction: column;
  }
  .head {
    padding: 10px 12px; border-bottom: 1px solid var(--border);
    display: flex; justify-content: space-between; align-items: center;
  }
  .title { font-weight: 600; color: var(--text-primary); font-size: 12.5px; }
  .close {
    background: none; border: none; color: var(--text-muted);
    cursor: pointer; padding: 2px 6px; font-size: 14px;
  }
  .close:hover { color: var(--text-primary); }
  .body { padding: 12px; overflow-y: auto; flex: 1; color: var(--text-primary); font-size: 11.5px; }
  .row { display: flex; gap: 6px; margin-bottom: 6px; }
  .method-sel {
    background: var(--input-bg); border: 1px solid var(--border);
    color: var(--text-primary); padding: 4px 8px; border-radius: 4px;
    font-size: 11px; font-weight: 600; min-width: 80px;
  }
  .method-sel.method-get    { color: #4a9eda; }
  .method-sel.method-post   { color: #8bc4a8; }
  .method-sel.method-put    { color: #c3a66e; }
  .method-sel.method-delete { color: #f5a08a; }
  .method-sel.method-patch  { color: #a78bfa; }
  .path-input {
    flex: 1; background: var(--input-bg); border: 1px solid var(--border);
    color: var(--text-primary); padding: 4px 8px; border-radius: 4px;
    font-size: 11px; font-family: "JetBrains Mono", monospace;
  }
  .full-url {
    font-family: "JetBrains Mono", monospace; color: var(--text-muted);
    font-size: 10.5px; margin-bottom: 12px; word-break: break-all;
    max-height: 40px; overflow: hidden;
  }
  h4 {
    font-size: 10.5px; text-transform: uppercase;
    color: var(--text-muted); margin: 12px 0 6px;
  }
  .hdr-row { display: flex; gap: 4px; margin-bottom: 4px; }
  .input.sm {
    flex: 1; background: var(--input-bg); border: 1px solid var(--border);
    color: var(--text-primary); padding: 3px 6px; border-radius: 3px;
    font-size: 10.5px; min-width: 0;
  }
  .rm-btn {
    background: none; border: none; color: var(--text-muted);
    cursor: pointer; padding: 0 6px;
  }
  .rm-btn:hover { color: #f5a08a; }
  .add-btn {
    background: none; border: 1px dashed var(--border);
    color: var(--text-muted); padding: 3px 8px; border-radius: 4px;
    cursor: pointer; font-size: 10.5px; margin-top: 4px;
  }
  .add-btn:hover { color: var(--text-primary); border-color: var(--text-muted); }
  .body-area {
    width: 100%; box-sizing: border-box;
    background: var(--input-bg); border: 1px solid var(--border);
    border-radius: 4px; color: var(--text-primary); padding: 6px;
    font-family: "JetBrains Mono", monospace; font-size: 10.5px;
    resize: vertical;
  }
  .send-btn {
    background: rgba(179,62,31,0.2); border: 1px solid rgba(179,62,31,0.45);
    color: #f5a08a; padding: 6px 12px; border-radius: 4px;
    cursor: pointer; margin-top: 12px; font-size: 11.5px; font-weight: 600;
    width: 100%;
  }
  .send-btn:hover:not(:disabled) { background: rgba(179,62,31,0.35); }
  .send-btn:disabled { opacity: 0.5; cursor: default; }
  .error {
    background: rgba(179,62,31,0.15); border: 1px solid rgba(179,62,31,0.3);
    color: #f5a08a; padding: 6px 8px; border-radius: 4px;
    margin-top: 8px; font-size: 11px; word-break: break-word;
  }
  .status { display: flex; gap: 8px; align-items: center; margin: 6px 0; font-size: 11px; }
  .status-code {
    font-weight: 700; padding: 2px 6px; border-radius: 3px;
    background: rgba(179,62,31,0.2); color: #f5a08a;
  }
  .status-code.ok { background: rgba(139,196,168,0.2); color: #8bc4a8; }
  .ms, .size { color: var(--text-muted); }
  .resp-body {
    background: var(--bg-page); border: 1px solid var(--border);
    border-radius: 4px; padding: 8px;
    font-family: "JetBrains Mono", monospace; font-size: 10.5px;
    max-height: 400px; overflow: auto; white-space: pre-wrap;
    margin: 0;
  }
  .oauth-btn {
    background: none; border: 1px dashed var(--border);
    color: var(--text-muted); padding: 4px 10px; border-radius: 4px;
    cursor: pointer; font-size: 10.5px; margin-top: 8px;
  }
  .oauth-btn:hover { color: var(--text-primary); border-color: var(--text-muted); }
  .oauth-card {
    background: var(--bg-surface-alt); border: 1px solid var(--border);
    border-radius: 4px; padding: 8px; margin-top: 6px;
    display: flex; flex-direction: column; gap: 6px;
  }
  .oauth-row { display: flex; gap: 6px; align-items: center; }
  .oauth-label { color: var(--text-muted); font-size: 10.5px; min-width: 90px; }
  .oauth-err {
    background: rgba(179,62,31,0.15); border: 1px solid rgba(179,62,31,0.3);
    color: #f5a08a; padding: 4px 6px; border-radius: 3px; font-size: 10px;
  }
  .oauth-fetch {
    background: rgba(179,62,31,0.18); border: 1px solid rgba(179,62,31,0.4);
    color: #f5a08a; padding: 4px 8px; border-radius: 4px; cursor: pointer;
    font-size: 11px; font-weight: 600;
  }
  .oauth-fetch:hover:not(:disabled) { background: rgba(179,62,31,0.32); }
  .oauth-fetch:disabled { opacity: 0.5; cursor: default; }
  .oauth-hint {
    font-size: 10px; color: var(--text-muted);
  }
  .oauth-hint code {
    font-family: monospace; background: var(--bg-page);
    padding: 1px 4px; border-radius: 2px; font-size: 9.5px;
  }
</style>
