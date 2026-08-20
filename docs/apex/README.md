# Veesker APEX Studio

Veesker APEX Studio is the read-only APEX-aware layer planned for `v0.6.0 - APEX Studio`.
It extends the existing schema browser and SQL editor instead of replacing Oracle APEX Builder.

## Scope

- Detect Oracle APEX on connection open through `APEX_RELEASE`.
- Hide the APEX node when APEX is not installed or the connected user cannot read the `APEX_*` dictionary views.
- Browse workspaces, applications, pages, and page components lazily from APEX dictionary views.
- Extract SQL and PL/SQL source into the existing SQL editor with a provenance header.
- Detect APEX bind variables such as `:P10_ITEM` and `:APP_USER` and generate commented substitution hints.

APEX Studio is read-only in this release. It does not create, edit, import, export, or deploy APEX applications.

## Detection

The sidecar exposes `apex_detect`, backed by the `apex.detect` JSON-RPC method.

Detection order:

1. Query `SELECT version_no FROM apex_release`.
2. If that is unavailable, check `ALL_OBJECTS` for `APEX_RELEASE`.
3. If APEX appears installed, test read access to `APEX_WORKSPACES`.

If APEX is absent, unsupported, or inaccessible, the UI should omit the APEX tree without warnings.

## Version Support

| APEX version | Status | Behavior |
|---|---:|---|
| `< 19.2` | Unsupported | Do not show APEX Studio. |
| `19.2` | Supported | Show only views/columns present in the capability map. |
| `21.x` | Supported | Missing newer views degrade silently. |
| `22.x` | Supported | Missing newer views degrade silently. |
| `23.x` | Supported | Full baseline tree expected. |
| `24.x` | Supported | Full baseline tree expected. |

The capability map is version-aware. A missing view or column should hide that branch or property instead of failing the entire tree.

## Visibility Matrix

| Connected user privilege | APEX node | Notes |
|---|---:|---|
| No APEX installed | Hidden | `APEX_RELEASE` is not visible. |
| APEX installed, no grants on `APEX_*` views | Hidden | Avoid noisy errors in locked-down client environments. |
| Workspace-associated developer | Visible | `APEX_*` views already filter visible workspaces/apps. |
| Instance/admin-level visibility | Visible | More workspaces may appear because Oracle grants expose them. |

Users often ask why a workspace is missing. The short answer is that Oracle's APEX dictionary views enforce workspace visibility for the connected account.

## Planned Tree

```text
APEX (<version>)
  Workspaces
    <workspace>
      Applications
        <app id - name>
          Pages
            <p10 - name>
              Regions
              Items
              Processes
              Computations
              Validations
              Dynamic Actions
          LOVs
          Authorization Schemes
      REST Modules
```

`REST Modules` should reuse the existing VRAS/ORDS module browser where possible.

## Source Extraction

Initial extraction sources:

| Component | View | Column |
|---|---|---|
| Region source | `APEX_APPLICATION_PAGE_REGIONS` | `REGION_SOURCE` |
| Page processes | `APEX_APPLICATION_PAGE_PROC` | `PROCESS_SOURCE` |
| Computations | `APEX_APPLICATION_PAGE_COMP` | `COMPUTATION` |
| Validations | `APEX_APPLICATION_PAGE_VAL` | `VALIDATION_EXPRESSION1`, `VALIDATION_EXPRESSION2` |
| Dynamic action server code | `APEX_APPLICATION_PAGE_DA_ACTS` | `ATTRIBUTE_01` |
| LOV queries | `APEX_APPLICATION_LOVS` | `LIST_OF_VALUES_QUERY` |

Every editor extract must start with a provenance block:

```sql
-- Veesker APEX Studio - read-only extract
-- App 100 - Page 10 - Region "Pending Orders"
-- Source: APEX_APPLICATION_PAGE_REGIONS.REGION_SOURCE
-- Extracted: 2026-08-18 09:20 -03 - APEX 24.2 - conn: DEV
-- APEX binds detected. Replace values before running outside APEX:
-- DEFINE P10_STATUS = '<value>'
```

## Release Checklist

- `v0.6.0 - APEX Studio` tag and narrative release notes.
- Screenshots showing APEX browsing and SQL extraction.
- `/docs/apex` linked from the README and website docs.
- Blog article titled around APEX tuning without leaving the IDE.
- Website comparison table updated with `APEX-aware browsing/extraction`.
