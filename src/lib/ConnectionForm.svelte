<script lang="ts">
  import { untrack } from "svelte";
  import { open } from "@tauri-apps/plugin-dialog";
  import {
    walletInspect,
    type ConnectionInput,
    type ConnectionEnv,
  } from "$lib/connections";
  import { testConnection } from "$lib/connection";
  import SecurityDisclaimerModal from "$lib/workspace/SecurityDisclaimerModal.svelte";

  type TestState =
    | { kind: "idle" }
    | { kind: "running" }
    | { kind: "ok"; serverVersion: string; elapsedMs: number }
    | { kind: "err"; message: string };

  type SaveState =
    | { kind: "idle" }
    | { kind: "running" }
    | { kind: "err"; message: string };

  type WalletPick =
    | { kind: "none" }
    | { kind: "loading"; path: string }
    | { kind: "ready"; path: string; aliases: string[] }
    | { kind: "err"; path: string; message: string };

  let {
    initial,
    submitLabel = "Save",
    passwordMissing = false,
    walletPasswordMissing = false,
    isEdit = false,
    onSave,
    onCancel,
  }: {
    initial: ConnectionInput;
    submitLabel?: string;
    passwordMissing?: boolean;
    walletPasswordMissing?: boolean;
    isEdit?: boolean;
    onSave: (input: ConnectionInput) => Promise<{ ok: true; id: string } | { ok: false; message: string }>;
    onCancel: () => void;
  } = $props();

  let authType = $state<"basic" | "wallet">(untrack(() => initial.authType));
  let id = $state<string | undefined>(untrack(() => initial.id));
  let name = $state(untrack(() => initial.name));
  let username = $state(untrack(() => initial.username));
  let password = $state(untrack(() => initial.password));

  let host = $state(untrack(() => initial.authType === "basic" ? initial.host : "localhost"));
  let port = $state(untrack(() => initial.authType === "basic" ? initial.port : 1521));
  let serviceName = $state(untrack(() => initial.authType === "basic" ? initial.serviceName : "FREEPDB1"));

  let walletPassword = $state(untrack(() => initial.authType === "wallet" ? initial.walletPassword : ""));
  let connectAlias = $state(untrack(() => initial.authType === "wallet" ? initial.connectAlias : ""));

  // Safety fields — default to permissive so existing UX is unchanged
  let env = $state<ConnectionEnv | "">(untrack(() => initial.safety?.env ?? ""));
  let readOnly = $state<boolean>(untrack(() => initial.safety?.readOnly ?? false));
  let statementTimeoutSec = $state<string>(untrack(() => {
    const ms = initial.safety?.statementTimeoutMs;
    return ms !== undefined && ms > 0 ? String(Math.round(ms / 1000)) : "";
  }));
  let warnUnsafeDml = $state<boolean>(untrack(() => initial.safety?.warnUnsafeDml ?? false));
  let showSafety = $state<boolean>(untrack(() => {
    const s = initial.safety;
    return !!(s && (s.env || s.readOnly || s.statementTimeoutMs || s.warnUnsafeDml));
  }));
  let walletPick = $state<WalletPick>(
    untrack(() =>
      initial.authType === "wallet" && isEdit
        ? { kind: "ready", path: "(saved)", aliases: [initial.connectAlias] }
        : { kind: "none" }
    )
  );

  let testState = $state<TestState>({ kind: "idle" });
  let saveState = $state<SaveState>({ kind: "idle" });
  let showDisclaimer = $state(false);

  function needsDisclaimer(): boolean {
    if (typeof localStorage === "undefined") return false;
    if (id === undefined) return true;
    return !localStorage.getItem(`veesker.security.accepted.${id}`);
  }

  async function doSave(): Promise<void> {
    saveState = { kind: "running" };
    const res = await onSave(buildInput());
    if (res.ok) {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(`veesker.security.accepted.${res.id}`, "1");
      }
      saveState = { kind: "idle" };
    } else {
      saveState = { kind: "err", message: res.message };
    }
  }

  async function pickWalletZip() {
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "Wallet zip", extensions: ["zip"] }],
    });
    if (typeof selected !== "string") return;
    walletPick = { kind: "loading", path: selected };
    const res = await walletInspect(selected);
    if (!res.ok) {
      walletPick = { kind: "err", path: selected, message: res.error.message };
      return;
    }
    walletPick = { kind: "ready", path: selected, aliases: res.data.aliases };
    if (!res.data.aliases.includes(connectAlias)) {
      connectAlias = res.data.aliases[0] ?? "";
    }
  }

  function buildSafety() {
    const timeoutSec = Number.parseInt(statementTimeoutSec, 10);
    const statementTimeoutMs =
      Number.isFinite(timeoutSec) && timeoutSec > 0 ? timeoutSec * 1000 : undefined;
    return {
      env: env === "" ? undefined : env,
      readOnly,
      statementTimeoutMs,
      warnUnsafeDml,
    };
  }

  function buildInput(): ConnectionInput {
    const safety = buildSafety();
    if (authType === "basic") {
      return { authType: "basic", id, name, host, port, serviceName, username, password, safety };
    }
    return {
      authType: "wallet",
      id,
      name,
      walletZipPath: walletPick.kind === "ready" && walletPick.path !== "(saved)" ? walletPick.path : undefined,
      walletPassword,
      connectAlias,
      username,
      password,
      safety,
    };
  }

  async function onTest() {
    testState = { kind: "running" };
    if (authType === "basic") {
      const res = await testConnection({
        authType: "basic",
        host,
        port,
        serviceName,
        username,
        password,
      });
      testState = res.ok
        ? { kind: "ok", serverVersion: res.data.serverVersion, elapsedMs: res.data.elapsedMs }
        : { kind: "err", message: res.error.message };
      return;
    }
    if (walletPick.kind !== "ready" || walletPick.path === "(saved)") {
      testState = { kind: "err", message: "Re-upload the wallet zip to test (we need its on-disk location)." };
      return;
    }
    testState = {
      kind: "err",
      message: "Save the connection first, then click Test (wallet must be extracted to disk).",
    };
  }

  async function onSubmit(event: Event) {
    event.preventDefault();
    if (needsDisclaimer()) {
      showDisclaimer = true;
      return;
    }
    await doSave();
  }
</script>

<form onsubmit={onSubmit}>
  {#if !isEdit}
    <div class="auth-toggle">
      <label class="radio">
        <input type="radio" bind:group={authType} value="basic" />
        Basic (host/port/service)
      </label>
      <label class="radio">
        <input type="radio" bind:group={authType} value="wallet" />
        Wallet (Autonomous DB / mTLS)
      </label>
    </div>
  {:else}
    <div class="auth-fixed">Auth: <strong>{authType === "basic" ? "Basic" : "Wallet (mTLS)"}</strong></div>
  {/if}

  {#if passwordMissing}
    <div class="banner warn">User password not in keychain — re-enter to save.</div>
  {/if}
  {#if walletPasswordMissing}
    <div class="banner warn">Wallet password not in keychain — re-enter to save.</div>
  {/if}

  <label>
    Name
    <input type="text" bind:value={name} required autocomplete="off" />
  </label>

  {#if authType === "basic"}
    <label>
      Host
      <input type="text" bind:value={host} required />
    </label>
    <div class="row">
      <label class="port">
        Port
        <input type="number" bind:value={port} min="1" max="65535" required />
      </label>
      <label class="service">
        Service name
        <input type="text" bind:value={serviceName} required />
      </label>
    </div>
  {:else}
    <div class="wallet-pick">
      <span class="wallet-label">Wallet</span>
      {#if walletPick.kind === "none"}
        <button type="button" class="ghost" onclick={pickWalletZip}>Choose wallet .zip…</button>
      {:else if walletPick.kind === "loading"}
        <span class="muted">Reading {walletPick.path}…</span>
      {:else if walletPick.kind === "ready"}
        <div class="wallet-row">
          <span class="path-mono">{walletPick.path}</span>
          <button type="button" class="ghost" onclick={pickWalletZip}>{walletPick.path === "(saved)" ? "Replace wallet…" : "Choose another…"}</button>
        </div>
      {:else}
        <div class="wallet-row">
          <span class="err">{walletPick.message}</span>
          <button type="button" class="ghost" onclick={pickWalletZip}>Try again…</button>
        </div>
      {/if}
    </div>

    <label>
      Connect alias
      <select bind:value={connectAlias} disabled={walletPick.kind !== "ready"} required>
        {#if walletPick.kind === "ready"}
          {#each walletPick.aliases as alias}
            <option value={alias}>{alias}</option>
          {/each}
        {:else}
          <option value="">Choose a wallet first…</option>
        {/if}
      </select>
    </label>

    <label>
      Wallet password
      <input type="password" bind:value={walletPassword} autocomplete="off" required />
    </label>
  {/if}

  <label>
    Username
    <input type="text" bind:value={username} autocomplete="off" required />
  </label>
  <label>
    Password
    <input type="password" bind:value={password} autocomplete="off" required />
  </label>

  <button
    type="button"
    class="safety-toggle"
    aria-expanded={showSafety}
    onclick={() => (showSafety = !showSafety)}
  >
    {showSafety ? "▼" : "▶"} Safety guards
    {#if env || readOnly || statementTimeoutSec || warnUnsafeDml}
      <span class="safety-summary">
        {#if env}<span class="badge badge-{env}">{env}</span>{/if}
        {#if readOnly}<span class="badge badge-ro">read-only</span>{/if}
        {#if statementTimeoutSec}<span class="badge">{statementTimeoutSec}s timeout</span>{/if}
        {#if warnUnsafeDml}<span class="badge badge-warn">warn DML</span>{/if}
      </span>
    {:else}
      <span class="safety-hint">all off · click to configure</span>
    {/if}
  </button>

  {#if showSafety}
    <div class="safety-panel">
      <p class="safety-blurb">
        These flags are <strong>per-connection</strong> and <strong>off by default</strong>. They're
        opt-in safety nets for production work — none of them slow Veesker down or block you from
        running DDL/DML when off.
      </p>

      <div class="safety-row">
        <label class="safety-field">
          Environment
          <select bind:value={env}>
            <option value="">— unspecified —</option>
            <option value="dev">dev</option>
            <option value="staging">staging</option>
            <option value="prod">prod (red badge)</option>
          </select>
          <small>Tags the tab so you remember which env you're in.</small>
        </label>

        <label class="safety-field">
          Statement timeout (seconds)
          <input
            type="number"
            min="0"
            placeholder="empty = no timeout"
            bind:value={statementTimeoutSec}
          />
          <small>Kills any single statement that runs longer. Default: unlimited.</small>
        </label>
      </div>

      <label class="safety-check">
        <input type="checkbox" bind:checked={readOnly} />
        <span>
          <strong>Read-only mode</strong> — refuse DML/DDL on this connection (SELECT/EXPLAIN/WITH allowed).
        </span>
      </label>

      <label class="safety-check">
        <input type="checkbox" bind:checked={warnUnsafeDml} />
        <span>
          <strong>Warn on unsafe DML</strong> — show EXPLAIN PLAN + estimated rows before running
          UPDATE/DELETE without a WHERE clause.
        </span>
      </label>
    </div>
  {/if}

  <div class="actions">
    <button type="button" class="ghost" onclick={onTest} disabled={testState.kind === "running"}>
      {testState.kind === "running" ? "Testing…" : "Test"}
    </button>
    <button type="button" class="ghost" onclick={onCancel}>Cancel</button>
    <button type="submit" disabled={saveState.kind === "running"}>
      {saveState.kind === "running" ? "Saving…" : submitLabel}
    </button>
  </div>

  {#if testState.kind === "ok"}
    <div class="status ok">
      <strong>Connected.</strong>
      <span>{testState.serverVersion}</span>
      <span class="meta">{testState.elapsedMs} ms</span>
    </div>
  {:else if testState.kind === "err"}
    <div class="status err">
      <strong>Test failed.</strong>
      <span>{testState.message}</span>
    </div>
  {/if}

  {#if saveState.kind === "err"}
    <div class="status err">
      <strong>Save failed.</strong>
      <span>{saveState.message}</span>
    </div>
  {/if}
  {#if showDisclaimer}
    <SecurityDisclaimerModal
      onAccept={() => { showDisclaimer = false; void doSave(); }}
      onCancel={() => { showDisclaimer = false; }}
    />
  {/if}
</form>

<style>
  form { display: flex; flex-direction: column; gap: 1rem; }
  label {
    display: flex; flex-direction: column; gap: 0.35rem;
    font-family: "Inter", sans-serif; font-size: 12px; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-secondary);
  }
  input, select {
    font-family: "Inter", sans-serif; font-size: 14px; font-weight: 400;
    text-transform: none; letter-spacing: normal;
    color: var(--text-primary); background: var(--bg-surface-raised);
    border: 1px solid var(--border-strong);
    border-radius: 6px; padding: 0.6rem 0.75rem;
  }
  input:focus, select:focus { outline: none; border-color: #b33e1f; }
  .row { display: grid; grid-template-columns: 1fr 2fr; gap: 1rem; }
  .auth-toggle, .auth-fixed {
    display: flex; flex-direction: row; gap: 1rem;
    padding: 0.75rem 1rem; background: var(--bg-surface-raised);
    border: 1px solid var(--border); border-radius: 6px;
    font-family: "Inter", sans-serif; font-size: 13px; color: var(--text-primary);
    text-transform: none; letter-spacing: normal; font-weight: 400;
  }
  .radio { flex-direction: row; align-items: center; gap: 0.4rem;
    text-transform: none; letter-spacing: normal; font-weight: 400; font-size: 13px;
    color: var(--text-primary);
  }
  .radio input { margin: 0; }
  .wallet-pick { display: flex; flex-direction: column; gap: 0.5rem;
    padding: 0.75rem 1rem; background: var(--bg-surface-raised);
    border: 1px dashed var(--border-strong); border-radius: 6px;
  }
  .wallet-label {
    font-family: "Inter", sans-serif; font-size: 12px; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-secondary);
  }
  .wallet-row { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; }
  .path-mono {
    font-family: "JetBrains Mono", "SF Mono", monospace;
    font-size: 12px; color: var(--text-primary);
    word-break: break-all;
  }
  .muted { color: var(--text-secondary); font-size: 13px; }
  .err { color: #7a2a14; font-size: 13px; }
  .actions { display: flex; gap: 0.5rem; margin-top: 0.5rem; }
  button {
    flex: 1; font-family: "Space Grotesk", sans-serif; font-size: 14px;
    font-weight: 500; letter-spacing: 0.04em; color: var(--bg-surface);
    background: var(--text-primary); border: none; border-radius: 6px;
    padding: 0.85rem 1rem; cursor: pointer;
  }
  button.ghost { color: var(--text-primary); background: transparent;
    border: 1px solid var(--border-strong);
  }
  button:disabled { opacity: 0.5; cursor: progress; }
  button:hover:not(:disabled) {
    background: #b33e1f; color: #f6f1e8; border-color: #b33e1f;
  }
  .banner { padding: 0.75rem 1rem; border-radius: 6px;
    font-family: "Inter", sans-serif; font-size: 13px;
  }
  .banner.warn { background: rgba(179, 62, 31, 0.08);
    color: #7a2a14; border: 1px solid rgba(179, 62, 31, 0.3);
  }
  .status { font-family: "Inter", sans-serif; font-size: 13px;
    line-height: 1.5; padding: 0.85rem 1rem; border-radius: 6px;
    display: flex; flex-direction: column; gap: 0.25rem;
  }
  .status.ok { background: rgba(46, 125, 50, 0.08);
    color: #1b5e20; border: 1px solid rgba(46, 125, 50, 0.25);
  }
  .status.err { background: rgba(179, 62, 31, 0.08);
    color: #7a2a14; border: 1px solid rgba(179, 62, 31, 0.3);
  }
  .meta { font-size: 11px; opacity: 0.6; }

  /* ── Safety panel ─────────────────────────────────────────── */
  .safety-toggle {
    flex: none;
    display: flex; align-items: center; gap: 0.5rem;
    background: transparent; border: 1px solid var(--border);
    color: var(--text-secondary); padding: 0.5rem 0.85rem;
    font-family: "Inter", sans-serif; font-size: 12px; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.06em;
    border-radius: 6px; cursor: pointer; text-align: left;
  }
  .safety-toggle:hover { background: var(--row-hover); color: var(--text-primary); border-color: var(--border-strong); }
  .safety-summary { display: flex; gap: 0.3rem; flex-wrap: wrap; margin-left: auto; }
  .safety-hint {
    margin-left: auto; font-size: 11px; font-weight: 400;
    text-transform: none; letter-spacing: normal; color: var(--text-muted);
  }
  .badge {
    display: inline-block; padding: 1px 7px; border-radius: 3px;
    font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;
    background: var(--bg-surface-raised); color: var(--text-primary);
    border: 1px solid var(--border);
  }
  .badge-prod { background: rgba(179, 62, 31, 0.18); color: #d36b4f; border-color: rgba(179, 62, 31, 0.4); }
  .badge-staging { background: rgba(217, 153, 42, 0.18); color: #d99c2a; border-color: rgba(217, 153, 42, 0.4); }
  .badge-dev { background: rgba(74, 158, 218, 0.18); color: #4a9eda; border-color: rgba(74, 158, 218, 0.4); }
  .badge-ro { background: rgba(106, 110, 119, 0.2); color: var(--text-secondary); }
  .badge-warn { background: rgba(217, 153, 42, 0.18); color: #d99c2a; border-color: rgba(217, 153, 42, 0.4); }

  .safety-panel {
    display: flex; flex-direction: column; gap: 0.85rem;
    padding: 0.85rem 1rem; background: var(--bg-surface-raised);
    border: 1px solid var(--border); border-radius: 6px;
  }
  .safety-blurb {
    margin: 0; font-family: "Inter", sans-serif; font-size: 12px;
    line-height: 1.5; color: var(--text-secondary);
    text-transform: none; letter-spacing: normal; font-weight: 400;
  }
  .safety-blurb strong { color: var(--text-primary); }
  .safety-row { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
  .safety-field { display: flex; flex-direction: column; gap: 0.35rem; }
  .safety-field small {
    font-family: "Inter", sans-serif; font-size: 11px; font-weight: 400;
    text-transform: none; letter-spacing: normal; color: var(--text-muted);
  }
  .safety-check {
    display: flex; align-items: flex-start; gap: 0.6rem;
    text-transform: none; letter-spacing: normal; font-weight: 400;
    color: var(--text-primary); font-size: 13px; line-height: 1.5;
    cursor: pointer;
  }
  .safety-check input[type="checkbox"] { margin-top: 3px; flex-shrink: 0; }
  .safety-check span { flex: 1; }
  .safety-check strong { color: var(--text-primary); }
</style>
