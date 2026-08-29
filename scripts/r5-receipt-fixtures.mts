import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import sharp from "sharp";

const MIB = 1024 * 1024;
const MAX_RECEIPT_BYTES = 10 * MIB;
const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const JPEG_BASE64 = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/AP/EABQQAQAAAAAAAAAAAAAAAAAAABD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8Bf//EABQQAQAAAAAAAAAAAAAAAAAAABD/2gAIAQEABj8Cf//Z";
const WEBP_BASE64 = "UklGRhoAAABXRUJQVlA4TA4AAAAvAAAAAAcQEf0PRET/Aw==";
const PINNED_SHA256: Readonly<Record<string, string>> = Object.freeze({
  "small.jpeg": "2c3aa058841c01449789fe2d6c46e3b8427ce79d41bffcf754ee45bc1be8da9b",
  "small.png": "431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460",
  "small.webp": "b0ff5420a87b7117d944273dafe43684066c6cae95533df2fbada29cf1523a9f",
  "receipt-1-mib.jpeg": "29b1a9308053e8d655e6790cf7650948b8bf8700dec7d25e0b71b693313c7bf5",
  "receipt-5-mib.jpeg": "1aef2597a21084bd743d2887ede889fabc10ba5f11422b19170c0cf5fde0684d",
  "receipt-exact-10-mib.jpeg": "ef96f1e78aa16cdb5e22e70fba621487f872e6fa3b6c8474819d8c41e8d0faad",
  "receipt-over-10-mib.jpeg": "69e62e86a391e61752f70162963c1a7202eae11e0e7b685c09ab082930ea6db2",
  "receipt-truncated.png": "14d8eb96dfed2275d474e4d71e9f7a1e7dab51ef837d3534753559717d3b3769",
  "receipt-malformed.png": "4c4b6a3be1314ab86138bef4314dde022e600960d8689a2c8f8631802d20dab6",
});

type FixtureExpectation = "accept" | "reject-malformed" | "reject-oversized";
interface Fixture {
  readonly filename: string;
  readonly mimeType: "image/jpeg" | "image/png" | "image/webp";
  readonly bytes: Uint8Array;
  readonly expectation: FixtureExpectation;
}

function decode(base64: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64, "base64"));
}

function paddedJpeg(source: Uint8Array, targetSize: number): Uint8Array {
  const paddingSize = targetSize - source.byteLength;
  if (paddingSize < 0) throw new Error("The target is smaller than the JPEG fixture.");
  const segmentSizes: number[] = [];
  let remaining = paddingSize;
  while (remaining > 0) {
    if (remaining < 4) throw new Error("JPEG padding cannot encode the requested remainder.");
    let total = Math.min(65_537, remaining);
    const leftover = remaining - total;
    if (leftover > 0 && leftover < 4) total -= 4 - leftover;
    segmentSizes.push(total);
    remaining -= total;
  }

  const output = new Uint8Array(targetSize);
  output.set(source.subarray(0, 2), 0);
  let offset = 2;
  for (const total of segmentSizes) {
    const payloadSize = total - 4;
    const segmentLength = payloadSize + 2;
    output[offset] = 0xff;
    output[offset + 1] = 0xe2;
    output[offset + 2] = segmentLength >>> 8;
    output[offset + 3] = segmentLength & 0xff;
    offset += total;
  }
  output.set(source.subarray(2), offset);
  return output;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const jpeg = decode(JPEG_BASE64);
const png = decode(PNG_BASE64);
const webp = decode(WEBP_BASE64);
const fixtures: readonly Fixture[] = [
  { filename: "small.jpeg", mimeType: "image/jpeg", bytes: jpeg, expectation: "accept" },
  { filename: "small.png", mimeType: "image/png", bytes: png, expectation: "accept" },
  { filename: "small.webp", mimeType: "image/webp", bytes: webp, expectation: "accept" },
  { filename: "receipt-1-mib.jpeg", mimeType: "image/jpeg", bytes: paddedJpeg(jpeg, MIB), expectation: "accept" },
  { filename: "receipt-5-mib.jpeg", mimeType: "image/jpeg", bytes: paddedJpeg(jpeg, 5 * MIB), expectation: "accept" },
  { filename: "receipt-exact-10-mib.jpeg", mimeType: "image/jpeg", bytes: paddedJpeg(jpeg, MAX_RECEIPT_BYTES), expectation: "accept" },
  { filename: "receipt-over-10-mib.jpeg", mimeType: "image/jpeg", bytes: paddedJpeg(jpeg, MAX_RECEIPT_BYTES + 1), expectation: "reject-oversized" },
  { filename: "receipt-truncated.png", mimeType: "image/png", bytes: png.subarray(0, 40), expectation: "reject-malformed" },
  { filename: "receipt-malformed.png", mimeType: "image/png", bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), expectation: "reject-malformed" },
];

const target = resolve(process.env.HFT_R5_FIXTURE_DIR ?? join(homedir(), "hft-r5-fixtures"));
await mkdir(target, { recursive: true });

const manifest = [];
for (const fixture of fixtures) {
  const path = join(target, fixture.filename);
  const digest = sha256(fixture.bytes);
  if (digest !== PINNED_SHA256[fixture.filename]) {
    throw new Error(`${fixture.filename} no longer matches its pinned SHA-256 checksum.`);
  }
  await writeFile(path, fixture.bytes);
  const decoder = sharp(Buffer.from(fixture.bytes), { failOn: "error", sequentialRead: true });
  if (fixture.expectation !== "reject-malformed") {
    const metadata = await decoder.metadata();
    const expectedFormat = fixture.mimeType === "image/jpeg" ? "jpeg" : fixture.mimeType.slice("image/".length);
    if (metadata.format !== expectedFormat || metadata.width !== 1 || metadata.height !== 1) {
      throw new Error(`${fixture.filename} did not decode as its pinned 1x1 image fixture.`);
    }
    await decoder.stats();
  } else {
    try {
      await decoder.stats();
      throw new Error(`${fixture.filename} unexpectedly decoded as a valid image.`);
    } catch (error) {
      if (error instanceof Error && error.message.includes("unexpectedly decoded")) throw error;
    }
  }
  manifest.push({
    filename: fixture.filename,
    mimeType: fixture.mimeType,
    sizeBytes: fixture.bytes.byteLength,
    sha256: digest,
    expectation: fixture.expectation,
  });
}

const manifestPath = join(target, "manifest.json");
await writeFile(manifestPath, `${JSON.stringify({ version: 1, fixtures: manifest }, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ fixtureDirectory: target, manifestPath, fixtures: manifest }, null, 2));
