const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("audioNative", {
  send: (op, data) => ipcRenderer.invoke("audio:native:send", { op, data }),
  onEvent: (cb) => {
    const handler = (_e, msg) => cb(msg);
    ipcRenderer.on("audio:native:event", handler);
    return () => ipcRenderer.removeListener("audio:native:event", handler);
  }
});

contextBridge.exposeInMainWorld("samplerFS", {
  pickDirectories: () => ipcRenderer.invoke("sampler:pickDirectories"),
  scanDirectories: (directories) => ipcRenderer.invoke("sampler:scanDirectories", { directories }),
});
