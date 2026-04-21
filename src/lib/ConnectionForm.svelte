<script lang="ts">
  import type { ConnectionInput } from "$lib/connections";
  import { testConnection } from "$lib/connection";

  type TestState =
    | { kind: "idle" }
    | { kind: "running" }
    | { kind: "ok"; serverVersion: string; elapsedMs: number }
    | { kind: "err"; message: string };

  type SaveState =
    | { kind: "idle" }
    | { kind: "running" }
    | { kind: "err"; message: string };

  let {
    initial,
    submitLabel = "Save",
    passwordMissing = false,
    onSave,
    onCancel,
  }: {
    initial: ConnectionInput;
    submitLabel?: string;
    passwordMissing?: boolean;
    onSave: (input: ConnectionInput) => Promise<{ ok: true } | { ok: false; message: string }>;
    onCancel: () => void;
  } = $props();

  let values = $state<ConnectionInput>({ ...initial });
  let testState = $state<TestState>({ kind: "idle" });
  let saveState = $state<SaveState>({ kind: "idle" });

  async function onTest() {
    testState = { kind: "running" };
    const res = await testConnection({
      host: values.host,
      port: values.port,
      serviceName: values.serviceName,
      username: values.username,
      password: values.password,
    });
    testState = res.ok
      ? { kind: "ok", serverVersion: res.data.serverVersion, elapsedMs: res.data.elapsedMs }
      : { kind: "err", message: res.error.message };
  }

  async function onSubmit(event: Event) {
    event.preventDefault();
    saveState = { kind: "running" };
    const res = await onSave({ ...values });
    saveState = res.ok ? { kind: "idle" } : { kind: "err", message: res.message };
  }
</script>

<form onsubmit={onSubmit}>
  {#if passwordMissing}
    <div class="banner warn">
      Password not found in keychain — please re-enter to save.
    </div>
  {/if}

  <label>
    Name
    <input type="text" bind:value={values.name} required autocomplete="off" />
  </label>

  <label>
    Host
    <input type="text" bind:value={values.host} required />
  </label>

  <div class="row">
    <label class="port">
      Port
      <input type="number" bind:value={values.port} min="1" max="65535" required />
    </label>
    <label class="service">
      Service name
      <input type="text" bind:value={values.serviceName} required />
    </label>
  </div>

  <label>
    Username
    <input type="text" bind:value={values.username} autocomplete="off" required />
  </label>

  <label>
    Password
    <input type="password" bind:value={values.password} autocomplete="off" required />
  </label>

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
</form>

<style>
  form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    font-family: "Inter", sans-serif;
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgba(26, 22, 18, 0.55);
  }
  input {
    font-family: "Inter", sans-serif;
    font-size: 14px;
    font-weight: 400;
    text-transform: none;
    letter-spacing: normal;
    color: #1a1612;
    background: #fff;
    border: 1px solid rgba(26, 22, 18, 0.15);
    border-radius: 6px;
    padding: 0.6rem 0.75rem;
  }
  input:focus {
    outline: none;
    border-color: #b33e1f;
  }
  .row {
    display: grid;
    grid-template-columns: 1fr 2fr;
    gap: 1rem;
  }
  .actions {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }
  button {
    flex: 1;
    font-family: "Space Grotesk", sans-serif;
    font-size: 14px;
    font-weight: 500;
    letter-spacing: 0.04em;
    color: #f6f1e8;
    background: #1a1612;
    border: none;
    border-radius: 6px;
    padding: 0.85rem 1rem;
    cursor: pointer;
  }
  button.ghost {
    color: #1a1612;
    background: transparent;
    border: 1px solid rgba(26, 22, 18, 0.2);
  }
  button:disabled {
    opacity: 0.5;
    cursor: progress;
  }
  button:hover:not(:disabled) {
    background: #b33e1f;
    color: #f6f1e8;
    border-color: #b33e1f;
  }
  .banner {
    padding: 0.75rem 1rem;
    border-radius: 6px;
    font-family: "Inter", sans-serif;
    font-size: 13px;
  }
  .banner.warn {
    background: rgba(179, 62, 31, 0.08);
    color: #7a2a14;
    border: 1px solid rgba(179, 62, 31, 0.3);
  }
  .status {
    font-family: "Inter", sans-serif;
    font-size: 13px;
    line-height: 1.5;
    padding: 0.85rem 1rem;
    border-radius: 6px;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .status.ok {
    background: rgba(46, 125, 50, 0.08);
    color: #1b5e20;
    border: 1px solid rgba(46, 125, 50, 0.25);
  }
  .status.err {
    background: rgba(179, 62, 31, 0.08);
    color: #7a2a14;
    border: 1px solid rgba(179, 62, 31, 0.3);
  }
  .meta {
    font-size: 11px;
    opacity: 0.6;
  }
</style>
