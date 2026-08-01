import type { ExecutionProfile } from "./execution-profile";
import type {
  BrowserCapability,
  ClassificationResult,
  ImageDescriptor,
  InferenceConfig,
  ProgressEvent,
  Region,
} from "../types";

export type ProgressListener = (event: ProgressEvent) => void | Promise<void>;
export type DeviceLostListener = (reason: string) => void | Promise<void>;

export type WorkerClassifyRequest = Readonly<{
  imageId: string;
  region: Region;
  config: InferenceConfig;
  jobId: number;
}>;

export interface WorkerApi {
  probe(config: InferenceConfig): Promise<BrowserCapability>;
  prepare(
    config: InferenceConfig,
    warmup: boolean,
    onProgress?: ProgressListener,
    profile?: ExecutionProfile
  ): Promise<void>;
  loadImage(
    descriptor: ImageDescriptor,
    bytes: ArrayBuffer,
    config: InferenceConfig
  ): Promise<void>;
  releaseImage(imageId: string): Promise<boolean>;
  classify(
    request: WorkerClassifyRequest,
    onProgress?: ProgressListener
  ): Promise<ClassificationResult>;
  cancel(jobId?: number): Promise<void>;
  setDeviceLostListener(listener?: DeviceLostListener): Promise<void>;
  dispose(): Promise<void>;
}
