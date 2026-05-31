export {};

// ── Media asset types ──────────────────────────────────────────────────────

export interface ProductImage {
  url: string;
  localPath: string | null;
  hash?: string;
  width: number;
  height: number;
  fileSizeBytes?: number;
  originalSizeBytes?: number;
  optimized?: boolean;
  error?: string;
}

export interface ProductVideo {
  url: string;
  localPath: string | null;
  hash?: string;
  fileSizeBytes?: number;
  originalSizeBytes?: number;
  error?: string;
}

export interface DownloadStats {
  newImages: number;
  skippedImages: number;
  failedImages: number;
  newVideos: number;
  skippedVideos: number;
  failedVideos: number;
}

export interface FetchProductResult {
  success: boolean;
  jobId: string;
  productIndex: number;
  title: string;
  images: ProductImage[];
  videos: ProductVideo[];
  productDir?: string;
  stats?: DownloadStats;
  source: 'paapi' | 'scraping' | 'failed';
  error?: string;
}

export interface FetchProgressEvent {
  jobId: string;
  productIndex: number;
  message: string;
}

// ── Media library types ────────────────────────────────────────────────────

export interface ProductManifest {
  productIndex: number;
  folderName: string;
  productDir: string;
  title: string;
  images: ProductImage[];
  videos: ProductVideo[];
  hashes: string[];
  imageCount: number;
  videoCount: number;
  totalSizeBytes: number;
  updatedAt: string | null;
}

export interface DownloadMediaArgs {
  jobId: string;
  productIndex: number;
  title: string;
  imageUrls: Array<{ url: string; width?: number; height?: number }>;
  videoUrls: Array<{ url: string }>;
}

// ── App settings ───────────────────────────────────────────────────────────

export interface AppSettings {
  paapiAccessKey: string;
  paapiSecretKey: string;
  paapiPartnerTag: string;
  paapiMarketplace: string;
  mediaBaseDir: string;
  autoSave: boolean;
  notifications: boolean;
  quality: string;
  gpuMode: 'auto' | 'cpu' | 'nvidia' | 'amd' | 'intel';
}

export interface GpuInfo {
  encoder: string;
  type: 'nvidia' | 'amd' | 'intel' | 'apple' | 'cpu';
  label: string;
}

export interface GenerateVideoPayload {
  timelineSegments: Array<{
    productIndex: number;
    startTime: number;
    endTime: number;
    duration: number;
    audioPath: string;
  }>;
  audioMode: 'single' | 'multi';
  style: string;
  quality: string;
  projectId?: string;
  manualOverrides?: Array<{
    productIndex: number;
    clips: Array<{ productIndex: number; clipIndex: number; duration?: number; motion?: string; path?: string }>;
  }>;
}

export interface GenerateVideoResult {
  success: boolean;
  message: string;
  outputPath?: string | null;
  planPath?: string;
  planOnly?: boolean;
}

export interface VideoProgressEvent {
  message: string;
}

// ── Distribution preview types ─────────────────────────────────────────────

export interface DistributionClip {
  type: 'image' | 'video' | 'blank';
  path: string | null;
  duration: number;
  motion: string | null;
  zoomFrom?: number;
  zoomTo?: number;
  xBias?: number;
  yBias?: number;
  looped: boolean;
  productIndex: number;
}

export interface DistributionTrack {
  productIndex: number;
  startTime: number;
  endTime: number;
  duration: number;
  mediaCount: number;
  clipCount: number;
  clips: DistributionClip[];
}

export interface RenderPlan {
  version: number;
  style: string;
  quality: string;
  resolution: { width: number; height: number };
  fps: number;
  totalDuration: number;
  audioMode: string;
  tracks: DistributionTrack[];
  createdAt: string;
}

export interface PreviewDistributionResult {
  success: boolean;
  plan?: RenderPlan;
  error?: string;
}

// ── Audio types ────────────────────────────────────────────────────────────

export type AudioMode = 'single' | 'multi';

export interface SaveAudioFileArgs {
  sourcePath: string;
  mode: AudioMode;
  productIndex: number | null;
  originalName: string;
}

export interface SaveAudioFileResult {
  success: boolean;
  localPath?: string;
  fileName?: string;
  fileSizeBytes?: number;
  error?: string;
}

// ── Window API ─────────────────────────────────────────────────────────────

declare global {
  interface Window {
    electronAPI?: {
      minimizeWindow: () => void;
      maximizeWindow: () => void;
      closeWindow: () => void;
      generateVideo: (p: GenerateVideoPayload) => Promise<GenerateVideoResult>;
      onVideoProgress: (cb: (d: VideoProgressEvent) => void) => () => void;

      loadSettings: () => Promise<AppSettings>;
      saveSettings: (s: Partial<AppSettings>) => Promise<AppSettings>;
      detectGpu: () => Promise<GpuInfo>;

      fetchProduct: (a: { jobId: string; productUrl: string; productIndex: number }) => Promise<FetchProductResult>;
      fetchAllProducts: (a: { products: Array<{ jobId: string; productUrl: string; productIndex: number }> }) => Promise<FetchProductResult[]>;
      onFetchProgress: (cb: (d: FetchProgressEvent) => void) => () => void;

      downloadProductMedia: (a: DownloadMediaArgs) => Promise<{ success: boolean; jobId: string; productIndex: number; images?: ProductImage[]; videos?: ProductVideo[]; stats?: DownloadStats; error?: string }>;
      getMediaIndex: () => Promise<ProductManifest[]>;
      getMediaDir: () => Promise<string>;
      openFolder: (p: string) => Promise<string>;
      onDownloadProgress: (cb: (d: FetchProgressEvent) => void) => () => void;

      saveAudioFile: (a: SaveAudioFileArgs) => Promise<SaveAudioFileResult>;
      deleteAudioFile: (localPath: string) => Promise<{ success: boolean; error?: string }>;
      getAudioDir: () => Promise<string>;
      previewDistribution: (a: { timelineSegments: GenerateVideoPayload['timelineSegments']; style: string; quality: string }) => Promise<PreviewDistributionResult>;
    };
  }
}
