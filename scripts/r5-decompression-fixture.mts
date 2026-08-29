import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createDeflate } from "node:zlib";
import sharp from "sharp";

const WIDTH = 16_400;
const HEIGHT = 16_400;
const EXPECTED_SHA256 = "d14c07e30ffca74eb20dd2340e78d056ea42bd2730c8975c952523b0fafdcea2";

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const output = Buffer.allocUnsafe(12 + data.byteLength);
  output.writeUInt32BE(data.byteLength, 0);
  typeBytes.copy(output, 4);
  Buffer.from(data).copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([typeBytes, Buffer.from(data)])), 8 + data.byteLength);
  return output;
}

async function compressedRows(): Promise<Buffer> {
  const deflater = createDeflate({ level: 9 });
  const chunks: Buffer[] = [];
  deflater.on("data", (chunk: Buffer) => chunks.push(chunk));
  const row = Buffer.alloc(WIDTH + 1);
  for (let rowIndex = 0; rowIndex < HEIGHT; rowIndex += 1) {
    if (!deflater.write(row)) await once(deflater, "drain");
  }
  deflater.end();
  await once(deflater, "end");
  return Buffer.concat(chunks);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(WIDTH, 0);
ihdr.writeUInt32BE(HEIGHT, 4);
ihdr[8] = 8;
ihdr[9] = 0;

const bytes = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  pngChunk("IHDR", ihdr),
  pngChunk("IDAT", await compressedRows()),
  pngChunk("IEND", Buffer.alloc(0)),
]);
const digest = createHash("sha256").update(bytes).digest("hex");
if (digest !== EXPECTED_SHA256) {
  throw new Error(`Pin the deterministic fixture SHA-256: ${digest}`);
}

const metadata = await sharp(bytes, { limitInputPixels: false }).metadata();
if (metadata.format !== "png" || metadata.width !== WIDTH || metadata.height !== HEIGHT) {
  throw new Error("The decompression-heavy fixture metadata is invalid.");
}

const target = resolve(process.env.HFT_R5_FIXTURE_DIR ?? join(homedir(), "hft-r5-fixtures"));
await mkdir(target, { recursive: true });
const path = join(target, "receipt-decompression-heavy.png");
await writeFile(path, bytes);
console.log(JSON.stringify({ path, sizeBytes: bytes.byteLength, width: WIDTH, height: HEIGHT, pixels: WIDTH * HEIGHT, sha256: digest }, null, 2));
