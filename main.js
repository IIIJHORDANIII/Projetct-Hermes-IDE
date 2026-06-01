const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, dialog, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, exec: execCb } = require('child_process');
const pty = require('node-pty');
const { promisify } = require('util');
const exec = promisify(execCb);

// Prevent EPIPE crashes when running without a terminal
process.stdout.on('error', () => {});
process.stderr.on('error', () => {});

let tray = null;
let mainWindow = null;
let isVisible = false;

// ─── Window dimensions ───
const WINDOW_WIDTH = 1200;
const WINDOW_HEIGHT = 750;

function createWindow() {
  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    x: Math.round((screenW - WINDOW_WIDTH) / 2),
    y: Math.round((screenH - WINDOW_HEIGHT) / 2),
    show: false,
    titleBarStyle: 'hiddenInset',
    vibrancy: 'hud',
    visualEffectState: 'active',
    transparent: true,
    backgroundColor: '#00000000',
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile('index.html');

  // Capture renderer console output
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    const prefix = ['', 'WARN', 'ERROR', 'INFO'][level] || 'LOG';
    console.log(`[Renderer ${prefix}] ${message} (${sourceId}:${line})`);
  });

  // Open DevTools in development
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'bottom' });
  }

  mainWindow.on('blur', () => {
    // Don't hide on blur — user might click outside intentionally
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function toggleWindow() {
  if (!mainWindow) {
    createWindow();
    mainWindow.once('ready-to-show', () => {
      mainWindow.show();
      isVisible = true;
    });
    return;
  }

  if (isVisible) {
    mainWindow.hide();
    isVisible = false;
  } else {
    mainWindow.show();
    mainWindow.focus();
    isVisible = true;
  }
}

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'tray-icon.png');
  const { nativeImage } = require('electron');

  let icon;
  if (fs.existsSync(iconPath)) {
    icon = nativeImage.createFromPath(iconPath);
    icon.setTemplateImage(true); // macOS adapts to dark/light menu bar
  } else {
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon);
  tray.setToolTip('Hermes IDE — ⇧Space');

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show Hermes IDE', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); isVisible = true; } else { toggleWindow(); } } },
    { type: 'separator' },
    { label: 'Open Folder...', click: () => openFolderDialog() },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.quit(); } }
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('click', () => toggleWindow());
}

async function openFolderDialog() {
  if (!mainWindow) return;
  // Ensure window is focused before showing dialog
  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }
  mainWindow.focus();
  
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Abrir Pasta'
  });
  if (!result.canceled && result.filePaths.length > 0) {
    mainWindow.webContents.send('open-folder', result.filePaths[0]);
  }
}

// ─── IPC Handlers ───

// File system operations
ipcMain.handle('fs:readDir', async (event, dirPath) => {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    return entries
      .filter(e => e.name !== '.git' && e.name !== 'node_modules')
      .map(e => ({
        name: e.name,
        path: path.join(dirPath, e.name),
        isDirectory: e.isDirectory(),
        isFile: e.isFile()
      }))
      .sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      });
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('fs:readFile', async (event, filePath) => {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('fs:writeFile', async (event, filePath, content) => {
  try {
    fs.writeFileSync(filePath, content, 'utf-8');
    return { success: true };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('fs:stat', async (event, filePath) => {
  try {
    const stat = fs.statSync(filePath);
    return {
      size: stat.size,
      modified: stat.mtime.toISOString(),
      isDirectory: stat.isDirectory(),
      isFile: stat.isFile()
    };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('fs:getHomeDir', () => os.homedir());

// ─── File Watcher ───
let currentWatcher = null;

ipcMain.handle('fs:watch', async (event, dirPath) => {
  // Stop previous watcher
  if (currentWatcher) {
    currentWatcher.close();
    currentWatcher = null;
  }
  try {
    currentWatcher = fs.watch(dirPath, { recursive: true }, (eventType, filename) => {
      if (!filename || !mainWindow) return;
      // Ignore noisy directories and temp files
      const parts = filename.split('/');
      if (parts.some(p => p === '.git' || p === 'node_modules' || p === '.next' || p === 'dist' || p === '.cache' || p === '__pycache__')) return;
      if (filename.endsWith('.tmp') || filename.endsWith('.swp') || filename.startsWith('.')) return;
      mainWindow.webContents.send('fs:fileChanged', { eventType, filename });
    });
    return { success: true };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('fs:unwatch', async () => {
  if (currentWatcher) {
    currentWatcher.close();
    currentWatcher = null;
  }
  return { success: true };
});

ipcMain.handle('dialog:openFolder', async () => {
  try {
    await openFolderDialog();
    return { success: true };
  } catch (err) {
    return { error: err.message };
  }
});

// ─── File Search ───
const IGNORE_DIRS = new Set([
  'node_modules', '.git', '__pycache__', '.next', '.nuxt', 'dist', 'build',
  '.cache', '.vscode', '.idea', 'venv', '.venv', 'env', '.tox',
  'coverage', '.pytest_cache', '.mypy_cache', 'target',
]);

const BINARY_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'svg', 'webp',
  'mp3', 'mp4', 'wav', 'avi', 'mov', 'mkv', 'flv',
  'zip', 'tar', 'gz', 'rar', '7z', 'bz2',
  'exe', 'dll', 'so', 'dylib', 'o', 'a',
  'pdf', 'doc', 'docx', 'xls', 'xlsx',
  'woff', 'woff2', 'ttf', 'eot',
]);

function searchInDir(dirPath, query, maxResults = 200) {
  const results = [];
  const lowerQuery = query.toLowerCase();
  const isRegex = query.startsWith('/') && query.endsWith('/');
  let regex = null;

  if (isRegex) {
    try {
      regex = new RegExp(query.slice(1, -1), 'gi');
    } catch (e) {
      // Invalid regex, fall back to literal search
    }
  }

  function walk(dir) {
    if (results.length >= maxResults) return;

    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (results.length >= maxResults) return;

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          walk(fullPath);
        }
        continue;
      }

      if (!entry.isFile()) continue;

      const ext = entry.name.split('.').pop().toLowerCase();
      if (BINARY_EXTS.has(ext)) continue;

      // Skip large files (> 1MB)
      try {
        const stat = fs.statSync(fullPath);
        if (stat.size > 1024 * 1024) continue;
      } catch { continue; }

      // Read and search
      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const lines = content.split('\n');

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          let match = false;

          if (regex) {
            regex.lastIndex = 0;
            match = regex.test(line);
          } else {
            match = line.toLowerCase().includes(lowerQuery);
          }

          if (match) {
            results.push({
              file: fullPath,
              name: entry.name,
              line: i + 1,
              text: line.trim().substring(0, 200),
              relativePath: fullPath.replace(dirPath, '').replace(/^\//, ''),
            });
            break; // One result per file (show more on expand)
          }
        }
      } catch {
        // Skip files that can't be read
      }
    }
  }

  walk(dirPath);
  return results;
}

ipcMain.handle('search:files', async (event, dirPath, query) => {
  if (!dirPath || !query || query.length < 2) return [];
  try {
    return searchInDir(dirPath, query);
  } catch (err) {
    return [{ error: err.message }];
  }
});

// ─── Git Integration ───

async function gitExec(args, cwd) {
  try {
    const { stdout, stderr } = await exec(`git ${args}`, { cwd, maxBuffer: 5 * 1024 * 1024 });
    return { stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (err) {
    return { error: err.message, stdout: err.stdout?.trim() || '', stderr: err.stderr?.trim() || '' };
  }
}

ipcMain.handle('git:status', async (event, cwd) => {
  const r = await gitExec('status --porcelain=v1 -b', cwd);
  if (r.error && !r.stdout) return { error: r.error };
  const lines = r.stdout.split('\n').filter(Boolean);
  const branchLine = lines[0] || '';
  const branchMatch = branchLine.match(/## (.+?)(?:\.\.\.)?/);
  const branch = branchMatch ? branchMatch[1] : 'unknown';
  const tracking = branchLine.includes('...') ? branchLine.split('...')[1]?.split(' ')[0] : null;
  const files = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const indexStatus = line[0];
    const workTreeStatus = line[1];
    const filePath = line.substring(3).trim();
    // Handle renamed files (old -> new)
    const arrowIdx = filePath.indexOf(' -> ');
    const displayPath = arrowIdx >= 0 ? filePath.substring(arrowIdx + 4) : filePath;
    files.push({
      path: displayPath,
      rawPath: filePath,
      indexStatus,
      workTreeStatus,
      status: indexStatus + workTreeStatus,
    });
  }
  return { branch, tracking, files };
});

ipcMain.handle('git:diff', async (event, cwd, filePath, staged) => {
  const args = staged ? `diff --cached -- "${filePath}"` : `diff -- "${filePath}"`;
  const r = await gitExec(args, cwd);
  if (r.error && !r.stdout) return { error: r.error };
  return { diff: r.stdout };
});

ipcMain.handle('git:diffAll', async (event, cwd, staged) => {
  const args = staged ? 'diff --cached' : 'diff';
  const r = await gitExec(args, cwd);
  if (r.error && !r.stdout) return { error: r.error };
  return { diff: r.stdout };
});

ipcMain.handle('git:stage', async (event, cwd, filePath) => {
  const r = await gitExec(`add -- "${filePath}"`, cwd);
  return r.error ? { error: r.error } : { success: true };
});

ipcMain.handle('git:unstage', async (event, cwd, filePath) => {
  const r = await gitExec(`reset HEAD -- "${filePath}"`, cwd);
  return r.error ? { error: r.error } : { success: true };
});

ipcMain.handle('git:stageAll', async (event, cwd) => {
  const r = await gitExec('add -A', cwd);
  return r.error ? { error: r.error } : { success: true };
});

ipcMain.handle('git:unstageAll', async (event, cwd) => {
  const r = await gitExec('reset HEAD', cwd);
  return r.error ? { error: r.error } : { success: true };
});

ipcMain.handle('git:commit', async (event, cwd, message) => {
  if (!message || !message.trim()) return { error: 'Mensagem de commit vazia' };
  const r = await gitExec(`commit -m ${JSON.stringify(message.trim())}`, cwd);
  if (r.error) return { error: r.stderr || r.error };
  return { success: true, output: r.stdout };
});

ipcMain.handle('git:log', async (event, cwd, count) => {
  const n = count || 30;
  const r = await gitExec(`log --oneline -n ${n} --format="%h|%s|%an|%ar"`, cwd);
  if (r.error) return { error: r.error };
  const entries = r.stdout.split('\n').filter(Boolean).map(line => {
    const [hash, message, author, date] = line.split('|');
    return { hash, message, author, date };
  });
  return { entries };
});

ipcMain.handle('git:branches', async (event, cwd) => {
  const r = await gitExec('branch -a', cwd);
  if (r.error) return { error: r.error };
  const lines = r.stdout.split('\n').map(line => line.trim()).filter(Boolean);
  
  // Parse all branches
  const local = [];
  const remote = [];
  for (const line of lines) {
    const current = line.startsWith('* ');
    const name = line.replace(/^\*?\s+/, '').trim();
    if (name.startsWith('remotes/')) {
      remote.push({ name, current });
    } else {
      local.push({ name, current });
    }
  }
  
  // Filter remote branches: only keep ones that DON'T have a local counterpart
  const localNames = new Set(local.map(b => b.name));
  const filteredRemote = remote.filter(b => {
    const short = b.name.replace(/^remotes\/[^/]+\//, '');
    return !localNames.has(short) && !short.startsWith('HEAD');
  });
  
  return { branches: [...local, ...filteredRemote] };
});

ipcMain.handle('git:checkout', async (event, cwd, branch) => {
  // Normalize remote branch: "remotes/origin/main" -> "origin/main"
  const normalized = branch.replace(/^remotes\//, '');
  const r = await gitExec(`checkout ${JSON.stringify(normalized)}`, cwd);
  if (r.error) return { error: r.stderr || r.error };
  return { success: true };
});

// ─── Hermes Bridge (persistent AI agent) ───
let bridgeProcess = null;
const BRIDGE_PORT = 48123;
const BRIDGE_URL = `http://127.0.0.1:${BRIDGE_PORT}`;

function startBridge() {
  const bridgeScript = path.join(__dirname, 'hermes-bridge.py');
  // Use Hermes venv Python (has all dependencies)
  const hermesVenvPython = path.join(os.homedir(), '.hermes', 'hermes-agent', 'venv', 'bin', 'python');
  const python = fs.existsSync(hermesVenvPython) ? hermesVenvPython : (process.env.HERMES_PYTHON || 'python3');

  bridgeProcess = spawn(python, [bridgeScript, String(BRIDGE_PORT)], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PYTHONPATH: process.env.PYTHONPATH || '',
      TERM: 'dumb',
    }
  });

  bridgeProcess.stdout.on('data', (data) => {
    const msg = data.toString().trim();
    if (msg) console.log('[Bridge]', msg);
  });

  bridgeProcess.stderr.on('data', (data) => {
    const msg = data.toString().trim();
    if (msg) console.error('[Bridge Error]', msg);
  });

  bridgeProcess.on('close', (code) => {
    console.log(`[Bridge] Process exited with code ${code}`);
    bridgeProcess = null;
  });

  bridgeProcess.on('error', (err) => {
    console.error('[Bridge] Failed to start:', err.message);
  });
}

function stopBridge() {
  if (bridgeProcess) {
    bridgeProcess.kill('SIGTERM');
    bridgeProcess = null;
  }
}

async function bridgeRequest(endpoint, method = 'GET', body = null) {
  const url = `${BRIDGE_URL}${endpoint}`;
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) options.body = JSON.stringify(body);

  const response = await fetch(url, options);
  return response.json();
}

ipcMain.handle('hermes:chat', async (event, message) => {
  try {
    const result = await bridgeRequest('/chat', 'POST', { message });
    if (result.error) {
      return `Erro: ${result.error}`;
    }
    return result.response || 'Sem resposta';
  } catch (err) {
    return `Erro ao conectar com Hermes: ${err.message}\nO bridge está rodando?`;
  }
});

ipcMain.handle('hermes:chatStream', async (event, message) => {
  const http = require('http');
  const body = JSON.stringify({ message });

  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: BRIDGE_PORT,
      path: '/chat/stream',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let buffer = '';
      res.on('data', (chunk) => {
        buffer += chunk.toString();
        // Process complete lines
        let newlineIdx;
        while ((newlineIdx = buffer.indexOf('\n')) >= 0) {
          const line = buffer.substring(0, newlineIdx).trim();
          buffer = buffer.substring(newlineIdx + 1);
          if (!line) continue;
          try {
            const obj = JSON.parse(line);
            if (obj.type === 'delta' && mainWindow) {
              mainWindow.webContents.send('hermes:chatStream:chunk', obj.text);
            } else if (obj.type === 'done') {
              resolve(obj.response || '');
            } else if (obj.type === 'error') {
              resolve(`Erro: ${obj.error}`);
            }
          } catch {}
        }
      });
      res.on('end', () => {
        resolve(buffer || '');
      });
    });
    req.on('error', (err) => {
      resolve(`Erro ao conectar com Hermes: ${err.message}`);
    });
    req.write(body);
    req.end();
  });
});

ipcMain.handle('hermes:health', async () => {
  try {
    return await bridgeRequest('/health');
  } catch {
    return { status: 'offline' };
  }
});

ipcMain.handle('hermes:history', async () => {
  try {
    return await bridgeRequest('/history');
  } catch {
    return { messages: [] };
  }
});

ipcMain.handle('hermes:reset', async () => {
  try {
    return await bridgeRequest('/reset', 'POST');
  } catch {
    return { error: 'offline' };
  }
});

ipcMain.handle('window:close', () => {
  if (mainWindow) mainWindow.hide();
  isVisible = false;
});

ipcMain.handle('window:minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.handle('window:maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

// ─── Terminal PTY ───
const ptyTerminals = new Map();
let nextTerminalId = 1;

ipcMain.handle('terminal:create', async (event, options = {}) => {
  const shell = process.env.SHELL || '/bin/zsh';
  const cwd = options.cwd || os.homedir();
  const id = nextTerminalId++;

  // Verify shell exists
  const fs = require('fs');
  if (!fs.existsSync(shell)) {
    return { success: false, error: `Shell not found: ${shell}` };
  }

  // Ensure PATH includes common dirs (Electron may not inherit full PATH)
  const env = { ...process.env, TERM: 'xterm-256color' };
  const pathDirs = ['/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin', `${os.homedir()}/.local/bin`];
  const currentPath = env.PATH || '';
  for (const dir of pathDirs) {
    if (!currentPath.includes(dir) && fs.existsSync(dir)) {
      env.PATH = `${dir}:${env.PATH}`;
    }
  }

  try {
    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: options.cols || 80,
      rows: options.rows || 24,
      cwd: fs.existsSync(cwd) ? cwd : os.homedir(),
      env
    });

    ptyProcess.onData((data) => {
      if (mainWindow) {
        mainWindow.webContents.send('terminal:data', { id, data });
      }
    });

    ptyProcess.onExit(({ exitCode }) => {
      if (mainWindow) {
        mainWindow.webContents.send('terminal:exit', { id, exitCode });
      }
      ptyTerminals.delete(id);
    });

    ptyTerminals.set(id, ptyProcess);
    return { success: true, id, pid: ptyProcess.pid };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('terminal:write', async (event, id, data) => {
  const p = ptyTerminals.get(id);
  if (p) p.write(data);
});

ipcMain.handle('terminal:resize', async (event, id, cols, rows) => {
  const p = ptyTerminals.get(id);
  if (p) p.resize(cols, rows);
});

ipcMain.handle('terminal:kill', async (event, id) => {
  const p = ptyTerminals.get(id);
  if (p) { p.kill(); ptyTerminals.delete(id); }
});

// ─── App lifecycle ───

app.whenReady().then(() => {
  // Hide dock icon — menu bar only app
  if (app.dock) app.dock.hide();

  // Start the Hermes bridge (persistent AI agent)
  startBridge();

  createTray();
  createWindow();

  // Register global shortcut Shift+Space
  const registered = globalShortcut.register('Shift+Space', () => {
    toggleWindow();
  });

  if (!registered) {
    console.log('Failed to register Shift+Space shortcut');
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  stopBridge();
});

app.on('window-all-closed', () => {
  // Don't quit — keep running in tray
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
