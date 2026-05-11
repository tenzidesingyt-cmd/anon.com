const Admin = (() => {
  function render() {
    const db = AnonDB.load();
    const me = AnonDB.currentUser();
    if (!me || (me.role !== 'ADMIN' && me.role !== 'MODERATOR')) return;
    $('#adminUsers').textContent = db.users.length;
    $('#adminOnline').textContent = db.users.filter(u => u.online).length;
    $('#adminAuths').textContent = db.loginCount || 0;
    $('#adminPosts').textContent = db.posts.length;
    $('#adminUsersList').innerHTML = db.users.map(user => {
      const posts = db.posts.filter(p => p.authorId === user.id).length;
      const isCurrent = user.id === me.id;
      const isAdmin = user.role === 'ADMIN';
      return `<div class="admin-user">
        ${UI.avatar(user, 'avatar')}
        <div><b>${UI.escape(user.displayName)}</b><span>@${UI.escape(user.username)} · ${user.role} · ${user.online ? 'онлайн' : 'офлайн'} · ${posts} постов</span></div>
        <div class="admin-controls">
          <label class="admin-checkbox">
            <input type="checkbox" data-admin-role="${user.id}" ${isAdmin ? 'checked' : ''} ${isCurrent ? 'disabled' : ''}>
            Админ
          </label>
          ${user.role !== 'ADMIN' ? `<button class="danger-btn" data-admin-ban="${user.id}" type="button">Заблокировать</button>` : ''}
        </div>
      </div>`;
    }).join('');
  }

  function handleChange(event) {
    const id = event.target.closest('[data-admin-role]')?.dataset.adminRole;
    if (!id) return;
    const checked = event.target.checked;
    if (!confirm(`${checked ? 'Выдать' : 'Снять'} права администратора у пользователя?`)) {
      event.target.checked = !checked;
      return;
    }
    AnonDB.update(db => {
      const user = db.users.find(u => u.id === id);
      if (user) user.role = checked ? 'ADMIN' : 'USER';
    });
    Pages.renderAll();
    UI.toast(checked ? 'Пользователь получил права администратора.' : 'Права администратора сняты.');
  }

  function handleClick(event) {
    const id = event.target.closest('[data-admin-ban]')?.dataset.adminBan;
    if (!id) return;
    if (!confirm('Удалить пользователя и все его посты?')) return;
    AnonDB.update(db => {
      db.posts = db.posts.filter(p => p.authorId !== id);
      db.users = db.users.filter(u => u.id !== id);
      db.follows = db.follows.filter(f => f.followerId !== id && f.followingId !== id);
      db.notifications = db.notifications.filter(n => n.userId !== id && n.sourceUserId !== id);
    });
    Pages.renderAll();
    UI.toast('Пользователь заблокирован.');
  }

  return { render, handleClick, handleChange };
})();
