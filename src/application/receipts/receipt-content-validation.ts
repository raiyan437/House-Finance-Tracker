import { ApplicationError } from "@/application/errors/application-error";
import type { ReceiptContent } from "@/application/repositories";
import { MAX_RECEIPT_BYTES } from "@/domain/records/domain-records";

export type ReceiptContentDecoder = (content: ReceiptContent) => Promise<void>;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const CRC_TABLE = buildCrcTable();

function invalidReceipt(): never {
  throw new ApplicationError(
    "RECEIPT_CONTENT_MISMATCH",
    "Receipt content is not a valid supported image.",
  );
}

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
}

function crc32(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0xffffffff;
  for (let index = start; index < end; index += 1) {
    crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function uint32Be(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! * 0x1000000 +
    (bytes[offset + 1]! << 16) +
    (bytes[offset + 2]! << 8) +
    bytes[offset + 3]!
  ) >>> 0;
}

function uint32Le(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! +
    bytes[offset + 1]! * 0x100 +
    bytes[offset + 2]! * 0x10000 +
    bytes[offset + 3]! * 0x1000000
  ) >>> 0;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let value = "";
  for (let index = offset; index < offset + length; index += 1) {
    value += String.fromCharCode(bytes[index]!);
  }
  return value;
}

function assertPng(bytes: Uint8Array): void {
  if (
    bytes.length < 57 ||
    !PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)
  ) {
    invalidReceipt();
  }

  let offset: number = PNG_SIGNATURE.length;
  let chunkIndex = 0;
  let colorType = -1;
  let sawPalette = false;
  let sawImageData = false;
  let sawEnd = false;

  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) invalidReceipt();
    const dataLength = uint32Be(bytes, offset);
    const typeOffset = offset + 4;
    const dataOffset = typeOffset + 4;
    const crcOffset = dataOffset + dataLength;
    const chunkEnd = crcOffset + 4;
    if (chunkEnd > bytes.length) invalidReceipt();

    const type = ascii(bytes, typeOffset, 4);
    if (!/^[A-Za-z]{4}$/u.test(type)) invalidReceipt();
    if (crc32(bytes, typeOffset, crcOffset) !== uint32Be(bytes, crcOffset)) {
      invalidReceipt();
    }

    if (chunkIndex === 0) {
      if (type !== "IHDR" || dataLength !== 13) invalidReceipt();
      const width = uint32Be(bytes, dataOffset);
      const height = uint32Be(bytes, dataOffset + 4);
      const bitDepth = bytes[dataOffset + 8]!;
      colorType = bytes[dataOffset + 9]!;
      const allowedDepths: Readonly<Record<number, readonly number[]>> = {
        0: [1, 2, 4, 8, 16],
        2: [8, 16],
        3: [1, 2, 4, 8],
        4: [8, 16],
        6: [8, 16],
      };
      if (
        width === 0 ||
        height === 0 ||
        !allowedDepths[colorType]?.includes(bitDepth) ||
        bytes[dataOffset + 10] !== 0 ||
        bytes[dataOffset + 11] !== 0 ||
        (bytes[dataOffset + 12] !== 0 && bytes[dataOffset + 12] !== 1)
      ) {
        invalidReceipt();
      }
    } else if (type === "IHDR") {
      invalidReceipt();
    } else if (type === "PLTE") {
      if (sawPalette || sawImageData || dataLength === 0 || dataLength % 3 !== 0 || dataLength > 768) {
        invalidReceipt();
      }
      sawPalette = true;
    } else if (type === "IDAT") {
      if (colorType === 3 && !sawPalette) invalidReceipt();
      sawImageData = true;
    } else if (type === "IEND") {
      if (dataLength !== 0 || !sawImageData || chunkEnd !== bytes.length) invalidReceipt();
      sawEnd = true;
    } else if ((bytes[typeOffset]! & 0x20) === 0) {
      // PNG reserves uppercase-leading chunk names for critical chunks. Unknown
      // critical chunks cannot be decoded safely.
      invalidReceipt();
    }

    offset = chunkEnd;
    chunkIndex += 1;
    if (sawEnd) break;
  }

  if (!sawEnd || offset !== bytes.length) invalidReceipt();
}

const JPEG_START_OF_FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce,
  0xcf,
]);

function assertJpeg(bytes: Uint8Array): void {
  if (bytes.length < 16 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    invalidReceipt();
  }

  let offset = 2;
  let sawFrame = false;
  let sawScan = false;
  let sawEnd = false;

  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) invalidReceipt();
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) invalidReceipt();
    const marker = bytes[offset]!;
    offset += 1;

    if (marker === 0xd9) {
      sawEnd = true;
      break;
    }
    if (marker === 0x00 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
      invalidReceipt();
    }
    if (marker === 0x01) continue;
    if (offset + 2 > bytes.length) invalidReceipt();
    const segmentLength = (bytes[offset]! << 8) + bytes[offset + 1]!;
    if (segmentLength < 2 || offset + segmentLength > bytes.length) invalidReceipt();
    const dataOffset = offset + 2;
    const dataLength = segmentLength - 2;

    if (JPEG_START_OF_FRAME_MARKERS.has(marker)) {
      if (dataLength < 6) invalidReceipt();
      const height = (bytes[dataOffset + 1]! << 8) + bytes[dataOffset + 2]!;
      const width = (bytes[dataOffset + 3]! << 8) + bytes[dataOffset + 4]!;
      const components = bytes[dataOffset + 5]!;
      if (width === 0 || height === 0 || components === 0 || dataLength < 6 + components * 3) {
        invalidReceipt();
      }
      sawFrame = true;
    }

    offset += segmentLength;
    if (marker !== 0xda) continue;
    if (!sawFrame || dataLength < 4) invalidReceipt();
    sawScan = true;

    let foundMarker = false;
    while (offset < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const markerStart = offset;
      while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
      if (offset >= bytes.length) invalidReceipt();
      const entropyMarker = bytes[offset]!;
      if (entropyMarker === 0x00 || (entropyMarker >= 0xd0 && entropyMarker <= 0xd7)) {
        offset += 1;
        continue;
      }
      offset = markerStart;
      foundMarker = true;
      break;
    }
    if (!foundMarker) invalidReceipt();
  }

  if (!sawFrame || !sawScan || !sawEnd || offset !== bytes.length) invalidReceipt();
}

function assertVp8(bytes: Uint8Array, dataOffset: number, dataLength: number): void {
  if (
    dataLength < 10 ||
    (bytes[dataOffset]! & 1) !== 0 ||
    bytes[dataOffset + 3] !== 0x9d ||
    bytes[dataOffset + 4] !== 0x01 ||
    bytes[dataOffset + 5] !== 0x2a
  ) {
    invalidReceipt();
  }
  const width = (bytes[dataOffset + 6]! + (bytes[dataOffset + 7]! << 8)) & 0x3fff;
  const height = (bytes[dataOffset + 8]! + (bytes[dataOffset + 9]! << 8)) & 0x3fff;
  if (width === 0 || height === 0) invalidReceipt();
}

function assertVp8l(bytes: Uint8Array, dataOffset: number, dataLength: number): void {
  if (dataLength < 5 || bytes[dataOffset] !== 0x2f) invalidReceipt();
  const bits = uint32Le(bytes, dataOffset + 1);
  const width = (bits & 0x3fff) + 1;
  const height = ((bits >>> 14) & 0x3fff) + 1;
  if (width === 0 || height === 0 || (bits >>> 29) !== 0) invalidReceipt();
}

function parseWebpChunks(
  bytes: Uint8Array,
  start: number,
  end: number,
): Readonly<{ imageChunks: number; animationFrames: number; extended: boolean; animated: boolean }> {
  let offset = start;
  let imageChunks = 0;
  let animationFrames = 0;
  let extended = false;
  let animated = false;

  while (offset < end) {
    if (offset + 8 > end) invalidReceipt();
    const type = ascii(bytes, offset, 4);
    const dataLength = uint32Le(bytes, offset + 4);
    const dataOffset = offset + 8;
    const paddedLength = dataLength + (dataLength & 1);
    const chunkEnd = dataOffset + paddedLength;
    if (chunkEnd > end) invalidReceipt();

    if (type === "VP8 ") {
      assertVp8(bytes, dataOffset, dataLength);
      imageChunks += 1;
    } else if (type === "VP8L") {
      assertVp8l(bytes, dataOffset, dataLength);
      imageChunks += 1;
    } else if (type === "VP8X") {
      if (dataLength !== 10 || extended) invalidReceipt();
      const width = bytes[dataOffset + 4]! + (bytes[dataOffset + 5]! << 8) + (bytes[dataOffset + 6]! << 16) + 1;
      const height = bytes[dataOffset + 7]! + (bytes[dataOffset + 8]! << 8) + (bytes[dataOffset + 9]! << 16) + 1;
      if (width <= 0 || height <= 0) invalidReceipt();
      extended = true;
      animated = (bytes[dataOffset]! & 0x02) !== 0;
    } else if (type === "ANMF") {
      if (dataLength < 24) invalidReceipt();
      const nested = parseWebpChunks(bytes, dataOffset + 16, dataOffset + dataLength);
      if (nested.imageChunks !== 1 || nested.extended || nested.animationFrames !== 0) invalidReceipt();
      animationFrames += 1;
    }

    offset = chunkEnd;
  }

  if (offset !== end) invalidReceipt();
  return { imageChunks, animationFrames, extended, animated };
}

function assertWebp(bytes: Uint8Array): void {
  if (
    bytes.length < 30 ||
    ascii(bytes, 0, 4) !== "RIFF" ||
    ascii(bytes, 8, 4) !== "WEBP" ||
    uint32Le(bytes, 4) + 8 !== bytes.length
  ) {
    invalidReceipt();
  }
  const chunks = parseWebpChunks(bytes, 12, bytes.length);
  const staticImage = chunks.imageChunks === 1 && chunks.animationFrames === 0;
  const animatedImage = chunks.extended && chunks.animated && chunks.animationFrames > 0 && chunks.imageChunks === 0;
  if (!staticImage && !animatedImage) invalidReceipt();
}

export function assertReceiptContentStructure(content: ReceiptContent): void {
  if (
    !(content.bytes instanceof Uint8Array) ||
    content.bytes.byteLength < 1 ||
    content.bytes.byteLength > MAX_RECEIPT_BYTES
  ) {
    invalidReceipt();
  }

  if (content.mimeType === "image/png") {
    assertPng(content.bytes);
  } else if (content.mimeType === "image/jpeg") {
    assertJpeg(content.bytes);
  } else if (content.mimeType === "image/webp") {
    assertWebp(content.bytes);
  } else {
    invalidReceipt();
  }
}

export async function validateReceiptContent(
  content: ReceiptContent,
  decoder?: ReceiptContentDecoder,
): Promise<void> {
  assertReceiptContentStructure(content);
  if (decoder) await decoder(content);
}
