require('dotenv').config();

const path = require('path');
const express = require('express');
const sgMail = require('@sendgrid/mail');
const db = require('./database');

// Функции для работы с БД (асинхронные для PG, синхронные для SQLite)
const isPg = db.constructor.name === 'Pool';

async function dbQuery(sql, params = []) {
  if (isPg) {
    const result = await db.query(sql, params);
    return result.rows || result;
  } else {
    if (sql.trim().toUpperCase().startsWith('SELECT')) {
      return db.prepare(sql).all(...params);
    } else {
      return db.prepare(sql).run(...params);
    }
  }
}
const crypto = require('crypto');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const codes = new Map();

app.use(express.json({ limit: '1mb' }));
app.use(express.static(__dirname));

if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

function makeCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function cleanupCodes() {
  const now = Date.now();
  for (const [id, item] of codes.entries()) {
    if (now > item.expiresAt) codes.delete(id);
  }
}

app.post('/api/send-code', async (req, res) => {
  cleanupCodes();
  const email = String(req.body.email || '').trim().toLowerCase();
  const purpose = String(req.body.purpose || 'login');

  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return res.status(400).json({ error: 'Некорректная почта' });
  }
  if (!process.env.SENDGRID_API_KEY || !process.env.SENDGRID_FROM_EMAIL) {
    return res.status(500).json({ error: 'SendGrid не настроен на сервере' });
  }

  const code = makeCode();
  const verificationId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  codes.set(verificationId, {
    email,
    purpose,
    code,
    attempts: 0,
    expiresAt: Date.now() + 5 * 60 * 1000
  });

  try {
    await sgMail.send({
      to: email,
      from: process.env.SENDGRID_FROM_EMAIL,
      subject: 'Код подтверждения Анон',
      text: `Ваш код подтверждения: ${code}. Он действует 5 минут.`,
      html: `<p>Ваш код подтверждения: <strong>${code}</strong></p><p>Он действует 5 минут.</p>`
    });
    res.json({ success: true, verificationId });
  } catch (error) {
    console.error('SendGrid error:', error.response?.body || error.message || error);
    codes.delete(verificationId);
    res.status(500).json({ error: 'Не удалось отправить письмо' });
  }
});

app.post('/api/verify-code', (req, res) => {
  cleanupCodes();
  const verificationId = String(req.body.verificationId || '');
  const code = String(req.body.code || '').trim();
  const item = codes.get(verificationId);

  if (!item) return res.status(400).json({ error: 'Код устарел или не найден' });
  item.attempts += 1;
  if (item.attempts > 5) {
    codes.delete(verificationId);
    return res.status(429).json({ error: 'Слишком много попыток' });
  }
  if (item.code !== code) return res.status(400).json({ error: 'Неверный код' });

  codes.delete(verificationId);
  res.json({ success: true, email: item.email, purpose: item.purpose });
});

// API для регистрации пользователя
app.post('/api/register', async (req, res) => {
  const { email, username, displayName } = req.body;
  if (!email || !username || !displayName) {
    return res.status(400).json({ error: 'Все поля обязательны' });
  }

  try {
    const userId = crypto.randomUUID();
    await dbQuery('INSERT INTO users (id, username, email, verified) VALUES (?, ?, ?, 1)', [userId, username, email]);
    res.json({ success: true, userId });
  } catch (error) {
    const errorCode = isPg ? error.code : error.code;
    if (errorCode === '23505' || errorCode === 'SQLITE_CONSTRAINT_UNIQUE') {
      res.status(400).json({ error: 'Пользователь с таким email или username уже существует' });
    } else {
      res.status(500).json({ error: 'Ошибка сервера' });
    }
  }
});

// API для логина (проверка email)
app.post('/api/login', async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Email обязателен' });
  }

  try {
    const users = await dbQuery('SELECT id, username FROM users WHERE email = ?', [email]);
    const user = Array.isArray(users) ? users[0] : users;
    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    res.json({ success: true, userId: user.id, username: user.username });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// API для получения пользователей (для админки или поиска)
app.get('/api/users', async (req, res) => {
  try {
    const users = await dbQuery('SELECT id, username, email, verified, createdAt FROM users');
    res.json({ success: true, users: Array.isArray(users) ? users : [users] });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// API для создания поста
app.post('/api/posts', async (req, res) => {
  const { userId, username, content, tags, media } = req.body;
  if (!userId || !username || !content) {
    return res.status(400).json({ error: 'userId, username и content обязательны' });
  }

  try {
    const result = await dbQuery('INSERT INTO posts (userId, username, content, tags, media) VALUES (?, ?, ?, ?, ?)', [userId, username, content, JSON.stringify(tags || []), JSON.stringify(media || [])]);
    const postId = isPg ? result[0].id : result.lastInsertRowid;
    res.json({ success: true, postId });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// API для получения постов
app.get('/api/posts', async (req, res) => {
  try {
    const posts = await dbQuery('SELECT * FROM posts ORDER BY createdAt DESC');
    const processedPosts = (Array.isArray(posts) ? posts : [posts]).map(post => ({
      ...post,
      tags: JSON.parse(post.tags),
      media: JSON.parse(post.media)
    }));
    res.json({ success: true, posts: processedPosts });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.get('/api/state', async (req, res) => {
  try {
    if (isPg) {
      const result = await db.query('SELECT value FROM app_state WHERE key = $1', ['main']);
      const row = result.rows[0];
      return res.json({ success: true, state: row ? JSON.parse(row.value) : null });
    }

    const row = db.prepare('SELECT value FROM app_state WHERE key = ?').get('main');
    res.json({ success: true, state: row ? JSON.parse(row.value) : null });
  } catch (error) {
    console.error('State load error:', error);
    res.status(500).json({ error: 'Не удалось загрузить общую базу' });
  }
});

app.put('/api/state', async (req, res) => {
  try {
    const state = req.body?.state;
    if (!state || typeof state !== 'object') {
      return res.status(400).json({ error: 'Некорректное состояние базы' });
    }

    const value = JSON.stringify(state);
    if (isPg) {
      await db.query(
        `INSERT INTO app_state (key, value, updatedAt)
         VALUES ($1, $2, CURRENT_TIMESTAMP)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updatedAt = CURRENT_TIMESTAMP`,
        ['main', value]
      );
    } else {
      db.prepare(
        `INSERT INTO app_state (key, value, updatedAt)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = datetime('now')`
      ).run('main', value);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('State save error:', error);
    res.status(500).json({ error: 'Не удалось сохранить общую базу' });
  }
});

// --- НОВЫЙ МАРШРУТ: выдача прав администратора ---
app.post('/api/make-admin', (req, res) => {
  const { secret } = req.body || {};

  if (!secret || secret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: 'Неверный секретный ключ' });
  }

  // Сервер просто подтверждает право. Саму роль меняет клиент.
  res.json({ success: true, message: 'Доступ подтверждён' });
});
// -------------------------------------------------

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Анон запущен: http://localhost:${PORT}`);
});
