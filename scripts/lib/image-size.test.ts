import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { imageSizeOf } from "./image-size";

const png = (w: number, h: number): Buffer => {
  const b = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12);
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
};

/** JPEG with one skipped segment before the frame header, as real files have. */
const jpeg = (w: number, h: number): Buffer => {
  const seg = Buffer.alloc(20, 0);
  seg.writeUInt16BE(0xffe0, 0); // APP0
  seg.writeUInt16BE(16, 2); // length, so the scan must skip 18 bytes
  const sof = Buffer.alloc(11, 0);
  sof.writeUInt16BE(0xffc0, 0);
  sof.writeUInt16BE(11, 2);
  sof.writeUInt16BE(h, 5);
  sof.writeUInt16BE(w, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), seg.subarray(0, 18), sof]);
};

describe("imageSizeOf", () => {
  it("reads PNG dimensions from IHDR", () => {
    assert.deepEqual(imageSizeOf(png(2832, 1672)), { width: 2832, height: 1672 });
  });

  it("reads JPEG dimensions, skipping segments before the frame header", () => {
    assert.deepEqual(imageSizeOf(jpeg(3840, 2160)), { width: 3840, height: 2160 });
  });

  it("does not confuse width and height — JPEG stores height first", () => {
    assert.deepEqual(imageSizeOf(jpeg(800, 600)), { width: 800, height: 600 });
    assert.deepEqual(imageSizeOf(png(800, 600)), { width: 800, height: 600 });
  });

  it("names the file rather than returning a wrong aspect", () => {
    assert.throws(() => imageSizeOf(Buffer.from("GIF89a"), "hero.gif"), /hero\.gif is not a PNG or JPEG/);
    assert.throws(() => imageSizeOf(png(1, 1).subarray(0, 12), "cut.png"), /truncated PNG/);
  });
});
