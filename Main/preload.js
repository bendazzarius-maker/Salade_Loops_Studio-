const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("audioNative", {
  send: (op, data) => ipcRenderer.invoke("audio:native:send", { op, data }),
  sendEnvelope: (envelope) => ipcRenderer.invoke("audio:native:send", { envelope }),
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
