# Veesker Plugin Loader — Design Spec

**Goal:** Add a plugin loading mechanism to the open-source Veesker IDE so that signed plugin bundles can extend the application at runtime, without requiring source-code modification.

**Status:** Implementation starting 2026-04-25.

## Context

The plugin loader is part of the open-source codebase. Anyone (free or paid) can write a plugin against the Plugin API in `src/lib/plugins.ts`. The marketplace will offer paid plugins — but the loading mechanism itself is open. This is the same boundary as Docker (the daemon is open, Docker Desktop is paid) and VS Code (the editor is open, extensions can be free or paid).

## Bundle format

A plugin is distributed as a `.veesker` file: a ZIP archive with this structure:

```
my-plugin.veesker
├── manifest.json           Required — plugin metadata
├── plugin.js               Required — entry point (UMD or ES module)
├── icon.png                Optional — 64x64 plugin icon
├── README.md               Optional — shown in plugin manager
├── LICENSE                 Optional — third-party license
└── signatures/
    ├── manifest.sig         Required — Ed25519 sig of manifest.json
    └── plugin.sig           Required — Ed25519 sig of plugin.js
```

### `manifest.json`

```jsonc
{
  "id": "audit-shipper",                                      // unique, kebab-case
  "name": "Audit Log Shipper",                                // display name
  "version": "1.0.0",                                         // semver
  "author": "Veesker Inc",                                    // string
  "description": "Ship audit logs to Splunk/Datadog/S3",
  "publisher": "veesker",                                     // matches signing key
  "minVeeskerVersion": "0.2.0",                               // required core version
  "permissions": [                                            // declare what plugin needs
    "network",                                                // make HTTPS requests
    "audit-read",                                             // read audit log entries
    "settings"                                                // store its own settings
  ],
  "extensionPoints": [                                        // what hooks it uses
    "audit-destination"
  ],
  "license": {
    "required": true,                                         // gated behind license
    "validator": "veesker-license-server"                     // who issued
  }
}
```

### Signing

Each plugin is signed by the publisher with their Ed25519 key. The Veesker desktop app ships with the public keys of trusted publishers (initially just `veesker` itself) under `src-tauri/src/plugins/trusted_keys.rs`.

For third-party plugins (after marketplace launches), users will install publisher keys via the plugin manager UI or trust an entire marketplace via a single root key.

## Loading flow

```
App startup
    │
    ▼
┌─────────────────────────────────────────────┐
│ Scan plugin directory                       │
│   Win:  %LocalAppData%\Veesker\plugins\     │
│   Mac:  ~/Library/Application Support/      │
│         Veesker/plugins/                    │
│   Linux: ~/.local/share/Veesker/plugins/    │
└─────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────┐
│ For each .veesker file:                     │
│   1. Extract to temp dir                    │
│   2. Verify manifest.json signature         │
│   3. Verify plugin.js signature             │
│   4. Check minVeeskerVersion compatibility  │
│   5. Validate license JWT (if required)     │
│   6. Check user has accepted permissions    │
└─────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────┐
│ Load plugin.js as ES module                 │
│ Call plugin.register(api)                   │
│ Plugin uses api to register hooks           │
└─────────────────────────────────────────────┘
```

## API surface exposed to plugins

A plugin's `register()` function receives:

```typescript
interface VeeskerPluginAPI {
  version: string;                              // host version
  
  // From src/lib/plugins.ts:
  registerAuthProvider(p: ConnectionAuthProvider): void;
  registerAiProvider(p: AiChatProvider): void;
  registerObjectAction(a: ObjectAction): void;
  registerAuditDestination(d: AuditDestination): void;
  registerGatedFeature(f: GatedFeature): void;
  
  // Settings storage scoped to this plugin
  settings: {
    get<T>(key: string, default?: T): T | undefined;
    set<T>(key: string, value: T): void;
    delete(key: string): void;
  };
  
  // Network — only available if 'network' permission granted
  fetch(url: string, init?: RequestInit): Promise<Response>;
  
  // Logging — surfaces in the plugin manager
  log: {
    info(msg: string): void;
    warn(msg: string): void;
    error(msg: string): void;
  };
}
```

## License validation (for paid plugins)

If `manifest.json.license.required` is true, the plugin requires a valid license JWT.

**License JWT structure** (signed with Veesker license server's RSA key):

```jsonc
{
  "header": { "alg": "RS256", "kid": "veesker-license-1" },
  "payload": {
    "iss": "veesker-license-server",
    "iat": 1714000000,
    "exp": 1745536000,                      // expiration
    "sub": "ACME Corp",                     // customer
    "plugin": "audit-shipper",              // which plugin
    "seats": 25,                            // optional: seat limit
    "license_id": "uuid-...",               // for revocation
    "fingerprint": "sha256-of-machine"      // optional bind
  }
}
```

The license file (`license.veesker`) is the JWT plus a header indicating which plugin it's for. User imports it via Settings → Plugins → "Import license."

License validation is **offline** — the desktop app verifies the JWT against the embedded RSA public key. No phone-home. Revocation is handled at next plugin update (a revocation list ships with each new core release).

## Permissions model

Plugin permissions are user-acknowledged at first activation. A plugin requesting `network` cannot make HTTP calls until the user explicitly grants permission via a dialog. Permissions are persistent per plugin.

Available permissions:
- `network` — `fetch()` to arbitrary HTTPS URLs
- `audit-read` — receive audit log entries via `registerAuditDestination`
- `settings` — store/read settings (always granted; no separate gate)
- `connection-extend` — register custom auth providers (high-trust)
- `ai-extend` — register AI chat providers (high-trust)
- `object-action` — register right-click actions on schema objects
- `filesystem-read` — read user-selected files (for import wizards)

If a plugin requires a permission and the user declines, the plugin's relevant features are unavailable but the plugin still loads. The plugin should detect this gracefully.

## UX

### Plugin manager

New section in workspace settings:

- List of installed plugins (icon, name, version, status: enabled/disabled/license expired)
- Toggle on/off
- View permissions
- View license info (if applicable)
- Install plugin (drag a `.veesker` file)
- Import license (drag a `.veesker.license` file)
- Uninstall

### First-launch plugin permissions dialog

When a plugin requests permissions:

```
┌────────────────────────────────────────────┐
│  Audit Log Shipper wants to:               │
│                                            │
│  ⚠ Make network requests to external URLs  │
│  📋 Read audit log entries                 │
│                                            │
│  These permissions allow the plugin to     │
│  send your query history to a third-party  │
│  service that you configure.               │
│                                            │
│  Source: Veesker Inc (verified publisher)  │
│                                            │
│           [ Cancel ]  [ Grant access ]     │
└────────────────────────────────────────────┘
```

## File map

```
src-tauri/src/plugins/
├── mod.rs                  Module entrypoint, scanning, loading orchestration
├── bundle.rs               .veesker ZIP extraction + signature verification
├── manifest.rs             Manifest parsing + validation
├── trusted_keys.rs         Hardcoded trusted publisher Ed25519 keys
├── license.rs              JWT validation against embedded RSA pubkey
└── permissions.rs          Permissions storage + UI bridge

src-tauri/src/commands.rs   New commands: plugins_list, plugin_install, plugin_uninstall, plugin_grant, license_import

src/lib/plugins.ts          (already exists) Plugin API definitions
src/lib/plugins/loader.ts   (NEW) Frontend loader: fetches plugin info from Tauri, instantiates JS modules
src/lib/stores/plugins.svelte.ts  (NEW) Plugin state store

src/lib/workspace/PluginManagerPanel.svelte  (NEW) Settings UI for plugins
src/lib/workspace/PluginPermissionsDialog.svelte  (NEW) Permission grant dialog
```

## Out of scope for this iteration

- Marketplace integration (manual plugin install only at first)
- Plugin auto-update (user re-installs new versions manually)
- Plugin sandboxing beyond permission gates (plugins run in main JS context — only signed publishers are trusted)
- Third-party publisher key management (only "veesker" publisher accepted initially)
