const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("nativeApi", {
  media: {
    import: () => ipcRenderer.invoke("media:import"),
    thumbnail: (asset) => ipcRenderer.invoke("media:thumbnail", asset)
  },
  audioFit: {
    render: (request) => ipcRenderer.invoke("audio-fit:render", request)
  },
  project: {
    create: () => ipcRenderer.invoke("project:create"),
    save: (project) => ipcRenderer.invoke("project:save", project),
    open: () => ipcRenderer.invoke("project:open"),
    validate: (project) => ipcRenderer.invoke("project:validate", project)
  },
  recovery: {
    load: () => ipcRenderer.invoke("recovery:load"),
    save: (project) => ipcRenderer.invoke("recovery:save", project),
    clear: () => ipcRenderer.invoke("recovery:clear")
  },
  export: {
    selectLogo: () => ipcRenderer.invoke("export:select-logo"),
    render: (project, options) => ipcRenderer.invoke("export:render", project, options),
    onProgress: (callback) => {
      const listener = (_event, progress) => callback(progress);
      ipcRenderer.on("export:progress", listener);
      return () => ipcRenderer.removeListener("export:progress", listener);
    }
  }
});
