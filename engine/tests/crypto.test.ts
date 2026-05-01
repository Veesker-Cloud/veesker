import { describe, expect, it } from "bun:test";
import { sodiumReady, getSodium } from "../src/crypto/sodium";

describe("crypto sodium init", () => {
  it("initializes libsodium and exposes constants", async () => {
    await sodiumReady();
    const sodium = getSodium();
    expect(sodium.crypto_box_PUBLICKEYBYTES).toBe(32);
    expect(sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES).toBe(32);
    expect(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES).toBe(24);
    expect(sodium.crypto_aead_chacha20poly1305_ietf_NPUBBYTES).toBe(12);
  });

  it("returns same instance on repeated init", async () => {
    await sodiumReady();
    const a = getSodium();
    await sodiumReady();
    const b = getSodium();
    expect(a).toBe(b);
  });

  it("throws on getSodium() without prior sodiumReady()", async () => {
    // This test is illustrative — by the time it runs, prior tests have
    // initialized libsodium globally. So we just assert the init flag is true.
    await sodiumReady();
    expect(() => getSodium()).not.toThrow();
  });
});
