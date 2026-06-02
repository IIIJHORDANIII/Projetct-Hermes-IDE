const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hermesIDE', {
  // File system
  fs: {
    readDir: (dirPath) => ipcRenderer.invoke('fs:readDir', dirPath),
    readFile: (filePath) => ipcRenderer.invoke('fs:readFile', filePath),
    writeFile: (filePath, content) => ipcRenderer.invoke('fs:writeFile', filePath, content),
    stat: (filePath) => ipcRenderer.invoke('fs:stat', filePath),
    getHomeDir: () => ipcRenderer.invoke('fs:getHomeDir'),
    watch: (dirPath) => ipcRenderer.invoke('fs:watch', dirPath),
    unwatch: () => ipcRenderer.invoke('fs:unwatch'),
    onFileChanged: (callback) => ipcRenderer.on('fs:fileChanged', (event, data) => callback(data)),
  },

  // Dialogs
  dialog: {
    openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  },

  // Search
  search: {
    files: (dirPath, query) => ipcRenderer.invoke('search:files', dirPath, query),
  },

  // Hermes AI (persistent bridge)
  hermes: {
    chat: (message) => ipcRenderer.invoke('hermes:chat', message),
    chatStream: (message) => ipcRenderer.invoke('hermes:chatStream', message),
    onChatChunk: (callback) => ipcRenderer.on('hermes:chatStream:chunk', (event, text) => callback(text)),
    removeChatChunkListener: () => ipcRenderer.removeAllListeners('hermes:chatStream:chunk'),
    health: () => ipcRenderer.invoke('hermes:health'),
    history: () => ipcRenderer.invoke('hermes:history'),
    reset: () => ipcRenderer.invoke('hermes:reset'),
  },

  // Terminal PTY
  terminal: {
    create: (options) => ipcRenderer.invoke('terminal:create', options),
    write: (id, data) => ipcRenderer.invoke('terminal:write', id, data),
    resize: (id, cols, rows) => ipcRenderer.invoke('terminal:resize', id, cols, rows),
    kill: (id) => ipcRenderer.invoke('terminal:kill', id),
    onData: (callback) => ipcRenderer.on('terminal:data', (event, payload) => callback(payload)),
    onExit: (callback) => ipcRenderer.on('terminal:exit', (event, payload) => callback(payload)),
  },

  // Folder open event
  onOpenFolder: (callback) => ipcRenderer.on('open-folder', (event, path) => callback(path)),

  // Window controls
  window: {
    close: () => ipcRenderer.invoke('window:close'),
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    getSystemTheme: () => ipcRenderer.invoke('system:theme'),
  },

  // Git
  git: {
    status: (cwd) => ipcRenderer.invoke('git:status', cwd),
    diff: (cwd, filePath, staged) => ipcRenderer.invoke('git:diff', cwd, filePath, staged),
    diffAll: (cwd, staged) => ipcRenderer.invoke('git:diffAll', cwd, staged),
    stage: (cwd, filePath) => ipcRenderer.invoke('git:stage', cwd, filePath),
    unstage: (cwd, filePath) => ipcRenderer.invoke('git:unstage', cwd, filePath),
    stageAll: (cwd) => ipcRenderer.invoke('git:stageAll', cwd),
    unstageAll: (cwd) => ipcRenderer.invoke('git:unstageAll', cwd),
    commit: (cwd, message) => ipcRenderer.invoke('git:commit', cwd, message),
    log: (cwd, count) => ipcRenderer.invoke('git:log', cwd, count),
    branches: (cwd) => ipcRenderer.invoke('git:branches', cwd),
    checkout: (cwd, branch) => ipcRenderer.invoke('git:checkout', cwd, branch),
    push: (cwd) => ipcRenderer.invoke('git:push', cwd),
    pull: (cwd) => ipcRenderer.invoke('git:pull', cwd),
  }
});
