const AnonDB = (() => {
  const SESSION_KEY = 'anon_current_user_id';
  const now = () => new Date().toISOString();
  const id = () => crypto.randomUUID();
  let cache = null;
  let syncTimer = null;

  function seed() {
    const adminId = 'admin-user';
    const demoId = 'demo-user';
    const cityId = 'city-user';
    return {
      currentUserId: null,
      loginCount: 0,
      users: [
        { id: adminId, email: 'admin@anon.ru', password: 'admin123', username: 'admin', displayName: 'Админ Анон', bio: 'Слежу за порядком и тестирую админ-панель.', avatarUrl: '', role: 'ADMIN', online: false, lastSeen: now(), createdAt: now() },
        { id: demoId, email: 'demo@anon.ru', password: 'demo123', username: 'demo', displayName: 'Демо Пользователь', bio: 'Люблю короткие посты и аккуратные интерфейсы.', avatarUrl: '', role: 'USER', online: false, lastSeen: now(), createdAt: now() },
        { id: cityId, email: 'city@anon.ru', password: 'demo123', username: 'city_voice', displayName: 'Голос Города', bio: 'Новости, мысли, мемы и наблюдения.', avatarUrl: '', role: 'USER', online: false, lastSeen: now(), createdAt: now() }
      ],
      posts: [
        { id: id(), authorId: demoId, content: 'Новая версия Анона: профили, лайки, закладки, уведомления и админка. #анон', createdAt: now(), updatedAt: now(), likes: [adminId], bookmarks: [], repostedFromId: null, parentPostId: null, comments: [] },
        { id: id(), authorId: cityId, content: 'Хорошая соцсеть начинается с понятной регистрации и живой ленты. @demo #дизайн', createdAt: now(), updatedAt: now(), likes: [], bookmarks: [], repostedFromId: null, parentPostId: null, comments: [] }
      ],
      follows: [{ id: id(), followerId: adminId, followingId: demoId, createdAt: now() }],
      notifications: [],
      messages: [],
      reports: []
    };
  }

  function normalize(db) {
    db.loginCount ||= 0;
    db.users ||= [];
    db.posts ||= [];
    db.messages ||= [];
    db.notifications ||= [];
    db.follows ||= [];
    db.reports ||= [];
    db.users.forEach(user => {
      user.bio ??= 'Пока без описания.';
      user.avatarUrl ??= '';
      user.online ??= false;
      user.lastSeen ??= now();
      user.role ??= 'USER';
    });
    db.posts.forEach(post => {
      post.likes ||= [];
      post.bookmarks ||= [];
      post.comments ||= [];
    });
    return db;
  }

  function getSessionUserId() {
    return sessionStorage.getItem(SESSION_KEY);
  }

  function setSessionUserId(userId) {
    if (userId) sessionStorage.setItem(SESSION_KEY, userId);
    else sessionStorage.removeItem(SESSION_KEY);
  }

  function withSession(db) {
    db.currentUserId = getSessionUserId();
    return db;
  }

  function publicState(db) {
    const { currentUserId, ...state } = normalize({ ...db });
    return state;
  }

  function saveMemory(db) {
    cache = normalize(db);
    setSessionUserId(cache.currentUserId);
    withSession(cache);
  }

  async function push() {
    if (!cache) return;
    try {
      await fetch('/api/state', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: publicState(cache) })
      });
    } catch (error) {
      console.warn('Не удалось синхронизировать базу:', error);
    }
  }

  function schedulePush() {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(push, 250);
  }

  async function init() {
    try {
      const response = await fetch('/api/state');
      const data = await response.json();
      cache = withSession(data.state ? normalize(data.state) : seed());
      saveMemory(cache);
      if (!data.state) await push();
    } catch (error) {
      cache = withSession(seed());
    }
  }

  function load() {
    if (!cache) cache = seed();
    return withSession(cache);
  }

  function save(db) {
    saveMemory(db);
    schedulePush();
  }

  function currentUser() {
    const db = load();
    return db.users.find(u => u.id === db.currentUserId) || null;
  }

  function update(mutator) {
    const db = load();
    const result = mutator(db);
    save(db);
    return result ?? db;
  }

  function reset() {
    const fresh = seed();
    save(fresh);
    return fresh;
  }

  return { init, load, save, update, currentUser, id, now, reset };
})();
