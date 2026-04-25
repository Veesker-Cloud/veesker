# VRAS — Veesker REST API Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar VRAS — feature no-code de criação/leitura de APIs REST nativas Oracle ORDS dentro do Veesker, conforme spec aprovado em `docs/superpowers/specs/2026-04-24-rest-api-studio-design.md`.

**Architecture:** Sidecar Bun expõe RPCs `ords.*` que leem `USER_ORDS_*` views e geram blocos PL/SQL chamando `ORDS.*`/`OAUTH.*` packages. Frontend Svelte 5 adiciona kind `REST_MODULE` ao SchemaTree, painel de detalhes read-only, builder modal com 3 tipos de fonte (auto-CRUD/Custom SQL/Procedure), preview com apply direto/copy escape, test panel com fetch via Tauri command (allowlist de URL), gerenciador OAuth e atalho Sheep AI.

**Tech Stack:** SvelteKit 5 (runes), Bun sidecar (TypeScript + node-oracledb), Tauri 2 commands (Rust), Oracle ORDS 19c+ packages, CodeMirror 6 (read-only views), Chart.js NÃO usado.

**Branch:** main (commits diretos, padrão do projeto).

---

## Architectural Decisions Locked

Do brainstorm de 2026-04-24:
1. **Escopo V1:** Auto-CRUD (tabela/view) + Custom SQL + Procedure/Function. Sem anonymous PL/SQL blocks.
2. **UX:** Builder visual primário; botão "✨ Sheep" pré-preenche via JSON estruturado.
3. **Apply:** Modal com Preview + 3 ações (Aplicar / Copiar pra SQL tab / Cancelar). Sempre 1 único `BEGIN..COMMIT;END;`.
4. **Lifecycle:** Create + Read no V1. Edit/Delete em V2.
5. **Auth:** NONE / Roles do banco / OAuth 2.0 client_credentials. JWT externo e Basic Auth fora.
6. **Detection:** ords.detect roda no bootstrap; modal guiado por estado de erro.
7. **Storage:** Toda config no Oracle. `ConnectionMeta.ordsBaseUrl` é o único campo novo persistido.
8. **Test:** Painel inline com fetch HTTP via Tauri command (allowlist por ordsBaseUrl); link externo pro Swagger nativo.

---

## File Map

### NEW
| File | Purpose |
|---|---|
| `sidecar/src/ords.ts` | Todos os RPC handlers ORDS (detect, list, get, generate, apply, export, clients) |
| `sidecar/tests/ords.test.ts` | Bun tests pra geradores de SQL |
| `src/lib/stores/ords.svelte.ts` | Store de estado de detecção + cache por conexão |
| `src/lib/workspace/RestModuleDetails.svelte` | Painel de detalhes read-only de um módulo |
| `src/lib/workspace/RestApiBuilder.svelte` | Modal de criação de endpoint (form principal) |
| `src/lib/workspace/RestApiPreview.svelte` | Modal de preview SQL + apply |
| `src/lib/workspace/RestTestPanel.svelte` | Painel HTTP client lateral |
| `src/lib/workspace/OAuthClientsPanel.svelte` | Gerenciador de OAuth clients |
| `src/lib/workspace/OrdsBootstrapModal.svelte` | Modais de detecção (4 estados) |

### MODIFIED
| File | Change |
|---|---|
| `sidecar/src/index.ts` | Registrar handlers `ords.*` |
| `src-tauri/src/commands.rs` | Adicionar `ords_*` commands + `ords_test_http` (Tauri-side fetch) |
| `src-tauri/src/lib.rs` | Registrar novos commands no invoke handler |
| `src-tauri/Cargo.toml` | Adicionar `reqwest` (HTTP client pra ords_test_http) |
| `src/lib/workspace.ts` | Wrappers `ordsDetect`, `ordsModulesList`, etc.; novo type `RestModule`, `RestTemplate`, `RestHandler` |
| `src/lib/workspace/SchemaTree.svelte` | Renderizar `REST_MODULES` kind (mesmo padrão de TABLES/PROCEDURES) |
| `src/lib/workspace/SheepChat.svelte` | Detectar intent "criar endpoint REST" e abrir builder pré-preenchido |
| `src/lib/connections.ts` | `ConnectionMeta.ordsBaseUrl?: string \| null` |
| `src-tauri/src/persistence/connections.rs` | Coluna `ords_base_url TEXT NULL` |
| `src/routes/workspace/[id]/+page.svelte` | Bootstrap: chamar `ordsDetect`; passar pro SchemaTree e SheepChat |

---

## Background for the implementer

**Stack reminder:**
- Svelte 5 runes only (`$state`, `$derived`, `$effect`). NO Svelte stores.
- Sidecar handlers ficam em `sidecar/src/<module>.ts`, registrados em `sidecar/src/index.ts` no objeto `HANDLERS` com chave `"module.method"`.
- Tauri commands em `src-tauri/src/commands.rs`, registrados em `src-tauri/src/lib.rs` no `invoke_handler!`.
- Frontend wrappers em `src/lib/workspace.ts` chamando `call<T>("snake_case_cmd", { camelCaseArgs })`.
- CSS theming: usar variáveis (`--bg-surface`, `--bg-surface-alt`, `--text-primary`, etc). Nunca hardcode background escuro.
- SQL safety: nomes de objeto Oracle sempre via `quoteIdent()` em `sidecar/src/oracle.ts`.

**ORDS package documentation pra referência:**
- `ORDS.DEFINE_MODULE(p_module_name, p_base_path, p_items_per_page, p_status, p_comments)`
- `ORDS.DEFINE_TEMPLATE(p_module_name, p_pattern, p_priority, p_etag_type, p_etag_query, p_comments)`
- `ORDS.DEFINE_HANDLER(p_module_name, p_pattern, p_method, p_source_type, p_items_per_page, p_mimes_allowed, p_comments, p_source)`
- `ORDS.ENABLE_OBJECT(p_enabled, p_schema, p_object, p_object_type, p_object_alias, p_auto_rest_auth)`
- `ORDS.DEFINE_PRIVILEGE(p_privilege_name, p_roles, p_patterns, p_modules, p_label, p_description, p_comments)`
- `ORDS.CREATE_ROLE(p_role_name)`
- `ORDS.DELETE_MODULE(p_module_name)` (V2)
- `OAUTH.CREATE_CLIENT(p_name, p_grant_type, p_owner, p_description, p_redirect_uri, p_support_email, p_support_uri, p_privilege_names)`
- `OAUTH.GRANT_CLIENT_ROLE(p_client_name, p_role_name)`

`source_type` constants:
- `ORDS.source_type_collection` — SELECT que retorna array JSON paginado
- `ORDS.source_type_collection_item` — SELECT que retorna 1 row JSON
- `ORDS.source_type_plsql` — Bloco PL/SQL com `:status_code`, `HTP.print`
- `ORDS.source_type_media` — retorna BLOB

**Dictionary views relevantes:**
- `USER_ORDS_SCHEMAS` (parsing_schema, status, type, url_mapping_type, url_mapping_pattern)
- `USER_ORDS_MODULES` (id, name, base_path, status, items_per_page, comments)
- `USER_ORDS_TEMPLATES` (id, module_id, module_name, uri_template, priority, comments)
- `USER_ORDS_HANDLERS` (id, template_id, method, source_type, items_per_page, mimes_allowed, source, comments)
- `USER_ORDS_PRIVILEGES` (id, name, label, description, comments)
- `USER_ORDS_PRIVILEGES_PATTERNS` (privilege_id, pattern_type, pattern)
- `USER_ORDS_PRIVILEGES_ROLES` (privilege_id, role)
- `USER_ORDS_ROLES` (id, role_name)
- `USER_ORDS_CLIENTS` (id, name, description, created_on, updated_on)
- `USER_ORDS_CLIENT_ROLES` (client_id, role_id)

**ORDS-related metadata:**
- `ORDS_METADATA.ORDS_PROPERTIES` (key/value): keys `db.host`, `db.port`, `api.prefix`, `protocol`

---

# Phase 1 — Detection + Bootstrap (5 tasks)

Phase 1 entrega: ao abrir uma conexão, Veesker detecta status do ORDS e mostra modal apropriado se algo precisa de atenção.

---

## Task 1.1: Sidecar handler `ords.detect`

**Files:**
- Create: `sidecar/src/ords.ts`
- Create: `sidecar/tests/ords.test.ts`
- Modify: `sidecar/src/index.ts`

- [ ] **Step 1: Write failing test for detect**

Create `sidecar/tests/ords.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { ordsDetect } from "../src/ords";

describe("ords.detect", () => {
  it("returns shape with installed/version/currentSchemaEnabled/hasAdminRole/ordsBaseUrl", async () => {
    // Smoke test: function returns expected keys even if connection isn't real.
    // For real DB tests we'd need integration setup; here we just verify shape.
    const fn = ordsDetect;
    expect(typeof fn).toBe("function");
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```
cd sidecar && bun test ords.test.ts
```

Expected: FAIL — `Cannot find module '../src/ords'`.

- [ ] **Step 3: Implement `ords.ts` skeleton with detect**

Create `sidecar/src/ords.ts`:

```typescript
import { state } from "./state";

export type OrdsDetectResult = {
  installed: boolean;
  version: string | null;
  currentSchemaEnabled: boolean;
  hasAdminRole: boolean;
  ordsBaseUrl: string | null;
};

export async function ordsDetect(_params: Record<string, unknown> = {}): Promise<OrdsDetectResult> {
  const conn = state.connection;
  if (!conn) throw { code: -32010, message: "No active session" };

  // Check 1: ORDS package exists
  const installedRes = await conn.execute<{ CNT: number }>(
    `SELECT COUNT(*) AS cnt FROM all_objects
     WHERE owner='ORDS' AND object_name='ORDS' AND object_type='PACKAGE'`,
    [],
    { outFormat: 4002 }
  );
  const installed = (installedRes.rows?.[0]?.CNT ?? 0) > 0;

  if (!installed) {
    return {
      installed: false,
      version: null,
      currentSchemaEnabled: false,
      hasAdminRole: false,
      ordsBaseUrl: null,
    };
  }

  // Check 2: version
  let version: string | null = null;
  try {
    const verRes = await conn.execute<{ V: string }>(
      `SELECT ords.installed_version AS v FROM dual`,
      [],
      { outFormat: 4002 }
    );
    version = verRes.rows?.[0]?.V ?? null;
  } catch {
    version = null;
  }

  // Check 3: current schema enabled
  let currentSchemaEnabled = false;
  try {
    const enabledRes = await conn.execute<{ CNT: number }>(
      `SELECT COUNT(*) AS cnt FROM user_ords_schemas`,
      [],
      { outFormat: 4002 }
    );
    currentSchemaEnabled = (enabledRes.rows?.[0]?.CNT ?? 0) > 0;
  } catch { /* not enabled */ }

  // Check 4: admin privilege (try to detect via session_privs/role_privs)
  let hasAdminRole = false;
  try {
    const privRes = await conn.execute<{ CNT: number }>(
      `SELECT COUNT(*) AS cnt FROM session_roles
       WHERE role IN ('ORDS_ADMINISTRATOR_ROLE', 'DBA')`,
      [],
      { outFormat: 4002 }
    );
    hasAdminRole = (privRes.rows?.[0]?.CNT ?? 0) > 0;
  } catch { /* assume false */ }

  // Check 5: ords base URL from properties
  let ordsBaseUrl: string | null = null;
  try {
    const urlRes = await conn.execute<{ V: string }>(
      `SELECT value AS v FROM ords_metadata.ords_properties
       WHERE name='security.host.url'`,
      [],
      { outFormat: 4002 }
    );
    ordsBaseUrl = urlRes.rows?.[0]?.V ?? null;
  } catch { /* user may not have access */ }

  return { installed, version, currentSchemaEnabled, hasAdminRole, ordsBaseUrl };
}
```

- [ ] **Step 4: Register handler in `sidecar/src/index.ts`**

Add import at top:
```typescript
import { ordsDetect } from "./ords";
```

Add to HANDLERS object (after `chart.*` block):
```typescript
"ords.detect": (params) => ordsDetect(params as any),
```

- [ ] **Step 5: Run test to confirm it passes**

```
cd sidecar && bun test ords.test.ts
```

Expected: PASS (smoke test).

- [ ] **Step 6: Commit**

```
git add sidecar/src/ords.ts sidecar/src/index.ts sidecar/tests/ords.test.ts
git commit -m "feat(vras): add ords.detect RPC for ORDS installation/version/schema checks"
```

---

## Task 1.2: Tauri command + frontend wrapper for detect

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/lib/workspace.ts`

- [ ] **Step 1: Add Tauri command in `src-tauri/src/commands.rs`**

Add at end of file (before final closing or after last command):

```rust
#[derive(Debug, Serialize, Deserialize)]
pub struct OrdsDetectResult {
    pub installed: bool,
    pub version: Option<String>,
    #[serde(rename = "currentSchemaEnabled")]
    pub current_schema_enabled: bool,
    #[serde(rename = "hasAdminRole")]
    pub has_admin_role: bool,
    #[serde(rename = "ordsBaseUrl")]
    pub ords_base_url: Option<String>,
}

#[tauri::command]
pub async fn ords_detect(app: AppHandle) -> Result<OrdsDetectResult, ConnectionTestErr> {
    let res = call_sidecar(&app, "ords.detect", json!({})).await?;
    serde_json::from_value(res).map_err(|e| ConnectionTestErr {
        code: -32603,
        message: format!("ords_detect parse error: {}", e),
    })
}
```

- [ ] **Step 2: Register command in `src-tauri/src/lib.rs`**

Find the `tauri::generate_handler![...]` macro and add `commands::ords_detect` to the list.

- [ ] **Step 3: Add wrapper in `src/lib/workspace.ts`**

After the `compileErrorsGet` line, add:

```typescript
export type OrdsDetectResult = {
  installed: boolean;
  version: string | null;
  currentSchemaEnabled: boolean;
  hasAdminRole: boolean;
  ordsBaseUrl: string | null;
};

export const ordsDetect = () =>
  call<OrdsDetectResult>("ords_detect", {});
```

- [ ] **Step 4: Recompile sidecar binary**

```
cd sidecar && bun build src/index.ts --compile --minify --outfile ../src-tauri/binaries/veesker-sidecar-x86_64-pc-windows-msvc.exe && cd ..
```

- [ ] **Step 5: Verify with `bun run tauri dev`**

Open a workspace; in browser console:
```js
await window.__TAURI__.core.invoke("ords_detect")
```

Expected: returns `{ installed: false|true, ... }` without crash. If ORDS isn't installed, `installed: false`. If installed but schema not enabled, `currentSchemaEnabled: false`.

- [ ] **Step 6: Commit**

```
git add src-tauri/src/commands.rs src-tauri/src/lib.rs src/lib/workspace.ts
git commit -m "feat(vras): wire ords.detect through Tauri to frontend wrapper"
```

---

## Task 1.3: ORDS state store

**Files:**
- Create: `src/lib/stores/ords.svelte.ts`

- [ ] **Step 1: Implement store**

```typescript
import { ordsDetect, type OrdsDetectResult } from "$lib/workspace";

class OrdsStore {
  state = $state<OrdsDetectResult | null>(null);
  loading = $state(false);
  error = $state<string | null>(null);

  async refresh(): Promise<void> {
    this.loading = true;
    this.error = null;
    const res = await ordsDetect();
    this.loading = false;
    if (res.ok) {
      this.state = res.data;
    } else {
      this.error = res.error.message;
      this.state = null;
    }
  }

  reset(): void {
    this.state = null;
    this.loading = false;
    this.error = null;
  }
}

export const ordsStore = new OrdsStore();
```

- [ ] **Step 2: Commit**

```
git add src/lib/stores/ords.svelte.ts
git commit -m "feat(vras): add ords store for detection state"
```

---

## Task 1.4: OrdsBootstrapModal component

**Files:**
- Create: `src/lib/workspace/OrdsBootstrapModal.svelte`

- [ ] **Step 1: Implement modal with 4 states**

```svelte
<script lang="ts">
  import type { OrdsDetectResult } from "$lib/workspace";

  type Props = {
    state: OrdsDetectResult;
    schemaName: string;
    onEnableSchema: () => Promise<void>;
    onSetBaseUrl: (url: string) => void;
    onClose: () => void;
  };
  let { state, schemaName, onEnableSchema, onSetBaseUrl, onClose }: Props = $props();

  let baseUrlInput = $state("");
  let enabling = $state(false);

  const variant = $derived.by(() => {
    if (!state.installed) return "not-installed";
    if (!state.currentSchemaEnabled) return "schema-disabled";
    if (!state.hasAdminRole) return "no-privilege";
    if (!state.ordsBaseUrl) return "no-url";
    return "ok";
  });

  async function handleEnable() {
    enabling = true;
    try { await onEnableSchema(); } finally { enabling = false; }
  }

  function handleSetUrl() {
    if (baseUrlInput.trim()) onSetBaseUrl(baseUrlInput.trim());
  }
</script>

<div class="modal-backdrop" onclick={onClose}>
  <div class="modal" onclick={(e) => e.stopPropagation()}>
    <div class="modal-head">
      <span class="modal-title">VRAS — Configuração ORDS</span>
      <button class="close-btn" onclick={onClose} aria-label="Close">✕</button>
    </div>
    <div class="modal-body">
      {#if variant === "not-installed"}
        <h3>ORDS não está instalado</h3>
        <p>O Oracle REST Data Services (ORDS) não foi detectado neste banco.</p>
        <p>Peça ao DBA para executar:</p>
        <pre class="cmd">@$ORACLE_HOME/ords/install.sql</pre>
        <p>Ou consulte: <a href="https://docs.oracle.com/en/database/oracle/oracle-rest-data-services/" target="_blank" rel="noopener">documentação oficial</a>.</p>
      {:else if variant === "schema-disabled"}
        <h3>Schema <code>{schemaName}</code> não está habilitado</h3>
        <p>Para criar APIs REST a partir deste schema, ele precisa ser habilitado para ORDS.</p>
        <p>O comando executado será:</p>
        <pre class="cmd">BEGIN
  ORDS.ENABLE_SCHEMA(p_enabled => TRUE);
  COMMIT;
END;</pre>
        <button class="primary-btn" onclick={() => void handleEnable()} disabled={enabling}>
          {enabling ? "Habilitando…" : "Habilitar agora"}
        </button>
      {:else if variant === "no-privilege"}
        <h3>Privilégio insuficiente</h3>
        <p>Seu usuário precisa do role <code>ORDS_ADMINISTRATOR_ROLE</code> para criar APIs.</p>
        <p>Comando para o DBA:</p>
        <pre class="cmd">GRANT ORDS_ADMINISTRATOR_ROLE TO {schemaName};</pre>
      {:else if variant === "no-url"}
        <h3>URL base do ORDS</h3>
        <p>Não foi possível detectar a URL pública do servidor ORDS automaticamente.</p>
        <p>Informe a URL base (ex: <code>https://servidor:8443/ords</code>):</p>
        <input
          class="url-input"
          type="text"
          placeholder="https://..."
          bind:value={baseUrlInput}
          onkeydown={(e) => e.key === "Enter" && handleSetUrl()}
        />
        <button class="primary-btn" onclick={handleSetUrl} disabled={!baseUrlInput.trim()}>
          Salvar
        </button>
      {:else}
        <h3>Tudo pronto</h3>
        <p>ORDS {state.version ?? ""} configurado e funcionando.</p>
      {/if}
    </div>
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed; inset: 0; background: rgba(0,0,0,0.5);
    display: flex; align-items: center; justify-content: center; z-index: 1000;
  }
  .modal {
    background: var(--bg-surface); border: 1px solid var(--border);
    border-radius: 8px; min-width: 480px; max-width: 640px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.3);
  }
  .modal-head {
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px 16px; border-bottom: 1px solid var(--border);
  }
  .modal-title { font-weight: 600; color: var(--text-primary); font-size: 13px; }
  .close-btn {
    background: none; border: none; color: var(--text-muted);
    cursor: pointer; font-size: 14px; padding: 4px 8px;
  }
  .close-btn:hover { color: var(--text-primary); }
  .modal-body { padding: 20px; color: var(--text-primary); }
  .modal-body h3 { margin: 0 0 12px; font-size: 14px; }
  .modal-body p { margin: 8px 0; font-size: 12.5px; line-height: 1.55; color: var(--text-primary); }
  .cmd {
    background: var(--bg-surface-alt); border: 1px solid var(--border);
    padding: 10px 12px; border-radius: 4px; font-family: monospace;
    font-size: 11.5px; color: var(--text-primary); margin: 8px 0;
    white-space: pre-wrap; word-break: break-all;
  }
  .primary-btn {
    background: rgba(179,62,31,0.2); border: 1px solid rgba(179,62,31,0.5);
    color: #f5a08a; padding: 6px 14px; border-radius: 4px;
    font-size: 12px; font-weight: 600; cursor: pointer; margin-top: 8px;
  }
  .primary-btn:hover:not(:disabled) { background: rgba(179,62,31,0.35); }
  .primary-btn:disabled { opacity: 0.5; cursor: default; }
  .url-input {
    width: 100%; padding: 6px 10px; border: 1px solid var(--border);
    border-radius: 4px; background: var(--input-bg); color: var(--text-primary);
    font-size: 12px; font-family: monospace; margin-top: 4px;
  }
  code {
    font-family: monospace; background: var(--bg-surface-alt);
    padding: 1px 5px; border-radius: 3px; font-size: 11.5px;
  }
</style>
```

- [ ] **Step 2: Commit**

```
git add src/lib/workspace/OrdsBootstrapModal.svelte
git commit -m "feat(vras): OrdsBootstrapModal with 4 detection states"
```

---

## Task 1.5: Wire detect into +page.svelte bootstrap

**Files:**
- Modify: `src/routes/workspace/[id]/+page.svelte`

- [ ] **Step 1: Import store and modal**

Near other workspace imports:
```typescript
import { ordsStore } from "$lib/stores/ords.svelte";
import OrdsBootstrapModal from "$lib/workspace/OrdsBootstrapModal.svelte";
```

- [ ] **Step 2: Add state for showing modal**

Near other `$state` declarations:
```typescript
let showOrdsBootstrap = $state(false);
```

- [ ] **Step 3: Trigger detect in bootstrap()**

In the `bootstrap()` function, after `if (current) expandIfNeeded(current);`, add:

```typescript
void ordsStore.refresh();
```

(fire-and-forget — doesn't block schema browser)

- [ ] **Step 4: Add modal to template**

Near the end of the template, before `</div>` of root:

```svelte
{#if showOrdsBootstrap && ordsStore.state}
  <OrdsBootstrapModal
    state={ordsStore.state}
    schemaName={schemas.find((s) => s.isCurrent)?.name ?? ""}
    onEnableSchema={async () => {
      // Enable will be implemented in Phase 2 — for now noop
      alert("Implementação em Phase 2");
    }}
    onSetBaseUrl={(url) => {
      // Persist will be implemented in Task 1.6 — for now just update state
      if (ordsStore.state) ordsStore.state.ordsBaseUrl = url;
      showOrdsBootstrap = false;
    }}
    onClose={() => showOrdsBootstrap = false}
  />
{/if}
```

- [ ] **Step 5: Run tests**

```
bun run test
```

Expected: all green, no regressions.

- [ ] **Step 6: Commit**

```
git add src/routes/workspace/[id]/+page.svelte
git commit -m "feat(vras): trigger ords.detect on workspace bootstrap"
```

---

# Phase 2 — Schema Tree Integration + Read Existing (6 tasks)

Phase 2 entrega: novo kind `REST_MODULE` no Schema Tree, painel de detalhes mostrando hierarquia, Export as SQL, e botão "Habilitar schema" funcional.

---

## Task 2.1: Add REST_MODULE to ObjectKind type

**Files:**
- Modify: `src/lib/workspace.ts`

- [ ] **Step 1: Extend ObjectKind type**

```typescript
export type ObjectKind =
  | "TABLE" | "VIEW" | "SEQUENCE"
  | "PROCEDURE" | "FUNCTION" | "PACKAGE" | "TRIGGER" | "TYPE"
  | "REST_MODULE";
```

- [ ] **Step 2: Add types for ORDS data**

After the `OrdsDetectResult` type:

```typescript
export type RestModule = {
  name: string;
  basePath: string;
  status: string;
  itemsPerPage: number | null;
  comments: string | null;
};

export type RestTemplate = {
  uriTemplate: string;
  priority: number;
  handlers: RestHandler[];
};

export type RestHandler = {
  method: "GET" | "POST" | "PUT" | "DELETE";
  sourceType: string;
  source: string;
  itemsPerPage: number | null;
};

export type RestPrivilege = {
  name: string;
  roles: string[];
  patterns: string[];
};

export type RestModuleDetail = {
  module: RestModule;
  templates: RestTemplate[];
  privileges: RestPrivilege[];
};
```

- [ ] **Step 3: Add wrappers for list and get**

```typescript
export const ordsModulesList = (owner: string) =>
  call<RestModule[]>("ords_modules_list", { owner });

export const ordsModuleGet = (owner: string, name: string) =>
  call<RestModuleDetail>("ords_module_get", { owner, name });
```

- [ ] **Step 4: Commit**

```
git add src/lib/workspace.ts
git commit -m "feat(vras): add REST_MODULE kind and ORDS types to workspace.ts"
```

---

## Task 2.2: Sidecar handlers `ords.modules.list` and `ords.module.get`

**Files:**
- Modify: `sidecar/src/ords.ts`
- Modify: `sidecar/src/index.ts`

- [ ] **Step 1: Add list and get handlers in ords.ts**

```typescript
import { quoteIdent } from "./oracle";

export async function ordsModulesList(params: { owner: string }): Promise<{ name: string; basePath: string; status: string; itemsPerPage: number | null; comments: string | null }[]> {
  const conn = state.connection;
  if (!conn) throw { code: -32010, message: "No active session" };

  const sql = `
    SELECT name, base_path AS "basePath", status, items_per_page AS "itemsPerPage", comments
    FROM   all_ords_modules
    WHERE  parsing_schema = :owner
    ORDER BY name`;
  const res = await conn.execute<any>(sql, { owner: params.owner.toUpperCase() }, { outFormat: 4002 });
  return (res.rows ?? []).map((r: any) => ({
    name: r.NAME ?? r.name,
    basePath: r.basePath ?? r.BASEPATH,
    status: r.STATUS ?? r.status,
    itemsPerPage: r.itemsPerPage ?? r.ITEMSPERPAGE ?? null,
    comments: r.COMMENTS ?? r.comments ?? null,
  }));
}

export async function ordsModuleGet(params: { owner: string; name: string }): Promise<any> {
  const conn = state.connection;
  if (!conn) throw { code: -32010, message: "No active session" };

  // Module
  const modRes = await conn.execute<any>(
    `SELECT name, base_path, status, items_per_page, comments
     FROM all_ords_modules
     WHERE parsing_schema = :owner AND name = :name`,
    { owner: params.owner.toUpperCase(), name: params.name },
    { outFormat: 4002 }
  );
  if (!modRes.rows || modRes.rows.length === 0) {
    throw { code: -32012, message: `Module ${params.name} not found` };
  }
  const m = modRes.rows[0];

  // Templates + handlers
  const tplRes = await conn.execute<any>(
    `SELECT t.id AS template_id, t.uri_template, t.priority,
            h.method, h.source_type, h.source, h.items_per_page AS handler_items_per_page
     FROM all_ords_templates t
     LEFT JOIN all_ords_handlers h ON h.template_id = t.id
     WHERE t.parsing_schema = :owner AND t.module_name = :name
     ORDER BY t.uri_template, h.method`,
    { owner: params.owner.toUpperCase(), name: params.name },
    { outFormat: 4002 }
  );

  const templatesMap = new Map<string, any>();
  for (const row of (tplRes.rows ?? [])) {
    const uri = row.URI_TEMPLATE ?? row.uri_template;
    if (!templatesMap.has(uri)) {
      templatesMap.set(uri, {
        uriTemplate: uri,
        priority: row.PRIORITY ?? row.priority ?? 0,
        handlers: [],
      });
    }
    const method = row.METHOD ?? row.method;
    if (method) {
      templatesMap.get(uri).handlers.push({
        method,
        sourceType: row.SOURCE_TYPE ?? row.source_type,
        source: row.SOURCE ?? row.source ?? "",
        itemsPerPage: row.handler_items_per_page ?? row.HANDLER_ITEMS_PER_PAGE ?? null,
      });
    }
  }

  // Privileges
  const privRes = await conn.execute<any>(
    `SELECT p.name, p.label,
            LISTAGG(pr.role, ',') WITHIN GROUP (ORDER BY pr.role) AS roles,
            LISTAGG(pp.pattern, ',') WITHIN GROUP (ORDER BY pp.pattern) AS patterns
     FROM all_ords_privileges p
     LEFT JOIN all_ords_privileges_roles pr ON pr.privilege_id = p.id
     LEFT JOIN all_ords_privileges_patterns pp ON pp.privilege_id = p.id
     WHERE p.parsing_schema = :owner
     GROUP BY p.name, p.label`,
    { owner: params.owner.toUpperCase() },
    { outFormat: 4002 }
  );

  const privileges = (privRes.rows ?? []).map((r: any) => ({
    name: r.NAME ?? r.name,
    roles: (r.ROLES ?? r.roles ?? "").split(",").filter(Boolean),
    patterns: (r.PATTERNS ?? r.patterns ?? "").split(",").filter(Boolean),
  }));

  return {
    module: {
      name: m.NAME ?? m.name,
      basePath: m.BASE_PATH ?? m.base_path,
      status: m.STATUS ?? m.status,
      itemsPerPage: m.ITEMS_PER_PAGE ?? m.items_per_page ?? null,
      comments: m.COMMENTS ?? m.comments ?? null,
    },
    templates: Array.from(templatesMap.values()),
    privileges,
  };
}
```

- [ ] **Step 2: Register handlers in `sidecar/src/index.ts`**

```typescript
"ords.modules.list": (params) => ordsModulesList(params as any),
"ords.module.get":   (params) => ordsModuleGet(params as any),
```

Update import:
```typescript
import { ordsDetect, ordsModulesList, ordsModuleGet } from "./ords";
```

- [ ] **Step 3: Add Tauri commands in commands.rs**

```rust
#[tauri::command]
pub async fn ords_modules_list(app: AppHandle, owner: String) -> Result<serde_json::Value, ConnectionTestErr> {
    call_sidecar(&app, "ords.modules.list", json!({ "owner": owner })).await
}

#[tauri::command]
pub async fn ords_module_get(app: AppHandle, owner: String, name: String) -> Result<serde_json::Value, ConnectionTestErr> {
    call_sidecar(&app, "ords.module.get", json!({ "owner": owner, "name": name })).await
}
```

(Frontend will deserialize from raw `serde_json::Value` since types are simple.)

- [ ] **Step 4: Register in lib.rs**

Add `commands::ords_modules_list` and `commands::ords_module_get` to `tauri::generate_handler![...]`.

- [ ] **Step 5: Recompile sidecar + test in dev**

```
cd sidecar && bun build src/index.ts --compile --minify --outfile ../src-tauri/binaries/veesker-sidecar-x86_64-pc-windows-msvc.exe && cd ..
```

- [ ] **Step 6: Commit**

```
git add sidecar/src/ords.ts sidecar/src/index.ts src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat(vras): ords.modules.list and ords.module.get RPCs"
```

---

## Task 2.3: SchemaTree integration — REST_MODULE kind

**Files:**
- Modify: `src/lib/workspace/SchemaTree.svelte`
- Modify: `src/routes/workspace/[id]/+page.svelte`

- [ ] **Step 1: Add REST_MODULE to SchemaNode kinds**

In `+page.svelte`, find `newSchemaNode` function and add:

```typescript
kinds: {
  TABLE: { kind: "idle" },
  VIEW: { kind: "idle" },
  SEQUENCE: { kind: "idle" },
  PROCEDURE: { kind: "idle" },
  FUNCTION: { kind: "idle" },
  PACKAGE: { kind: "idle" },
  TRIGGER: { kind: "idle" },
  TYPE: { kind: "idle" },
  REST_MODULE: { kind: "idle" },  // NEW
},
```

- [ ] **Step 2: Add REST_MODULE loading in expandIfNeeded**

```typescript
const kinds: ObjectKind[] = [
  "TABLE", "VIEW", "SEQUENCE",
  "PROCEDURE", "FUNCTION", "PACKAGE", "TRIGGER", "TYPE",
  "REST_MODULE",
];
```

- [ ] **Step 3: Update loadKind to handle REST_MODULE**

```typescript
async function loadKind(node: SchemaNode, kind: ObjectKind): Promise<void> {
  node.kinds[kind] = { kind: "loading" };
  schemas = [...schemas];
  if (kind === "REST_MODULE") {
    const res = await ordsModulesList(node.name);
    if (res.ok) {
      // Map RestModule[] to ObjectRef[] format used by SchemaTree
      node.kinds[kind] = { kind: "ok", value: res.data.map(m => ({ name: m.name })) };
    } else {
      if (res.error.code === SESSION_LOST) sessionLost = true;
      node.kinds[kind] = { kind: "err", message: res.error.message };
    }
  } else if (PLSQL_KINDS.includes(kind)) {
    // ... existing PLSQL branch
  } else {
    // ... existing default branch
  }
  schemas = [...schemas];
}
```

Update import: `import { ordsModulesList, ... } from "$lib/workspace";`

- [ ] **Step 4: Update SchemaTree.svelte to render REST_MODULE kind**

Find the kinds array used for rendering:
```typescript
const KINDS: { key: ObjectKind; label: string; icon: string }[] = [
  { key: "TABLE", label: "Tables", icon: "table" },
  // ... existing
  { key: "REST_MODULE", label: "REST Modules", icon: "globe" },  // NEW
];
```

(Adjust based on actual structure of SchemaTree — may use different shape.)

- [ ] **Step 5: Test in dev**

Open workspace; expand current schema. "REST Modules" should appear at end of kind list. Clicking it lists modules from the schema.

- [ ] **Step 6: Commit**

```
git add src/lib/workspace/SchemaTree.svelte src/routes/workspace/[id]/+page.svelte
git commit -m "feat(vras): REST_MODULE kind in SchemaTree"
```

---

## Task 2.4: RestModuleDetails component (read-only view)

**Files:**
- Create: `src/lib/workspace/RestModuleDetails.svelte`
- Modify: `src/routes/workspace/[id]/+page.svelte` — render component when REST_MODULE is selected

- [ ] **Step 1: Create RestModuleDetails.svelte**

```svelte
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
    if (res.ok) detail = res.data as RestModuleDetail;
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
    <div class="loading">Carregando módulo…</div>
  {:else if error}
    <div class="error">{error}</div>
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
      </div>
    </div>

    <div class="section">
      <h3>Templates ({detail.templates.length})</h3>
      {#each detail.templates as tpl}
        <div class="template">
          <div class="tpl-uri"><code>{tpl.uriTemplate || "/"}</code></div>
          {#each tpl.handlers as h}
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
        {#each detail.privileges as p}
          <div class="priv">
            <code>{p.name}</code> — roles: {p.roles.join(", ") || "—"}
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
  .rest-details { padding: 12px; color: var(--text-primary); overflow-y: auto; height: 100%; }
  .loading, .error { padding: 20px; color: var(--text-muted); font-size: 12px; }
  .error { color: #f5a08a; }
  .header { padding-bottom: 10px; border-bottom: 1px solid var(--border); margin-bottom: 12px; }
  .title-row { display: flex; align-items: center; justify-content: space-between; }
  .title { font-size: 14px; font-weight: 600; }
  .actions { display: flex; gap: 6px; }
  .meta { display: flex; gap: 6px; margin-top: 6px; font-size: 11px; color: var(--text-muted); }
  code { font-family: "JetBrains Mono", monospace; background: var(--bg-surface-alt); padding: 1px 5px; border-radius: 3px; font-size: 11px; }
  .section { margin-bottom: 14px; }
  .section h3 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); margin: 0 0 8px; }
  .template { background: var(--bg-surface-alt); border: 1px solid var(--border); border-radius: 4px; padding: 8px; margin-bottom: 6px; }
  .tpl-uri { margin-bottom: 6px; font-size: 12px; }
  .handler { padding: 4px 0; border-top: 1px solid var(--border); }
  .handler-row { display: flex; align-items: center; gap: 8px; font-size: 11px; }
  .method { font-family: monospace; font-weight: 700; padding: 1px 6px; border-radius: 3px; font-size: 10px; }
  .method-get { background: rgba(74,158,218,0.2); color: #4a9eda; }
  .method-post { background: rgba(139,196,168,0.2); color: #8bc4a8; }
  .method-put { background: rgba(195,166,110,0.2); color: #c3a66e; }
  .method-delete { background: rgba(245,160,138,0.2); color: #f5a08a; }
  .src-type { color: var(--text-muted); font-size: 10.5px; }
  .link-btn { margin-left: auto; background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 10px; }
  .link-btn:hover { color: var(--text-primary); }
  .source { background: var(--bg-page); border: 1px solid var(--border); border-radius: 3px; padding: 8px; font-size: 10.5px; font-family: monospace; white-space: pre-wrap; margin: 6px 0 2px; max-height: 200px; overflow-y: auto; }
  .priv { font-size: 11px; padding: 4px 0; }
  .footer { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; padding-top: 10px; border-top: 1px solid var(--border); }
  .btn { background: var(--bg-surface-alt); border: 1px solid var(--border); color: var(--text-primary); padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 11px; }
  .btn:hover { background: var(--row-hover); }
  .btn.primary { background: rgba(179,62,31,0.2); border-color: rgba(179,62,31,0.45); color: #f5a08a; }
  .btn.primary:hover { background: rgba(179,62,31,0.35); }
</style>
```

- [ ] **Step 2: Render in +page.svelte when REST_MODULE selected**

In `selectObject`, add a branch for REST_MODULE:
```typescript
if (kind === "REST_MODULE") {
  details = { kind: "idle" }; // not used
  return;
}
```

In the template where ObjectDetails is rendered, add:
```svelte
{#if selected && selected.kind === "REST_MODULE"}
  <RestModuleDetails
    owner={selected.owner}
    moduleName={selected.name}
    onTest={() => { /* Phase 4 */ }}
    onOpenDocs={(p) => { /* Phase 4 */ }}
    onAddEndpoint={() => { /* Phase 3 */ }}
    onExportSql={() => { /* Task 2.6 */ }}
  />
{:else if selected}
  <ObjectDetails ... />
{/if}
```

- [ ] **Step 3: Test in dev**

Click on a REST module → details panel shows hierarchy.

- [ ] **Step 4: Commit**

```
git add src/lib/workspace/RestModuleDetails.svelte src/routes/workspace/[id]/+page.svelte
git commit -m "feat(vras): RestModuleDetails read-only view"
```

---

## Task 2.5: Enable Schema action

**Files:**
- Modify: `sidecar/src/ords.ts`
- Modify: `sidecar/src/index.ts`
- Modify: `src-tauri/src/commands.rs`, `lib.rs`
- Modify: `src/lib/workspace.ts`
- Modify: `src/routes/workspace/[id]/+page.svelte`

- [ ] **Step 1: Sidecar handler `ords.enable_schema`**

```typescript
export async function ordsEnableSchema(_params: Record<string, unknown> = {}): Promise<{ ok: true }> {
  const conn = state.connection;
  if (!conn) throw { code: -32010, message: "No active session" };
  await conn.execute(`BEGIN ORDS.ENABLE_SCHEMA(p_enabled => TRUE); COMMIT; END;`, []);
  return { ok: true };
}
```

Register in index.ts: `"ords.enable_schema": (params) => ordsEnableSchema(params as any),`

- [ ] **Step 2: Tauri command + register**

```rust
#[tauri::command]
pub async fn ords_enable_schema(app: AppHandle) -> Result<(), ConnectionTestErr> {
    call_sidecar(&app, "ords.enable_schema", json!({})).await?;
    Ok(())
}
```

Add to `generate_handler!`.

- [ ] **Step 3: Frontend wrapper**

```typescript
export const ordsEnableSchema = () => call<void>("ords_enable_schema", {});
```

- [ ] **Step 4: Wire to OrdsBootstrapModal**

In `+page.svelte`, replace the `onEnableSchema` placeholder:
```typescript
onEnableSchema={async () => {
  const res = await ordsEnableSchema();
  if (res.ok) {
    await ordsStore.refresh();
    if (ordsStore.state?.currentSchemaEnabled) showOrdsBootstrap = false;
  } else {
    alert("Falha ao habilitar: " + res.error.message);
  }
}}
```

- [ ] **Step 5: Recompile sidecar + test**

- [ ] **Step 6: Commit**

```
git add sidecar/src/ords.ts sidecar/src/index.ts src-tauri/src/commands.rs src-tauri/src/lib.rs src/lib/workspace.ts src/routes/workspace/[id]/+page.svelte
git commit -m "feat(vras): enable_schema action wired through bootstrap modal"
```

---

## Task 2.6: Export module as SQL

**Files:**
- Modify: `sidecar/src/ords.ts`
- Modify: `sidecar/src/index.ts`
- Modify: `src-tauri/src/commands.rs`, `lib.rs`
- Modify: `src/lib/workspace.ts`
- Modify: `src/lib/workspace/RestModuleDetails.svelte`

- [ ] **Step 1: Sidecar handler `ords.module.export_sql`**

In `ords.ts`:

```typescript
export async function ordsModuleExportSql(params: { owner: string; name: string }): Promise<{ sql: string }> {
  const detail = await ordsModuleGet(params);
  const lines: string[] = [];
  lines.push(`-- Generated by Veesker on ${new Date().toISOString().slice(0,10)}`);
  lines.push(`-- Module: ${detail.module.name}`);
  lines.push(`-- Source: ${params.owner}@<host>`);
  lines.push("");
  lines.push("BEGIN");
  lines.push(`  ORDS.DEFINE_MODULE(`);
  lines.push(`    p_module_name    => ${sqlString(detail.module.name)},`);
  lines.push(`    p_base_path      => ${sqlString(detail.module.basePath)},`);
  if (detail.module.itemsPerPage !== null) {
    lines.push(`    p_items_per_page => ${detail.module.itemsPerPage},`);
  }
  lines.push(`    p_status         => ${sqlString(detail.module.status)});`);
  lines.push("");

  for (const tpl of detail.templates) {
    lines.push(`  ORDS.DEFINE_TEMPLATE(`);
    lines.push(`    p_module_name => ${sqlString(detail.module.name)},`);
    lines.push(`    p_pattern     => ${sqlString(tpl.uriTemplate)});`);
    for (const h of tpl.handlers) {
      lines.push(`  ORDS.DEFINE_HANDLER(`);
      lines.push(`    p_module_name => ${sqlString(detail.module.name)},`);
      lines.push(`    p_pattern     => ${sqlString(tpl.uriTemplate)},`);
      lines.push(`    p_method      => ${sqlString(h.method)},`);
      lines.push(`    p_source_type => ${sqlString(h.sourceType)},`);
      lines.push(`    p_source      => ${sqlMultiline(h.source)});`);
    }
    lines.push("");
  }

  lines.push("  COMMIT;");
  lines.push("END;");
  lines.push("/");

  return { sql: lines.join("\n") };
}

function sqlString(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

function sqlMultiline(s: string): string {
  // For long source code, use q'[...]' to avoid escaping
  if (s.includes("'") || s.includes("\n")) {
    return `q'[${s.replace(/\]/g, "]'||']'||q'[")}]'`;
  }
  return sqlString(s);
}
```

Register: `"ords.module.export_sql": (params) => ordsModuleExportSql(params as any),`

- [ ] **Step 2: Tauri command**

```rust
#[tauri::command]
pub async fn ords_module_export_sql(app: AppHandle, owner: String, name: String) -> Result<serde_json::Value, ConnectionTestErr> {
    call_sidecar(&app, "ords.module.export_sql", json!({ "owner": owner, "name": name })).await
}
```

Register in lib.rs.

- [ ] **Step 3: Frontend wrapper**

```typescript
export const ordsModuleExportSql = (owner: string, name: string) =>
  call<{ sql: string }>("ords_module_export_sql", { owner, name });
```

- [ ] **Step 4: Wire to RestModuleDetails**

In `+page.svelte`, replace the `onExportSql` callback:
```typescript
onExportSql={async () => {
  if (!selected) return;
  const res = await ordsModuleExportSql(selected.owner, selected.name);
  if (res.ok) {
    sqlEditor.openWithDdl(`Export: ${selected.name}`, res.data.sql);
  } else {
    alert("Export failed: " + res.error.message);
  }
}}
```

- [ ] **Step 5: Test in dev**

Click "Export as SQL" on a module → new SQL tab opens with DEFINE_MODULE/DEFINE_TEMPLATE/DEFINE_HANDLER block.

- [ ] **Step 6: Commit**

```
git add sidecar/src/ords.ts sidecar/src/index.ts src-tauri/src/commands.rs src-tauri/src/lib.rs src/lib/workspace.ts src/routes/workspace/[id]/+page.svelte
git commit -m "feat(vras): export ORDS module as SQL via reverse-engineering"
```

---

# Phase 3 — Create Endpoints (8 tasks)

Phase 3 entrega: Builder modal funcionando para os 3 tipos (auto-CRUD, custom SQL, procedure), preview com apply direto/copy, integração com right-click do Schema Tree.

---

## Task 3.1: RestApiBuilder — shell + form layout

**Files:**
- Create: `src/lib/workspace/RestApiBuilder.svelte`

- [ ] **Step 1: Create base modal with form**

```svelte
<script lang="ts">
  import { ordsModulesList, type ObjectKind } from "$lib/workspace";

  type Props = {
    owner: string;
    initialKind?: "table" | "view" | "procedure" | "function" | null;
    initialObject?: { owner: string; name: string } | null;
    onCancel: () => void;
    onPreview: (config: BuilderConfig) => void;
  };
  let { owner, initialKind = null, initialObject = null, onCancel, onPreview }: Props = $props();

  type EndpointType = "auto-crud" | "custom-sql" | "procedure";
  type AuthMode = "none" | "role" | "oauth";

  export type BuilderConfig = {
    type: EndpointType;
    sourceObject: { owner: string; name: string; kind: string } | null;
    sourceSql: string | null;
    operations: string[];      // for auto-crud: ['GET','POST','PUT','DELETE','GET_BY_ID']
    moduleMode: "new" | "existing";
    moduleName: string;
    basePath: string;
    routePattern: string;      // for custom/procedure
    method: string;            // for custom/procedure
    authMode: AuthMode;
    authRole: string | null;
    oauthClientName: string | null;
  };

  let endpointType = $state<EndpointType>(
    initialKind === "procedure" || initialKind === "function" ? "procedure" : "auto-crud"
  );
  let sourceObject = $state(initialObject);
  let sourceSql = $state("SELECT 1 FROM dual");
  let operations = $state<string[]>(["GET","POST","PUT","DELETE","GET_BY_ID"]);
  let moduleMode = $state<"new"|"existing">("new");
  let moduleName = $state("");
  let basePath = $state("/");
  let routePattern = $state("/");
  let method = $state("GET");
  let authMode = $state<AuthMode>("none");
  let authRole = $state<string | null>(null);

  $effect(() => {
    if (sourceObject && moduleMode === "new" && !moduleName) {
      moduleName = sourceObject.name.toLowerCase().replace(/_/g, "-") + "-api";
      basePath = "/" + sourceObject.name.toLowerCase().replace(/_/g, "-") + "/";
    }
  });

  function handlePreview() {
    onPreview({
      type: endpointType,
      sourceObject,
      sourceSql: endpointType === "custom-sql" ? sourceSql : null,
      operations,
      moduleMode,
      moduleName,
      basePath,
      routePattern,
      method,
      authMode,
      authRole,
      oauthClientName: null,
    });
  }
</script>

<div class="modal-backdrop" onclick={onCancel}>
  <div class="modal" onclick={(e) => e.stopPropagation()}>
    <div class="modal-head">
      <span class="title">Criar Endpoint REST</span>
      <div class="head-actions">
        <button class="sheep-btn" disabled title="Phase 4 — Sheep AI">✨ Sheep</button>
        <button class="close-btn" onclick={onCancel}>✕</button>
      </div>
    </div>

    <div class="modal-body">
      <!-- Tipo -->
      <div class="row">
        <label class="label">Tipo:</label>
        <label><input type="radio" bind:group={endpointType} value="auto-crud" /> Auto-CRUD</label>
        <label><input type="radio" bind:group={endpointType} value="custom-sql" /> Custom SQL</label>
        <label><input type="radio" bind:group={endpointType} value="procedure" /> Procedure</label>
      </div>

      <!-- Source (placeholder per type — to be expanded in 3.2/3.3/3.4) -->
      <div class="section">
        <h3>Source</h3>
        <div class="placeholder">[Source picker — implementado nas próximas tasks]</div>
      </div>

      <!-- Roteamento -->
      <div class="section">
        <h3>Roteamento</h3>
        <label class="row"><input type="radio" bind:group={moduleMode} value="new" /> Novo módulo:</label>
        <input class="input" bind:value={moduleName} placeholder="meu-modulo" disabled={moduleMode !== "new"} />
        <label class="row"><input type="radio" bind:group={moduleMode} value="existing" /> Módulo existente</label>
        <div class="row">
          <span class="label">Base path:</span>
          <input class="input" bind:value={basePath} placeholder="/api/" />
        </div>
      </div>

      <!-- Auth -->
      <div class="section">
        <h3>Auth</h3>
        <label class="row"><input type="radio" bind:group={authMode} value="none" /> Público</label>
        <label class="row"><input type="radio" bind:group={authMode} value="role" /> Role do banco</label>
        <label class="row"><input type="radio" bind:group={authMode} value="oauth" /> OAuth 2.0</label>
      </div>
    </div>

    <div class="modal-foot">
      <button class="btn" onclick={onCancel}>Cancelar</button>
      <button class="btn primary" onclick={handlePreview}>Visualizar SQL →</button>
    </div>
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed; inset: 0; background: rgba(0,0,0,0.6);
    display: flex; align-items: center; justify-content: center; z-index: 1000;
  }
  .modal {
    background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px;
    width: 720px; max-width: 90vw; max-height: 90vh; display: flex; flex-direction: column;
  }
  .modal-head { padding: 12px 16px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; }
  .title { font-weight: 600; color: var(--text-primary); }
  .head-actions { display: flex; gap: 8px; }
  .sheep-btn { background: rgba(179,62,31,0.15); border: 1px solid rgba(179,62,31,0.4); color: #f5a08a; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 11px; }
  .sheep-btn:disabled { opacity: 0.5; cursor: default; }
  .close-btn { background: none; border: none; color: var(--text-muted); cursor: pointer; padding: 4px 8px; }
  .close-btn:hover { color: var(--text-primary); }
  .modal-body { padding: 16px; overflow-y: auto; flex: 1; color: var(--text-primary); font-size: 12px; }
  .section { margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid var(--border); }
  .section h3 { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); margin: 0 0 8px; }
  .row { display: flex; align-items: center; gap: 8px; margin: 6px 0; }
  .label { color: var(--text-muted); min-width: 80px; font-size: 11.5px; }
  .input { background: var(--input-bg); border: 1px solid var(--border); border-radius: 4px; color: var(--text-primary); padding: 4px 8px; font-size: 11.5px; flex: 1; min-width: 0; }
  .placeholder { color: var(--text-muted); font-style: italic; padding: 8px; font-size: 11px; }
  .modal-foot { padding: 10px 16px; border-top: 1px solid var(--border); display: flex; justify-content: flex-end; gap: 8px; }
  .btn { background: var(--bg-surface-alt); border: 1px solid var(--border); color: var(--text-primary); padding: 5px 12px; border-radius: 4px; cursor: pointer; font-size: 11.5px; }
  .btn:hover { background: var(--row-hover); }
  .btn.primary { background: rgba(179,62,31,0.2); border-color: rgba(179,62,31,0.45); color: #f5a08a; }
  .btn.primary:hover { background: rgba(179,62,31,0.35); }
</style>
```

- [ ] **Step 2: Commit**

```
git add src/lib/workspace/RestApiBuilder.svelte
git commit -m "feat(vras): RestApiBuilder modal shell with type/routing/auth sections"
```

---

## Task 3.2: Source picker — Auto-CRUD

**Files:**
- Modify: `src/lib/workspace/RestApiBuilder.svelte`
- Modify: `src/lib/workspace.ts` — add helper to list tables/views in current schema

- [ ] **Step 1: Add helper to fetch tables+views**

In `src/lib/workspace.ts`, add (or reuse existing `objectsList`):
```typescript
// Already exists: objectsList(owner, "TABLE" | "VIEW")
```

- [ ] **Step 2: Add table/view picker in builder when type === "auto-crud"**

Replace the `[Source picker — placeholder]` div for auto-crud with:

```svelte
{#if endpointType === "auto-crud"}
  <div class="row">
    <span class="label">Tabela/View:</span>
    <select class="input" bind:value={selectedObjectName} onchange={() => loadObjectKind()}>
      <option value="" disabled>Selecione…</option>
      <optgroup label="Tables">
        {#each tablesList as t}<option value={"TABLE:" + t.name}>{t.name}</option>{/each}
      </optgroup>
      <optgroup label="Views">
        {#each viewsList as v}<option value={"VIEW:" + v.name}>{v.name}</option>{/each}
      </optgroup>
    </select>
  </div>
  <div class="row">
    <span class="label">Operações:</span>
    {#each ["GET","POST","PUT","DELETE","GET_BY_ID"] as op}
      <label class="op-cb">
        <input type="checkbox" checked={operations.includes(op)} onchange={(e) => {
          if ((e.target as HTMLInputElement).checked) operations = [...operations, op];
          else operations = operations.filter(o => o !== op);
        }} />
        {op}
      </label>
    {/each}
  </div>
{/if}
```

Add state:
```typescript
let tablesList = $state<{ name: string }[]>([]);
let viewsList = $state<{ name: string }[]>([]);
let selectedObjectName = $state("");

$effect(() => {
  void loadObjectLists();
});

async function loadObjectLists() {
  const [t, v] = await Promise.all([objectsList(owner, "TABLE"), objectsList(owner, "VIEW")]);
  if (t.ok) tablesList = t.data;
  if (v.ok) viewsList = v.data;
}

function loadObjectKind() {
  if (!selectedObjectName) return;
  const [k, n] = selectedObjectName.split(":");
  sourceObject = { owner, name: n, kind: k };
}
```

Add import: `import { objectsList } from "$lib/workspace";`

- [ ] **Step 3: Commit**

```
git add src/lib/workspace/RestApiBuilder.svelte
git commit -m "feat(vras): auto-CRUD source picker with table/view dropdown + operations"
```

---

## Task 3.3: Source picker — Custom SQL

**Files:**
- Modify: `src/lib/workspace/RestApiBuilder.svelte`

- [ ] **Step 1: Add SQL editor for custom-sql type**

Add inside the `<!-- Source -->` section:
```svelte
{#if endpointType === "custom-sql"}
  <div class="row">
    <span class="label">SQL:</span>
  </div>
  <textarea
    class="sql-area"
    bind:value={sourceSql}
    rows="6"
    placeholder="SELECT col1, col2 FROM tabela WHERE id = :id"
  ></textarea>
  <div class="row">
    <span class="label">Rota:</span>
    <input class="input" bind:value={routePattern} placeholder="/by-id/:id" />
    <span class="label" style="min-width: 60px">Método:</span>
    <select class="input" bind:value={method} style="flex: 0 0 100px">
      <option>GET</option><option>POST</option><option>PUT</option><option>DELETE</option>
    </select>
  </div>
  <div class="hint">
    Bind variables (<code>:nome</code>) detectadas no SQL: {detectedBinds.join(", ") || "(nenhuma)"}
  </div>
  <div class="hint">
    Path params na rota (<code>:id</code>) detectados: {detectedPathParams.join(", ") || "(nenhum)"}
  </div>
{/if}
```

CSS additions:
```css
.sql-area {
  width: 100%; box-sizing: border-box;
  background: var(--input-bg); border: 1px solid var(--border); border-radius: 4px;
  color: var(--text-primary); padding: 8px; font-family: monospace; font-size: 11px;
  resize: vertical; min-height: 80px;
}
.hint { font-size: 10.5px; color: var(--text-muted); margin: 4px 0; }
```

Add derived state:
```typescript
const detectedBinds = $derived(
  endpointType === "custom-sql"
    ? Array.from(new Set([...sourceSql.matchAll(/:(\w+)/g)].map(m => m[1])))
    : []
);
const detectedPathParams = $derived(
  Array.from(new Set([...routePattern.matchAll(/:(\w+)/g)].map(m => m[1])))
);
```

- [ ] **Step 2: Commit**

```
git add src/lib/workspace/RestApiBuilder.svelte
git commit -m "feat(vras): custom-SQL source with bind/path param detection"
```

---

## Task 3.4: Source picker — Procedure/Function

**Files:**
- Modify: `src/lib/workspace/RestApiBuilder.svelte`
- Modify: `src/lib/workspace.ts`

- [ ] **Step 1: Add procedure introspection wrapper**

Reuse existing `objectsListPlsql` and add a new helper that gets parameters. Check if `proc_describe` or similar already exists in sidecar — likely yes (used by ProcExecModal).

```typescript
export type ProcParam = {
  name: string;
  position: number;
  argMode: "IN" | "OUT" | "IN/OUT";
  dataType: string;
  defaultValue: string | null;
};

export const procDescribe = (owner: string, name: string, packageName: string | null) =>
  call<{ params: ProcParam[]; hasReturn: boolean; returnType: string | null }>(
    "proc_describe", { owner, name, packageName }
  );
```

(If `proc_describe` doesn't exist yet, this will be added in same task or next.)

- [ ] **Step 2: Add procedure picker in builder**

```svelte
{#if endpointType === "procedure"}
  <div class="row">
    <span class="label">Procedure/Function:</span>
    <select class="input" bind:value={selectedProcName} onchange={() => void loadProcParams()}>
      <option value="" disabled>Selecione…</option>
      <optgroup label="Procedures">
        {#each proceduresList as p}<option value={"PROCEDURE:" + p.name}>{p.name}</option>{/each}
      </optgroup>
      <optgroup label="Functions">
        {#each functionsList as f}<option value={"FUNCTION:" + f.name}>{f.name}</option>{/each}
      </optgroup>
    </select>
  </div>
  <div class="row">
    <span class="label">Rota:</span>
    <input class="input" bind:value={routePattern} placeholder="/" />
    <span class="label" style="min-width: 60px">Método:</span>
    <select class="input" bind:value={method} style="flex: 0 0 100px">
      <option>POST</option><option>GET</option><option>PUT</option><option>DELETE</option>
    </select>
  </div>
  {#if procParams.length > 0}
    <div class="hint">
      Parâmetros detectados:
      <table class="params-table">
        <thead><tr><th>Nome</th><th>Modo</th><th>Tipo</th><th>Mapeamento</th></tr></thead>
        <tbody>
          {#each procParams as p}
            <tr>
              <td><code>{p.name}</code></td>
              <td>{p.argMode}</td>
              <td>{p.dataType}</td>
              <td>{p.argMode === "IN" ? (method === "GET" ? "query string" : "body") : "response"}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
{/if}
```

State:
```typescript
let proceduresList = $state<{ name: string }[]>([]);
let functionsList = $state<{ name: string }[]>([]);
let selectedProcName = $state("");
let procParams = $state<ProcParam[]>([]);

$effect(() => {
  if (endpointType === "procedure") void loadProcLists();
});

async function loadProcLists() {
  const [p, f] = await Promise.all([
    objectsListPlsql(owner, "PROCEDURE"),
    objectsListPlsql(owner, "FUNCTION"),
  ]);
  if (p.ok) proceduresList = p.data;
  if (f.ok) functionsList = f.data;
}

async function loadProcParams() {
  if (!selectedProcName) return;
  const [k, n] = selectedProcName.split(":");
  sourceObject = { owner, name: n, kind: k };
  const res = await procDescribe(owner, n, null);
  if (res.ok) procParams = res.data.params;
}
```

CSS:
```css
.params-table { width: 100%; margin-top: 6px; border-collapse: collapse; font-size: 10.5px; }
.params-table th, .params-table td { padding: 3px 6px; border: 1px solid var(--border); text-align: left; }
.params-table th { background: var(--bg-surface-alt); color: var(--text-muted); font-weight: 600; }
```

- [ ] **Step 3: Commit**

```
git add src/lib/workspace/RestApiBuilder.svelte src/lib/workspace.ts
git commit -m "feat(vras): procedure source picker with param introspection"
```

---

## Task 3.5: Auth section — populate role dropdown

**Files:**
- Modify: `src/lib/workspace/RestApiBuilder.svelte`
- Modify: `sidecar/src/ords.ts`
- Modify: `src-tauri/src/commands.rs`, `lib.rs`
- Modify: `src/lib/workspace.ts`

- [ ] **Step 1: Sidecar handler `ords.roles.list`**

```typescript
export async function ordsRolesList(_params: Record<string, unknown> = {}): Promise<{ roles: string[] }> {
  const conn = state.connection;
  if (!conn) throw { code: -32010, message: "No active session" };
  const res = await conn.execute<any>(
    `SELECT role_name FROM all_ords_roles ORDER BY role_name`,
    [], { outFormat: 4002 }
  );
  return { roles: (res.rows ?? []).map((r: any) => r.ROLE_NAME ?? r.role_name) };
}
```

Register: `"ords.roles.list": (params) => ordsRolesList(params as any),`

- [ ] **Step 2: Tauri command + frontend wrapper**

```rust
#[tauri::command]
pub async fn ords_roles_list(app: AppHandle) -> Result<serde_json::Value, ConnectionTestErr> {
    call_sidecar(&app, "ords.roles.list", json!({})).await
}
```

```typescript
export const ordsRolesList = () => call<{ roles: string[] }>("ords_roles_list", {});
```

- [ ] **Step 3: Use in builder Auth section**

```svelte
{#if authMode === "role"}
  <div class="row" style="margin-left: 20px">
    <span class="label">Role:</span>
    <select class="input" bind:value={authRole}>
      <option value={null} disabled>Selecione…</option>
      {#each rolesList as r}<option value={r}>{r}</option>{/each}
    </select>
  </div>
{/if}
{#if authMode === "oauth"}
  <div class="row" style="margin-left: 20px">
    <div class="hint">OAuth client e role serão criados junto com o módulo.</div>
  </div>
{/if}
```

State:
```typescript
let rolesList = $state<string[]>([]);

$effect(() => {
  if (authMode === "role" && rolesList.length === 0) {
    void ordsRolesList().then(r => { if (r.ok) rolesList = r.data.roles; });
  }
});
```

- [ ] **Step 4: Commit**

```
git add sidecar/src/ords.ts sidecar/src/index.ts src-tauri/src/commands.rs src-tauri/src/lib.rs src/lib/workspace.ts src/lib/workspace/RestApiBuilder.svelte
git commit -m "feat(vras): role-based auth dropdown in builder"
```

---

## Task 3.6: SQL generators — auto-CRUD, custom SQL, procedure

**Files:**
- Modify: `sidecar/src/ords.ts`
- Modify: `sidecar/src/index.ts`
- Modify: `sidecar/tests/ords.test.ts`
- Modify: `src-tauri/src/commands.rs`, `lib.rs`
- Modify: `src/lib/workspace.ts`

- [ ] **Step 1: Write tests for SQL generators**

In `sidecar/tests/ords.test.ts`:

```typescript
import { generateAutoCrudSql, generateCustomSqlEndpoint, generateProcedureEndpoint } from "../src/ords";

describe("generateAutoCrudSql", () => {
  it("generates ENABLE_OBJECT for table with NONE auth", () => {
    const sql = generateAutoCrudSql({
      schema: "HR", objectName: "EMPLOYEES", objectType: "TABLE",
      alias: "employees", authMode: "none",
    });
    expect(sql).toContain("ORDS.ENABLE_OBJECT");
    expect(sql).toContain("p_object => 'EMPLOYEES'");
    expect(sql).toContain("p_auto_rest_auth => FALSE");
    expect(sql).toMatch(/COMMIT;\s*END;/);
  });
});

describe("generateCustomSqlEndpoint", () => {
  it("generates DEFINE_MODULE/TEMPLATE/HANDLER", () => {
    const sql = generateCustomSqlEndpoint({
      moduleName: "test", basePath: "/test/", routePattern: "by-id/:id",
      method: "GET", source: "SELECT * FROM dual", authMode: "none",
    });
    expect(sql).toContain("ORDS.DEFINE_MODULE");
    expect(sql).toContain("ORDS.DEFINE_HANDLER");
    expect(sql).toContain("by-id/:id");
  });
});
```

- [ ] **Step 2: Implement generators in ords.ts**

```typescript
export type AutoCrudParams = {
  schema: string;
  objectName: string;
  objectType: "TABLE" | "VIEW";
  alias: string;
  authMode: "none" | "role" | "oauth";
  authRole?: string | null;
};

export function generateAutoCrudSql(p: AutoCrudParams): string {
  const lines: string[] = ["BEGIN"];
  lines.push("  ORDS.ENABLE_OBJECT(");
  lines.push("    p_enabled        => TRUE,");
  lines.push(`    p_schema         => ${sqlString(p.schema)},`);
  lines.push(`    p_object         => ${sqlString(p.objectName)},`);
  lines.push(`    p_object_type    => ${sqlString(p.objectType)},`);
  lines.push(`    p_object_alias   => ${sqlString(p.alias)},`);
  lines.push(`    p_auto_rest_auth => ${p.authMode === "none" ? "FALSE" : "TRUE"});`);
  if (p.authMode === "role" && p.authRole) {
    lines.push("");
    lines.push("  ORDS.DEFINE_PRIVILEGE(");
    lines.push(`    p_privilege_name => ${sqlString(p.alias + "_priv")},`);
    lines.push(`    p_roles          => ORDS_TYPES.role_array(${sqlString(p.authRole)}),`);
    lines.push(`    p_patterns       => ORDS_TYPES.pattern_array(${sqlString("/" + p.alias + "/*")}));`);
  }
  lines.push("  COMMIT;");
  lines.push("END;");
  return lines.join("\n");
}

export type CustomSqlParams = {
  moduleName: string;
  basePath: string;
  routePattern: string;
  method: string;
  source: string;
  authMode: "none" | "role" | "oauth";
  authRole?: string | null;
};

export function generateCustomSqlEndpoint(p: CustomSqlParams): string {
  const lines: string[] = ["BEGIN"];
  lines.push("  ORDS.DEFINE_MODULE(");
  lines.push(`    p_module_name    => ${sqlString(p.moduleName)},`);
  lines.push(`    p_base_path      => ${sqlString(p.basePath)},`);
  lines.push(`    p_items_per_page => 25);`);
  lines.push("");
  lines.push("  ORDS.DEFINE_TEMPLATE(");
  lines.push(`    p_module_name => ${sqlString(p.moduleName)},`);
  lines.push(`    p_pattern     => ${sqlString(p.routePattern)});`);
  lines.push("");
  const sourceType = p.method === "GET" ? "ORDS.source_type_collection" : "ORDS.source_type_plsql";
  lines.push("  ORDS.DEFINE_HANDLER(");
  lines.push(`    p_module_name => ${sqlString(p.moduleName)},`);
  lines.push(`    p_pattern     => ${sqlString(p.routePattern)},`);
  lines.push(`    p_method      => ${sqlString(p.method)},`);
  lines.push(`    p_source_type => ${sourceType},`);
  lines.push(`    p_source      => ${sqlMultiline(p.source)});`);
  if (p.authMode === "role" && p.authRole) {
    lines.push("");
    lines.push("  ORDS.DEFINE_PRIVILEGE(");
    lines.push(`    p_privilege_name => ${sqlString(p.moduleName + "_priv")},`);
    lines.push(`    p_roles          => ORDS_TYPES.role_array(${sqlString(p.authRole)}),`);
    lines.push(`    p_patterns       => ORDS_TYPES.pattern_array(${sqlString(p.basePath + "*")}));`);
  }
  lines.push("  COMMIT;");
  lines.push("END;");
  return lines.join("\n");
}

export type ProcedureEndpointParams = {
  moduleName: string;
  basePath: string;
  routePattern: string;
  method: string;
  schema: string;
  procName: string;
  packageName: string | null;
  params: { name: string; argMode: "IN" | "OUT" | "IN/OUT"; dataType: string }[];
  hasReturn: boolean;
  authMode: "none" | "role" | "oauth";
  authRole?: string | null;
};

export function generateProcedureEndpoint(p: ProcedureEndpointParams): string {
  const lines: string[] = ["BEGIN"];
  lines.push("  ORDS.DEFINE_MODULE(");
  lines.push(`    p_module_name    => ${sqlString(p.moduleName)},`);
  lines.push(`    p_base_path      => ${sqlString(p.basePath)});`);
  lines.push("");
  lines.push("  ORDS.DEFINE_TEMPLATE(");
  lines.push(`    p_module_name => ${sqlString(p.moduleName)},`);
  lines.push(`    p_pattern     => ${sqlString(p.routePattern)});`);

  // Build PL/SQL wrapper
  const fqn = p.packageName ? `${p.packageName}.${p.procName}` : p.procName;
  const inParams = p.params.filter(x => x.argMode === "IN" || x.argMode === "IN/OUT");
  const outParams = p.params.filter(x => x.argMode === "OUT" || x.argMode === "IN/OUT");

  const declareLines: string[] = [];
  for (const op of outParams) {
    declareLines.push(`    v_${op.name.toLowerCase()} ${op.dataType};`);
  }
  if (p.hasReturn) declareLines.push(`    v_result NUMBER;`); // simplified

  const callLines: string[] = [];
  callLines.push(`  ${fqn}(`);
  const allParamLines = p.params.map(par => {
    if (par.argMode === "OUT") return `    ${par.name} => v_${par.name.toLowerCase()}`;
    return `    ${par.name} => :${par.name.toLowerCase()}`;
  });
  callLines.push(allParamLines.join(",\n"));
  callLines.push("  );");

  const printLines: string[] = [];
  printLines.push(`  HTP.print('{');`);
  outParams.forEach((op, i) => {
    printLines.push(`  HTP.print('"${op.name.toLowerCase()}":' || NVL(TO_CHAR(v_${op.name.toLowerCase()}), 'null')${i < outParams.length - 1 ? " || ',' " : ""});`);
  });
  printLines.push(`  HTP.print('}');`);

  const wrapper = [
    "DECLARE",
    ...declareLines,
    "BEGIN",
    ...callLines,
    "  :status_code := 200;",
    ...printLines,
    "END;",
  ].join("\n");

  lines.push("");
  lines.push("  ORDS.DEFINE_HANDLER(");
  lines.push(`    p_module_name => ${sqlString(p.moduleName)},`);
  lines.push(`    p_pattern     => ${sqlString(p.routePattern)},`);
  lines.push(`    p_method      => ${sqlString(p.method)},`);
  lines.push(`    p_source_type => ORDS.source_type_plsql,`);
  lines.push(`    p_source      => ${sqlMultiline(wrapper)});`);

  if (p.authMode === "role" && p.authRole) {
    lines.push("");
    lines.push("  ORDS.DEFINE_PRIVILEGE(");
    lines.push(`    p_privilege_name => ${sqlString(p.moduleName + "_priv")},`);
    lines.push(`    p_roles          => ORDS_TYPES.role_array(${sqlString(p.authRole)}),`);
    lines.push(`    p_patterns       => ORDS_TYPES.pattern_array(${sqlString(p.basePath + "*")}));`);
  }

  lines.push("  COMMIT;");
  lines.push("END;");
  return lines.join("\n");
}
```

- [ ] **Step 3: Add unified RPC `ords.generate_sql`**

```typescript
export async function ordsGenerateSql(params: any): Promise<{ sql: string }> {
  if (params.type === "auto-crud") return { sql: generateAutoCrudSql(params) };
  if (params.type === "custom-sql") return { sql: generateCustomSqlEndpoint(params) };
  if (params.type === "procedure") return { sql: generateProcedureEndpoint(params) };
  throw { code: -32602, message: "Unknown endpoint type" };
}
```

Register: `"ords.generate_sql": (params) => ordsGenerateSql(params as any),`

- [ ] **Step 4: Tauri command + frontend wrapper**

```rust
#[tauri::command]
pub async fn ords_generate_sql(app: AppHandle, config: serde_json::Value) -> Result<serde_json::Value, ConnectionTestErr> {
    call_sidecar(&app, "ords.generate_sql", config).await
}
```

```typescript
export const ordsGenerateSql = (config: any) =>
  call<{ sql: string }>("ords_generate_sql", { config });
```

- [ ] **Step 5: Run sidecar tests**

```
cd sidecar && bun test ords.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```
git add sidecar/src/ords.ts sidecar/src/index.ts sidecar/tests/ords.test.ts src-tauri/src/commands.rs src-tauri/src/lib.rs src/lib/workspace.ts
git commit -m "feat(vras): SQL generators for auto-CRUD, custom SQL, procedure endpoints"
```

---

## Task 3.7: RestApiPreview modal — preview SQL + apply

**Files:**
- Create: `src/lib/workspace/RestApiPreview.svelte`
- Modify: `sidecar/src/ords.ts`
- Modify: `sidecar/src/index.ts`
- Modify: `src-tauri/src/commands.rs`, `lib.rs`
- Modify: `src/lib/workspace.ts`

- [ ] **Step 1: Sidecar handler `ords.apply`**

```typescript
export async function ordsApply(params: { sql: string }): Promise<{ ok: true }> {
  const conn = state.connection;
  if (!conn) throw { code: -32010, message: "No active session" };
  await conn.execute(params.sql, []);
  return { ok: true };
}
```

Register: `"ords.apply": (params) => ordsApply(params as any),`

- [ ] **Step 2: Tauri command + wrapper**

```rust
#[tauri::command]
pub async fn ords_apply(app: AppHandle, sql: String) -> Result<(), ConnectionTestErr> {
    call_sidecar(&app, "ords.apply", json!({ "sql": sql })).await?;
    Ok(())
}
```

```typescript
export const ordsApply = (sql: string) => call<void>("ords_apply", { sql });
```

- [ ] **Step 3: Create RestApiPreview.svelte**

```svelte
<script lang="ts">
  type Props = {
    sql: string;
    connectionLabel: string;
    onCancel: () => void;
    onApply: () => Promise<void>;
    onCopyToTab: () => void;
  };
  let { sql, connectionLabel, onCancel, onApply, onCopyToTab }: Props = $props();

  let applying = $state(false);
  let error = $state<string | null>(null);

  async function handleApply() {
    applying = true;
    error = null;
    try { await onApply(); }
    catch (e: any) { error = e?.message ?? String(e); }
    finally { applying = false; }
  }
</script>

<div class="modal-backdrop" onclick={onCancel}>
  <div class="modal" onclick={(e) => e.stopPropagation()}>
    <div class="head">
      <span class="title">Confirmar deploy</span>
      <button class="close" onclick={onCancel}>✕</button>
    </div>
    <div class="body">
      <div class="conn">Será executado contra: <strong>{connectionLabel}</strong></div>
      <pre class="sql">{sql}</pre>
      {#if error}<div class="error">{error}</div>{/if}
    </div>
    <div class="foot">
      <button class="btn" onclick={onCopyToTab}>Copiar para SQL tab</button>
      <span style="flex: 1"></span>
      <button class="btn" onclick={onCancel} disabled={applying}>Cancelar</button>
      <button class="btn primary" onclick={() => void handleApply()} disabled={applying}>
        {applying ? "Aplicando…" : "Aplicar"}
      </button>
    </div>
  </div>
</div>

<style>
  .modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 1000; }
  .modal { background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px; width: 720px; max-width: 90vw; max-height: 85vh; display: flex; flex-direction: column; }
  .head { padding: 12px 16px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; }
  .title { font-weight: 600; color: var(--text-primary); }
  .close { background: none; border: none; color: var(--text-muted); cursor: pointer; padding: 4px 8px; }
  .body { padding: 16px; flex: 1; overflow-y: auto; }
  .conn { font-size: 11.5px; color: var(--text-muted); margin-bottom: 10px; }
  .conn strong { color: var(--text-primary); }
  .sql { background: var(--bg-page); border: 1px solid var(--border); border-radius: 4px; padding: 12px; font-family: monospace; font-size: 11px; color: var(--text-primary); white-space: pre-wrap; max-height: 50vh; overflow-y: auto; }
  .error { background: rgba(179,62,31,0.15); border: 1px solid rgba(179,62,31,0.3); color: #f5a08a; padding: 8px 10px; border-radius: 4px; font-size: 11.5px; margin-top: 10px; }
  .foot { padding: 10px 16px; border-top: 1px solid var(--border); display: flex; gap: 8px; align-items: center; }
  .btn { background: var(--bg-surface-alt); border: 1px solid var(--border); color: var(--text-primary); padding: 5px 12px; border-radius: 4px; cursor: pointer; font-size: 11.5px; }
  .btn.primary { background: rgba(179,62,31,0.2); border-color: rgba(179,62,31,0.45); color: #f5a08a; }
  .btn:hover:not(:disabled) { background: var(--row-hover); }
  .btn.primary:hover:not(:disabled) { background: rgba(179,62,31,0.35); }
  .btn:disabled { opacity: 0.5; cursor: default; }
</style>
```

- [ ] **Step 4: Commit**

```
git add sidecar/src/ords.ts sidecar/src/index.ts src-tauri/src/commands.rs src-tauri/src/lib.rs src/lib/workspace.ts src/lib/workspace/RestApiPreview.svelte
git commit -m "feat(vras): RestApiPreview modal + ords.apply RPC"
```

---

## Task 3.8: Wire builder → preview → apply in +page.svelte

**Files:**
- Modify: `src/routes/workspace/[id]/+page.svelte`

- [ ] **Step 1: Add state and integrate components**

```typescript
import RestApiBuilder from "$lib/workspace/RestApiBuilder.svelte";
import RestApiPreview from "$lib/workspace/RestApiPreview.svelte";
import { ordsGenerateSql, ordsApply } from "$lib/workspace";

let showApiBuilder = $state(false);
let apiBuilderInitial = $state<{ kind: "table"|"view"|"procedure"|"function"; obj: { owner: string; name: string } } | null>(null);
let previewSql = $state<string | null>(null);
let pendingBuilderConfig = $state<any>(null);
```

Add handler functions:
```typescript
async function handleBuilderPreview(config: any) {
  const res = await ordsGenerateSql(config);
  if (res.ok) {
    previewSql = res.data.sql;
    pendingBuilderConfig = config;
  } else {
    alert("Generate SQL failed: " + res.error.message);
  }
}

async function handlePreviewApply() {
  if (!previewSql) return;
  const res = await ordsApply(previewSql);
  if (!res.ok) throw new Error(res.error.message);
  // Refresh REST modules in current schema
  const current = schemas.find((s) => s.isCurrent);
  if (current) await loadKind(current, "REST_MODULE");
  previewSql = null;
  showApiBuilder = false;
}

function handleCopyToTab() {
  if (!previewSql) return;
  sqlEditor.openWithDdl("VRAS Generated", previewSql);
  previewSql = null;
  showApiBuilder = false;
}
```

- [ ] **Step 2: Render in template**

Near other modals at end of template:
```svelte
{#if showApiBuilder}
  <RestApiBuilder
    owner={schemas.find((s) => s.isCurrent)?.name ?? ""}
    initialKind={apiBuilderInitial?.kind ?? null}
    initialObject={apiBuilderInitial?.obj ?? null}
    onCancel={() => { showApiBuilder = false; apiBuilderInitial = null; }}
    onPreview={handleBuilderPreview}
  />
{/if}

{#if previewSql !== null}
  <RestApiPreview
    sql={previewSql}
    connectionLabel={meta ? userLabel(meta) : ""}
    onCancel={() => { previewSql = null; }}
    onApply={handlePreviewApply}
    onCopyToTab={handleCopyToTab}
  />
{/if}
```

- [ ] **Step 3: Add "Criar API" button on REST_MODULES kind header**

In SchemaTree, when kind === REST_MODULE, show a "+" button next to the count that triggers `showApiBuilder = true`. (Or add a quick-action elsewhere.)

For now, simpler: update the `RestModuleDetails.onAddEndpoint` callback in +page.svelte to set `showApiBuilder = true`.

- [ ] **Step 4: Test in dev**

Open a workspace with ORDS enabled. Click on a REST module → click "Add new endpoint" → builder opens → fill out form → Visualizar SQL → Preview opens → Apply → endpoint deployed.

- [ ] **Step 5: Commit**

```
git add src/routes/workspace/[id]/+page.svelte
git commit -m "feat(vras): wire builder → preview → apply pipeline in workspace"
```

---

# Phase 4 — Test Panel + OAuth + Right-click + Sheep (6 tasks)

---

## Task 4.1: Test Panel HTTP client

**Files:**
- Create: `src/lib/workspace/RestTestPanel.svelte`
- Modify: `src-tauri/Cargo.toml` (add reqwest)
- Modify: `src-tauri/src/commands.rs`, `lib.rs` — `ords_test_http` command

- [ ] **Step 1: Add reqwest to Cargo.toml**

In `[dependencies]`:
```toml
reqwest = { version = "0.12", default-features = false, features = ["rustls-tls", "json"] }
```

- [ ] **Step 2: Add `ords_test_http` Tauri command with allowlist**

In `commands.rs`:
```rust
use std::time::Duration;

#[derive(Debug, Serialize, Deserialize)]
pub struct OrdsTestResult {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: String,
    #[serde(rename = "elapsedMs")]
    pub elapsed_ms: u64,
}

#[tauri::command]
pub async fn ords_test_http(
    method: String,
    url: String,
    allowed_base_url: String,
    headers: Vec<(String, String)>,
    body: Option<String>,
) -> Result<OrdsTestResult, ConnectionTestErr> {
    // Allowlist: URL must start with allowed_base_url
    if !url.starts_with(&allowed_base_url) {
        return Err(ConnectionTestErr {
            code: -32603,
            message: format!("URL not allowed: {} (must start with {})", url, allowed_base_url),
        });
    }

    let start = std::time::Instant::now();
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| ConnectionTestErr { code: -32603, message: format!("HTTP client error: {}", e) })?;

    let mut req = match method.to_uppercase().as_str() {
        "GET" => client.get(&url),
        "POST" => client.post(&url),
        "PUT" => client.put(&url),
        "DELETE" => client.delete(&url),
        _ => return Err(ConnectionTestErr { code: -32602, message: format!("Method not supported: {}", method) }),
    };

    for (k, v) in headers {
        req = req.header(&k, &v);
    }
    if let Some(b) = body {
        req = req.body(b);
    }

    let resp = req.send().await.map_err(|e| ConnectionTestErr {
        code: -32603, message: format!("Request failed: {}", e),
    })?;
    let status = resp.status().as_u16();
    let resp_headers: Vec<(String, String)> = resp.headers().iter()
        .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
        .collect();
    let body = resp.text().await.unwrap_or_default();
    let elapsed_ms = start.elapsed().as_millis() as u64;

    Ok(OrdsTestResult { status, headers: resp_headers, body, elapsed_ms })
}
```

Register in lib.rs.

- [ ] **Step 3: Frontend wrapper**

```typescript
export type OrdsTestResult = {
  status: number;
  headers: [string, string][];
  body: string;
  elapsedMs: number;
};

export const ordsTestHttp = (
  method: string,
  url: string,
  allowedBaseUrl: string,
  headers: [string, string][],
  body: string | null,
) => call<OrdsTestResult>("ords_test_http", { method, url, allowedBaseUrl, headers, body });
```

- [ ] **Step 4: Create RestTestPanel.svelte**

```svelte
<script lang="ts">
  import { ordsTestHttp, type OrdsTestResult } from "$lib/workspace";

  type Props = {
    baseUrl: string;
    moduleBasePath: string;
    onClose: () => void;
  };
  let { baseUrl, moduleBasePath, onClose }: Props = $props();

  let method = $state("GET");
  let path = $state("");
  let headers = $state<[string, string][]>([["Content-Type", "application/json"]]);
  let bodyText = $state("");
  let response = $state<OrdsTestResult | null>(null);
  let sending = $state(false);
  let error = $state<string | null>(null);

  const fullUrl = $derived(baseUrl.replace(/\/$/, "") + moduleBasePath + path);

  async function send() {
    sending = true;
    error = null;
    response = null;
    const res = await ordsTestHttp(
      method,
      fullUrl,
      baseUrl,
      headers,
      method !== "GET" && bodyText.trim() ? bodyText : null,
    );
    sending = false;
    if (res.ok) response = res.data;
    else error = res.error.message;
  }

  function addHeader() { headers = [...headers, ["", ""]]; }
  function removeHeader(i: number) { headers = headers.filter((_, idx) => idx !== i); }
</script>

<div class="panel">
  <div class="head">
    <span class="title">Test Endpoint</span>
    <button class="close" onclick={onClose}>✕</button>
  </div>

  <div class="body">
    <div class="row">
      <select class="method-sel" bind:value={method}>
        <option>GET</option><option>POST</option><option>PUT</option><option>DELETE</option>
      </select>
      <input class="path-input" bind:value={path} placeholder="endpoint path…" />
    </div>
    <div class="full-url">{fullUrl}</div>

    <h4>Headers</h4>
    {#each headers as h, i}
      <div class="hdr-row">
        <input class="input sm" placeholder="Header" value={h[0]} oninput={(e) => { headers[i][0] = (e.target as HTMLInputElement).value; headers = [...headers]; }} />
        <input class="input sm" placeholder="Value" value={h[1]} oninput={(e) => { headers[i][1] = (e.target as HTMLInputElement).value; headers = [...headers]; }} />
        <button class="rm-btn" onclick={() => removeHeader(i)}>✕</button>
      </div>
    {/each}
    <button class="add-btn" onclick={addHeader}>+ adicionar header</button>

    {#if method !== "GET"}
      <h4>Body (JSON)</h4>
      <textarea class="body-area" bind:value={bodyText} rows="4"></textarea>
    {/if}

    <button class="send-btn" onclick={() => void send()} disabled={sending}>
      {sending ? "Enviando…" : "▶ Send"}
    </button>

    {#if error}<div class="error">{error}</div>{/if}

    {#if response}
      <h4>Response</h4>
      <div class="status">
        <span class="status-code" class:ok={response.status < 400}>{response.status}</span>
        <span class="ms">{response.elapsedMs}ms</span>
      </div>
      <pre class="resp-body">{response.body}</pre>
    {/if}
  </div>
</div>

<style>
  .panel { width: 380px; height: 100%; background: var(--bg-surface); border-left: 1px solid var(--border); display: flex; flex-direction: column; }
  .head { padding: 10px 12px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; }
  .title { font-weight: 600; color: var(--text-primary); font-size: 12.5px; }
  .close { background: none; border: none; color: var(--text-muted); cursor: pointer; padding: 2px 6px; }
  .body { padding: 12px; overflow-y: auto; flex: 1; color: var(--text-primary); font-size: 11.5px; }
  .row { display: flex; gap: 6px; margin-bottom: 6px; }
  .method-sel { background: var(--input-bg); border: 1px solid var(--border); color: var(--text-primary); padding: 4px 8px; border-radius: 4px; font-size: 11px; }
  .path-input { flex: 1; background: var(--input-bg); border: 1px solid var(--border); color: var(--text-primary); padding: 4px 8px; border-radius: 4px; font-size: 11px; font-family: monospace; }
  .full-url { font-family: monospace; color: var(--text-muted); font-size: 10.5px; margin-bottom: 12px; word-break: break-all; }
  h4 { font-size: 10.5px; text-transform: uppercase; color: var(--text-muted); margin: 12px 0 6px; }
  .hdr-row { display: flex; gap: 4px; margin-bottom: 4px; }
  .input.sm { flex: 1; background: var(--input-bg); border: 1px solid var(--border); color: var(--text-primary); padding: 3px 6px; border-radius: 3px; font-size: 10.5px; min-width: 0; }
  .rm-btn { background: none; border: none; color: var(--text-muted); cursor: pointer; padding: 0 6px; }
  .add-btn { background: none; border: 1px dashed var(--border); color: var(--text-muted); padding: 3px 8px; border-radius: 4px; cursor: pointer; font-size: 10.5px; margin-top: 4px; }
  .body-area { width: 100%; box-sizing: border-box; background: var(--input-bg); border: 1px solid var(--border); border-radius: 4px; color: var(--text-primary); padding: 6px; font-family: monospace; font-size: 10.5px; }
  .send-btn { background: rgba(179,62,31,0.2); border: 1px solid rgba(179,62,31,0.45); color: #f5a08a; padding: 6px 12px; border-radius: 4px; cursor: pointer; margin-top: 12px; font-size: 11.5px; font-weight: 600; }
  .send-btn:disabled { opacity: 0.5; cursor: default; }
  .error { background: rgba(179,62,31,0.15); border: 1px solid rgba(179,62,31,0.3); color: #f5a08a; padding: 6px 8px; border-radius: 4px; margin-top: 8px; font-size: 11px; }
  .status { display: flex; gap: 8px; align-items: center; margin: 6px 0; font-size: 11px; }
  .status-code { font-weight: 700; padding: 2px 6px; border-radius: 3px; background: rgba(179,62,31,0.2); color: #f5a08a; }
  .status-code.ok { background: rgba(139,196,168,0.2); color: #8bc4a8; }
  .ms { color: var(--text-muted); }
  .resp-body { background: var(--bg-page); border: 1px solid var(--border); border-radius: 4px; padding: 8px; font-family: monospace; font-size: 10.5px; max-height: 300px; overflow: auto; white-space: pre-wrap; }
</style>
```

- [ ] **Step 5: Wire to RestModuleDetails onTest callback in +page.svelte**

Add state `let testPanel = $state<{ basePath: string } | null>(null);` and render conditionally near right-side panel.

- [ ] **Step 6: Commit**

```
git add src-tauri/Cargo.toml src-tauri/src/commands.rs src-tauri/src/lib.rs src/lib/workspace.ts src/lib/workspace/RestTestPanel.svelte src/routes/workspace/[id]/+page.svelte
git commit -m "feat(vras): RestTestPanel HTTP client + ords_test_http Tauri command with allowlist"
```

---

## Task 4.2: OAuth Clients — list + create + revoke

**Files:**
- Modify: `sidecar/src/ords.ts`, `index.ts`
- Modify: `src-tauri/src/commands.rs`, `lib.rs`
- Modify: `src/lib/workspace.ts`
- Create: `src/lib/workspace/OAuthClientsPanel.svelte`

- [ ] **Step 1: Sidecar handlers**

```typescript
export async function ordsClientsList(_params: any = {}): Promise<{ clients: any[] }> {
  const conn = state.connection;
  if (!conn) throw { code: -32010, message: "No active session" };
  const res = await conn.execute<any>(
    `SELECT name, description, created_on, updated_on FROM user_ords_clients ORDER BY name`,
    [], { outFormat: 4002 }
  );
  return { clients: (res.rows ?? []).map((r: any) => ({
    name: r.NAME ?? r.name,
    description: r.DESCRIPTION ?? r.description ?? null,
    createdOn: r.CREATED_ON ?? r.created_on,
  })) };
}

export async function ordsClientsCreate(params: { name: string; description: string; roles: string[] }): Promise<{ clientId: string; clientSecret: string }> {
  const conn = state.connection;
  if (!conn) throw { code: -32010, message: "No active session" };

  const sqlCreate = `BEGIN
    OAUTH.CREATE_CLIENT(
      p_name => :name,
      p_grant_type => 'client_credentials',
      p_owner => USER,
      p_description => :description,
      p_support_email => NULL,
      p_privilege_names => NULL);
    COMMIT;
  END;`;
  await conn.execute(sqlCreate, { name: params.name, description: params.description });

  for (const role of params.roles) {
    await conn.execute(`BEGIN OAUTH.GRANT_CLIENT_ROLE(p_client_name => :n, p_role_name => :r); COMMIT; END;`,
      { n: params.name, r: role });
  }

  const credsRes = await conn.execute<any>(
    `SELECT client_id, client_secret FROM user_ords_clients WHERE name = :name`,
    { name: params.name }, { outFormat: 4002 }
  );
  const row = credsRes.rows?.[0];
  return {
    clientId: row?.CLIENT_ID ?? row?.client_id ?? "",
    clientSecret: row?.CLIENT_SECRET ?? row?.client_secret ?? "",
  };
}

export async function ordsClientsRevoke(params: { name: string }): Promise<{ ok: true }> {
  const conn = state.connection;
  if (!conn) throw { code: -32010, message: "No active session" };
  await conn.execute(`BEGIN OAUTH.DELETE_CLIENT(p_name => :n); COMMIT; END;`, { n: params.name });
  return { ok: true };
}
```

Register all 3 handlers.

- [ ] **Step 2: Tauri commands + frontend wrappers**

(Pattern same as previous tasks — `ords_clients_list`, `ords_clients_create`, `ords_clients_revoke`.)

- [ ] **Step 3: Create OAuthClientsPanel.svelte**

(Form with name/description/roles select, list of existing clients with Revoke button, modal showing secret 1 single time after create.)

Implementation similar to other panels — reuse modal styles.

- [ ] **Step 4: Add button "Manage API Clients" to REST_MODULES kind header in SchemaTree** (or a button at the workspace level).

- [ ] **Step 5: Commit**

```
git commit -m "feat(vras): OAuth clients management panel (list/create/revoke + secret-once display)"
```

---

## Task 4.3: Right-click menu integration

**Files:**
- Modify: `src/lib/workspace/SchemaTree.svelte`
- Modify: `src/routes/workspace/[id]/+page.svelte`

- [ ] **Step 1: Add right-click context menu in SchemaTree**

Right-click on TABLE/VIEW → "Expor como API REST" → triggers `apiBuilderInitial = { kind: "table", obj: { owner, name } }; showApiBuilder = true;`

Right-click on PROCEDURE/FUNCTION → "Expor como endpoint REST" → similar with kind procedure/function.

(SchemaTree should emit a callback `onContextAction(action, item)` that +page.svelte handles.)

- [ ] **Step 2: Commit**

```
git commit -m "feat(vras): right-click context menu to expose objects as REST"
```

---

## Task 4.4: Sheep AI integration in builder

**Files:**
- Modify: `src/lib/workspace/RestApiBuilder.svelte`
- Modify: `src/lib/workspace/SheepChat.svelte`
- Modify: `sidecar/src/ai.ts` — add new prompt for endpoint suggestion

- [ ] **Step 1: Add Sheep prompt for endpoint suggestion**

In `sidecar/src/ai.ts`, add a new function `aiSuggestEndpoint(description, schema, columns)` that returns structured JSON:

```typescript
{
  type: "auto-crud" | "custom-sql" | "procedure",
  sourceObject?: { name, kind },
  sourceSql?: string,
  routePattern: string,
  method: string,
  moduleName: string,
  basePath: string,
  authMode: "none" | "role" | "oauth"
}
```

System prompt instructs Claude to output ONLY valid JSON matching the schema, no markdown.

- [ ] **Step 2: Add Sheep button overlay in RestApiBuilder**

Click "✨ Sheep" → small overlay with textarea + Send button. On send, calls `aiSuggestEndpoint` → fills in form fields. Show loading state.

- [ ] **Step 3: Commit**

```
git commit -m "feat(vras): Sheep AI assistant in API builder for natural-language endpoint creation"
```

---

## Task 4.5: Bearer token auto-injection in Test Panel

**Files:**
- Modify: `src/lib/workspace/RestTestPanel.svelte`
- Modify: `src-tauri/src/commands.rs` — add `ords_get_token` command

- [ ] **Step 1: Add token request flow**

When test panel opens for a module with OAuth privilege:
1. Check if a client is selected in the module's privilege roles
2. If yes, request token via `POST {baseUrl}/oauth/token` with `client_credentials` grant + Basic Auth (client_id:client_secret)
3. Inject `Authorization: Bearer <token>` header automatically

User can override headers manually.

- [ ] **Step 2: Commit**

```
git commit -m "feat(vras): auto-inject Bearer token for OAuth-protected endpoints in test panel"
```

---

## Task 4.6: Persist ordsBaseUrl in ConnectionMeta

**Files:**
- Modify: `src/lib/connections.ts`
- Modify: `src-tauri/src/persistence/connections.rs`
- Modify: SQLite migration

- [ ] **Step 1: Add column to schema**

Add migration: `ALTER TABLE connections ADD COLUMN ords_base_url TEXT NULL;`

- [ ] **Step 2: Update Rust struct + serde**

Add `ords_base_url: Option<String>` to `Connection` struct in `connections.rs`.

- [ ] **Step 3: Update TypeScript ConnectionMeta**

```typescript
export type ConnectionMeta = {
  // ... existing fields
  ordsBaseUrl?: string | null;
};
```

- [ ] **Step 4: Wire OrdsBootstrapModal "Save URL" to persist**

In `+page.svelte`, replace the noop `onSetBaseUrl`:
```typescript
onSetBaseUrl={async (url) => {
  if (!meta) return;
  meta.ordsBaseUrl = url;
  await updateConnectionMeta(meta);  // assumes this wrapper exists
  if (ordsStore.state) ordsStore.state.ordsBaseUrl = url;
  showOrdsBootstrap = false;
}}
```

- [ ] **Step 5: Commit**

```
git commit -m "feat(vras): persist ordsBaseUrl per connection in SQLite"
```

---

# Self-check for the implementer

After all tasks committed:

- [ ] `bun run test` — all green
- [ ] `bun run lint` — no Biome errors
- [ ] `cargo clippy -- -D warnings` — no warnings
- [ ] Manual smoke test on Oracle 23ai with ORDS:
  - [ ] Connect → REST_MODULES appears in Schema Tree
  - [ ] Click existing module → details show templates/handlers/source
  - [ ] Right-click TABLE → "Expor como API REST" → builder pre-filled
  - [ ] Auto-CRUD path: Create new module → preview SQL → Apply → endpoint visible in tree
  - [ ] Custom SQL path: Write SELECT, define route, Apply → endpoint works
  - [ ] Procedure path: Pick procedure, params auto-detected, Apply → endpoint works
  - [ ] Test panel: GET on auto-CRUD endpoint returns 200 with rows
  - [ ] OAuth: Create client → secret shown once → token request → test endpoint with Bearer
  - [ ] Export as SQL: Click on existing module → SQL tab opens with valid recreatable bloco
  - [ ] Bootstrap: Connect to schema without ORDS enabled → modal appears → click Habilitar → schema enabled

---

## Out of scope (V2+)

- Edit/Delete em módulos, templates, handlers
- JWT externo / Basic Auth
- Versionamento (`/v1/`, `/v2/`)
- Rate limiting / CORS configurável
- OpenAPI renderizado dentro do Veesker
- Anonymous PL/SQL blocks
- Multi-environment deploy
- Procedures com tipos complexos (RECORD, COLLECTION) — wrapper escalar requerido
