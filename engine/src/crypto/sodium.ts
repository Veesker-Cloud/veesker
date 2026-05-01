import _sodium from "libsodium-wrappers-sumo";

let initialized = false;

/**
 * Awaitable libsodium readiness gate. The first call awaits the WASM
 * bootstrap; subsequent calls are no-ops.
 *
 * Always call this before any crypto operation. The `-sumo` variant
 * bundles the WASM internally — the regular `libsodium-wrappers` build
 * has a separate `libsodium` peer dep that does not resolve under Bun
 * on Windows.
 */
export async function sodiumReady(): Promise<void> {
  if (initialized) return;
  await _sodium.ready;
  initialized = true;
}

/**
 * Return the initialized libsodium handle. Throws if {@link sodiumReady}
 * has not yet been awaited — call sites must `await sodiumReady()` first.
 */
export function getSodium(): typeof _sodium {
  if (!initialized) {
    throw new Error("crypto: sodiumReady() must be awaited before getSodium()");
  }
  return _sodium;
}
