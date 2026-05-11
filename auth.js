const Auth = (() => {
  const state = { mode: 'login', pending: null };

  function setMode(mode) {
    state.mode = mode;
    const register = mode === 'register';
    $('#loginTab').classList.toggle('active', !register);
    $('#registerTab').classList.toggle('active', register);
    $('#nameField').classList.toggle('hidden', !register);
    $('#usernameField').classList.toggle('hidden', !register);
    $('#authAvatarField')?.classList.toggle('hidden', !register);
    $('#authSubmit').textContent = register ? 'Создать аккаунт' : 'Войти';
    $('#authHint').textContent = register ? 'Уже есть аккаунт? Нажми Вход.' : 'Нет аккаунта? Переключись на регистрацию.';
  }

  function cleanUsername(value) { return value.trim().toLowerCase().replace(/^@/, ''); }
  function makeCode() { return String(Math.floor(100000 + Math.random() * 900000)); }

  function readAvatarFile() {
    const file = $('#authAvatar')?.files?.[0];
    if (!file) return Promise.resolve('');
    return new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(file);
    });
  }

  async function requestServerCode(type, email) {
    const response = await fetch('/api/send-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, purpose: type })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) throw new Error(data.error || 'Не удалось отправить код');
    return data.verificationId;
  }

  async function openCodeDialog(type, email, payload) {
    state.pending = { type, email, payload, createdAt: Date.now(), viaServer: false, code: makeCode(), verificationId: null };
    $('#codeTitle').textContent = type === 'register' ? 'Подтверждение регистрации' : 'Подтверждение входа';
    $('#codeInput').value = '';

    try {
      state.pending.verificationId = await requestServerCode(type, email);
      state.pending.viaServer = true;
      state.pending.code = null;
      $('#codeText').textContent = `Мы отправили код на ${email}. Проверьте почту и введите 6 цифр. Проверте вкладку спам`;
      $('.test-code-box').classList.add('hidden');
      UI.toast('Код отправлен на почту.');
    } catch (error) {
      $('#codeText').textContent = `Сервер отправки не запущен или SendGrid не настроен. Для теста используйте код ниже.`;
      $('#testCodeValue').textContent = state.pending.code;
      $('.test-code-box').classList.remove('hidden');
      UI.toast(error.message || 'Используем тестовый код.');
    }

    $('#codeDialog').showModal();
    setTimeout(() => $('#codeInput')?.focus(), 50);
  }

  async function submit(event) {
    event.preventDefault();
    const email = $('#email').value.trim().toLowerCase();
    const password = $('#password').value;
    const db = AnonDB.load();

    if (state.mode === 'login') {
      const user = db.users.find(u => u.email === email && u.password === password);
      if (!user) return UI.toast('Почта или пароль не подходят.');
      await openCodeDialog('login', email, { userId: user.id });
      return;
    }

    const displayName = $('#displayName').value.trim();
    const username = cleanUsername($('#username').value);
    if (displayName.length < 2) return UI.toast('Имя должно быть хотя бы 2 символа.');
    if (!/^[a-z0-9_]{3,20}$/.test(username)) return UI.toast('Ник: 3-20 символов, латиница, цифры или подчёркивание.');
    if (password.length < 6) return UI.toast('Пароль должен быть минимум 6 символов.');
    if (db.users.some(u => u.email === email)) return UI.toast('Почта уже зарегистрирована.');
    if (db.users.some(u => u.username === username)) return UI.toast('Ник уже занят.');

    const avatarUrl = await readAvatarFile();
    await openCodeDialog('register', email, { email, password, username, displayName, avatarUrl });
  }

  async function verifyPendingCode(entered) {
    const pending = state.pending;
    if (!pending) return false;
    if (Date.now() - pending.createdAt > 5 * 60 * 1000) throw new Error('Код устарел. Попробуйте ещё раз.');

    if (!pending.viaServer) {
      if (entered !== pending.code) throw new Error('Неверный код подтверждения.');
      return true;
    }

    const response = await fetch('/api/verify-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ verificationId: pending.verificationId, code: entered })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) throw new Error(data.error || 'Неверный код подтверждения.');
    return true;
  }

  async function confirmCode(event) {
    event.preventDefault();
    const pending = state.pending;
    if (!pending) return;
    const entered = $('#codeInput').value.trim();

    try {
      await verifyPendingCode(entered);
    } catch (error) {
      if (String(error.message).includes('устарел')) {
        state.pending = null;
        $('#codeDialog').close();
      }
      UI.toast(error.message || 'Неверный код подтверждения.');
      $('#codeInput').focus();
      return;
    }

    const db = AnonDB.load();
    if (pending.type === 'login') {
      const user = db.users.find(u => u.id === pending.payload.userId);
      if (!user) return UI.toast('Пользователь не найден.');
      user.online = true;
      user.lastSeen = AnonDB.now();
      db.currentUserId = user.id;
      db.loginCount = (db.loginCount || 0) + 1;
      AnonDB.save(db);
    } else {
      const user = {
        id: AnonDB.id(),
        email: pending.payload.email,
        password: pending.payload.password,
        username: pending.payload.username,
        displayName: pending.payload.displayName,
        bio: 'Пока без описания.',
        avatarUrl: pending.payload.avatarUrl,
        role: 'USER',
        online: true,
        lastSeen: AnonDB.now(),
        createdAt: AnonDB.now()
      };
      db.users.push(user);
      db.currentUserId = user.id;
      db.loginCount = (db.loginCount || 0) + 1;
      AnonDB.save(db);
    }

    state.pending = null;
    $('#codeDialog').close();
    UI.toast('Код подтверждён.');
    App.start();
  }

  function cancelCode() {
    state.pending = null;
    $('#codeDialog').close();
    UI.toast('Подтверждение отменено.');
  }

  function logout() {
    AnonDB.update(db => {
      const user = db.users.find(u => u.id === db.currentUserId);
      if (user) { user.online = false; user.lastSeen = AnonDB.now(); }
      db.currentUserId = null;
    });
    location.reload();
  }

  return { setMode, submit, confirmCode, cancelCode, logout };
})();
