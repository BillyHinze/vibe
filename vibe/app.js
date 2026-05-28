/* ================================================================
   VIBE — app.js  ✦  Full frontend JavaScript
   ================================================================ */
'use strict';

/* ================================================================
   STATE
   ================================================================ */
const State = {
  user: null, token: null, refreshToken: null, socket: null,
  currentServerId: null, currentChannelId: null, currentDMUserId: null,
  isDMMode: false, servers: [], channels: {}, members: {},
  messages: {}, dmConversations: [], dmMessages: {},
  notifications: [], friends: [], shopItems: [],
  replyingTo: null, pendingAttachment: null,
  typingUsers: {}, slowModeCooldown: 0, slowModeTimer: null,
  membersVisible: true, pinsVisible: false,
  hasMoreMessages: true, loadingMessages: false,
  searchActive: false, theme: 'dark', onboardingDone: false,
};

/* ================================================================
   API HELPER
   ================================================================ */
const API = {
  async request(method, path, body, isFormData = false) {
    const headers = {};
    if (State.token) headers['Authorization'] = `Bearer ${State.token}`;
    if (!isFormData) headers['Content-Type'] = 'application/json';
    const opts = { method, headers };
    if (body) opts.body = isFormData ? body : JSON.stringify(body);
    let res = await fetch(path, opts);
    if (res.status === 403) {
      const refreshed = await this.refreshAccessToken();
      if (refreshed) {
        headers['Authorization'] = `Bearer ${State.token}`;
        opts.headers = headers;
        res = await fetch(path, opts);
      } else { Auth.logout(); return null; }
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(err.error || 'Request failed');
    }
    return res.json().catch(() => null);
  },
  async refreshAccessToken() {
    if (!State.refreshToken) return false;
    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: State.refreshToken }),
      });
      if (!res.ok) return false;
      const data = await res.json();
      State.token = data.token; State.refreshToken = data.refreshToken;
      localStorage.setItem('vibe_token', data.token);
      localStorage.setItem('vibe_refresh', data.refreshToken);
      return true;
    } catch { return false; }
  },
  get: (path) => API.request('GET', path),
  post: (path, body) => API.request('POST', path, body),
  patch: (path, body) => API.request('PATCH', path, body),
  delete: (path) => API.request('DELETE', path),
  postForm: (path, fd) => API.request('POST', path, fd, true),
  patchForm: (path, fd) => API.request('PATCH', path, fd, true),
};

/* ================================================================
   PARTICLES CANVAS
   ================================================================ */
const Particles = {
  init(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let w, h, particles;
    function resize() {
      w = canvas.width = canvas.parentElement?.offsetWidth || window.innerWidth;
      h = canvas.height = canvas.parentElement?.offsetHeight || window.innerHeight;
    }
    function spawn() {
      particles = [];
      const count = Math.floor((w * h) / 8000);
      for (let i = 0; i < count; i++) {
        particles.push({
          x: Math.random() * w, y: Math.random() * h,
          r: Math.random() * 1.5 + 0.3,
          dx: (Math.random() - 0.5) * 0.4, dy: (Math.random() - 0.5) * 0.4,
          alpha: Math.random() * 0.6 + 0.1, hue: Math.random() * 60 + 250,
        });
      }
    }
    function draw() {
      ctx.clearRect(0, 0, w, h);
      for (const p of particles) {
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${p.hue},80%,70%,${p.alpha})`; ctx.fill();
        p.x += p.dx; p.y += p.dy;
        if (p.x < 0 || p.x > w) p.dx *= -1;
        if (p.y < 0 || p.y > h) p.dy *= -1;
      }
      requestAnimationFrame(draw);
    }
    resize(); spawn(); draw();
    window.addEventListener('resize', () => { resize(); spawn(); });
  },
};

/* ================================================================
   SPLASH
   ================================================================ */
const Splash = {
  messages: ['Connecting to VIBE...','Loading your universe...','Syncing servers...','Almost there...','Ready ✦'],
  show() {
    const splash = document.getElementById('splash');
    const progress = document.getElementById('splash-progress');
    const status = document.getElementById('splash-status');
    splash.classList.remove('hidden');
    Particles.init('splash-particles');
    let pct = 0, msgIdx = 0;
    const iv = setInterval(() => {
      pct += Math.random() * 18 + 5;
      if (pct > 100) pct = 100;
      progress.style.width = pct + '%';
      status.textContent = this.messages[Math.min(msgIdx++, this.messages.length - 1)];
      if (pct >= 100) clearInterval(iv);
    }, 180);
  },
  hide() {
    const splash = document.getElementById('splash');
    setTimeout(() => {
      splash.classList.add('out');
      setTimeout(() => splash.classList.add('hidden'), 500);
    }, 400);
  },
};

/* ================================================================
   AUTH
   ================================================================ */
const Auth = {
  init() {
    const token = localStorage.getItem('vibe_token');
    const refresh = localStorage.getItem('vibe_refresh');
    if (token && refresh) { State.token = token; State.refreshToken = refresh; return true; }
    return false;
  },
  async tryAutoLogin() {
    if (!State.token) return false;
    try { const user = await API.get('/api/users/me'); if (!user) return false; State.user = user; return true; } catch { return false; }
  },
  async login(username, password) {
    const data = await API.post('/api/auth/login', { username, password });
    State.token = data.token; State.refreshToken = data.refreshToken; State.user = data.user;
    localStorage.setItem('vibe_token', data.token); localStorage.setItem('vibe_refresh', data.refreshToken);
  },
  async register(formData) {
    const data = await API.postForm('/api/auth/register', formData);
    State.token = data.token; State.refreshToken = data.refreshToken; State.user = data.user;
    localStorage.setItem('vibe_token', data.token); localStorage.setItem('vibe_refresh', data.refreshToken);
  },
  logout() {
    API.post('/api/auth/logout', { refreshToken: State.refreshToken }).catch(() => {});
    State.token = null; State.refreshToken = null; State.user = null;
    State.socket?.disconnect();
    localStorage.removeItem('vibe_token'); localStorage.removeItem('vibe_refresh');
    location.reload();
  },
};

/* ================================================================
   SOCKET MANAGER
   ================================================================ */
const SocketManager = {
  connect() {
    if (State.socket?.connected) return;
    State.socket = io({ auth: { token: State.token }, transports: ['websocket'] });
    State.socket.on('connect', () => {
      console.log('Socket connected ✦');
      if (State.currentServerId) State.socket.emit('join_server', { serverId: State.currentServerId });
      if (State.currentChannelId) State.socket.emit('join_channel', { channelId: State.currentChannelId });
    });
    State.socket.on('disconnect', () => console.log('Socket disconnected'));

    State.socket.on('new_message', (msg) => {
      if (msg.channelId === State.currentChannelId) { Renderer.appendMessage(msg); UI.scrollToBottom(); }
      else UI.incrementChannelUnread(msg.channelId);
    });
    State.socket.on('message_edited', (msg) => Renderer.updateMessage(msg));
    State.socket.on('message_deleted', ({ messageId }) => { document.querySelector(`[data-msg-id="${messageId}"]`)?.remove(); });
    State.socket.on('reaction_updated', ({ messageId, reactions }) => Renderer.updateReactions(messageId, reactions));
    State.socket.on('poll_updated', ({ messageId, poll }) => Renderer.updatePoll(messageId, poll));

    State.socket.on('user_typing', ({ userId, displayName, channelId }) => {
      if (channelId !== State.currentChannelId) return;
      if (!State.typingUsers[channelId]) State.typingUsers[channelId] = {};
      State.typingUsers[channelId][userId] = displayName;
      UI.renderTyping(channelId);
    });
    State.socket.on('user_stop_typing', ({ userId, channelId }) => {
      if (State.typingUsers[channelId]) delete State.typingUsers[channelId][userId];
      UI.renderTyping(channelId);
    });

    State.socket.on('presence_update', ({ userId, status, avatarUrl, displayName }) => {
      UI.updateMemberPresence(userId, status, avatarUrl, displayName);
      if (userId === State.user?.id) { State.user.status = status; UI.renderUserBar(); }
    });

    State.socket.on('channel_created', (channel) => {
      if (channel.serverId !== State.currentServerId) return;
      if (!State.channels[State.currentServerId]) State.channels[State.currentServerId] = [];
      State.channels[State.currentServerId].push(channel);
      UI.renderChannelList();
    });
    State.socket.on('channel_updated', (channel) => {
      if (channel.serverId !== State.currentServerId) return;
      const arr = State.channels[State.currentServerId] || [];
      const idx = arr.findIndex(c => c.id === channel.id);
      if (idx !== -1) arr[idx] = channel;
      UI.renderChannelList();
    });
    State.socket.on('channel_deleted', ({ channelId, serverId }) => {
      if (serverId !== State.currentServerId) return;
      State.channels[serverId] = (State.channels[serverId] || []).filter(c => c.id !== channelId);
      UI.renderChannelList();
      if (State.currentChannelId === channelId) {
        const first = State.channels[serverId]?.[0];
        if (first) App.openChannel(first.id);
      }
    });
    State.socket.on('server_updated', (server) => {
      const idx = State.servers.findIndex(s => s.id === server.id);
      if (idx !== -1) State.servers[idx] = { ...State.servers[idx], ...server };
      if (server.id === State.currentServerId) UI.renderServerHeader();
      UI.renderServerIcons();
    });
    State.socket.on('server_deleted', ({ serverId }) => {
      State.servers = State.servers.filter(s => s.id !== serverId);
      UI.renderServerIcons();
      if (State.currentServerId === serverId) App.openDMMode();
    });
    State.socket.on('member_joined', ({ serverId, user }) => {
      if (serverId === State.currentServerId) { App.loadMembers(serverId); Toast.show(`${user.displayName} joined`, 'info'); }
    });
    State.socket.on('member_left', ({ serverId, userId }) => {
      if (serverId === State.currentServerId) App.loadMembers(serverId);
    });

    State.socket.on('new_dm', ({ dm, notification }) => {
      const partnerId = dm.senderId;
      if (!State.dmMessages[partnerId]) State.dmMessages[partnerId] = [];
      State.dmMessages[partnerId].push(dm);
      if (State.isDMMode && State.currentDMUserId === partnerId) { Renderer.appendDMMessage(dm); UI.scrollToBottom(); }
      else { Notifications.addUnreadDM(partnerId); UI.renderDMList(); }
      if (notification) Notifications.add(notification);
    });
    State.socket.on('notification', (notif) => Notifications.add(notif));
    State.socket.on('friend_request_received', ({ from, notification }) => {
      Toast.show(`Friend request from ${from.displayName}`, 'info', '👋');
      if (notification) Notifications.add(notification);
    });
    State.socket.on('friend_accepted', ({ user, notification }) => {
      Toast.show(`${user.displayName} accepted your request`, 'success', '✅');
      if (notification) Notifications.add(notification);
      App.loadFriends();
    });
    State.socket.on('slow_mode_cooldown', ({ channelId, remaining }) => {
      if (channelId === State.currentChannelId) UI.showSlowModeTimer(remaining);
    });
    State.socket.on('level_up', ({ newLevel, creditsAwarded }) => {
      UI.showLevelUp(newLevel, creditsAwarded);
      if (State.user) { State.user.level = newLevel; State.user.credits = (State.user.credits || 0) + creditsAwarded; }
      UI.renderUserBar();
    });
    State.socket.on('message_pinned', ({ messageId }) => {
      document.querySelector(`[data-msg-id="${messageId}"]`)?.classList.add('pinned-highlight');
    });
    State.socket.on('open_poll_modal', () => Modals.openPoll());
  },
};

/* ================================================================
   RENDERER
   ================================================================ */
const Renderer = {
  parseMarkdown(text) {
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
        let hl = code;
        try { hl = lang ? hljs.highlight(code.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>'), { language: lang }).value : hljs.highlightAuto(code).value; } catch {}
        return `<pre><button class="copy-code-btn" onclick="Renderer.copyCode(this)">Copy</button><code class="hljs">${hl}</code></pre>`;
      })
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/~~([^~]+)~~/g, '<del>$1</del>')
      .replace(/^> (.+)/gm, '<blockquote>$1</blockquote>')
      .replace(/(https?:\/\/[^\s<"]+)/g, (url) => {
        if (/\.(gif|jpg|jpeg|png|webp)(\?.*)?$/i.test(url)) return `<img class="msg-gif" src="${url}" loading="lazy" onclick="UI.openImageLightbox('${url}')"/>`;
        return `<a href="${url}" target="_blank" rel="noopener">${url}</a>`;
      })
      .replace(/!\[gif\]\((https?:\/\/[^\)]+)\)/g, '<img class="msg-gif" src="$1" loading="lazy"/>')
      .replace(/@(\w+)/g, '<span class="mention">@$1</span>')
      .replace(/#(\w[\w-]*)/g, '<span class="channel-ref">#$1</span>')
      .replace(/\n/g, '<br/>');
  },

  copyCode(btn) {
    const code = btn.nextElementSibling?.textContent || '';
    navigator.clipboard.writeText(code).then(() => { btn.textContent = 'Copied!'; setTimeout(() => btn.textContent = 'Copy', 2000); });
  },

  isEmojiOnly(text) {
    return /^[\p{Emoji_Presentation}\uFE0F\u200D\s]{1,8}$/u.test(text?.trim() || '');
  },

  getTagHTML(tag) {
    if (!tag) return '';
    const labels = { 'tag-fire': '🔥 FIRE', 'tag-legend': '💀 LEGEND', 'tag-vibe': '✨ VIBE', 'tag-royalty': '👑 ROYALTY', 'tag-galaxy': '🌌 GALAXY' };
    return `<span class="msg-tag ${tag}">${labels[tag] || tag}</span>`;
  },

  getRoleClass(role) {
    const map = { owner: 'role-owner', admin: 'role-admin', moderator: 'role-moderator' };
    return map[role] || 'role-member';
  },

  formatTime(ts) {
    const d = new Date(ts), now = new Date();
    const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
    const t = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (d.toDateString() === now.toDateString()) return `Today at ${t}`;
    if (d.toDateString() === yesterday.toDateString()) return `Yesterday at ${t}`;
    return `${d.toLocaleDateString()} ${t}`;
  },

  buildReactionsHTML(reactions) {
    if (!reactions?.length) return '';
    const grouped = {};
    for (const r of reactions) {
      if (!grouped[r.emoji]) grouped[r.emoji] = { count: 0, users: [], mine: false };
      grouped[r.emoji].count++;
      grouped[r.emoji].users.push(r.user?.displayName || '');
      if (r.user?.id === State.user?.id) grouped[r.emoji].mine = true;
    }
    return `<div class="message-reactions">${Object.entries(grouped).map(([e, d]) =>
      `<button class="reaction-pill${d.mine ? ' mine' : ''}" onclick="App.toggleReaction('${e}',this)" title="${d.users.join(', ')}">${e} <span class="reaction-count">${d.count}</span></button>`
    ).join('')}</div>`;
  },

  buildAttachmentsHTML(attachments) {
    if (!attachments?.length) return '';
    return attachments.map(a => {
      if (a.mimeType?.startsWith('image/')) return `<div class="msg-attachment"><img class="msg-image" src="${a.url}" loading="lazy" onclick="UI.openImageLightbox('${a.url}')"/></div>`;
      const size = a.size > 1048576 ? `${(a.size/1048576).toFixed(1)} MB` : `${Math.round(a.size/1024)} KB`;
      const icon = a.mimeType?.startsWith('video/') ? '🎬' : a.mimeType?.startsWith('audio/') ? '🎵' : a.mimeType === 'application/pdf' ? '📄' : '📎';
      return `<div class="msg-file"><span class="msg-file-icon">${icon}</span><div class="msg-file-info"><div class="msg-file-name">${a.filename}</div><div class="msg-file-size">${size}</div></div><a href="${a.url}" target="_blank" class="btn-secondary btn-sm">↓</a></div>`;
    }).join('');
  },

  buildPollHTML(poll) {
    if (!poll) return '';
    const total = poll.votes?.length || 0;
    const userVote = poll.votes?.find(v => v.userId === State.user?.id)?.optionId;
    const opts = poll.options.map(opt => {
      const pct = total > 0 ? Math.round((opt.voteCount / total) * 100) : 0;
      return `<div class="poll-option" onclick="App.votePoll('${poll.id}','${opt.id}')">
        <div class="poll-option-bar-wrap${userVote === opt.id ? ' voted' : ''}">
          <div class="poll-option-fill" style="width:${pct}%"></div>
          <span class="poll-option-label">${opt.text}</span>
          <span class="poll-option-pct">${pct}%</span>
        </div></div>`;
    }).join('');
    return `<div class="poll-card"><div class="poll-question">📊 ${poll.question}</div>${opts}<div class="poll-footer">${total} vote${total !== 1 ? 's' : ''}</div></div>`;
  },

  buildMessageHTML(msg, prevMsg) {
    if (msg.type === 'system') return `<div class="system-message" data-msg-id="${msg.id}">${this.parseMarkdown(msg.content)}</div>`;
    if (msg.type === 'announcement') return `<div class="announcement-msg" data-msg-id="${msg.id}">${this.parseMarkdown(msg.content)}</div>`;

    const author = msg.author || {};
    const sameAuthor = prevMsg && prevMsg.authorId === msg.authorId && !prevMsg.type &&
      (new Date(msg.createdAt) - new Date(prevMsg.createdAt)) < 420000;

    const reactionsHTML = this.buildReactionsHTML(msg.reactions);
    const attachHTML = this.buildAttachmentsHTML(msg.attachments);
    const pollHTML = this.buildPollHTML(msg.poll);
    const contentClass = this.isEmojiOnly(msg.content) ? 'msg-content emoji-only' : 'msg-content';
    const editedHTML = msg.editedAt ? ' <span class="msg-edited">(edited)</span>' : '';

    const replyHTML = msg.replyTo ? `<div class="reply-quote" onclick="UI.jumpToMessage('${msg.replyTo.id}')">
      <img src="${msg.replyTo.author?.avatarUrl || ''}" style="width:16px;height:16px;border-radius:50%;object-fit:cover"/>
      <span class="reply-quote-author">${msg.replyTo.author?.displayName || ''}</span>
      <span class="reply-quote-content">${(msg.replyTo.content || '').slice(0, 80)}</span>
    </div>` : '';

    const actionsHTML = `<div class="message-actions">
      <button class="msg-action-btn" title="React" onclick="EmojiPicker.openForMessage('${msg.id}',this)">😊</button>
      <button class="msg-action-btn" title="Reply" onclick="App.startReply('${msg.id}','${(author.displayName || '').replace(/'/g,"\\'")}')">↩</button>
      ${author.id === State.user?.id ? `<button class="msg-action-btn" onclick="App.startEdit('${msg.id}')">✏️</button><button class="msg-action-btn" onclick="App.deleteMessage('${msg.id}')">🗑️</button>` : ''}
      <button class="msg-action-btn" onclick="ContextMenu.onMessage(event,'${msg.id}')">⋯</button>
    </div>`;

    if (sameAuthor) {
      return `<div class="message-group compact" data-msg-id="${msg.id}" data-author="${author.id}" oncontextmenu="ContextMenu.onMessage(event,'${msg.id}')">
        <div class="msg-compact-time">${new Date(msg.createdAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</div>
        <div class="msg-body">${replyHTML}<div class="${contentClass}">${this.parseMarkdown(msg.content)}</div>${attachHTML}${pollHTML}${reactionsHTML}</div>
        ${actionsHTML}
      </div>`;
    }

    return `<div class="message-group" data-msg-id="${msg.id}" data-author="${author.id}" oncontextmenu="ContextMenu.onMessage(event,'${msg.id}')">
      <img class="msg-avatar ${author.equippedAvatarFx || ''}" src="${author.avatarUrl || ''}" alt="" onclick="Profile.open('${author.id}')" loading="lazy"/>
      <div class="msg-body">
        <div class="msg-header">
          <span class="msg-author ${this.getRoleClass(msg._role)}" onclick="Profile.open('${author.id}')">${author.displayName || 'Unknown'}</span>
          ${this.getTagHTML(author.equippedTag)}
          <span class="msg-timestamp">${this.formatTime(msg.createdAt)}</span>${editedHTML}
        </div>
        ${replyHTML}
        <div class="${contentClass}">${this.parseMarkdown(msg.content)}</div>
        ${attachHTML}${pollHTML}${reactionsHTML}
      </div>
      ${actionsHTML}
    </div>`;
  },

  appendMessage(msg, prepend = false) {
    const list = document.getElementById('messages-list');
    if (!list) return;
    const msgs = State.messages[State.currentChannelId] || [];
    const prevMsg = prepend ? null : msgs[msgs.length - 2];
    const html = this.buildMessageHTML(msg, prevMsg);
    const div = document.createElement('div');
    div.innerHTML = html;
    const el = div.firstElementChild;
    if (!el) return;
    if (prepend) list.prepend(el); else list.appendChild(el);
    hljs.highlightAll();
  },

  appendDMMessage(msg) {
    const list = document.getElementById('messages-list');
    if (!list) return;
    const author = msg.sender || msg.author || {};
    const isMe = author.id === State.user?.id;
    const div = document.createElement('div');
    div.innerHTML = `<div class="message-group${isMe ? ' dm-mine' : ''}" data-msg-id="${msg.id}">
      <img class="msg-avatar" src="${author.avatarUrl || ''}" onclick="Profile.open('${author.id}')" loading="lazy"/>
      <div class="msg-body">
        <div class="msg-header">
          <span class="msg-author">${author.displayName || 'Unknown'}</span>
          <span class="msg-timestamp">${this.formatTime(msg.createdAt)}</span>
        </div>
        <div class="msg-content">${this.parseMarkdown(msg.content)}</div>
      </div>
    </div>`;
    list.appendChild(div.firstElementChild);
  },

  updateMessage(msg) {
    const el = document.querySelector(`[data-msg-id="${msg.id}"]`);
    if (!el) return;
    const contentEl = el.querySelector('.msg-content');
    if (contentEl) {
      contentEl.innerHTML = this.parseMarkdown(msg.content);
      if (!el.querySelector('.msg-edited')) {
        el.querySelector('.msg-header')?.insertAdjacentHTML('beforeend', '<span class="msg-edited">(edited)</span>');
      }
    }
  },

  updateReactions(messageId, reactions) {
    const el = document.querySelector(`[data-msg-id="${messageId}"]`);
    if (!el) return;
    const existing = el.querySelector('.message-reactions');
    const html = this.buildReactionsHTML(reactions);
    if (existing) existing.outerHTML = html;
    else el.querySelector('.msg-body')?.insertAdjacentHTML('beforeend', html);
  },

  updatePoll(messageId, poll) {
    const el = document.querySelector(`[data-msg-id="${messageId}"]`);
    if (!el) return;
    const pollEl = el.querySelector('.poll-card');
    if (pollEl) pollEl.outerHTML = this.buildPollHTML(poll);
  },

  renderMessages(messages) {
    const list = document.getElementById('messages-list');
    if (!list) return;
    list.innerHTML = '';
    let prev = null;
    for (const msg of messages) {
      const html = this.buildMessageHTML(msg, prev);
      const div = document.createElement('div');
      div.innerHTML = html;
      if (div.firstElementChild) list.appendChild(div.firstElementChild);
      prev = msg;
    }
    hljs.highlightAll();
    UI.scrollToBottom();
  },
};

/* ================================================================
   UI HELPERS
   ================================================================ */
const UI = {
  showScreen(name) {
    document.getElementById('splash')?.classList.add('hidden');
    document.getElementById('auth-screen')?.classList.add('hidden');
    document.getElementById('app')?.classList.add('hidden');
    if (name === 'auth') { document.getElementById('auth-screen').classList.remove('hidden'); Particles.init('auth-particles'); }
    else if (name === 'app') document.getElementById('app').classList.remove('hidden');
  },

  renderUserBar() {
    const u = State.user;
    if (!u) return;
    const av = document.getElementById('user-bar-avatar');
    if (av) av.src = u.avatarUrl || '';
    const nameEl = document.getElementById('user-bar-name');
    if (nameEl) nameEl.textContent = u.displayName || u.username || '';
    const lvlEl = document.getElementById('user-bar-level');
    if (lvlEl) lvlEl.textContent = `Lv.${u.level || 1}`;
    const streakEl = document.getElementById('user-bar-streak');
    if (streakEl) streakEl.textContent = (u.streak || 0) > 1 ? `🔥${u.streak}` : '';
    const credEl = document.getElementById('user-bar-credits');
    if (credEl) credEl.textContent = `⭐ ${u.credits || 0} credits`;
    const xpPct = Math.min(((u.xp || 0) / ((u.level || 1) * 500)) * 100, 100);
    const xpBar = document.getElementById('user-bar-xp');
    if (xpBar) xpBar.style.width = xpPct + '%';
    const dot = document.getElementById('user-bar-status-dot');
    if (dot) dot.className = `status-dot ${u.status || 'online'}`;
  },

  renderServerIcons() {
    const list = document.getElementById('server-icons-list');
    if (!list) return;
    list.innerHTML = State.servers.map(s => {
      const active = s.id === State.currentServerId ? 'active-server-icon' : '';
      const inner = s.iconUrl
        ? `<img src="${s.iconUrl}" alt="${s.name}" style="width:100%;height:100%;border-radius:inherit;object-fit:cover"/>`
        : `<span style="font-size:12px;font-weight:800;text-align:center">${s.name.slice(0,2).toUpperCase()}</span>`;
      return `<div class="server-icon ${active}" title="${s.name}" data-server="${s.id}"
        onclick="App.switchServer('${s.id}')"
        oncontextmenu="ContextMenu.onServer(event,'${s.id}')">
        ${inner}
        <div class="server-unread-badge hidden" id="srv-badge-${s.id}"></div>
      </div>`;
    }).join('');
  },

  renderServerHeader() {
    const s = State.servers.find(s => s.id === State.currentServerId);
    if (!s) return;
    document.getElementById('panel-server-name').textContent = s.name;
    document.getElementById('panel-header-settings').style.display = '';
  },

  renderChannelList() {
    const list = document.getElementById('channel-list');
    if (!list) return;
    const channels = State.channels[State.currentServerId] || [];
    const cats = {};
    for (const ch of channels) { const c = ch.categoryName || 'General'; if (!cats[c]) cats[c] = []; cats[c].push(ch); }
    list.innerHTML = Object.entries(cats).map(([cat, chs]) => {
      const items = chs.map(ch => {
        const icon = ch.type === 'voice' ? '🔊' : '#';
        const active = ch.id === State.currentChannelId ? 'active' : '';
        return `<div class="channel-item ${active}" data-channel="${ch.id}"
          onclick="App.openChannel('${ch.id}')"
          oncontextmenu="ContextMenu.onChannel(event,'${ch.id}')">
          <span class="channel-icon">${icon}</span>
          <span class="channel-name">${ch.name}</span>
          <div class="channel-unread hidden" id="ch-unread-${ch.id}"></div>
        </div>`;
      }).join('');
      return `<div class="channel-category">▾ ${cat}</div><div>${items}</div>`;
    }).join('');
  },

  renderDMList() {
    const list = document.getElementById('channel-list');
    if (!list) return;
    if (!State.dmConversations.length) {
      list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:13px">No messages yet.<br/>Find a friend to start chatting!</div>';
      return;
    }
    list.innerHTML = State.dmConversations.map(conv => {
      const p = conv.partner;
      const active = State.isDMMode && State.currentDMUserId === p.id ? 'active' : '';
      const unread = conv.unread > 0 ? `<div class="dm-unread">${conv.unread}</div>` : '';
      const status = p.status || 'offline';
      return `<div class="dm-item ${active}" onclick="App.openDM('${p.id}')">
        <div style="position:relative;flex-shrink:0">
          <img class="dm-avatar" src="${p.avatarUrl || ''}" alt=""/>
          <div style="position:absolute;bottom:-1px;right:-1px;width:10px;height:10px;border-radius:50%;background:${status==='online'?'var(--green)':status==='away'?'var(--gold)':status==='dnd'?'var(--red)':'#555'};border:2px solid var(--panel)"></div>
        </div>
        <div class="dm-info">
          <div class="dm-name">${p.displayName}</div>
          <div class="dm-preview">${(conv.lastMessage?.content || '').slice(0, 40)}</div>
        </div>
        ${unread}
      </div>`;
    }).join('');
  },

  renderMembers(members) {
    const list = document.getElementById('members-list');
    if (!list) return;
    const roleOrder = { owner: 0, admin: 1, moderator: 2, member: 3 };
    const roleGroups = { owner: [], admin: [], moderator: [], member: [] };
    for (const m of members) roleGroups[m.role || 'member'].push(m);
    const roleLabels = { owner: '👑 Owner', admin: '🛡️ Admins', moderator: '🔧 Moderators', member: '👥 Members' };
    let online = 0;
    list.innerHTML = Object.entries(roleGroups).filter(([, arr]) => arr.length).map(([role, arr]) => {
      const items = arr.map(m => {
        const u = m.user; const st = u.status || 'offline';
        if (['online','away','dnd'].includes(st)) online++;
        return `<div class="member-item" id="member-item-${u.id}" onclick="Profile.open('${u.id}')">
          <img class="member-avatar ${u.equippedAvatarFx || ''}" src="${u.avatarUrl || ''}" id="m-av-${u.id}" loading="lazy"/>
          <span class="member-item-name">${u.displayName}</span>
          <span class="member-status ${st}" id="m-st-${u.id}"></span>
        </div>`;
      }).join('');
      return `<div class="member-role-section"><div class="member-role-header">${roleLabels[role]} — ${arr.length}</div>${items}</div>`;
    }).join('');
    const oc = document.getElementById('online-count');
    if (oc) oc.textContent = online;
  },

  updateMemberPresence(userId, status) {
    const dot = document.getElementById(`m-st-${userId}`);
    if (dot) dot.className = `member-status ${status || 'offline'}`;
  },

  renderTyping(channelId) {
    const el = document.getElementById('typing-indicator');
    if (!el) return;
    const names = Object.values(State.typingUsers[channelId] || {}).filter(Boolean);
    if (!names.length) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    const t = names.length === 1 ? `${names[0]} is typing` : names.length === 2 ? `${names[0]} and ${names[1]} are typing` : `${names[0]} and ${names.length - 1} others are typing`;
    el.innerHTML = `${t} <span class="typing-dots"><span>.</span><span>.</span><span>.</span></span>`;
  },

  incrementChannelUnread(channelId) {
    const el = document.getElementById(`ch-unread-${channelId}`);
    if (!el) return;
    el.textContent = (parseInt(el.textContent) || 0) + 1;
    el.classList.remove('hidden');
  },

  clearChannelUnread(channelId) {
    const el = document.getElementById(`ch-unread-${channelId}`);
    if (el) { el.textContent = ''; el.classList.add('hidden'); }
  },

  scrollToBottom() {
    const area = document.getElementById('messages-area');
    if (area) setTimeout(() => { area.scrollTop = area.scrollHeight; }, 50);
  },

  setChannelHeader(ch) {
    document.getElementById('channel-hash').textContent = ch?.type === 'voice' ? '🔊' : '#';
    document.getElementById('channel-header-name').textContent = ch?.name || '';
    document.getElementById('channel-header-topic').textContent = ch?.description || '';
    const inp = document.getElementById('message-input');
    if (inp) inp.dataset.placeholder = `Message #${ch?.name || ''}...`;
  },

  showSlowModeTimer(seconds) {
    let bar = document.getElementById('slow-mode-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'slow-mode-bar';
      bar.className = 'slow-mode-bar';
      document.getElementById('message-input-area')?.prepend(bar);
    }
    let r = seconds; State.slowModeCooldown = seconds;
    if (State.slowModeTimer) clearInterval(State.slowModeTimer);
    State.slowModeTimer = setInterval(() => {
      r--; bar.textContent = `⏱️ Slow mode: wait ${r}s`;
      if (r <= 0) { clearInterval(State.slowModeTimer); bar.remove(); State.slowModeCooldown = 0; }
    }, 1000);
    bar.textContent = `⏱️ Slow mode: wait ${r}s`;
  },

  showLevelUp(level, credits) {
    const popup = document.getElementById('levelup-popup');
    const sub = document.getElementById('levelup-sub');
    if (sub) sub.textContent = `You reached Level ${level}! +${credits} credits 🎉`;
    popup?.classList.remove('hidden');
    setTimeout(() => popup?.classList.add('hidden'), 4000);
  },

  openImageLightbox(url) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.92);display:flex;align-items:center;justify-content:center;z-index:99999;cursor:zoom-out';
    overlay.innerHTML = `<img src="${url}" style="max-width:90vw;max-height:90vh;border-radius:8px;object-fit:contain"/>`;
    overlay.onclick = () => overlay.remove();
    document.body.appendChild(overlay);
  },

  jumpToMessage(messageId) {
    const el = document.querySelector(`[data-msg-id="${messageId}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.style.background = 'rgba(124,58,237,.2)';
    setTimeout(() => el.style.background = '', 2000);
  },

  addUnreadDMBadge() {
    document.getElementById('dm-badge')?.classList.remove('hidden');
  },
};

/* ================================================================
   NOTIFICATIONS / TOAST / CONFIRM
   ================================================================ */
const Notifications = {
  unreadDMs: {},
  add(notif) { State.notifications.unshift(notif); this.updateBadge(); },
  addUnreadDM(userId) { this.unreadDMs[userId] = (this.unreadDMs[userId] || 0) + 1; UI.addUnreadDMBadge(); },
  updateBadge() {
    const unread = State.notifications.filter(n => !n.read).length;
    const badge = document.getElementById('notif-badge');
    if (badge) { badge.textContent = unread > 9 ? '9+' : unread; badge.classList.toggle('hidden', unread === 0); }
  },
  async load() {
    try { const n = await API.get('/api/notifications'); State.notifications = n || []; this.updateBadge(); } catch {}
  },
  renderPanel() {
    const list = document.getElementById('notif-list');
    if (!list) return;
    if (!State.notifications.length) { list.innerHTML = '<div class="notif-empty">All clear 🎉</div>'; return; }
    const icons = { mention: '💬', dm: '✉️', friend_request: '👋', friend_accepted: '✅', level_up: '⬆️' };
    list.innerHTML = State.notifications.slice(0, 30).map(n =>
      `<div class="notif-item${n.read ? '' : ' unread'}" onclick="Notifications.markRead('${n.id}')">
        <span class="notif-icon">${icons[n.type] || '🔔'}</span>
        <div class="notif-text">${Renderer.parseMarkdown(n.content)}</div>
        <span class="notif-time">${Renderer.formatTime(n.createdAt)}</span>
      </div>`).join('');
  },
  async markRead(id) {
    const n = State.notifications.find(x => x.id === id);
    if (n) n.read = true;
    try { await API.patch('/api/notifications/read', { ids: [id] }); } catch {}
    this.updateBadge(); this.renderPanel();
  },
  async markAllRead() {
    State.notifications.forEach(n => n.read = true);
    try { await API.patch('/api/notifications/read', {}); } catch {}
    this.updateBadge(); this.renderPanel();
  },
};

const Toast = {
  show(message, type = 'info', icon = null) {
    const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span class="toast-icon">${icon || icons[type]}</span><span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => { toast.classList.add('out'); setTimeout(() => toast.remove(), 300); }, 3500);
  },
};

const Confirm = {
  _resolve: null,
  show(title, message) {
    return new Promise(resolve => {
      this._resolve = resolve;
      document.getElementById('confirm-title').textContent = title;
      document.getElementById('confirm-message').textContent = message;
      document.getElementById('confirm-modal').classList.remove('hidden');
    });
  },
};

/* ================================================================
   MODALS
   ================================================================ */
const Modals = {
  openPoll() {
    document.getElementById('poll-question').value = '';
    const list = document.getElementById('poll-options-list');
    list.innerHTML = '';
    ['Option A', 'Option B'].forEach(p => this.addPollOption(p));
    document.getElementById('poll-modal').classList.remove('hidden');
  },
  addPollOption(placeholder = '') {
    const list = document.getElementById('poll-options-list');
    const div = document.createElement('div');
    div.className = 'poll-option-input';
    div.innerHTML = `<input type="text" placeholder="${placeholder || 'Option...'}" maxlength="100"/>
      <button class="poll-remove-btn" onclick="this.parentElement.remove()">✕</button>`;
    list.appendChild(div);
  },
  submitPoll() {
    const q = document.getElementById('poll-question').value.trim();
    if (!q) return Toast.show('Question required', 'error');
    const opts = [...document.querySelectorAll('#poll-options-list input')].map(i => i.value.trim()).filter(Boolean);
    if (opts.length < 2) return Toast.show('At least 2 options needed', 'error');
    Chat.sendPoll(q, opts);
    document.getElementById('poll-modal').classList.add('hidden');
  },
  openCreateServer() {
    ['server-name-input','server-desc-input','invite-code-input'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    document.getElementById('server-modal-error').textContent = '';
    document.getElementById('create-server-modal').classList.remove('hidden');
  },
  async openExplore() {
    document.getElementById('explore-modal').classList.remove('hidden');
    try {
      const servers = await API.get('/api/servers/explore');
      const grid = document.getElementById('explore-servers-grid');
      if (!servers?.length) { grid.innerHTML = '<p style="color:var(--text-muted);padding:20px;text-align:center">No public servers yet</p>'; return; }
      grid.innerHTML = servers.map(s => `<div class="explore-server-card" onclick="App.joinServerFromExplore('${s.inviteCode}')">
        <img class="explore-server-icon" src="${s.iconUrl || 'https://api.dicebear.com/7.x/shapes/svg?seed=' + s.id}" alt=""/>
        <div class="explore-server-name">${s.name}</div>
        <div class="explore-server-desc">${s.description || 'No description'}</div>
        <div class="explore-server-count">👥 ${s.memberCount || 0} members</div>
        ${s.joined ? '<div style="color:var(--green);font-size:12px;margin-top:6px">✓ Already joined</div>' : '<button class="btn-primary btn-sm" style="margin-top:8px;width:100%">Join</button>'}
      </div>`).join('');
    } catch (e) { Toast.show('Failed to load servers', 'error'); }
  },
  openSettings() {
    const u = State.user;
    if (!u) return;
    document.getElementById('settings-avatar-preview').src = u.avatarUrl || '';
    document.getElementById('settings-displayname').value = u.displayName || '';
    document.getElementById('settings-bio').value = u.bio || '';
    document.getElementById('settings-status').value = u.status || 'online';
    document.querySelectorAll('.theme-opt').forEach(b => b.classList.toggle('active', b.dataset.theme === State.theme));
    document.getElementById('settings-modal').classList.remove('hidden');
  },
  async saveSettings() {
    const fd = new FormData();
    fd.append('displayName', document.getElementById('settings-displayname').value);
    fd.append('bio', document.getElementById('settings-bio').value);
    fd.append('status', document.getElementById('settings-status').value);
    const file = document.getElementById('settings-avatar-file').files[0];
    if (file) fd.append('avatar', file);
    try {
      const user = await API.patchForm('/api/users/me', fd);
      State.user = { ...State.user, ...user };
      UI.renderUserBar();
      Toast.show('Settings saved!', 'success');
      document.getElementById('settings-modal').classList.add('hidden');
    } catch (e) { Toast.show(e.message, 'error'); }
  },
  openServerSettings() {
    const s = State.servers.find(s => s.id === State.currentServerId);
    if (!s) return;
    document.getElementById('server-settings-title').textContent = `⚙️ ${s.name}`;
    document.getElementById('server-settings-modal').classList.remove('hidden');
    ServerSettings.renderTab('overview');
  },
  openShop() {
    document.getElementById('shop-balance').textContent = `⭐ ${State.user?.credits || 0} cr`;
    State.shopItems = [];
    document.getElementById('shop-modal').classList.remove('hidden');
    Shop.loadItems('tag');
  },
};

/* ================================================================
   SERVER SETTINGS
   ================================================================ */
const ServerSettings = {
  renderTab(tab) {
    document.querySelectorAll('.ss-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    const body = document.getElementById('server-settings-body');
    const s = State.servers.find(s => s.id === State.currentServerId);
    switch (tab) {
      case 'overview':
        body.innerHTML = `<div class="form-group"><label>Server Name</label><input type="text" id="ss-name" value="${s?.name || ''}"/></div>
          <div class="form-group"><label>Description</label><input type="text" id="ss-desc" value="${s?.description || ''}"/></div>
          <div class="modal-footer"><button class="btn-primary" onclick="ServerSettings.saveOverview()">Save Changes</button></div>`;
        break;
      case 'members': this.loadMembersTab(body); break;
      case 'invites':
        body.innerHTML = `<p style="color:var(--text-muted);margin-bottom:12px">Share this code to invite friends:</p>
          <div class="input-btn-row">
            <input type="text" id="ss-invite-code" value="${s?.inviteCode || ''}" readonly/>
            <button class="btn-secondary" onclick="navigator.clipboard.writeText(document.getElementById('ss-invite-code').value);Toast.show('Copied!','success')">Copy</button>
            <button class="btn-secondary" onclick="ServerSettings.regenerateInvite()">🔄 New</button>
          </div>`;
        break;
      case 'bans': body.innerHTML = '<p style="color:var(--text-muted);padding:12px">No bans on record.</p>'; break;
      case 'audit': this.loadAuditLog(body); break;
    }
  },
  async saveOverview() {
    const name = document.getElementById('ss-name')?.value;
    const description = document.getElementById('ss-desc')?.value;
    try {
      const updated = await API.patch(`/api/servers/${State.currentServerId}`, { name, description });
      const idx = State.servers.findIndex(s => s.id === State.currentServerId);
      if (idx !== -1) State.servers[idx] = { ...State.servers[idx], ...updated };
      UI.renderServerHeader(); Toast.show('Server updated!', 'success');
    } catch (e) { Toast.show(e.message, 'error'); }
  },
  async loadMembersTab(body) {
    try {
      const members = await API.get(`/api/servers/${State.currentServerId}/members`);
      body.innerHTML = '<div style="display:flex;flex-direction:column;gap:8px">' + (members || []).map(m =>
        `<div style="display:flex;align-items:center;gap:10px;padding:10px;background:var(--panel-2);border-radius:var(--radius)">
          <img src="${m.user.avatarUrl || ''}" style="width:36px;height:36px;border-radius:50%;object-fit:cover"/>
          <div style="flex:1"><div style="font-weight:600">${m.user.displayName}</div><div style="font-size:12px;color:var(--text-muted)">@${m.user.username}</div></div>
          <select onchange="ServerSettings.changeRole('${m.userId}',this.value)" style="width:auto;padding:4px 8px;font-size:12px">
            <option value="admin" ${m.role==='admin'?'selected':''}>Admin</option>
            <option value="moderator" ${m.role==='moderator'?'selected':''}>Mod</option>
            <option value="member" ${m.role==='member'?'selected':''}>Member</option>
          </select>
          <button class="btn-danger btn-sm" onclick="ServerSettings.banUser('${m.userId}','${m.user.displayName}')">Ban</button>
        </div>`).join('') + '</div>';
    } catch { body.innerHTML = '<p style="color:var(--text-muted)">Failed to load members</p>'; }
  },
  async changeRole(userId, role) {
    try { await API.patch(`/api/servers/${State.currentServerId}/members/${userId}`, { role }); Toast.show('Role updated', 'success'); } catch (e) { Toast.show(e.message, 'error'); }
  },
  async banUser(userId, name) {
    const ok = await Confirm.show('Ban User', `Ban ${name} from this server?`);
    if (!ok) return;
    try { await API.post(`/api/servers/${State.currentServerId}/ban/${userId}`, {}); Toast.show(`${name} banned`, 'success'); } catch (e) { Toast.show(e.message, 'error'); }
  },
  async loadAuditLog(body) {
    try {
      const logs = await API.get(`/api/servers/${State.currentServerId}/audit-log`);
      body.innerHTML = '<div style="display:flex;flex-direction:column;gap:4px">' + (logs || []).map(l =>
        `<div style="padding:10px;background:var(--panel-2);border-radius:6px;font-size:12px">
          <strong>${l.actor?.displayName || 'Unknown'}</strong>: ${l.action}
          <span style="color:var(--text-muted);margin-left:8px">${Renderer.formatTime(l.createdAt)}</span>
        </div>`).join('') + '</div>';
    } catch { body.innerHTML = '<p style="color:var(--text-muted)">Failed to load audit log</p>'; }
  },
  async regenerateInvite() {
    try {
      const data = await API.post(`/api/servers/${State.currentServerId}/regenerate-invite`, {});
      const s = State.servers.find(s => s.id === State.currentServerId);
      if (s) s.inviteCode = data.inviteCode;
      const el = document.getElementById('ss-invite-code');
      if (el) el.value = data.inviteCode;
      Toast.show('New invite code generated', 'success');
    } catch (e) { Toast.show(e.message, 'error'); }
  },
};

/* ================================================================
   SHOP
   ================================================================ */
const Shop = {
  currentType: 'tag',
  async loadItems(type) {
    this.currentType = type;
    document.querySelectorAll('.shop-tab').forEach(b => b.classList.toggle('active', b.dataset.type === type));
    try {
      if (!State.shopItems.length) State.shopItems = await API.get('/api/shop/items') || [];
      const items = State.shopItems.filter(i => i.type === type);
      const grid = document.getElementById('shop-items-grid');
      if (!grid) return;
      grid.innerHTML = items.map(item => {
        const icon = { tag: '🏷️', banner: '🖼️', avatarFx: '✨', title: '📛' }[item.type] || '🎁';
        return `<div class="shop-item-card${item.owned ? ' owned' : ''} shop-item-rarity-${item.rarity}" id="shop-card-${item.id}">
          ${item.owned ? '<div class="shop-owned-badge">✓</div>' : ''}
          <div class="shop-item-icon">${icon}</div>
          <div class="shop-item-name">${item.name}</div>
          <div class="shop-item-desc">${item.description}</div>
          <div class="shop-item-price">${item.price === 0 ? 'FREE' : `⭐ ${item.price}`}</div>
          ${item.owned
            ? `<button class="btn-secondary btn-sm" onclick="Shop.equip('${item.id}')" style="width:100%">${item.isEquipped ? '✓ Equipped' : 'Equip'}</button>`
            : `<button class="btn-primary btn-sm" onclick="Shop.buy('${item.id}')" style="width:100%">Buy</button>`}
        </div>`;
      }).join('') || '<p style="color:var(--text-muted);padding:20px">No items in this category</p>';
    } catch (e) { Toast.show('Failed to load shop', 'error'); }
  },
  async buy(itemId) {
    const item = State.shopItems.find(i => i.id === itemId);
    if (!item) return;
    const ok = await Confirm.show('Purchase Item', `Buy "${item.name}" for ${item.price} credits?`);
    if (!ok) return;
    try {
      const data = await API.post(`/api/shop/buy/${itemId}`, {});
      if (State.user) State.user.credits = data.newBalance;
      UI.renderUserBar();
      document.getElementById('shop-balance').textContent = `⭐ ${data.newBalance} cr`;
      const i = State.shopItems.find(i => i.id === itemId);
      if (i) i.owned = true;
      Toast.show(`${item.name} purchased! 🎉`, 'success');
      this.loadItems(this.currentType);
    } catch (e) { Toast.show(e.message, 'error'); }
  },
  async equip(itemId) {
    try {
      await API.post(`/api/shop/equip/${itemId}`, {});
      const i = State.shopItems.find(i => i.id === itemId);
      if (i) { State.shopItems.filter(s => s.type === i.type).forEach(s => s.isEquipped = false); i.isEquipped = true; }
      Toast.show('Item equipped! ✨', 'success');
      this.loadItems(this.currentType);
    } catch (e) { Toast.show(e.message, 'error'); }
  },
};

/* ================================================================
   PROFILE
   ================================================================ */
const Profile = {
  async open(userId) {
    try {
      const u = await API.get(`/api/users/${userId}`);
      document.getElementById('profile-avatar').src = u.avatarUrl || '';
      document.getElementById('profile-displayname').textContent = u.displayName;
      document.getElementById('profile-username').textContent = `@${u.username}`;
      document.getElementById('profile-title').textContent = u.equippedTitle || '';
      document.getElementById('profile-bio').textContent = u.bio || 'No bio set.';
      const dot = document.getElementById('profile-status-dot');
      if (dot) dot.className = `profile-status-dot ${u.status || 'offline'}`;
      const xpPct = Math.min(((u.xp || 0) / ((u.level || 1) * 500)) * 100, 100);
      const xpBar = document.getElementById('profile-xp-bar');
      if (xpBar) xpBar.style.width = xpPct + '%';
      const lvlChip = document.getElementById('profile-level-badge');
      if (lvlChip) {
        lvlChip.textContent = `Level ${u.level || 1}`;
        const colors = ['grey','grey','grey','green','green','blue','blue','purple','purple','gold'];
        lvlChip.className = `profile-level-chip profile-level-${colors[Math.min(u.level || 1, 9)]}`;
      }
      const banner = document.getElementById('profile-banner');
      if (banner) banner.className = `profile-banner-area${u.equippedBanner ? ' ' + u.equippedBanner : ''}`;
      const meta = document.getElementById('profile-meta');
      if (meta) meta.innerHTML = `<span>🏆 ${u.mutualServers || 0} mutual servers</span><span>📅 Joined ${new Date(u.createdAt).toLocaleDateString()}</span>`;
      const actions = document.getElementById('profile-actions');
      if (actions) {
        if (userId === State.user?.id) {
          actions.innerHTML = `<button class="btn-secondary" onclick="Modals.openSettings();Profile.close()">✏️ Edit Profile</button>`;
        } else {
          const fs = u.friendshipStatus;
          if (!fs) {
            actions.innerHTML = `<button class="btn-primary" onclick="App.sendFriendRequest('${userId}')">👋 Add Friend</button>
              <button class="btn-secondary" onclick="App.openDM('${userId}');Profile.close()">💬 Message</button>`;
          } else if (fs === 'pending' && u.friendshipRequesterId === State.user?.id) {
            actions.innerHTML = `<button class="btn-secondary" disabled>Pending...</button>`;
          } else if (fs === 'pending') {
            actions.innerHTML = `<button class="btn-primary" onclick="App.acceptFriend('${userId}')">✅ Accept</button>
              <button class="btn-secondary" onclick="App.declineFriend('${userId}')">Decline</button>`;
          } else if (fs === 'accepted') {
            actions.innerHTML = `<button class="btn-secondary" onclick="App.openDM('${userId}');Profile.close()">💬 Message</button>
              <button class="btn-danger btn-sm" onclick="App.removeFriend('${userId}')">Unfriend</button>`;
          }
        }
      }
      document.getElementById('profile-modal').classList.remove('hidden');
    } catch { Toast.show('Failed to load profile', 'error'); }
  },
  close() { document.getElementById('profile-modal')?.classList.add('hidden'); },
};

/* ================================================================
   EMOJI PICKER
   ================================================================ */
const EmojiPicker = {
  categories: {
    '😊': ['😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','😉','😌','😍','🥰','😘','😋','😛','😝','🤪','😎','🥳','😏','😒','😞','😔','😟','😕','😢','😭','😤','😠','😡','🤬','🤯','😳','😱','😨','😰','😥','🤗','🤔','😶','😐','😬','🙄','😯','😮','🥱','😴','🤧','😷','🤒','🤕'],
    '🎮': ['🎮','🕹️','🎯','🎲','♟️','🎰','🎳','🏆','🥇','🥈','🥉','🏅','🚀','⚡','💥','🔥','💫','✨','🌟','⭐','🌈','💯','🎉','🎊','🎁','🎀','💎','🔮','🎭','🃏','⚔️','🛡️'],
    '🌍': ['🌍','🌎','🌏','🌐','🗺️','🧭','🌋','🏔️','🏕️','🏖️','🏜️','🏝️','🌅','🌄','🌠','🌃','🌉','🌌','⛅','🌤️','⛈️','🌧️','❄️','🌊','🌀'],
    '🍕': ['🍕','🍔','🌮','🌯','🥗','🥙','🍳','🥞','🍟','🌭','🍿','🍱','🍣','🍜','🍝','🍦','🍧','🍨','🍩','🍪','🎂','🍰','🧁','🍫','🍬','🍭','☕','🍵','🧃','🥤','🧋'],
    '❤️': ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','💕','💞','💓','💗','💖','💘','💝','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏'],
    '🐶': ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🙈','🙉','🙊','🐔','🐧','🐦','🦆','🦅','🦉','🦇','🐺','🐴','🦄','🐝','🐛','🦋','🐌','🐞','🐙','🦑','🦐','🦀','🐬','🐳','🐋','🦈'],
  },
  currentCat: '😊',
  target: 'input',
  targetMsgId: null,

  openForInput() {
    this.target = 'input'; this.targetMsgId = null;
    const picker = document.getElementById('emoji-picker');
    picker.style.cssText = 'position:fixed;bottom:88px;right:260px;';
    picker.classList.remove('hidden');
    this.renderCats(); this.renderEmoji(this.currentCat);
    document.getElementById('emoji-search').focus();
  },
  openForMessage(msgId, btn) {
    this.target = 'reaction'; this.targetMsgId = msgId;
    const picker = document.getElementById('emoji-picker');
    const rect = btn.getBoundingClientRect();
    picker.style.cssText = `position:fixed;left:${Math.min(rect.left,window.innerWidth-360)}px;top:${Math.max(rect.top-290,10)}px;`;
    picker.classList.remove('hidden');
    this.renderCats(); this.renderEmoji(this.currentCat);
  },
  renderCats() {
    const el = document.getElementById('emoji-categories');
    if (!el) return;
    el.innerHTML = Object.keys(this.categories).map(cat =>
      `<button class="emoji-cat-btn${cat===this.currentCat?' active':''}" onclick="EmojiPicker.renderEmoji('${cat}')">${cat}</button>`
    ).join('');
  },
  renderEmoji(cat) {
    this.currentCat = cat; this.renderCats();
    const grid = document.getElementById('emoji-grid');
    if (!grid) return;
    grid.innerHTML = (this.categories[cat] || []).map(e =>
      `<button class="emoji-btn" onclick="EmojiPicker.select('${e}')" onmouseenter="document.getElementById('emoji-name-preview').textContent='${e}'">${e}</button>`
    ).join('');
  },
  search(q) {
    if (!q) { this.renderEmoji(this.currentCat); return; }
    const all = Object.values(this.categories).flat();
    const grid = document.getElementById('emoji-grid');
    if (!grid) return;
    grid.innerHTML = all.filter(e => e.includes(q) || q.length < 2).slice(0, 64).map(e =>
      `<button class="emoji-btn" onclick="EmojiPicker.select('${e}')">${e}</button>`
    ).join('');
  },
  select(emoji) {
    if (this.target === 'reaction' && this.targetMsgId) {
      State.socket?.emit('add_reaction', { messageId: this.targetMsgId, emoji });
    } else {
      const input = document.getElementById('message-input');
      if (input) { input.focus(); document.execCommand('insertText', false, emoji); Chat.onInputChange(); }
    }
    this.close();
  },
  close() { document.getElementById('emoji-picker')?.classList.add('hidden'); },
};

/* ================================================================
   GIF PICKER
   ================================================================ */
const GifPicker = {
  async open() {
    const picker = document.getElementById('gif-picker');
    picker.style.cssText = 'position:fixed;bottom:88px;right:180px;';
    picker.classList.remove('hidden');
    await this.search('');
  },
  async search(q) {
    const key = 'dc6zaTOxFJmzC';
    const url = q
      ? `https://api.giphy.com/v1/gifs/search?api_key=${key}&q=${encodeURIComponent(q)}&limit=18&rating=g`
      : `https://api.giphy.com/v1/gifs/trending?api_key=${key}&limit=18&rating=g`;
    const grid = document.getElementById('gif-grid');
    if (!grid) return;
    try {
      const res = await fetch(url);
      const data = await res.json();
      grid.innerHTML = (data.data || []).map(g =>
        `<div class="gif-item" onclick="GifPicker.select('${g.images.original.url}')">
          <img src="${g.images.fixed_height_small.url}" loading="lazy"/>
        </div>`
      ).join('') || '<p style="padding:12px;color:var(--text-muted)">No results</p>';
    } catch { grid.innerHTML = '<p style="padding:12px;color:var(--text-muted)">Failed to load GIFs</p>'; }
  },
  select(url) {
    if (!State.currentChannelId && !State.currentDMUserId) return;
    if (State.isDMMode && State.currentDMUserId) {
      App.sendDM(`![gif](${url})`);
    } else {
      State.socket?.emit('send_message', { channelId: State.currentChannelId, content: `![gif](${url})`, token: State.token });
    }
    this.close();
  },
  close() { document.getElementById('gif-picker')?.classList.add('hidden'); },
};

/* ================================================================
   CONTEXT MENU
   ================================================================ */
const ContextMenu = {
  show(x, y, items) {
    const menu = document.getElementById('context-menu');
    const container = document.getElementById('context-menu-items');
    container.innerHTML = items.map(item => {
      if (item.divider) return '<div class="ctx-divider"></div>';
      return `<div class="ctx-item${item.danger ? ' danger' : ''}" onclick="ContextMenu.hide();(${item.fn})()">${item.icon || ''} ${item.label}</div>`;
    }).join('');
    menu.style.left = `${Math.min(x, window.innerWidth - 200)}px`;
    menu.style.top = `${Math.min(y, window.innerHeight - 200)}px`;
    menu.classList.remove('hidden');
    setTimeout(() => {
      const h = menu.offsetHeight;
      if (parseFloat(menu.style.top) + h > window.innerHeight) menu.style.top = `${window.innerHeight - h - 8}px`;
    }, 0);
  },
  hide() { document.getElementById('context-menu')?.classList.add('hidden'); },
  onMessage(e, msgId) {
    e.preventDefault();
    this.show(e.clientX, e.clientY, [
      { icon: '↩', label: 'Reply', fn: `() => App.startReply('${msgId}','')` },
      { icon: '😊', label: 'React', fn: `() => EmojiPicker.openForMessage('${msgId}', document.querySelector('[data-msg-id="${msgId}"] .msg-action-btn'))` },
      { icon: '📌', label: 'Pin', fn: `() => App.pinMessage('${msgId}')` },
      { divider: true },
      { icon: '✏️', label: 'Edit', fn: `() => App.startEdit('${msgId}')` },
      { icon: '🗑️', label: 'Delete', danger: true, fn: `() => App.deleteMessage('${msgId}')` },
    ]);
  },
  onChannel(e, channelId) {
    e.preventDefault();
    this.show(e.clientX, e.clientY, [
      { icon: '🗑️', label: 'Delete Channel', danger: true, fn: `() => App.deleteChannel('${channelId}')` },
    ]);
  },
  onServer(e, serverId) {
    e.preventDefault();
    this.show(e.clientX, e.clientY, [
      { icon: '⚙️', label: 'Settings', fn: `() => Modals.openServerSettings()` },
      { icon: '📋', label: 'Copy Invite', fn: `() => App.copyInvite('${serverId}')` },
      { divider: true },
      { icon: '🚪', label: 'Leave Server', danger: true, fn: `() => App.leaveServer('${serverId}')` },
    ]);
  },
};

/* ================================================================
   CHAT
   ================================================================ */
const Chat = {
  onInputChange() {
    const input = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');
    const counter = document.getElementById('char-counter');
    const text = input?.textContent || '';
    const len = text.length;
    if (sendBtn) sendBtn.classList.toggle('hidden', len === 0 && !State.pendingAttachment);
    if (counter) {
      counter.textContent = `${len} / 2000`;
      counter.classList.toggle('hidden', len < 1500);
      counter.classList.toggle('warn', len >= 1500 && len < 1900);
      counter.classList.toggle('error', len >= 1900);
    }
    if ((State.currentChannelId || State.currentDMUserId) && State.socket) {
      State.socket.emit('start_typing', { channelId: State.currentChannelId });
    }
  },
  send() {
    const input = document.getElementById('message-input');
    const content = input?.textContent?.trim() || '';
    if (!content && !State.pendingAttachment) return;
    if (!State.socket) { Toast.show('Not connected', 'error'); return; }
    if (!State.currentChannelId) { Toast.show('No channel selected', 'warning'); return; }
    if (State.slowModeCooldown > 0) { Toast.show(`Slow mode active: wait ${State.slowModeCooldown}s`, 'warning'); return; }
    const msgData = {
      channelId: State.currentChannelId,
      content: content.slice(0, 2000),
      replyToId: State.replyingTo?.id || null,
      token: State.token,
    };
    if (State.pendingAttachment) {
      msgData.attachments = [State.pendingAttachment];
      State.pendingAttachment = null;
      document.getElementById('attach-preview')?.remove();
    }
    State.socket.emit('send_message', msgData);
    if (input) input.textContent = '';
    this.onInputChange();
    State.socket.emit('stop_typing', { channelId: State.currentChannelId });
    if (State.replyingTo) { State.replyingTo = null; document.getElementById('reply-banner')?.classList.add('hidden'); }
  },
  sendPoll(question, options) {
    if (!State.socket || !State.currentChannelId) return;
    State.socket.emit('send_message', { channelId: State.currentChannelId, content: '', pollData: { question, options }, token: State.token });
  },
  async uploadFile(file) {
    const fd = new FormData();
    fd.append('file', file);
    try {
      const data = await API.postForm('/api/messages/upload', fd);
      State.pendingAttachment = data;
      Toast.show(`${file.name} ready`, 'success', '📎');
      this.onInputChange();
      let preview = document.getElementById('attach-preview');
      if (!preview) {
        preview = document.createElement('div');
        preview.id = 'attach-preview';
        preview.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--panel-3);border-radius:var(--radius);margin-bottom:4px;font-size:12px;color:var(--text-muted)';
        document.getElementById('message-input-area')?.prepend(preview);
      }
      preview.innerHTML = `📎 ${file.name} <button onclick="State.pendingAttachment=null;this.parentElement.remove()" style="margin-left:auto;color:var(--red)">✕</button>`;
    } catch { Toast.show('Upload failed', 'error'); }
  },
};

/* ================================================================
   APP — main orchestration
   ================================================================ */
const App = {
  async init() {
    Splash.show();
    await new Promise(r => setTimeout(r, 1400));
    Splash.hide();
    const hasToken = Auth.init();
    if (hasToken) {
      const ok = await Auth.tryAutoLogin();
      if (ok) { await this.loadApp(); return; }
    }
    UI.showScreen('auth');
  },

  async loadApp() {
    UI.showScreen('app');
    UI.renderUserBar();
    SocketManager.connect();
    const savedTheme = localStorage.getItem('vibe_theme') || 'dark';
    State.theme = savedTheme;
    document.documentElement.dataset.theme = savedTheme;
    await Promise.allSettled([this.loadServers(), this.loadDMConversations(), Notifications.load(), this.loadFriends()]);
    this.openDMMode();
    if (!localStorage.getItem('vibe_onboarded') && State.user) setTimeout(() => Onboarding.start(), 800);
    this.bindKeyboardShortcuts();
  },

  async loadServers() {
    try { const s = await API.get('/api/servers'); State.servers = s || []; UI.renderServerIcons(); } catch {}
  },

  async loadDMConversations() {
    try { const d = await API.get('/api/dm'); State.dmConversations = d || []; } catch {}
  },

  async loadFriends() {
    try { const f = await API.get('/api/friends'); State.friends = f || []; } catch {}
  },

  openDMMode() {
    State.isDMMode = true; State.currentServerId = null; State.currentChannelId = null;
    document.querySelectorAll('.server-icon').forEach(el => el.classList.remove('active-server-icon'));
    document.getElementById('dm-icon')?.classList.add('active-server-icon');
    document.getElementById('panel-server-name').textContent = 'Direct Messages';
    document.getElementById('panel-header-settings').style.display = 'none';
    document.getElementById('channel-header-name').textContent = 'Welcome to VIBE ✦';
    document.getElementById('channel-header-topic').textContent = 'Select a conversation or server to start chatting';
    document.getElementById('channel-hash').textContent = '💬';
    document.getElementById('messages-list').innerHTML = this.buildWelcomeHTML();
    document.getElementById('members-list').innerHTML = '';
    document.getElementById('online-count').textContent = '0';
    UI.renderDMList();
  },

  buildWelcomeHTML() {
    return `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:400px;padding:40px;text-align:center">
      <div style="font-size:72px;margin-bottom:16px;animation:pulseGlow 2s ease infinite">✦</div>
      <h2 style="font-family:var(--font-display);font-size:32px;font-weight:800;background:linear-gradient(135deg,var(--purple-light),var(--cyan));-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:12px">Welcome to VIBE</h2>
      <p style="color:var(--text-muted);max-width:400px;line-height:1.7">The next generation of communication is here.<br/>Join a server or send a direct message to get started.</p>
      <div style="display:flex;gap:12px;margin-top:24px">
        <button class="btn-primary" onclick="Modals.openExplore()" style="width:auto;padding:10px 24px">🌐 Explore Servers</button>
        <button class="btn-secondary" onclick="Modals.openCreateServer()" style="padding:10px 24px">+ Create Server</button>
      </div>
    </div>`;
  },

  async switchServer(serverId) {
    if (State.currentServerId === serverId) return;
    State.isDMMode = false; State.currentServerId = serverId;
    document.querySelectorAll('.server-icon').forEach(el => el.classList.remove('active-server-icon'));
    document.querySelector(`[data-server="${serverId}"]`)?.classList.add('active-server-icon');
    UI.renderServerHeader();
    if (!State.channels[serverId]) {
      try { const ch = await API.get(`/api/channels/server/${serverId}`); State.channels[serverId] = ch || []; } catch {}
    }
    UI.renderChannelList();
    await this.loadMembers(serverId);
    State.socket?.emit('join_server', { serverId });
    const first = State.channels[serverId]?.find(c => c.type === 'text');
    if (first) this.openChannel(first.id);
  },

  async loadMembers(serverId) {
    try { const m = await API.get(`/api/servers/${serverId}/members`); State.members[serverId] = m || []; UI.renderMembers(m); } catch {}
  },

  async openChannel(channelId) {
    State.currentChannelId = channelId; State.hasMoreMessages = true; State.loadingMessages = false;
    const ch = State.channels[State.currentServerId]?.find(c => c.id === channelId);
    UI.setChannelHeader(ch); UI.clearChannelUnread(channelId);
    document.querySelectorAll('.channel-item').forEach(el => el.classList.toggle('active', el.dataset.channel === channelId));
    State.socket?.emit('join_channel', { channelId });
    document.getElementById('messages-list').innerHTML = '<div style="padding:30px;text-align:center;color:var(--text-muted)">Loading messages...</div>';
    try {
      const msgs = await API.get(`/api/channels/${channelId}/messages?limit=50`);
      State.messages[channelId] = msgs || [];
      Renderer.renderMessages(msgs);
    } catch { document.getElementById('messages-list').innerHTML = '<div style="padding:30px;text-align:center;color:var(--red)">Failed to load messages</div>'; }
    document.getElementById('message-input-area').classList.remove('hidden');
  },

  async loadMoreMessages() {
    if (!State.hasMoreMessages || State.loadingMessages || !State.currentChannelId) return;
    const msgs = State.messages[State.currentChannelId] || [];
    if (!msgs.length) return;
    State.loadingMessages = true;
    try {
      const area = document.getElementById('messages-area');
      const oldHeight = area.scrollHeight;
      const older = await API.get(`/api/channels/${State.currentChannelId}/messages?before=${msgs[0].createdAt}&limit=50`);
      if (!older || older.length < 50) State.hasMoreMessages = false;
      for (const msg of [...(older || [])].reverse()) Renderer.appendMessage(msg, true);
      area.scrollTop = area.scrollHeight - oldHeight;
      State.messages[State.currentChannelId] = [...(older || []), ...msgs];
    } catch {}
    State.loadingMessages = false;
  },

  async openDM(userId) {
    State.isDMMode = true; State.currentDMUserId = userId; State.currentChannelId = null;
    const conv = State.dmConversations.find(c => c.partner.id === userId);
    const partner = conv?.partner || { id: userId, displayName: userId };
    document.getElementById('channel-header-name').textContent = partner.displayName;
    document.getElementById('channel-hash').textContent = '💬';
    document.getElementById('channel-header-topic').textContent = 'Direct Message';
    document.getElementById('message-input').dataset.placeholder = `Message ${partner.displayName}...`;
    document.getElementById('message-input-area').classList.remove('hidden');
    UI.renderDMList();
    document.getElementById('messages-list').innerHTML = '<div style="padding:30px;text-align:center;color:var(--text-muted)">Loading...</div>';
    try {
      const msgs = await API.get(`/api/dm/${userId}?limit=50`);
      State.dmMessages[userId] = msgs || [];
      document.getElementById('messages-list').innerHTML = '';
      for (const msg of msgs) Renderer.appendDMMessage(msg);
      UI.scrollToBottom();
    } catch {}
  },

  async sendDM(content) {
    if (!State.currentDMUserId || !content.trim()) return;
    try {
      const msg = await API.post(`/api/dm/${State.currentDMUserId}`, { content });
      Renderer.appendDMMessage(msg); UI.scrollToBottom();
    } catch (e) { Toast.show(e.message, 'error'); }
  },

  startReply(messageId, authorName) {
    const el = document.querySelector(`[data-msg-id="${messageId}"]`);
    const displayName = authorName || el?.querySelector('.msg-author')?.textContent || 'Unknown';
    State.replyingTo = { id: messageId, authorName: displayName };
    document.getElementById('reply-banner-text').textContent = `Replying to ${displayName}`;
    document.getElementById('reply-banner').classList.remove('hidden');
    document.getElementById('message-input').focus();
  },

  cancelReply() {
    State.replyingTo = null;
    document.getElementById('reply-banner')?.classList.add('hidden');
  },

  startEdit(messageId) {
    const el = document.querySelector(`[data-msg-id="${messageId}"]`);
    if (!el) return;
    const contentEl = el.querySelector('.msg-content');
    if (!contentEl) return;
    const original = contentEl.textContent || '';
    const ta = document.createElement('textarea');
    ta.className = 'msg-inline-edit'; ta.value = original; ta.rows = 2;
    contentEl.replaceWith(ta); ta.focus();
    ta.onkeydown = async (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        try {
          await API.patch(`/api/messages/${messageId}`, { content: ta.value });
          const div = document.createElement('div');
          div.className = 'msg-content';
          div.innerHTML = Renderer.parseMarkdown(ta.value);
          ta.replaceWith(div);
        } catch (e) { Toast.show(e.message, 'error'); ta.replaceWith(contentEl); }
      }
      if (e.key === 'Escape') ta.replaceWith(contentEl);
    };
  },

  async deleteMessage(messageId) {
    const ok = await Confirm.show('Delete Message', 'Are you sure? This cannot be undone.');
    if (!ok) return;
    try { await API.delete(`/api/messages/${messageId}`); } catch (e) { Toast.show(e.message, 'error'); }
  },

  toggleReaction(emoji, btn) {
    const el = btn.closest('[data-msg-id]');
    if (el) State.socket?.emit('add_reaction', { messageId: el.dataset.msgId, emoji });
  },

  votePoll(pollId, optionId) { State.socket?.emit('poll_vote', { pollId, optionId }); },

  async pinMessage(messageId) {
    try { await API.post(`/api/channels/${State.currentChannelId}/pins/${messageId}`, {}); Toast.show('Message pinned 📌', 'success'); } catch (e) { Toast.show(e.message, 'error'); }
  },

  async loadPins() {
    const panel = document.getElementById('pins-panel');
    const list = document.getElementById('pins-list');
    panel.classList.toggle('hidden');
    State.pinsVisible = !State.pinsVisible;
    if (!State.pinsVisible) return;
    try {
      const pins = await API.get(`/api/channels/${State.currentChannelId}/pins`);
      list.innerHTML = (pins || []).map(m => `<div class="pin-item">
        <div class="pin-item-header">
          <img class="pin-item-avatar" src="${m.author?.avatarUrl || ''}"/>
          <span class="pin-item-author">${m.author?.displayName}</span>
          <span class="pin-item-time">${Renderer.formatTime(m.createdAt)}</span>
        </div>
        <div class="pin-item-content">${(m.content || '').slice(0, 120)}</div>
        <div class="pin-item-unpin" onclick="App.unpinMessage('${m.id}')">Unpin</div>
      </div>`).join('') || '<div style="padding:16px;color:var(--text-muted)">No pinned messages</div>';
    } catch {}
  },

  async unpinMessage(messageId) {
    try { await API.delete(`/api/channels/${State.currentChannelId}/pins/${messageId}`); Toast.show('Unpinned', 'success'); this.loadPins(); } catch (e) { Toast.show(e.message, 'error'); }
  },

  async searchMessages(query) {
    if (!State.currentChannelId || !query) return;
    try {
      const results = await API.get(`/api/channels/${State.currentChannelId}/search?q=${encodeURIComponent(query)}`);
      const container = document.getElementById('search-results');
      if (!results?.length) { container.innerHTML = '<div style="padding:12px;color:var(--text-muted);font-size:13px">No results found</div>'; return; }
      container.innerHTML = results.map(m => `<div class="search-result-item" onclick="UI.jumpToMessage('${m.id}');document.getElementById('search-overlay').classList.add('hidden')">
        <div class="search-result-meta">${m.author?.displayName} — ${Renderer.formatTime(m.createdAt)}</div>
        <div>${(m.content || '').slice(0, 120)}</div>
      </div>`).join('');
    } catch {}
  },

  async createServer() {
    const name = document.getElementById('server-name-input')?.value.trim();
    const description = document.getElementById('server-desc-input')?.value.trim();
    const isPublic = document.getElementById('server-public-input')?.checked;
    const iconFile = document.getElementById('server-icon-file')?.files[0];
    if (!name) { document.getElementById('server-modal-error').textContent = 'Name required'; return; }
    const fd = new FormData();
    fd.append('name', name); fd.append('description', description || ''); fd.append('isPublic', isPublic);
    if (iconFile) fd.append('icon', iconFile);
    try {
      const server = await API.postForm('/api/servers', fd);
      State.servers.push(server); UI.renderServerIcons();
      document.getElementById('create-server-modal').classList.add('hidden');
      await this.switchServer(server.id);
      Toast.show(`${server.name} created! ✦`, 'success');
    } catch (e) { document.getElementById('server-modal-error').textContent = e.message; }
  },

  async joinServer(code) {
    const inviteCode = code || document.getElementById('invite-code-input')?.value.trim();
    if (!inviteCode) return;
    try {
      const server = await API.post(`/api/servers/join/${inviteCode}`, {});
      if (!State.servers.find(s => s.id === server.id)) State.servers.push(server);
      UI.renderServerIcons();
      document.getElementById('create-server-modal').classList.add('hidden');
      await this.switchServer(server.id);
      Toast.show(`Joined ${server.name}! 🎉`, 'success');
    } catch (e) { document.getElementById('server-modal-error').textContent = e.message; Toast.show(e.message, 'error'); }
  },

  async joinServerFromExplore(inviteCode) {
    try {
      const server = await API.post(`/api/servers/join/${inviteCode}`, {});
      if (!State.servers.find(s => s.id === server.id)) State.servers.push(server);
      UI.renderServerIcons();
      document.getElementById('explore-modal').classList.add('hidden');
      await this.switchServer(server.id);
      Toast.show(`Joined ${server.name}! 🎉`, 'success');
    } catch (e) { Toast.show(e.message, 'error'); }
  },

  async leaveServer(serverId) {
    const server = State.servers.find(s => s.id === serverId);
    const ok = await Confirm.show('Leave Server', `Leave ${server?.name}?`);
    if (!ok) return;
    try {
      await API.post(`/api/servers/${serverId}/leave`, {});
      State.servers = State.servers.filter(s => s.id !== serverId);
      UI.renderServerIcons(); this.openDMMode();
      Toast.show('Left server', 'info');
    } catch (e) { Toast.show(e.message, 'error'); }
  },

  async deleteChannel(channelId) {
    const ok = await Confirm.show('Delete Channel', 'Permanently delete this channel and all messages?');
    if (!ok) return;
    try { await API.delete(`/api/channels/${channelId}`); } catch (e) { Toast.show(e.message, 'error'); }
  },

  async copyInvite(serverId) {
    const s = State.servers.find(s => s.id === serverId);
    if (!s?.inviteCode) return;
    await navigator.clipboard.writeText(s.inviteCode);
    Toast.show('Invite code copied! 📋', 'success');
  },

  async sendFriendRequest(userId) {
    try { await API.post(`/api/friends/request/${userId}`, {}); Toast.show('Friend request sent! 👋', 'success'); Profile.close(); } catch (e) { Toast.show(e.message, 'error'); }
  },

  async acceptFriend(userId) {
    try { await API.post(`/api/friends/accept/${userId}`, {}); Toast.show('Friend added! ✅', 'success'); Profile.close(); this.loadFriends(); } catch (e) { Toast.show(e.message, 'error'); }
  },

  async declineFriend(userId) {
    try { await API.post(`/api/friends/decline/${userId}`, {}); Profile.close(); } catch {}
  },

  async removeFriend(userId) {
    try { await API.delete(`/api/friends/${userId}`); Toast.show('Unfriended', 'info'); Profile.close(); this.loadFriends(); } catch (e) { Toast.show(e.message, 'error'); }
  },

  bindKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        ContextMenu.hide(); EmojiPicker.close(); GifPicker.close();
        document.querySelectorAll('.modal-overlay:not(.hidden)').forEach(m => m.classList.add('hidden'));
        document.getElementById('notif-panel')?.classList.add('hidden');
        document.getElementById('search-overlay')?.classList.add('hidden');
        document.getElementById('pins-panel')?.classList.add('hidden');
        State.pinsVisible = false;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        const o = document.getElementById('search-overlay');
        o.classList.toggle('hidden');
        if (!o.classList.contains('hidden')) document.getElementById('search-input').focus();
      }
      if (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        const chs = (State.channels[State.currentServerId] || []).filter(c => c.type === 'text');
        const idx = chs.findIndex(c => c.id === State.currentChannelId);
        const next = e.key === 'ArrowDown' ? chs[idx + 1] : chs[idx - 1];
        if (next) this.openChannel(next.id);
      }
    });
  },
};

/* ================================================================
   ONBOARDING
   ================================================================ */
const Onboarding = {
  start() {
    document.getElementById('onboarding-step-1').classList.remove('hidden');
    ['2','3','4'].forEach(n => document.getElementById(`onboarding-step-${n}`)?.classList.add('hidden'));
    document.getElementById('onboarding-modal').classList.remove('hidden');
    const av = document.getElementById('onboarding-avatar');
    if (av) av.src = State.user?.avatarUrl || '';
  },
  nextStep(from, to) {
    document.getElementById(`onboarding-step-${from}`)?.classList.add('hidden');
    document.getElementById(`onboarding-step-${to}`)?.classList.remove('hidden');
    if (to === 3) this.loadServers();
    if (to === 4) this.launchConfetti();
  },
  async loadServers() {
    try {
      const servers = await API.get('/api/servers/explore');
      const container = document.getElementById('onboarding-servers');
      if (!container) return;
      container.innerHTML = (servers || []).slice(0, 6).map(s => `<div class="onboarding-server-card" id="ob-srv-${s.id}" onclick="Onboarding.joinServer('${s.inviteCode}','${s.id}')">
        <strong>${s.name}</strong>
        <div style="font-size:11px;color:var(--text-muted)">${s.memberCount || 0} members</div>
      </div>`).join('');
    } catch {}
  },
  async joinServer(inviteCode, serverId) {
    try {
      await App.joinServer(inviteCode);
      const el = document.getElementById(`ob-srv-${serverId}`);
      if (el) { el.classList.add('joined'); el.insertAdjacentHTML('beforeend', '<div style="font-size:11px;color:var(--green)">✓ Joined</div>'); }
    } catch {}
  },
  launchConfetti() {
    const canvas = document.getElementById('confetti-canvas');
    if (!canvas) return;
    canvas.width = canvas.offsetWidth || 400; canvas.height = canvas.offsetHeight || 400;
    const ctx = canvas.getContext('2d');
    const pieces = Array.from({ length: 100 }, () => ({
      x: Math.random() * canvas.width, y: Math.random() * -canvas.height,
      r: Math.random() * 7 + 3, d: Math.random() * 100,
      color: `hsl(${Math.random()*360},80%,60%)`,
      tiltAngle: 0, tiltInc: Math.random() * 0.07 + 0.05,
    }));
    let frame;
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      pieces.forEach(p => {
        p.tiltAngle += p.tiltInc; p.y += Math.cos(p.d) + 1 + p.r / 2;
        const tilt = Math.sin(p.tiltAngle) * 12;
        ctx.beginPath(); ctx.lineWidth = p.r; ctx.strokeStyle = p.color;
        ctx.moveTo(p.x + tilt + p.r / 4, p.y); ctx.lineTo(p.x + tilt, p.y + tilt + p.r);
        ctx.stroke();
        if (p.y > canvas.height) { p.x = Math.random() * canvas.width; p.y = -10; }
      });
      frame = requestAnimationFrame(draw);
    };
    draw(); setTimeout(() => cancelAnimationFrame(frame), 5000);
  },
  finish() { document.getElementById('onboarding-modal')?.classList.add('hidden'); localStorage.setItem('vibe_onboarded', '1'); },
};

/* ================================================================
   EVENT BINDING (DOM Ready)
   ================================================================ */
document.addEventListener('DOMContentLoaded', () => {

  /* --- AUTH TABS --- */
  document.querySelectorAll('.auth-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.auth-tab').forEach(b => b.classList.toggle('active', b === btn));
      document.getElementById('login-form').classList.toggle('hidden', tab !== 'login');
      document.getElementById('register-form').classList.toggle('hidden', tab !== 'register');
    });
  });

  /* --- LOGIN --- */
  const doLogin = async () => {
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    const errEl = document.getElementById('login-error');
    const btn = document.getElementById('login-btn');
    if (!username || !password) { errEl.textContent = 'Fill in all fields'; return; }
    btn.disabled = true;
    btn.querySelector('.btn-text')?.classList.add('hidden');
    btn.querySelector('.btn-spinner')?.classList.remove('hidden');
    try {
      await Auth.login(username, password);
      await App.loadApp();
    } catch (e) {
      errEl.textContent = e.message;
      document.getElementById('login-form').classList.add('shake');
      setTimeout(() => document.getElementById('login-form').classList.remove('shake'), 400);
    } finally {
      btn.disabled = false;
      btn.querySelector('.btn-text')?.classList.remove('hidden');
      btn.querySelector('.btn-spinner')?.classList.add('hidden');
    }
  };
  document.getElementById('login-btn').addEventListener('click', doLogin);
  document.getElementById('login-password').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

  /* --- REGISTER AVATAR UPLOAD --- */
  document.getElementById('avatar-upload-area').addEventListener('click', () => document.getElementById('avatar-file-input').click());
  document.getElementById('avatar-file-input').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => { document.getElementById('avatar-preview').src = ev.target.result; };
    reader.readAsDataURL(file);
  });

  /* --- USERNAME CHECK --- */
  let usernameTimer;
  document.getElementById('reg-username').addEventListener('input', e => {
    clearTimeout(usernameTimer);
    const val = e.target.value;
    const status = document.getElementById('username-status');
    if (val.length < 3) { status.textContent = ''; return; }
    usernameTimer = setTimeout(async () => {
      try {
        const data = await fetch(`/api/auth/check-username?username=${val}`).then(r => r.json());
        status.textContent = data.available ? '✅' : '❌ taken';
        status.style.color = data.available ? 'var(--green)' : 'var(--red)';
      } catch {}
    }, 450);
  });

  /* --- PASSWORD STRENGTH --- */
  document.getElementById('reg-password').addEventListener('input', e => {
    const p = e.target.value;
    const bar = document.getElementById('password-strength');
    if (!bar) return;
    bar.className = 'password-strength';
    if (!p.length) return;
    if (p.length < 6) bar.classList.add('strength-1');
    else if (p.length < 10) bar.classList.add('strength-2');
    else if (p.length < 14) bar.classList.add('strength-3');
    else bar.classList.add('strength-4');
  });

  /* --- REGISTER --- */
  const doRegister = async () => {
    const displayName = document.getElementById('reg-displayname').value.trim();
    const username = document.getElementById('reg-username').value.trim();
    const password = document.getElementById('reg-password').value;
    const email = document.getElementById('reg-email').value.trim();
    const errEl = document.getElementById('reg-error');
    const btn = document.getElementById('register-btn');
    if (!displayName || !username || !password) { errEl.textContent = 'Fill in required fields'; return; }
    if (username.length < 3) { errEl.textContent = 'Username too short (min 3 chars)'; return; }
    if (password.length < 6) { errEl.textContent = 'Password too short (min 6 chars)'; return; }
    btn.disabled = true;
    btn.querySelector('.btn-text')?.classList.add('hidden');
    btn.querySelector('.btn-spinner')?.classList.remove('hidden');
    const fd = new FormData();
    fd.append('username', username);
    fd.append('displayName', displayName);
    fd.append('password', password);
    if (email) fd.append('email', email);
    const avatarFile = document.getElementById('avatar-file-input').files[0];
    if (avatarFile) fd.append('avatar', avatarFile);
    try {
      await Auth.register(fd);
      await App.loadApp();
    } catch (e) {
      errEl.textContent = e.message;
    } finally {
      btn.disabled = false;
      btn.querySelector('.btn-text')?.classList.remove('hidden');
      btn.querySelector('.btn-spinner')?.classList.add('hidden');
    }
  };
  document.getElementById('register-btn').addEventListener('click', doRegister);

  /* --- LOGOUT --- */
  document.getElementById('logout-btn').addEventListener('click', () => Auth.logout());

  /* --- SERVER SIDEBAR ICONS --- */
  document.getElementById('dm-icon').addEventListener('click', () => App.openDMMode());
  document.getElementById('explore-icon').addEventListener('click', () => Modals.openExplore());
  document.getElementById('add-server-btn').addEventListener('click', () => Modals.openCreateServer());

  /* --- PANEL HEADER --- */
  document.getElementById('panel-header-settings').addEventListener('click', () => Modals.openServerSettings());

  /* --- CREATE SERVER MODAL --- */
  document.getElementById('create-server-close').addEventListener('click', () => document.getElementById('create-server-modal').classList.add('hidden'));
  document.getElementById('submit-create-server-btn').addEventListener('click', () => App.createServer());
  document.getElementById('join-server-btn').addEventListener('click', () => App.joinServer());
  document.getElementById('invite-code-input').addEventListener('keydown', e => { if (e.key === 'Enter') App.joinServer(); });
  document.getElementById('server-icon-pick-btn')?.addEventListener('click', () => document.getElementById('server-icon-file').click());
  document.getElementById('server-icon-file')?.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => { document.getElementById('server-icon-preview').src = ev.target.result; };
    reader.readAsDataURL(file);
  });

  /* --- EXPLORE MODAL --- */
  document.getElementById('explore-close').addEventListener('click', () => document.getElementById('explore-modal').classList.add('hidden'));

  /* --- CHANNEL HEADER BUTTONS --- */
  document.getElementById('search-btn').addEventListener('click', () => {
    const o = document.getElementById('search-overlay');
    o.classList.toggle('hidden');
    if (!o.classList.contains('hidden')) document.getElementById('search-input').focus();
  });
  document.getElementById('search-input').addEventListener('input', e => {
    clearTimeout(window._searchTimer);
    window._searchTimer = setTimeout(() => App.searchMessages(e.target.value), 400);
  });
  document.getElementById('search-overlay-close')?.addEventListener('click', () => document.getElementById('search-overlay').classList.add('hidden'));
  document.getElementById('pins-btn').addEventListener('click', () => App.loadPins());
  document.getElementById('close-pins-btn').addEventListener('click', () => { document.getElementById('pins-panel').classList.add('hidden'); State.pinsVisible = false; });
  document.getElementById('members-toggle-btn').addEventListener('click', () => {
    State.membersVisible = !State.membersVisible;
    document.getElementById('members-sidebar').classList.toggle('collapsed', !State.membersVisible);
  });

  /* --- MESSAGE INPUT --- */
  const msgInput = document.getElementById('message-input');
  msgInput.addEventListener('input', () => Chat.onInputChange());
  msgInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (State.isDMMode && State.currentDMUserId) {
        const content = msgInput.textContent?.trim() || '';
        if (content) { App.sendDM(content); msgInput.textContent = ''; Chat.onInputChange(); }
      } else {
        Chat.send();
      }
    }
  });
  document.getElementById('send-btn').addEventListener('click', () => {
    if (State.isDMMode && State.currentDMUserId) {
      const content = msgInput.textContent?.trim() || '';
      if (content) { App.sendDM(content); msgInput.textContent = ''; Chat.onInputChange(); }
    } else {
      Chat.send();
    }
  });
  document.getElementById('cancel-reply-btn').addEventListener('click', () => App.cancelReply());

  /* --- ATTACH --- */
  document.getElementById('attach-btn').addEventListener('click', () => document.getElementById('attach-file-input').click());
  document.getElementById('attach-file-input').addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) { Chat.uploadFile(file); e.target.value = ''; }
  });

  /* --- EMOJI PICKER --- */
  document.getElementById('emoji-btn').addEventListener('click', () => EmojiPicker.openForInput());
  document.getElementById('emoji-search').addEventListener('input', e => EmojiPicker.search(e.target.value));
  document.getElementById('emoji-close-btn')?.addEventListener('click', () => EmojiPicker.close());

  /* --- GIF PICKER --- */
  document.getElementById('gif-btn').addEventListener('click', () => GifPicker.open());
  document.getElementById('close-gif-btn').addEventListener('click', () => GifPicker.close());
  document.getElementById('gif-search').addEventListener('input', e => {
    clearTimeout(window._gifTimer);
    window._gifTimer = setTimeout(() => GifPicker.search(e.target.value), 500);
  });

  /* --- POLL --- */
  document.getElementById('poll-btn').addEventListener('click', () => Modals.openPoll());
  document.getElementById('poll-modal-close').addEventListener('click', () => document.getElementById('poll-modal').classList.add('hidden'));
  document.getElementById('add-poll-option').addEventListener('click', () => Modals.addPollOption());
  document.getElementById('submit-poll-btn').addEventListener('click', () => Modals.submitPoll());

  /* --- SHOP --- */
  document.getElementById('shop-btn').addEventListener('click', () => Modals.openShop());
  document.getElementById('shop-close').addEventListener('click', () => document.getElementById('shop-modal').classList.add('hidden'));
  document.querySelectorAll('.shop-tab').forEach(btn => btn.addEventListener('click', () => Shop.loadItems(btn.dataset.type)));

  /* --- NOTIFICATIONS --- */
  document.getElementById('notif-btn').addEventListener('click', () => {
    const panel = document.getElementById('notif-panel');
    panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden')) Notifications.renderPanel();
  });
  document.getElementById('mark-all-read-btn').addEventListener('click', () => Notifications.markAllRead());

  /* --- SETTINGS --- */
  document.getElementById('settings-btn').addEventListener('click', () => Modals.openSettings());
  document.getElementById('settings-close').addEventListener('click', () => document.getElementById('settings-modal').classList.add('hidden'));
  document.getElementById('save-settings-btn').addEventListener('click', () => Modals.saveSettings());
  document.getElementById('settings-avatar-btn').addEventListener('click', () => document.getElementById('settings-avatar-file').click());
  document.getElementById('settings-avatar-file').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => { document.getElementById('settings-avatar-preview').src = ev.target.result; };
    reader.readAsDataURL(file);
  });
  document.querySelectorAll('.theme-opt').forEach(btn => btn.addEventListener('click', () => {
    const theme = btn.dataset.theme;
    State.theme = theme;
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('vibe_theme', theme);
    document.querySelectorAll('.theme-opt').forEach(b => b.classList.toggle('active', b === btn));
  }));

  /* --- SERVER SETTINGS MODAL --- */
  document.getElementById('server-settings-close').addEventListener('click', () => document.getElementById('server-settings-modal').classList.add('hidden'));
  document.querySelectorAll('.ss-tab').forEach(btn => btn.addEventListener('click', () => ServerSettings.renderTab(btn.dataset.tab)));

  /* --- PROFILE MODAL --- */
  document.getElementById('profile-modal-close').addEventListener('click', () => Profile.close());
  document.getElementById('profile-modal').addEventListener('click', e => { if (e.target === document.getElementById('profile-modal')) Profile.close(); });

  /* --- CONFIRM MODAL --- */
  document.getElementById('confirm-ok').addEventListener('click', () => {
    Confirm._resolve?.(true);
    document.getElementById('confirm-modal').classList.add('hidden');
  });
  document.getElementById('confirm-cancel').addEventListener('click', () => {
    Confirm._resolve?.(false);
    document.getElementById('confirm-modal').classList.add('hidden');
  });

  /* --- ONBOARDING --- */
  document.getElementById('onboarding-next-1')?.addEventListener('click', () => Onboarding.nextStep(1, 2));
  document.getElementById('onboarding-next-2')?.addEventListener('click', () => Onboarding.nextStep(2, 3));
  document.getElementById('onboarding-next-3')?.addEventListener('click', () => Onboarding.nextStep(3, 4));
  document.getElementById('onboarding-finish')?.addEventListener('click', () => Onboarding.finish());
  document.getElementById('onboarding-avatar-btn')?.addEventListener('click', () => document.getElementById('onboarding-avatar-file').click());
  document.getElementById('onboarding-avatar-file')?.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => { document.getElementById('onboarding-avatar').src = ev.target.result; };
    reader.readAsDataURL(file);
  });
  document.querySelectorAll('.interest-chip').forEach(chip => chip.addEventListener('click', () => chip.classList.toggle('selected')));

  /* --- INFINITE SCROLL (load older messages on scroll to top) --- */
  document.getElementById('messages-area').addEventListener('scroll', e => {
    if (e.target.scrollTop < 200) App.loadMoreMessages();
  });

  /* --- CLOSE PICKERS / MENUS ON OUTSIDE CLICK --- */
  document.addEventListener('click', e => {
    if (!e.target.closest('#emoji-picker') && !e.target.closest('#emoji-btn') && !e.target.closest('.msg-action-btn[title="React"]')) EmojiPicker.close();
    if (!e.target.closest('#gif-picker') && !e.target.closest('#gif-btn')) GifPicker.close();
    if (!e.target.closest('#context-menu')) ContextMenu.hide();
    if (!e.target.closest('#notif-panel') && !e.target.closest('#notif-btn')) document.getElementById('notif-panel')?.classList.add('hidden');
  });

  /* --- PANEL SEARCH FILTER --- */
  document.getElementById('panel-search-input').addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    if (State.isDMMode) {
      document.querySelectorAll('.dm-item').forEach(el => {
        const name = el.querySelector('.dm-name')?.textContent?.toLowerCase() || '';
        el.style.display = name.includes(q) ? '' : 'none';
      });
    } else {
      document.querySelectorAll('.channel-item').forEach(el => {
        const name = el.querySelector('.channel-name')?.textContent?.toLowerCase() || '';
        el.style.display = name.includes(q) ? '' : 'none';
      });
    }
  });

  /* --- USER BAR AVATAR -> OWN PROFILE --- */
  document.getElementById('user-bar-avatar').addEventListener('click', () => {
    if (State.user?.id) Profile.open(State.user.id);
  });

  /* --- LEVEL UP POPUP DISMISS --- */
  document.getElementById('levelup-popup')?.addEventListener('click', () => document.getElementById('levelup-popup').classList.add('hidden'));

  /* --- INIT --- */
  App.init();
});

/* ================================================================
   RUNTIME CSS INJECTION
   ================================================================ */
(() => {
  const css = `
    .message-group.compact { gap: 0; }
    .message-group.compact .msg-compact-time { width: 44px; flex-shrink: 0; font-size: 10px; color: transparent; text-align: right; padding-right: 8px; padding-top: 4px; transition: color .15s; }
    .message-group.compact:hover .msg-compact-time { color: var(--text-muted); }
    .message-group.dm-mine { flex-direction: row-reverse; }
    .message-group.dm-mine .msg-body { align-items: flex-end; }
    .message-group.dm-mine .msg-content { background: var(--purple); color: #fff; padding: 8px 14px; border-radius: 18px 4px 18px 18px; display: inline-block; max-width: 80%; }
    .message-group.dm-mine .msg-header { flex-direction: row-reverse; }
    .pinned-highlight { background: rgba(245,158,11,.12) !important; border-left: 3px solid var(--gold) !important; }
    .msg-gif { max-width: 380px; max-height: 280px; border-radius: 8px; display: block; margin-top: 6px; cursor: zoom-in; }
    .msg-inline-edit { width: 100%; background: var(--panel-3); border: 1px solid var(--purple); border-radius: var(--radius); padding: 6px 10px; color: var(--text-primary); font-size: 14px; font-family: inherit; resize: none; outline: none; }
    .slow-mode-bar { padding: 6px 12px; background: rgba(245,158,11,.12); border: 1px solid var(--gold); border-radius: var(--radius); font-size: 12px; color: var(--gold); margin-bottom: 6px; }
    .shake { animation: shake .35s ease; }
    @keyframes shake { 0%,100%{transform:translateX(0)} 20%,60%{transform:translateX(-6px)} 40%,80%{transform:translateX(6px)} }
    @keyframes pulseGlow { 0%,100%{filter:drop-shadow(0 0 8px var(--purple))} 50%{filter:drop-shadow(0 0 24px var(--cyan))} }
    .input-btn-row { display: flex; gap: 8px; align-items: center; }
    .input-btn-row input { flex: 1; }
    .onboarding-server-card { padding: 12px; background: var(--panel-2); border-radius: var(--radius); cursor: pointer; transition: var(--transition); border: 2px solid transparent; }
    .onboarding-server-card:hover { border-color: var(--purple); background: var(--panel-3); }
    .onboarding-server-card.joined { border-color: var(--green); opacity: .7; pointer-events: none; }
    .explore-server-card { background: var(--panel-2); border-radius: var(--radius-lg); padding: 16px; cursor: pointer; border: 2px solid transparent; transition: var(--transition); }
    .explore-server-card:hover { border-color: var(--purple); transform: translateY(-2px); }
    .explore-server-icon { width: 56px; height: 56px; border-radius: var(--radius); object-fit: cover; margin-bottom: 8px; }
    .explore-server-name { font-weight: 700; font-size: 15px; }
    .explore-server-desc { font-size: 12px; color: var(--text-muted); margin: 4px 0; }
    .explore-server-count { font-size: 12px; color: var(--text-secondary); }
    .strength-1 { background: var(--red) !important; width: 25% !important; }
    .strength-2 { background: var(--gold) !important; width: 50% !important; }
    .strength-3 { background: var(--cyan) !important; width: 75% !important; }
    .strength-4 { background: var(--green) !important; width: 100% !important; }
    #search-overlay { position: absolute; top: 48px; right: 8px; width: 320px; background: var(--panel-2); border-radius: var(--radius-lg); border: 1px solid var(--border); box-shadow: var(--shadow-lg); z-index: 200; padding: 12px; }
    .search-result-item { padding: 8px 10px; border-radius: var(--radius); cursor: pointer; font-size: 13px; }
    .search-result-item:hover { background: var(--panel-3); }
    .search-result-meta { font-size: 11px; color: var(--text-muted); margin-bottom: 2px; }
    .member-role-section { margin-bottom: 4px; }
    .member-role-header { font-size: 11px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: .06em; padding: 10px 8px 4px; }
    #members-sidebar.collapsed { width: 0; overflow: hidden; padding: 0; }
    .poll-option-input { display: flex; gap: 6px; align-items: center; }
    .poll-option-input input { flex: 1; }
    .poll-remove-btn { background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 14px; padding: 4px 6px; }
    .poll-remove-btn:hover { color: var(--red); }
    #add-poll-option { width: 100%; margin-top: 8px; }
    .reply-quote { display: flex; align-items: center; gap: 6px; padding: 4px 8px; border-left: 3px solid var(--purple); margin-bottom: 4px; cursor: pointer; opacity: .8; font-size: 13px; }
    .reply-quote:hover { opacity: 1; }
    .reply-quote-author { font-weight: 700; color: var(--purple-light); }
    .reply-quote-content { color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 300px; }
    .channel-ref { color: var(--cyan); cursor: pointer; }
    .channel-ref:hover { text-decoration: underline; }
    .mention { background: rgba(124,58,237,.2); color: var(--purple-light); border-radius: 3px; padding: 1px 3px; }
  `;
  const el = document.createElement('style');
  el.textContent = css;
  document.head.appendChild(el);
})();

/* ================================================================
   NEW FEATURES
   ================================================================ */

// ── Connection status indicator ───────────────────────────────────
const ConnectionStatus = {
  init() {
    // Inject status pill into DOM
    const bar = document.getElementById('user-bar');
    if (!bar) return;
    const pill = document.createElement('div');
    pill.id = 'conn-status';
    pill.style.cssText = 'font-size:10px;padding:2px 7px;border-radius:20px;background:var(--green);color:#fff;font-weight:700;display:inline-block;transition:background .3s';
    pill.textContent = '● LIVE';
    bar.prepend(pill);
  },
  setConnected(connected) {
    const pill = document.getElementById('conn-status');
    if (!pill) return;
    pill.style.background = connected ? 'var(--green)' : 'var(--red)';
    pill.textContent = connected ? '● LIVE' : '● OFFLINE';
    if (!connected) Toast.show('Connection lost — reconnecting...', 'warning', '🔌');
    else Toast.show('Reconnected ✦', 'success');
  },
};

// Patch SocketManager to call ConnectionStatus
const _origConnect = SocketManager.connect.bind(SocketManager);
SocketManager.connect = function () {
  _origConnect();
  if (!State.socket) return;
  State.socket.on('connect',    () => ConnectionStatus.setConnected(true));
  State.socket.on('disconnect', () => ConnectionStatus.setConnected(false));
  State.socket.on('reconnect',  () => ConnectionStatus.setConnected(true));
};

// ── Message timestamp tooltips ────────────────────────────────────
document.addEventListener('mouseover', e => {
  const tsEl = e.target.closest('.msg-timestamp');
  if (!tsEl) return;
  const msgEl = tsEl.closest('[data-msg-id]');
  if (!msgEl) return;
  // Find full timestamp from rendered messages
  const msgId = msgEl.dataset.msgId;
  const allMsgs = Object.values(State.messages).flat().concat(Object.values(State.dmMessages).flat());
  const msg = allMsgs.find(m => m.id === msgId);
  if (!msg) return;
  const full = new Date(msg.createdAt).toLocaleString([], {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  tsEl.title = full;
});

// ── User search in members sidebar ───────────────────────────────
(function initMemberSearch() {
  document.addEventListener('DOMContentLoaded', () => {
    const sidebar = document.getElementById('members-sidebar');
    if (!sidebar) return;

    const searchWrap = document.createElement('div');
    searchWrap.style.cssText = 'padding:8px 10px 0;';
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = '🔍 Search members...';
    input.style.cssText = 'width:100%;font-size:12px;padding:5px 8px;border-radius:var(--radius);background:var(--panel-3);border:1px solid var(--border);color:var(--text-primary);outline:none;';
    searchWrap.appendChild(input);

    const header = sidebar.querySelector('.members-header') || sidebar.firstElementChild;
    if (header) header.insertAdjacentElement('afterend', searchWrap);
    else sidebar.prepend(searchWrap);

    input.addEventListener('input', e => {
      const q = e.target.value.toLowerCase();
      document.querySelectorAll('.member-item').forEach(el => {
        const name = el.querySelector('.member-item-name')?.textContent?.toLowerCase() || '';
        el.style.display = name.includes(q) ? '' : 'none';
      });
      // Hide empty role sections
      document.querySelectorAll('.member-role-section').forEach(sec => {
        const visible = [...sec.querySelectorAll('.member-item')].some(el => el.style.display !== 'none');
        sec.style.display = visible ? '' : 'none';
      });
    });
  });
})();

// ── Keyboard shortcut hints in empty state ───────────────────────
// Ctrl+K = search, Alt+↑↓ = channels — shown in welcome screen
const _origBuildWelcome = App.buildWelcomeHTML.bind(App);
App.buildWelcomeHTML = function () {
  return _origBuildWelcome() + `
    <div style="margin-top:24px;padding:16px 24px;background:var(--panel-2);border-radius:var(--radius-lg);max-width:360px;margin-left:auto;margin-right:auto;font-size:12px;color:var(--text-muted)">
      <div style="font-weight:700;color:var(--text-secondary);margin-bottom:8px">⌨️ Keyboard shortcuts</div>
      <div style="display:flex;flex-direction:column;gap:5px">
        <div><kbd style="background:var(--panel-3);border:1px solid var(--border);border-radius:4px;padding:1px 6px">Ctrl+K</kbd> Search messages</div>
        <div><kbd style="background:var(--panel-3);border:1px solid var(--border);border-radius:4px;padding:1px 6px">Alt+↑↓</kbd> Switch channels</div>
        <div><kbd style="background:var(--panel-3);border:1px solid var(--border);border-radius:4px;padding:1px 6px">Esc</kbd> Close any modal</div>
        <div><kbd style="background:var(--panel-3);border:1px solid var(--border);border-radius:4px;padding:1px 6px">Enter</kbd> Send message</div>
      </div>
    </div>`;
};

// ── Auto-init ConnectionStatus after loadApp ─────────────────────
const _origLoadApp = App.loadApp.bind(App);
App.loadApp = async function () {
  await _origLoadApp();
  ConnectionStatus.init();
};
