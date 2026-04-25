# Veesker — Validation Inventory (2026-04-25)

## Open core repo: `gevianajr/veesker`, branch main, commit 1b91f95

## Scale
- Frontend: 43 Svelte components + 40 TS files + 15 test files
- Sidecar: 13 TS files, 4382 LOC (oracle.ts is largest at 1595 LOC)
- Rust shell: 13 files, 3406 LOC (commands.rs is largest at 1003 LOC)
- Total: ~7800 LOC application code

## Frontend structure
- Routes: /, /connections/{new,[id]/edit}, /workspace/[id]
- Workspace components (44): SqlEditor/Drawer, SchemaTree, SheepChat (AI), VectorScatter, ResultGrid, ExecutionLog, ExplainPlan, DmlConfirmModal, DebugToolbar/Locals/CallStack/etc, RestApiBuilder/Preview/TestPanel/ModuleDetails, OrdsBootstrapModal, OAuthClientsPanel, CommercialUseModal, PluginManagerPanel, UpdateNotification, HelpModal, SecurityDisclaimerModal, ChartWidget, DashboardTab, etc
- Stores: dashboard, debug, license, ords, sql-editor, theme — all Svelte 5 runes
- CodeMirror 6 ecosystem: state/view/commands/lang-sql/theme-one-dark/minimap

## Sidecar (Bun + node-oracledb Thin)
- Files: ai (Anthropic), chart, debug (PL/SQL debugger via DBMS_DEBUG_JDWP), embedding, errors, handlers, index (RPC entry), oracle (everything DB), ords (REST API generator), rpc, sql-splitter, state, scripts/populate_vectors

## Rust shell (Tauri 2)
- commands.rs (1003 LOC), lib.rs, main.rs, sidecar.rs, tray.rs
- persistence/: connections, history, secrets, store, tnsnames, wallet, connection_config
- Capabilities: shell sidecar, fs scoped to $DOCUMENT/$DESKTOP/$DOWNLOAD, dialog, updater, process, opener
- CSP: strict — only ipc + api.anthropic.com + localhost:1420 in connect-src

## Plugins enabled
- updater (with pubkey embedded)
- process (for restart after update)
- shell (sidecar)
- dialog, fs, opener
- Auto-updater endpoint: github.com/gevianajr/veesker/releases/latest/download/latest.json

## Test files (15 total)
- src/lib/csv-export.test.ts
- src/lib/help-progress.test.ts
- src/lib/sql-safety.test.ts
- src/lib/sql-splitter.test.ts
- src/lib/stores/dashboard.test.ts
- src/lib/stores/sql-editor.test.ts
- src/lib/stores/theme.test.ts
- src/lib/workspace/ChartWidget.test.ts
- src/lib/workspace/ExecutionLog.test.ts
- src/lib/workspace/ObjectDetails.test.ts
- src/lib/workspace/QueryHistory.test.ts
- src/lib/workspace/ResultGrid.test.ts
- src/lib/workspace/SqlDrawer.test.ts
- src/lib/workspace/SqlEditor.test.ts
- src/lib/workspace/StatusBar.test.ts

## Initial findings (before phase 2 starts)
- **F1: License mismatch** — package.json says `"license": "MIT"` but LICENSE file is Apache 2.0. Needs fix.
- **F2: Updater endpoint and CSP** correctly point to gevianajr (commit 1b91f95).
- Dependencies look mainstream (no obvious red flags), versions specific.

