const App = (() => {
  function start() {
    const user = AnonDB.currentUser();
    if (!user) {
      $('#authView').classList.remove('hidden');
      $('#appView').classList.add('hidden');
      return;
    }
    $('#authView').classList.add('hidden');
    $('#appView').classList.remove('hidden');
    Pages.state.profileUserId = user.id;
    Pages.navigate('home');
  }

  function bind() {
    $('#loginTab').addEventListener('click', () => Auth.setMode('login'));
    $('#registerTab').addEventListener('click', () => Auth.setMode('register'));
    $('#authForm').addEventListener('submit', Auth.submit);
    $('#togglePassword').addEventListener('click', () => {
      const input = $('#password');
      const visible = input.type === 'text';
      input.type = visible ? 'password' : 'text';
      $('#togglePassword').textContent = visible ? '👁' : '🙈';
      $('#togglePassword').setAttribute('aria-label', visible ? 'Показать пароль' : 'Скрыть пароль');
      $('#togglePassword').setAttribute('title', visible ? 'Показать пароль' : 'Скрыть пароль');
    });
    $('#codeForm').addEventListener('submit', Auth.confirmCode);
    $('#cancelCode').addEventListener('click', Auth.cancelCode);
    $('#logoutBtn').addEventListener('click', Auth.logout);
    $('#postForm').addEventListener('submit', Pages.createPost);
    $('#postText').addEventListener('input', Pages.updateCharCount);
    $('#newPostBtn').addEventListener('click', () => { Pages.navigate('home'); $('#postText').focus(); });
    $('#searchInput').addEventListener('input', event => { Pages.state.query = event.target.value; Pages.renderAll(); });
    $('#themeBtn').addEventListener('click', () => {
      document.documentElement.classList.toggle('dark');
      localStorage.setItem('anon_theme', document.documentElement.classList.contains('dark') ? 'dark' : 'light');
    });
    $$('.feed-tab').forEach(btn => btn.addEventListener('click', () => { $$('.feed-tab').forEach(x => x.classList.remove('active')); btn.classList.add('active'); Pages.state.feed = btn.dataset.feed; Pages.renderAll(); }));
    $$('.idea-btn').forEach(btn => btn.addEventListener('click', () => { Pages.navigate('home'); $('#postText').value = btn.textContent + ' '; Pages.updateCharCount(); $('#postText').focus(); }));
    $('#editProfileBtn').addEventListener('click', () => {
      const me = AnonDB.currentUser();
      $('#editName').value = me.displayName;
      $('#editBio').value = me.bio || '';
      $('#profileDialog').showModal();
    });
    $('#cancelProfileEdit').addEventListener('click', () => $('#profileDialog').close());
    $('#profileForm').addEventListener('submit', Pages.saveProfile);
    $('#followProfileBtn').addEventListener('click', () => Pages.toggleFollow(Pages.state.profileUserId));
    $('#messageProfileBtn').addEventListener('click', () => Messages.open(Pages.state.profileUserId));
    $('#messageForm').addEventListener('submit', Messages.sendText);
    $('#voiceBtn').addEventListener('click', Messages.toggleVoice);
    document.addEventListener('click', Pages.handleClick);
    document.addEventListener('click', Messages.handleClick);
    document.addEventListener('click', Admin.handleClick);
    document.addEventListener('change', Admin.handleChange);
    document.addEventListener('submit', Pages.handleSubmit);
    window.addEventListener('beforeunload', () => {
      AnonDB.update(db => {
        const user = db.users.find(u => u.id === db.currentUserId);
        if (user) { user.online = false; user.lastSeen = AnonDB.now(); }
      });
    });
  }

  async function init() {
    await AnonDB.init();
    if (localStorage.getItem('anon_theme') === 'dark') document.documentElement.classList.add('dark');
    Auth.setMode('login');
    bind();
    start();
  }

  return { init, start };
})();

// Глобальная команда для получения прав админа
window.promoteToAdmin = async (secret) => {
  const user = AnonDB.currentUser();
  if (!user) {
    console.error('Сначала войдите в аккаунт.');
    return;
  }

  try {
    const response = await fetch('/api/make-admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret })
    });
    const data = await response.json();

    if (response.ok && data.success) {
      AnonDB.update(db => {
        const target = db.users.find(u => u.id === user.id);
        if (target) {
          target.role = 'ADMIN';
          console.log('✅ Вы стали админом!');
        }
      });
      location.reload();
    } else {
      console.error('❌ Ошибка:', data.error || 'Неверный ключ');
      alert(data.error || 'Неверный ключ');
    }
  } catch (error) {
    console.error('Ошибка связи с сервером:', error);
    alert('Ошибка связи с сервером');
  }
};

App.init();
