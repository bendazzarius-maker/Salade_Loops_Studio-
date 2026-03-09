const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("audioNative", {
  request: (message) => ipcRenderer.invoke("audio:native:req", message),
  isAvailable: () => ipcRenderer.invoke("audio:native:isAvailable"),
  onEvent: (cb) => {
    const handler = (_e, msg) => cb(msg);
    ipcRenderer.on("audio:native:event", handler);
    return () => ipcRenderer.removeListener("audio:native:event", handler);
  }
});

contextBridge.exposeInMainWorld("samplerFS", {
  pickDirectories: () => ipcRenderer.invoke("sampler:pickDirectories"),
  scanDirectories: (directories) => ipcRenderer.invoke("sampler:scanDirectories", { directories }),
  listPrograms: () => ipcRenderer.invoke("sampler:listPrograms"),
  getProgramsRoot: () => ipcRenderer.invoke("sampler:getProgramsRoot"),
  setProgramsRoot: (rootPath) => ipcRenderer.invoke("sampler:setProgramsRoot", { rootPath }),
  createCategory: (relativeDir) => ipcRenderer.invoke("sampler:createCategory", { relativeDir }),
  saveProgram: (payload) => ipcRenderer.invoke("sampler:saveProgram", payload),
});

contextBridge.exposeInMainWorld("samplePattern", {
  saveProgram: (payload) => ipcRenderer.invoke("samplePattern:saveProgram", payload),
  listPrograms: () => ipcRenderer.invoke("samplePattern:listPrograms"),
  loadProgram: (programPath) => ipcRenderer.invoke("samplePattern:loadProgram", { programPath }),
});

contextBridge.exposeInMainWorld("electronAPI", {
  drumKitEmit: (type, payload) => ipcRenderer.invoke("drumkit:emit", { type, payload }),
  drumKitLoadKit: (kitId) => ipcRenderer.invoke("drumkit:loadKit", { kitId }),
  drumWindowOpen: (payload) => ipcRenderer.invoke("drum-window:open", payload || {}),
  drumWindowClose: () => ipcRenderer.invoke("drum-window:close"),
  drumWindowHostMessage: (payload) => ipcRenderer.invoke("drum-window:host-message", payload || {}),
  drumWindowUiMessage: (payload) => ipcRenderer.invoke("drum-window:ui-message", payload || {}),
  onDrumWindowUiMessage: (cb) => {
    const handler = (_e, msg) => cb(msg);
    ipcRenderer.on("drum-window:ui-message", handler);
    return () => ipcRenderer.removeListener("drum-window:ui-message", handler);
  },
  onDrumWindowHostMessage: (cb) => {
    const handler = (_e, msg) => cb(msg);
    ipcRenderer.on("drum-window:host-message", handler);
    return () => ipcRenderer.removeListener("drum-window:host-message", handler);
  },
  onDrumWindowClosed: (cb) => {
    const handler = () => cb();
    ipcRenderer.on("drum-window:closed", handler);
    return () => ipcRenderer.removeListener("drum-window:closed", handler);
  },
});
