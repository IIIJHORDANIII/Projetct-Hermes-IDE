function showToast(message, type = 'info', duration = 3000) {
      const container = document.getElementById('toast-container');
      const toast = document.createElement('div');
      toast.className = `toast toast-${type}`;
      const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
      toast.innerHTML = `<span>${icons[type] || ''}</span><span>${message}</span>`;
      container.appendChild(toast);
      setTimeout(() => {
        toast.classList.add('removing');
        setTimeout(() => toast.remove(), 200);
      }, duration);
    }

    // Slash command menu — ALL code here so it's isolated from main script errors
    (function() {
      const slashCommands = [
        { cmd: '/help', desc: 'Mostra comandos disponíveis' },
        { cmd: '/memory', desc: 'Gerenciar memórias do agente' },
        { cmd: '/skills', desc: 'Listar skills disponíveis' },
        { cmd: '/reset', desc: 'Resetar conversa' },
        { cmd: '/clear', desc: 'Limpar chat' },
        { cmd: '/model', desc: 'Ver/trocar modelo de IA' },
        { cmd: '/provider', desc: 'Ver/trocar provider' },
        { cmd: '/status', desc: 'Status do agente' },
        { cmd: '/trajectory', desc: 'Ver trajetória da sessão' },
        { cmd: '/compact', desc: 'Compactar contexto' },
        { cmd: '/undo', desc: 'Desfazer última ação' },
        { cmd: '/plan', desc: 'Criar plano de implementação' },
      ];
      let activeIndex = 0;
      let visible = false;

      function show(filter) {
        const menu = document.getElementById('slash-menu');
        if (!menu) return;
        const filtered = filter
          ? slashCommands.filter(c => c.cmd.includes(filter.toLowerCase()))
          : slashCommands;
        if (filtered.length === 0) { hide(); return; }
        activeIndex = Math.min(activeIndex, filtered.length - 1);
        let html = '';
        filtered.forEach((c, i) => {
          html += `<div class="slash-item ${i === activeIndex ? 'active' : ''}" data-cmd="${c.cmd}">
            <span class="slash-cmd">${c.cmd}</span>
            <span class="slash-desc">${c.desc}</span>
          </div>`;
        });
        menu.innerHTML = html;
        menu.classList.add('visible');
        visible = true;
        // Click handlers
        menu.querySelectorAll('.slash-item').forEach(el => {
          el.addEventListener('click', () => select(el.dataset.cmd));
        });
      }

      function hide() {
        const menu = document.getElementById('slash-menu');
        if (menu) menu.classList.remove('visible');
        visible = false;
        activeIndex = 0;
      }

      function select(cmd) {
        hide();
        const input = document.getElementById('chat-input');
        if (input) { input.value = ''; input.style.height = 'auto'; }
        executeSlash(cmd);
      }

      function executeSlash(cmd) {
        const parts = cmd.split(' ');
        const command = parts[0];
        const args = parts.slice(1).join(' ');

        switch(command) {
          case '/clear':
            document.getElementById('chat-messages').innerHTML = '';
            break;
          case '/reset':
            if (typeof hermesIDE !== 'undefined') hermesIDE.hermes.reset();
            document.getElementById('chat-messages').innerHTML = '';
            if (typeof showToast === 'function') showToast('Chat resetado!', 'success');
            break;
          case '/model':
            showModelPicker();
            break;
          case '/provider':
            showProviderPicker();
            break;
          case '/help':
            sendToChat('/help');
            break;
          case '/memory':
            if (args) {
              sendToChat(`/memory ${args}`);
            } else {
              showMemoryPicker();
            }
            break;
          case '/skills':
            if (args) {
              sendToChat(`/skills ${args}`);
            } else {
              showSkillsPicker();
            }
            break;
          case '/status':
            sendToChat('/status');
            break;
          case '/trajectory':
            sendToChat('/trajectory');
            break;
          case '/compact':
            sendToChat('/compact');
            break;
          case '/undo':
            sendToChat('/undo');
            break;
          case '/plan':
            sendToChat(args ? `/plan ${args}` : '/plan');
            break;
          default:
            sendToChat(cmd);
        }
      }

      function sendToChat(msg) {
        const input = document.getElementById('chat-input');
        if (input) {
          input.value = msg;
          if (typeof sendChat === 'function') sendChat();
        }
      }

      async function showModelPicker() {
        if (typeof showToast === 'function') showToast('Carregando modelos...', 'info', 1500);
        try {
          const health = await hermesIDE.hermes.health();
          const current = health.model || 'default';
          const menu = document.getElementById('slash-menu');
          const models = [
            { cmd: current, desc: '(atual)' },
            { cmd: 'claude-sonnet-4', desc: 'Claude Sonnet 4' },
            { cmd: 'claude-opus-4', desc: 'Claude Opus 4' },
            { cmd: 'gpt-4o', desc: 'GPT-4o' },
            { cmd: 'gpt-4.1', desc: 'GPT-4.1' },
            { cmd: 'gemini-2.5-pro', desc: 'Gemini 2.5 Pro' },
            { cmd: 'deepseek-r1', desc: 'DeepSeek R1' },
            { cmd: 'mimo-v2.5-pro', desc: 'MiMo v2.5 Pro' },
          ];
          let html = '<div style="padding:8px 12px;font-size:11px;color:var(--text-dim);font-weight:600;text-transform:uppercase;letter-spacing:0.5px">Modelo atual: ' + current + '</div>';
          models.forEach(m => {
            html += `<div class="slash-item" data-model="${m.cmd}">
              <span class="slash-cmd">${m.cmd}</span>
              <span class="slash-desc">${m.desc}</span>
            </div>`;
          });
          menu.innerHTML = html;
          menu.classList.add('visible');
          menu.querySelectorAll('.slash-item').forEach(el => {
            el.addEventListener('click', async () => {
              const model = el.dataset.model;
              menu.classList.remove('visible');
              sendToChat(`/model ${model}`);
            });
          });
        } catch(e) {
          if (typeof showToast === 'function') showToast('Erro ao carregar modelos', 'error');
        }
      }

      async function showProviderPicker() {
        const menu = document.getElementById('slash-menu');
        const providers = ['xiaomi', 'anthropic', 'openai', 'google', 'openrouter'];
        let html = '<div style="padding:8px 12px;font-size:11px;color:var(--text-dim);font-weight:600;text-transform:uppercase;letter-spacing:0.5px">Provider</div>';
        providers.forEach(p => {
          html += `<div class="slash-item" data-provider="${p}">
            <span class="slash-cmd">${p}</span>
          </div>`;
        });
        menu.innerHTML = html;
        menu.classList.add('visible');
        menu.querySelectorAll('.slash-item').forEach(el => {
          el.addEventListener('click', () => {
            menu.classList.remove('visible');
            sendToChat(`/provider ${el.dataset.provider}`);
          });
        });
      }

      async function showMemoryPicker() {
        const menu = document.getElementById('slash-menu');
        const actions = [
          { cmd: '/memory list', desc: 'Listar todas as memórias' },
          { cmd: '/memory search', desc: 'Buscar memória' },
          { cmd: '/memory add', desc: 'Adicionar nova memória' },
          { cmd: '/memory clear', desc: 'Limpar memórias' },
        ];
        let html = '<div style="padding:8px 12px;font-size:11px;color:var(--text-dim);font-weight:600;text-transform:uppercase;letter-spacing:0.5px">Memory</div>';
        actions.forEach(a => {
          html += `<div class="slash-item" data-cmd="${a.cmd}">
            <span class="slash-cmd">${a.cmd}</span>
            <span class="slash-desc">${a.desc}</span>
          </div>`;
        });
        menu.innerHTML = html;
        menu.classList.add('visible');
        menu.querySelectorAll('.slash-item').forEach(el => {
          el.addEventListener('click', () => {
            menu.classList.remove('visible');
            sendToChat(el.dataset.cmd);
          });
        });
      }

      async function showSkillsPicker() {
        if (typeof showToast === 'function') showToast('Carregando skills...', 'info', 1500);
        try {
          const health = await hermesIDE.hermes.health();
          const menu = document.getElementById('slash-menu');
          const skills = health.skills || [];
          let html = '<div style="padding:8px 12px;font-size:11px;color:var(--text-dim);font-weight:600;text-transform:uppercase;letter-spacing:0.5px">Skills (' + skills.length + ')</div>';
          if (skills.length === 0) {
            html += '<div style="padding:12px;color:var(--text-dim);font-size:12px">Nenhuma skill encontrada</div>';
          } else {
            skills.forEach(s => {
              const name = typeof s === 'string' ? s : s.name || s;
              html += `<div class="slash-item" data-skill="${name}">
                <span class="slash-cmd">${name}</span>
              </div>`;
            });
          }
          menu.innerHTML = html;
          menu.classList.add('visible');
          menu.querySelectorAll('.slash-item').forEach(el => {
            el.addEventListener('click', () => {
              menu.classList.remove('visible');
              sendToChat(`/skills ${el.dataset.skill}`);
            });
          });
        } catch(e) {
          if (typeof showToast === 'function') showToast('Erro ao carregar skills', 'error');
        }
      }

      const chatInput = document.getElementById('chat-input');
      if (!chatInput) return;

      chatInput.addEventListener('input', function() {
        const val = this.value;
        if (val.startsWith('/') && val.length > 0 && !val.includes(' ')) {
          show(val);
        } else {
          hide();
        }
        this.style.height = 'auto';
        this.style.height = Math.min(this.scrollHeight, 120) + 'px';
      });

      chatInput.addEventListener('keydown', function(e) {
        if (visible) {
          const menu = document.getElementById('slash-menu');
          const items = menu.querySelectorAll('.slash-item');
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            activeIndex = Math.min(activeIndex + 1, items.length - 1);
            items.forEach((el, i) => el.classList.toggle('active', i === activeIndex));
            items[activeIndex]?.scrollIntoView({ block: 'nearest' });
            return;
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            activeIndex = Math.max(activeIndex - 1, 0);
            items.forEach((el, i) => el.classList.toggle('active', i === activeIndex));
            items[activeIndex]?.scrollIntoView({ block: 'nearest' });
            return;
          }
          if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault();
            const activeItem = items[activeIndex];
            if (activeItem) select(activeItem.dataset.cmd);
            return;
          }
          if (e.key === 'Escape') {
            hide();
            return;
          }
        }
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          if (typeof sendChat === 'function') sendChat();
        }
      });
    })();