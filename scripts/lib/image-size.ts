/**
 * Pixel dimensions of a PNG or JPEG, read from the file header.
 *
 * Twenty lines rather than a dependency, and specifically rather than ffprobe:
 * the still RENDER stage is the one part of this pipeline that needs no ffmpeg
 * at all, and importing an image should not be what drags it in.
 *
 * Only the two formats a screenshot actually arrives as. Anything else throws
 * by name, which is more useful than a silently wrong aspect ratio.
 */
import * as fs from "node:fs";
import * as path from "node:path";

export type ImageSize = { width: number; height: number };

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** SOF markers carrying a frame header. C4/C8/CC are tables, not frames. */
const isFrameMarker = (m: number): boolean =>
  m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;

export function imageSizeOf(buf: Buffer, label = "image"): ImageSize {
  if (buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    // IHDR is always the first chunk: 8 signature + 4 length + 4 type, then
    // width and height as big-endian uint32.
    if (buf.length < 24) throw new Error(`${label} is a truncated PNG`);
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = buf[i + 1]!;
      if (isFrameMarker(marker))
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      // Skip this segment: two marker bytes plus its declared length.
      i += 2 + buf.readUInt16BE(i + 2);
    }
    throw new Error(`${label} is a JPEG with no frame header`);
  }
  throw new Error(`${label} is not a PNG or JPEG`);
}

export function imageSize(file: string): ImageSize {
  const buf = fs.readFileSync(file);
  return imageSizeOf(buf, path.basename(file));
}
