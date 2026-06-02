// ═══════════════════════════════════════
    //  STATE
    // ═══════════════════════════════════════
    let currentFolder = null;
    let openFiles = new Map();
    let activeFile = null;
    let autoSaveTimeout = null;
    let monacoEditor = null;
    let monacoLoaded = false;
    let termInstance = null;
    let terminalCreated = false;
    const terminals = new Map(); // id -> { xterm, containerEl }
    let activeTerminalId = null;

    // ═══════════════════════════════════════
    //  MONACO EDITOR (safe init)
    // ═══════════════════════════════════════
    function initMonaco() {
      if (typeof require === 'undefined' || !require.config) {
        console.warn('[Hermes IDE] Monaco loader not available yet, retrying...');
        setTimeout(initMonaco, 500);
        return;
      }

      require.config({ paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs' } });

      require(['vs/editor/editor.main'], function () {
        monacoLoaded = true;

        monaco.editor.defineTheme('hermes-dark', {
          base: 'vs-dark', inherit: true,
          rules: [
            { token: 'comment', foreground: '6a6a6a', fontStyle: 'italic' },
            { token: 'keyword', foreground: 'ff3b30' },
            { token: 'string', foreground: '30d158' },
            { token: 'number', foreground: 'ffd60a' },
            { token: 'type', foreground: '0a84ff' },
          ],
          colors: {
            'editor.background': '#121216cc',
            'editor.foreground': '#e5e5e7',
            'editor.lineHighlightBackground': '#222226b0',
            'editor.selectionBackground': '#ff3b3040',
            'editorCursor.foreground': '#ff3b30',
            'editorLineNumber.foreground': '#48484a',
            'editorLineNumber.activeForeground': '#98989d',
            'editorIndentGuide.background': '#2c2c2e',
            'editorIndentGuide.activeBackground': '#3a3a3c',
            'scrollbarSlider.background': '#48484a80',
          }
        });

        monaco.editor.defineTheme('hermes-light', {
          base: 'vs', inherit: true,
          rules: [
            { token: 'comment', foreground: '86868b', fontStyle: 'italic' },
            { token: 'keyword', foreground: 'd63029' },
            { token: 'string', foreground: '28a745' },
            { token: 'number', foreground: '9a6700' },
            { token: 'type', foreground: '007aff' },
          ],
          colors: {
            'editor.background': '#f5f5f7cc',
            'editor.foreground': '#1d1d1f',
            'editor.lineHighlightBackground': '#f5f5f7b0',
            'editor.selectionBackground': '#ff3b3020',
            'editorCursor.foreground': '#ff3b30',
            'editorLineNumber.foreground': '#c7c7cc',
            'editorLineNumber.activeForeground': '#86868b',
            'editorIndentGuide.background': '#e5e5ea',
            'editorIndentGuide.activeBackground': '#d1d1d6',
            'scrollbarSlider.background': '#c7c7cc80',
          }
        });

        monacoEditor = monaco.editor.create(document.getElementById('editor'), {
          value: '', language: 'javascript', theme: settings.theme === 'light' ? 'hermes-light' : 'hermes-dark',
          fontSize: 14, fontFamily: "'SF Mono', 'Fira Code', monospace",
          fontLigatures: true, minimap: { enabled: false },
          padding: { top: 12 }, lineNumbers: 'on',
          bracketPairColorization: { enabled: true },
          smoothScrolling: true, cursorBlinking: 'smooth',
          cursorSmoothCaretAnimation: 'on', automaticLayout: true,
          tabSize: 2, formatOnPaste: true,
          // Multi-cursor
          multiCursorModifier: 'alt',
          multiCursorMergeOverlapping: true,
          // Go to Definition
          definitionLinkOpensInPeek: false,
          gotoLocation: { multiple: 'goto' },
          // Folding
          folding: true, foldingStrategy: 'indentation',
          // Selection highlight
          selectionHighlight: true, occurrencesHighlight: 'singleFile',
          // Linked editing (HTML tags)
          linkedEditing: true,
          // Smooth caret
          cursorSurroundingLines: 3,
        });

        monacoEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveCurrentFile());
        monacoEditor.addCommand(monaco.KeyCode.Tab, () => {
          if (!trySnippetExpand(monacoEditor) && !tryEmmetExpand(monacoEditor)) {
            monacoEditor.trigger('keyboard', 'editor.action.indentLines');
          }
        });

        // Force Monaco transparency for vibrancy
        requestAnimationFrame(() => {
          const ed = document.getElementById('editor');
          ed.querySelectorAll('.monaco-editor, .monaco-editor-background, .monaco-editor .margin, .overflow-guard, .editor-scrollable').forEach(el => {
            el.style.background = 'transparent';
            el.style.backgroundColor = 'transparent';
          });
        });

        monacoEditor.onDidChangeCursorPosition((e) => {
          document.getElementById('status-cursor').textContent = `Ln ${e.position.lineNumber}, Col ${e.position.column}`;
        });

        monacoEditor.onDidChangeModelContent(() => {
          if (activeFile) {
            const tab = document.querySelector(`.tab[data-path="${activeFile}"]`);
            if (tab && !tab.querySelector('.tab-modified')) {
              const dot = document.createElement('span');
              dot.className = 'tab-modified';
              tab.appendChild(dot);
            }
          }
          // Auto-save after 1s of inactivity
          if (settings.autoSave && activeFile) {
            clearTimeout(autoSaveTimeout);
            autoSaveTimeout = setTimeout(() => saveCurrentFile(), 1000);
          }
        });
      }); // close require callback
    } // end initMonaco

    // Start Monaco init
    initMonaco();

    // ═══════════════════════════════════════
    //  FILE TREE
    // ═══════════════════════════════════════
    async function openFolder() {
      try {
        const result = await hermesIDE.dialog.openFolder();
      } catch (err) {
        console.error('[Hermes IDE] openFolder error:', err);
      }
    }

    hermesIDE.onOpenFolder(async (folderPath) => {
      currentFolder = folderPath;
      await renderTree(folderPath, document.getElementById('file-tree'), 0);
      // Switch to explorer when opening a folder
      switchSidebar('explorer');
      // Auto-refresh git data in background
      refreshGit();
      // Start file watcher
      hermesIDE.fs.watch(folderPath);
      // New chat session for new folder
      await hermesIDE.hermes.reset();
      const chatMessages = document.getElementById('chat-messages');
      chatMessages.innerHTML = '';
      addChatMessage('assistant', `Pasta aberta: **${folderPath.split('/').pop()}** 📂\n\nMe pergunte qualquer coisa sobre este projeto!`);
    });

    // File watcher: only refresh git, NOT the tree (preserves folder state)
    let fileWatcherTimeout = null;
    hermesIDE.fs.onFileChanged((data) => {
      if (!currentFolder) return;
      clearTimeout(fileWatcherTimeout);
      fileWatcherTimeout = setTimeout(async () => {
        refreshGit();
      }, 2000);
    });

    async function renderTree(dirPath, container, depth) {
      const entries = await hermesIDE.fs.readDir(dirPath);
      if (entries.error) { container.innerHTML = `<div style="padding:8px;color:var(--accent)">${entries.error}</div>`; return; }
      container.innerHTML = '';

      for (const entry of entries) {
        const item = document.createElement('div');
        item.className = `tree-item ${entry.isDirectory ? 'folder' : 'file'}`;
        item.style.paddingLeft = `${8 + depth * 12}px`;

        const fileIcon = getFileIcon(entry);

        if (entry.isDirectory) {
          item.innerHTML = `<span class="arrow">▶</span>${fileIcon}<span>${entry.name}</span>`;
          item.addEventListener('click', async () => {
            const arrow = item.querySelector('.arrow');
            if (arrow.classList.contains('open')) {
              arrow.classList.remove('open');
              const children = item.nextElementSibling;
              if (children?.classList.contains('tree-children')) children.remove();
            } else {
              arrow.classList.add('open');
              const children = document.createElement('div');
              children.className = 'tree-children';
              item.after(children);
              await renderTree(entry.path, children, depth + 1);
            }
          });
        } else {
          item.innerHTML = `<span class="arrow" style="visibility:hidden">▶</span>${fileIcon}<span>${entry.name}</span>`;
          item.addEventListener('click', () => openFile(entry.path, entry.name));
        }
        container.appendChild(item);
      }
    }

    // Lucide icon helper
    function icon(name, color, size) {
      try {
        if (typeof lucide === 'undefined' || !lucide.icons) return '';
        const pascal = name.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
        const data = lucide.icons[pascal];
        if (!data) return '';
        const s = size || 16;
        const c = color || 'currentColor';
        let inner = '';
        for (const el of data) {
          const tag = el[0];
          const attrs = el[1];
          let attrStr = '';
          for (const [k, v] of Object.entries(attrs)) {
            attrStr += ` ${k}="${v}"`;
          }
          inner += `<${tag}${attrStr}/>`;
        }
        return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
      } catch(e) { return ''; }
    }

    // Fallback emoji icons if Lucide fails
    function fileEmoji(entry) {
      if (entry.isDirectory) return '📁';
      const ext = entry.name.split('.').pop().toLowerCase();
      const m = {js:'📜',ts:'📘',jsx:'⚛️',tsx:'⚛️',py:'🐍',json:'📋',html:'🌐',css:'🎨',md:'📝',sh:'⚡'};
      return m[ext] || '📄';
    }

    function getFileIcon(entry) {
      const svg = icon(entry.isDirectory ? 'folder' : fileIconName(entry), entry.isDirectory ? '#dcb67a' : fileIconColor(entry));
      if (svg) return `<span class="mi-icon${entry.isDirectory ? ' mi-folder' : ''}">${svg}</span>`;
      return `<span style="margin-right:6px;font-size:14px">${fileEmoji(entry)}</span>`;
    }

    function fileIconName(entry) {
      const name = entry.name.toLowerCase();
      const ext = name.split('.').pop();
      const special = {'package.json':'package','package-lock.json':'lock','tsconfig.json':'settings','dockerfile':'container','docker-compose.yml':'container','.gitignore':'git-branch','.env':'key-round','readme.md':'book-open','readme':'book-open','license':'scale','makefile':'hammer','vite.config.js':'zap','vite.config.ts':'zap','eslint.config.js':'shield-check','tailwind.config.js':'palette','index.html':'code-xml'};
      if (special[name]) return special[name];
      const exts = {js:'braces',mjs:'braces',cjs:'braces',jsx:'atom',tsx:'atom',ts:'braces',mts:'braces',py:'code',rb:'diamond',rs:'code',go:'code',java:'code',c:'code',cpp:'code',h:'code',swift:'code',kt:'code',php:'code',sql:'database',json:'braces',yaml:'settings',yml:'settings',toml:'settings',xml:'code-xml',md:'file-text',txt:'file-text',log:'scroll-text',csv:'table',html:'code-xml',htm:'code-xml',css:'palette',scss:'palette',sass:'palette',less:'palette',sh:'terminal',bash:'terminal',zsh:'terminal',png:'image',jpg:'image',jpeg:'image',gif:'image',svg:'image',webp:'image',mp3:'music',wav:'music',mp4:'film',avi:'film',mov:'film',pdf:'file-text',doc:'file-text',docx:'file-text',xls:'table',xlsx:'table',zip:'archive',tar:'archive',gz:'archive',rar:'archive',lock:'lock',map:'map-pin'};
      return exts[ext] || 'file';
    }

    function fileIconColor(entry) {
      if (entry.isDirectory) return '#dcb67a';
      const name = entry.name.toLowerCase();
      const ext = name.split('.').pop();
      const special = {'package.json':'#6d9b3b','package-lock.json':'#888','tsconfig.json':'#3178c6','dockerfile':'#2496ed','.gitignore':'#f05033','.env':'#ecd53f','readme.md':'#519aba','license':'#d4d4d4','makefile':'#e06c75','vite.config.js':'#646cff','vite.config.ts':'#646cff','eslint.config.js':'#4b32c3','tailwind.config.js':'#06b6d4','index.html':'#e44d26'};
      if (special[name]) return special[name];
      const exts = {js:'#f1e05a',mjs:'#f1e05a',cjs:'#f1e05a',jsx:'#61dafb',tsx:'#3178c6',ts:'#3178c6',mts:'#3178c6',py:'#3572a5',rb:'#cc342d',rs:'#dea584',go:'#00add8',java:'#b07219',c:'#555555',cpp:'#f34b7d',h:'#555555',swift:'#f05138',kt:'#a97bff',php:'#4f5d95',sql:'#e38c00',json:'#f1e05a',yaml:'#cb171e',yml:'#cb171e',toml:'#9c4221',xml:'#0060ac',md:'#519aba',txt:'#d4d4d4',log:'#888',csv:'#2b7a3e',html:'#e44d26',htm:'#e44d26',css:'#563d7c',scss:'#c6538c',sass:'#c6538c',less:'#1d365d',sh:'#89e051',bash:'#89e051',zsh:'#89e051',png:'#a074c4',jpg:'#a074c4',jpeg:'#a074c4',gif:'#a074c4',svg:'#f1e05a',webp:'#a074c4',mp3:'#1db954',wav:'#1db954',mp4:'#a074c4',avi:'#a074c4',mov:'#a074c4',pdf:'#e01525',doc:'#2b579a',docx:'#2b579a',xls:'#217346',xlsx:'#217346',zip:'#f9ad00',tar:'#f9ad00',gz:'#f9ad00',rar:'#f9ad00',lock:'#888',map:'#888'};
      return exts[ext] || '#d4d4d4';
    }

    // ═══════════════════════════════════════
    //  FILE EDITOR
    // ═══════════════════════════════════════
    async function openFile(filePath, fileName) {
      if (openFiles.has(filePath)) { switchToFile(filePath); return; }
      const content = await hermesIDE.fs.readFile(filePath);
      if (content.error) return;
      const lang = getLanguage(fileName);
      if (monacoLoaded && monacoEditor) {
        const model = monaco.editor.createModel(content, lang);
        openFiles.set(filePath, { content, model, viewState: null, name: fileName });
        switchToFile(filePath);
        addTab(filePath, fileName);
      }
      document.getElementById('status-lang').textContent = lang;
    }

    function switchToFile(filePath) {
      if (activeFile && openFiles.has(activeFile)) openFiles.get(activeFile).viewState = monacoEditor.saveViewState();
      const file = openFiles.get(filePath); if (!file) return;
      monacoEditor.setModel(file.model);
      if (file.viewState) monacoEditor.restoreViewState(file.viewState);
      activeFile = filePath;
      document.getElementById('welcome')?.classList.add('hidden');
      document.getElementById('editor-container')?.classList.remove('hidden');
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      const tab = document.querySelector(`.tab[data-path="${filePath}"]`);
      if (tab) tab.classList.add('active');
      document.getElementById('status-lang').textContent = getLanguage(file.name);
      updateBreadcrumbs(filePath);
    }

    function addTab(filePath, fileName) {
      const tabs = document.getElementById('tabs');
      const tab = document.createElement('div');
      tab.className = 'tab active'; tab.dataset.path = filePath;
      tab.draggable = true;
      tab.innerHTML = `<span>${fileName}</span><span class="tab-close" onclick="event.stopPropagation();closeTab('${filePath}')">✕</span>`;
      tab.addEventListener('click', () => switchToFile(filePath));

      // Drag & Drop handlers
      tab.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', filePath);
        e.dataTransfer.effectAllowed = 'move';
        tab.classList.add('dragging');
      });
      tab.addEventListener('dragend', () => {
        tab.classList.remove('dragging');
        document.querySelectorAll('.tab.drag-over').forEach(t => t.classList.remove('drag-over'));
      });
      tab.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const dragging = document.querySelector('.tab.dragging');
        if (dragging && dragging !== tab) {
          tab.classList.add('drag-over');
        }
      });
      tab.addEventListener('dragleave', () => {
        tab.classList.remove('drag-over');
      });
      tab.addEventListener('drop', (e) => {
        e.preventDefault();
        tab.classList.remove('drag-over');
        const fromPath = e.dataTransfer.getData('text/plain');
        const fromTab = document.querySelector(`.tab[data-path="${fromPath}"]`);
        if (fromTab && fromTab !== tab) {
          // Determine drop position (before or after)
          const rect = tab.getBoundingClientRect();
          const midX = rect.left + rect.width / 2;
          if (e.clientX < midX) {
            tabs.insertBefore(fromTab, tab);
          } else {
            tabs.insertBefore(fromTab, tab.nextSibling);
          }
        }
      });

      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tabs.appendChild(tab);
    }

    function closeTab(filePath) {
      const tab = document.querySelector(`.tab[data-path="${filePath}"]`);
      if (tab) tab.remove();
      openFiles.delete(filePath);
      if (activeFile === filePath) {
        const remaining = document.querySelectorAll('.tab');
        if (remaining.length > 0) {
          switchToFile(remaining[remaining.length - 1].dataset.path);
        } else {
          activeFile = null;
          document.getElementById('welcome').classList.remove('hidden');
          document.getElementById('editor-container').classList.add('hidden');
          document.getElementById('status-lang').textContent = '-';
        }
      }
    }

    async function saveCurrentFile() {
      if (!activeFile || !monacoEditor) return;
      const content = monacoEditor.getValue();
      const result = await hermesIDE.fs.writeFile(activeFile, content);
      if (result.success) {
        const tab = document.querySelector(`.tab[data-path="${activeFile}"]`);
        if (tab) { const dot = tab.querySelector('.tab-modified'); if (dot) dot.remove(); }
        if (openFiles.has(activeFile)) openFiles.get(activeFile).content = content;
        showToast('Arquivo salvo!', 'success', 2000);
      }
    }

    function getLanguage(fileName) {
      const ext = fileName.split('.').pop().toLowerCase();
      const langs = { js:'javascript', jsx:'javascript', ts:'typescript', tsx:'typescript', py:'python', rb:'ruby', rs:'rust', go:'go', json:'json', yaml:'yaml', yml:'yaml', toml:'toml', md:'markdown', txt:'plaintext', html:'html', htm:'html', css:'css', scss:'scss', sh:'shell', c:'c', cpp:'cpp', java:'java', swift:'swift', sql:'sql', xml:'xml', svg:'xml' };
      return langs[ext] || 'plaintext';
    }

    function updateBreadcrumbs(filePath) {
      const bc = document.getElementById('breadcrumbs');
      if (!filePath || !currentFolder) { bc.classList.add('hidden'); return; }
      const relative = filePath.replace(currentFolder, '').replace(/^\//, '');
      const parts = relative.split('/');
      // Hide if only 1 segment (same as tab name)
      if (parts.length <= 1) { bc.classList.add('hidden'); return; }
      let html = '';
      parts.forEach((part, i) => {
        const isLast = i === parts.length - 1;
        if (i > 0) html += '<span class="breadcrumb-sep">›</span>';
        html += `<span class="breadcrumb-item" style="${isLast ? 'color:var(--text-bright)' : ''}">${escapeHtml(part)}</span>`;
      });
      bc.innerHTML = html;
      bc.classList.remove('hidden');
    }

    // ═══════════════════════════════════════
    //  EMMET (built-in, lightweight)
    // ═══════════════════════════════════════

    // Built-in snippets (language -> prefix -> body)
    const builtinSnippets = {
      javascript: {
        'clg': 'console.log($1);',
        'fn': 'function $1($2) {\n\t$3\n}',
        'afn': '($1) => {\n\t$2\n}',
        'ife': 'if ($1) {\n\t$2\n} else {\n\t$3\n}',
        'for': 'for (let $1 = 0; $1 < $2; $1++) {\n\t$3\n}',
        'fore': 'for (const $1 of $2) {\n\t$3\n}',
        'imp': "import $1 from '$2';",
        'exp': 'export default $1;',
        'tc': 'try {\n\t$1\n} catch ($2) {\n\t$3\n}',
        'rp': 'return $1;',
        'pr': 'return new Promise((resolve, reject) => {\n\t$1\n});',
        'ed': 'export default function $1($2) {\n\t$3\n}',
      },
      typescript: {
        'clg': 'console.log($1);',
        'fn': 'function $1($2): $3 {\n\t$4\n}',
        'afn': '($1): $2 => {\n\t$3\n}',
        'ife': 'if ($1) {\n\t$2\n} else {\n\t$3\n}',
        'imp': "import $1 from '$2';",
        'exp': 'export default $1;',
        'int': 'interface $1 {\n\t$2\n}',
        'type': 'type $1 = $2;',
        'tc': 'try {\n\t$1\n} catch ($2) {\n\t$3\n}',
      },
      python: {
        'def': 'def $1($2):\n\t$3',
        'cls': 'class $1:\n\tdef __init__(self$2):\n\t\t$3',
        'ife': 'if $1:\n\t$2\nelse:\n\t$3',
        'for': 'for $1 in $2:\n\t$3',
        'tc': 'try:\n\t$1\nexcept $2:\n\t$3',
        'pr': 'print($1)',
        'imp': 'import $1',
        'with': 'with $1 as $2:\n\t$3',
        'lam': 'lambda $1: $2',
      },
      html: {
        '!': '<!DOCTYPE html>\n<html lang="en">\n<head>\n\t<meta charset="UTF-8">\n\t<title>$1</title>\n</head>\n<body>\n\t$2\n</body>\n</html>',
      },
      css: {
        'flex': 'display: flex;\njustify-content: $1;\nalign-items: $2;',
        'grid': 'display: grid;\ngrid-template-columns: $1;',
        'pos': 'position: $1;\ntop: $2;\nleft: $3;',
        'tr': 'transition: $1 0.3s ease;',
      },
    };

    function trySnippetExpand(editor) {
      const model = editor.getModel();
      const lang = model.getLanguageId();
      const snippets = builtinSnippets[lang] || builtinSnippets.javascript;
      if (!snippets) return false;

      const pos = editor.getPosition();
      const line = model.getLineContent(pos.lineNumber);
      const before = line.substring(0, pos.column - 1);

      // Find word before cursor
      const wordMatch = before.match(/(\w+)$/);
      if (!wordMatch) return false;

      const prefix = wordMatch[1];
      const body = snippets[prefix];
      if (!body) return false;

      const startCol = pos.column - prefix.length;
      const range = new monaco.Range(pos.lineNumber, startCol, pos.lineNumber, pos.column);

      // Use Monaco's snippet API
      editor.executeEdits('snippet', [{ range, text: '' }]);
      editor.trigger('keyboard', 'editor.action.insertSnippet', { snippet: body });
      return true;
    }
    // ═══════════════════════════════════════
    function expandEmmet(abbr) {
      // Parse: tag#id.class*count>tag2.class2
      const selfClose = new Set(['img','br','hr','input','meta','link','area','base','col','embed','param','source','track','wbr']);
      let counter = 0;

      function parseNode(str) {
        str = str.trim();
        const multiply = str.match(/\*(\d+)$/);
        let count = 1;
        if (multiply) { count = parseInt(multiply[1]); str = str.slice(0, -multiply[0].length); }

        const tagMatch = str.match(/^([a-zA-Z][a-zA-Z0-9]*)?/);
        let tag = tagMatch[1] || 'div';
        let rest = str.slice(tag.length);

        let id = '';
        const idMatch = rest.match(/^#([a-zA-Z0-9_-]+)/);
        if (idMatch) { id = idMatch[1]; rest = rest.slice(idMatch[0].length); }

        let classes = [];
        while (rest.match(/^\.([a-zA-Z0-9_-]+)/)) {
          const cls = rest.match(/^\.([a-zA-Z0-9_-]+)/);
          classes.push(cls[1]);
          rest = rest.slice(cls[0].length);
        }

        let attrs = '';
        if (id) attrs += ` id="${id}"`;
        if (classes.length) attrs += ` class="${classes.join(' ')}"`;

        let children = '';
        if (rest.startsWith('>')) {
          children = parseNode(rest.slice(1));
        } else if (rest.startsWith('+')) {
          children = parseNode(rest.slice(1));
        }

        const isSelf = selfClose.has(tag);
        const node = `<${tag}${attrs}>${isSelf ? '' : children + `</${tag}>`}`;
        return count > 1 ? node.repeat(count) : node;
      }

      // Handle chained: div>p+span
      const parts = abbr.split('+');
      let result = '';
      for (const part of parts) {
        result += parseNode(part);
      }
      return result;
    }

    function tryEmmetExpand(editor) {
      const model = editor.getModel();
      const lang = model.getLanguageId();
      if (lang !== 'html' && lang !== 'css' && lang !== 'xml') return false;

      const pos = editor.getPosition();
      const line = model.getLineContent(pos.lineNumber);
      const before = line.substring(0, pos.column - 1);

      // Find abbreviation (word chars, dots, hashes, >, *, +)
      const match = before.match(/([a-zA-Z][a-zA-Z0-9]*(?:[#.][a-zA-Z0-9_-]+)*(?:>[a-zA-Z][a-zA-Z0-9]*(?:[#.][a-zA-Z0-9_-]+)*)*(?:\*\d+)?)(?:\+([a-zA-Z][a-zA-Z0-9]*(?:[#.][a-zA-Z0-9_-]+)*(?:>[a-zA-Z][a-zA-Z0-9]*(?:[#.][a-zA-Z0-9_-]+)*)*(?:\*\d+)?))*$/);
      if (!match) return false;

      const abbr = match[0];
      if (abbr.length < 2) return false;

      try {
        const expanded = expandEmmet(abbr);
        if (!expanded || expanded === abbr) return false;

        const startCol = pos.column - abbr.length;
        const range = new monaco.Range(pos.lineNumber, startCol, pos.lineNumber, pos.column);
        editor.executeEdits('emmet', [{ range, text: expanded }]);
        return true;
      } catch { return false; }
    }

    // ═══════════════════════════════════════
    //  TERMINAL (xterm.js + node-pty) — Multi-terminal
    // ═══════════════════════════════════════
    function getTermTheme() {
      // Detect actual resolved theme from body class (handles 'system' setting)
      const isLight = document.body.classList.contains('theme-light');
      if (isLight) {
        return {
          background: '#f5f5f7',
          foreground: '#1d1d1f', cursor: '#ff3b30',
          cursorAccent: '#ffffff', selectionBackground: '#ff3b3020',
          black: '#1d1d1f', red: '#ff3b30', green: '#28a745', yellow: '#9a6700',
          blue: '#007aff', magenta: '#af52de', cyan: '#64d2ff', white: '#f5f5f7',
          brightBlack: '#86868b', brightRed: '#e0342b', brightGreen: '#34c759',
          brightYellow: '#ffc107', brightBlue: '#0a84ff', brightMagenta: '#bf5af2',
          brightCyan: '#5ac8fa', brightWhite: '#000000',
        };
      }
      return {
        background: '#1a1a1e',
        foreground: '#e5e5e7', cursor: '#ff3b30',
        cursorAccent: '#1a1a1e', selectionBackground: '#ff3b3040',
        black: '#1a1a1e', red: '#ff3b30', green: '#30d158', yellow: '#ffd60a',
        blue: '#0a84ff', magenta: '#bf5af2', cyan: '#64d2ff', white: '#e5e5e7',
        brightBlack: '#48484a', brightRed: '#ff453a', brightGreen: '#30d158',
        brightYellow: '#ffd60a', brightBlue: '#0a84ff', brightMagenta: '#bf5af2',
        brightCyan: '#64d2ff', brightWhite: '#f5f5f7',
      };
    }

    function applyTerminalTheme() {
      const newTermTheme = getTermTheme();
      for (const [, t] of terminals) {
        t.xterm.options.theme = newTermTheme;
      }
    }

    function toggleTerminal() {
      const panel = document.getElementById('terminal-panel');
      const isCollapsed = panel.classList.contains('collapsed');
      if (isCollapsed) {
        panel.classList.remove('collapsed');
        if (terminals.size === 0) {
          createTerminal();
        } else if (activeTerminalId) {
          const t = terminals.get(activeTerminalId);
          if (t) t.xterm.focus();
        }
      } else {
        panel.classList.add('collapsed');
      }
    }

    async function createTerminal() {
      const panel = document.getElementById('terminal-panel');
      if (panel.classList.contains('collapsed')) panel.classList.remove('collapsed');

      const container = document.getElementById('terminal-container');

      // Create xterm
      const xterm = new Terminal({
        theme: getTermTheme(),
        fontFamily: "'SF Mono', 'Fira Code', 'JetBrains Mono', monospace",
        fontSize: settings.terminalFontSize || 13,
        lineHeight: 1.3, cursorBlink: true, cursorStyle: 'bar',
        scrollback: 5000, allowTransparency: false,
      });

      // FitAddon for proper line wrapping
      const fitAddon = new FitAddon.FitAddon();
      xterm.loadAddon(fitAddon);

      // Create container div for this terminal
      const termDiv = document.createElement('div');
      termDiv.style.cssText = 'width:100%;height:100%;display:none;';
      container.appendChild(termDiv);
      xterm.open(termDiv);

      // Fit terminal to container
      requestAnimationFrame(() => {
        try { fitAddon.fit(); } catch(e) {}
      });

      // Calculate size
      const cols = xterm.cols || 80;
      const rows = xterm.rows || 20;

      // Create PTY
      const result = await hermesIDE.terminal.create({
        cols, rows,
        cwd: currentFolder || undefined
      });
      if (!result.success) return;

      const id = result.id;
      terminals.set(id, { xterm, containerEl: termDiv, fitAddon });

      // PTY -> Terminal
      hermesIDE.terminal.onData(({ id: msgId, data }) => {
        const t = terminals.get(msgId);
        if (t) t.xterm.write(data);
      });

      // Terminal -> PTY
      xterm.onData((data) => hermesIDE.terminal.write(id, data));

      // Intercept Cmd+J so xterm doesn't swallow the terminal toggle
      xterm.attachCustomKeyEventHandler((e) => {
        if (e.metaKey && e.key === 'j' && e.type === 'keydown') {
          e.stopPropagation();
          toggleTerminal();
          return false;
        }
        return true;
      });

      // Resize on container size change
      const resizeObserver = new ResizeObserver(() => {
        try {
          if (termDiv.style.display !== 'none') {
            fitAddon.fit();
          }
        } catch(e) {}
      });
      resizeObserver.observe(container);

      // Resize
      xterm.onResize(({ cols, rows }) => hermesIDE.terminal.resize(id, cols, rows));

      // Exit
      hermesIDE.terminal.onExit(({ id: msgId, exitCode }) => {
        const t = terminals.get(msgId);
        if (t) t.xterm.write(`\r\n\x1b[90m[Terminal ${msgId} exited: ${exitCode}]\x1b[0m\r\n`);
      });

      // Switch to this terminal
      switchTerminal(id);
      renderTerminalTabs();
      terminalCreated = true;
      xterm.focus();
    }

    function switchTerminal(id) {
      // Hide all, show target
      for (const [tid, t] of terminals) {
        t.containerEl.style.display = tid === id ? 'block' : 'none';
      }
      activeTerminalId = id;
      const t = terminals.get(id);
      if (t) {
        requestAnimationFrame(() => {
          try { t.fitAddon.fit(); } catch(e) {}
        });
        t.xterm.focus();
      }
      renderTerminalTabs();
    }

    function closeTerminal(id) {
      const t = terminals.get(id);
      if (!t) return;
      t.xterm.dispose();
      t.containerEl.remove();
      hermesIDE.terminal.kill(id);
      terminals.delete(id);

      if (terminals.size === 0) {
        terminalCreated = false;
        activeTerminalId = null;
        document.getElementById('terminal-panel').classList.add('collapsed');
      } else if (activeTerminalId === id) {
        const first = terminals.keys().next().value;
        switchTerminal(first);
      }
      renderTerminalTabs();
    }

    let termCounter = 0;
    function renderTerminalTabs() {
      const tabsEl = document.getElementById('terminal-tabs');
      let html = '';
      for (const [id] of terminals) {
        termCounter = Math.max(termCounter, id);
        const label = `Terminal ${id}`;
        html += `<div class="terminal-tab ${id === activeTerminalId ? 'active' : ''}" onclick="switchTerminal(${id})">
          <span>${label}</span>
          <span class="tt-close" onclick="event.stopPropagation();closeTerminal(${id})">✕</span>
        </div>`;
      }
      tabsEl.innerHTML = html;
    }

    // Terminal resize handle
    (function() {
      const handle = document.getElementById('terminal-resize-handle');
      const panel = document.getElementById('terminal-panel');
      let startY, startHeight;

      handle.addEventListener('mousedown', (e) => {
        startY = e.clientY;
        startHeight = panel.offsetHeight;

        const onMouseMove = (e) => {
          const diff = startY - e.clientY;
          const newHeight = Math.max(100, Math.min(startHeight + diff, window.innerHeight * 0.7));
          panel.style.height = newHeight + 'px';

          if (activeTerminalId) {
            const t = terminals.get(activeTerminalId);
            if (t) {
              const cellWidth = t.xterm._core._renderService?.dimensions?.css?.cell?.width || 9;
              const cellHeight = t.xterm._core._renderService?.dimensions?.css?.cell?.height || 17;
              const container = document.getElementById('terminal-container');
              const cols = Math.floor(container.clientWidth / cellWidth);
              const rows = Math.floor((newHeight - 36) / cellHeight);
              t.xterm.resize(cols, rows);
            }
          }
        };

        const onMouseUp = () => {
          document.removeEventListener('mousemove', onMouseMove);
          document.removeEventListener('mouseup', onMouseUp);
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
      });
    })();

    // Sidebar resize handle
    (function() {
      const handle = document.getElementById('sidebar-resize');
      const sidebar = document.getElementById('sidebar');
      let startX, startWidth;

      handle.addEventListener('mousedown', (e) => {
        startX = e.clientX;
        startWidth = sidebar.offsetWidth;
        handle.classList.add('dragging');
        e.preventDefault();

        const onMouseMove = (e) => {
          const diff = e.clientX - startX;
          const newWidth = Math.max(140, Math.min(500, startWidth + diff));
          sidebar.style.width = newWidth + 'px';
        };

        const onMouseUp = () => {
          handle.classList.remove('dragging');
          document.removeEventListener('mousemove', onMouseMove);
          document.removeEventListener('mouseup', onMouseUp);
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
      });
    })();

    // ═══════════════════════════════════════
    //  SLASH COMMANDS — moved to bottom script

    // ═══════════════════════════════════════
    //  CHAT (Improved)
    // ═══════════════════════════════════════
    let isChatting = false;
    const hermesFaces = ['🤖','🧠','⚡','🔥','✨','💡','🎯','🦾','🪄','😎','🤓','👾','🦋','🌟','🔮'];
    function hermesFace() {
      return hermesFaces[Math.floor(Math.random() * hermesFaces.length)];
    }

    async function sendChat() {
      const input = document.getElementById('chat-input');
      const message = input.value.trim();
      if (!message || isChatting) return;

      input.value = '';
      input.style.height = 'auto';
      isChatting = true;

      // Add user message
      addChatMessage('user', message);

      // Show thinking
      const thinkingId = 'thinking-' + Date.now();
      addThinking(thinkingId);

      const sendBtn = document.getElementById('chat-send');
      sendBtn.disabled = true;

      try {
        // Build lightweight context (skip for slash commands)
        const isCommand = message.startsWith('/');
        let ctx = '';
        if (!isCommand) {
          if (activeFile && monacoEditor) {
            const name = openFiles.get(activeFile)?.name || 'unknown';
            const lineCount = monacoEditor.getModel()?.getLineCount() || 0;
            ctx = `[User is editing: ${name} (${lineCount} lines) — ${activeFile}]\n\n`;
          }
          if (currentFolder) {
            ctx += `[Working directory: ${currentFolder}]\n\n`;
          }
        }

        // Streaming state
        let streamedText = '';
        let streamBubble = null;
        let thinkingRemoved = false;

        // Listen for chunks
        hermesIDE.hermes.onChatChunk((text) => {
          // On first chunk: remove thinking, create streaming bubble
          if (!thinkingRemoved) {
            thinkingRemoved = true;
            removeThinking(thinkingId);
            streamBubble = addStreamingMessage();
          }
          streamedText += text;
          updateStreamingMessage(streamBubble, streamedText);
        });

        // Start streaming
        const response = await hermesIDE.hermes.chatStream(ctx + message);

        // Clean up listener
        hermesIDE.hermes.removeChatChunkListener();

        // Finalize: replace with properly rendered markdown
        if (!thinkingRemoved) {
          removeThinking(thinkingId);
          streamBubble = addStreamingMessage();
        }
        finalizeStreamingMessage(streamBubble, response || streamedText);
      } catch (err) {
        removeThinking(thinkingId);
        hermesIDE.hermes.removeChatChunkListener();
        addChatMessage('assistant', `❌ Erro: ${err}`);
      } finally {
        isChatting = false;
        sendBtn.disabled = false;
      }
    }

    function addChatMessage(role, content) {
      const container = document.getElementById('chat-messages');
      const msg = document.createElement('div');
      msg.className = `chat-msg ${role}`;

      const avatar = document.createElement('div');
      avatar.className = 'avatar';
      if (role === 'user') {
        avatar.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
      } else {
        avatar.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>';
      }

      const bubble = document.createElement('div');
      bubble.className = 'bubble';
      bubble.innerHTML = renderMarkdown(content);

      // Apply syntax highlighting to code blocks
      bubble.querySelectorAll('pre code').forEach((block) => {
        // Detect language from class
        const langClass = [...block.classList].find(c => c.startsWith('language-'));
        if (langClass) {
          block.className = langClass; // keep for highlight.js
        }
        try { hljs.highlightElement(block); } catch(e) {}
      });

      // Add copy buttons to code blocks
      bubble.querySelectorAll('pre').forEach((pre) => {
        const code = pre.querySelector('code');
        if (!code) return;

        const langMatch = code.className.match(/language-(\w+)/);
        const lang = langMatch ? langMatch[1] : 'code';

        const header = document.createElement('div');
        header.className = 'code-header';
        header.innerHTML = `
          <span>${lang}</span>
          <button class="copy-btn" onclick="copyCode(this)">Copiar</button>
        `;
        pre.insertBefore(header, code);
      });

      msg.appendChild(avatar);
      msg.appendChild(bubble);
      container.appendChild(msg);
      container.scrollTop = container.scrollHeight;
    }

    function addStreamingMessage() {
      const container = document.getElementById('chat-messages');
      const msg = document.createElement('div');
      msg.className = 'chat-msg assistant streaming';

      const avatar = document.createElement('div');
      avatar.className = 'avatar';
      avatar.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>';

      const bubble = document.createElement('div');
      bubble.className = 'bubble';
      bubble.innerHTML = '<span class="streaming-cursor">▊</span>';

      msg.appendChild(avatar);
      msg.appendChild(bubble);
      container.appendChild(msg);
      container.scrollTop = container.scrollHeight;
      return bubble;
    }

    function updateStreamingMessage(bubble, text) {
      // Escape HTML for safe display during streaming
      const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      bubble.innerHTML = escaped + '<span class="streaming-cursor">▊</span>';
      // Auto-scroll
      const container = document.getElementById('chat-messages');
      container.scrollTop = container.scrollHeight;
    }

    function finalizeStreamingMessage(bubble, text) {
      bubble.parentElement.classList.remove('streaming');

      // Extract thinking/reasoning blocks
      let mainText = text;
      let thinkingText = '';
      const thinkMatch = text.match(/<(?:think|thinking|reasoning)>([\s\S]*?)<\/(?:think|thinking|reasoning)>/i);
      if (thinkMatch) {
        thinkingText = thinkMatch[1].trim();
        mainText = text.replace(thinkMatch[0], '').trim();
      }

      bubble.innerHTML = renderMarkdown(mainText || text);

      // Add thinking block if present
      if (thinkingText) {
        const block = document.createElement('div');
        block.className = 'thinking-block';
        block.innerHTML = `
          <div class="thinking-block-header" onclick="this.querySelector('.arrow').classList.toggle('open');this.nextElementSibling.classList.toggle('open')">
            <span class="arrow">▶</span>
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/></svg>
            <span>Reasoning</span>
          </div>
          <div class="thinking-block-content">${escapeHtml(thinkingText)}</div>
        `;
        bubble.appendChild(block);
      }

      // Apply syntax highlighting
      bubble.querySelectorAll('pre code').forEach((block) => {
        const langClass = [...block.classList].find(c => c.startsWith('language-'));
        if (langClass) block.className = langClass;
        try { hljs.highlightElement(block); } catch(e) {}
      });

      // Add copy buttons
      bubble.querySelectorAll('pre').forEach((pre) => {
        const code = pre.querySelector('code');
        if (!code) return;
        const langMatch = code.className.match(/language-(\w+)/);
        const lang = langMatch ? langMatch[1] : 'code';
        const header = document.createElement('div');
        header.className = 'code-header';
        header.innerHTML = `<span>${lang}</span><button class="copy-btn" onclick="copyCode(this)">Copiar</button>`;
        pre.insertBefore(header, code);
      });

      const container = document.getElementById('chat-messages');
      container.scrollTop = container.scrollHeight;
    }

    function copyCode(btn) {
      const pre = btn.closest('pre');
      const code = pre.querySelector('code');
      const text = code.textContent;
      navigator.clipboard.writeText(text);
      btn.textContent = '✓ Copiado!';
      setTimeout(() => btn.textContent = 'Copiar', 2000);
    }

    const thinkingKaomoji = [
      '(⊙_⊙) contemplating...',
      '(◕‿◕) thinking...',
      '(⌐■_■) processing...',
      '(╯°□°)╯ working on it...',
      '(づ｡◕‿‿◕｡)づ analyzing...',
      '(¬‿¬) cooking something...',
      '(•_•) let me check...',
      '(ಥ_ಥ) just a moment...',
      '(ᵔᴥᵔ) crunching data...',
      '(ノಠ益ಠ)ノ彡 pondering...',
      '♪(´ε`) hmm...',
      '( ˘▽˘)っ♨ brewing...',
      '(ﾉ◕ヮ◕)ﾉ*:・ﾟ✧ almost there...',
    ];
    function randomKaomoji() {
      return thinkingKaomoji[Math.floor(Math.random() * thinkingKaomoji.length)];
    }

    function addThinking(id) {
      const container = document.getElementById('chat-messages');
      const thinking = document.createElement('div');
      thinking.className = 'thinking';
      thinking.id = id;
      const kaomoji = randomKaomoji();
      thinking.innerHTML = `
        <div class="avatar" style="background:linear-gradient(135deg,#ff3b30,#ff6b6b);box-shadow:0 1px 4px rgba(255,59,48,0.25)"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg></div>
        <div class="thinking-dots"><span></span><span></span><span></span></div>
        <span style="font-size:12px;color:var(--text-dim)">${kaomoji}</span>
      `;
      container.appendChild(thinking);
      container.scrollTop = container.scrollHeight;
    }

    function removeThinking(id) {
      const el = document.getElementById(id);
      if (el) el.remove();
    }

    function renderMarkdown(text) {
      let html = text
        // Code blocks with language
        .replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang, code) => {
          const l = lang || 'plaintext';
          return `<pre><code class="language-${l}">${escapeHtml(code.trim())}</code></pre>`;
        })
        // Code blocks without language
        .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
        // Inline code
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        // Bold
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        // Italic
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        // Links
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>')
        // Blockquotes
        .replace(/^>\s(.+)$/gm, '<blockquote>$1</blockquote>')
        // Unordered lists
        .replace(/^[-*]\s(.+)$/gm, '<li>$1</li>')
        // Paragraphs
        .replace(/\n\n/g, '</p><p>')
        .replace(/\n/g, '<br>');

      return `<p>${html}</p>`;
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    // ═══════════════════════════════════════
    //  KEYBOARD SHORTCUTS
    // ═══════════════════════════════════════
    // Esc — close menus, double-Esc cancel chat
    let lastEscTime = 0;
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const now = Date.now();
        // Close any open overlay first
        const palette = document.getElementById('palette-overlay');
        const settings = document.getElementById('settings-overlay');
        const slashMenu = document.getElementById('slash-menu');
        if (palette && palette.style.display !== 'none') { closePalette(); return; }
        if (settings && settings.style.display !== 'none') { toggleSettings(); return; }
        if (slashMenu && slashMenu.classList.contains('visible')) {
          slashMenu.classList.remove('visible');
          return;
        }
        // Double-Esc cancels chat message
        if (now - lastEscTime < 400) {
          const input = document.getElementById('chat-input');
          if (input && input.value.trim()) {
            input.value = '';
            input.style.height = 'auto';
            if (typeof showToast === 'function') showToast('Mensagem cancelada', 'info', 1500);
          }
          lastEscTime = 0;
          return;
        }
        lastEscTime = now;
      }

      // Cmd+R / Cmd+Shift+R — Block reload (prevents state loss)
      if (e.metaKey && e.key === 'r') { e.preventDefault(); }
      // Cmd+Shift+P — Command Palette
      if (e.metaKey && e.shiftKey && e.key === 'p') { e.preventDefault(); openPalette(); }
      // Cmd+, — Settings
      if (e.metaKey && e.key === ',') { e.preventDefault(); toggleSettings(); }
      // Cmd+O — Open folder
      if (e.metaKey && e.key === 'o') { e.preventDefault(); openFolder(); }
      // Cmd+J — Toggle terminal
      if (e.metaKey && e.key === 'j') { e.preventDefault(); toggleTerminal(); }
      // Cmd+F — Toggle search in explorer (skip if in Monaco editor)
      if (e.metaKey && e.key === 'f' && !e.shiftKey) {
        if (!document.activeElement?.closest('.monaco-editor')) {
          e.preventDefault();
          toggleExplorerSearch();
        }
      }
      // Cmd+Shift+F — Global search in explorer
      if (e.metaKey && e.shiftKey && e.key === 'f') {
        e.preventDefault();
        toggleExplorerSearch();
      }
    });

    // ═══════════════════════════════════════
    //  SIDEBAR SWITCHING
    // ═══════════════════════════════════════
    function switchSidebar(panel) {
      const explorerPanel = document.getElementById('explorer-panel');
      const gitPanel = document.getElementById('git-panel');
      const btnExplorer = document.getElementById('btn-explorer');
      const btnGit = document.getElementById('btn-git');

      if (panel === 'explorer') {
        explorerPanel.style.display = 'flex';
        gitPanel.style.display = 'none';
        btnExplorer.classList.add('active');
        btnGit.classList.remove('active');
      } else if (panel === 'git') {
        explorerPanel.style.display = 'none';
        gitPanel.style.display = 'flex';
        btnExplorer.classList.remove('active');
        btnGit.classList.add('active');
        refreshGit();
      }
    }

    function toggleExplorerSearch() {
      const searchDiv = document.getElementById('explorer-search');
      const input = document.getElementById('search-input');
      if (searchDiv.style.display === 'none' || searchDiv.style.display === '') {
        searchDiv.style.display = 'flex';
        input.focus();
      } else {
        searchDiv.style.display = 'none';
        input.value = '';
        document.getElementById('search-results').innerHTML = '';
        document.getElementById('search-results-info').style.display = 'none';
      }
    }

    // ═══════════════════════════════════════
    //  COMMAND PALETTE
    // ═══════════════════════════════════════
    let paletteActiveIndex = 0;
    let paletteFiltered = [];

    const commands = [
      { id: 'openFolder', icon: '📂', label: 'Abrir Pasta', shortcut: '⌘O', category: 'File', action: () => openFolder() },
      { id: 'save', icon: '💾', label: 'Salvar Arquivo', shortcut: '⌘S', category: 'File', action: () => saveCurrentFile() },
      { id: 'newFile', icon: '📝', label: 'Novo Arquivo', shortcut: '', category: 'File', action: () => showToast('Em breve!', 'info') },
      { id: 'closeTab', icon: '✕', label: 'Fechar Aba', shortcut: '⌘W', category: 'File', action: () => { if (activeFile) closeTab(activeFile); } },
      { id: 'toggleTerminal', icon: '⌨️', label: 'Toggle Terminal', shortcut: '⌘`', category: 'View', action: () => toggleTerminal() },
      { id: 'toggleExplorer', icon: '📁', label: 'Mostrar Explorer', shortcut: '', category: 'View', action: () => switchSidebar('explorer') },
      { id: 'toggleGit', icon: '🔀', label: 'Mostrar Git', shortcut: '', category: 'View', action: () => switchSidebar('git') },
      { id: 'toggleSettings', icon: '⚙️', label: 'Abrir Settings', shortcut: '⌘,', category: 'Preferences', action: () => toggleSettings() },
      { id: 'search', icon: '🔍', label: 'Buscar em Arquivos', shortcut: '⌘F', category: 'Edit', action: () => { switchSidebar('explorer'); toggleExplorerSearch(); } },
      { id: 'gitRefresh', icon: '🔄', label: 'Git: Atualizar', shortcut: '', category: 'Git', action: () => refreshGit() },
      { id: 'gitStageAll', icon: '✅', label: 'Git: Stage All', shortcut: '', category: 'Git', action: () => gitStageAll() },
      { id: 'gitCommit', icon: '📝', label: 'Git: Commit', shortcut: '', category: 'Git', action: () => { switchSidebar('git'); document.getElementById('git-commit-msg')?.focus(); } },
      { id: 'aiReset', icon: '🧠', label: 'Hermes: Reset Chat', shortcut: '', category: 'AI', action: async () => { await hermesIDE.hermes.reset(); document.getElementById('chat-messages').innerHTML = ''; showToast('Chat resetado!', 'success'); } },
      { id: 'fontSize+', icon: '🔤', label: 'Aumentar Font Size', shortcut: '', category: 'Editor', action: () => changeSetting('fontSize', 1) },
      { id: 'fontSize-', icon: '🔤', label: 'Diminuir Font Size', shortcut: '', category: 'Editor', action: () => changeSetting('fontSize', -1) },
      { id: 'wordWrap', icon: '↩️', label: 'Toggle Word Wrap', shortcut: '', category: 'Editor', action: () => applySetting('wordWrap', !settings.wordWrap) },
      { id: 'minimap', icon: '🗺️', label: 'Toggle Minimap', shortcut: '', category: 'Editor', action: () => applySetting('minimap', !settings.minimap) },
    ];

    function openPalette() {
      const overlay = document.getElementById('palette-overlay');
      overlay.style.display = 'flex';
      const input = document.getElementById('palette-input');
      input.value = '';
      paletteActiveIndex = 0;
      renderPalette('');
      setTimeout(() => input.focus(), 50);
    }

    function closePalette() {
      document.getElementById('palette-overlay').style.display = 'none';
    }

    function fuzzyMatch(query, text) {
      const lower = text.toLowerCase();
      const q = query.toLowerCase();
      let qi = 0, score = 0, indices = [];
      for (let i = 0; i < lower.length && qi < q.length; i++) {
        if (lower[i] === q[qi]) {
          score += (i === 0 || lower[i-1] === ' ') ? 3 : 1; // bonus for word start
          indices.push(i);
          qi++;
        }
      }
      return qi === q.length ? { score, indices } : null;
    }

    function highlightMatch(text, indices) {
      let result = '', last = 0;
      for (const i of indices) {
        result += escapeHtml(text.substring(last, i)) + '<mark>' + escapeHtml(text[i]) + '</mark>';
        last = i + 1;
      }
      result += escapeHtml(text.substring(last));
      return result;
    }

    function renderPalette(query) {
      const list = document.getElementById('palette-list');
      if (!query) {
        paletteFiltered = [...commands];
      } else {
        paletteFiltered = commands
          .map(cmd => ({ cmd, match: fuzzyMatch(query, cmd.label) }))
          .filter(r => r.match)
          .sort((a, b) => b.match.score - a.match.score)
          .map(r => ({ ...r.cmd, _indices: r.match.indices }));
      }

      if (paletteFiltered.length === 0) {
        list.innerHTML = '<div class="palette-empty">Nenhum comando encontrado</div>';
        return;
      }

      paletteActiveIndex = Math.min(paletteActiveIndex, paletteFiltered.length - 1);
      let html = '';
      paletteFiltered.forEach((cmd, i) => {
        const label = cmd._indices ? highlightMatch(cmd.label, cmd._indices) : escapeHtml(cmd.label);
        html += `<div class="palette-item ${i === paletteActiveIndex ? 'active' : ''}" data-index="${i}" onclick="executePaletteItem(${i})">
          <span class="pi-icon">${cmd.icon}</span>
          <span class="pi-label">${label}</span>
          <span class="pi-category">${cmd.category}</span>
          ${cmd.shortcut ? `<span class="pi-shortcut">${cmd.shortcut}</span>` : ''}
        </div>`;
      });
      list.innerHTML = html;
    }

    function executePaletteItem(index) {
      const cmd = paletteFiltered[index];
      if (cmd) {
        closePalette();
        cmd.action();
      }
    }

    // Palette keyboard handling
    document.addEventListener('DOMContentLoaded', () => {
      const input = document.getElementById('palette-input');
      if (input) {
        input.addEventListener('input', () => {
          paletteActiveIndex = 0;
          renderPalette(input.value);
        });
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') { closePalette(); return; }
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            paletteActiveIndex = Math.min(paletteActiveIndex + 1, paletteFiltered.length - 1);
            renderPalette(input.value);
            document.querySelector('.palette-item.active')?.scrollIntoView({ block: 'nearest' });
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            paletteActiveIndex = Math.max(paletteActiveIndex - 1, 0);
            renderPalette(input.value);
            document.querySelector('.palette-item.active')?.scrollIntoView({ block: 'nearest' });
          }
          if (e.key === 'Enter') {
            e.preventDefault();
            executePaletteItem(paletteActiveIndex);
          }
        });
      }
    });

    // ═══════════════════════════════════════
    //  SETTINGS
    // ═══════════════════════════════════════
    const defaultSettings = {
      fontSize: 14,
      tabSize: '2',
      wordWrap: false,
      minimap: true,
      lineNumbers: 'on',
      theme: 'system',
      terminalFontSize: 14,
      autoSave: true,
    };

    let settings = { ...defaultSettings };

    async function loadSettings() {
      const saved = localStorage.getItem('hermesIDE_settings');
      if (saved) {
        settings = { ...defaultSettings, ...JSON.parse(saved) };
      } else {
        // No saved settings — detect system theme
        try {
          const sysTheme = await hermesIDE.window.getSystemTheme();
          settings = { ...defaultSettings, theme: sysTheme };
        } catch {
          settings = { ...defaultSettings };
        }
      }
      // Apply settings to editor/terminal
      for (const [key, value] of Object.entries(settings)) {
        applySetting(key, value, false);
      }
    }

    function updateSettingsUI() {
      const el = (id) => document.getElementById(id);
      if (el('setting-fontSize')) el('setting-fontSize').textContent = settings.fontSize;
      if (el('setting-tabSize')) el('setting-tabSize').value = settings.tabSize;
      if (el('setting-wordWrap')) el('setting-wordWrap').checked = settings.wordWrap;
      if (el('setting-minimap')) el('setting-minimap').checked = settings.minimap;
      if (el('setting-lineNumbers')) el('setting-lineNumbers').value = settings.lineNumbers;
      if (el('setting-theme')) el('setting-theme').value = settings.theme;
      if (el('setting-terminalFontSize')) el('setting-terminalFontSize').textContent = settings.terminalFontSize;
      if (el('setting-autoSave')) el('setting-autoSave').checked = settings.autoSave;
    }

    function saveSettings() {
      try { localStorage.setItem('hermesIDE_settings', JSON.stringify(settings)); } catch {}
    }

    function applySetting(key, value, doSave = true) {
      settings[key] = value;
      if (doSave) saveSettings();

      if (monacoEditor) {
        switch (key) {
          case 'fontSize': monacoEditor.updateOptions({ fontSize: value }); document.documentElement.style.setProperty('--ui-font-size', value + 'px'); break;
          case 'tabSize': monacoEditor.updateOptions({ tabSize: parseInt(value) }); document.getElementById('status-indent').textContent = `Spaces: ${value}`; break;
          case 'wordWrap': monacoEditor.updateOptions({ wordWrap: value ? 'on' : 'off' }); break;
          case 'minimap': monacoEditor.updateOptions({ minimap: { enabled: value } }); break;
          case 'lineNumbers': monacoEditor.updateOptions({ lineNumbers: value }); break;
        }
      } else if (key === 'fontSize') {
        document.documentElement.style.setProperty('--ui-font-size', value + 'px');
      }
      if (key === 'terminalFontSize') {
        for (const [, t] of terminals) {
          t.xterm.options.fontSize = value;
        }
      }
      if (key === 'theme') {
        const applyTheme = (resolvedTheme) => {
          document.body.classList.toggle('theme-light', resolvedTheme === 'light');
          document.body.classList.toggle('theme-dark', resolvedTheme === 'dark');
          if (monacoEditor) {
            monaco.editor.setTheme(resolvedTheme === 'light' ? 'hermes-light' : 'hermes-dark');
          }
          applyTerminalTheme();
        };
        if (value === 'system') {
          hermesIDE.window.getSystemTheme().then(sysTheme => applyTheme(sysTheme));
        } else {
          applyTheme(value);
        }
      }
      // Show toast feedback
      if (doSave) {
        const labels = { fontSize: 'Font Size', tabSize: 'Tab Size', wordWrap: 'Word Wrap', minimap: 'Minimap', lineNumbers: 'Line Numbers', terminalFontSize: 'Terminal Font', theme: 'Theme', autoSave: 'Auto Save' };
        showToast(`${labels[key] || key}: ${typeof value === 'boolean' ? (value ? 'On' : 'Off') : value}`, 'info', 1500);
      }
    }

    function changeSetting(key, delta) {
      const min = key === 'fontSize' ? 10 : 8;
      const max = key === 'fontSize' ? 32 : 32;
      const newVal = Math.max(min, Math.min(max, settings[key] + delta));
      applySetting(key, newVal);
      document.getElementById(`setting-${key}`).textContent = newVal;
    }

    function toggleSettings() {
      const overlay = document.getElementById('settings-overlay');
      const isOpen = overlay.style.display !== 'none';
      overlay.style.display = isOpen ? 'none' : 'flex';
      if (!isOpen) {
        updateSettingsUI();
        loadHermesInfo();
      }
    }

    async function loadHermesInfo() {
      try {
        const health = await hermesIDE.hermes.health();
        document.getElementById('setting-model').textContent = health.model || 'default';
        document.getElementById('setting-provider').textContent = health.provider || 'auto';
        document.getElementById('setting-status').textContent = health.status === 'ok' ? '🟢 Online' : '🔴 Offline';
      } catch {
        document.getElementById('setting-status').textContent = '🔴 Offline';
      }
    }

    // Fill all data-icon elements with Lucide SVGs
    function initIcons() {
      document.querySelectorAll('[data-icon]').forEach(el => {
        const name = el.getAttribute('data-icon');
        const size = el.classList.contains('mi-bar') ? 20 : 16;
        el.innerHTML = icon(name, 'currentColor', size);
      });
    }
    document.addEventListener('DOMContentLoaded', initIcons);
    // Also run after a short delay for dynamically created elements
    setTimeout(initIcons, 500);

    // Load settings on startup
    loadSettings().then(() => updateSettingsUI());

    // ═══════════════════════════════════════
    //  VIBRANCY ENFORCER — MutationObserver
    // ═══════════════════════════════════════
    function forceVibrancy() {
      // Monaco
      document.querySelectorAll('#editor .monaco-editor, #editor .monaco-editor-background, #editor .margin, #editor .overflow-guard, #editor .editor-scrollable, #editor .lines-content').forEach(el => {
        el.style.background = 'transparent';
        el.style.backgroundColor = 'transparent';
      });
      // xterm
      document.querySelectorAll('#terminal-container .xterm-viewport, #terminal-container .xterm-screen, #terminal-container .xterm-rows').forEach(el => {
        el.style.backgroundColor = 'transparent';
      });
    }
    // Run on DOM changes
    const vibrancyObserver = new MutationObserver(() => forceVibrancy());
    vibrancyObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
    // Also run periodically for Monaco's internal updates
    setInterval(forceVibrancy, 2000);

    // ═══════════════════════════════════════
    //  GIT INTEGRATION
    // ═══════════════════════════════════════
    let gitData = { staged: [], changes: [], conflicts: [], branch: '', tracking: '' };

    const STATUS_MAP = {
      'M': { label: 'Modified', icon: 'M', cls: 'git-status-M' },
      'A': { label: 'Added', icon: 'A', cls: 'git-status-A' },
      'D': { label: 'Deleted', icon: 'D', cls: 'git-status-D' },
      'R': { label: 'Renamed', icon: 'R', cls: 'git-status-M' },
      'C': { label: 'Copied', icon: 'C', cls: 'git-status-M' },
      'U': { label: 'Conflict', icon: '!', cls: 'git-status-U' },
      '??': { label: 'Untracked', icon: '?', cls: 'git-status-?' },
    };

    function getStatusInfo(status) {
      if (status === '??') return STATUS_MAP['??'];
      if (status.includes('U') || status[0] === 'U' || status[1] === 'U') return STATUS_MAP['U'];
      return STATUS_MAP[status[1]] || STATUS_MAP[status[0]] || { label: status, icon: status[0], cls: '' };
    }

    async function refreshGit() {
      if (!currentFolder) {
        document.getElementById('git-empty').style.display = 'flex';
        document.getElementById('git-empty').querySelector('p').textContent = 'Abra uma pasta com repositório git para ver as mudanças.';
        return;
      }
      try {
        const status = await hermesIDE.git.status(currentFolder);
        if (status.error) {
          document.getElementById('git-empty').style.display = 'flex';
          document.getElementById('git-empty').querySelector('p').textContent = 'Não é um repositório git.';
          return;
        }
        document.getElementById('git-empty').style.display = 'none';

        gitData.branch = status.branch;
        gitData.tracking = status.tracking;
        // Update status bar
        document.getElementById('status-branch').textContent = `🔀 ${status.branch}`;
        const changed = status.files.length;
        document.getElementById('status-sync').textContent = `🔄 ${changed} change${changed !== 1 ? 's' : ''}`;
        gitData.staged = status.files.filter(f => f.indexStatus !== ' ' && f.indexStatus !== '?' && f.indexStatus !== '!');
        gitData.changes = status.files.filter(f => f.workTreeStatus !== ' ' || f.indexStatus === '?');
        gitData.conflicts = status.files.filter(f => {
          const s = f.indexStatus + f.workTreeStatus;
          return s.includes('U') || s === 'DD' || s === 'AA';
        });
        // Remove conflicts from changes list
        const conflictPaths = new Set(gitData.conflicts.map(f => f.path));
        gitData.changes = gitData.changes.filter(f => !conflictPaths.has(f.path));

        renderGitBranch();
        renderGitFiles('staged', gitData.staged);
        renderGitFiles('changes', gitData.changes);
        renderGitFiles('conflicts', gitData.conflicts);
        renderGitLog();
        updateCommitBtn();
      } catch (err) {
        console.error('[Git] refreshGit error:', err);
        document.getElementById('git-empty').style.display = 'flex';
        document.getElementById('git-empty').querySelector('p').textContent = `Erro: ${err.message}`;
      }
    }

    async function renderGitBranch() {
      const sel = document.getElementById('git-branch-select');
      const branches = await hermesIDE.git.branches(currentFolder);
      if (branches.error) { sel.innerHTML = `<option>${gitData.branch}</option>`; return; }
      sel.innerHTML = branches.branches.map(b =>
        `<option value="${escapeHtml(b.name)}" ${b.current ? 'selected' : ''}>${escapeHtml(b.name)}</option>`
      ).join('');
    }

    function renderGitFiles(section, files) {
      const sectionEl = document.getElementById(`git-${section}-section`);
      const countEl = document.getElementById(`git-${section}-count`);
      const filesEl = document.getElementById(`git-${section}-files`);

      if (files.length === 0) {
        sectionEl.style.display = 'none';
        return;
      }
      sectionEl.style.display = 'block';
      countEl.textContent = files.length;

      // Expand by default if there are files
      const arrow = document.getElementById(`git-${section}-arrow`);
      if (arrow && !arrow.classList.contains('open')) {
        arrow.classList.add('open');
        filesEl.style.display = 'block';
      }

      let html = '';
      for (const f of files) {
        const info = getStatusInfo(f.status || (f.indexStatus + f.workTreeStatus));
        const isStaged = section === 'staged';
        const fileName = f.path.split('/').pop();
        const filePath = f.path.includes('/') ? f.path.substring(0, f.path.lastIndexOf('/')) : '';
        const actionBtn = isStaged
          ? `<button title="Unstage" onclick="event.stopPropagation(); gitUnstageFile('${escapeHtml(f.path)}')">↩️</button>`
          : `<button title="Stage" onclick="event.stopPropagation(); gitStageFile('${escapeHtml(f.path)}')">✅</button>`;
        html += `<div class="git-file" onclick="gitShowDiff('${escapeHtml(f.path)}', ${isStaged})" title="${escapeHtml(f.path)}">
          <span class="git-file-icon ${info.cls}">${info.icon}</span>
          <span class="git-file-name">${escapeHtml(fileName)}</span>
          <span class="git-file-path">${escapeHtml(filePath)}</span>
          <span class="git-file-actions">${actionBtn}</span>
        </div>`;
      }
      filesEl.innerHTML = html;
    }

    async function renderGitLog() {
      const logEl = document.getElementById('git-log-list');
      const log = await hermesIDE.git.log(currentFolder, 15);
      if (log.error || !log.entries?.length) { logEl.innerHTML = ''; logEl.style.display = 'none'; return; }
      let html = '';
      for (const entry of log.entries) {
        html += `<div class="git-commit-entry">
          <span class="git-commit-hash">${escapeHtml(entry.hash)}</span>
          <span class="git-commit-msg">${escapeHtml(entry.message)}</span>
          <span class="git-commit-date">${escapeHtml(entry.date)}</span>
        </div>`;
      }
      logEl.innerHTML = html;
      logEl.style.display = 'block';
      // Update arrow
      const arrow = document.getElementById('git-log-arrow');
      if (arrow) arrow.classList.add('open');
    }

    async function gitShowDiff(filePath, staged) {
      const result = await hermesIDE.git.diff(currentFolder, filePath, staged);
      if (result.error) return;
      // Open diff in Monaco editor as read-only
      if (monacoEditor && result.diff) {
        const model = monaco.editor.createModel(result.diff, 'diff');
        monacoEditor.setModel(model);
        monacoEditor.updateOptions({ readOnly: true });
        document.getElementById('welcome')?.classList.add('hidden');
        document.getElementById('editor-container')?.classList.remove('hidden');
        // Update tab
        const tabsEl = document.getElementById('tabs');
        tabsEl.innerHTML = `<div class="tab active" data-path="diff">
          <span>📝 ${filePath.split('/').pop()} (diff)</span>
        </div>`;
      }
    }

    async function gitStageFile(filePath) {
      await hermesIDE.git.stage(currentFolder, filePath);
      refreshGit();
    }

    async function gitUnstageFile(filePath) {
      await hermesIDE.git.unstage(currentFolder, filePath);
      refreshGit();
    }

    async function gitStageAll() {
      await hermesIDE.git.stageAll(currentFolder);
      refreshGit();
    }

    async function gitUnstageAll() {
      await hermesIDE.git.unstageAll(currentFolder);
      refreshGit();
    }

    async function gitCheckout(branch) {
      const result = await hermesIDE.git.checkout(currentFolder, branch);
      if (result.error) {
        console.error('[Git] checkout error:', result.error);
        showToast(`Checkout erro: ${result.error}`, 'error');
      }
      refreshGit();
    }

    async function gitPush() {
      showToast('Pushando...', 'info', 1500);
      const result = await hermesIDE.git.push(currentFolder);
      if (result.error) {
        showToast(`Push erro: ${result.error}`, 'error');
      } else {
        showToast('Push realizado!', 'success');
        refreshGit();
      }
    }

    async function gitPull() {
      showToast('Puxando...', 'info', 1500);
      const result = await hermesIDE.git.pull(currentFolder);
      if (result.error) {
        showToast(`Pull erro: ${result.error}`, 'error');
      } else {
        showToast('Pull realizado!', 'success');
        refreshGit();
      }
    }

    async function gitCommit() {
      const msgEl = document.getElementById('git-commit-msg');
      const msg = msgEl.value.trim();
      if (!msg) return;
      const btn = document.getElementById('git-commit-btn');
      btn.disabled = true;
      btn.textContent = 'Committing...';
      const result = await hermesIDE.git.commit(currentFolder, msg);
      if (result.error) {
        console.error('[Git] commit error:', result.error);
        btn.textContent = 'Erro!';
        setTimeout(() => { btn.textContent = 'Commit'; updateCommitBtn(); }, 2000);
      } else {
        msgEl.value = '';
        btn.textContent = 'Feito! ✓';
        setTimeout(() => { btn.textContent = 'Commit'; updateCommitBtn(); }, 1500);
        showToast('Commit realizado!', 'success');
        refreshGit();
      }
    }

    function updateCommitBtn() {
      const btn = document.getElementById('git-commit-btn');
      const msg = document.getElementById('git-commit-msg').value.trim();
      btn.disabled = !msg || gitData.staged.length === 0;
    }

    function toggleGitSection(section) {
      const arrow = document.getElementById(`git-${section}-arrow`);
      const filesEl = document.getElementById(`git-${section}-files`);
      if (!arrow || !filesEl) return;
      const isOpen = arrow.classList.contains('open');
      arrow.classList.toggle('open');
      filesEl.style.display = isOpen ? 'none' : 'block';
    }

    // Commit textarea events
    document.addEventListener('DOMContentLoaded', () => {
      const commitMsg = document.getElementById('git-commit-msg');
      if (commitMsg) {
        commitMsg.addEventListener('input', updateCommitBtn);
        commitMsg.addEventListener('keydown', (e) => {
          if (e.ctrlKey && e.key === 'Enter') {
            e.preventDefault();
            gitCommit();
          }
        });
      }
    });

    // ═══════════════════════════════════════
    //  SEARCH
    // ═══════════════════════════════════════
    let searchOpts = { case: false, regex: false, whole: false };
    let searchTimeout = null;

    function toggleSearchOpt(btn, opt) {
      searchOpts[opt] = !searchOpts[opt];
      btn.classList.toggle('active');
      runSearch();
    }

    function toggleReplace() {
      const row = document.getElementById('replace-row');
      const btn = document.getElementById('opt-replace');
      const isHidden = row.style.display === 'none';
      row.style.display = isHidden ? 'flex' : 'none';
      btn.classList.toggle('active', isHidden);
    }

    function highlightMatch(text, query) {
      if (!query) return escapeHtml(text);
      const escaped = escapeHtml(text);
      const escapedQuery = escapeHtml(query);
      try {
        const regex = new RegExp(`(${escapedQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
        return escaped.replace(regex, '<span class="match-highlight">$1</span>');
      } catch {
        return escaped;
      }
    }

    async function runSearch() {
      const input = document.getElementById('search-input');
      const query = input.value.trim();
      const resultsDiv = document.getElementById('search-results');
      const infoDiv = document.getElementById('search-results-info');

      if (!query || query.length < 2) {
        resultsDiv.innerHTML = '';
        infoDiv.style.display = 'none';
        return;
      }

      if (!currentFolder) {
        resultsDiv.innerHTML = '<div class="search-empty">Abra uma pasta primeiro</div>';
        infoDiv.style.display = 'none';
        return;
      }

      // Show loading
      resultsDiv.innerHTML = '<div class="search-loading"><div class="search-spinner"></div> Buscando...</div>';
      infoDiv.style.display = 'none';

      try {
        const results = await hermesIDE.search.files(currentFolder, query);

        if (!results || results.length === 0) {
          resultsDiv.innerHTML = `<div class="search-empty">Nenhum resultado para "${escapeHtml(query)}"</div>`;
          infoDiv.style.display = 'none';
          return;
        }

        if (results[0]?.error) {
          resultsDiv.innerHTML = `<div class="search-empty">Erro: ${escapeHtml(results[0].error)}</div>`;
          infoDiv.style.display = 'none';
          return;
        }

        // Show info
        infoDiv.textContent = `${results.length} arquivo${results.length > 1 ? 's' : ''} encontrado${results.length > 1 ? 's' : ''}`;
        infoDiv.style.display = 'block';

        // Group results by file
        const grouped = new Map();
        for (const r of results) {
          if (!grouped.has(r.file)) {
            grouped.set(r.file, { name: r.name, path: r.relativePath, lines: [] });
          }
          grouped.get(r.file).lines.push({ line: r.line, text: r.text });
        }

        // Render results
        let html = '';
        for (const [filePath, data] of grouped) {
          const icon = getFileIcon({ name: data.name, isFile: true, isDirectory: false });
          html += `<div class="search-result-file" data-file="${escapeHtml(filePath)}">`;
          html += `<div class="search-result-file-header">`;
          html += `<span class="file-icon">${icon}</span>`;
          html += `<span>${escapeHtml(data.name)}</span>`;
          html += `<span class="file-path">${escapeHtml(data.path)}</span>`;
          html += `</div>`;

          for (const line of data.lines) {
            html += `<div class="search-result-line" data-file="${escapeHtml(filePath)}" data-line="${line.line}">`;
            html += `<span class="line-num">${line.line}</span>`;
            html += `<span class="line-text">${highlightMatch(line.text, query)}</span>`;
            html += `</div>`;
          }

          html += `</div>`;
        }

        resultsDiv.innerHTML = html;

        // Add click handlers
        resultsDiv.querySelectorAll('.search-result-line').forEach(el => {
          el.addEventListener('click', () => {
            const file = el.dataset.file;
            const line = parseInt(el.dataset.line);
            openFileAndGoToLine(file, line);
          });
        });

        resultsDiv.querySelectorAll('.search-result-file-header').forEach(el => {
          el.addEventListener('click', () => {
            const file = el.closest('.search-result-file').dataset.file;
            const name = file.split('/').pop();
            openFile(file, name);
          });
        });

      } catch (err) {
        resultsDiv.innerHTML = `<div class="search-empty">Erro: ${err.message}</div>`;
      }
    }

    async function openFileAndGoToLine(filePath, lineNumber) {
      const fileName = filePath.split('/').pop();
      await openFile(filePath, fileName);

      // Jump to line after editor is ready
      if (monacoEditor) {
        setTimeout(() => {
          monacoEditor.revealLineInCenter(lineNumber);
          monacoEditor.setPosition({ lineNumber, column: 1 });
          monacoEditor.focus();

          // Highlight the line briefly
          const decoration = monacoEditor.deltaDecorations([], [{
            range: new monaco.Range(lineNumber, 1, lineNumber, 1),
            options: {
              isWholeLine: true,
              className: 'search-line-highlight',
              overviewRuler: { color: '#C1121F', position: 1 },
            }
          }]);

          // Remove highlight after 2 seconds
          setTimeout(() => {
            monacoEditor.deltaDecorations(decoration, []);
          }, 2000);
        }, 100);
      }
    }

    // Debounced search on input
    document.addEventListener('DOMContentLoaded', () => {
      const searchInput = document.getElementById('search-input');
      if (searchInput) {
        searchInput.addEventListener('input', () => {
          clearTimeout(searchTimeout);
          searchTimeout = setTimeout(runSearch, 300);
        });

        searchInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            clearTimeout(searchTimeout);
            runSearch();
          }
        });
      }
    });