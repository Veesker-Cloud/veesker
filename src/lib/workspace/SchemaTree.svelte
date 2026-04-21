<script lang="ts">
  import type { ObjectKind, ObjectRef, Loadable } from "$lib/workspace";

  export type SchemaNode = {
    name: string;
    isCurrent: boolean;
    expanded: boolean;
    kinds: {
      TABLE: Loadable<ObjectRef[]>;
      VIEW: Loadable<ObjectRef[]>;
      SEQUENCE: Loadable<ObjectRef[]>;
    };
  };

  type Props = {
    schemas: SchemaNode[];
    selected: { owner: string; name: string; kind: ObjectKind } | null;
    onToggle: (owner: string) => void;
    onSelect: (owner: string, name: string, kind: ObjectKind) => void;
    onRetry: (owner: string, kind: ObjectKind) => void;
  };
  let { schemas, selected, onToggle, onSelect, onRetry }: Props = $props();

  const KIND_LABELS: Record<ObjectKind, string> = {
    TABLE: "Tables",
    VIEW: "Views",
    SEQUENCE: "Sequences",
  };
  const KIND_ORDER: ObjectKind[] = ["TABLE", "VIEW", "SEQUENCE"];

  function isSelected(owner: string, name: string, kind: ObjectKind): boolean {
    return (
      selected?.owner === owner &&
      selected?.name === name &&
      selected?.kind === kind
    );
  }
</script>

<nav class="tree">
  {#each schemas as s (s.name)}
    <div class="schema">
      <button
        class="schema-row"
        class:current={s.isCurrent}
        onclick={() => onToggle(s.name)}
      >
        <span class="chev">{s.expanded ? "▾" : "▸"}</span>
        <span class="name">{s.name}</span>
      </button>

      {#if s.expanded}
        <div class="kinds">
          {#each KIND_ORDER as kind}
            <div class="kind">
              <div class="kind-head">{KIND_LABELS[kind]}</div>
              {#if s.kinds[kind].kind === "loading"}
                <div class="muted">loading…</div>
              {:else if s.kinds[kind].kind === "err"}
                <div class="err">
                  <span>{s.kinds[kind].message}</span>
                  <button class="retry" onclick={() => onRetry(s.name, kind)}>Retry</button>
                </div>
              {:else if s.kinds[kind].kind === "ok"}
                {#each s.kinds[kind].value as o (o.name)}
                  <button
                    class="object"
                    class:selected={isSelected(s.name, o.name, kind)}
                    onclick={() => onSelect(s.name, o.name, kind)}
                  >{o.name}</button>
                {:else}
                  <div class="muted">— none —</div>
                {/each}
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/each}
</nav>

<style>
  .tree {
    width: 280px;
    background: #f0eadd;
    border-right: 1px solid rgba(26, 22, 18, 0.08);
    overflow-y: auto;
    padding: 0.75rem 0.5rem;
    font-size: 12px;
    font-family: "Inter", -apple-system, system-ui, sans-serif;
    box-sizing: border-box;
  }
  .schema {
    margin-bottom: 0.25rem;
  }
  .schema-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    width: 100%;
    background: transparent;
    border: none;
    padding: 0.3rem 0.4rem;
    cursor: pointer;
    text-align: left;
    color: rgba(26, 22, 18, 0.7);
    font-family: inherit;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    border-radius: 3px;
  }
  .schema-row:hover { background: rgba(179, 62, 31, 0.08); }
  .schema-row.current {
    color: #7a2a14;
    font-weight: 600;
  }
  .chev { width: 0.8em; display: inline-block; }
  .kinds { padding-left: 1rem; margin-top: 0.2rem; }
  .kind { margin-bottom: 0.4rem; }
  .kind-head {
    color: rgba(26, 22, 18, 0.55);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 0.1rem 0.4rem;
  }
  .object {
    display: block;
    width: 100%;
    text-align: left;
    background: transparent;
    border: none;
    padding: 0.15rem 0.5rem;
    margin: 0.05rem 0;
    border-radius: 3px;
    font-family: "JetBrains Mono", "SF Mono", monospace;
    font-size: 11px;
    color: rgba(26, 22, 18, 0.78);
    cursor: pointer;
  }
  .object:hover { background: rgba(179, 62, 31, 0.08); }
  .object.selected {
    background: #b33e1f;
    color: #f6f1e8;
  }
  .muted {
    color: rgba(26, 22, 18, 0.4);
    font-size: 10px;
    padding: 0.1rem 0.5rem;
  }
  .err {
    color: #7a2a14;
    font-size: 10px;
    padding: 0.1rem 0.5rem;
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .retry {
    background: transparent;
    border: 1px solid rgba(122, 42, 20, 0.4);
    color: #7a2a14;
    font-size: 10px;
    padding: 0.05rem 0.3rem;
    border-radius: 3px;
    cursor: pointer;
  }
</style>
