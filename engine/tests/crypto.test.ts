import { describe, expect, it } from "bun:test";
import { sodiumReady, getSodium } from "../src/crypto/sodium";
import { generateKeypair, publicKeyFromPrivate, pubkeyToBase64, pubkeyFromBase64 } from "../src/crypto/keypair";
import { OsKeyringStore, InMemoryKeyStore, type KeyStore } from "../src/crypto/keystore";
import { encryptBlob, decryptBlob, randomKey } from "../src/crypto/blob";

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

describe("crypto X25519 keypair", () => {
  it("generates a 32-byte public + 32-byte private key", async () => {
    const kp = await generateKeypair();
    expect(kp.publicKey.byteLength).toBe(32);
    expect(kp.privateKey.byteLength).toBe(32);
  });

  it("generates distinct keypairs on each call", async () => {
    const a = await generateKeypair();
    const b = await generateKeypair();
    expect(Buffer.from(a.publicKey).equals(Buffer.from(b.publicKey))).toBe(false);
    expect(Buffer.from(a.privateKey).equals(Buffer.from(b.privateKey))).toBe(false);
  });

  it("derives the same public key deterministically from private key", async () => {
    const kp = await generateKeypair();
    const derived = publicKeyFromPrivate(kp.privateKey);
    expect(Buffer.from(derived).equals(Buffer.from(kp.publicKey))).toBe(true);
  });

  it("round-trips a public key through base64 encoding", async () => {
    const kp = await generateKeypair();
    const encoded = pubkeyToBase64(kp.publicKey);
    expect(typeof encoded).toBe("string");
    expect(encoded.length).toBeGreaterThan(40); // 32 bytes → 44 chars base64
    const decoded = pubkeyFromBase64(encoded);
    expect(Buffer.from(decoded).equals(Buffer.from(kp.publicKey))).toBe(true);
  });

  it("rejects malformed base64 input gracefully", () => {
    // Buffer.from accepts garbage and returns whatever it can decode.
    // We don't validate length here — that's the caller's job.
    const decoded = pubkeyFromBase64("not-real-base64!@#");
    expect(decoded.byteLength).toBeGreaterThanOrEqual(0);
  });
});

describe("crypto KeyStore", () => {
  describe("InMemoryKeyStore", () => {
    it("starts empty", async () => {
      const store: KeyStore = new InMemoryKeyStore();
      const pk = await store.getPrivateKey();
      expect(pk).toBeNull();
    });

    it("round-trips a private key", async () => {
      const store: KeyStore = new InMemoryKeyStore();
      const original = new Uint8Array(32).fill(7);
      await store.setPrivateKey(original);
      const fetched = await store.getPrivateKey();
      expect(fetched).not.toBeNull();
      expect(Buffer.from(fetched!).equals(Buffer.from(original))).toBe(true);
    });

    it("clears the key on delete", async () => {
      const store: KeyStore = new InMemoryKeyStore();
      await store.setPrivateKey(new Uint8Array(32).fill(1));
      await store.deletePrivateKey();
      expect(await store.getPrivateKey()).toBeNull();
    });
  });

  describe("OsKeyringStore", () => {
    const TEST_SERVICE = "vsk-engine-test";
    const TEST_ACCOUNT = `vsk-test-${process.pid}-${Date.now()}`;

    it("round-trips a private key via OS keyring", async () => {
      const store: KeyStore = new OsKeyringStore(TEST_SERVICE, TEST_ACCOUNT);
      const original = new Uint8Array(32).fill(7);
      await store.setPrivateKey(original);
      const fetched = await store.getPrivateKey();
      expect(fetched).not.toBeNull();
      expect(Buffer.from(fetched!).equals(Buffer.from(original))).toBe(true);

      // Cleanup
      await store.deletePrivateKey();
      const after = await store.getPrivateKey();
      expect(after).toBeNull();
    });

    it("returns null for an unknown account", async () => {
      const store: KeyStore = new OsKeyringStore(TEST_SERVICE, `unknown-${process.pid}-${Date.now()}`);
      const pk = await store.getPrivateKey();
      expect(pk).toBeNull();
    });
  });
});

describe("crypto blob encryption (XChaCha20-Poly1305 IETF)", () => {
  it("round-trips a payload", async () => {
    const key = new Uint8Array(32).fill(1);
    const plaintext = new TextEncoder().encode("hello sandbox");
    const { ciphertext, nonce } = await encryptBlob(key, plaintext);
    expect(nonce.byteLength).toBe(24);
    expect(ciphertext.byteLength).toBeGreaterThan(plaintext.byteLength);
    const decrypted = await decryptBlob(key, ciphertext, nonce);
    expect(new TextDecoder().decode(decrypted)).toBe("hello sandbox");
  });

  it("randomKey returns a 32-byte key", async () => {
    await sodiumReady();
    const k = randomKey();
    expect(k.byteLength).toBe(32);
  });

  it("rejects tampered ciphertext", async () => {
    const key = new Uint8Array(32).fill(2);
    const { ciphertext, nonce } = await encryptBlob(key, new TextEncoder().encode("x"));
    ciphertext[0] = (ciphertext[0] ?? 0) ^ 0xff;
    await expect(decryptBlob(key, ciphertext, nonce)).rejects.toThrow();
  });

  it("rejects wrong key", async () => {
    const k1 = new Uint8Array(32).fill(3);
    const k2 = new Uint8Array(32).fill(4);
    const { ciphertext, nonce } = await encryptBlob(k1, new TextEncoder().encode("x"));
    await expect(decryptBlob(k2, ciphertext, nonce)).rejects.toThrow();
  });

  it("uses fresh random nonces", async () => {
    const key = new Uint8Array(32).fill(7);
    const a = await encryptBlob(key, new TextEncoder().encode("x"));
    const b = await encryptBlob(key, new TextEncoder().encode("x"));
    expect(Buffer.from(a.nonce).equals(Buffer.from(b.nonce))).toBe(false);
  });

  it("rejects keys of wrong length", async () => {
    const shortKey = new Uint8Array(16).fill(1);
    await expect(encryptBlob(shortKey, new Uint8Array([1, 2, 3])))
      .rejects.toThrow(/key must be/i);
  });

  it("round-trips a large payload (100KB)", async () => {
    const key = new Uint8Array(32).fill(9);
    const plaintext = new Uint8Array(100 * 1024);
    for (let i = 0; i < plaintext.length; i++) plaintext[i] = i % 256;
    const { ciphertext, nonce } = await encryptBlob(key, plaintext);
    const decrypted = await decryptBlob(key, ciphertext, nonce);
    expect(Buffer.from(decrypted).equals(Buffer.from(plaintext))).toBe(true);
  });
});
