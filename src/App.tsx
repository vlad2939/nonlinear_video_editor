import { useEffect, useMemo, useRef, useState, type CSSProperties, type WheelEvent } from "react";
import {
  Copy,
  FileDown,
  FileText,
  FilePlus2,
  FileUp,
  FolderOpen,
  Keyboard,
  Maximize2,
  Moon,
  Pause,
  Play,
  Redo2,
  Save,
  Scissors,
  Shuffle,
  SkipBack,
  Sun,
  Trash2,
  Type,
  Undo2,
  Video,
  ZoomIn
} from "lucide-react";
import type { AudioFitResult, ExportResult, MediaAsset, Project, ProjectExportSettings, RecoverySnapshot, TimelineClip, Track, TrackType, TransitionType } from "./shared/types";
import readmeText from "../README.md?raw";

const minTimelineZoom = 5;
const maxTimelineZoom = 140;
const snap = 0.25;
const snapThreshold = 0.18;
const trackLabelWidth = 112;
const titleCanvasWidth = 1920;
const titleCanvasHeight = 1080;
const primaryVideoTrackId = "track-video-1";
const pipVideoTrackId = "track-video-2";
type MediaTab = "video" | "audio" | "image" | "color";
const mediaTabs: Array<{ id: MediaTab; label: string }> = [
  { id: "video", label: "Video" },
  { id: "audio", label: "Audio" },
  { id: "image", label: "Image" },
  { id: "color", label: "Colour" }
];

type ExportPresetId = "custom" | "youtube-1080p" | "youtube-4k" | "instagram-reels" | "tiktok" | "facebook" | "whatsapp";
type AudioFitModalState = {
  clipId: string;
  sourcePath: string;
  targetSeconds: number;
  status: "rendering" | "ready" | "error";
  message: string;
  result?: AudioFitResult;
};
const exportPresets: Array<{ id: ExportPresetId; label: string; settings?: Pick<ProjectExportSettings, "width" | "height" | "fps" | "crf" | "preset" | "audioBitrate"> }> = [
  { id: "custom", label: "Custom" },
  { id: "youtube-1080p", label: "YouTube 1080p", settings: { width: 1920, height: 1080, fps: 30, crf: 20, preset: "medium", audioBitrate: "192k" } },
  { id: "youtube-4k", label: "YouTube 4K", settings: { width: 3840, height: 2160, fps: 30, crf: 18, preset: "slow", audioBitrate: "256k" } },
  { id: "instagram-reels", label: "Instagram Reels", settings: { width: 1080, height: 1920, fps: 30, crf: 20, preset: "medium", audioBitrate: "192k" } },
  { id: "tiktok", label: "TikTok", settings: { width: 1080, height: 1920, fps: 30, crf: 20, preset: "medium", audioBitrate: "192k" } },
  { id: "facebook", label: "Facebook", settings: { width: 1920, height: 1080, fps: 30, crf: 21, preset: "medium", audioBitrate: "192k" } },
  { id: "whatsapp", label: "WhatsApp", settings: { width: 1280, height: 720, fps: 30, crf: 24, preset: "fast", audioBitrate: "128k" } }
];

const shortcutGroups = [
  {
    title: "Playback",
    items: [
      ["Space", "Play / Pause"],
      ["Home", "Back to start"],
      ["End", "Jump to end"],
      ["Left / Right", "Move playhead by 1 second"],
      ["Shift + Left / Right", "Move playhead by 5 seconds"],
      ["Shift + F", "Fullscreen preview"]
    ]
  },
  {
    title: "Timeline Editing",
    items: [
      ["Delete / Backspace", "Delete selected clips"],
      ["S", "Split selected clip at playhead"],
      ["Ctrl + C", "Copy selected clip"],
      ["Ctrl + D", "Duplicate selected clip after itself"],
      ["T", "Add title"],
      ["R", "Add transition"],
      ["L", "Add / replace logo"],
      ["I", "Toggle Insert Mode"]
    ]
  },
  {
    title: "Timeline View",
    items: [
      ["+", "Zoom timeline in"],
      ["-", "Zoom timeline out"],
      ["Z", "Zoom timeline to fit"],
      ["Mouse wheel", "Vertical timeline scroll"],
      ["Shift + mouse wheel", "Horizontal timeline pan"],
      ["Ctrl + mouse wheel", "Zoom timeline around cursor"]
    ]
  },
  {
    title: "Project And Panels",
    items: [
      ["Ctrl + S", "Save project"],
      ["Ctrl + O", "Load project"],
      ["Ctrl + Z", "Undo"],
      ["Ctrl + Y", "Redo"],
      ["E", "Open Export panel"],
      ["?", "Open Shortcuts popup"],
      ["Escape", "Close popup or context menu"]
    ]
  },
  {
    title: "Window Zoom",
    items: [
      ["Ctrl + +", "Increase app window zoom"],
      ["Ctrl + -", "Decrease app window zoom"],
      ["Ctrl + 0", "Reset app window zoom"]
    ]
  }
] as const;

const colorMediaAsset: MediaAsset = {
  id: "asset-colour-background",
  name: "Colour background",
  path: "",
  type: "color",
  duration: 5,
  color: "#111827"
};

const defaultExportSettings: ProjectExportSettings = {
  width: 1920,
  height: 1080,
  fps: 30,
  crf: 20,
  preset: "medium",
  audioBitrate: "192k",
  logoPosition: "top-left",
  logoSize: "small",
  logoTransparency: 50
};

const defaultTextStyle = {
  content: "Title",
  fontSize: 42,
  color: "#ffffff",
  x: 80,
  y: 76,
  fontWeight: 800,
  italic: false,
  align: "left" as const,
  opacity: 1,
  backgroundColor: "#000000",
  backgroundOpacity: 0,
  outlineColor: "#000000",
  outlineWidth: 0,
  shadowColor: "#000000",
  shadowBlur: 12
};

const defaultPipStyle: NonNullable<TimelineClip["pip"]> = {
  position: "top-right",
  size: "medium",
  scalePercent: 32,
  x: 64,
  y: 64,
  opacity: 1,
  border: true,
  shadow: true
};

const transitionOptions: Array<{ value: TransitionType; label: string }> = [
  { value: "cross-dissolve", label: "Cross dissolve" },
  { value: "dip-to-black", label: "Dip to black" },
  { value: "dip-to-white", label: "Dip to white" },
  { value: "fade", label: "Fade" },
  { value: "wipe-left", label: "Wipe left" },
  { value: "wipe-right", label: "Wipe right" },
  { value: "wipe-up", label: "Wipe up" },
  { value: "wipe-down", label: "Wipe down" },
  { value: "slide-left", label: "Slide left" },
  { value: "slide-right", label: "Slide right" },
  { value: "zoom", label: "Zoom" },
  { value: "blur-dissolve", label: "Blur dissolve" },
  { value: "luma-fade", label: "Luma fade" }
];

function transitionLabel(kind: TransitionType) {
  return transitionOptions.find((option) => option.value === kind)?.label ?? "Cross dissolve";
}

function uid(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function now() {
  return new Date().toISOString();
}

function starterProject(): Project {
  return {
    id: uid("project"),
    name: "Untitled Edit",
    createdAt: now(),
    updatedAt: now(),
    assets: [],
    duration: 30,
    exportSettings: defaultExportSettings,
    tracks: [
      { id: primaryVideoTrackId, name: "Video 1", type: "video", clips: [] },
      { id: pipVideoTrackId, name: "Video 2 / PiP", type: "video", clips: [] },
      { id: "track-transition-1", name: "Transitions", type: "transition", clips: [] },
      { id: "track-audio-1", name: "Audio 1", type: "audio", clips: [] },
      { id: "track-text-1", name: "Titles", type: "text", clips: [] }
    ]
  };
}

function normalizeProject(project: Project): Project {
  const existingTracks = project.tracks ?? [];
  const hasTransitionTrack = existingTracks.some((track) => track.type === "transition");
  const withTransitions = hasTransitionTrack
    ? existingTracks
    : existingTracks.flatMap((track) => track.type === "video"
      ? [track, { id: "track-transition-1", name: "Transitions", type: "transition" as const, clips: [] }]
      : [track]);
  const tracks = withTransitions.some((track) => track.id === pipVideoTrackId)
    ? withTransitions
    : withTransitions.flatMap((track) => track.id === primaryVideoTrackId || (track.type === "video" && !withTransitions.some((item) => item.id === primaryVideoTrackId))
      ? [track, { id: pipVideoTrackId, name: "Video 2 / PiP", type: "video" as const, clips: [] }]
      : [track]);
  const trackOrder = (track: Track) => {
    if (track.id === primaryVideoTrackId) return 0;
    if (track.id === pipVideoTrackId) return 1;
    const order: Record<TrackType, number> = { video: 2, transition: 3, audio: 4, text: 5 };
    return order[track.type];
  };
  const orderedTracks = [...tracks].sort((a, b) => trackOrder(a) - trackOrder(b));
  return {
    ...project,
    exportSettings: { ...defaultExportSettings, ...(project.exportSettings ?? {}) },
    tracks: orderedTracks.map((track) => ({
      ...track,
      clips: track.clips.map((clip) => ({
        ...clip,
        fadeIn: clip.fadeIn ?? 0,
        fadeOut: clip.fadeOut ?? 0,
        color: clip.color,
        pip: track.id === pipVideoTrackId ? { ...defaultPipStyle, ...(clip.pip ?? {}) } : clip.pip,
        transition: clip.type === "transition"
          ? { kind: clip.transition?.kind ?? "cross-dissolve" }
          : undefined,
        text: clip.text
          ? { ...defaultTextStyle, ...clip.text }
          : clip.type === "text"
            ? { ...defaultTextStyle, content: clip.name }
            : undefined
      }))
    }))
  };
}

function seconds(value: number) {
  const minutes = Math.floor(value / 60);
  const secs = Math.floor(value % 60);
  const frames = Math.floor((value % 1) * 24);
  return `${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}.${frames.toString().padStart(2, "0")}`;
}

function fileUrl(path: string) {
  return `file://${path.replace(/\\/g, "/").replace(/#/g, "%23")}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function roundTime(value: number, precision = 2) {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(precision));
}

function timeInputValue(value: number) {
  return roundTime(value).toString();
}

function clipVolumeAt(clip: TimelineClip, time: number) {
  const localTime = clamp(time - clip.start, 0, clip.duration);
  const fadeIn = Math.max(0, clip.fadeIn ?? 0);
  const fadeOut = Math.max(0, clip.fadeOut ?? 0);
  const fadeInGain = fadeIn > 0 ? clamp(localTime / fadeIn, 0, 1) : 1;
  const fadeOutGain = fadeOut > 0 ? clamp((clip.duration - localTime) / fadeOut, 0, 1) : 1;
  return clamp(clip.volume * Math.min(fadeInGain, fadeOutGain), 0, 1);
}

function maxSourceDuration(clip: TimelineClip, asset?: MediaAsset) {
  if (!asset || (asset.type !== "video" && asset.type !== "audio")) return Number.POSITIVE_INFINITY;
  return Math.max(0.5, asset.duration - clip.sourceIn);
}

function hexToRgba(hex: string, alpha: number) {
  const normalized = hex.replace("#", "");
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1)})`;
}

function logoPreviewStyle(settings: ProjectExportSettings): CSSProperties {
  const inset = "clamp(12px, 1.5cqw, 24px)";
  const width = settings.logoSize === "large"
    ? "clamp(40px, 11cqw, 140px)"
    : settings.logoSize === "medium"
      ? "clamp(32px, 7.5cqw, 96px)"
      : "clamp(24px, 5cqw, 64px)";
  const style: CSSProperties = {
    width,
    opacity: clamp(1 - settings.logoTransparency / 100, 0.1, 1)
  };
  if (settings.logoPosition.includes("top")) style.top = inset;
  else style.bottom = inset;
  if (settings.logoPosition.includes("left")) style.left = inset;
  else style.right = inset;
  return style;
}

function pipPreviewStyle(clip: TimelineClip, playhead: number): CSSProperties {
  const pip = { ...defaultPipStyle, ...(clip.pip ?? {}) };
  const width = pip.size === "large"
    ? "42%"
    : pip.size === "medium"
      ? "32%"
      : pip.size === "small"
        ? "22%"
        : `${clamp(pip.scalePercent, 5, 100)}%`;
  const inset = "3%";
  const style: CSSProperties = {
    width,
    aspectRatio: "16 / 9",
    opacity: pip.opacity * clipVolumeAt({ ...clip, volume: 1 }, playhead),
    border: pip.border ? "2px solid rgba(255, 255, 255, 0.72)" : "0",
    boxShadow: pip.shadow ? "0 14px 38px rgba(0, 0, 0, 0.48)" : "none"
  };
  if (pip.position === "custom") {
    style.left = `${clamp(pip.x, 0, 100)}%`;
    style.top = `${clamp(pip.y, 0, 100)}%`;
  } else {
    if (pip.position.includes("top")) style.top = inset;
    else style.bottom = inset;
    if (pip.position.includes("left")) style.left = inset;
    else style.right = inset;
  }
  return style;
}

function timelineEnd(project: Project) {
  return Math.max(30, ...project.tracks.flatMap((track) => track.clips.map((clip) => clip.start + clip.duration)));
}

function updateProject(project: Project, updater: (draft: Project) => void): Project {
  const draft = structuredClone(normalizeProject(project));
  updater(draft);
  draft.updatedAt = now();
  draft.duration = timelineEnd(draft) + 2;
  return draft;
}

function visualAt(project: Project, time: number) {
  const assets = new Map(project.assets.map((asset) => [asset.id, asset]));
  return project.tracks
    .filter((track) => track.type === "video" && track.id !== pipVideoTrackId)
    .flatMap((track) => track.clips)
    .sort((a, b) => a.start - b.start)
    .find((clip) => {
      const assetType = clip.assetId ? assets.get(clip.assetId)?.type : undefined;
      return clip.start <= time && clip.start + clip.duration > time && (Boolean(clip.color) || (clip.assetId && (assetType === "video" || assetType === "image")));
    });
}

function pipAt(project: Project, time: number) {
  const assets = new Map(project.assets.map((asset) => [asset.id, asset]));
  return project.tracks
    .filter((track) => track.id === pipVideoTrackId)
    .flatMap((track) => track.clips)
    .filter((clip) => {
      const assetType = clip.assetId ? assets.get(clip.assetId)?.type : undefined;
      return clip.start <= time && clip.start + clip.duration > time && (Boolean(clip.color) || (clip.assetId && (assetType === "video" || assetType === "image")));
    })
    .sort((a, b) => a.start - b.start);
}

function transitionAt(project: Project, time: number) {
  return project.tracks
    .filter((track) => track.type === "transition")
    .flatMap((track) => track.clips)
    .sort((a, b) => b.start - a.start)
    .find((clip) => clip.start <= time && clip.start + clip.duration >= time);
}

function transitionPair(project: Project, time: number) {
  const transition = transitionAt(project, time);
  if (!transition) return undefined;
  const transitionCut = transition.start + transition.duration / 2;
  const clips = project.tracks
    .filter((track) => track.type === "video" && track.id !== pipVideoTrackId)
    .flatMap((track) => track.clips)
    .filter((clip) => clip.assetId || clip.color)
    .sort((a, b) => a.start - b.start);
  const outgoing = clips
    .filter((clip) => clip.start <= transitionCut && clip.start + clip.duration >= transitionCut)
    .at(-1) ?? clips.filter((clip) => clip.start < transitionCut).at(-1);
  const incoming = clips.find((clip) => clip.id !== outgoing?.id && clip.start >= transitionCut - snapThreshold)
    ?? clips.find((clip) => clip.id !== outgoing?.id && clip.start + clip.duration > transitionCut);
  if (!outgoing || !incoming) return undefined;
  const progress = clamp((time - transition.start) / Math.max(0.1, transition.duration), 0, 1);
  return { transition, outgoing, incoming, progress };
}

function nearestVideoCut(project: Project, time: number, maxDistance = 5) {
  const videoClips = project.tracks
    .filter((track) => track.type === "video" && track.id !== pipVideoTrackId)
    .flatMap((track) => track.clips)
    .filter((clip) => clip.assetId || clip.color);
  const starts = new Set(videoClips.map((clip) => roundTime(clip.start)));
  const cuts = videoClips
    .map((clip) => roundTime(clip.start + clip.duration))
    .filter((end) => starts.has(end));
  const nearest = cuts
    .map((cut) => ({ cut, distance: Math.abs(cut - time) }))
    .filter((item) => item.distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance)[0];
  return nearest?.cut;
}

function audioAt(project: Project, time: number) {
  const assets = new Map(project.assets.map((asset) => [asset.id, asset]));
  return project.tracks
    .filter((track) => track.type === "audio")
    .flatMap((track) => track.clips)
    .filter((clip) => clip.start <= time && clip.start + clip.duration > time && clip.assetId && assets.get(clip.assetId)?.type === "audio");
}

function incomingTransitionStyle(kind: TransitionType, progress: number): CSSProperties {
  const eased = clamp(progress, 0, 1);
  if (kind === "wipe-left") return { clipPath: `inset(0 ${100 - eased * 100}% 0 0)` };
  if (kind === "wipe-right") return { clipPath: `inset(0 0 0 ${100 - eased * 100}%)` };
  if (kind === "wipe-up") return { clipPath: `inset(${100 - eased * 100}% 0 0 0)` };
  if (kind === "wipe-down") return { clipPath: `inset(0 0 ${100 - eased * 100}% 0)` };
  if (kind === "slide-left") return { opacity: 1, transform: `translateX(${(1 - eased) * 100}%)` };
  if (kind === "slide-right") return { opacity: 1, transform: `translateX(${(eased - 1) * 100}%)` };
  if (kind === "zoom") return { opacity: eased, transform: `scale(${0.86 + eased * 0.14})` };
  if (kind === "blur-dissolve") return { opacity: eased, filter: `blur(${(1 - eased) * 16}px)` };
  if (kind === "luma-fade") return { opacity: Math.pow(eased, 1.5), filter: `brightness(${0.7 + eased * 0.3}) contrast(${0.9 + eased * 0.1})` };
  if (kind === "dip-to-black" || kind === "dip-to-white") return { opacity: eased < 0.5 ? 0 : (eased - 0.5) * 2 };
  return { opacity: eased };
}

function outgoingTransitionStyle(kind: TransitionType, progress: number): CSSProperties {
  const eased = clamp(progress, 0, 1);
  if (kind === "slide-left") return { transform: `translateX(${-eased * 35}%)` };
  if (kind === "slide-right") return { transform: `translateX(${eased * 35}%)` };
  if (kind === "zoom") return { transform: `scale(${1 + eased * 0.08})`, opacity: 1 - eased * 0.35 };
  if (kind === "blur-dissolve") return { filter: `blur(${eased * 12}px)`, opacity: 1 - eased };
  if (kind === "luma-fade") return { filter: `brightness(${1 + eased * 0.35}) contrast(${1 - eased * 0.2})`, opacity: 1 - eased };
  if (kind === "dip-to-black" || kind === "dip-to-white") return { opacity: eased < 0.5 ? 1 - eased * 2 : 0 };
  return {};
}

function transitionWashStyle(kind: TransitionType, progress: number): CSSProperties | undefined {
  if (kind !== "dip-to-black" && kind !== "dip-to-white") return undefined;
  const peak = 1 - Math.abs(progress - 0.5) * 2;
  return {
    background: kind === "dip-to-white" ? "#fff" : "#000",
    opacity: clamp(peak, 0, 1)
  };
}

function waveformBars(seed: string, count = 64) {
  let value = 0;
  for (let index = 0; index < seed.length; index += 1) value = (value * 31 + seed.charCodeAt(index)) >>> 0;
  return Array.from({ length: count }, (_, index) => {
    value = (value * 1664525 + 1013904223 + index) >>> 0;
    const random = value / 0xffffffff;
    const phrase = 0.55 + 0.24 * Math.sin(index * 0.28) + 0.18 * Math.sin(index * 0.91);
    const transient = index % 9 === 0 ? 0.32 : index % 5 === 0 ? 0.18 : 0;
    return clamp(16 + (phrase + random * 0.45 + transient) * 58, 14, 96);
  });
}

function snapTimeToClips(project: Project, time: number, movingClip?: TimelineClip, options?: { enabled?: boolean; playhead?: number; excludeClipIds?: string[] }) {
  if (options?.enabled === false) return roundTime(Math.max(0, time));
  const duration = movingClip?.duration ?? 0;
  const centerOffset = duration / 2;
  const excluded = new Set(options?.excludeClipIds ?? []);
  const edges = project.tracks.flatMap((track) =>
    track.clips
      .filter((clip) => clip.id !== movingClip?.id && !excluded.has(clip.id))
      .flatMap((clip) => [clip.start, clip.start + clip.duration])
  ).concat(options?.playhead !== undefined ? [options.playhead] : []);
  let next = Math.max(0, Math.round(time / snap) * snap);
  for (const edge of edges) {
    if (Math.abs(time - edge) <= snapThreshold) next = edge;
    if (movingClip && Math.abs(time + duration - edge) <= snapThreshold) next = Math.max(0, edge - duration);
    if (movingClip?.type === "transition" && Math.abs(time + centerOffset - edge) <= snapThreshold) next = Math.max(0, edge - centerOffset);
  }
  return roundTime(Math.max(0, next));
}

function snapPointToClips(project: Project, time: number, excludeClipId?: string, options?: { enabled?: boolean; playhead?: number }) {
  if (options?.enabled === false) return roundTime(Math.max(0, time));
  const edges = project.tracks.flatMap((track) =>
    track.clips
      .filter((clip) => clip.id !== excludeClipId)
      .flatMap((clip) => [clip.start, clip.start + clip.duration])
  ).concat(options?.playhead !== undefined ? [options.playhead] : []);
  let next = Math.max(0, Math.round(time / snap) * snap);
  for (const edge of edges) {
    if (Math.abs(time - edge) <= snapThreshold) next = edge;
  }
  return roundTime(Math.max(0, next));
}

function snapGuideTime(project: Project, time: number, movingClip?: TimelineClip, options?: { enabled?: boolean; playhead?: number; excludeClipIds?: string[] }) {
  if (options?.enabled === false) return undefined;
  const duration = movingClip?.duration ?? 0;
  const centerOffset = duration / 2;
  const excluded = new Set(options?.excludeClipIds ?? []);
  const edges = project.tracks.flatMap((track) =>
    track.clips
      .filter((clip) => clip.id !== movingClip?.id && !excluded.has(clip.id))
      .flatMap((clip) => [clip.start, clip.start + clip.duration])
  ).concat(options?.playhead !== undefined ? [options.playhead] : []);
  for (const edge of edges) {
    if (Math.abs(time - edge) <= snapThreshold) return edge;
    if (movingClip && Math.abs(time + duration - edge) <= snapThreshold) return edge;
    if (movingClip?.type === "transition" && Math.abs(time + centerOffset - edge) <= snapThreshold) return edge;
  }
  return undefined;
}

function renderReadme(markdown: string) {
  const nodes: JSX.Element[] = [];
  const lines = markdown.split(/\r?\n/);
  let codeLines: string[] = [];
  let inCode = false;

  lines.forEach((line, index) => {
    if (line.startsWith("```")) {
      if (inCode) {
        nodes.push(<pre key={`code-${index}`}><code>{codeLines.join("\n")}</code></pre>);
        codeLines = [];
      }
      inCode = !inCode;
      return;
    }
    if (inCode) {
      codeLines.push(line);
      return;
    }
    if (!line.trim()) {
      nodes.push(<div key={`space-${index}`} className="readme-space" />);
      return;
    }
    if (line.startsWith("# ")) nodes.push(<h1 key={index}>{line.slice(2)}</h1>);
    else if (line.startsWith("## ")) nodes.push(<h2 key={index}>{line.slice(3)}</h2>);
    else if (line.startsWith("### ")) nodes.push(<h3 key={index}>{line.slice(4)}</h3>);
    else if (line.startsWith("- ")) nodes.push(<p key={index} className="readme-bullet">{line.slice(2)}</p>);
    else nodes.push(<p key={index}>{line}</p>);
  });

  return nodes;
}

export function App() {
  const [project, setProject] = useState<Project>(() => {
    const saved = localStorage.getItem("nve.recentProject");
    return normalizeProject(saved ? JSON.parse(saved) : starterProject());
  });
  const [selectedClipId, setSelectedClipId] = useState<string | undefined>();
  const [selectedClipIds, setSelectedClipIds] = useState<string[]>([]);
  const [playhead, setPlayhead] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [message, setMessage] = useState("Ready");
  const [exportProgress, setExportProgress] = useState<number | undefined>();
  const [inspectorMode, setInspectorMode] = useState<"clip" | "export" | "logo">("clip");
  const [showNewConfirm, setShowNewConfirm] = useState(false);
  const [showReadme, setShowReadme] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showFullscreenHint, setShowFullscreenHint] = useState(false);
  const [recoverySnapshot, setRecoverySnapshot] = useState<RecoverySnapshot | undefined>();
  const [theme, setTheme] = useState<"dark" | "light">(() =>
    localStorage.getItem("nve.theme") === "light" ? "light" : "dark"
  );
  const [history, setHistory] = useState<Project[]>([]);
  const [future, setFuture] = useState<Project[]>([]);
  const [timelineZoom, setTimelineZoom] = useState(40);
  const [activeMediaTab, setActiveMediaTab] = useState<MediaTab>("video");
  const [activeExportPreset, setActiveExportPreset] = useState<ExportPresetId>("custom");
  const [contextMenu, setContextMenu] = useState<{ clipId: string; x: number; y: number; time: number }>();
  const [gapMenu, setGapMenu] = useState<{ trackId: string; x: number; y: number; time: number }>();
  const [audioFitModal, setAudioFitModal] = useState<AudioFitModalState>();
  const [insertMode, setInsertMode] = useState(false);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [snapToPlayhead, setSnapToPlayhead] = useState(true);
  const [snapGuide, setSnapGuide] = useState<number | undefined>();
  const [isDraggingPlayhead, setIsDraggingPlayhead] = useState(false);
  const timelineShellRef = useRef<HTMLElement>(null);
  const timelineRulerRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const audioRefs = useRef(new Map<string, HTMLAudioElement>());
  const thumbnailRequests = useRef(new Set<string>());
  const projectRef = useRef(project);
  const hasDesktopApi = Boolean(window.nativeApi);

  const selectedClip = useMemo(
    () => project.tracks.flatMap((track) => track.clips).find((clip) => clip.id === selectedClipId),
    [project, selectedClipId]
  );
  const selectedAsset = useMemo(
    () => project.assets.find((asset) => asset.id === selectedClip?.assetId),
    [project.assets, selectedClip]
  );
  const exportSettings = project.exportSettings ?? defaultExportSettings;

  const activeVisualClip = useMemo(() => visualAt(project, playhead), [project, playhead]);
  const activePipClips = useMemo(() => pipAt(project, playhead), [project, playhead]);
  const activeTransition = useMemo(() => transitionPair(project, playhead), [project, playhead]);
  const baseVisualClip = activeTransition?.outgoing ?? activeVisualClip;
  const baseVisualAsset = useMemo(
    () => baseVisualClip?.color ? colorMediaAsset : project.assets.find((asset) => asset.id === baseVisualClip?.assetId),
    [project.assets, baseVisualClip]
  );
  const incomingVisualAsset = useMemo(
    () => activeTransition?.incoming.color ? colorMediaAsset : project.assets.find((asset) => asset.id === activeTransition?.incoming.assetId),
    [project.assets, activeTransition]
  );
  const activeAudioClips = useMemo(() => audioAt(project, playhead), [project, playhead]);
  const selectedTrack = useMemo(
    () => project.tracks.find((track) => track.clips.some((clip) => clip.id === selectedClipId)),
    [project.tracks, selectedClipId]
  );
  const isSelectedPipClip = selectedTrack?.id === pipVideoTrackId && selectedClip?.type === "video";
  const editEnd = useMemo(() => timelineEnd(project), [project]);
  const videoEditEnd = useMemo(
    () => Math.max(0, ...project.tracks
      .filter((track) => track.type === "video")
      .flatMap((track) => track.clips.map((clip) => clip.start + clip.duration))),
    [project.tracks]
  );
  const mediaCounts = useMemo(
    () => ({
      video: project.assets.filter((asset) => asset.type === "video").length,
      audio: project.assets.filter((asset) => asset.type === "audio").length,
      image: project.assets.filter((asset) => asset.type === "image").length,
      color: 1
    }),
    [project.assets]
  );
  const visibleAssets = useMemo(
    () => activeMediaTab === "color" ? [colorMediaAsset] : project.assets.filter((asset) => asset.type === activeMediaTab),
    [activeMediaTab, project.assets]
  );
  const orderedTimelineClips = useMemo(
    () => project.tracks
      .flatMap((track, trackIndex) => track.clips.map((clip) => ({ clip, trackId: track.id, trackIndex })))
      .sort((a, b) => a.trackIndex - b.trackIndex || a.clip.start - b.clip.start),
    [project.tracks]
  );

  useEffect(() => {
    localStorage.setItem("nve.recentProject", JSON.stringify(project));
    projectRef.current = project;
  }, [project]);

  useEffect(() => {
    const existingIds = new Set(orderedTimelineClips.map(({ clip }) => clip.id));
    setSelectedClipIds((ids) => ids.filter((id) => existingIds.has(id)));
    if (selectedClipId && !existingIds.has(selectedClipId)) replaceSelection(undefined);
  }, [orderedTimelineClips, selectedClipId]);

  useEffect(() => {
    localStorage.setItem("nve.theme", theme);
  }, [theme]);

  useEffect(() => {
    if (!hasDesktopApi || !window.nativeApi) return;
    for (const asset of project.assets) {
      if ((asset.type === "video" || asset.type === "image") && !asset.thumbnailPath && !thumbnailRequests.current.has(asset.id)) {
        thumbnailRequests.current.add(asset.id);
        window.nativeApi.media.thumbnail(asset).then((thumbnailPath) => {
          if (!thumbnailPath) return;
          setProject((current) =>
            updateProject(current, (draft) => {
              const target = draft.assets.find((item) => item.id === asset.id);
              if (target) target.thumbnailPath = thumbnailPath;
            })
          );
        });
      }
    }
  }, [hasDesktopApi, project.assets]);

  useEffect(() => {
    const unsubscribe = window.nativeApi?.export.onProgress((progress) => setExportProgress(progress));
    return unsubscribe;
  }, []);

  useEffect(() => {
    window.nativeApi?.recovery.load().then((snapshot) => {
      if (!snapshot) return;
      const currentUpdated = new Date(project.updatedAt).getTime();
      const recoveredUpdated = new Date(snapshot.project.updatedAt).getTime();
      if (recoveredUpdated > currentUpdated + 1000) setRecoverySnapshot(snapshot);
    });
  }, []);

  useEffect(() => {
    if (!hasDesktopApi || !window.nativeApi) return;
    const timer = window.setInterval(() => {
      window.nativeApi?.recovery.save(projectRef.current).then(() => {
        const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        setMessage(`Autosaved ${time}`);
      });
    }, 300000);
    return () => window.clearInterval(timer);
  }, [hasDesktopApi]);

  useEffect(() => {
    function handleFullscreenChange() {
      setShowFullscreenHint(document.fullscreenElement === previewRef.current);
    }
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  useEffect(() => {
    const activeIds = new Set(activeAudioClips.map((clip) => clip.id));
    for (const [id, audio] of audioRefs.current) {
      if (!activeIds.has(id)) {
        audio.pause();
        audioRefs.current.delete(id);
      }
    }
    for (const clip of activeAudioClips) {
      const audio = audioRefs.current.get(clip.id);
      if (!audio) continue;
      const desired = clip.sourceIn + clamp(playhead - clip.start, 0, clip.duration);
      if (Math.abs(audio.currentTime - desired) > 0.25) audio.currentTime = desired;
      audio.volume = clipVolumeAt(clip, playhead);
      if (isPlaying) audio.play().catch(() => undefined);
      else audio.pause();
    }
  }, [activeAudioClips, isPlaying, playhead]);

  useEffect(() => {
    if (!isPlaying) return;
    const timer = window.setInterval(() => {
      setPlayhead((current) => {
        const next = current + 0.1;
        if (next >= editEnd) {
          setIsPlaying(false);
          return editEnd;
        }
        return next;
      });
    }, 100);
    return () => window.clearInterval(timer);
  }, [editEnd, isPlaying]);

  useEffect(() => {
    if (!isDraggingPlayhead) return;
    const previousCursor = document.body.style.cursor;
    document.body.style.cursor = "ew-resize";

    function handleMove(event: MouseEvent) {
      event.preventDefault();
      seekTimelineFromClientX(event.clientX);
      const shell = timelineShellRef.current;
      if (!shell) return;
      const rect = shell.getBoundingClientRect();
      if (event.clientX > rect.right - 28) shell.scrollLeft += 18;
      if (event.clientX < rect.left + trackLabelWidth + 28) shell.scrollLeft = Math.max(0, shell.scrollLeft - 18);
    }

    function handleUp() {
      setIsDraggingPlayhead(false);
      document.body.style.cursor = previousCursor;
    }

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
      document.body.style.cursor = previousCursor;
    };
  }, [isDraggingPlayhead, project, snapEnabled, timelineZoom]);

  useEffect(() => {
    const shell = timelineShellRef.current;
    if (!shell) return;
    const playheadX = trackLabelWidth + playhead * timelineZoom;
    const visibleLeft = shell.scrollLeft;
    const visibleRight = visibleLeft + shell.clientWidth;
    const followPoint = visibleLeft + shell.clientWidth * 0.75;
    if (isPlaying && playheadX > followPoint) {
      shell.scrollLeft = Math.min(shell.scrollWidth - shell.clientWidth, playheadX - shell.clientWidth * 0.75);
      return;
    }
    if (playheadX < visibleLeft + trackLabelWidth || playheadX > visibleRight) {
      shell.scrollLeft = Math.max(0, playheadX - shell.clientWidth * 0.25);
    }
  }, [isPlaying, playhead, timelineZoom]);

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setContextMenu(undefined);
        setGapMenu(undefined);
        setShowReadme(false);
        setShowShortcuts(false);
        setShowNewConfirm(false);
        return;
      }
      const target = event.target as HTMLElement | null;
      const isEditingText = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA";
      if (isEditingText) return;
      const key = event.key.toLowerCase();
      const hasModifier = event.ctrlKey || event.metaKey;
      if (event.code === "Space") {
        event.preventDefault();
        setIsPlaying((value) => !value);
      }
      if (event.key === "Home") {
        event.preventDefault();
        setIsPlaying(false);
        setPlayhead(0);
      }
      if (event.key === "End") {
        event.preventDefault();
        setIsPlaying(false);
        setPlayhead(editEnd);
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const direction = event.key === "ArrowRight" ? 1 : -1;
        const step = event.shiftKey ? 5 : 1;
        setPlayhead((value) => clamp(roundTime(value + direction * step), 0, editEnd));
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        deleteSelected();
      }
      if (hasModifier && key === "z") {
        event.preventDefault();
        undo();
      }
      if (hasModifier && key === "y") {
        event.preventDefault();
        redo();
      }
      if (hasModifier && key === "s") {
        event.preventDefault();
        void saveProject();
      }
      if (hasModifier && key === "o") {
        event.preventDefault();
        void openProject();
      }
      if (hasModifier && key === "c") {
        event.preventDefault();
        copySelected();
      }
      if (hasModifier && key === "d") {
        event.preventDefault();
        if (selectedClip) duplicateClip(selectedClip.id);
      }
      if (!hasModifier && key === "s") {
        event.preventDefault();
        splitSelected();
      }
      if (!hasModifier && key === "t") {
        event.preventDefault();
        addTextClip();
      }
      if (!hasModifier && key === "r") {
        event.preventDefault();
        addTransitionClip();
      }
      if (!hasModifier && key === "l") {
        event.preventDefault();
        void chooseExportLogo();
      }
      if (!hasModifier && key === "i") {
        event.preventDefault();
        setInsertMode((value) => !value);
      }
      if (!hasModifier && key === "e") {
        event.preventDefault();
        setInspectorMode("export");
      }
      if (!hasModifier && (event.key === "?" || (event.shiftKey && event.key === "/"))) {
        event.preventDefault();
        setShowShortcuts(true);
      }
      if (!hasModifier && event.shiftKey && key === "f") {
        event.preventDefault();
        void previewRef.current?.requestFullscreen?.();
      }
      if (!hasModifier && (event.key === "+" || event.key === "=")) {
        event.preventDefault();
        setTimelineZoom((value) => clamp(value + 4, minTimelineZoom, maxTimelineZoom));
      }
      if (!hasModifier && event.key === "-") {
        event.preventDefault();
        setTimelineZoom((value) => clamp(value - 4, minTimelineZoom, maxTimelineZoom));
      }
      if (!hasModifier && key === "z") {
        event.preventDefault();
        zoomTimelineToFit();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  });

  useEffect(() => {
    if (!contextMenu) return;
    function closeContextMenu() {
      setContextMenu(undefined);
    }
    window.addEventListener("click", closeContextMenu);
    window.addEventListener("resize", closeContextMenu);
    return () => {
      window.removeEventListener("click", closeContextMenu);
      window.removeEventListener("resize", closeContextMenu);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!gapMenu) return;
    function closeGapMenu() {
      setGapMenu(undefined);
    }
    window.addEventListener("click", closeGapMenu);
    window.addEventListener("resize", closeGapMenu);
    return () => {
      window.removeEventListener("click", closeGapMenu);
      window.removeEventListener("resize", closeGapMenu);
    };
  }, [gapMenu]);

  function commit(updater: (draft: Project) => void) {
    setHistory((items) => [...items.slice(-40), project]);
    setFuture([]);
    setProject((current) => updateProject(current, updater));
  }

  function beginTimelineEdit() {
    setHistory((items) => [...items.slice(-40), project]);
    setFuture([]);
  }

  function replaceSelection(clipId?: string) {
    setSelectedClipId(clipId);
    setSelectedClipIds(clipId ? [clipId] : []);
  }

  function selectTimelineClip(clipId: string, additive = false, range = false) {
    setInspectorMode("clip");
    if (range && selectedClipId) {
      const ids = orderedTimelineClips.map(({ clip }) => clip.id);
      const anchor = ids.indexOf(selectedClipId);
      const target = ids.indexOf(clipId);
      if (anchor >= 0 && target >= 0) {
        const [from, to] = anchor < target ? [anchor, target] : [target, anchor];
        const rangeIds = ids.slice(from, to + 1);
        setSelectedClipIds((current) => Array.from(new Set([...current, ...rangeIds])));
        setSelectedClipId(clipId);
        return;
      }
    }
    if (additive) {
      const exists = selectedClipIds.includes(clipId);
      const next = exists ? selectedClipIds.filter((id) => id !== clipId) : [...selectedClipIds, clipId];
      setSelectedClipIds(next);
      setSelectedClipId(next.at(-1));
      return;
    }
    replaceSelection(clipId);
  }

  function fitRightClipsAfter(draft: Project, trackId: string, start: number, end: number, excludedClipIds: string[] = []) {
    const excluded = new Set(excludedClipIds);
    const track = draft.tracks.find((item) => item.id === trackId);
    if (!track || end <= start) return;
    const rightClips = track.clips
      .filter((clip) => !excluded.has(clip.id) && clip.start >= start)
      .sort((left, right) => left.start - right.start);
    const firstRight = rightClips[0];
    if (!firstRight) return;
    const delta = roundTime(end - firstRight.start);
    if (Math.abs(delta) < 0.001) return;
    for (const clip of rightClips) clip.start = roundTime(Math.max(0, clip.start + delta));
  }

  function closeTrackGap(trackId: string, time: number) {
    const track = project.tracks.find((item) => item.id === trackId);
    if (!track || track.type === "transition") return;
    const clips = [...track.clips].sort((left, right) => left.start - right.start);
    const rightIndex = clips.findIndex((clip) => clip.start > time);
    if (rightIndex <= 0) return;
    const previous = clips[rightIndex - 1];
    const firstRight = clips[rightIndex];
    const gap = firstRight.start - (previous.start + previous.duration);
    if (gap <= 0.001) return;
    commit((draft) => {
      const draftTrack = draft.tracks.find((item) => item.id === trackId);
      if (!draftTrack) return;
      for (const clip of draftTrack.clips) {
        if (clip.start >= firstRight.start) clip.start = roundTime(Math.max(0, clip.start - gap));
      }
    });
    setMessage("Gap closed");
  }

  function closeAllTrackGaps(trackId: string) {
    const track = project.tracks.find((item) => item.id === trackId);
    if (!track || track.type === "transition") return;
    commit((draft) => {
      const draftTrack = draft.tracks.find((item) => item.id === trackId);
      if (!draftTrack) return;
      let cursor = 0;
      for (const clip of [...draftTrack.clips].sort((left, right) => left.start - right.start)) {
        clip.start = roundTime(cursor);
        cursor = roundTime(cursor + clip.duration);
      }
    });
    setMessage("All gaps closed");
  }

  const exportEstimate = useMemo(() => {
    const duration = editEnd;
    const presetFactor = exportSettings.preset === "slow" ? 0.85 : exportSettings.preset === "fast" ? 1.2 : 1;
    const qualityFactor = Math.pow(2, (23 - exportSettings.crf) / 6);
    const resolutionFactor = (exportSettings.width * exportSettings.height) / (1920 * 1080);
    const fpsFactor = exportSettings.fps / 30;
    const complexityFactor = 1.04;
    const videoMbps = Math.max(1.1, 4.25 * resolutionFactor * fpsFactor * qualityFactor * presetFactor * complexityFactor);
    const audioKbps = Number.parseInt(exportSettings.audioBitrate, 10) || 192;
    const containerOverhead = 1.04;
    const megabytes = ((videoMbps * 1000 + audioKbps) * duration) / 8 / 1024 * containerOverhead;
    return { duration, megabytes };
  }, [editEnd, exportSettings]);

  function applyNewProject(nextProject: Project) {
    setShowNewConfirm(false);
    setProject(normalizeProject(nextProject));
    setHistory([]);
    setFuture([]);
    replaceSelection(undefined);
    setInspectorMode("clip");
    setPlayhead(0);
    setIsPlaying(false);
    setExportProgress(undefined);
    setMessage("New project ready");
  }

  async function newProject() {
    if (!hasDesktopApi || !window.nativeApi) {
      applyNewProject(starterProject());
      return;
    }
    const created = await window.nativeApi.project.create();
    if (created) {
      await window.nativeApi.recovery.clear();
      applyNewProject(created);
    }
  }

  function removeAsset(assetId: string) {
    commit((draft) => {
      draft.assets = draft.assets.filter((asset) => asset.id !== assetId);
      for (const track of draft.tracks) track.clips = track.clips.filter((clip) => clip.assetId !== assetId);
    });
    if (selectedClip?.assetId === assetId) replaceSelection(undefined);
    setMessage("Media removed");
  }

  function addAssetClip(asset: MediaAsset, trackType?: TrackType) {
    const type: TrackType = trackType ?? (asset.type === "image" || asset.type === "color" ? "video" : asset.type);
    const targetTrack = project.tracks.find((track) => track.type === type);
    if (!targetTrack) return;
    const start = Math.max(0, Math.round(playhead / snap) * snap);
    const duration = asset.type === "image" || asset.type === "color" ? 5 : Math.max(0.5, asset.duration || 10);
    const clip: TimelineClip = {
      id: uid("clip"),
      trackId: targetTrack.id,
      type,
      assetId: asset.type === "color" ? undefined : asset.id,
      name: asset.name,
      start,
      duration,
      sourceIn: 0,
      sourceOut: duration,
      volume: 1,
      fadeIn: 0,
      fadeOut: 0,
      color: asset.type === "color" ? { value: asset.color ?? "#111827" } : undefined,
      pip: targetTrack.id === pipVideoTrackId ? { ...defaultPipStyle } : undefined
    };
    commit((draft) => {
      if (insertMode) fitRightClipsAfter(draft, targetTrack.id, start, start + duration, [clip.id]);
      draft.tracks.find((track) => track.id === targetTrack.id)!.clips.push(clip);
    });
    replaceSelection(clip.id);
    setInspectorMode("clip");
    setPlayhead(clamp(start + 0.01, 0, project.duration));
    setMessage(`Added ${asset.name}${insertMode ? " in Insert Mode" : ""}`);
  }

  async function importMedia() {
    if (!hasDesktopApi || !window.nativeApi) {
      setMessage("Desktop API unavailable. Run this app in Electron.");
      return;
    }
    const result = await window.nativeApi.media.import();
    if (result.accepted.length === 0 && result.rejected.length === 0) return;
    commit((draft) => {
      draft.assets.push(...result.accepted);
    });
    const importedTypes = Array.from(new Set(result.accepted.map((asset) => asset.type)));
    if (importedTypes.length === 1) setActiveMediaTab(importedTypes[0]);
    setMessage(`${result.accepted.length} imported${result.rejected.length ? `, ${result.rejected.length} rejected` : ""}`);
    for (const asset of result.accepted.filter((item) => item.type === "video" || item.type === "image")) {
      window.nativeApi.media.thumbnail(asset).then((thumbnailPath) => {
        if (!thumbnailPath) return;
        setProject((current) =>
          updateProject(current, (draft) => {
            const target = draft.assets.find((item) => item.id === asset.id);
            if (target) target.thumbnailPath = thumbnailPath;
          })
        );
      });
    }
  }

  function addTextClip() {
    const track = project.tracks.find((item) => item.type === "text");
    if (!track) return;
    const clip: TimelineClip = {
      id: uid("clip"),
      trackId: track.id,
      type: "text",
      name: "Title",
      start: playhead,
      duration: 4,
      sourceIn: 0,
      sourceOut: 4,
      volume: 1,
      fadeIn: 0,
      fadeOut: 0,
      text: { ...defaultTextStyle }
    };
    commit((draft) => {
      draft.tracks.find((item) => item.id === track.id)!.clips.push(clip);
    });
    replaceSelection(clip.id);
    setInspectorMode("clip");
  }

  function addTransitionAt(startTime: number) {
    const track = project.tracks.find((item) => item.type === "transition");
    if (!track) return;
    const kind: TransitionType = "cross-dissolve";
    const duration = 2;
    const cut = nearestVideoCut(project, startTime) ?? snapTimeToClips(project, startTime);
    const start = roundTime(Math.max(0, cut - duration / 2));
    const clip: TimelineClip = {
      id: uid("transition"),
      trackId: track.id,
      type: "transition",
      name: transitionLabel(kind),
      start,
      duration,
      sourceIn: 0,
      sourceOut: duration,
      volume: 1,
      transition: { kind }
    };
    commit((draft) => {
      draft.tracks.find((item) => item.id === track.id)!.clips.push(clip);
    });
    replaceSelection(clip.id);
    setInspectorMode("clip");
    setMessage(`Added ${clip.name} transition`);
  }

  function addTransitionClip() {
    addTransitionAt(playhead);
  }

  function addTransitionForClip(clipId: string) {
    const clip = project.tracks.flatMap((track) => track.clips).find((item) => item.id === clipId);
    if (!clip) return;
    addTransitionAt(Math.max(0, clip.start + clip.duration - 1));
  }

  function splitClipAt(clipId: string, time: number) {
    const target = project.tracks.flatMap((track) => track.clips).find((item) => item.id === clipId);
    if (!target) return;
    const splitTime = clamp(Math.round(time / snap) * snap, target.start + snap, target.start + target.duration - snap);
    if (splitTime <= target.start || splitTime >= target.start + target.duration) return;
    commit((draft) => {
      const track = draft.tracks.find((item) => item.id === target.trackId)!;
      const clip = track.clips.find((item) => item.id === target.id)!;
      const leftDuration = splitTime - clip.start;
      const rightDuration = clip.duration - leftDuration;
      const rightSourceIn = clip.sourceIn + leftDuration;
      clip.duration = leftDuration;
      clip.sourceOut = clip.sourceIn + leftDuration;
      track.clips.push({
        ...clip,
        id: uid("clip"),
        name: `${clip.name} cut`,
        start: splitTime,
        duration: rightDuration,
        sourceIn: rightSourceIn,
        sourceOut: rightSourceIn + rightDuration
      });
    });
    setPlayhead(splitTime);
    setMessage(`Split ${target.name}`);
  }

  function splitSelected() {
    if (!selectedClip) return;
    splitClipAt(selectedClip.id, playhead);
  }

  function copyClip(clipId: string) {
    const source = project.tracks.flatMap((track) => track.clips).find((item) => item.id === clipId);
    if (!source) return;
    const offset = Math.min(1, Math.max(0.5, source.duration * 0.2));
    const start = snapTimeToClips(project, source.start + offset);
    const clipCopy: TimelineClip = {
      ...source,
      id: uid("clip"),
      name: `${source.name} copy`,
      start
    };
    commit((draft) => {
      draft.tracks.find((item) => item.id === source.trackId)!.clips.push(clipCopy);
    });
    replaceSelection(clipCopy.id);
    setInspectorMode("clip");
    setPlayhead(clamp(start + 0.01, 0, project.duration));
    setMessage(`Copied ${source.name}`);
  }

  function copySelected() {
    if (!selectedClip) return;
    copyClip(selectedClip.id);
  }

  function duplicateClip(clipId: string) {
    const source = project.tracks.flatMap((track) => track.clips).find((item) => item.id === clipId);
    if (!source) return;
    const start = snapTimeToClips(project, source.start + source.duration);
    const clipCopy: TimelineClip = {
      ...source,
      id: uid("clip"),
      name: `${source.name} duplicate`,
      start
    };
    commit((draft) => {
      draft.tracks.find((item) => item.id === source.trackId)!.clips.push(clipCopy);
    });
    replaceSelection(clipCopy.id);
    setInspectorMode("clip");
    setPlayhead(clamp(start + 0.01, 0, project.duration));
    setMessage(`Duplicated ${source.name}`);
  }

  function deleteClip(clipId: string) {
    commit((draft) => {
      for (const track of draft.tracks) track.clips = track.clips.filter((clip) => clip.id !== clipId);
    });
    replaceSelection(undefined);
    setInspectorMode("clip");
  }

  function deleteSelected() {
    const ids = selectedClipIds.length ? selectedClipIds : selectedClipId ? [selectedClipId] : [];
    if (!ids.length) return;
    commit((draft) => {
      const selected = new Set(ids);
      for (const track of draft.tracks) track.clips = track.clips.filter((clip) => !selected.has(clip.id));
    });
    replaceSelection(undefined);
    setInspectorMode("clip");
  }

  function bringClipToPlayhead(clipId: string) {
    const target = project.tracks.flatMap((track) => track.clips).find((item) => item.id === clipId);
    if (!target) return;
    const start = snapTimeToClips(project, playhead, target);
    commit((draft) => {
      const clip = draft.tracks.flatMap((track) => track.clips).find((item) => item.id === clipId);
      if (clip) clip.start = start;
    });
    replaceSelection(clipId);
    setInspectorMode("clip");
    setMessage(`Moved ${target.name} to playhead`);
  }

  function moveClip(clipId: string, trackId: string, left: number) {
    const movingIds = selectedClipIds.includes(clipId) && selectedClipIds.length > 1 ? selectedClipIds : [clipId];
    const rawStart = left / timelineZoom;
    const currentClip = project.tracks.flatMap((item) => item.clips).find((item) => item.id === clipId);
    setSnapGuide(snapGuideTime(project, rawStart, currentClip, { enabled: snapEnabled, playhead: snapToPlayhead ? playhead : undefined, excludeClipIds: movingIds }));

    setProject((current) => updateProject(current, (draft) => {
      const allClips = draft.tracks.flatMap((item) => item.clips);
      const clip = allClips.find((item) => item.id === clipId);
      if (!clip) return;
      const nextStart = snapTimeToClips(current, rawStart, clip, { enabled: snapEnabled, playhead: snapToPlayhead ? playhead : undefined, excludeClipIds: movingIds });
      const delta = nextStart - clip.start;
      for (const item of allClips) {
        if (movingIds.includes(item.id)) item.start = Math.max(0, item.start + delta);
      }
    }));
  }

  function finishMoveClip(clipId: string, left: number) {
    const target = project.tracks.flatMap((track) => track.clips).find((clip) => clip.id === clipId);
    if (!target) return;
    const movingIds = selectedClipIds.includes(clipId) && selectedClipIds.length > 1 ? selectedClipIds : [clipId];
    setSnapGuide(undefined);
    if (insertMode) {
      setProject((current) => updateProject(current, (draft) => {
        const selected = new Set(movingIds);
        for (const track of draft.tracks) {
          const movedOnTrack = track.clips.filter((clip) => selected.has(clip.id));
          if (!movedOnTrack.length) continue;
          const trackStart = Math.min(...movedOnTrack.map((clip) => clip.start));
          const trackEnd = Math.max(...movedOnTrack.map((clip) => clip.start + clip.duration));
          fitRightClipsAfter(draft, track.id, trackStart, trackEnd, movingIds);
        }
      }));
      setMessage("Moved clip in Insert Mode");
    } else {
      setMessage("Moved clip");
    }
  }

  function dropAssetOnTrack(assetId: string, trackId: string, offsetX: number) {
    const asset = assetId === colorMediaAsset.id ? colorMediaAsset : project.assets.find((item) => item.id === assetId);
    const track = project.tracks.find((item) => item.id === trackId);
    if (!asset || !track) return;
    const targetType: TrackType = asset.type === "image" || asset.type === "color" ? "video" : asset.type;
    if (track.type !== targetType) {
      setMessage(`Drop ${asset.type} assets on a ${targetType} track.`);
      return;
    }
    const rawStart = Math.max(0, offsetX / timelineZoom);
    const start = snapTimeToClips(project, rawStart, undefined, { enabled: snapEnabled, playhead: snapToPlayhead ? playhead : undefined });
    setSnapGuide(snapGuideTime(project, rawStart, undefined, { enabled: snapEnabled, playhead: snapToPlayhead ? playhead : undefined }));
    const duration = asset.type === "image" || asset.type === "color" ? 5 : Math.max(0.5, asset.duration || 10);
    const clip: TimelineClip = {
      id: uid("clip"),
      trackId,
      type: track.type,
      assetId: asset.type === "color" ? undefined : asset.id,
      name: asset.name,
      start,
      duration,
      sourceIn: 0,
      sourceOut: duration,
      volume: 1,
      fadeIn: 0,
      fadeOut: 0,
      color: asset.type === "color" ? { value: asset.color ?? "#111827" } : undefined
    };
    commit((draft) => {
      if (insertMode) fitRightClipsAfter(draft, trackId, start, start + duration, [clip.id]);
      draft.tracks.find((item) => item.id === trackId)!.clips.push(clip);
    });
    replaceSelection(clip.id);
    setInspectorMode("clip");
    setPlayhead(clamp(start + 0.01, 0, project.duration));
    setMessage(`Added ${asset.name}${insertMode ? " in Insert Mode" : ""}`);
  }

  function trimClip(baseClip: TimelineClip, edge: "left" | "right", deltaSeconds: number) {
    setProject((current) => updateProject(current, (draft) => {
      const clip = draft.tracks.flatMap((track) => track.clips).find((item) => item.id === baseClip.id);
      if (!clip) return;
      if (edge === "left") {
        const rawStart = baseClip.start + deltaSeconds;
        const snappedStart = snapPointToClips(current, rawStart, baseClip.id, { enabled: snapEnabled, playhead: snapToPlayhead ? playhead : undefined });
        const delta = clamp(snappedStart - baseClip.start, -baseClip.sourceIn, baseClip.duration - 0.5);
        clip.start = Math.max(0, baseClip.start + delta);
        clip.sourceIn = baseClip.sourceIn + delta;
        clip.duration = roundTime(baseClip.duration - delta);
        clip.sourceOut = roundTime(clip.sourceIn + clip.duration);
      } else {
        const rawEnd = baseClip.start + baseClip.duration + deltaSeconds;
        const snappedEnd = snapPointToClips(current, rawEnd, baseClip.id, { enabled: snapEnabled, playhead: snapToPlayhead ? playhead : undefined });
        const asset = current.assets.find((item) => item.id === clip.assetId);
        const maxDuration = maxSourceDuration(clip, asset);
        clip.duration = roundTime(Math.min(maxDuration, Math.max(0.5, snappedEnd - baseClip.start)));
        clip.sourceOut = roundTime(clip.sourceIn + clip.duration);
      }
    }));
  }

  async function saveProject() {
    if (!hasDesktopApi) {
      setMessage("Use the Electron desktop window to save projects.");
      return;
    }
    const saved = await window.nativeApi?.project.save(project);
    if (saved) {
      setProject(saved);
      await window.nativeApi?.recovery.clear();
      setMessage("Project saved");
    }
  }

  async function restoreRecovery() {
    if (!recoverySnapshot) return;
    setProject(normalizeProject(recoverySnapshot.project));
    setHistory([]);
    setFuture([]);
    replaceSelection(undefined);
    setInspectorMode("clip");
    setPlayhead(0);
    setRecoverySnapshot(undefined);
    setMessage("Recovered autosave");
  }

  async function discardRecovery() {
    await window.nativeApi?.recovery.clear();
    setRecoverySnapshot(undefined);
    setMessage("Recovery discarded");
  }

  async function openProject() {
    if (!hasDesktopApi) {
      setMessage("Use the Electron desktop window to load projects.");
      return;
    }
    const opened = await window.nativeApi?.project.open();
    if (opened) {
      await window.nativeApi?.recovery.clear();
      setProject(opened);
      setHistory([]);
      setFuture([]);
      replaceSelection(undefined);
      setInspectorMode("clip");
      setPlayhead(0);
      setMessage("Project loaded");
    }
  }

  async function exportProject() {
    if (!hasDesktopApi) {
      setMessage("Use the Electron desktop window to export MP4 files.");
      return;
    }
    const validation = await window.nativeApi?.project.validate(project);
    if (validation && !validation.ok) {
      setMessage(`Export blocked: ${validation.missing.length} missing file${validation.missing.length === 1 ? "" : "s"}.`);
      setInspectorMode("export");
      return;
    }
    setMessage("Exporting MP4...");
    setExportProgress(0);
    const previewRect = previewRef.current?.getBoundingClientRect();
    const result: ExportResult | undefined = await window.nativeApi?.export.render(project, {
      width: exportSettings.width,
      height: exportSettings.height,
      fps: exportSettings.fps,
      crf: exportSettings.crf,
      preset: exportSettings.preset,
      audioBitrate: exportSettings.audioBitrate,
      logoPath: exportSettings.logoPath,
      logoPosition: exportSettings.logoPosition,
      logoSize: exportSettings.logoSize,
      logoTransparency: exportSettings.logoTransparency,
      previewWidth: previewRect?.width,
      previewHeight: previewRect?.height
    });
    setMessage(result?.message ?? "Export unavailable");
    window.setTimeout(() => setExportProgress(undefined), result?.ok ? 1200 : 0);
  }

  async function startAudioFit(clipId: string) {
    const clip = project.tracks.flatMap((track) => track.clips).find((item) => item.id === clipId);
    const asset = project.assets.find((item) => item.id === clip?.assetId);
    if (!clip || clip.type !== "audio" || !asset || asset.type !== "audio") {
      setMessage("Select an audio clip first.");
      return;
    }
    if (!hasDesktopApi || !window.nativeApi) {
      setMessage("Use the Electron desktop window to fit audio.");
      return;
    }
    const targetSeconds = Math.max(1, videoEditEnd || editEnd || clip.duration);
    setAudioFitModal({
      clipId,
      sourcePath: asset.path,
      targetSeconds,
      status: "rendering",
      message: `Generating fitted audio for ${seconds(targetSeconds)}...`
    });
    setMessage("Generating fitted audio...");
    const result = await window.nativeApi.audioFit.render({ sourcePath: asset.path, targetSeconds });
    setAudioFitModal((current) => current?.clipId === clipId
      ? {
          ...current,
          status: result.ok ? "ready" : "error",
          message: result.ok ? "Fitted audio is ready." : result.message,
          result
        }
      : current);
    setMessage(result.ok ? "Fitted audio ready" : result.message);
  }

  function replaceTimelineAudioWithFit() {
    if (!audioFitModal?.result?.ok || !audioFitModal.result.outputPath) return;
    const outputPath = audioFitModal.result.outputPath;
    const duration = Math.max(1, audioFitModal.result.duration ?? audioFitModal.targetSeconds);
    const name = outputPath.split(/[\\/]/).pop() ?? "audio_fit.mp3";
    const existing = project.assets.find((asset) => asset.path === outputPath);
    const assetId = existing?.id ?? uid("asset");
    const clipId = uid("clip");
    commit((draft) => {
      if (!existing) {
        draft.assets.push({
          id: assetId,
          name,
          path: outputPath,
          type: "audio",
          duration
        });
      } else {
        const target = draft.assets.find((asset) => asset.id === existing.id);
        if (target) {
          target.name = name;
          target.duration = duration;
        }
      }
      const track = draft.tracks.find((item) => item.clips.some((clip) => clip.id === audioFitModal.clipId))
        ?? draft.tracks.find((item) => item.type === "audio");
      if (!track) return;
      track.clips = track.clips.filter((clip) => clip.id !== audioFitModal.clipId);
      track.clips.push({
        id: clipId,
        trackId: track.id,
        type: "audio",
        assetId,
        name,
        start: 0,
        duration,
        sourceIn: 0,
        sourceOut: duration,
        volume: 1,
        fadeIn: 0,
        fadeOut: 0
      });
    });
    setActiveMediaTab("audio");
    replaceSelection(clipId);
    setInspectorMode("clip");
    setPlayhead(0);
    setAudioFitModal(undefined);
    setMessage("Fitted audio added to timeline");
  }

  function undo() {
    const previous = history.at(-1);
    if (!previous) return;
    setFuture((items) => [project, ...items]);
    setProject(previous);
    setHistory((items) => items.slice(0, -1));
  }

  function redo() {
    const next = future[0];
    if (!next) return;
    setHistory((items) => [...items, project]);
    setProject(next);
    setFuture((items) => items.slice(1));
  }

  function updateSelected(updater: (clip: TimelineClip) => void) {
    if (!selectedClipId) return;
    commit((draft) => {
      const clip = draft.tracks.flatMap((track) => track.clips).find((item) => item.id === selectedClipId);
      if (clip) updater(clip);
    });
  }

  function updateExportSettings(updater: (settings: ProjectExportSettings) => void) {
    commit((draft) => {
      const settings = { ...defaultExportSettings, ...(draft.exportSettings ?? {}) };
      updater(settings);
      draft.exportSettings = settings;
    });
  }

  function applyExportPreset(presetId: ExportPresetId) {
    setActiveExportPreset(presetId);
    const preset = exportPresets.find((item) => item.id === presetId);
    if (!preset?.settings) return;
    updateExportSettings((settings) => {
      Object.assign(settings, preset.settings);
    });
  }

  async function chooseExportLogo() {
    if (!hasDesktopApi || !window.nativeApi) {
      setMessage("Use the Electron desktop window to select a logo.");
      setInspectorMode("logo");
      return;
    }
    const logoPath = await window.nativeApi.export.selectLogo();
    setInspectorMode("logo");
    if (!logoPath) return;
    updateExportSettings((settings) => {
      settings.logoPath = logoPath;
    });
    setMessage("Logo added");
  }

  function jumpToTimelineOffset(offsetX: number) {
    setPlayhead(clamp(snapTimeToClips(project, offsetX / timelineZoom, undefined, { enabled: snapEnabled }), 0, project.duration));
  }

  function seekTimelineFromClientX(clientX: number) {
    const ruler = timelineRulerRef.current;
    if (!ruler) return;
    const rect = ruler.getBoundingClientRect();
    jumpToTimelineOffset(clientX - rect.left - trackLabelWidth);
  }

  function zoomTimelineToFit() {
    const shell = timelineRef.current?.closest(".timeline-shell") as HTMLElement | null;
    const visibleWidth = shell?.clientWidth ?? window.innerWidth;
    const usableWidth = Math.max(120, visibleWidth - trackLabelWidth - 28);
    const nextZoom = Math.floor(usableWidth / Math.max(1, project.duration));
    setTimelineZoom(clamp(nextZoom, minTimelineZoom, maxTimelineZoom));
  }

  function handleTimelineWheel(event: WheelEvent<HTMLElement>) {
    const shell = timelineShellRef.current;
    if (!shell) return;
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      const direction = event.deltaY > 0 ? -1 : 1;
      const nextZoom = clamp(timelineZoom + direction * 4, minTimelineZoom, maxTimelineZoom);
      const cursorTime = Math.max(0, (shell.scrollLeft + event.clientX - shell.getBoundingClientRect().left - trackLabelWidth) / timelineZoom);
      setTimelineZoom(nextZoom);
      window.requestAnimationFrame(() => {
        shell.scrollLeft = Math.max(0, trackLabelWidth + cursorTime * nextZoom - (event.clientX - shell.getBoundingClientRect().left));
      });
      return;
    }
    if (event.shiftKey) {
      event.preventDefault();
      shell.scrollLeft += event.deltaY || event.deltaX;
    }
  }

  function selectClip(clipId: string, event?: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }) {
    selectTimelineClip(clipId, Boolean(event?.ctrlKey || event?.metaKey), Boolean(event?.shiftKey));
    const clip = project.tracks.flatMap((track) => track.clips).find((item) => item.id === clipId);
    if (clip) setPlayhead(clamp(clip.start + 0.01, 0, project.duration));
  }

  const contextClip = contextMenu
    ? project.tracks.flatMap((track) => track.clips).find((clip) => clip.id === contextMenu.clipId)
    : undefined;
  const contextAsset = contextClip?.assetId ? project.assets.find((asset) => asset.id === contextClip.assetId) : undefined;
  const canFitContextAudio = contextClip?.type === "audio" && contextAsset?.type === "audio";
  const canAddContextTransition = contextClip?.type === "video";
  const selectedMaxDuration = selectedClip ? maxSourceDuration(selectedClip, selectedAsset) : Number.POSITIVE_INFINITY;

  return (
    <div className="app-shell" data-theme={theme}>
      <header className="topbar">
        <div className="brand">
          <Video size={18} />
          <strong>Nonlinear Video Editor</strong>
          <span className="brand-separator" />
          <span className="project-title">Project: {project.name}</span>
          <span className="brand-separator" />
        </div>
        <div className="topbar-status">
          <span>{message}</span>
          {exportProgress !== undefined && (
            <>
              <progress max={100} value={exportProgress} />
              <strong>{Math.round(exportProgress)}%</strong>
            </>
          )}
          {inspectorMode === "export" && (
            <div className="topbar-estimate">
              <span>Estimated size</span>
              <strong>{exportEstimate.megabytes.toFixed(1)} MB</strong>
            </div>
          )}
        </div>
        <div className="toolbar">
          <button title="New project" onClick={() => setShowNewConfirm(true)}><FilePlus2 size={16} />New</button>
          <button title="Load project" onClick={openProject}><FolderOpen size={16} />Load</button>
          <button title="Save project" onClick={saveProject}><Save size={16} />Save</button>
          <button title="Readme" onClick={() => setShowReadme(true)}><FileText size={16} />Readme</button>
          <button title="Keyboard shortcuts" onClick={() => setShowShortcuts(true)}><Keyboard size={16} />Shortcuts</button>
          <button title="Export settings" onClick={() => setInspectorMode("export")}><FileDown size={16} />Export</button>
          <button
            className="theme-toggle"
            title={theme === "dark" ? "Light theme" : "Dark theme"}
            onClick={() => setTheme((value) => value === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </header>

      {!hasDesktopApi && (
        <div className="desktop-warning">
          Native desktop features are offline because this page is open in a regular browser. Start the app with <code>npm run dev</code> or <code>npm start</code> and use the Electron window.
        </div>
      )}

      <main className="workspace">
        <aside className="panel media-bin">
          <div className="panel-title">Media</div>
          <button className="import-tile" onClick={importMedia}><FileUp size={18} />Import local files</button>
          <div className="media-tabs" role="tablist" aria-label="Media type">
            {mediaTabs.map((tab) => (
              <button
                key={tab.id}
                className={activeMediaTab === tab.id ? "active" : ""}
                role="tab"
                aria-selected={activeMediaTab === tab.id}
                onClick={() => setActiveMediaTab(tab.id)}
              >
                {tab.label}
                <span>{mediaCounts[tab.id]}</span>
              </button>
            ))}
          </div>
          <div className="asset-list">
            {visibleAssets.map((asset) => (
              <div
                className="asset"
                key={asset.id}
                draggable
                onDragStart={(event) => event.dataTransfer.setData("application/x-nve-asset", asset.id)}
                onClick={() => addAssetClip(asset)}
              >
                <div className={`asset-thumb ${asset.type}`}>
                  {asset.type === "color" ? <span className="colour-swatch" style={{ background: asset.color }} /> : asset.thumbnailPath || asset.type === "image" ? <img src={fileUrl(asset.thumbnailPath ?? asset.path)} alt="" /> : asset.type.toUpperCase()}
                </div>
                <div>
                  <strong>{asset.name}</strong>
                  <span>{asset.type} / {seconds(asset.duration)}</span>
                </div>
                {asset.type !== "color" ? (
                  <button
                    className="asset-remove"
                    title="Remove media"
                    onClick={(event) => {
                      event.stopPropagation();
                      removeAsset(asset.id);
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                ) : <span />}
              </div>
            ))}
            {visibleAssets.length === 0 && (
              <div className="empty-panel">No {activeMediaTab} files imported.</div>
            )}
          </div>
        </aside>

        <section className="center-stage">
          <div className="preview" ref={previewRef}>
            {baseVisualClip && baseVisualAsset ? (
              <PreviewVisualLayer
                asset={baseVisualAsset}
                clip={baseVisualClip}
                isPlaying={isPlaying}
                playhead={playhead}
                className="base"
                style={activeTransition ? outgoingTransitionStyle(activeTransition.transition.transition?.kind ?? "cross-dissolve", activeTransition.progress) : undefined}
              />
            ) : (
              <div className="empty-preview">Drop video clips on the timeline</div>
            )}
            {activeTransition && incomingVisualAsset && (
              <>
                <PreviewVisualLayer
                  asset={incomingVisualAsset}
                  clip={activeTransition.incoming}
                  isPlaying={isPlaying}
                  playhead={playhead}
                  className="incoming"
                  style={incomingTransitionStyle(activeTransition.transition.transition?.kind ?? "cross-dissolve", activeTransition.progress)}
                />
                {transitionWashStyle(activeTransition.transition.transition?.kind ?? "cross-dissolve", activeTransition.progress) && (
                  <div className="transition-wash" style={transitionWashStyle(activeTransition.transition.transition?.kind ?? "cross-dissolve", activeTransition.progress)} />
                )}
              </>
            )}
            {activePipClips.map((clip) => {
              const asset = clip.color ? colorMediaAsset : project.assets.find((item) => item.id === clip.assetId);
              if (!asset) return null;
              return (
                <div className="preview-pip" key={clip.id} style={pipPreviewStyle(clip, playhead)}>
                  <PreviewVisualLayer
                    asset={asset}
                    clip={clip}
                    isPlaying={isPlaying}
                    playhead={playhead}
                    className="pip"
                  />
                </div>
              );
            })}
            {activeAudioClips.map((clip) => {
              const asset = project.assets.find((item) => item.id === clip.assetId);
              if (!asset) return null;
              return (
                <audio
                  key={clip.id}
                  ref={(node) => {
                    if (node) audioRefs.current.set(clip.id, node);
                    else audioRefs.current.delete(clip.id);
                  }}
                  src={fileUrl(asset.path)}
                  preload="auto"
                />
              );
            })}
            {project.tracks
              .filter((track) => track.type === "text")
              .flatMap((track) => track.clips)
              .filter((clip) => clip.start <= playhead && clip.start + clip.duration >= playhead)
              .map((clip) => (
                <div
                  className="preview-text"
                  key={clip.id}
                  style={{
                    left: `${((clip.text?.x ?? 80) / titleCanvasWidth) * 100}%`,
                    top: `${((clip.text?.y ?? 80) / titleCanvasHeight) * 100}%`,
                    fontSize: `${((clip.text?.fontSize ?? 42) / titleCanvasHeight) * 100}cqh`,
                    color: clip.text?.color ?? "#fff",
                    fontWeight: clip.text?.fontWeight ?? 800,
                    fontStyle: clip.text?.italic ? "italic" : "normal",
                    opacity: clip.text?.opacity ?? 1,
                    textAlign: clip.text?.align ?? "left",
                    backgroundColor: hexToRgba(clip.text?.backgroundColor ?? "#000000", clip.text?.backgroundOpacity ?? 0),
                    WebkitTextStroke: `${clip.text?.outlineWidth ?? 0}px ${clip.text?.outlineColor ?? "#000000"}`,
                    textShadow: `0 2px ${clip.text?.shadowBlur ?? 12}px ${clip.text?.shadowColor ?? "#000000"}`
                  }}
                >
                  {clip.text?.content ?? clip.name}
                </div>
              ))}
            {exportSettings.logoPath && (
              <img
                className="preview-logo"
                src={fileUrl(exportSettings.logoPath)}
                alt=""
                style={logoPreviewStyle(exportSettings)}
              />
            )}
            {showFullscreenHint && <div className="fullscreen-hint">ESC to exit fullscreen</div>}
          </div>
          <div className="transport">
            <button className="round" title="Back to start" onClick={() => { setIsPlaying(false); setPlayhead(0); }}>
              <SkipBack size={18} />
            </button>
            <button className="round" onClick={() => setIsPlaying((value) => !value)}>
              {isPlaying ? <Pause size={18} /> : <Play size={18} />}
            </button>
            <span>{seconds(playhead)}</span>
            <input type="range" min={0} max={editEnd} step={0.05} value={playhead} onChange={(event) => setPlayhead(Number(event.target.value))} />
            <span>{seconds(editEnd)}</span>
            <button className="round" title="Fullscreen preview" onClick={() => previewRef.current?.requestFullscreen?.()}>
              <Maximize2 size={18} />
            </button>
          </div>
        </section>

        <aside className="panel inspector">
          <div className="panel-title">{inspectorMode === "export" ? "Export" : inspectorMode === "logo" ? "Logo" : isSelectedPipClip ? "PiP" : "Inspector"}</div>
          {inspectorMode === "clip" && selectedClip && isSelectedPipClip ? (
            <div className="fields">
              <label>Name<input value={selectedClip.name} onChange={(event) => updateSelected((clip) => { clip.name = event.target.value; })} /></label>
              <label>Start<input type="number" step="0.25" value={timeInputValue(selectedClip.start)} onChange={(event) => updateSelected((clip) => { clip.start = roundTime(Number(event.target.value)); })} /></label>
              <label>Duration<input type="number" min="0.5" max={Number.isFinite(selectedMaxDuration) ? selectedMaxDuration : undefined} step="0.25" value={timeInputValue(selectedClip.duration)} onChange={(event) => updateSelected((clip) => { const asset = project.assets.find((item) => item.id === clip.assetId); const maxDuration = maxSourceDuration(clip, asset); clip.duration = roundTime(Math.min(maxDuration, Math.max(0.5, Number(event.target.value)))); clip.sourceOut = roundTime(clip.sourceIn + clip.duration); })} /></label>
              <label>Position<select value={(selectedClip.pip ?? defaultPipStyle).position} onChange={(event) => updateSelected((clip) => { clip.pip = { ...defaultPipStyle, ...(clip.pip ?? {}), position: event.target.value as NonNullable<TimelineClip["pip"]>["position"] }; })}>
                <option value="top-left">Top left</option>
                <option value="top-right">Top right</option>
                <option value="bottom-left">Bottom left</option>
                <option value="bottom-right">Bottom right</option>
                <option value="custom">Custom</option>
              </select></label>
              <label>Size<select value={(selectedClip.pip ?? defaultPipStyle).size} onChange={(event) => updateSelected((clip) => { clip.pip = { ...defaultPipStyle, ...(clip.pip ?? {}), size: event.target.value as NonNullable<TimelineClip["pip"]>["size"] }; })}>
                <option value="small">Small</option>
                <option value="medium">Medium</option>
                <option value="large">Large</option>
                <option value="custom">Percent</option>
              </select></label>
              <label>Size percent {(selectedClip.pip ?? defaultPipStyle).scalePercent}%<input type="range" min="5" max="100" step="1" value={(selectedClip.pip ?? defaultPipStyle).scalePercent} onChange={(event) => updateSelected((clip) => { clip.pip = { ...defaultPipStyle, ...(clip.pip ?? {}), size: "custom", scalePercent: Number(event.target.value) }; })} /></label>
              <label>X {(selectedClip.pip ?? defaultPipStyle).x}%<input type="range" min="0" max="100" step="1" value={(selectedClip.pip ?? defaultPipStyle).x} onChange={(event) => updateSelected((clip) => { clip.pip = { ...defaultPipStyle, ...(clip.pip ?? {}), position: "custom", x: Number(event.target.value) }; })} /></label>
              <label>Y {(selectedClip.pip ?? defaultPipStyle).y}%<input type="range" min="0" max="100" step="1" value={(selectedClip.pip ?? defaultPipStyle).y} onChange={(event) => updateSelected((clip) => { clip.pip = { ...defaultPipStyle, ...(clip.pip ?? {}), position: "custom", y: Number(event.target.value) }; })} /></label>
              <label>Opacity {Math.round((selectedClip.pip ?? defaultPipStyle).opacity * 100)}%<input type="range" min="0" max="1" step="0.05" value={(selectedClip.pip ?? defaultPipStyle).opacity} onChange={(event) => updateSelected((clip) => { clip.pip = { ...defaultPipStyle, ...(clip.pip ?? {}), opacity: Number(event.target.value) }; })} /></label>
              <label className="check-field"><input type="checkbox" checked={(selectedClip.pip ?? defaultPipStyle).border} onChange={(event) => updateSelected((clip) => { clip.pip = { ...defaultPipStyle, ...(clip.pip ?? {}), border: event.target.checked }; })} />Border</label>
              <label className="check-field"><input type="checkbox" checked={(selectedClip.pip ?? defaultPipStyle).shadow} onChange={(event) => updateSelected((clip) => { clip.pip = { ...defaultPipStyle, ...(clip.pip ?? {}), shadow: event.target.checked }; })} />Shadow</label>
              <label>Video fade in<input type="number" min="0" step="0.1" value={timeInputValue(selectedClip.fadeIn ?? 0)} onChange={(event) => updateSelected((clip) => { clip.fadeIn = roundTime(Math.max(0, Number(event.target.value))); })} /></label>
              <label>Video fade out<input type="number" min="0" step="0.1" value={timeInputValue(selectedClip.fadeOut ?? 0)} onChange={(event) => updateSelected((clip) => { clip.fadeOut = roundTime(Math.max(0, Number(event.target.value))); })} /></label>
            </div>
          ) : inspectorMode === "clip" && selectedClip ? (
            <div className="fields">
              <label>Name<input value={selectedClip.name} onChange={(event) => updateSelected((clip) => { clip.name = event.target.value; })} /></label>
              <label>Start<input type="number" step="0.25" value={timeInputValue(selectedClip.start)} onChange={(event) => updateSelected((clip) => { clip.start = roundTime(Number(event.target.value)); })} /></label>
              <label>{selectedClip.color ? "Colour duration" : selectedAsset?.type === "image" ? "Image duration" : selectedClip.type === "transition" ? "Transition duration" : "Duration"}<input type="number" min={selectedClip.color || selectedAsset?.type === "image" ? 1 : selectedClip.type === "transition" ? 0.25 : 0.5} max={Number.isFinite(selectedMaxDuration) ? selectedMaxDuration : undefined} step="0.25" value={timeInputValue(selectedClip.duration)} onChange={(event) => updateSelected((clip) => { const asset = project.assets.find((item) => item.id === clip.assetId); const maxDuration = maxSourceDuration(clip, asset); clip.duration = roundTime(Math.min(maxDuration, Math.max(clip.color || asset?.type === "image" ? 1 : clip.type === "transition" ? 0.25 : 0.5, Number(event.target.value)))); clip.sourceOut = roundTime(clip.sourceIn + clip.duration); })} /></label>
              {selectedClip.color && (
                <label>Colour<input type="color" value={selectedClip.color.value} onChange={(event) => updateSelected((clip) => { clip.color = { value: event.target.value }; })} /></label>
              )}
              {selectedClip.assetId && selectedAsset?.type !== "image" && (
                <>
                  <label>Source In<input type="number" step="0.25" max={Math.max(0, (selectedAsset?.duration ?? 0) - 0.5)} value={timeInputValue(selectedClip.sourceIn)} onChange={(event) => updateSelected((clip) => { const asset = project.assets.find((item) => item.id === clip.assetId); const maxIn = asset && (asset.type === "video" || asset.type === "audio") ? Math.max(0, asset.duration - 0.5) : Number.POSITIVE_INFINITY; clip.sourceIn = roundTime(Math.min(maxIn, Math.max(0, Number(event.target.value)))); clip.duration = roundTime(Math.min(clip.duration, maxSourceDuration(clip, asset))); clip.sourceOut = roundTime(clip.sourceIn + clip.duration); })} /></label>
                  <label>Source Out<input type="number" step="0.25" max={selectedAsset?.duration} value={timeInputValue(selectedClip.sourceOut)} onChange={(event) => updateSelected((clip) => { const asset = project.assets.find((item) => item.id === clip.assetId); const maxOut = asset && (asset.type === "video" || asset.type === "audio") ? asset.duration : Number.POSITIVE_INFINITY; clip.sourceOut = roundTime(Math.min(maxOut, Math.max(clip.sourceIn + 0.5, Number(event.target.value)))); clip.duration = roundTime(clip.sourceOut - clip.sourceIn); })} /></label>
                </>
              )}
              {selectedClip.type === "transition" && (
                <label>Transition type<select value={selectedClip.transition?.kind ?? "cross-dissolve"} onChange={(event) => updateSelected((clip) => {
                  const kind = event.target.value as TransitionType;
                  clip.transition = { kind };
                  clip.name = transitionLabel(kind);
                })}>
                  {transitionOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select></label>
              )}
              {(selectedClip.type === "audio" || selectedAsset?.type === "video") && (
                <>
                  <label>Volume {selectedClip.volume.toFixed(2)}<input type="range" min="0" max="2" step="0.05" value={selectedClip.volume} onChange={(event) => updateSelected((clip) => { clip.volume = Number(event.target.value); })} /></label>
                  <label>Fade in<input type="number" min="0" step="0.1" value={timeInputValue(selectedClip.fadeIn ?? 0)} onChange={(event) => updateSelected((clip) => { clip.fadeIn = roundTime(Math.max(0, Number(event.target.value))); })} /></label>
                  <label>Fade out<input type="number" min="0" step="0.1" value={timeInputValue(selectedClip.fadeOut ?? 0)} onChange={(event) => updateSelected((clip) => { clip.fadeOut = roundTime(Math.max(0, Number(event.target.value))); })} /></label>
                </>
              )}
              {selectedClip.type === "text" && (
                <>
                  <label>Text<textarea value={selectedClip.text?.content ?? ""} onChange={(event) => updateSelected((clip) => { clip.text = { ...(clip.text ?? { fontSize: 42, color: "#ffffff", x: 80, y: 76 }), content: event.target.value }; })} /></label>
                  <label>Size<input type="number" value={selectedClip.text?.fontSize ?? 42} onChange={(event) => updateSelected((clip) => { if (clip.text) clip.text.fontSize = Number(event.target.value); })} /></label>
                  <label>Weight<input type="number" min="100" max="900" step="100" value={selectedClip.text?.fontWeight ?? 800} onChange={(event) => updateSelected((clip) => { if (clip.text) clip.text.fontWeight = Number(event.target.value); })} /></label>
                  <label>Color<input type="color" value={selectedClip.text?.color ?? "#ffffff"} onChange={(event) => updateSelected((clip) => { if (clip.text) clip.text.color = event.target.value; })} /></label>
                  <label>X<input type="number" value={selectedClip.text?.x ?? 80} onChange={(event) => updateSelected((clip) => { if (clip.text) clip.text.x = Number(event.target.value); })} /></label>
                  <label>Y<input type="number" value={selectedClip.text?.y ?? 76} onChange={(event) => updateSelected((clip) => { if (clip.text) clip.text.y = Number(event.target.value); })} /></label>
                  <label>Align<select value={selectedClip.text?.align ?? "left"} onChange={(event) => updateSelected((clip) => { if (clip.text) clip.text.align = event.target.value as "left" | "center" | "right"; })}>
                    <option value="left">Left</option>
                    <option value="center">Center</option>
                    <option value="right">Right</option>
                  </select></label>
                  <label className="check-field"><input type="checkbox" checked={selectedClip.text?.italic ?? false} onChange={(event) => updateSelected((clip) => { if (clip.text) clip.text.italic = event.target.checked; })} />Italic</label>
                  <label>Opacity {((selectedClip.text?.opacity ?? 1) * 100).toFixed(0)}%<input type="range" min="0" max="1" step="0.05" value={selectedClip.text?.opacity ?? 1} onChange={(event) => updateSelected((clip) => { if (clip.text) clip.text.opacity = Number(event.target.value); })} /></label>
                  <label>Background<input type="color" value={selectedClip.text?.backgroundColor ?? "#000000"} onChange={(event) => updateSelected((clip) => { if (clip.text) clip.text.backgroundColor = event.target.value; })} /></label>
                  <label>Background opacity {((selectedClip.text?.backgroundOpacity ?? 0) * 100).toFixed(0)}%<input type="range" min="0" max="1" step="0.05" value={selectedClip.text?.backgroundOpacity ?? 0} onChange={(event) => updateSelected((clip) => { if (clip.text) clip.text.backgroundOpacity = Number(event.target.value); })} /></label>
                  <label>Outline<input type="color" value={selectedClip.text?.outlineColor ?? "#000000"} onChange={(event) => updateSelected((clip) => { if (clip.text) clip.text.outlineColor = event.target.value; })} /></label>
                  <label>Outline width<input type="number" min="0" max="20" step="1" value={selectedClip.text?.outlineWidth ?? 0} onChange={(event) => updateSelected((clip) => { if (clip.text) clip.text.outlineWidth = Math.max(0, Number(event.target.value)); })} /></label>
                  <label>Shadow<input type="color" value={selectedClip.text?.shadowColor ?? "#000000"} onChange={(event) => updateSelected((clip) => { if (clip.text) clip.text.shadowColor = event.target.value; })} /></label>
                  <label>Shadow blur<input type="number" min="0" max="48" step="1" value={selectedClip.text?.shadowBlur ?? 12} onChange={(event) => updateSelected((clip) => { if (clip.text) clip.text.shadowBlur = Math.max(0, Number(event.target.value)); })} /></label>
                </>
              )}
            </div>
          ) : inspectorMode === "clip" ? (
            <div className="empty-panel">Select a clip to edit timing, volume, or text.</div>
          ) : inspectorMode === "logo" ? (
          <div className="export-settings export-settings-panel">
            <div className="fields">
              {exportSettings.logoPath ? (
                <div className="export-logo-row">
                  <div className="export-logo-file" title={exportSettings.logoPath}>{exportSettings.logoPath.split(/[\\/]/).at(-1)}</div>
                  <button
                    className="logo-clear-button"
                    title="Remove logo"
                    onClick={() => updateExportSettings((settings) => { settings.logoPath = undefined; })}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ) : (
                <div className="empty-panel">No logo selected.</div>
              )}
              <button className="wide-action" onClick={chooseExportLogo}>Add Logo</button>
              <label>Logo position<select value={exportSettings.logoPosition} onChange={(event) => updateExportSettings((settings) => { settings.logoPosition = event.target.value as ProjectExportSettings["logoPosition"]; })}>
                <option value="top-left">Top left</option>
                <option value="top-right">Top right</option>
                <option value="bottom-left">Bottom left</option>
                <option value="bottom-right">Bottom right</option>
              </select></label>
              <label>Logo size<select value={exportSettings.logoSize} onChange={(event) => updateExportSettings((settings) => { settings.logoSize = event.target.value as ProjectExportSettings["logoSize"]; })}>
                <option value="small">Small</option>
                <option value="medium">Medium</option>
                <option value="large">Large</option>
              </select></label>
              <label>Logo transparency {exportSettings.logoTransparency}%<input className="plain-range" type="range" min="0" max="90" step="5" value={exportSettings.logoTransparency} onChange={(event) => updateExportSettings((settings) => { settings.logoTransparency = Number(event.target.value); })} /></label>
            </div>
          </div>
          ) : (
          <div className="export-settings export-settings-panel">
            <div className="fields">
              <label>Preset<select value={activeExportPreset} onChange={(event) => applyExportPreset(event.target.value as ExportPresetId)}>
                {exportPresets.map((preset) => (
                  <option key={preset.id} value={preset.id}>{preset.label}</option>
                ))}
              </select></label>
              <label>Resolution<select value={`${exportSettings.width}x${exportSettings.height}`} onChange={(event) => updateExportSettings((settings) => {
                const [width, height] = event.target.value.split("x").map(Number);
                settings.width = width;
                settings.height = height;
                setActiveExportPreset("custom");
              })}>
                <option value="1280x720">1280 x 720</option>
                <option value="1920x1080">1920 x 1080</option>
                <option value="1080x1920">1080 x 1920</option>
                <option value="2560x1440">2560 x 1440</option>
                <option value="3840x2160">3840 x 2160</option>
              </select></label>
              <label>FPS<select value={exportSettings.fps} onChange={(event) => updateExportSettings((settings) => { settings.fps = Number(event.target.value); setActiveExportPreset("custom"); })}>
                <option value={24}>24</option>
                <option value={25}>25</option>
                <option value={30}>30</option>
                <option value={50}>50</option>
                <option value={60}>60</option>
              </select></label>
              <label>Quality CRF<input type="number" min="12" max="30" value={exportSettings.crf} onChange={(event) => updateExportSettings((settings) => { settings.crf = clamp(Number(event.target.value), 12, 30); setActiveExportPreset("custom"); })} /></label>
              <label>Encoding<select value={exportSettings.preset} onChange={(event) => updateExportSettings((settings) => { settings.preset = event.target.value as ProjectExportSettings["preset"]; setActiveExportPreset("custom"); })}>
                <option value="fast">Fast</option>
                <option value="medium">Medium</option>
                <option value="slow">Slow</option>
              </select></label>
              <label>Audio bitrate<select value={exportSettings.audioBitrate} onChange={(event) => updateExportSettings((settings) => { settings.audioBitrate = event.target.value; setActiveExportPreset("custom"); })}>
                <option value="128k">128k</option>
                <option value="192k">192k</option>
                <option value="256k">256k</option>
                <option value="320k">320k</option>
              </select></label>
              <button className="accent wide-action" onClick={exportProject} disabled={exportProgress !== undefined}>Export</button>
            </div>
          </div>
          )}
        </aside>
      </main>

      <section className="timeline-shell" ref={timelineShellRef} onWheel={handleTimelineWheel}>
        <div className="timeline-toolbar">
          <button title="Undo" onClick={undo} disabled={!history.length}><Undo2 size={16} /></button>
          <button title="Redo" onClick={redo} disabled={!future.length}><Redo2 size={16} /></button>
          <button title="Split selected clip" onClick={splitSelected} disabled={!selectedClip}><Scissors size={16} /></button>
          <button title="Copy selected clip" onClick={copySelected} disabled={!selectedClip}><Copy size={16} /></button>
          <button title="Delete selected clip" onClick={deleteSelected} disabled={!selectedClipIds.length}><Trash2 size={16} /></button>
          <span className="toolbar-separator" />
          <button title="Add text" onClick={addTextClip}><Type size={16} />Text</button>
          <button title="Add transition at playhead" onClick={addTransitionClip}><Shuffle size={16} />Transitions</button>
          <span className="toolbar-separator" />
          <button title="Add logo" onClick={chooseExportLogo}><FileUp size={16} />Logo</button>
          <span className="toolbar-separator" />
          <button
            className={insertMode ? "insert-mode-button active" : "insert-mode-button"}
            title="Insert Mode: make exact room on the current track"
            aria-pressed={insertMode}
            onClick={() => setInsertMode((value) => !value)}
          >
            <FilePlus2 size={16} />Insert
          </button>
          <label className="timeline-toggle" title="Snap to clips and grid">
            <input type="checkbox" checked={snapEnabled} onChange={(event) => { setSnapEnabled(event.target.checked); if (!event.target.checked) setSnapGuide(undefined); }} />
            Snap
          </label>
          <label className="timeline-toggle" title="Snap to playhead">
            <input type="checkbox" checked={snapToPlayhead} disabled={!snapEnabled} onChange={(event) => setSnapToPlayhead(event.target.checked)} />
            Playhead
          </label>
          <label className="timeline-zoom">
            Zoom
            <input className="plain-range" type="range" min={minTimelineZoom} max={maxTimelineZoom} step={2} value={timelineZoom} onChange={(event) => setTimelineZoom(Number(event.target.value))} />
          </label>
          <button className="zoom-fit-button" title="Zoom to fit timeline" onClick={zoomTimelineToFit}><ZoomIn size={15} /></button>
        </div>
        <div
          className="timeline-ruler"
          ref={timelineRulerRef}
          style={{ width: trackLabelWidth + project.duration * timelineZoom }}
          onMouseDown={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            jumpToTimelineOffset(event.clientX - rect.left - trackLabelWidth);
            setIsDraggingPlayhead(true);
          }}
        >
          {Array.from({ length: Math.ceil(project.duration / 5) + 1 }).map((_, index) => (
            <button key={index} style={{ left: trackLabelWidth + index * 5 * timelineZoom }} onClick={() => setPlayhead(index * 5)}>
              {seconds(index * 5)}
            </button>
          ))}
          <div
            className="playhead"
            style={{ left: trackLabelWidth + playhead * timelineZoom }}
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setIsDraggingPlayhead(true);
            }}
          />
          {snapGuide !== undefined && (
            <div className="snap-guide" style={{ left: trackLabelWidth + snapGuide * timelineZoom }} />
          )}
        </div>
        <div className="timeline" ref={timelineRef} style={{ width: trackLabelWidth + project.duration * timelineZoom }}>
          {project.tracks.map((track) => (
            <TrackLane
              key={track.id}
              track={track}
              assets={project.assets}
              pxPerSecond={timelineZoom}
              selectedClipId={selectedClipId}
              selectedClipIds={selectedClipIds}
              onSelect={selectClip}
              onBeginEdit={beginTimelineEdit}
              onMove={moveClip}
              onMoveEnd={finishMoveClip}
              onTrim={trimClip}
              onDropAsset={dropAssetOnTrack}
              onJump={jumpToTimelineOffset}
              onGapContextMenu={(trackId, x, y, time) => {
                const track = project.tracks.find((item) => item.id === trackId);
                if (!track || track.type === "transition") return;
                const menuWidth = 176;
                const menuHeight = 84;
                setContextMenu(undefined);
                setGapMenu({
                  trackId,
                  x: Math.min(x, window.innerWidth - menuWidth - 8),
                  y: Math.min(y, window.innerHeight - menuHeight - 8),
                  time
                });
              }}
              onClipContextMenu={(clipId, x, y, time) => {
                const menuWidth = 176;
                const menuClip = project.tracks.flatMap((track) => track.clips).find((clip) => clip.id === clipId);
                const menuHeight = menuClip?.type === "audio" ? 220 : 184;
                if (!selectedClipIds.includes(clipId)) selectTimelineClip(clipId);
                setContextMenu({
                  clipId,
                  x: Math.min(x, window.innerWidth - menuWidth - 8),
                  y: Math.min(y, window.innerHeight - menuHeight - 8),
                  time
                });
              }}
            />
          ))}
        </div>
      </section>
      {contextMenu && (
        <div
          className="clip-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button onClick={() => { copyClip(contextMenu.clipId); setContextMenu(undefined); }}>Copy</button>
          <button onClick={() => { deleteClip(contextMenu.clipId); setContextMenu(undefined); }}>Delete</button>
          <button onClick={() => { splitClipAt(contextMenu.clipId, contextMenu.time); setContextMenu(undefined); }}>Split</button>
          <button onClick={() => { duplicateClip(contextMenu.clipId); setContextMenu(undefined); }}>Duplicate</button>
          <button onClick={() => { bringClipToPlayhead(contextMenu.clipId); setContextMenu(undefined); }}>Bring to playhead</button>
          {canAddContextTransition && (
            <button onClick={() => { addTransitionForClip(contextMenu.clipId); setContextMenu(undefined); }}>Add transition</button>
          )}
          {canFitContextAudio && (
            <button onClick={() => { startAudioFit(contextMenu.clipId); setContextMenu(undefined); }}>Fit duration to timeline</button>
          )}
        </div>
      )}
      {gapMenu && (
        <div
          className="clip-context-menu"
          style={{ left: gapMenu.x, top: gapMenu.y }}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button onClick={() => { closeTrackGap(gapMenu.trackId, gapMenu.time); setGapMenu(undefined); }}>Close gap</button>
          <button onClick={() => { closeAllTrackGaps(gapMenu.trackId); setGapMenu(undefined); }}>Close all gaps</button>
        </div>
      )}
      {audioFitModal && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="confirm-modal audio-fit-modal">
            <strong>Fit Audio To Timeline</strong>
            <p>
              Target duration: <b>{seconds(audioFitModal.targetSeconds)}</b>
            </p>
            <p>{audioFitModal.message}</p>
            {audioFitModal.status === "rendering" && (
              <div className="audio-fit-working">
                <progress />
              </div>
            )}
            {audioFitModal.status === "ready" && audioFitModal.result?.outputPath && (
              <div className="audio-fit-preview">
                <audio controls src={fileUrl(audioFitModal.result.outputPath)} />
                <span>{audioFitModal.result.outputPath}</span>
              </div>
            )}
            {audioFitModal.status === "error" && (
              <pre className="audio-fit-error">{audioFitModal.message}</pre>
            )}
            <div className="modal-actions">
              <button onClick={() => setAudioFitModal(undefined)} disabled={audioFitModal.status === "rendering"}>Cancel</button>
              <button className="accent" onClick={replaceTimelineAudioWithFit} disabled={audioFitModal.status !== "ready"}>Replace in timeline</button>
            </div>
          </div>
        </div>
      )}
      {showNewConfirm && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="confirm-modal">
            <strong>Start a new project?</strong>
            <p>This will clear the current project from the workspace.</p>
            <div className="modal-actions">
              <button onClick={() => setShowNewConfirm(false)}>Cancel</button>
              <button className="accent" onClick={newProject}>Continue</button>
            </div>
          </div>
        </div>
      )}
      {recoverySnapshot && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="confirm-modal">
            <strong>Recover autosaved project?</strong>
            <p>An autosave from {new Date(recoverySnapshot.savedAt).toLocaleString()} is available.</p>
            <div className="modal-actions">
              <button onClick={discardRecovery}>Discard</button>
              <button className="accent" onClick={restoreRecovery}>Restore</button>
            </div>
          </div>
        </div>
      )}
      {showReadme && (
        <div className="modal-backdrop readme-backdrop" role="dialog" aria-modal="true">
          <div className="readme-modal">
            <div className="readme-header">
              <div>
                <strong>Nonlinear Video Editor Readme</strong>
              </div>
              <button onClick={() => setShowReadme(false)}>Close</button>
            </div>
            <div className="readme-body">
              {renderReadme(readmeText)}
            </div>
          </div>
        </div>
      )}
      {showShortcuts && (
        <div className="modal-backdrop readme-backdrop" role="dialog" aria-modal="true">
          <div className="readme-modal shortcuts-modal">
            <div className="readme-header">
              <div>
                <strong>Keyboard Shortcuts</strong>
              </div>
              <button onClick={() => setShowShortcuts(false)}>Close</button>
            </div>
            <div className="shortcuts-body">
              {shortcutGroups.map((group) => (
                <section className="shortcut-group" key={group.title}>
                  <h2>{group.title}</h2>
                  <div className="shortcut-list">
                    {group.items.map(([keys, description]) => (
                      <div className="shortcut-row" key={keys}>
                        <kbd>{keys}</kbd>
                        <span>{description}</span>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PreviewVisualLayer({
  asset,
  clip,
  isPlaying,
  playhead,
  className,
  style
}: {
  asset: MediaAsset;
  clip: TimelineClip;
  isPlaying: boolean;
  playhead: number;
  className?: string;
  style?: CSSProperties;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || asset.type !== "video") return;
    const desired = clip.sourceIn + clamp(playhead - clip.start, 0, clip.duration);
    if (Math.abs(video.currentTime - desired) > 0.35) video.currentTime = desired;
    video.volume = className === "incoming" || className === "pip" ? 0 : clipVolumeAt(clip, playhead);
    if (isPlaying) video.play().catch(() => undefined);
    else video.pause();
  }, [asset.type, clip, isPlaying, playhead]);

  return (
    <div className={`preview-visual ${className ?? ""}`} style={style}>
      {clip.color ? (
        <div className="preview-colour" style={{ background: clip.color.value }} />
      ) : asset.type === "video" ? (
        <video
          key={`${clip.id}-${asset.id}`}
          ref={videoRef}
          src={fileUrl(asset.path)}
          muted={className === "incoming" || className === "pip"}
          preload="auto"
          onLoadedMetadata={(event) => {
            event.currentTarget.currentTime = clip.sourceIn + clamp(playhead - clip.start, 0, clip.duration);
          }}
        />
      ) : (
        <img src={fileUrl(asset.path)} alt="" />
      )}
    </div>
  );
}

function TrackLane({
  track,
  assets,
  pxPerSecond,
  selectedClipId,
  selectedClipIds,
  onSelect,
  onBeginEdit,
  onMove,
  onMoveEnd,
  onTrim,
  onDropAsset,
  onJump,
  onGapContextMenu,
  onClipContextMenu
}: {
  track: Track;
  assets: MediaAsset[];
  pxPerSecond: number;
  selectedClipId?: string;
  selectedClipIds: string[];
  onSelect: (id: string, event?: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }) => void;
  onBeginEdit: () => void;
  onMove: (clipId: string, trackId: string, left: number) => void;
  onMoveEnd: (clipId: string, left: number) => void;
  onTrim: (baseClip: TimelineClip, edge: "left" | "right", delta: number) => void;
  onDropAsset: (assetId: string, trackId: string, offsetX: number) => void;
  onJump: (offsetX: number) => void;
  onGapContextMenu: (trackId: string, x: number, y: number, time: number) => void;
  onClipContextMenu: (clipId: string, x: number, y: number, time: number) => void;
}) {
  const [drag, setDrag] = useState<{ id: string; startX: number; left: number; currentLeft: number; began: boolean }>();
  const [trim, setTrim] = useState<{ clip: TimelineClip; edge: "left" | "right"; startX: number; began: boolean }>();

  useEffect(() => {
    function move(event: MouseEvent) {
      if (drag) {
        const nextLeft = drag.left + event.clientX - drag.startX;
        if (!drag.began) {
          onBeginEdit();
          setDrag({ ...drag, began: true, currentLeft: nextLeft });
        } else {
          setDrag({ ...drag, currentLeft: nextLeft });
        }
        onMove(drag.id, track.id, nextLeft);
      }
      if (trim) {
        if (!trim.began) {
          onBeginEdit();
          setTrim({ ...trim, began: true });
        }
        onTrim(trim.clip, trim.edge, Math.round(((event.clientX - trim.startX) / pxPerSecond) / snap) * snap);
      }
    }
    function up() {
      if (drag?.began) onMoveEnd(drag.id, drag.currentLeft);
      setDrag(undefined);
      setTrim(undefined);
    }
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [drag, onBeginEdit, onMove, onMoveEnd, onTrim, track.id, trim]);

  return (
    <div className="track-row">
      <div className="track-label">{track.name}</div>
      <div
        className="track-lane"
        onDragOver={(event) => event.preventDefault()}
        onMouseDown={(event) => {
          if (event.button !== 0) return;
          if (event.target !== event.currentTarget) return;
          const rect = event.currentTarget.getBoundingClientRect();
          onJump(event.clientX - rect.left);
        }}
        onContextMenu={(event) => {
          if ((event.target as HTMLElement).closest(".clip")) return;
          event.preventDefault();
          event.stopPropagation();
          const rect = event.currentTarget.getBoundingClientRect();
          onGapContextMenu(track.id, event.clientX, event.clientY, Math.max(0, (event.clientX - rect.left) / pxPerSecond));
        }}
        onDrop={(event) => {
          event.preventDefault();
          const assetId = event.dataTransfer.getData("application/x-nve-asset");
          if (!assetId) return;
          const rect = event.currentTarget.getBoundingClientRect();
          onDropAsset(assetId, track.id, event.clientX - rect.left);
        }}
      >
        {track.clips.map((clip) => {
          const asset = clip.assetId ? assets.find((item) => item.id === clip.assetId) : undefined;
          return (
          <div
            className={`clip ${clip.type} ${clip.color ? "color-clip" : ""} ${selectedClipIds.includes(clip.id) ? "selected" : ""} ${clip.id === selectedClipId ? "primary-selected" : ""}`}
            key={clip.id}
            style={{
              left: clip.start * pxPerSecond,
              width: Math.max(46, clip.duration * pxPerSecond),
              ...(clip.color ? { background: clip.color.value } : {})
            }}
            onMouseDown={(event) => {
              if (event.button !== 0) return;
              const isMultiDrag = selectedClipIds.length > 1 && selectedClipIds.includes(clip.id) && !event.ctrlKey && !event.metaKey && !event.shiftKey;
              if (!isMultiDrag) onSelect(clip.id, event);
              setDrag({ id: clip.id, startX: event.clientX, left: clip.start * pxPerSecond, currentLeft: clip.start * pxPerSecond, began: false });
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              const lane = event.currentTarget.parentElement;
              const rect = lane?.getBoundingClientRect();
              const time = rect ? Math.max(0, (event.clientX - rect.left) / pxPerSecond) : clip.start;
              onSelect(clip.id);
              onClipContextMenu(clip.id, event.clientX, event.clientY, time);
            }}
          >
            {clip.type === "video" && asset?.thumbnailPath && (
              <div className="clip-thumbnail-strip" aria-hidden="true">
                {Array.from({ length: Math.max(1, Math.min(8, Math.floor((clip.duration * pxPerSecond) / 86))) }).map((_, index) => (
                  <img key={index} src={fileUrl(asset.thumbnailPath!)} alt="" />
                ))}
              </div>
            )}
            <span className="trim left" onMouseDown={(event) => { event.stopPropagation(); onSelect(clip.id, event); setTrim({ clip, edge: "left", startX: event.clientX, began: false }); }} />
            <strong>{clip.name}</strong>
            {clip.type === "audio" && (
              <div className="waveform" aria-hidden="true">
                {waveformBars(`${clip.id}-${clip.name}`, 96).map((height, index) => (
                  <i key={index} style={{ height: `${height}%` }} />
                ))}
                {(clip.fadeIn ?? 0) > 0 && (
                  <span className="waveform-fade fade-in" style={{ width: `${Math.min(100, ((clip.fadeIn ?? 0) / clip.duration) * 100)}%` }} />
                )}
                {(clip.fadeOut ?? 0) > 0 && (
                  <span className="waveform-fade fade-out" style={{ width: `${Math.min(100, ((clip.fadeOut ?? 0) / clip.duration) * 100)}%` }} />
                )}
              </div>
            )}
            <small>{seconds(clip.duration)}</small>
            {clip.type === "transition" && <span className="transition-center" />}
            <span className="trim right" onMouseDown={(event) => { event.stopPropagation(); onSelect(clip.id, event); setTrim({ clip, edge: "right", startX: event.clientX, began: false }); }} />
          </div>
          );
        })}
      </div>
    </div>
  );
}
