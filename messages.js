const Messages = (() => {
  const state = { peerId: null, recorder: null, chunks: [], recording: false, startedAt: 0, timer: null };

  function me() { return AnonDB.currentUser(); }
  function peers(db) {
    const user = me();
    const ids = new Set();
    db.messages.forEach(message => {
      if (message.fromId === user.id) ids.add(message.toId);
      if (message.toId === user.id) ids.add(message.fromId);
    });
    db.users.filter(u => u.id !== user.id).forEach(u => ids.add(u.id));
    return [...ids].map(id => db.users.find(u => u.id === id)).filter(Boolean);
  }

  function unreadCount(db = AnonDB.load()) {
    const user = me();
    if (!user) return 0;
    return db.messages.filter(m => m.toId === user.id && !m.read).length;
  }

  function open(userId) {
    state.peerId = userId;
    Pages.navigate('messages');
    AnonDB.update(db => db.messages.forEach(m => { if (m.fromId === userId && m.toId === me().id) m.read = true; }));
    render();
    setTimeout(() => $('#messageText')?.focus(), 50);
  }

  function renderDialogs(db) {
    const user = me();
    const list = peers(db);
    $('#dialogsList').innerHTML = list.map(peer => {
      const history = db.messages.filter(m => (m.fromId === user.id && m.toId === peer.id) || (m.fromId === peer.id && m.toId === user.id));
      const last = history.at(-1);
      const unread = history.filter(m => m.toId === user.id && !m.read).length;
      return `<button class="dialog-row ${state.peerId === peer.id ? 'active' : ''}" data-message-user="${peer.id}" type="button">
        ${UI.avatar(peer, 'avatar')}
        <span><b>${UI.escape(peer.displayName)}</b><small>${last ? (last.type === 'voice' ? 'Голосовое сообщение' : UI.escape(last.content).slice(0, 48)) : '@' + UI.escape(peer.username)}</small></span>
        ${unread ? `<em>${unread}</em>` : ''}
      </button>`;
    }).join('') || '<div class="empty compact">Диалогов пока нет.</div>';
  }

  function renderChat(db) {
    const user = me();
    const peer = db.users.find(u => u.id === state.peerId);
    $('#msgBadge').textContent = unreadCount(db);
    $('#msgBadge').classList.toggle('hidden', unreadCount(db) === 0);
    $('#chatEmpty').classList.toggle('hidden', !!peer);
    $('#chatBox').classList.toggle('hidden', !peer);
    if (!peer) return;

    $('#chatHeader').innerHTML = `<button class="avatar-button" data-profile="${peer.id}" type="button">${UI.avatar(peer, 'avatar')}</button><div><b>${UI.escape(peer.displayName)}</b><span>@${UI.escape(peer.username)} · ${peer.online ? 'онлайн' : 'офлайн'}</span></div>`;
    const history = db.messages.filter(m => (m.fromId === user.id && m.toId === peer.id) || (m.fromId === peer.id && m.toId === user.id));
    $('#chatMessages').innerHTML = history.length ? history.map(message => {
      const own = message.fromId === user.id;
      const body = message.type === 'voice'
        ? `<div class="voice-message"><span>Голосовое</span><audio controls src="${message.audioUrl}"></audio></div>`
        : `<p>${UI.linkText(message.content)}</p>`;
      const deleteButton = own ? `<button class="delete-message" data-delete-message="${message.id}" type="button">Удалить</button>` : '';
      const voiceClass = message.type === 'voice' ? 'voice-bubble' : '';
      return `<div class="message-bubble ${own ? 'own' : ''} ${voiceClass}">${body}<div class="message-meta"><small>${UI.timeAgo(message.createdAt)}</small>${deleteButton}</div></div>`;
    }).join('') : '<div class="empty compact">Начни диалог первым сообщением.</div>';
    $('#chatMessages').scrollTop = $('#chatMessages').scrollHeight;
  }

  function render() {
    if (!me() || !$('#dialogsList')) return;
    const db = AnonDB.load();
    renderDialogs(db);
    renderChat(db);
  }

  function sendText(event) {
    event.preventDefault();
    const text = $('#messageText').value.trim();
    if (!text || !state.peerId) return;
    const user = me();
    AnonDB.update(db => {
      db.messages.push({ id: AnonDB.id(), fromId: user.id, toId: state.peerId, type: 'text', content: text, read: false, createdAt: AnonDB.now() });
      db.notifications.unshift({ id: AnonDB.id(), userId: state.peerId, type: 'MESSAGE', sourceUserId: user.id, read: false, createdAt: AnonDB.now() });
    });
    $('#messageText').value = '';
    render();
  }

  async function toggleVoice() {
    if (!state.peerId) return UI.toast('Сначала выбери диалог.');
    if (!navigator.mediaDevices || !window.MediaRecorder) return UI.toast('Браузер не поддерживает запись голоса.');
    if (state.recording) {
      stopVoice();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      state.chunks = [];
      state.recorder = new MediaRecorder(stream);
      state.recorder.ondataavailable = event => state.chunks.push(event.data);
      state.recorder.onstop = () => {
        stream.getTracks().forEach(track => track.stop());
        const blob = new Blob(state.chunks, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onload = () => {
          const user = me();
          AnonDB.update(db => {
            db.messages.push({ id: AnonDB.id(), fromId: user.id, toId: state.peerId, type: 'voice', audioUrl: reader.result, read: false, createdAt: AnonDB.now() });
            db.notifications.unshift({ id: AnonDB.id(), userId: state.peerId, type: 'MESSAGE', sourceUserId: user.id, read: false, createdAt: AnonDB.now() });
          });
          state.recording = false;
          clearInterval(state.timer);
          $('#voiceBtn').classList.remove('recording');
          $('#voiceBtn').textContent = '🎙 Записать';
          $('#voiceHint').classList.add('hidden');
          render();
          UI.toast('Голосовое отправлено.');
        };
        reader.readAsDataURL(blob);
      };
      state.recorder.start();
      state.recording = true;
      state.startedAt = Date.now();
      $('#voiceBtn').classList.add('recording');
      $('#voiceBtn').textContent = '■ Стоп';
      $('#voiceHint').classList.remove('hidden');
      updateVoiceTimer();
      state.timer = setInterval(updateVoiceTimer, 500);
    } catch (error) {
      UI.toast('Нужно разрешить доступ к микрофону.');
    }
  }

  function updateVoiceTimer() {
    if (!state.recording) return;
    const seconds = Math.floor((Date.now() - state.startedAt) / 1000);
    const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
    const ss = String(seconds % 60).padStart(2, '0');
    $('#voiceHint').textContent = `Идёт запись ${mm}:${ss}. Нажми «Стоп», чтобы отправить.`;
  }

  function stopVoice() {
    if (!state.recorder || state.recorder.state === 'inactive') return;
    state.recorder.stop();
  }

  function deleteMessage(messageId) {
    AnonDB.update(db => {
      const user = me();
      db.messages = db.messages.filter(message => !(message.id === messageId && message.fromId === user.id));
    });
    render();
    UI.toast('Сообщение удалено.');
  }

  function handleClick(event) {
    const deleteId = event.target.closest('[data-delete-message]')?.dataset.deleteMessage;
    if (deleteId) deleteMessage(deleteId);
    const userId = event.target.closest('[data-message-user]')?.dataset.messageUser;
    if (userId) open(userId);
  }

  return { state, open, render, sendText, toggleVoice, handleClick };
})();

