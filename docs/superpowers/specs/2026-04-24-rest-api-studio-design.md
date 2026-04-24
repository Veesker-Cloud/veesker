# Veesker REST API Studio — Design Spec

**Goal:** Permitir que usuários do Veesker exponham tabelas, views, queries SQL e procedures Oracle como APIs REST consumíveis, gerando configuração nativa do Oracle ORDS (REST Data Services) via UI guiada — sem deixar o IDE.

**Status:** Brainstorm aprovado em 2026-04-24. Pendente: spec self-review, user review, plano de implementação.

---

## Contexto e motivação

PL/SQL Developer e SQL Developer não têm UI moderna pra ORDS. Quem precisa expor lógica Oracle como API REST hoje:
- Escreve as `ORDS.DEFINE_*` calls à mão (verboso, propenso a erro)
- Usa Oracle APEX (overhead de outro produto)
- Reescreve a lógica num backend Node/Java/Python (duplicação)

O Veesker já tem conexão Oracle ativa, schema introspection, SQL editor e UI integrada com IA (Sheep). Adicionar uma camada de criação visual de APIs ORDS aproveita 100% da infra existente e fecha o ciclo: do dado → ao consumo.

**Persona alvo:** Senior Oracle developer/DBA em ambiente corporativo (EBS, financeiro, ERP) que já tem ORDS na infra e quer expor lógica existente sem virar engenheiro de backend.

---

## Decisões locked (8 perguntas do brainstorm)

| # | Tópico | Decisão |
|---|---|---|
| 1 | Escopo V1 | **Auto-CRUD em tabelas/views + endpoints customizados** (SQL queries e procedures). Sem auth avançada/rate limit/versionamento no V1. |
| 2 | UX de criação | **Builder visual + atalho Sheep AI**. Form determinístico é o caminho primário; botão "Sugerir com IA" pré-preenche campos via chat. Usuário sempre revisa final. |
| 3 | Modo de aplicação | **Híbrido: Preview SQL + Apply direto / Copy escape**. Modal mostra o bloco PL/SQL gerado; usuário escolhe entre executar via conexão ou copiar pra SQL tab e rodar manualmente. |
| 4 | Lifecycle V1 + UI | **Create + Read, integrado no Schema Tree**. Novo kind "REST MODULES" ao lado de TABLES/VIEWS. V1 lê de `USER_ORDS_*` e cria novos módulos. Edit/Delete vão pro V2. |
| 5 | Auth suportado V1 | **NONE + Roles do banco + OAuth 2.0 Client Credentials**. Cobre uso interno (roles) e integrações externas (OAuth). JWT externo e Basic Auth ficam pra V2. |
| 6 | Fontes de endpoints customizados | **SQL queries + Procedures/Functions existentes**. Anonymous PL/SQL blocks ficam fora — quem quiser wrappa numa procedure descartável. |
| 7 | Detecção do ORDS | **Detecta automaticamente, guia se faltar algo**. Modal de bootstrap mostra exatamente o que falta (instalação, schema enable, privilégio, base URL) e oferece ação 1-clique quando possível. |
| 8 | Testing/docs | **Testing inline + link Swagger nativo**. Painel HTTP client embutido pra testar endpoints; documentação via Swagger UI nativo do ORDS aberto no browser externo. |

---

## Arquitetura geral

```
┌─────────────────────────────────────────────────────────────┐
│  Frontend (Svelte 5)                                        │
│                                                             │
│  Schema Tree              REST Module Details   API Builder │
│  └─ SCHEMAS               └─ Module hierarchy   (modal)     │
│     └─ HR                    ├─ Templates       ├─ Source   │
│        ├─ TABLES             ├─ Handlers        ├─ Route    │
│        ├─ VIEWS              ├─ Privileges      ├─ Method   │
│        ├─ PROCEDURES         └─ Test/Docs/      ├─ Auth     │
│        └─ REST MODULES (NEW)    Export SQL      └─ Sheep    │
└─────────────────────────────────────────────────────────────┘
                           │
                  Tauri invoke / JSON-RPC
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Bun Sidecar — sidecar/src/ords.ts (NEW)                    │
│                                                             │
│  ords.detect          → checa instalação, versão, schema    │
│  ords.modules.list    → lê USER_ORDS_MODULES                │
│  ords.module.get      → lê hierarquia completa de 1 módulo  │
│  ords.generateSql     → gera bloco PL/SQL (auto-CRUD/custom)│
│  ords.apply           → executa o bloco PL/SQL              │
│  ords.exportSql       → reverse-engineering de módulo       │
│  ords.clients.list    → lê USER_ORDS_CLIENTS          │
│  ords.clients.create  → OAUTH.CREATE_CLIENT                 │
└─────────────────────────────────────────────────────────────┘
                           │
                     node-oracledb
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Oracle Database                                            │
│  Read: USER_ORDS_SCHEMAS, _MODULES, _TEMPLATES, _HANDLERS,  │
│        _PRIVILEGES, _ROLES, _OAUTH_CLIENTS                  │
│  Write: ORDS.* package + OAUTH.* package                    │
└─────────────────────────────────────────────────────────────┘

Test Panel: HTTP fetch via Tauri command (contorna CSP do WebView).
```

### Princípios

- **ORDS é a fonte da verdade.** Veesker não duplica metadata local. Cada refresh lê das `USER_ORDS_*` views.
- **Sidecar não é HTTP server.** Não vamos abrir porta no Bun — só emite SQL e faz fetch HTTP pra testes.
- **Apply só funciona com privilégio.** Sem `ORDS_ADMINISTRATOR_ROLE`, Veesker mostra GRANT necessário pro DBA.
- **Single COMMIT atômico.** Cada apply é 1 único `BEGIN ... COMMIT; END;` — Oracle dá rollback automático em caso de falha.

---

## UX flow detalhado

### Primeira vez na conexão

Em paralelo com `schemaList()`/`objectsList()`, sidecar roda `ords.detect`:

```jsonc
{
  "installed": true,           // ORDS package presente
  "version": "23.4.2",
  "currentSchemaEnabled": true, // schema atual em USER_ORDS_SCHEMAS
  "hasAdminRole": true,         // privilégio para fazer apply
  "ordsBaseUrl": "https://server:8443/ords"  // de ORDS_METADATA.ORDS_PROPERTIES
}
```

Se algum check falha, o nó "REST MODULES" no Schema Tree fica disabled. Clicar abre modal apropriado:

| Estado | Modal |
|---|---|
| `installed: false` | "ORDS não instalado neste banco. Peça ao DBA: `@$ORACLE_HOME/ords/install.sql`" + link doc Oracle |
| `currentSchemaEnabled: false` | "Schema `XPTO` não está habilitado. **[Habilitar agora]** ou copiar SQL" |
| `hasAdminRole: false` | "Você precisa do role `ORDS_ADMINISTRATOR_ROLE`. Comando para o DBA: `GRANT ORDS_ADMINISTRATOR_ROLE TO XPTO;`" |
| `ordsBaseUrl: null` | Input manual ("Qual a URL do servidor ORDS?") salva em `ConnectionMeta.ordsBaseUrl` |

`ordsBaseUrl` é derivado de `ORDS_METADATA.ORDS_PROPERTIES` (keys `protocol`, `host`, `port`, `api.prefix`). Caso queries falhem (proxy reverso, etc.), pede manualmente.

### Schema Tree — novo kind REST_MODULE

```
HR (current)
├─ TABLES (87)
├─ VIEWS (12)
├─ PROCEDURES (34)
├─ FUNCTIONS (9)
├─ PACKAGES (5)
└─ REST MODULES (3)         ← novo, mesmo padrão dos outros kinds
   ├─ vendas-api
   ├─ relatorios-publicos
   └─ admin-internal
```

Clicar abre **REST Module Details** no painel direito (mesma área de `ObjectDetails` para tabelas hoje).

### REST Module Details (read-only V1)

```
┌────────────────────────────────────────────────────────┐
│  📦 vendas-api                         [Test] [Docs↗] │
│  Base: /vendas/  ·  Status: PUBLISHED                  │
│  Auth: OAuth 2.0 (privilege 'sales_api_priv')          │
│                                                        │
│  ┌──────────────────────────────────────────────────┐ │
│  │ Templates (2)                                    │ │
│  │                                                  │ │
│  │ ▸ /by-year/:year                                 │ │
│  │   ├ GET   SQL    [view source ▾]                │ │
│  │   └ POST  PROC   VENDAS_PKG.create_sale          │ │
│  │                                                  │ │
│  │ ▸ /summary                                       │ │
│  │   └ GET   SQL    [view source ▾]                │ │
│  └──────────────────────────────────────────────────┘ │
│                                                        │
│  Privileges (1)        Full URL:                      │
│  • sales_api_priv      .../ords/HR/vendas/...   [📋] │
│                                                        │
│  [Export as SQL]  [Add new endpoint to this module]   │
└────────────────────────────────────────────────────────┘
```

Cada handler tem `[view source ▾]` que expande inline com syntax highlighting (CodeMirror em modo read-only — reutiliza componente existente).

### API Builder (modal)

Acionado por:
- Botão "Criar API" no header de REST MODULES
- "Add new endpoint to this module" dentro de Module Details
- Right-click em TABLE/VIEW → "Expor como API REST" (atalho auto-CRUD)
- Right-click em PROCEDURE/FUNCTION → "Expor como endpoint REST"

```
┌─────────────────────────────────────────────────────────────────┐
│  Criar Endpoint REST                              [✨ Sheep] [✕] │
├─────────────────────────────────────────────────────────────────┤
│  Tipo:  ◉ Auto-CRUD (tabela/view)   ○ Custom SQL   ○ Procedure │
│                                                                 │
│  ── Source ─────────────────────────────────────────────────── │
│  Tabela/View:  [▼ EMPLOYEES                                  ] │
│  Operações:    ☑ GET  ☑ POST  ☑ PUT  ☑ DELETE  ☑ GET by id   │
│                                                                 │
│  ── Roteamento ────────────────────────────────────────────── │
│  Módulo:       ◉ Novo: [hr-employees-api    ]                  │
│                ○ Existente: [▼ vendas-api ]                    │
│  Base path:    [/employees/ ]                                   │
│                                                                 │
│  ── Auth ─────────────────────────────────────────────────── │
│  ○ Público (sem auth)                                          │
│  ◉ Role do banco:    [▼ HR_API_RO ] (existente)               │
│  ○ OAuth 2.0:        [+ Criar privilégio + role + client]     │
│                                                                 │
│  ── Preview da URL ──────────────────────────────────────── │
│  GET    .../ords/HR/employees/         (lista)                │
│  GET    .../ords/HR/employees/:id/     (detalhe)              │
│  POST   .../ords/HR/employees/         (criar)                │
│  ...                                                          │
│                                                                 │
│                                  [Cancelar]  [Visualizar SQL→] │
└─────────────────────────────────────────────────────────────────┘
```

**Variações por tipo:**
- **Auto-CRUD** → checkboxes de operações; URL deduzida do nome da tabela
- **Custom SQL** → CodeMirror pra escrever SELECT/DML; bind variables (`:year`, `:id`) auto-detectadas; path params (`/foo/:year`) → bind `:year` esperado
- **Procedure** → dropdown de procedure (ou pré-selecionada via right-click); IN/OUT params autodetectados; mapeamento default IN→body/query, OUT→response JSON, REF CURSOR→array

**✨ Sheep button:** overlay no builder com input de descrição livre. Sheep responde preenchendo os campos via JSON estruturado (não texto livre). Usuário sempre revisa antes de confirmar.

Exemplo:
> Usuário: "API que lista funcionários ativos do departamento, ordenado por salário"
>
> Sheep preenche:
> - Tipo: Custom SQL
> - SQL: `SELECT ... WHERE status='A' AND department_id = :dept ORDER BY salary DESC`
> - Path: `/active-by-dept/:dept`
> - Method: GET

### Preview SQL + Apply

Ao clicar "Visualizar SQL →":

```
┌─────────────────────────────────────────────────────────────┐
│  Confirmar deploy                                       [✕] │
├─────────────────────────────────────────────────────────────┤
│  Será executado contra: HR @ oracle-prod-01:1521/ORCLPDB    │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐  │
│  │ BEGIN                                                │  │
│  │   ORDS.DEFINE_MODULE(                               │  │
│  │     p_module_name    => 'hr-employees-api', ...     │  │
│  │   ORDS.DEFINE_TEMPLATE(...);                        │  │
│  │   ORDS.DEFINE_HANDLER(...);                         │  │
│  │   COMMIT;                                            │  │
│  │ END;                                                 │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                             │
│  ⚠ Vai criar 4 endpoints, 1 privilégio, e fazer COMMIT.    │
│                                                             │
│         [Copiar para SQL tab]   [Cancelar]   [Aplicar]     │
└─────────────────────────────────────────────────────────────┘
```

- **Aplicar** → sidecar executa; sucesso → fecha modal, refresh do Schema Tree, abre Module Details + Test panel automaticamente
- **Copiar para SQL tab** → `sqlEditor.openWithDdl()` (já existe); usuário roda manualmente
- **Cancelar** → volta pro builder

### Test Panel (lateral, slide-in)

```
┌──────────────────────────────────┐
│  Test Endpoint              [✕]  │
├──────────────────────────────────┤
│  [▼ GET /vendas/by-year/:year ]  │
│                                  │
│  URL:                            │
│  https://server/ords/HR/vendas/  │
│  by-year/[2025  ]                │
│                                  │
│  Headers:                        │
│  Authorization: Bearer eyJ... ✓  │
│  Content-Type: application/json  │
│  [+ adicionar header]            │
│                                  │
│  Body (JSON):     [só pra POST]  │
│  ┌────────────────────────────┐ │
│  │ { ... }                    │ │
│  └────────────────────────────┘ │
│                                  │
│  [▶ Send]                        │
│                                  │
│  ── Response ──────────────────  │
│  200 OK · 142ms · 4.2 KB         │
│  ┌────────────────────────────┐ │
│  │ {                          │ │
│  │   "items": [...]           │ │
│  │ }                          │ │
│  └────────────────────────────┘ │
└──────────────────────────────────┘
```

**Auto-injection do Bearer:** se o módulo tem privilege OAuth, Veesker pega um client existente (ou pede pra criar/escolher), faz internamente o token request via `client_credentials` grant, e injeta no header.

### OAuth Clients Panel

Acessível por: REST MODULES → "Manage API Clients".

```
┌──────────────────────────────────────────────────────┐
│  API Clients (OAuth 2.0)            [+ Novo Client] │
├──────────────────────────────────────────────────────┤
│  Name           Roles assigned    Created            │
│  ──────────────────────────────────────────────────  │
│  mobile-app     sales_api_role    2026-04-20         │
│                              [Regenerar] [Revogar]   │
│                                                      │
│  partner-x      vendas_ro         2026-03-12         │
│                              [Regenerar] [Revogar]   │
└──────────────────────────────────────────────────────┘
```

**Criar novo client:** modal com nome, descrição, roles. Após criar, **mostra o secret 1 única vez** com botão de copiar e aviso "Salve agora — não conseguiremos mostrar de novo." Veesker NÃO armazena o secret.

---

## Modelo de dados

### Leitura — Dictionary Views

Veesker faz queries paralelas pra montar a hierarquia. Cache em memória por conexão, invalidado em refresh manual ou após apply.

| Endpoint UI | Query principal |
|---|---|
| Lista de módulos no Schema Tree | `SELECT name, base_path, status FROM user_ords_modules` |
| Detalhes de 1 módulo | `SELECT t.uri_template, h.method, h.source_type, h.source FROM user_ords_templates t LEFT JOIN user_ords_handlers h ON h.template_id = t.id WHERE t.module_name = :module` |
| OAuth clients | `SELECT name, description, created_on FROM user_ords_clients` |
| Roles disponíveis | `SELECT role FROM user_ords_roles` |
| Privileges aplicados | `SELECT name, roles FROM user_ords_privileges` |

### Escrita — ORDS API package

Veesker NUNCA escreve direto em `USER_ORDS_*` (são views). Toda mudança vai por:
- `ORDS.DEFINE_MODULE` / `DEFINE_TEMPLATE` / `DEFINE_HANDLER`
- `ORDS.DEFINE_PRIVILEGE` / `CREATE_ROLE`
- `OAUTH.CREATE_CLIENT` / `GRANT_CLIENT_ROLE`
- `ORDS.ENABLE_OBJECT` (auto-CRUD)
- `ORDS.DELETE_MODULE` (V2)

### Local storage Veesker

**Nada novo no SQLite.** Toda config vive no Oracle. Exceções:
- `ConnectionMeta.ordsBaseUrl: string | null` — cache pra não detectar toda vez
- `localStorage["veesker.rest.last_test_payload.<connId>.<endpointId>"]` — último payload do Test Panel (UX nicety)

---

## Geração de SQL — templates

### Auto-CRUD (tabela/view)

```sql
BEGIN
  ORDS.ENABLE_OBJECT(
    p_enabled        => TRUE,
    p_schema         => 'HR',
    p_object         => 'EMPLOYEES',
    p_object_type    => 'TABLE',
    p_object_alias   => 'employees',
    p_auto_rest_auth => TRUE);
  COMMIT;
END;
```

Auth:
- NONE: `p_auto_rest_auth => FALSE`
- Role do banco: gera `ORDS.DEFINE_PRIVILEGE` adicional
- OAuth: `DEFINE_PRIVILEGE` com role mapeada a OAuth client

### Custom SQL endpoint

```sql
BEGIN
  ORDS.DEFINE_MODULE(
    p_module_name    => 'vendas-api',
    p_base_path      => '/vendas/',
    p_items_per_page => 25);

  ORDS.DEFINE_TEMPLATE(
    p_module_name => 'vendas-api',
    p_pattern     => 'by-year/:year');

  ORDS.DEFINE_HANDLER(
    p_module_name => 'vendas-api',
    p_pattern     => 'by-year/:year',
    p_method      => 'GET',
    p_source_type => ORDS.source_type_collection,
    p_source      => 'SELECT mes, SUM(total) FROM vendas
                      WHERE EXTRACT(YEAR FROM data) = :year
                      GROUP BY mes ORDER BY mes');
  COMMIT;
END;
```

Detecção de path params: regex em cima da rota — `:foo` na URL → bind `:foo` esperado no SQL.

### Procedure endpoint

Veesker introspecta os params (lógica reutilizada de `ProcExecModal`):

```sql
ORDS.DEFINE_HANDLER(
  p_module_name => 'vendas-api',
  p_pattern     => '/',
  p_method      => 'POST',
  p_source_type => ORDS.source_type_plsql,
  p_source      => '
    DECLARE
      v_id NUMBER;
    BEGIN
      VENDAS_PKG.create_sale(
        p_customer_id => :customer_id,
        p_amount      => :amount,
        p_id_out      => v_id);
      :status_code := 201;
      HTP.print(''{"id":'' || v_id || ''}'');
    END;');
```

Mapeamento de tipos:

| PL/SQL | REST |
|---|---|
| `IN` param | `:nome` no body JSON (POST/PUT) ou query string (GET) |
| `OUT` param | Adicionado ao response JSON |
| `IN OUT` param | Body input + response output |
| `RETURN VALUE` (function) | Response JSON `{ "result": ... }` |
| `SYS_REFCURSOR OUT` | Response JSON array (consume + serialize via `APEX_JSON.write` ou `JSON_OBJECT_T`) |

### OAuth Client + Role + Privilege

```sql
BEGIN
  ORDS.CREATE_ROLE(p_role_name => 'sales_api_role');

  ORDS.DEFINE_PRIVILEGE(
    p_privilege_name => 'sales_api_priv',
    p_roles          => ORDS_TYPES.role_array('sales_api_role'),
    p_patterns       => ORDS_TYPES.pattern_array('/vendas/*'));

  OAUTH.CREATE_CLIENT(
    p_name        => 'mobile-app',
    p_grant_type  => 'client_credentials',
    p_owner       => 'HR',
    p_description => 'Mobile sales app');

  OAUTH.GRANT_CLIENT_ROLE(
    p_client_name => 'mobile-app',
    p_role_name   => 'sales_api_role');
  COMMIT;
END;
```

Após apply, query separada recupera o `client_secret` (gerado nesse momento) → modal "Salve agora".

### Export as SQL (reverse-engineering)

Lê `USER_ORDS_*` views e gera bloco PL/SQL equivalente:
1. `DEFINE_MODULE` baseado em `USER_ORDS_MODULES`
2. Pra cada template: `DEFINE_TEMPLATE`
3. Pra cada handler: `DEFINE_HANDLER` com source de `USER_ORDS_HANDLERS.SOURCE` (CLOB)
4. Privileges: `DEFINE_PRIVILEGE` baseado em `USER_ORDS_PRIVILEGES`
5. NÃO inclui clients OAuth (secrets não são recuperáveis)

Output vai pra novo SQL tab com header:
```sql
-- Generated by Veesker on 2026-04-24
-- Module: vendas-api
-- Source: HR @ oracle-prod-01:1521
```

---

## Detecção, errors e edge cases

### Matriz de detecção

| Check | Query | Falha → ação |
|---|---|---|
| ORDS instalado | `SELECT 1 FROM all_objects WHERE owner='ORDS' AND object_name='ORDS'` | Modal "ORDS não instalado, contate DBA" |
| Schema enabled | `SELECT 1 FROM user_ords_schemas` | Modal com botão "Habilitar agora" |
| Privilégio | `SELECT 1 FROM session_privs WHERE privilege LIKE '%ORDS%'` (ou dry-run) | Mostra GRANT pro DBA |
| ORDS base URL | `SELECT value FROM ords_metadata.ords_properties WHERE name='security.host.url'` | Pede ao usuário, salva em `ConnectionMeta` |

Detecção roda em paralelo com bootstrap normal — não atrasa abertura. Resultado em `connection.ordsState` (store).

### Error handling no apply

- Captura `ORA-XXXXX` do erro
- Mostra modal com: linha aproximada do bloco, mensagem original Oracle, sugestão se for erro conhecido (ex: `ORA-20100: object alias already exists` → "Esse alias já está em uso. Mude o nome do módulo")
- Estado do banco: como tudo está em 1 único `BEGIN...END;` com 1 único `COMMIT;` no final, Oracle dá rollback automático em caso de falha

### Edge cases mapeados

| Caso | Tratamento |
|---|---|
| Procedure com tipo complexo (RECORD, COLLECTION) | V1 não suporta — warning no builder: "Esta procedure tem parâmetro `XPTO%ROWTYPE` que não pode ser exposto automaticamente. Crie um wrapper escalar." |
| Procedure com SYS_REFCURSOR | Suportado — handler PL/SQL itera e serializa via `APEX_JSON.write` |
| Tabela sem PK | Auto-CRUD funciona, mas `GET /:id` desabilitado — alerta no builder |
| Módulo com mesmo nome | Validação no builder antes de submeter (query `USER_ORDS_MODULES`) → "já existe, escolha outro nome ou edite (V2)" |
| Conexão perdida durante apply | Usa requestId pattern existente — `cancelActive()` funciona; rollback automático |
| ORDS versão < 19c | Detect retorna versão; abaixo de 19c → warning "Algumas features podem não funcionar." |
| URL externa atrás de proxy reverso | `ordsBaseUrl` editável a qualquer momento (botão "Configurar" no header REST MODULES) |
| Test panel com SSL self-signed | Tauri command `ords_test_http` aceita flag `acceptInvalidCerts` (apenas em dev mode da app — não em prod build) |

### Segurança

- `client_secret` **nunca** armazenado pelo Veesker — mostrado 1x ao gerar, responsabilidade do usuário
- Tauri command `ords_test_http` com allowlist: só aceita URLs do `<ordsBaseUrl>/*` da conexão atual (previne SSRF)
- Apply não passa pelo `DmlConfirmModal` existente — o próprio Preview SQL serve de confirmação (evita fricção dupla)
- Cada apply é loggado no `audit_logs` existente — rastreável

---

## Arquivos novos / modificados

```
sidecar/src/
  ords.ts                          NEW  — RPC handlers + SQL generators
  ords.test.ts                     NEW  — Bun tests (geração de SQL, parsing)
  index.ts                         MOD  — registrar handlers ords.*
  oracle.ts                        MOD  — possível helper pra ORDS reads

src-tauri/src/
  commands.rs                      MOD  — adicionar ords_test_http command
                                          (allowlist por ordsBaseUrl)

src/lib/workspace/
  RestModuleDetails.svelte         NEW  — painel de detalhes de módulo
  RestApiBuilder.svelte            NEW  — modal de criação
  RestApiPreview.svelte            NEW  — modal preview SQL + apply
  RestTestPanel.svelte             NEW  — painel HTTP client lateral
  OAuthClientsPanel.svelte         NEW  — gerenciador de clients
  OrdsBootstrapModal.svelte        NEW  — modais de detect/enable
  SchemaTree.svelte                MOD  — adicionar kind REST_MODULE
  SheepChat.svelte                 MOD  — handler de intent "criar endpoint"
  workspace.ts                     MOD  — RPC wrappers ords.*

src/lib/stores/
  ords.svelte.ts                   NEW  — store de detect state + cache

src/routes/workspace/[id]/
  +page.svelte                     MOD  — fetch ords.detect no bootstrap
```

**Estimativa rough:** 25-30 tasks distribuídas em 4 fases:
1. Detect + Bootstrap (bootstrap modal, schema enable, ordsBaseUrl)
2. Read existing (Schema Tree integration, Module Details, Export SQL)
3. Create new (Builder visual, Preview, Apply, Auto-CRUD + Custom SQL + Procedure)
4. Test Panel + OAuth Clients

Tamanho similar ao PL/SQL Debugger (já implementado).

---

## Out of scope para V1 (deixar registrado pra V2+)

- **Edit/Delete** de módulos, templates, handlers, privileges, clients
- **JWT externo** e Basic Auth como auth schemes
- **Versionamento** de módulos (`/v1/`, `/v2/`)
- **Rate limiting** configurável
- **CORS headers** customizáveis
- **OpenAPI/Swagger** renderizado dentro do Veesker (continuamos linkando pro nativo)
- **Anonymous PL/SQL blocks** como source type
- **Multi-environment deploy** (dev → hml → prod com 1 clique) — usuário usa Export SQL e roda manualmente
- **Procedures com tipos complexos** (RECORD, COLLECTION) — pede wrapper escalar
- **Documentação inline** dos endpoints (descrições, exemplos de request/response)

---

## Naming

**Veesker REST API Studio** — mencionado nas conversas; nome final pendente de confirmação do usuário.

Alternativas consideradas: "API Builder", "REST Designer", "ORDS Studio".

---

## Próximos passos

1. ⬜ Spec self-review (próxima etapa imediata)
2. ⬜ User review do spec escrito
3. ⬜ Plano de implementação (writing-plans skill) com tasks step-by-step
4. ⬜ Execução do plano (subagent-driven-development)

**Quando entra no roadmap:** decisão pendente do usuário entre:
- (A) Logo após PL/SQL Debugger terminar e antes do executável Windows/macOS
- (B) Depois do executável (V0.1 distribuído primeiro)
- (C) Como Fase E do roadmap (depois de Fase D — Oracle avançado)
