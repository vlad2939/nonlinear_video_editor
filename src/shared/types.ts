export type MediaType = "video" | "audio" | "image" | "color";
export type TrackType = "video" | "transition" | "audio" | "text";
export type ExportPreset = "fast" | "medium" | "slow";
export type TextAlign = "left" | "center" | "right";
export type LogoPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right";
export type LogoSize = "small" | "medium" | "large";
export type PipPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right" | "custom";
export type PipSize = "small" | "medium" | "large" | "custom";
export type TransitionType =
  | "cross-dissolve"
  | "dip-to-black"
  | "dip-to-white"
  | "fade"
  | "wipe-left"
  | "wipe-right"
  | "wipe-up"
  | "wipe-down"
  | "slide-left"
  | "slide-right"
  | "zoom"
  | "blur-dissolve"
  | "luma-fade";

export interface ProjectExportSettings {
  width: number;
  height: number;
  fps: number;
  crf: number;
  preset: ExportPreset;
  audioBitrate: string;
  logoPath?: string;
  logoPosition: LogoPosition;
  logoSize: LogoSize;
  logoTransparency: number;
}

export interface MediaAsset {
  id: string;
  name: string;
  path: string;
  type: MediaType;
  duration: number;
  color?: string;
  thumbnailPath?: string;
  waveformPath?: string;
}

export interface TimelineClip {
  id: string;
  trackId: string;
  type: TrackType;
  assetId?: string;
  name: string;
  start: number;
  duration: number;
  sourceIn: number;
  sourceOut: number;
  volume: number;
  fadeIn?: number;
  fadeOut?: number;
  color?: {
    value: string;
  };
  pip?: {
    position: PipPosition;
    size: PipSize;
    scalePercent: number;
    x: number;
    y: number;
    opacity: number;
    border: boolean;
    shadow: boolean;
  };
  transition?: {
    kind: TransitionType;
  };
  text?: {
    content: string;
    fontSize: number;
    color: string;
    x: number;
    y: number;
    fontWeight?: number;
    italic?: boolean;
    align?: TextAlign;
    opacity?: number;
    backgroundColor?: string;
    backgroundOpacity?: number;
    outlineColor?: string;
    outlineWidth?: number;
    shadowColor?: string;
    shadowBlur?: number;
  };
}

export interface Track {
  id: string;
  name: string;
  type: TrackType;
  clips: TimelineClip[];
}

export interface Project {
  id: string;
  name: string;
  path?: string;
  createdAt: string;
  updatedAt: string;
  assets: MediaAsset[];
  tracks: Track[];
  duration: number;
  exportSettings?: ProjectExportSettings;
}

export interface ExportOptions {
  outputPath?: string;
  width: number;
  height: number;
  fps: number;
  crf?: number;
  preset?: ExportPreset;
  audioBitrate?: string;
  previewWidth?: number;
  previewHeight?: number;
  logoPath?: string;
  logoPosition?: LogoPosition;
  logoSize?: LogoSize;
  logoTransparency?: number;
}

export interface ExportResult {
  ok: boolean;
  outputPath?: string;
  message: string;
}

export interface ImportResult {
  accepted: MediaAsset[];
  rejected: string[];
}

export interface AudioFitRequest {
  sourcePath: string;
  targetSeconds: number;
}

export interface AudioFitResult {
  ok: boolean;
  message: string;
  outputPath?: string;
  duration?: number;
}

export interface RecoverySnapshot {
  project: Project;
  savedAt: string;
}

export interface ProjectValidationResult {
  ok: boolean;
  missing: string[];
}

export interface NativeApi {
  media: {
    import: () => Promise<ImportResult>;
    thumbnail: (asset: MediaAsset) => Promise<string | undefined>;
  };
  audioFit: {
    render: (request: AudioFitRequest) => Promise<AudioFitResult>;
  };
  project: {
    create: () => Promise<Project | undefined>;
    save: (project: Project) => Promise<Project | undefined>;
    open: () => Promise<Project | undefined>;
    validate: (project: Project) => Promise<ProjectValidationResult>;
  };
  recovery: {
    load: () => Promise<RecoverySnapshot | undefined>;
    save: (project: Project) => Promise<void>;
    clear: () => Promise<void>;
  };
  export: {
    selectLogo: () => Promise<string | undefined>;
    render: (project: Project, options: ExportOptions) => Promise<ExportResult>;
    onProgress: (callback: (progress: number) => void) => () => void;
  };
}
