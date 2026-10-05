'use strict';
// GIS Team Task Management System — zero-dependency server (Node >= 22.5, built-in SQLite)
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'tms.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user','lead','supervisor')),
  pass_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, must_change INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, description TEXT DEFAULT '',
  category TEXT NOT NULL DEFAULT 'Other', project TEXT DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'medium', status TEXT NOT NULL DEFAULT 'todo',
  due_date TEXT, est_hours REAL, actual_hours REAL,
  assigned_to INTEGER REFERENCES users(id), created_by INTEGER NOT NULL REFERENCES users(id),
  source TEXT NOT NULL DEFAULT 'assigned', completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS comments (id INTEGER PRIMARY KEY, task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id), body TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS activity (id INTEGER PRIMARY KEY, task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id), action TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS notifications (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
  task_id INTEGER, message TEXT NOT NULL, read INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
`);

const STATUSES = ['todo', 'in_progress', 'review', 'done'];
const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const CATEGORIES = ['Digitizing', 'Georeferencing', 'Field Survey', 'Data QA/QC', 'Cartography', 'Spatial Analysis',
  'Data Management', 'Remote Sensing', 'Web GIS', 'Reporting', 'Other'];
const ROLES = ['user', 'lead', 'supervisor'];
const isManager = u => u.role === 'lead' || u.role === 'supervisor';

// ---------- helpers ----------
const hashPw = pw => { const s = crypto.randomBytes(16).toString('hex'); return s + ':' + crypto.scryptSync(pw, s, 64).toString('hex'); };
const checkPw = (pw, h) => {
  const [s, k] = h.split(':'); const t = crypto.scryptSync(pw, s, 64);
  return crypto.timingSafeEqual(t, Buffer.from(k, 'hex'));
};
const today = () => new Date().toISOString().slice(0, 10);
const nowSql = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const bad = m => new HttpError(400, m), forbid = m => new HttpError(403, m || 'Not allowed'), nf = () => new HttpError(404, 'Not found');

function notify(userId, taskId, message, exceptUserId) {
  if (!userId || userId === exceptUserId) return;
  db.prepare('INSERT INTO notifications (user_id, task_id, message) VALUES (?,?,?)').run(userId, taskId, message);
}
function log(taskId, userId, action) { db.prepare('INSERT INTO activity (task_id, user_id, action) VALUES (?,?,?)').run(taskId, userId, action); }

// Seed first-run: the GIS team + tasks imported from the daily report (seed/daily-report.json).
// Everyone starts with INITIAL_PASSWORD (if set) or a random one printed once to the log; all must change it at first sign-in.
if (db.prepare('SELECT COUNT(*) c FROM users').get().c === 0) {
  const team = [['mudassir', 'Mudassir', 'supervisor'], ['abdur', 'Abdur Rehman', 'lead'], ['iliyan', 'Iliyan', 'user'],
    ['laiba', 'Laiba', 'user'], ['wafa', 'Wafa', 'user'], ['rimsha', 'Rimsha', 'user'], ['haroon', 'Haroon', 'user']];
  const ins = db.prepare('INSERT INTO users (username, name, role, pass_hash, must_change) VALUES (?,?,?,?,1)');
  const ids = {}, creds = [];
  for (const [u, n, r] of team) {
    const pw = process.env.INITIAL_PASSWORD || crypto.randomBytes(9).toString('base64').replace(/[+/=]/g, 'x').slice(0, 10);
    ids[n] = Number(ins.run(u, n, r, hashPw(pw)).lastInsertRowid); creds.push(`  ${u.padEnd(9)} ${pw}`);
  }
  if (!process.env.INITIAL_PASSWORD) console.log('First run — temporary passwords (shown once):\n' + creds.join('\n'));
  else console.log('First run — all users created with INITIAL_PASSWORD.');
  const seedFile = path.join(__dirname, 'seed', 'daily-report.json');
  if (fs.existsSync(seedFile)) {
    const iso = serial => new Date(Date.UTC(1899, 11, 30) + serial * 864e5).toISOString().slice(0, 10);
    const t = db.prepare(`INSERT INTO tasks (title, category, priority, status, assigned_to, created_by, source, completed_at, created_at, updated_at)
      VALUES (?, 'Other', 'medium', 'done', ?, ?, 'self', ?, ?, ?)`);
    const a = db.prepare('INSERT INTO activity (task_id, user_id, action, created_at) VALUES (?,?,?,?)');
    for (const r of JSON.parse(fs.readFileSync(seedFile, 'utf8'))) {
      const uid = ids[r.name], title = String(r.task).trim().replace(/\s+/g, ' ');
      if (!uid || !title || /^absent$/i.test(title)) continue;
      const ts = iso(r.date) + ' 12:00:00';
      const id = Number(t.run(title[0].toUpperCase() + title.slice(1), uid, uid, ts, ts, ts).lastInsertRowid);
      a.run(id, uid, 'logged a completed task', ts);
    }
  }
}

// ---------- queries ----------
const TASK_SELECT = `SELECT t.*, a.name AS assignee_name, c.name AS creator_name,
  (SELECT COUNT(*) FROM comments WHERE task_id = t.id) AS comment_count,
  CASE WHEN t.status != 'done' AND t.due_date IS NOT NULL AND t.due_date < date('now') THEN 1 ELSE 0 END AS overdue
  FROM tasks t LEFT JOIN users a ON a.id = t.assigned_to JOIN users c ON c.id = t.created_by`;

function visibleTasks(user, q) {
  const where = [], args = [];
  if (!isManager(user)) { where.push('t.assigned_to = ?'); args.push(user.id); }
  if (q.status) { where.push('t.status = ?'); args.push(q.status); }
  if (q.priority) { where.push('t.priority = ?'); args.push(q.priority); }
  if (q.category) { where.push('t.category = ?'); args.push(q.category); }
  if (q.assignee) { where.push(q.assignee === 'none' ? 't.assigned_to IS NULL' : 't.assigned_to = ?'); if (q.assignee !== 'none') args.push(+q.assignee); }
  if (q.source) { where.push('t.source = ?'); args.push(q.source); }
  if (q.overdue === '1') where.push("t.status != 'done' AND t.due_date < date('now')");
  if (q.from) { where.push('date(t.created_at) >= ?'); args.push(q.from); }
  if (q.to) { where.push('date(t.created_at) <= ?'); args.push(q.to); }
  if (q.q) { where.push('(t.title LIKE ? OR t.description LIKE ? OR t.project LIKE ?)'); const l = `%${q.q}%`; args.push(l, l, l); }
  const sql = `${TASK_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY CASE t.status WHEN 'done' THEN 1 ELSE 0 END, overdue DESC,
    CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, t.due_date IS NULL, t.due_date, t.id DESC`;
  return db.prepare(sql).all(...args);
}
function getTask(id) { return db.prepare(`${TASK_SELECT} WHERE t.id = ?`).get(id); }
function canView(user, t) { return isManager(user) || t.assigned_to === user.id; }

function cleanTaskInput(b, partial) {
  const o = {};
  const str = (k, max) => { if (b[k] !== undefined) { o[k] = String(b[k] ?? '').trim().slice(0, max); } };
  str('title', 200); str('description', 5000); str('project', 120);
  if (!partial && !o.title) throw bad('Title is required');
  if (partial && 'title' in o && !o.title) throw bad('Title is required');
  if (b.category !== undefined) { if (!CATEGORIES.includes(b.category)) throw bad('Invalid category'); o.category = b.category; }
  if (b.priority !== undefined) { if (!PRIORITIES.includes(b.priority)) throw bad('Invalid priority'); o.priority = b.priority; }
  if (b.status !== undefined) { if (!STATUSES.includes(b.status)) throw bad('Invalid status'); o.status = b.status; }
  if (b.due_date !== undefined) { if (b.due_date && !/^\d{4}-\d{2}-\d{2}$/.test(b.due_date)) throw bad('Invalid due date'); o.due_date = b.due_date || null; }
  for (const k of ['est_hours', 'actual_hours']) if (b[k] !== undefined) {
    if (b[k] === '' || b[k] === null) o[k] = null; else { const n = Number(b[k]); if (!isFinite(n) || n < 0 || n > 10000) throw bad('Invalid hours'); o[k] = n; }
  }
  if (b.assigned_to !== undefined) o.assigned_to = b.assigned_to ? +b.assigned_to : null;
  return o;
}

const LABEL = { todo: 'To Do', in_progress: 'In Progress', review: 'In Review', done: 'Done' };

// ---------- route handlers ----------
const routes = [];
const route = (method, pattern, opts, fn) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), opts, fn });

route('POST', '/api/login', { public: true }, (ctx) => {
  const { username, password } = ctx.body;
  const key = ctx.ip + '|' + String(username).toLowerCase();
  const rec = loginAttempts.get(key) || { n: 0, until: 0 };
  if (rec.until > Date.now()) throw new HttpError(429, 'Too many attempts. Try again in a few minutes.');
  const u = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(String(username || ''));
  if (!u || !u.active || !checkPw(String(password || ''), u.pass_hash)) {
    rec.n++; if (rec.n >= 8) { rec.until = Date.now() + 5 * 60e3; rec.n = 0; } loginAttempts.set(key, rec);
    throw new HttpError(401, 'Invalid username or password');
  }
  loginAttempts.delete(key);
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(token, u.id, Date.now() + 7 * 864e5);
  ctx.setCookie = `tms_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${7 * 86400}${ctx.secure ? '; Secure' : ''}`;
  return publicUser(u);
});
const loginAttempts = new Map();
route('POST', '/api/logout', {}, (ctx) => {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(ctx.token);
  ctx.setCookie = 'tms_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0';
  return { ok: true };
});
const publicUser = u => ({ id: u.id, username: u.username, name: u.name, role: u.role, active: !!u.active, must_change: !!u.must_change });
route('GET', '/api/me', {}, ctx => ({
  user: publicUser(ctx.user), statuses: STATUSES, priorities: PRIORITIES, categories: CATEGORIES,
}));
route('POST', '/api/password', {}, ctx => {
  const { current, next } = ctx.body;
  if (!checkPw(String(current || ''), ctx.user.pass_hash)) throw bad('Current password is incorrect');
  if (String(next || '').length < 8) throw bad('New password must be at least 8 characters');
  db.prepare('UPDATE users SET pass_hash = ?, must_change = 0 WHERE id = ?').run(hashPw(next), ctx.user.id);
  return { ok: true };
});

// users
route('GET', '/api/users', {}, ctx => {
  const rows = db.prepare('SELECT id, username, name, role, active FROM users ORDER BY active DESC, name').all();
  return rows.map(r => ({ ...r, active: !!r.active }));
});
route('POST', '/api/users', { roles: ['lead', 'supervisor'] }, ctx => {
  const { username, name, role, password } = ctx.body;
  if (!/^[a-zA-Z0-9._-]{3,30}$/.test(username || '')) throw bad('Username must be 3–30 characters (letters, numbers, . _ -)');
  if (!String(name || '').trim()) throw bad('Name is required');
  if (!ROLES.includes(role)) throw bad('Invalid role');
  if (String(password || '').length < 8) throw bad('Password must be at least 8 characters');
  if (db.prepare('SELECT 1 FROM users WHERE username = ? COLLATE NOCASE').get(username)) throw bad('Username already exists');
  const r = db.prepare('INSERT INTO users (username, name, role, pass_hash, must_change) VALUES (?,?,?,?,1)').run(username, name.trim(), role, hashPw(password));
  return { id: Number(r.lastInsertRowid) };
});
route('PATCH', '/api/users/:id', { roles: ['lead', 'supervisor'] }, ctx => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(+ctx.params.id);
  if (!u) throw nf();
  const b = ctx.body;
  if (u.id === ctx.user.id && (b.active === false || (b.role && b.role !== ctx.user.role))) throw bad("You can't deactivate or demote yourself");
  if (b.name !== undefined) { if (!String(b.name).trim()) throw bad('Name is required'); db.prepare('UPDATE users SET name = ? WHERE id = ?').run(b.name.trim(), u.id); }
  if (b.role !== undefined) { if (!ROLES.includes(b.role)) throw bad('Invalid role'); db.prepare('UPDATE users SET role = ? WHERE id = ?').run(b.role, u.id); }
  if (b.active !== undefined) {
    db.prepare('UPDATE users SET active = ? WHERE id = ?').run(b.active ? 1 : 0, u.id);
    if (!b.active) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
  }
  if (b.password) {
    if (String(b.password).length < 8) throw bad('Password must be at least 8 characters');
    db.prepare('UPDATE users SET pass_hash = ?, must_change = 1 WHERE id = ?').run(hashPw(b.password), u.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
  }
  return { ok: true };
});

// tasks
route('GET', '/api/tasks', {}, ctx => visibleTasks(ctx.user, ctx.query));
route('POST', '/api/tasks', {}, ctx => {
  const b = ctx.body, me = ctx.user, o = cleanTaskInput(b, false);
  let assignee, source;
  if (isManager(me)) {
    assignee = o.assigned_to ?? null; source = assignee === me.id ? 'self' : 'assigned';
    if (assignee && !db.prepare('SELECT 1 FROM users WHERE id = ? AND active = 1').get(assignee)) throw bad('Assignee not found');
  } else { assignee = me.id; source = 'self'; }
  const status = o.status || 'todo';
  const completed = status === 'done' ? nowSql() : null;
  if (status === 'done' && source !== 'self' && !isManager(me)) throw forbid();
  const r = db.prepare(`INSERT INTO tasks (title, description, category, project, priority, status, due_date, est_hours, actual_hours, assigned_to, created_by, source, completed_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(o.title, o.description || '', o.category || 'Other', o.project || '', o.priority || 'medium', status,
    o.due_date ?? null, o.est_hours ?? null, o.actual_hours ?? null, assignee, me.id, source, completed);
  const id = Number(r.lastInsertRowid);
  log(id, me.id, source === 'self' && status === 'done' ? 'logged a completed task' : 'created the task');
  if (assignee) notify(assignee, id, `${me.name} assigned you: ${o.title}`, me.id);
  return getTask(id);
});
route('GET', '/api/tasks/:id', {}, ctx => {
  const t = getTask(+ctx.params.id);
  if (!t || !canView(ctx.user, t)) throw nf();
  t.comments = db.prepare('SELECT c.*, u.name AS user_name FROM comments c JOIN users u ON u.id = c.user_id WHERE task_id = ? ORDER BY c.id').all(t.id);
  t.activity = db.prepare('SELECT a.*, u.name AS user_name FROM activity a JOIN users u ON u.id = a.user_id WHERE task_id = ? ORDER BY a.id DESC').all(t.id);
  return t;
});
route('PATCH', '/api/tasks/:id', {}, ctx => {
  const t = getTask(+ctx.params.id), me = ctx.user;
  if (!t || !canView(me, t)) throw nf();
  let o = cleanTaskInput(ctx.body, true);
  const mgr = isManager(me);
  const own = t.created_by === me.id && t.assigned_to === me.id;
  if (!mgr) {
    // Users: full edit on tasks they logged themselves; on assigned tasks only progress fields.
    const allowed = own ? ['title', 'description', 'category', 'project', 'priority', 'status', 'due_date', 'est_hours', 'actual_hours']
      : ['status', 'actual_hours', 'description'];
    for (const k of Object.keys(o)) if (!allowed.includes(k)) throw forbid(`You can't change "${k}" on a task assigned to you`);
    if (!own && o.status === 'done') throw forbid('Submit for review — a team lead or supervisor marks assigned tasks as done');
  }
  if (mgr && o.assigned_to !== undefined && o.assigned_to) {
    if (!db.prepare('SELECT 1 FROM users WHERE id = ? AND active = 1').get(o.assigned_to)) throw bad('Assignee not found');
  }
  const changes = [];
  if (o.status && o.status !== t.status) {
    changes.push(`changed status from ${LABEL[t.status]} to ${LABEL[o.status]}`);
    o.completed_at = o.status === 'done' ? nowSql() : null;
  }
  if (o.assigned_to !== undefined && o.assigned_to !== t.assigned_to) {
    const n = o.assigned_to ? db.prepare('SELECT name FROM users WHERE id = ?').get(o.assigned_to).name : 'nobody';
    changes.push(`reassigned to ${n}`);
  }
  for (const k of ['title', 'priority', 'due_date', 'category', 'project', 'est_hours', 'actual_hours', 'description'])
    if (o[k] !== undefined && o[k] !== t[k] && !(o[k] === '' && !t[k])) changes.push(k === 'description' ? 'edited the description' : `updated ${k.replace('_', ' ')}`);
  const keys = Object.keys(o);
  if (keys.length) {
    db.prepare(`UPDATE tasks SET ${keys.map(k => k + ' = ?').join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...keys.map(k => o[k]), t.id);
  }
  if (changes.length) log(t.id, me.id, [...new Set(changes)].join('; '));
  // notifications
  if (o.status && o.status !== t.status) {
    const msg = `${me.name} moved "${t.title}" to ${LABEL[o.status]}`;
    if (o.status === 'review') db.prepare("SELECT id FROM users WHERE role IN ('lead','supervisor') AND active = 1").all().forEach(m => notify(m.id, t.id, msg, me.id));
    else { notify(t.assigned_to, t.id, msg, me.id); if (t.created_by !== t.assigned_to) notify(t.created_by, t.id, msg, me.id); }
  }
  if (o.assigned_to && o.assigned_to !== t.assigned_to) notify(o.assigned_to, t.id, `${me.name} assigned you: ${t.title}`, me.id);
  return getTask(t.id);
});
route('DELETE', '/api/tasks/:id', {}, ctx => {
  const t = getTask(+ctx.params.id), me = ctx.user;
  if (!t || !canView(me, t)) throw nf();
  const own = t.created_by === me.id && t.assigned_to === me.id;
  if (!isManager(me) && !own) throw forbid();
  db.prepare('DELETE FROM tasks WHERE id = ?').run(t.id);
  return { ok: true };
});
route('POST', '/api/tasks/:id/comments', {}, ctx => {
  const t = getTask(+ctx.params.id), me = ctx.user;
  if (!t || !canView(me, t)) throw nf();
  const body = String(ctx.body.body || '').trim().slice(0, 3000);
  if (!body) throw bad('Comment is empty');
  db.prepare('INSERT INTO comments (task_id, user_id, body) VALUES (?,?,?)').run(t.id, me.id, body);
  const msg = `${me.name} commented on "${t.title}"`;
  new Set([t.assigned_to, t.created_by]).forEach(id => notify(id, t.id, msg, me.id));
  return { ok: true };
});

// notifications
route('GET', '/api/notifications', {}, ctx => ({
  items: db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50').all(ctx.user.id),
  unread: db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND read = 0').get(ctx.user.id).c,
}));
route('POST', '/api/notifications/read', {}, ctx => { db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(ctx.user.id); return { ok: true }; });

// stats / dashboard
route('GET', '/api/stats', {}, ctx => {
  const me = ctx.user, mgr = isManager(me);
  const scope = mgr && ctx.query.scope !== 'mine' ? '' : 'WHERE assigned_to = ' + me.id;
  const and = scope ? ' AND ' : ' WHERE ';
  const one = sql => db.prepare(sql).get().c;
  const stats = {
    byStatus: db.prepare(`SELECT status, COUNT(*) n FROM tasks ${scope} GROUP BY status`).all(),
    byCategory: db.prepare(`SELECT category, COUNT(*) n, ROUND(COALESCE(SUM(actual_hours),0),1) hours FROM tasks ${scope} GROUP BY category ORDER BY n DESC`).all(),
    overdue: one(`SELECT COUNT(*) c FROM tasks ${scope}${and}status != 'done' AND due_date < date('now')`),
    dueSoon: one(`SELECT COUNT(*) c FROM tasks ${scope}${and}status != 'done' AND due_date BETWEEN date('now') AND date('now','+3 days')`),
    doneThisWeek: one(`SELECT COUNT(*) c FROM tasks ${scope}${and}status = 'done' AND completed_at >= datetime('now','-7 days')`),
    hoursThisWeek: db.prepare(`SELECT ROUND(COALESCE(SUM(actual_hours),0),1) h FROM tasks ${scope}${and}status = 'done' AND completed_at >= datetime('now','-7 days')`).get().h,
    awaitingReview: one(`SELECT COUNT(*) c FROM tasks ${scope}${and}status = 'review'`),
    unassigned: mgr ? one('SELECT COUNT(*) c FROM tasks WHERE assigned_to IS NULL AND status != \'done\'') : 0,
    completedPerDay: db.prepare(`SELECT date(completed_at) d, COUNT(*) n FROM tasks ${scope}${and}status = 'done' AND completed_at >= datetime('now','-13 days') GROUP BY d`).all(),
  };
  if (mgr) stats.workload = db.prepare(`SELECT u.id, u.name,
    SUM(t.status = 'todo') todo, SUM(t.status = 'in_progress') in_progress, SUM(t.status = 'review') review,
    SUM(t.status = 'done') done, SUM(t.status != 'done' AND t.due_date < date('now')) overdue,
    ROUND(COALESCE(SUM(CASE WHEN t.status = 'done' THEN t.actual_hours END),0),1) hours_done,
    SUM(t.status = 'done' AND t.source = 'self') self_logged
    FROM users u LEFT JOIN tasks t ON t.assigned_to = u.id WHERE u.active = 1 AND u.role = 'user' GROUP BY u.id ORDER BY u.name`).all();
  return stats;
});

// CSV export (managers: everything, users: their own)
route('GET', '/api/export.csv', {}, ctx => {
  const rows = visibleTasks(ctx.user, ctx.query);
  const cols = ['id', 'title', 'category', 'project', 'priority', 'status', 'due_date', 'est_hours', 'actual_hours', 'assignee_name', 'creator_name', 'source', 'created_at', 'completed_at', 'description'];
  const esc = v => { v = v == null ? '' : String(v); if (/^[=+\-@]/.test(v)) v = "'" + v; return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  ctx.raw = { type: 'text/csv; charset=utf-8', filename: `gis-tasks-${today()}.csv`, body: '﻿' + [cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\r\n') };
});

// ---------- server ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const PUBLIC = path.join(__dirname, 'public');
const SEC = {
  'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'",
};

function parseCookies(h) { const o = {}; (h || '').split(/;\s*/).forEach(p => { const i = p.indexOf('='); if (i > 0) o[p.slice(0, i)] = p.slice(i + 1); }); return o; }
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 1e6) { reject(new HttpError(413, 'Payload too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}); } catch { reject(bad('Invalid JSON')); } });
  });
}
const send = (res, code, body, headers = {}) => { res.writeHead(code, { ...SEC, ...headers }); res.end(body); };
const sendJson = (res, code, obj, headers = {}) => send(res, code, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });

async function handleApi(req, res, url) {
  const r = routes.find(r => r.method === req.method && r.re.test(url.pathname));
  if (!r) throw nf();
  const ctx = { params: r.re.exec(url.pathname).groups || {}, query: Object.fromEntries(url.searchParams), ip: req.socket.remoteAddress };
  const cookies = parseCookies(req.headers.cookie);
  ctx.token = cookies.tms_session; ctx.secure = req.headers['x-forwarded-proto'] === 'https';
  if (!r.opts.public) {
    const s = ctx.token && db.prepare('SELECT * FROM sessions WHERE token = ? AND expires > ?').get(ctx.token, Date.now());
    const u = s && db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(s.user_id);
    if (!u) throw new HttpError(401, 'Please sign in');
    ctx.user = u;
    if (r.opts.roles && !r.opts.roles.includes(u.role)) throw forbid();
  }
  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) {
    // CSRF defence in depth: same-origin only
    const origin = req.headers.origin;
    if (origin && new URL(origin).host !== req.headers.host) throw forbid('Cross-origin request blocked');
    ctx.body = await readBody(req);
  } else ctx.body = {};
  const out = r.fn(ctx);
  const extra = ctx.setCookie ? { 'Set-Cookie': ctx.setCookie } : {};
  if (ctx.raw) return send(res, 200, ctx.raw.body, { 'Content-Type': ctx.raw.type, 'Content-Disposition': `attachment; filename="${ctx.raw.filename}"`, ...extra });
  sendJson(res, 200, out, extra);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
    let rel = decodeURIComponent(url.pathname); if (rel === '/') rel = '/index.html';
    const file = path.normalize(path.join(PUBLIC, rel));
    if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) throw nf();
    send(res, 200, fs.readFileSync(file), { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  } catch (e) {
    if (e instanceof HttpError) return sendJson(res, e.code, { error: e.message });
    console.error(e); sendJson(res, 500, { error: 'Server error' });
  }
});

setInterval(() => db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now()), 3600e3).unref();
server.listen(PORT, () => console.log(`GIS TMS running at http://localhost:${PORT}`));
