<p align="center">
  <img src="assets/tray-icon@2x.png" width="80" alt="Hermes IDE">
</p>

<p align="center">
  <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#ff3b30" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>
</p>

<h1 align="center">Hermes IDE</h1>

<img width="1285" height="814" alt="Captura de Tela 2026-06-01 às 17 45 00" src="https://github.com/user-attachments/assets/b9b51523-6510-4aba-8499-599f9b2dde20" />


<p align="center">
  <strong>macOS menu bar IDE powered by Hermes Agent</strong><br>
  <em>Editor + Terminal + AI Chat — one shortcut away</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-macOS%20Tahoe-blue?style=flat-square&logo=apple" alt="macOS">
  <img src="https://img.shields.io/badge/electron-33-47848f?style=flat-square&logo=electron" alt="Electron">
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="MIT License">
</p>

---

## Overview

Hermes IDE is a lightweight, native macOS IDE that lives in your menu bar. Press **⇧Space** and you have a full code editor, integrated terminal, and AI assistant powered by [Hermes Agent](https://github.com/nousresearch/hermes-agent) — all with macOS Tahoe vibrancy/blur and always-on-top.

## Features

### Editor
- **Monaco Editor** — full VS Code editor engine with syntax highlighting, Emmet, snippets
- **Multi-tab** — drag & drop tabs, auto-save, breadcrumbs
- **File Explorer** — tree view with folders, resizable sidebar
- **Search** — full-text file search with regex support
- **Command Palette** — `⌘⇧P` for quick actions
- **Settings** — `⌘,` for preferences (theme, font size, etc.)
- **Themes** — dark (default) and light, both with vibrancy blur

### Terminal
- **Integrated PTY** — `⌘J` to toggle, powered by `node-pty` + xterm.js
- **Multiple terminals** — create and switch between instances
- **Full shell** — zsh/bash with color support, PATH inheritance

### Git
- **Source Control panel** — stage/unstage files, commit, push/pull
- **Branch management** — switch branches, view remote branches
- **Diff viewer** — inline diff display for changed files

### AI Chat
- **Hermes Agent** — persistent AI assistant with full tool access
- **Streaming** — real-time token-by-token response
- **Slash commands** — `/model`, `/provider`, `/help` and more
- **Code highlighting** — syntax-highlighted code blocks in chat

### macOS Native
- **Menu bar app** — no dock icon, lives in the system tray
- **Vibrancy** — `blur(30px) saturate(200%)` on all panels
- **Always on top** — stays above other windows
- **Global shortcut** — `⇧Space` to show/hide from anywhere

## Requirements

- **macOS** 14+ (Tahoe recommended)
- **Node.js** 18+
- **Hermes Agent** installed at `~/.hermes/hermes-agent/`
- **Python 3** with hermes-agent venv

## Installation

```bash
# Clone the repo
git clone https://github.com/pastorello/hermes-ide.git
cd hermes-ide

# Install dependencies
npm install

# Rebuild node-pty for Electron ARM64 (required on Apple Silicon)
npx node-gyp rebuild --target=33.4.11 --arch=arm64 --dist-url=https://electronjs.org/headers

# Start the app
npm start
```

## Development

```bash
# Run with DevTools open
npm run dev
```

## Project Structure

```
hermes-ide/
├── main.js              # Electron main process — window, tray, IPC, git, terminal
├── preload.js           # Context bridge — exposes APIs to renderer
├── index.html           # Full UI — Monaco, terminal, chat, sidebar (single file)
├── hermes-bridge.py     # Python HTTP bridge to Hermes Agent
├── assets/
│   ├── tray-icon.png    # Menu bar icon (1x)
│   └── tray-icon@2x.png # Menu bar icon (2x)
├── package.json
└── README.md
```

## Architecture

```
┌─────────────────────────────────────────────────┐
│                   Electron                       │
│  ┌──────────┐  ┌──────────┐  ┌───────────────┐ │
│  │ main.js  │  │ preload  │  │  index.html   │ │
│  │ (Node)   │◄─┤ (bridge) │◄─┤  (Renderer)   │ │
│  └────┬─────┘  └──────────┘  └───────────────┘ │
│       │                                          │
│  ┌────┴─────┐  ┌──────────────┐                 │
│  │ node-pty │  │ hermes-bridge│                 │
│  │ (term)   │  │   (Python)   │                 │
│  └──────────┘  └──────┬───────┘                 │
│                       │                          │
│              ┌────────▼────────┐                 │
│              │  Hermes Agent   │                 │
│              │  (AIAgent)      │                 │
│              └─────────────────┘                 │
└─────────────────────────────────────────────────┘
```

## Key Bindings

| Shortcut | Action |
|----------|--------|
| `⇧Space` | Show/hide IDE (global) |
| `⌘J` | Toggle terminal |
| `⌘,` | Open settings |
| `⌘⇧P` | Command palette |
| `⌘S` | Save file |
| `⌘B` | Toggle sidebar |
| `⌘W` | Close tab |

## Tech Stack

| Component | Technology |
|-----------|------------|
| Framework | Electron 33 |
| Editor | Monaco Editor |
| Terminal | xterm.js + node-pty |
| Icons | Lucide SVG |
| AI | Hermes Agent (Python bridge) |
| Styling | CSS with macOS vibrancy |

## License

MIT © pastorello
