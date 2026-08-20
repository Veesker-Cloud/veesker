# HANDOFF_APEX_STUDIO_V0_6

Use this handoff name with the next agent:

```text
HANDOFF_APEX_STUDIO_V0_6
```

Repository checkout:

```text
C:\Users\geefa\Documents\B2DEVTECH\veesker-community-edition
```

Branch/state:

```text
main at cd17b20
No commit made.
No push made.
Changes are local working-tree changes only.
```

Source spec:

```text
C:\Users\geefa\Downloads\veesker-apex-studio-v0.6-spec.md
```

## Implemented So Far

- APEX detection foundation:
  - `sidecar/src/apex.ts`
  - `apex.detect` JSON-RPC handler in `sidecar/src/index.ts`
  - `apex_detect` Tauri command in `src-tauri/src/commands.rs`
  - frontend wrapper/types in `src/lib/workspace.ts`

- APEX utility layer:
  - `sidecar/src/apex-utils.ts`
  - version comparison
  - capability map
  - APEX bind detection
  - provenance header builder for extracted SQL/PLSQL

- APEX Explorer base list RPCs:
  - `apex.workspaces.list`
  - `apex.applications.list`
  - `apex.pages.list`
  - Tauri command wrappers
  - frontend wrappers

- Workspace open integration:
  - `workspace_open` now preserves `user` and `serviceName`.
  - `workspace_open` attaches optional `apex` metadata from `apex.detect`.
  - APEX detection failure is silent so workspace open is not blocked.

- UI:
  - `src/lib/workspace/SchemaTree.svelte` renders an `APEX (<version>)` root when installed/supported/accessible.
  - Workspaces -> Applications -> Pages lazy-load in the existing schema tree.
  - `src/routes/workspace/[id]/+page.svelte` passes `info?.apex` into `SchemaTree`.

- Docs:
  - `docs/apex/README.md`
  - `docs/apex/IMPLEMENTATION_NOTES.md`
  - README roadmap/docs link updated for APEX Studio v0.6.

## Validation Already Run

Passed:

```powershell
bun test sidecar/src/apex.test.ts
bun run check
git diff --check
```

Results:

```text
APEX unit test: 4 pass / 0 fail
svelte-check: 0 errors, existing warnings only
diff whitespace check: ok
```

Not clean / blocked:

```powershell
bun x tsc --noEmit --project sidecar/tsconfig.json
```

The full sidecar TypeScript check fails on pre-existing sidecar test/type issues outside the APEX files.

```powershell
cargo check
```

Blocked because this fresh checkout does not have:

```text
src-tauri/binaries/veesker-sidecar-x86_64-pc-windows-msvc.exe
```

## Important Local Change

`sidecar/tsconfig.json` was changed from:

```json
"types": ["bun-types"]
```

to:

```json
"types": ["bun"]
```

Reason: `sidecar/package.json` depends on `@types/bun`, not `bun-types`; the old value prevented local TypeScript checks from even starting.

## Next Work

1. Review the current diff before editing further.
2. Create a feature branch before committing.
3. Add APEX page component RPCs:
   - regions
   - items
   - processes
   - computations
   - validations
   - dynamic actions
   - LOVs
4. Extend the APEX tree under pages with those component groups.
5. Add source extraction RPCs and wire `Open in editor` for source-bearing nodes.
6. Keep v0.6 read-only. Do not add Builder/edit/import/export behavior.

## Files Changed / Added

Modified:

```text
README.md
sidecar/src/index.ts
sidecar/tsconfig.json
src-tauri/src/commands.rs
src-tauri/src/lib.rs
src/lib/workspace.ts
src/lib/workspace/SchemaTree.svelte
src/routes/workspace/[id]/+page.svelte
```

Added:

```text
docs/apex/README.md
docs/apex/IMPLEMENTATION_NOTES.md
docs/apex/HANDOFF_APEX_STUDIO_V0_6.md
sidecar/src/apex.ts
sidecar/src/apex-utils.ts
sidecar/src/apex.test.ts
```
