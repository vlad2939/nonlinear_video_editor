import { contextBridge, ipcRenderer } from "electron";
import type { AudioFitRequest, ExportOptions, Project, MediaAsset, NativeApi } from "../src/shared/types.js";

const api: NativeApi = {
  media: {
    import: () => ipcRenderer.invoke("media:import"),
    thumbnail: (asset: MediaAsset) => ipcRenderer.invoke("media:thumbnail", asset)
  },
  audioFit: {
    render: (request: AudioFitRequest) => ipcRenderer.invoke("audio-fit:render", request)
  },
  project: {
    create: () => ipcRenderer.invoke("project:create"),
    save: (project: Project) => ipcRenderer.invoke("project:save", project),
    open: () => ipcRenderer.invoke("project:open"),
    validate: (project: Project) => ipcRenderer.invoke("project:validate", project)
  },
  recovery: {
    load: () => ipcRenderer.invoke("recovery:load"),
    save: (project: Project) => ipcRenderer.invoke("recovery:save", project),
    clear: () => ipcRenderer.invoke("recovery:clear")
  },
  export: {
    selectLogo: () => ipcRenderer.invoke("export:select-logo"),
    render: (project: Project, options: ExportOptions) => ipcRenderer.invoke("export:render", project, options),
    onProgress: (callback: (progress: number) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: number) => callback(progress);
      ipcRenderer.on("export:progress", listener);
      return () => ipcRenderer.removeListener("export:progress", listener);
    }
  }
};

contextBridge.exposeInMainWorld("nativeApi", api);
