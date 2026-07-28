import { describe, expect, it } from "vitest";
import {
  ACCEPTED_IMAGE_MIME_TYPES,
  detectImageFormat,
  imageFrameCount,
  SUPPORTED_IMAGE_FORMATS_LABEL,
  validateImageContainer,
} from "../image-format";

const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function animatedPng(): Uint8Array {
  return Uint8Array.from([
    ...pngSignature,
    0x00,
    0x00,
    0x00,
    0x08,
    0x61,
    0x63,
    0x54,
    0x4c,
    0x00,
    0x00,
    0x00,
    0x02,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
  ]);
}

function animatedWebp(): Uint8Array {
  return Uint8Array.from([
    0x52, 0x49, 0x46, 0x46, 0x04, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x41, 0x4e, 0x49, 0x4d,
    0x00, 0x00, 0x00, 0x00,
  ]);
}

describe("image container validation", () => {
  it("shares the accepted MIME types and display label with the UI", () => {
    expect(ACCEPTED_IMAGE_MIME_TYPES).toEqual(["image/jpeg", "image/png", "image/webp"]);
    expect(SUPPORTED_IMAGE_FORMATS_LABEL).toBe("JPEG, PNG, or WebP");
  });

  it("recognizes supported signatures", () => {
    expect(detectImageFormat(new Uint8Array([0xff, 0xd8, 0xff, 0x00]))).toBe("jpeg");
    expect(detectImageFormat(Uint8Array.from(pngSignature))).toBe("png");
    expect(detectImageFormat(animatedWebp())).toBe("webp");
  });

  it("rejects unknown and GIF input", () => {
    expect(() => validateImageContainer(new Uint8Array([0x00, 0x01]))).toThrow(
      "JPEG, PNG, or WebP"
    );
    expect(() => validateImageContainer(new TextEncoder().encode("GIF89a"))).toThrow(
      "JPEG, PNG, or WebP"
    );
  });

  it("detects animated PNG and WebP containers", () => {
    expect(imageFrameCount(animatedPng())).toBe(2);
    expect(imageFrameCount(animatedWebp())).toBe(2);
    expect(() => validateImageContainer(animatedPng())).toThrow("Animated images");
    expect(() => validateImageContainer(animatedWebp())).toThrow("Animated images");
  });
});
