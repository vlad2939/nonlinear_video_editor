import { app, BrowserWindow, dialog, ipcMain, Menu } from "electron";
import { spawn, type SpawnOptionsWithoutStdio } from "node:child_process";
import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";
import type { AudioFitRequest, AudioFitResult, ExportOptions, ExportResult, ImportResult, MediaAsset, Project, ProjectValidationResult, RecoverySnapshot, TimelineClip, TransitionType } from "../src/shared/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const devServerUrl = process.env.VITE_DEV_SERVER_URL;
const appIconPath = path.join(process.cwd(), "assets", "icon.ico");
const vendorFfmpegPath = path.join(process.cwd(), "vendor", "ffmpeg", "win64", "ffmpeg.exe");
const vendorFfprobePath = path.join(process.cwd(), "vendor", "ffmpeg", "win64", "ffprobe.exe");
const mp3FitRoot = path.join(process.cwd(), "mp3_fit");
const mp3FitPythonPath = path.join(mp3FitRoot, ".venv", "Scripts", "python.exe");
const hasVendorFfmpeg = existsSync(vendorFfmpegPath);
const ffmpegPath = hasVendorFfmpeg ? vendorFfmpegPath : ffmpegInstaller.path;
const ffprobePath = existsSync(vendorFfprobePath) ? vendorFfprobePath : ffprobeInstaller.path;
const imageDuration = 5;
const transitionSnapThreshold = 0.18;
const titleCanvasWidth = 1920;
const titleCanvasHeight = 1080;
const primaryVideoTrackId = "track-video-1";
const pipVideoTrackId = "track-video-2";

let mainWindow: BrowserWindow | undefined;

function recoveryPath() {
  return path.join(app.getPath("userData"), "project-recovery.nve.json");
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: "#101114",
    title: "Nonlinear Video Editor",
    autoHideMenuBar: true,
    icon: existsSync(appIconPath) ? appIconPath : undefined,
    webPreferences: {
      preload: path.join(app.getAppPath(), "electron", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.maximize();
  Menu.setApplicationMenu(null);
  mainWindow.setMenuBarVisibility(false);

  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (!input.control || input.type !== "keyDown") return;
    const currentZoom = mainWindow?.webContents.getZoomFactor() ?? 1;
    if (input.key === "+" || input.key === "=") {
      mainWindow?.webContents.setZoomFactor(Math.min(2, currentZoom + 0.1));
      event.preventDefault();
    }
    if (input.key === "-") {
      mainWindow?.webContents.setZoomFactor(Math.max(0.5, currentZoom - 0.1));
      event.preventDefault();
    }
    if (input.key === "0") {
      mainWindow?.webContents.setZoomFactor(1);
      event.preventDefault();
    }
  });

  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../../dist/index.html"));
  }
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

function id(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function mediaTypeFor(filePath: string): "video" | "audio" | "image" | undefined {
  const ext = path.extname(filePath).toLowerCase();
  if ([".mp4", ".mov", ".m4v", ".mkv", ".webm", ".avi"].includes(ext)) return "video";
  if ([".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg"].includes(ext)) return "audio";
  if ([".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif", ".tif", ".tiff"].includes(ext)) return "image";
  return undefined;
}

function runProcess(command: string, args: string[], onData?: (chunk: string) => void, options?: SpawnOptionsWithoutStdio): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, ...options });
    let output = "";
    let error = "";
    child.stdout.on("data", (data: Buffer) => {
      const chunk = data.toString();
      output += chunk;
      onData?.(chunk);
    });
    child.stderr.on("data", (data: Buffer) => {
      const chunk = data.toString();
      error += chunk;
      onData?.(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(output || error);
      else reject(new Error(error || `Process exited with code ${code}`));
    });
  });
}

function conciseError(error: Error): string {
  const lines = error.message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.at(-1) ?? "Export failed.";
}

async function probeDuration(filePath: string): Promise<number> {
  if (mediaTypeFor(filePath) === "image") return imageDuration;
  try {
    const output = await runProcess(ffprobePath, [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath
    ]);
    const parsed = Number.parseFloat(output.trim());
    return Number.isFinite(parsed) ? parsed : 10;
  } catch {
    return 10;
  }
}

async function probeHasAudio(filePath: string): Promise<boolean> {
  try {
    const output = await runProcess(ffprobePath, [
      "-v",
      "error",
      "-select_streams",
      "a",
      "-show_entries",
      "stream=index",
      "-of",
      "csv=p=0",
      filePath
    ]);
    return output.trim().length > 0;
  } catch {
    return false;
  }
}

async function probeAudioBitrate(filePath: string): Promise<string> {
  try {
    const output = await runProcess(ffprobePath, [
      "-v",
      "error",
      "-select_streams",
      "a:0",
      "-show_entries",
      "stream=bit_rate:format=bit_rate",
      "-of",
      "json",
      filePath
    ]);
    const data = JSON.parse(output);
    const raw = Number(data.streams?.[0]?.bit_rate ?? data.format?.bit_rate);
    if (!Number.isFinite(raw) || raw <= 0) return "192k";
    return `${Math.max(64, Math.min(320, Math.round(raw / 1000)))}k`;
  } catch {
    return "192k";
  }
}

function fittedAudioOutputPath(sourcePath: string) {
  const parsed = path.parse(sourcePath);
  return path.join(parsed.dir, `${parsed.name}_fit.mp3`);
}

async function runMp3FitCli(args: string[]): Promise<string> {
  const env = {
    ...process.env,
    PYTHONPATH: path.join(mp3FitRoot, "src")
  };
  const candidates: Array<{ command: string; args: string[] }> = [
    ...(existsSync(mp3FitPythonPath) ? [{ command: mp3FitPythonPath, args: [] }] : []),
    { command: "py", args: ["-3"] },
    { command: "python", args: [] }
  ];
  const errors: string[] = [];
  for (const candidate of candidates) {
    try {
      return await runProcess(candidate.command, [...candidate.args, "-m", "mp3_fit.cli", ...args], undefined, { cwd: mp3FitRoot, env });
    } catch (error) {
      errors.push(conciseError(error as Error));
    }
  }
  throw new Error(`Python 3.10+ with MP3 Fit dependencies is required. Close the editor and run start.bat from the editor folder once. ${errors.at(-1) ?? ""}`);
}

async function fileHash(filePath: string): Promise<string> {
  const stat = await fs.stat(filePath);
  return `${path.basename(filePath).replace(/\W+/g, "-")}-${stat.size}-${stat.mtimeMs}`.slice(0, 96);
}

async function generateThumbnail(asset: MediaAsset): Promise<string | undefined> {
  if (asset.type === "image") return asset.path;
  if (asset.type !== "video") return undefined;
  const cacheDir = path.join(app.getPath("userData"), "thumbnails");
  await fs.mkdir(cacheDir, { recursive: true });
  const thumbPath = path.join(cacheDir, `${await fileHash(asset.path)}.jpg`);
  try {
    await fs.access(thumbPath);
    return thumbPath;
  } catch {
    await runProcess(ffmpegPath, ["-y", "-ss", "00:00:01", "-i", asset.path, "-frames:v", "1", "-vf", "scale=320:-1", thumbPath]);
    return thumbPath;
  }
}

ipcMain.handle("media:import", async (): Promise<ImportResult> => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "Media", extensions: ["mp4", "mov", "m4v", "mkv", "webm", "avi", "mp3", "wav", "m4a", "aac", "flac", "ogg", "jpg", "jpeg", "png", "webp", "bmp", "gif", "tif", "tiff"] }
    ]
  });

  if (result.canceled) return { accepted: [], rejected: [] };

  const accepted: MediaAsset[] = [];
  const rejected: string[] = [];
  for (const filePath of result.filePaths) {
    const type = mediaTypeFor(filePath);
    if (!type) {
      rejected.push(path.basename(filePath));
      continue;
    }
    const asset: MediaAsset = {
      id: id("asset"),
      name: path.basename(filePath),
      path: filePath,
      type,
      duration: await probeDuration(filePath)
    };
    accepted.push(asset);
  }
  return { accepted, rejected };
});

ipcMain.handle("media:thumbnail", async (_event, asset: MediaAsset): Promise<string | undefined> => {
  return generateThumbnail(asset);
});

ipcMain.handle("audio-fit:render", async (_event, request: AudioFitRequest): Promise<AudioFitResult> => {
  try {
    if (!existsSync(request.sourcePath)) {
      return { ok: false, message: "Source audio file was not found." };
    }
    const outputPath = fittedAudioOutputPath(request.sourcePath);
    const bitrate = await probeAudioBitrate(request.sourcePath);
    const output = await runMp3FitCli(
      [
        "render",
        "--input",
        request.sourcePath,
        "--target",
        Math.max(1, request.targetSeconds).toString(),
        "--output",
        outputPath,
        "--bitrate",
        bitrate
      ]
    );
    const parsed = JSON.parse(output.trim().split(/\r?\n/).at(-1) ?? "{}");
    if (!parsed.ok) return { ok: false, message: parsed.message ?? "Audio fit failed." };
    return {
      ok: true,
      outputPath,
      duration: await probeDuration(outputPath),
      message: "Audio fit ready."
    };
  } catch (error) {
    return { ok: false, message: conciseError(error as Error) };
  }
});

function emptyProjectFor(filePath: string): Project {
  const createdAt = new Date().toISOString();
  const rawName = path.basename(filePath).replace(/\.nve\.json$/i, "").replace(/\.json$/i, "");
  return {
    id: id("project"),
    name: rawName || "Untitled Project",
    path: filePath,
    createdAt,
    updatedAt: createdAt,
    assets: [],
    duration: 30,
    exportSettings: {
      width: 1920,
      height: 1080,
      fps: 30,
      crf: 20,
      preset: "medium",
      audioBitrate: "192k",
      logoPosition: "top-left",
      logoSize: "small",
      logoTransparency: 50
    },
    tracks: [
      { id: primaryVideoTrackId, name: "Video 1", type: "video", clips: [] },
      { id: pipVideoTrackId, name: "Video 2 / PiP", type: "video", clips: [] },
      { id: "track-transition-1", name: "Transitions", type: "transition", clips: [] },
      { id: "track-audio-1", name: "Audio 1", type: "audio", clips: [] },
      { id: "track-text-1", name: "Titles", type: "text", clips: [] }
    ]
  };
}

ipcMain.handle("project:create", async (): Promise<Project | undefined> => {
  const target = await dialog.showSaveDialog(mainWindow!, {
    title: "Create New Project",
    defaultPath: "Untitled Project.nve.json",
    filters: [{ name: "Video Editor Project", extensions: ["nve.json", "json"] }]
  });
  if (target.canceled || !target.filePath) return undefined;
  const project = emptyProjectFor(target.filePath);
  await fs.writeFile(target.filePath, JSON.stringify(project, null, 2), "utf8");
  return project;
});

ipcMain.handle("project:save", async (_event, project: Project): Promise<Project | undefined> => {
  const target = await dialog.showSaveDialog(mainWindow!, {
    title: "Save Project",
    defaultPath: project.path ?? `${project.name || "Untitled Project"}.nve.json`,
    filters: [{ name: "Video Editor Project", extensions: ["nve.json", "json"] }]
  });
  if (target.canceled || !target.filePath) return undefined;
  const saved = { ...project, path: target.filePath, updatedAt: new Date().toISOString() };
  await fs.writeFile(target.filePath, JSON.stringify(saved, null, 2), "utf8");
  return saved;
});

ipcMain.handle("project:open", async (): Promise<Project | undefined> => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: "Load Project",
    properties: ["openFile"],
    filters: [{ name: "Video Editor Project", extensions: ["nve.json", "json"] }]
  });
  if (result.canceled || result.filePaths.length === 0) return undefined;
  const filePath = result.filePaths[0];
  const content = await fs.readFile(filePath, "utf8");
  return { ...JSON.parse(content), path: filePath };
});

ipcMain.handle("project:validate", async (_event, project: Project): Promise<ProjectValidationResult> => {
  const usedAssetIds = new Set(project.tracks.flatMap((track) => track.clips.map((clip) => clip.assetId).filter(Boolean)));
  const paths = project.assets
    .filter((asset) => asset.type !== "color" && usedAssetIds.has(asset.id))
    .map((asset) => asset.path);
  if (project.exportSettings?.logoPath) paths.push(project.exportSettings.logoPath);
  const missing: string[] = [];
  for (const filePath of paths) {
    try {
      await fs.access(filePath);
    } catch {
      missing.push(filePath);
    }
  }
  return { ok: missing.length === 0, missing };
});

ipcMain.handle("recovery:load", async (): Promise<RecoverySnapshot | undefined> => {
  try {
    const content = await fs.readFile(recoveryPath(), "utf8");
    return JSON.parse(content) as RecoverySnapshot;
  } catch {
    return undefined;
  }
});

ipcMain.handle("recovery:save", async (_event, project: Project): Promise<void> => {
  const snapshot: RecoverySnapshot = {
    project: { ...project, updatedAt: new Date().toISOString() },
    savedAt: new Date().toISOString()
  };
  await fs.writeFile(recoveryPath(), JSON.stringify(snapshot, null, 2), "utf8");
});

ipcMain.handle("recovery:clear", async (): Promise<void> => {
  try {
    await fs.unlink(recoveryPath());
  } catch {
    // No recovery file to clear.
  }
});

ipcMain.handle("export:select-logo", async (): Promise<string | undefined> => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ["openFile"],
    filters: [
      { name: "Logo Image", extensions: ["png", "jpg", "jpeg", "webp", "bmp"] },
      { name: "All Files", extensions: ["*"] }
    ]
  });
  if (result.canceled || result.filePaths.length === 0) return undefined;
  return result.filePaths[0];
});

function primaryVideoClips(project: Project): TimelineClip[] {
  return project.tracks
    .filter((track) => track.type === "video" && track.id !== pipVideoTrackId)
    .flatMap((track) => track.clips)
    .filter((clip) => clip.assetId || clip.color)
    .sort((a, b) => a.start - b.start);
}

function pipVideoClips(project: Project): TimelineClip[] {
  return project.tracks
    .filter((track) => track.id === pipVideoTrackId)
    .flatMap((track) => track.clips)
    .filter((clip) => clip.assetId || clip.color)
    .sort((a, b) => a.start - b.start);
}

function textClips(project: Project): TimelineClip[] {
  return project.tracks
    .filter((track) => track.type === "text")
    .flatMap((track) => track.clips)
    .sort((a, b) => a.start - b.start);
}

function audioClips(project: Project): TimelineClip[] {
  return project.tracks
    .filter((track) => track.type === "audio")
    .flatMap((track) => track.clips)
    .filter((clip) => clip.assetId)
    .sort((a, b) => a.start - b.start);
}

function transitionClips(project: Project): TimelineClip[] {
  return project.tracks
    .filter((track) => track.type === "transition")
    .flatMap((track) => track.clips)
    .sort((a, b) => a.start - b.start);
}

function timelineEnd(project: Project): number {
  return Math.max(0, ...project.tracks.flatMap((track) => track.clips.map((clip) => clip.start + clip.duration)));
}

function ffmpegXfadeName(kind: TransitionType | undefined) {
  switch (kind) {
    case "dip-to-black":
      return "fadeblack";
    case "dip-to-white":
      return "fadewhite";
    case "wipe-left":
      return "wipeleft";
    case "wipe-right":
      return "wiperight";
    case "wipe-up":
      return "wipeup";
    case "wipe-down":
      return "wipedown";
    case "slide-left":
      return "slideleft";
    case "slide-right":
      return "slideright";
    case "zoom":
      return "zoomin";
    case "blur-dissolve":
      return "hblur";
    case "luma-fade":
      return "fadegrays";
    case "cross-dissolve":
      return "dissolve";
    case "fade":
    default:
      return "fade";
  }
}

function ffmpegEscape(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/,/g, "\\,").replace(/'/g, "\\'").replace(/\r?\n/g, " ");
}

function ffmpegColor(value: string) {
  return value.startsWith("#") ? `0x${value.slice(1)}` : value;
}

function ffmpegColorWithAlpha(value: string, alpha = 1) {
  return `${ffmpegColor(value)}@${Math.max(0, Math.min(1, alpha)).toFixed(3)}`;
}

function logoWidthFor(size: ExportOptions["logoSize"], outputWidth: number) {
  const factor = size === "large" ? 0.11 : size === "medium" ? 0.075 : 0.05;
  const maximum = size === "large" ? 140 : size === "medium" ? 96 : 64;
  return Math.max(24, Math.min(maximum, Math.round(outputWidth * factor)));
}

function logoOverlayPosition(position: ExportOptions["logoPosition"]) {
  const margin = 24;
  switch (position) {
    case "top-right":
      return { x: `W-w-${margin}`, y: `${margin}` };
    case "bottom-left":
      return { x: `${margin}`, y: `H-h-${margin}` };
    case "bottom-right":
      return { x: `W-w-${margin}`, y: `H-h-${margin}` };
    case "top-left":
    default:
      return { x: `${margin}`, y: `${margin}` };
  }
}

function pipWidthFor(clip: TimelineClip, outputWidth: number) {
  const size = clip.pip?.size ?? "medium";
  const percent = size === "large" ? 42 : size === "small" ? 22 : size === "custom" ? clip.pip?.scalePercent ?? 32 : 32;
  return Math.max(32, Math.round(outputWidth * Math.max(5, Math.min(100, percent)) / 100));
}

function pipOverlayPosition(clip: TimelineClip, outputWidth: number, outputHeight: number) {
  const position = clip.pip?.position ?? "top-right";
  const x = clip.pip?.x ?? 64;
  const y = clip.pip?.y ?? 64;
  const margin = Math.max(12, Math.round(outputWidth * 0.03));
  if (position === "custom") {
    return {
      x: Math.round(outputWidth * Math.max(0, Math.min(100, x)) / 100).toString(),
      y: Math.round(outputHeight * Math.max(0, Math.min(100, y)) / 100).toString()
    };
  }
  switch (position) {
    case "top-left":
      return { x: `${margin}`, y: `${margin}` };
    case "bottom-left":
      return { x: `${margin}`, y: `H-h-${margin}` };
    case "bottom-right":
      return { x: `W-w-${margin}`, y: `H-h-${margin}` };
    case "top-right":
    default:
      return { x: `W-w-${margin}`, y: `${margin}` };
  }
}

function fontFileFor(text: TimelineClip["text"]) {
  const italic = Boolean(text?.italic);
  const bold = (text?.fontWeight ?? 800) >= 700;
  const file = bold && italic ? "arialbi.ttf" : bold ? "arialbd.ttf" : italic ? "ariali.ttf" : "arial.ttf";
  return ffmpegEscape(path.join("C:", "Windows", "Fonts", file).replace(/\\/g, "/"));
}

function audioFadeFilter(clip: TimelineClip, includeDelay = false) {
  const filters: string[] = [];
  const fadeIn = Math.max(0, Math.min(clip.fadeIn ?? 0, clip.duration));
  const fadeOut = Math.max(0, Math.min(clip.fadeOut ?? 0, clip.duration));
  if (fadeIn > 0) filters.push(`afade=t=in:st=0:d=${fadeIn}`);
  if (fadeOut > 0) filters.push(`afade=t=out:st=${Math.max(0, clip.duration - fadeOut)}:d=${fadeOut}`);
  if (includeDelay) {
    const delay = Math.max(0, Math.round(clip.start * 1000));
    filters.push(`adelay=${delay}|${delay}`);
  }
  filters.push(`volume=${clip.volume}`);
  return filters.join(",");
}

async function renderExport(project: Project, options: ExportOptions): Promise<ExportResult> {
  const saveResult = options.outputPath
    ? { canceled: false, filePath: options.outputPath }
    : await dialog.showSaveDialog(mainWindow!, {
        title: "Export MP4",
        defaultPath: `${project.name || "untitled"}.mp4`,
        filters: [{ name: "MP4 Video", extensions: ["mp4"] }]
      });
  if (saveResult.canceled || !saveResult.filePath) return { ok: false, message: "Export canceled." };

  const assetsById = new Map(project.assets.map((asset) => [asset.id, asset]));
  const videoClips = primaryVideoClips(project);
  if (videoClips.length === 0) return { ok: false, message: "Add at least one video clip before exporting." };
  const exportDuration = Math.max(timelineEnd(project), ...videoClips.map((clip) => clip.start + clip.duration));
  const transitions = transitionClips(project);
  const crf = (options.crf ?? 20).toString();
  const preset = options.preset ?? "medium";
  const audioBitrate = options.audioBitrate ?? "192k";

  const tempDir = await fs.mkdtemp(path.join(app.getPath("temp"), "nve-export-"));
  const segmentList = path.join(tempDir, "segments.txt");
  const segmentPaths: string[] = [];
  const segmentMetas: Array<{ path: string; kind: "gap" | "video"; start: number; duration: number; clipId?: string }> = [];
  let timelineCursor = 0;

  async function addBlackSegment(duration: number) {
    if (duration <= 0.05) return;
    const segmentPath = path.join(tempDir, `gap-${segmentPaths.length}.mp4`);
    segmentPaths.push(segmentPath);
    segmentMetas.push({ path: segmentPath, kind: "gap", start: timelineCursor, duration });
    await runProcess(ffmpegPath, [
      "-y",
      "-f",
      "lavfi",
      "-i",
      `color=c=black:s=${options.width}x${options.height}:r=${options.fps}`,
      "-f",
      "lavfi",
      "-i",
      "anullsrc=channel_layout=stereo:sample_rate=48000",
      "-t",
      duration.toString(),
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-c:v",
      "libx264",
      "-preset",
      preset,
      "-crf",
      crf,
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      audioBitrate,
      segmentPath
    ]);
  }

  function transitionAtBoundary(boundary: number) {
    return transitions.find((clip) =>
      clip.duration > 0
      && clip.start <= boundary + transitionSnapThreshold
      && clip.start + clip.duration >= boundary - transitionSnapThreshold
    );
  }

  function transitionFadeColor(transition: TimelineClip | undefined) {
    return transition?.transition?.kind === "dip-to-white" ? "white" : "black";
  }

  for (let index = 0; index < videoClips.length; index += 1) {
    const clip = videoClips[index];
    const asset = clip.assetId ? assetsById.get(clip.assetId) : undefined;
    if (!asset && !clip.color) continue;
    if (clip.start > timelineCursor) await addBlackSegment(clip.start - timelineCursor);
    const segmentPath = path.join(tempDir, `segment-${segmentPaths.length}.mp4`);
    segmentPaths.push(segmentPath);
    segmentMetas.push({ path: segmentPath, kind: "video", start: clip.start, duration: clip.duration, clipId: clip.id });
    const hasAudio = asset?.type === "video" && await probeHasAudio(asset.path);
    const segmentArgs = clip.color
      ? [
          "-y",
          "-f",
          "lavfi",
          "-i",
          `color=c=${ffmpegColor(clip.color.value)}:s=${options.width}x${options.height}:r=${options.fps}`,
          "-f",
          "lavfi",
          "-i",
          "anullsrc=channel_layout=stereo:sample_rate=48000"
        ]
      : asset?.type === "image"
      ? [
          "-y",
          "-loop",
          "1",
          "-i",
          asset.path,
          "-f",
          "lavfi",
          "-i",
          "anullsrc=channel_layout=stereo:sample_rate=48000"
        ]
      : [
          "-y",
          "-ss",
          clip.sourceIn.toString(),
          "-i",
          asset!.path
        ];
    if (!clip.color && asset?.type !== "image" && !hasAudio) {
      segmentArgs.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000");
    }
    const incomingTransition = hasVendorFfmpeg ? undefined : transitionAtBoundary(clip.start);
    const outgoingTransition = hasVendorFfmpeg ? undefined : transitionAtBoundary(clip.start + clip.duration);
    const incomingFade = incomingTransition ? Math.min(incomingTransition.duration, clip.duration / 2) : 0;
    const outgoingFade = outgoingTransition ? Math.min(outgoingTransition.duration, clip.duration / 2) : 0;
    const videoFilters = [
      `scale=${options.width}:${options.height}:force_original_aspect_ratio=decrease`,
      `pad=${options.width}:${options.height}:(ow-iw)/2:(oh-ih)/2`
    ];
    if (incomingFade > 0.05) {
      videoFilters.push(`fade=t=in:st=0:d=${incomingFade}:color=${transitionFadeColor(incomingTransition)}`);
    }
    if (outgoingFade > 0.05) {
      videoFilters.push(`fade=t=out:st=${Math.max(0, clip.duration - outgoingFade)}:d=${outgoingFade}:color=${transitionFadeColor(outgoingTransition)}`);
    }
    segmentArgs.push(
      "-t",
      clip.duration.toString(),
      "-map",
      "0:v:0",
      "-map",
      hasAudio ? "0:a:0" : "1:a:0",
      "-vf",
      videoFilters.join(","),
      "-r",
      options.fps.toString(),
      "-c:v",
      "libx264",
      "-preset",
      preset,
      "-crf",
      crf,
      "-pix_fmt",
      "yuv420p",
      "-filter:a",
      audioFadeFilter(clip),
      "-c:a",
      "aac",
      "-b:a",
      audioBitrate,
      segmentPath
    );
    await runProcess(ffmpegPath, segmentArgs);
    timelineCursor = Math.max(timelineCursor, clip.start + clip.duration);
    mainWindow?.webContents.send("export:progress", Math.round(((index + 1) / (videoClips.length + 2)) * 70));
  }
  if (exportDuration > timelineCursor) await addBlackSegment(exportDuration - timelineCursor);

  const concatPath = path.join(tempDir, "concat.mp4");
  const transitionForBoundary = (left: typeof segmentMetas[number], right: typeof segmentMetas[number]) => {
    if (left.kind !== "video" || right.kind !== "video") return undefined;
    const boundary = right.start;
    return transitions.find((clip) =>
      clip.duration > 0
      && clip.start <= boundary + transitionSnapThreshold
      && clip.start + clip.duration >= boundary - transitionSnapThreshold
    );
  };
  const hasVideoTransitions = hasVendorFfmpeg && segmentMetas.some((meta, index) =>
    index > 0 && Boolean(transitionForBoundary(segmentMetas[index - 1], meta))
  );
  if (hasVideoTransitions && segmentPaths.length > 1) {
    const transitionArgs = ["-y"];
    segmentPaths.forEach((segment) => transitionArgs.push("-i", segment));
    const filters: string[] = [];
    segmentMetas.forEach((_, index) => {
      filters.push(`[${index}:v:0]settb=AVTB,setpts=PTS-STARTPTS,format=yuv420p[v${index}]`);
      filters.push(`[${index}:a:0]asetpts=PTS-STARTPTS,aresample=48000[a${index}]`);
    });
    let currentVideo = "[v0]";
    let currentAudio = "[a0]";
    let currentDuration = segmentMetas[0].duration;
    for (let index = 1; index < segmentMetas.length; index += 1) {
      const transition = transitionForBoundary(segmentMetas[index - 1], segmentMetas[index]);
      if (transition) {
        const duration = Math.min(transition.duration, currentDuration - 0.05, segmentMetas[index].duration - 0.05);
        if (duration > 0.05) {
          const rightStart = segmentMetas[index].start;
          const existingOverlap = Math.max(0, currentDuration - rightStart);
          const padDuration = Math.max(0, duration - existingOverlap);
          const paddedVideo = padDuration > 0 ? `[vpad${index}]` : currentVideo;
          const paddedAudio = padDuration > 0 ? `[apad${index}]` : currentAudio;
          const videoLabel = `[vx${index}]`;
          const audioLabel = `[ax${index}]`;
          const offset = Math.max(0, rightStart);
          if (padDuration > 0) {
            filters.push(`${currentVideo}tpad=stop_mode=clone:stop_duration=${padDuration}${paddedVideo}`);
            filters.push(`${currentAudio}apad=pad_dur=${padDuration}${paddedAudio}`);
          }
          filters.push(`${paddedVideo}[v${index}]xfade=transition=${ffmpegXfadeName(transition.transition?.kind)}:duration=${duration}:offset=${offset}${videoLabel}`);
          filters.push(`${paddedAudio}[a${index}]acrossfade=d=${duration}:c1=tri:c2=tri${audioLabel}`);
          currentVideo = videoLabel;
          currentAudio = audioLabel;
          currentDuration = Math.max(currentDuration + padDuration + segmentMetas[index].duration - duration, rightStart + segmentMetas[index].duration);
          continue;
        }
      }
      const videoLabel = `[cv${index}]`;
      const audioLabel = `[ca${index}]`;
      filters.push(`${currentVideo}${currentAudio}[v${index}][a${index}]concat=n=2:v=1:a=1${videoLabel}${audioLabel}`);
      currentVideo = videoLabel;
      currentAudio = audioLabel;
      currentDuration += segmentMetas[index].duration;
    }
    transitionArgs.push(
      "-filter_complex",
      filters.join(";"),
      "-map",
      currentVideo,
      "-map",
      currentAudio,
      "-c:v",
      "libx264",
      "-preset",
      preset,
      "-crf",
      crf,
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      audioBitrate,
      concatPath
    );
    await runProcess(ffmpegPath, transitionArgs);
  } else {
    await fs.writeFile(segmentList, segmentPaths.map((segment) => `file '${segment.replace(/'/g, "'\\''")}'`).join("\n"), "utf8");
    await runProcess(ffmpegPath, ["-y", "-f", "concat", "-safe", "0", "-i", segmentList, "-c", "copy", concatPath]);
  }
  mainWindow?.webContents.send("export:progress", 78);

  const texts = textClips(project);
  const audio = audioClips(project);
  const pipClips = pipVideoClips(project)
    .map((clip) => ({ clip, asset: clip.assetId ? assetsById.get(clip.assetId) : undefined }))
    .filter((item) => item.clip.color || item.asset);
  const args = ["-y", "-i", concatPath];
  let videoFilter = "";
  const hasLogo = Boolean(options.logoPath && existsSync(options.logoPath));
  for (const { clip, asset } of pipClips) {
    if (clip.color) {
      args.push("-f", "lavfi", "-i", `color=c=${ffmpegColor(clip.color.value)}:s=${options.width}x${options.height}:r=${options.fps}:d=${clip.duration}`);
    } else if (asset?.type === "image") {
      args.push("-loop", "1", "-t", clip.duration.toString(), "-i", asset.path);
    } else if (asset) {
      args.push("-ss", clip.sourceIn.toString(), "-t", clip.duration.toString(), "-i", asset.path);
    }
  }
  const logoInputIndex = hasLogo ? 1 + pipClips.length : undefined;
  if (hasLogo && options.logoPath) args.push("-i", options.logoPath);
  const audioInputOffset = 1 + pipClips.length + (hasLogo ? 1 : 0);
  const titleScaleX = options.width / titleCanvasWidth;
  const titleScaleY = options.height / titleCanvasHeight;
  const titleFontScale = Math.min(titleScaleX, titleScaleY);

  if (texts.length > 0) {
    videoFilter = texts
      .map((clip) => {
        const text = clip.text ?? { content: clip.name, fontSize: 32, color: "#ffffff", x: 80, y: 80 };
        const x = Math.round(text.x * titleScaleX);
        const y = Math.round(text.y * titleScaleY);
        const fontSize = Math.max(1, Math.round(text.fontSize * titleFontScale));
        const alignX = text.align === "center" ? `${x}-text_w/2` : text.align === "right" ? `${x}-text_w` : x.toString();
        const box = (text.backgroundOpacity ?? 0) > 0 ? `:box=1:boxcolor=${ffmpegColorWithAlpha(text.backgroundColor ?? "#000000", text.backgroundOpacity)}` : "";
        const outline = (text.outlineWidth ?? 0) > 0 ? `:borderw=${text.outlineWidth}:bordercolor=${ffmpegColor(text.outlineColor ?? "#000000")}` : "";
        const shadow = (text.shadowBlur ?? 0) > 0 ? `:shadowx=2:shadowy=2:shadowcolor=${ffmpegColorWithAlpha(text.shadowColor ?? "#000000", Math.min(1, (text.shadowBlur ?? 12) / 12))}` : "";
        return `drawtext=fontfile='${fontFileFor(text)}':text='${ffmpegEscape(text.content)}':fontsize=${fontSize}:fontcolor=${ffmpegColorWithAlpha(text.color, text.opacity ?? 1)}:x=${alignX}:y=${y}${box}${outline}${shadow}:enable='between(t,${clip.start},${clip.start + clip.duration})'`;
      })
      .join(",");
  }

  const audioInputs = audio
    .map((clip) => ({ clip, asset: clip.assetId ? assetsById.get(clip.assetId) : undefined }))
    .filter((item): item is { clip: TimelineClip; asset: MediaAsset } => Boolean(item.asset));
  for (const { clip, asset } of audioInputs) {
    args.push("-ss", clip.sourceIn.toString(), "-t", clip.duration.toString(), "-i", asset.path);
  }

  const complexFilters: string[] = [];
  const hasVideoCompositing = Boolean(videoFilter || pipClips.length > 0 || hasLogo);
  let videoOutput = "0:v:0";
  if (hasVideoCompositing) {
    complexFilters.push("[0:v:0]setpts=PTS-STARTPTS[vbase]");
    videoOutput = "[vbase]";
  }
  if (videoFilter) {
    complexFilters.push(`${videoOutput}${videoFilter}[vtext]`);
    videoOutput = "[vtext]";
  }
  pipClips.forEach(({ clip }, index) => {
    const inputIndex = 1 + index;
    const width = pipWidthFor(clip, options.width);
    const opacity = Math.max(0, Math.min(1, clip.pip?.opacity ?? 1));
    const fadeIn = Math.max(0, Math.min(clip.fadeIn ?? 0, clip.duration));
    const fadeOut = Math.max(0, Math.min(clip.fadeOut ?? 0, clip.duration));
    const filters = [
      "setpts=PTS-STARTPTS",
      `scale=${width}:-2`,
      "format=rgba",
      `colorchannelmixer=aa=${opacity.toFixed(3)}`
    ];
    if (fadeIn > 0) filters.push(`fade=t=in:st=0:d=${fadeIn}:alpha=1`);
    if (fadeOut > 0) filters.push(`fade=t=out:st=${Math.max(0, clip.duration - fadeOut)}:d=${fadeOut}:alpha=1`);
    if (clip.pip?.border ?? true) filters.push("drawbox=x=0:y=0:w=iw:h=ih:color=white@0.72:t=4");
    if (clip.start > 0) filters.push(`tpad=start_duration=${clip.start}:start_mode=add:color=black@0`);
    filters.push("format=rgba");
    const pipLabel = `[pip${index}]`;
    const outputLabel = `[vpip${index}]`;
    const position = pipOverlayPosition(clip, options.width, options.height);
    complexFilters.push(`[${inputIndex}:v:0]${filters.join(",")}${pipLabel}`);
    complexFilters.push(`${videoOutput}${pipLabel}overlay=x=${position.x}:y=${position.y}:format=auto:eof_action=pass:repeatlast=0${outputLabel}`);
    videoOutput = outputLabel;
  });
  if (hasLogo && logoInputIndex !== undefined) {
    const logoWidth = logoWidthFor(options.logoSize, options.width);
    const logoAlpha = Math.max(0.1, Math.min(1, 1 - (options.logoTransparency ?? 50) / 100));
    const position = logoOverlayPosition(options.logoPosition);
    complexFilters.push(`[${logoInputIndex}:v:0]scale=${logoWidth}:-1,format=rgba,colorchannelmixer=aa=${logoAlpha.toFixed(3)}[logo]`);
    complexFilters.push(`${videoOutput}[logo]overlay=x=${position.x}:y=${position.y}:format=auto[vlogo]`);
    videoOutput = "[vlogo]";
  }

  if (audioInputs.length > 0) {
    complexFilters.push("[0:a:0]volume=1[a0]");
    audioInputs.forEach(({ clip }, index) => {
      const inputIndex = audioInputOffset + index;
      complexFilters.push(`[${inputIndex}:a:0]${audioFadeFilter(clip, true)}[a${inputIndex}]`);
    });
    const mixInputs = ["[a0]", ...audioInputs.map((_, index) => `[a${audioInputOffset + index}]`)].join("");
    complexFilters.push(`${mixInputs}amix=inputs=${audioInputs.length + 1}:duration=longest:dropout_transition=0[aout]`);
  }

  if (complexFilters.length > 0) {
    args.push("-filter_complex", complexFilters.join(";"), "-map", videoOutput);
    if (audioInputs.length > 0) args.push("-map", "[aout]");
    else args.push("-map", "0:a:0?");
  } else {
    args.push("-map", "0:v:0", "-map", "0:a:0?");
  }
  args.push("-t", exportDuration.toString(), "-c:v", "libx264", "-preset", preset, "-crf", crf, "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", audioBitrate, saveResult.filePath);

  await runProcess(ffmpegPath, args, (chunk) => {
    const match = chunk.match(/time=(\d+):(\d+):(\d+\.\d+)/);
    if (!match || !exportDuration) return;
    const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
    mainWindow?.webContents.send("export:progress", Math.min(99, Math.round((seconds / exportDuration) * 20 + 80)));
  });

  mainWindow?.webContents.send("export:progress", 100);
  return { ok: true, outputPath: saveResult.filePath, message: "Export complete." };
}

ipcMain.handle("export:render", async (_event, project: Project, options: ExportOptions): Promise<ExportResult> => {
  try {
    return await renderExport(project, options);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? `Export failed: ${conciseError(error)}` : "Export failed." };
  }
});
