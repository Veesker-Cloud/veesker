/**
 * `.vsk` file header — fixed 64 bytes at offset 0 of every sandbox file.
 *
 * Byte layout (offset · size · field · endianness):
 *   0  · 4 · magic            · BIG-endian   — `0x56534b21` reads as ASCII "VSK!" on disk
 *   4  · 2 · version          · little       — `1` for this format
 *   6  · 2 · reserved-zero    · little       — must be zero, available for future fields
 *   8  · 8 · manifestOffset   · little       — byte offset of the manifest section
 *  16  · 8 · manifestLength   · little       — byte length of the manifest section
 *  24  · 8 · dataOffset       · little       — byte offset of the data section (parquet stream)
 *  32  · 8 · dataLength       · little       — byte length of the data section
 *  40  · 8 · envelopeOffset   · little       — byte offset of the encryption envelope (0 if plaintext)
 *  48  · 8 · envelopeLength   · little       — byte length of the encryption envelope (0 if plaintext)
 *  56  · 8 · reserved-zero    · little       — must be zero, available for future fields
 *
 * The two reserved spans (bytes 6-7, 56-63) are forward-compat slack. Reading code MUST
 * ignore unknown bits there; writing code MUST leave them zero. New fields can be added
 * to either span without bumping the format version, as long as they remain optional and
 * unset implies "feature not present".
 *
 * The integer offsets/lengths are 64-bit unsigned to support files >4 GiB.
 */
export const VSK_MAGIC = 0x56534b21; // "VSK!"
export const VSK_VERSION = 1;
export const HEADER_SIZE = 64;

export interface VskHeader {
  magic: number;
  version: number;
  manifestOffset: bigint;
  manifestLength: bigint;
  dataOffset: bigint;
  dataLength: bigint;
  envelopeOffset: bigint;
  envelopeLength: bigint;
}

export function writeHeader(fields: Omit<VskHeader, "magic" | "version">): Uint8Array {
  const buf = new Uint8Array(HEADER_SIZE);
  const view = new DataView(buf.buffer);
  view.setUint32(0, VSK_MAGIC, false);
  view.setUint16(4, VSK_VERSION, true);
  view.setBigUint64(8, fields.manifestOffset, true);
  view.setBigUint64(16, fields.manifestLength, true);
  view.setBigUint64(24, fields.dataOffset, true);
  view.setBigUint64(32, fields.dataLength, true);
  view.setBigUint64(40, fields.envelopeOffset, true);
  view.setBigUint64(48, fields.envelopeLength, true);
  return buf;
}

export function readHeader(buf: Uint8Array): VskHeader {
  if (buf.byteLength < HEADER_SIZE) {
    throw new Error(`vsk header truncated: got ${buf.byteLength}, expected ${HEADER_SIZE}`);
  }
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const magic = view.getUint32(0, false);
  if (magic !== VSK_MAGIC) {
    throw new Error(`vsk: bad magic bytes (got 0x${magic.toString(16)})`);
  }
  const version = view.getUint16(4, true);
  if (version !== VSK_VERSION) {
    throw new Error(`vsk: unsupported version ${version} (engine supports ${VSK_VERSION})`);
  }
  return {
    magic,
    version,
    manifestOffset: view.getBigUint64(8, true),
    manifestLength: view.getBigUint64(16, true),
    dataOffset: view.getBigUint64(24, true),
    dataLength: view.getBigUint64(32, true),
    envelopeOffset: view.getBigUint64(40, true),
    envelopeLength: view.getBigUint64(48, true),
  };
}
