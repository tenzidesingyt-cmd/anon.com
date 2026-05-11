const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const UI = (() => {
  function toast(message) {
    const box = $('#toast');
    box.textContent = message;
    box.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => box.classList.remove('show'), 2600);
  }

  function initials(name) { return (name || 'A').trim().slice(0, 1).toUpperCase(); }
  function escape(text) { const div = document.createElement('div'); div.textContent = text ?? ''; return div.innerHTML; }
  function timeAgo(date) {
    const seconds = Math.max(1, Math.floor((Date.now() - new Date(date).getTime()) / 1000));
    if (seconds < 60) return `${seconds} сек`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)} мин`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} ч`;
    return `${Math.floor(seconds / 86400)} д`;
  }

  function avatar(user, className = 'avatar') {
    if (user?.avatarUrl) return `<img class="${className} avatar-img" src="${user.avatarUrl}" alt="${escape(user.displayName)}">`;
    return `<div class="${className}">${initials(user?.displayName)}</div>`;
  }

  function linkText(text) {
    return escape(text)
      .replace(/(^|\s)(#[\p{L}0-9_]+)/gu, '$1<span class="inline-tag">$2</span>')
      .replace(/(^|\s)@([a-z0-9_]{3,20})/gi, '$1<button class="mention-link" data-user-name="$2" type="button">@$2</button>');
  }

  return { toast, initials, escape, timeAgo, avatar, linkText };
})();

const Pages = (() => {
  const state = { page: 'home', profileUserId: null, feed: 'all', query: '', profileList: 'followers' };

  function currentUser() { return AnonDB.currentUser(); }
  function navigate(page, payload = {}) {
    state.page = page;
    if (payload.profileUserId) state.profileUserId = payload.profileUserId;
    if (page === 'profile' && !state.profileUserId) state.profileUserId = currentUser()?.id;

    const titles = { home: 'Главная', explore: 'Поиск', messages: 'Личные сообщения', notifications: 'Уведомления', bookmarks: 'Закладки', profile: 'Профиль', admin: 'Админ-панель' };
    $('#pageTitle').textContent = titles[page] || 'Анон';
    $$('.page').forEach(el => el.classList.remove('active'));
    $(`#${page}Page`)?.classList.add('active');
    $$('.nav-link').forEach(btn => btn.classList.toggle('active', btn.dataset.page === page));
    renderAll();
  }

  function setAvatarBox(id, user) {
    const el = $(`#${id}`);
    if (!el) return;
    if (user.avatarUrl) {
      el.className = 'avatar avatar-img';
      el.style.backgroundImage = `url(${user.avatarUrl})`;
      el.style.backgroundSize = 'cover';
      el.style.backgroundPosition = 'center';
      el.textContent = '';
    } else {
      el.className = 'avatar';
      el.style.backgroundImage = '';
      el.textContent = UI.initials(user.displayName);
    }
  }

  function renderUserChrome() {
    const user = currentUser();
    if (!user) return;
    $('#miniName').textContent = user.displayName;
    $('#miniHandle').textContent = `@${user.username}`;
    setAvatarBox('miniAvatar', user);
    setAvatarBox('composerAvatar', user);
    $('#adminNav').classList.toggle('hidden', user.role !== 'ADMIN' && user.role !== 'MODERATOR');
  }

  function createPost(event) {
    event.preventDefault();
    const text = $('#postText').value.trim();
    if (!text) return UI.toast('Пустой пост не отправится.');
    if (text.length > 280) return UI.toast('Максимум 280 символов.');
    const me = currentUser();

    AnonDB.update(db => {
      const post = { id: AnonDB.id(), authorId: me.id, content: text, createdAt: AnonDB.now(), updatedAt: AnonDB.now(), likes: [], bookmarks: [], repostedFromId: null, parentPostId: null, comments: [] };
      db.posts.unshift(post);
      const mentions = [...text.matchAll(/@([a-z0-9_]{3,20})/gi)].map(match => match[1].toLowerCase());
      mentions.forEach(name => {
        const target = db.users.find(u => u.username === name && u.id !== me.id);
        if (target) db.notifications.unshift({ id: AnonDB.id(), userId: target.id, type: 'MENTION', sourceUserId: me.id, postId: post.id, read: false, createdAt: AnonDB.now() });
      });
    });
    $('#postText').value = '';
    updateCharCount();
    renderAll();
    UI.toast('Пост опубликован.');
  }

  function visiblePosts() {
    const db = AnonDB.load();
    const me = currentUser();
    let posts = [...db.posts];
    if (state.feed === 'following') {
      const ids = db.follows.filter(f => f.followerId === me.id).map(f => f.followingId);
      ids.push(me.id);
      posts = posts.filter(p => ids.includes(p.authorId));
    }
    if (state.feed === 'popular') posts.sort((a, b) => ((b.likes?.length || 0) + (b.comments?.length || 0)) - ((a.likes?.length || 0) + (a.comments?.length || 0)));
    else posts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return posts;
  }

  function renderPosts(posts, target) {
    const db = AnonDB.load();
    const me = currentUser();
    const container = $(target);
    if (!container) return;
    if (!posts.length) { container.innerHTML = '<div class="empty">Пока здесь тихо. Самое время написать первый пост.</div>'; return; }

    container.innerHTML = posts.map(post => {
      const author = db.users.find(u => u.id === post.authorId) || { displayName: 'Удалённый пользователь', username: 'unknown', avatarUrl: '' };
      const liked = post.likes?.includes(me.id);
      const saved = post.bookmarks?.includes(me.id);
      const own = post.authorId === me.id || me.role === 'ADMIN' || me.role === 'MODERATOR';
      const comments = post.comments || [];
      return `<article class="post-card" data-post-id="${post.id}">
        <div class="post-head">
          <button class="avatar-button" data-profile="${author.id}" type="button">${UI.avatar(author, 'avatar')}</button>
          <div class="post-main">
            <div class="post-meta"><button class="name-link" data-profile="${author.id}" type="button"><strong>${UI.escape(author.displayName)}</strong></button><span>@${UI.escape(author.username)}</span><span>·</span><span>${UI.timeAgo(post.createdAt)}</span></div>
            <div class="post-text">${UI.linkText(post.content)}</div>
          </div>
        </div>
        <div class="post-actions">
          <button class="action-btn" data-profile="${author.id}" type="button">Профиль</button>
          <button class="action-btn ${liked ? 'liked' : ''}" data-like="${post.id}" type="button">♥ ${post.likes?.length || 0}</button>
          <button class="action-btn" data-comment-toggle="${post.id}" type="button">💬 ${comments.length}</button>
          <button class="action-btn ${saved ? 'saved' : ''}" data-bookmark="${post.id}" type="button">☆</button>
          <button class="action-btn" data-repost="${post.id}" type="button">↻</button>
          ${own ? `<button class="action-btn danger" data-delete="${post.id}" type="button">Удалить</button>` : ''}
        </div>
        <div class="comments hidden" id="comments-${post.id}">
          <form class="comment-form" data-comment-form="${post.id}"><input placeholder="Написать комментарий" maxlength="180"><button class="secondary-btn" type="submit">Ответить</button></form>
          ${comments.map(c => {
            const ca = db.users.find(u => u.id === c.authorId) || { displayName: 'Гость', username: 'guest' };
            return `<div class="comment"><b>${UI.escape(ca.displayName)}</b> <span>@${UI.escape(ca.username)}</span><p>${UI.linkText(c.content)}</p></div>`;
          }).join('')}
        </div>
      </article>`;
    }).join('');
  }

  function renderHome() { renderPosts(visiblePosts(), '#feedList'); }

  function renderSearch() {
    const db = AnonDB.load();
    const query = state.query.toLowerCase().trim();
    const box = $('#searchResults');
    if (!query) { box.innerHTML = '<div class="empty">Начни вводить запрос, и здесь появятся люди и посты.</div>'; return; }
    const users = db.users.filter(u => `${u.username} ${u.displayName}`.toLowerCase().includes(query));
    const posts = db.posts.filter(p => {
      const author = db.users.find(u => u.id === p.authorId);
      return `${p.content} ${author?.username || ''} ${author?.displayName || ''}`.toLowerCase().includes(query);
    });
    box.innerHTML = users.map(user => `<button class="user-row" data-profile="${user.id}" type="button">${UI.avatar(user, 'avatar')}<span><b>${UI.escape(user.displayName)}</b><small>@${UI.escape(user.username)}</small></span></button>`).join('');
    const temp = document.createElement('div');
    renderPosts(posts, '#searchResults');
    if (users.length) box.insertAdjacentHTML('afterbegin', users.map(user => `<button class="user-row" data-profile="${user.id}" type="button">${UI.avatar(user, 'avatar')}<span><b>${UI.escape(user.displayName)}</b><small>@${UI.escape(user.username)}</small></span></button>`).join(''));
  }

  function renderProfilePeople(db, user) {
    const followers = db.follows
      .filter(f => f.followingId === user.id)
      .map(f => db.users.find(u => u.id === f.followerId))
      .filter(Boolean);
    const following = db.follows
      .filter(f => f.followerId === user.id)
      .map(f => db.users.find(u => u.id === f.followingId))
      .filter(Boolean);
    const list = state.profileList === 'following' ? following : followers;
    const title = state.profileList === 'following' ? 'Подписки' : 'Подписчики';
    const container = $('#profilePeopleList');
    if (!container) return;
    $('#peopleDialogTitle').textContent = title;
    container.innerHTML = `
      <div class="profile-people-head">
        <button class="people-tab ${state.profileList === 'followers' ? 'active' : ''}" data-profile-list="followers" type="button">Подписчики</button>
        <button class="people-tab ${state.profileList === 'following' ? 'active' : ''}" data-profile-list="following" type="button">Подписки</button>
      </div>
      <div class="profile-people-body">
        ${list.length ? list.map(person => `<button class="profile-person" data-profile="${person.id}" type="button">${UI.avatar(person, 'avatar')}<span><b>${UI.escape(person.displayName)}</b><small>@${UI.escape(person.username)} · открыть профиль</small></span></button>`).join('') : `<div class="empty compact">${title}: пока никого нет.</div>`}
      </div>`;
  }

  function renderProfile() {
    const db = AnonDB.load();
    const me = currentUser();
    const user = db.users.find(u => u.id === (state.profileUserId || me.id)) || me;
    state.profileUserId = user.id;
    $('#profileAvatar').outerHTML = user.avatarUrl ? `<img id="profileAvatar" class="avatar large avatar-img" src="${user.avatarUrl}" alt="${UI.escape(user.displayName)}">` : `<div id="profileAvatar" class="avatar large">${UI.initials(user.displayName)}</div>`;
    $('#profileName').textContent = user.displayName;
    $('#profileHandle').textContent = `@${user.username} · ${user.online ? 'онлайн' : 'был ' + UI.timeAgo(user.lastSeen) + ' назад'}`;
    $('#profileBio').textContent = user.bio || 'Пока без описания.';
    const posts = db.posts.filter(p => p.authorId === user.id).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    $('#profilePosts').textContent = posts.length;
    $('#profileLikes').textContent = posts.reduce((sum, p) => sum + (p.likes?.length || 0), 0);
    $('#profileFollowers').textContent = db.follows.filter(f => f.followingId === user.id).length;
    $('#profileFollowing').textContent = db.follows.filter(f => f.followerId === user.id).length;
    $('#editProfileBtn').classList.toggle('hidden', user.id !== me.id);
        $('#messageProfileBtn')?.classList.toggle('hidden', user.id === me.id);
    $('#followProfileBtn').classList.toggle('hidden', user.id === me.id);
    const follows = db.follows.some(f => f.followerId === me.id && f.followingId === user.id);
    $('#followProfileBtn').textContent = follows ? 'Отписаться' : 'Подписаться';
    renderPosts(posts, '#profilePostsList');
  }

  function openProfilePeople(listType) {
    state.profileList = listType;
    const db = AnonDB.load();
    const me = currentUser();
    const user = db.users.find(u => u.id === (state.profileUserId || me.id)) || me;
    renderProfilePeople(db, user);
    $('#peopleDialog')?.showModal();
  }

  function renderNotifications() {
    const db = AnonDB.load();
    const me = currentUser();
    const items = db.notifications.filter(n => n.userId === me.id).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    $('#notifBadge').textContent = items.filter(n => !n.read).length;
    $('#notifBadge').classList.toggle('hidden', items.filter(n => !n.read).length === 0);
    $('#notificationsList').innerHTML = items.length ? items.map(n => {
      const source = db.users.find(u => u.id === n.sourceUserId) || { displayName: 'Кто-то', username: 'unknown' };
      const labels = { LIKE: 'лайкнул ваш пост', COMMENT: 'оставил комментарий', FOLLOW: 'подписался на вас', MENTION: 'упомянул вас', REPOST: 'сделал репост', MESSAGE: 'написал вам сообщение' };
      return `<button class="notification ${n.read ? '' : 'unread'}" data-notification="${n.id}" type="button">${UI.avatar(source, 'avatar')}<span><b>${UI.escape(source.displayName)}</b> ${labels[n.type] || 'обновление'}<small>${UI.timeAgo(n.createdAt)}</small></span></button>`;
    }).join('') : '<div class="empty">Уведомлений пока нет.</div>';
  }

  function renderBookmarks() {
    const db = AnonDB.load();
    const me = currentUser();
    renderPosts(db.posts.filter(p => p.bookmarks?.includes(me.id)), '#bookmarksList');
  }

  function renderTrends() {
    const db = AnonDB.load();
    const counts = new Map();
    db.posts.forEach(p => (p.content.match(/#[\p{L}0-9_]+/gu) || []).forEach(tag => counts.set(tag.toLowerCase(), (counts.get(tag.toLowerCase()) || 0) + 1)));
    const trends = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    $('#trendsList').innerHTML = trends.length ? trends.map(([tag, count]) => `<button class="trend" data-search="${tag}" type="button"><strong>${tag}</strong><span>${count} постов</span></button>`).join('') : '<div class="trend"><strong>#анон</strong><span>первый тренд</span></div>';
  }

  function renderSuggestions() {
    const db = AnonDB.load();
    const me = currentUser();
    const followed = db.follows.filter(f => f.followerId === me.id).map(f => f.followingId);
    const users = db.users.filter(u => u.id !== me.id && !followed.includes(u.id)).slice(0, 4);
    $('#suggestionsList').innerHTML = users.map(u => `<button class="user-row" data-profile="${u.id}" type="button">${UI.avatar(u, 'avatar')}<span><b>${UI.escape(u.displayName)}</b><small>@${UI.escape(u.username)}</small></span></button>`).join('') || '<div class="empty compact">Всех уже читаешь.</div>';
  }

  function renderAll() {
    if (!currentUser()) return;
    renderUserChrome();
    renderHome();
    renderSearch();
    renderProfile();
    renderNotifications();
        Messages.render();
    renderBookmarks();
    renderTrends();
    renderSuggestions();
    Admin.render();
  }

  function updateCharCount() { $('#charCount').textContent = `${$('#postText').value.length} / 280`; }

  function toggleLike(postId) {
    const me = currentUser();
    AnonDB.update(db => {
      const post = db.posts.find(p => p.id === postId);
      if (!post) return;
      post.likes ||= [];
      const index = post.likes.indexOf(me.id);
      if (index >= 0) post.likes.splice(index, 1);
      else {
        post.likes.push(me.id);
        if (post.authorId !== me.id) db.notifications.unshift({ id: AnonDB.id(), userId: post.authorId, type: 'LIKE', sourceUserId: me.id, postId, read: false, createdAt: AnonDB.now() });
      }
    });
    renderAll();
  }

  function toggleBookmark(postId) {
    const me = currentUser();
    AnonDB.update(db => {
      const post = db.posts.find(p => p.id === postId);
      post.bookmarks ||= [];
      const index = post.bookmarks.indexOf(me.id);
      if (index >= 0) post.bookmarks.splice(index, 1); else post.bookmarks.push(me.id);
    });
    renderAll();
  }

  function repost(postId) {
    const me = currentUser();
    AnonDB.update(db => {
      const original = db.posts.find(p => p.id === postId);
      if (!original) return;
      db.posts.unshift({ id: AnonDB.id(), authorId: me.id, content: `Репост: ${original.content}`, createdAt: AnonDB.now(), updatedAt: AnonDB.now(), likes: [], bookmarks: [], repostedFromId: postId, parentPostId: postId, comments: [] });
      if (original.authorId !== me.id) db.notifications.unshift({ id: AnonDB.id(), userId: original.authorId, type: 'REPOST', sourceUserId: me.id, postId, read: false, createdAt: AnonDB.now() });
    });
    renderAll();
    UI.toast('Репост добавлен в ленту.');
  }

  function deletePost(postId) {
    const me = currentUser();
    AnonDB.update(db => { db.posts = db.posts.filter(p => p.id !== postId || (p.authorId !== me.id && me.role !== 'ADMIN' && me.role !== 'MODERATOR')); });
    renderAll();
  }

  function toggleFollow(userId) {
    const me = currentUser();
    if (userId === me.id) return;
    AnonDB.update(db => {
      const index = db.follows.findIndex(f => f.followerId === me.id && f.followingId === userId);
      if (index >= 0) db.follows.splice(index, 1);
      else {
        db.follows.push({ id: AnonDB.id(), followerId: me.id, followingId: userId, createdAt: AnonDB.now() });
        db.notifications.unshift({ id: AnonDB.id(), userId, type: 'FOLLOW', sourceUserId: me.id, read: false, createdAt: AnonDB.now() });
      }
    });
    renderAll();
  }

  function addComment(postId, content) {
    const me = currentUser();
    AnonDB.update(db => {
      const post = db.posts.find(p => p.id === postId);
      post.comments ||= [];
      post.comments.push({ id: AnonDB.id(), authorId: me.id, content, createdAt: AnonDB.now(), likes: [] });
      if (post.authorId !== me.id) db.notifications.unshift({ id: AnonDB.id(), userId: post.authorId, type: 'COMMENT', sourceUserId: me.id, postId, read: false, createdAt: AnonDB.now() });
    });
    renderAll();
  }

  function saveProfile(event) {
    event.preventDefault();
    const me = currentUser();
    const file = $('#editAvatar').files[0];
    const finish = avatarUrl => {
      AnonDB.update(db => {
        const user = db.users.find(u => u.id === me.id);
        user.displayName = $('#editName').value.trim() || user.displayName;
        user.bio = $('#editBio').value.trim() || 'Пока без описания.';
        if (avatarUrl) user.avatarUrl = avatarUrl;
      });
      $('#profileDialog').close();
      renderAll();
      UI.toast('Профиль обновлён.');
    };
    if (!file) return finish('');
    const reader = new FileReader();
    reader.onload = () => finish(reader.result);
    reader.readAsDataURL(file);
  }

  function handleClick(event) {
    const target = event.target.closest('button');
    if (!target) return;
    if (target.dataset.page) navigate(target.dataset.page);
    if (target.id === 'closePeopleDialog') $('#peopleDialog')?.close();
    if (target.dataset.profileList) openProfilePeople(target.dataset.profileList);
    if (target.dataset.profile) { $('#peopleDialog')?.close(); navigate('profile', { profileUserId: target.dataset.profile }); }
    if (target.dataset.userName) {
      const user = AnonDB.load().users.find(u => u.username === target.dataset.userName.toLowerCase());
      if (user) navigate('profile', { profileUserId: user.id });
    }
    if (target.dataset.like) toggleLike(target.dataset.like);
    if (target.dataset.bookmark) toggleBookmark(target.dataset.bookmark);
    if (target.dataset.repost) repost(target.dataset.repost);
    if (target.dataset.delete) deletePost(target.dataset.delete);
    if (target.dataset.commentToggle) $(`#comments-${target.dataset.commentToggle}`)?.classList.toggle('hidden');
    if (target.dataset.notification) { AnonDB.update(db => { const n = db.notifications.find(x => x.id === target.dataset.notification); if (n) n.read = true; }); renderAll(); }
    if (target.dataset.search) { state.query = target.dataset.search; $('#searchInput').value = state.query; navigate('explore'); }
  }

  function handleSubmit(event) {
    const form = event.target.closest('[data-comment-form]');
    if (!form) return;
    event.preventDefault();
    const input = form.querySelector('input');
    const content = input.value.trim();
    if (content) addComment(form.dataset.commentForm, content);
  }

  return { state, navigate, renderAll, createPost, updateCharCount, toggleFollow, saveProfile, handleClick, handleSubmit };
})();






