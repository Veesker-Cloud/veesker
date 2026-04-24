<script lang="ts">
  import type { BindVar } from "$lib/stores/debug.svelte";
  import type { VarValue } from "$lib/workspace";

  let {
    vars = $bindable(),
    readonly = false,
    liveVars = [],
  }: {
    vars: BindVar[];
    readonly?: boolean;
    liveVars?: VarValue[];
  } = $props();

  function addRow() {
    vars = [
      ...vars,
      { name: "", oracleType: "VARCHAR2", value: "", enabled: true },
    ];
  }

  function removeRow(i: number) {
    vars = vars.filter((_, idx) => idx !== i);
  }

  function liveValue(name: string): string | null {
    return liveVars.find((v) => v.name.toUpperCase() === name.toUpperCase())?.value ?? null;
  }

  function inputType(oracleType: string): "text" | "number" | "datetime-local" {
    const t = oracleType.toUpperCase();
    if (
      [
        "NUMBER", "INTEGER", "INT", "SMALLINT", "DECIMAL", "NUMERIC",
        "FLOAT", "REAL", "DOUBLE", "BINARY_INTEGER", "PLS_INTEGER",
        "BINARY_FLOAT", "BINARY_DOUBLE",
      ].includes(t)
    )
      return "number";
    if (t === "DATE") return "datetime-local";
    return "text";
  }
</script>

<div class="vg">
  <table class="vg-table">
    <thead>
      <tr>
        <th class="vg-th-check"></th>
        <th class="vg-th">Variable</th>
        <th class="vg-th">Type</th>
        <th class="vg-th vg-th-value">Value</th>
        {#if !readonly}<th class="vg-th-del"></th>{/if}
      </tr>
    </thead>
    <tbody>
      {#each vars as v, i}
        <tr class="vg-row">
          <td class="vg-td-check">
            <input
              type="checkbox"
              checked={v.enabled}
              onchange={(e) => {
                vars[i].enabled = (e.target as HTMLInputElement).checked;
              }}
              disabled={readonly}
            />
          </td>
          <td class="vg-td">
            {#if readonly}
              <span class="vg-name">{v.name}</span>
            {:else}
              <input
                class="vg-input vg-name-input"
                type="text"
                value={v.name}
                oninput={(e) => {
                  vars[i].name = (e.target as HTMLInputElement).value;
                }}
                placeholder="name"
              />
            {/if}
          </td>
          <td class="vg-td">
            {#if readonly}
              <span class="vg-type">{v.oracleType}</span>
            {:else}
              <input
                class="vg-input vg-type-input"
                type="text"
                value={v.oracleType}
                oninput={(e) => {
                  vars[i].oracleType = (e.target as HTMLInputElement).value;
                }}
                placeholder="VARCHAR2"
              />
            {/if}
          </td>
          <td class="vg-td vg-td-value">
            {#if readonly && liveValue(v.name) !== null}
              <span class="tw-live-val">{liveValue(v.name)}</span>
            {:else if readonly}
              <span class="vg-value">{v.value ?? ''}</span>
            {:else if v.oracleType.toUpperCase() === 'BOOLEAN'}
              <select
                class="vg-input vg-select"
                value={v.value}
                onchange={(e) => {
                  vars[i].value = (e.target as HTMLSelectElement).value;
                }}
              >
                <option value="">NULL</option>
                <option value="TRUE">TRUE</option>
                <option value="FALSE">FALSE</option>
              </select>
            {:else}
              <input
                class="vg-input"
                type={inputType(v.oracleType)}
                value={v.value}
                oninput={(e) => {
                  vars[i].value = (e.target as HTMLInputElement).value;
                }}
                placeholder="value"
              />
            {/if}
          </td>
          {#if !readonly}
            <td class="vg-td-del">
              <button class="vg-del" onclick={() => removeRow(i)} title="Remove">×</button>
            </td>
          {/if}
        </tr>
      {/each}
      {#if !readonly}
        <tr class="vg-add-row">
          <td colspan="5">
            <button class="vg-add-btn" onclick={addRow}>+ Add variable</button>
          </td>
        </tr>
      {/if}
    </tbody>
  </table>
</div>

<style>
  .vg { overflow: auto; height: 100%; background: var(--bg-surface-alt); }
  .vg-table { width: 100%; border-collapse: collapse; font-size: 12px; font-family: monospace; }
  .vg-th, .vg-th-check, .vg-th-del, .vg-th-value {
    background: var(--bg-surface);
    border-bottom: 1px solid var(--border);
    padding: 4px 8px;
    text-align: left;
    font-weight: 600;
    color: var(--text-muted);
    font-size: 11px;
    position: sticky; top: 0;
  }
  .vg-th-check { width: 28px; }
  .vg-th-del { width: 24px; }
  .vg-th-value { width: 40%; }
  .vg-td, .vg-td-check, .vg-td-del, .vg-td-value {
    border-bottom: 1px solid var(--border);
    padding: 2px 8px;
    vertical-align: middle;
  }
  .vg-td-check { width: 28px; text-align: center; }
  .vg-td-del { width: 24px; text-align: center; }
  .vg-td-value { width: 40%; }
  .vg-row:hover { background: rgba(255,255,255,0.03); }
  .vg-input {
    background: transparent;
    border: none;
    outline: none;
    color: var(--text-primary);
    font-family: monospace;
    font-size: 12px;
    width: 100%;
    padding: 1px 0;
  }
  .vg-input:focus { border-bottom: 1px solid var(--border); }
  .vg-name-input { min-width: 120px; }
  .vg-type-input { min-width: 80px; }
  .vg-select { background: var(--bg-surface); color: var(--text-primary); border: 1px solid var(--border); border-radius: 2px; font-size: 12px; }
  .vg-name, .vg-type, .vg-value { color: var(--text-primary); }
  .tw-live-val { color: #27ae60; font-family: monospace; }
  .vg-del { background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 14px; padding: 0 2px; }
  .vg-del:hover { color: #e74c3c; }
  .vg-add-row td { padding: 4px 8px; }
  .vg-add-btn { background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 11px; padding: 0; }
  .vg-add-btn:hover { color: var(--text-primary); }
</style>
