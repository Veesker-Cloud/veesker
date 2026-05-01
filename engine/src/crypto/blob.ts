import { sodiumReady, getSodium } from "./sodium";

export interface EncryptedBlob {
  ciphertext: Uint8Array;
  nonce: Uint8Array;
}

/**
 * Encrypt a plaintext blob with XChaCha20-Poly1305 IETF (libsodium
 * WASM-friendly substitute for AES-256-GCM, since libsodium AES requires
 * AES-NI which the WASM build cannot expose).
 *
 * 192-bit nonces make random-nonce safety essentially unbounded — billions
 * of independent encryptions can use random nonces with negligible
 * collision risk. We generate one fresh content key per sandbox, so this
 * is the right primitive.
 */
export async function encryptBlob(
  key: Uint8Array,
  plaintext: Uint8Array,
): Promise<EncryptedBlob> {
  await sodiumReady();
  const sodium = getSodium();
  if (key.byteLength !== sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES) {
    throw new Error(
      `encryptBlob: key must be ${sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES} bytes (got ${key.byteLength})`,
    );
  }
  const nonce = sodium.randombytes_buf(
    sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES,
  );
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    plaintext,
    null,
    null,
    nonce,
    key,
  );
  return { ciphertext, nonce };
}

/** Decrypt a blob produced by {@link encryptBlob}. Throws on auth failure. */
export async function decryptBlob(
  key: Uint8Array,
  ciphertext: Uint8Array,
  nonce: Uint8Array,
): Promise<Uint8Array> {
  await sodiumReady();
  const sodium = getSodium();
  return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null,
    ciphertext,
    null,
    nonce,
    key,
  );
}

/** Generate a fresh 32-byte symmetric content key. */
export function randomKey(): Uint8Array {
  const sodium = getSodium();
  return sodium.randombytes_buf(
    sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES,
  );
}
