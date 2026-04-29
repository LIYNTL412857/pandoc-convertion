const { contextBridge, ipcRenderer } = require('electron');

// 暴露安全的 API 给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  // 文件选择
  selectFiles: () => ipcRenderer.invoke('select-files'),
  // 输出目录选择
  selectOutputDir: () => ipcRenderer.invoke('select-output-dir'),
  // 开始转换
  startConversion: (args) => ipcRenderer.invoke('start-conversion', args),
  // 停止转换
  stopConversion: () => ipcRenderer.invoke('stop-conversion'),
  // 停止当前任务
  stopCurrentTask: () => ipcRenderer.invoke('stop-current-task'),
  // 打开文件夹
  openFolder: (folderPath) => ipcRenderer.invoke('open-folder', folderPath),
  // 进度更新监听
  onProgressUpdate: (callback) => ipcRenderer.on('progress-update', (_, progress) => callback(progress)),
  // 日志更新监听
  onLogUpdate: (callback) => ipcRenderer.on('log-update', (_, log) => callback(log)),
  // 转换完成监听
  onConversionFinished: (callback) => ipcRenderer.on('conversion-finished', (_, data) => callback(data)),
  // 移除监听
  removeAllListeners: () => {
    ipcRenderer.removeAllListeners('progress-update');
    ipcRenderer.removeAllListeners('log-update');
    ipcRenderer.removeAllListeners('conversion-finished');
  }
});
