import type { BrowserCapability } from "../types";

function errorWithName(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

function recordOfNumbers(value: unknown): Record<string, number> | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const output: Record<string, number> = {};

  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "number") {
      output[key] = item;
    }
  }

  return Object.keys(output).length ? output : undefined;
}

export async function probeBrowserCapability(): Promise<BrowserCapability> {
  const scope = typeof self === "undefined" ? globalThis : self;

  const capability: BrowserCapability = {
    supported: false,
    secureContext: scope.isSecureContext === true,
    hasWebgpu: "gpu" in navigator,
    adapterAcquired: false,
    deviceAcquired: false,
    shaderF16: false,
  };

  if (!capability.secureContext) {
    capability.reason = "WebGPU requires HTTPS or localhost";
    return capability;
  }

  if (!capability.hasWebgpu) {
    capability.reason = "WebGPU is not available in this browser";
    return capability;
  }

  const estimate = await navigator.storage?.estimate().catch(() => undefined);
  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: "high-performance",
  });

  if (!adapter) {
    capability.reason = "No WebGPU adapter was returned";
    return capability;
  }

  capability.adapterAcquired = true;
  capability.shaderF16 = adapter.features.has("shader-f16");
  capability.limits = recordOfNumbers(adapter.limits);

  const getInfo = (adapter as GPUAdapter & {
    requestAdapterInfo?: () => Promise<Record<string, unknown>>;
  }).requestAdapterInfo;

  if (getInfo) {
    capability.adapterInfo = await getInfo.call(adapter).catch(() => undefined);
  }

  const device = await adapter.requestDevice(
    capability.shaderF16 ? { requiredFeatures: ["shader-f16"] } : undefined
  );

  capability.deviceAcquired = true;
  device.destroy();

  if (estimate) {
    const { quota, usage } = estimate;

    capability.storage = {
      quota,
      usage,
      available:
        quota === undefined || usage === undefined ? undefined : Math.max(0, quota - usage),
    };
  }

  capability.supported = true;
  return capability;
}

export async function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(errorWithName("TimeoutError", "Browser capability check timed out")),
          timeoutMs
        );
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}
