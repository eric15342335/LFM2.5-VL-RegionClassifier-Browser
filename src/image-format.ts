const ASCII = new TextDecoder("ascii");

export const SUPPORTED_IMAGE_FORMATS = ["jpeg", "png", "webp"] as const;
export const ACCEPTED_IMAGE_MIME_TYPES = SUPPORTED_IMAGE_FORMATS.map((format) => `image/${format}`);
export const SUPPORTED_IMAGE_FORMATS_LABEL = "JPEG, PNG, or WebP";

type ImageFormat = "jpeg" | "png" | "webp" | "gif";

type ImageFormatInspector = {
  format: ImageFormat;
  matches: (bytes: Uint8Array) => boolean;
  frameCount: (bytes: Uint8Array) => number;
};

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return ASCII.decode(bytes.subarray(start, start + length));
}

function uint32Be(bytes: Uint8Array, offset: number): number {
  return (
    (((bytes[offset] ?? 0) << 24) |
      ((bytes[offset + 1] ?? 0) << 16) |
      ((bytes[offset + 2] ?? 0) << 8) |
      (bytes[offset + 3] ?? 0)) >>>
    0
  );
}

function uint32Le(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) |
      ((bytes[offset + 1] ?? 0) << 8) |
      ((bytes[offset + 2] ?? 0) << 16) |
      ((bytes[offset + 3] ?? 0) << 24)) >>>
    0
  );
}

function isGif(bytes: Uint8Array): boolean {
  const header = ascii(bytes, 0, 6);

  return header === "GIF87a" || header === "GIF89a";
}

function gifFrameCount(bytes: Uint8Array): number {
  let frames = 0;

  for (let index = 13; index < bytes.length; index += 1) {
    if (bytes[index] === 0x2c) frames += 1;
    if (frames > 1) return frames;
  }

  return frames;
}

function isPng(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    ascii(bytes, 1, 3) === "PNG" &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  );
}

function pngFrameCount(bytes: Uint8Array): number {
  let offset = 8;

  while (offset + 12 <= bytes.length) {
    const length = uint32Be(bytes, offset);
    const type = ascii(bytes, offset + 4, 4);
    const dataStart = offset + 8;

    if (type === "acTL" && length >= 8 && dataStart + length <= bytes.length) {
      return uint32Be(bytes, dataStart);
    }
    if (type === "IEND") return 1;
    offset = dataStart + length + 4;
  }

  return 1;
}

function isWebP(bytes: Uint8Array): boolean {
  return bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP";
}

function webpFrameCount(bytes: Uint8Array): number {
  let offset = 12;
  let frames = 0;

  while (offset + 8 <= bytes.length) {
    const type = ascii(bytes, offset, 4);
    const length = uint32Le(bytes, offset + 4);

    if (type === "ANIM") return 2;
    if (type === "ANMF") {
      frames += 1;
      if (frames > 1) return frames;
    }
    offset += 8 + length + (length % 2);
  }

  return Math.max(1, frames);
}

const imageFormatInspectors: readonly ImageFormatInspector[] = [
  {
    format: "jpeg",
    matches: (bytes) =>
      bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
    frameCount: () => 1,
  },
  { format: "png", matches: isPng, frameCount: pngFrameCount },
  { format: "webp", matches: isWebP, frameCount: webpFrameCount },
  { format: "gif", matches: isGif, frameCount: gifFrameCount },
];

function inspectImageFormat(bytes: Uint8Array): ImageFormatInspector | undefined {
  return imageFormatInspectors.find((inspector) => inspector.matches(bytes));
}

export function detectImageFormat(bytes: Uint8Array): ImageFormat | "unknown" {
  return inspectImageFormat(bytes)?.format ?? "unknown";
}

export function imageFrameCount(bytes: Uint8Array): number {
  return inspectImageFormat(bytes)?.frameCount(bytes) ?? 0;
}

export function validateImageContainer(bytes: Uint8Array): void {
  const inspector = inspectImageFormat(bytes);

  if (
    !inspector ||
    !SUPPORTED_IMAGE_FORMATS.includes(inspector.format as (typeof SUPPORTED_IMAGE_FORMATS)[number])
  ) {
    throw new Error(`Invalid or unsupported image; use ${SUPPORTED_IMAGE_FORMATS_LABEL}`);
  }
  if (inspector.frameCount(bytes) > 1) throw new Error("Animated images are not supported");
}
