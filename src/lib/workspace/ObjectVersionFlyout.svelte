<script lang="ts">
  import { onMount } from "svelte";
  import {
    objectVersionList,
    objectVersionDiff,
    objectVersionLoad,
    objectVersionLabel,
    objectVersionGetRemote,
    objectVersionSetRemote,
    objectVersionPush,
    objectFilePath,
    type ObjectVersionEntry,
  } from "$lib/object-versions";

  type Props = {
    connectionId: string;
    owner: string;
    objectType: string;
    objectName: string;
    onLoadInEditor: (ddl: string) => void;
    onClose: () => void;
  };

  let { connectionId, owner, objectType, objectName, onLoadInEditor, onClose }: Props = $props();

  const filePath = $derived(objectFilePath(owner, objectType, objectName));

  let versions = $state<ObjectVersionEntry[]>([]);
  let selectedId = $state<number | null>(null);
  let diff = $state<string | null>(null);
  let diffError = $state(false);
  let loadingDiff = $state(false);
  let editingLabelId = $state<number | null>(null);
  let labelInput = $state("");

  let showRemote = $state(false);
  let remoteUrl = $state("");
  let remotePat = $state("");
  let currentRemote = $state<string | null>(null);
  let pushStatus = $state<string | null>(null);
  let pushLoading = $state(false);

  async function loadVersions() {
    const res = await objectVersionList(connectionId, owner, objectType, objectName);
    if (res.ok) {
      versions = res.data;
      if (versions.length > 0 && selectedId === null) {
        selectedId = versions[0].id;
        void loadDiff(versions[0]);
      }
    }
  }

  async function loadDiff(entry: ObjectVersionEntry) {
    if (versions.length < 2) { diff = null; return; }
    const head = versions[0];
    if (entry.id === head.id) {
      diff = null;
      return;
    }
    loadingDiff = true;
    diffError = false;
    const res = await objectVersionDiff(connectionId, entry.commitSha, head.commitSha, filePath);
    loadingDiff = false;
    if (res.ok) {
      diff = res.data;
      diffError = false;
    } else {
      diff = null;
      diffError = true;
    }
  }

  function selectVersion(entry: ObjectVersionEntry) {
    selectedId = entry.id;
    void loadDiff(entry);
  }

  async function loadInEditor() {
    const entry = versions.find((v) => v.id === selectedId);
    if (!entry) return;
    const res = await objectVersionLoad(connectionId, entry.commitSha, filePath);
    if (res.ok) {
      onLoadInEditor(res.data);
      onClose();
    }
  }

  function startEditLabel(entry: ObjectVersionEntry) {
    editingLabelId = entry.id;
    labelInput = entry.label ?? "";
  }

  async function saveLabel(entry: ObjectVersionEntry) {
    const newLabel = labelInput.trim() || null;
    await objectVersionLabel(connectionId, entry.id, owner, objectType, objectName, newLabel);
    editingLabelId = null;
    await loadVersions();
  }

  function parseDiffLines(raw: string): { type: "add" | "rem" | "ctx" | "hunk"; text: string }[] {
    return raw.split("\n").map((line) => {
      if (line.startsWith("+") && !line.startsWith("+++")) return { type: "add", text: line };
      if (line.startsWith("-") && !line.startsWith("---")) return { type: "rem", text: line };
      if (line.startsWith("@")) return { type: "hunk", text: line };
      return { type: "ctx", text: line };
    });
  }

  async function loadRemote() {
    const res = await objectVersionGetRemote(connectionId);
    if (res.ok) currentRemote = res.data;
  }

  async function saveRemote() {
    if (!remoteUrl.trim() || !remotePat.trim()) return;
    const res = await objectVersionSetRemote(connectionId, remoteUrl.trim(), remotePat.trim());
    if (res.ok) {
      currentRemote = remoteUrl.trim();
      remotePat = "";
      remoteUrl = "";
    }
  }

  async function doPush() {
    pushLoading = true;
    pushStatus = null;
    const res = await objectVersionPush(connectionId);
    pushLoading = false;
    if (res.ok) {
      pushStatus = res.data === 0 ? "Already up to date" : `Pushed ${res.data} commit${res.data !== 1 ? "s" : ""}`;
    } else {
      pushStatus = `Error: ${res.error.message}`;
    }
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") onClose();
  }

  onMount(() => {
    void loadVersions();
    void loadRemote();
    document.addEventListener("keydown", onKeydown);
    return () => document.removeEventListener("keydown", onKeydown);
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="flyout-backdrop" onclick={onClose} onkeydown={() => {}}></div>

<div class="flyout" role="dialog" aria-modal="true">
  <div class="fly-list">
    <div class="fly-header">{owner} · {objectType} · {objectName}</div>
    <div class="fly-body">
      {#if versions.length === 0}
        <div class="empty-state">No versions captured yet</div>
      {:else}
        {#each versions as entry (entry.id)}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="ver-row"
            class:selected={selectedId === entry.id}
            onclick={() => selectVersion(entry)}
            onkeydown={(e) => e.key === "Enter" && selectVersion(entry)}
            role="button"
            tabindex="0"
            ondblclick={() => startEditLabel(entry)}
          >
            <div class="ver-meta">
              {#if editingLabelId === entry.id}
                <!-- svelte-ignore a11y_autofocus -->
                <input
                  class="label-input"
                  bind:value={labelInput}
                  autofocus
                  onkeydown={(e) => {
                    if (e.key === "Enter") { e.stopPropagation(); void saveLabel(entry); }
                    if (e.key === "Escape") { e.stopPropagation(); editingLabelId = null; }
                  }}
                  onclick={(e) => e.stopPropagation()}
                />
              {:else}
                <div class="ver-time">{new Date(entry.capturedAt).toLocaleString()}</div>
                <div class="ver-sha">{entry.commitSha.slice(0, 7)}{entry.label ? ` · ${entry.label}` : ""}</div>
              {/if}
            </div>
            <span class="rbadge" class:rb-compile={entry.captureReason === "compile"} class:rb-baseline={entry.captureReason === "baseline"}>
              {entry.captureReason}
            </span>
          </div>
        {/each}
      {/if}
    </div>
    <div class="fly-footer">
      <button class="restore-btn" disabled={selectedId === null} onclick={loadInEditor}>
        ↩ Open in editor
      </button>
    </div>
  </div>

  <div class="fly-diff">
    <div class="diff-header">
      {#if selectedId !== null && versions.length > 0}
        {@const sel = versions.find((v) => v.id === selectedId)}
        {@const head = versions[0]}
        {#if sel && sel.id !== head.id}
          <span class="diff-from">{sel.commitSha.slice(0, 7)}</span>
          <span class="diff-sep">→</span>
          <span class="diff-to">{head.commitSha.slice(0, 7)} (current)</span>
        {:else}
          <span class="diff-note">Select an older version to see diff</span>
        {/if}
      {/if}
    </div>
    <div class="diff-body">
      {#if loadingDiff}
        <div class="diff-loading">Loading diff…</div>
      {:else if diffError}
        <div class="diff-unavail">[unavailable]</div>
      {:else if diff}
        {#each parseDiffLines(diff) as line}
          <div class="dl {line.type}">{line.text}</div>
        {/each}
      {:else}
        <div class="diff-empty">No diff to show</div>
      {/if}
    </div>
    <div class="diff-footer">
      <button class="remote-toggle" onclick={() => { showRemote = !showRemote; }}>⚙</button>
      {#if selectedId !== null}
        {@const sel = versions.find((v) => v.id === selectedId)}
        {#if sel && sel.id !== versions[0]?.id}
          <button class="load-btn" onclick={loadInEditor}>↩ Load {sel.commitSha.slice(0, 7)} in editor</button>
        {/if}
      {/if}
    </div>
    {#if showRemote}
      <div class="remote-strip">
        {#if currentRemote}
          <span class="remote-url">{currentRemote}</span>
        {:else}
          <input class="remote-input" placeholder="https://github.com/…" bind:value={remoteUrl} />
          <input class="remote-input pat" placeholder="Personal Access Token" type="password" bind:value={remotePat} />
          <button class="save-remote-btn" onclick={saveRemote}>Save</button>
        {/if}
        <button class="push-btn" disabled={!currentRemote || pushLoading} onclick={doPush}>
          {pushLoading ? "Pushing…" : "↑ Push"}
        </button>
        {#if pushStatus}
          <span class="push-status">{pushStatus}</span>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .flyout-backdrop {
    position: fixed;
    inset: 0;
    z-index: 99;
  }
  .flyout {
    position: absolute;
    top: 32px;
    right: 0;
    z-index: 100;
    display: grid;
    grid-template-columns: 220px 1fr;
    width: 680px;
    max-height: 480px;
    background: var(--bg-surface-alt);
    border: 1px solid var(--border-strong);
    border-radius: 6px;
    overflow: hidden;
    font-family: "JetBrains Mono", monospace;
    font-size: 11px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.45);
  }
  .fly-list {
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .fly-header {
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
    font-size: 10px;
    font-weight: 600;
    color: var(--text-muted);
    letter-spacing: 0.5px;
    text-transform: uppercase;
    font-family: "Space Grotesk", sans-serif;
  }
  .fly-body {
    flex: 1;
    overflow-y: auto;
  }
  .ver-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 12px;
    border-bottom: 1px solid rgba(255,255,255,0.03);
    cursor: pointer;
  }
  .ver-row:hover { background: rgba(255,255,255,0.04); }
  .ver-row.selected {
    background: rgba(179,62,31,0.08);
    border-left: 2px solid #b33e1f;
    padding-left: 10px;
  }
  .ver-meta { flex: 1; min-width: 0; }
  .ver-time { font-size: 10.5px; color: var(--text-secondary); }
  .ver-sha { font-size: 9.5px; color: var(--text-muted); margin-top: 1px; }
  .rbadge {
    font-size: 9px;
    font-weight: 600;
    padding: 1px 5px;
    border-radius: 3px;
    flex-shrink: 0;
    font-family: "Space Grotesk", sans-serif;
  }
  .rb-compile { background: rgba(126,201,106,0.12); color: #7ec96a; }
  .rb-baseline { background: rgba(255,255,255,0.06); color: var(--text-muted); }
  .label-input {
    width: 100%;
    background: rgba(255,255,255,0.06);
    border: 1px solid var(--border-strong);
    border-radius: 3px;
    color: var(--text-primary);
    font-size: 10.5px;
    font-family: "JetBrains Mono", monospace;
    padding: 2px 6px;
  }
  .fly-footer {
    padding: 8px 12px;
    border-top: 1px solid var(--border);
    display: flex;
    justify-content: flex-end;
  }
  .restore-btn {
    font-size: 11px;
    font-weight: 600;
    padding: 4px 12px;
    border-radius: 4px;
    background: rgba(126,201,106,0.10);
    color: #7ec96a;
    border: 1px solid rgba(126,201,106,0.2);
    cursor: pointer;
    font-family: "Space Grotesk", sans-serif;
  }
  .restore-btn:hover { background: rgba(126,201,106,0.16); }
  .restore-btn:disabled { opacity: 0.4; cursor: default; }
  .fly-diff { display: flex; flex-direction: column; overflow: hidden; }
  .diff-header {
    padding: 8px 14px;
    border-bottom: 1px solid var(--border);
    display: flex;
    gap: 8px;
    align-items: center;
    font-size: 10px;
    font-family: "Space Grotesk", sans-serif;
    flex-shrink: 0;
  }
  .diff-from { color: var(--text-muted); }
  .diff-sep { color: rgba(255,255,255,0.15); }
  .diff-to { color: var(--text-secondary); }
  .diff-note { color: var(--text-muted); }
  .diff-body { flex: 1; overflow-y: auto; padding: 6px 0; }
  .dl {
    padding: 0 14px;
    line-height: 1.7;
    font-size: 10.5px;
    white-space: pre;
    font-family: "JetBrains Mono", monospace;
  }
  .dl.add { background: rgba(126,201,106,0.07); color: #7ec96a; }
  .dl.rem { background: rgba(179,62,31,0.08); color: #f5a08a; }
  .dl.ctx { color: var(--text-muted); }
  .dl.hunk { color: rgba(100,160,255,0.5); font-style: italic; padding-top: 6px; }
  .diff-loading, .diff-empty, .diff-unavail {
    padding: 16px 14px;
    color: var(--text-muted);
    font-size: 10.5px;
    font-family: "Space Grotesk", sans-serif;
  }
  .diff-footer {
    padding: 8px 14px;
    border-top: 1px solid var(--border);
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }
  .remote-toggle {
    margin-right: auto;
    background: transparent;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 12px;
    padding: 2px 6px;
    border-radius: 3px;
  }
  .remote-toggle:hover { background: rgba(255,255,255,0.06); color: var(--text-secondary); }
  .load-btn {
    font-size: 11px;
    padding: 4px 12px;
    border-radius: 4px;
    background: var(--bg-surface);
    color: var(--text-secondary);
    border: 1px solid var(--border-strong);
    cursor: pointer;
    font-family: "Space Grotesk", sans-serif;
  }
  .load-btn:hover { background: rgba(255,255,255,0.04); color: var(--text-primary); }
  .remote-strip {
    padding: 8px 14px;
    border-top: 1px solid var(--border);
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
    background: rgba(0,0,0,0.1);
    flex-shrink: 0;
  }
  .remote-url { font-size: 10px; color: var(--text-muted); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .remote-input {
    flex: 1;
    background: rgba(255,255,255,0.06);
    border: 1px solid var(--border-strong);
    border-radius: 3px;
    color: var(--text-primary);
    font-size: 10px;
    font-family: "JetBrains Mono", monospace;
    padding: 3px 8px;
  }
  .remote-input.pat { flex: 0 0 140px; }
  .save-remote-btn, .push-btn {
    font-size: 10px;
    padding: 3px 10px;
    border-radius: 3px;
    cursor: pointer;
    font-family: "Space Grotesk", sans-serif;
  }
  .save-remote-btn {
    background: rgba(255,255,255,0.06);
    border: 1px solid var(--border-strong);
    color: var(--text-secondary);
  }
  .push-btn {
    background: rgba(126,201,106,0.12);
    border: 1px solid rgba(126,201,106,0.25);
    color: #7ec96a;
    font-weight: 600;
  }
  .push-btn:disabled { opacity: 0.4; cursor: default; }
  .push-status { font-size: 10px; color: var(--text-muted); }
  .empty-state {
    padding: 20px 14px;
    color: var(--text-muted);
    font-size: 10.5px;
    font-family: "Space Grotesk", sans-serif;
  }
</style>
