'use strict';
// ---------- tiny helpers ----------
class Safe { constructor(s) { this.s = s; } toString() { return this.s; } }
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ESC[c]);
const raw = s => new Safe(s);
const h = (strs, ...vals) => new Safe(strs.reduce((o, s, i) => o + s + (i < vals.length ? part(vals[i]) : ''), ''));
const part = v => Array.isArray(v) ? v.map(part).join('') : v instanceof Safe ? v.s : esc(v);
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const ICON = {
  dash: 'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z',
  list: 'M4 6h16M4 12h16M4 18h10', board: 'M4 4h5v16H4zM10 4h5v10h-5zM16 4h4v13h-4z',
  all: 'M3 5h18M3 10h18M3 15h18M3 20h18', team: 'M16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0 2c-2.3 0-7 1.2-7 3.5V19h14v-2.5C15 14.2 10.3 13 8 13zm8 0c-.3 0-.6 0-1 .1 1.2.8 2 1.9 2 3.4V19h6v-2.5c0-2.3-4.7-3.5-7-3.5z',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 2c-3.3 0-8 1.7-8 5v1h16v-1c0-3.3-4.7-5-8-5z',
  bell: 'M12 22a2 2 0 0 0 2-2h-4a2 2 0 0 0 2 2zm6-6V11a6 6 0 0 0-5-5.9V4a1 1 0 0 0-2 0v1.1A6 6 0 0 0 6 11v5l-2 2v1h16v-1l-2-2z',
  plus: 'M12 5v14M5 12h14', dl: 'M12 3v12m0 0l-4-4m4 4l4-4M4 20h16', moon: 'M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10z',
  menu: 'M4 6h16M4 12h16M4 18h16', out: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10', chat: 'M4 4h16v12H8l-4 4z',
};
const ico = (n, fill) => raw(`<svg viewBox="0 0 24 24" fill="${fill ? 'currentColor' : 'none'}" stroke="${fill ? 'none' : 'currentColor'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${ICON[n]}"/></svg>`);
const LOGO = raw('<svg viewBox="0 0 32 32"><rect width="32" height="32" rx="9" fill="#0f766e"/><path d="M16 6a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z" fill="#fff"/></svg>');

const S_LABEL = { todo: 'To Do', in_progress: 'In Progress', review: 'In Review', done: 'Done' };
const P_LABEL = { low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent' };
const R_LABEL = { user: 'GIS Analyst', lead: 'Team Lead', supervisor: 'Supervisor' };
const S_COLOR = { todo: 'var(--todo)', in_progress: 'var(--progress)', review: 'var(--review)', done: 'var(--done)' };

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    method: opts.method || 'GET', credentials: 'same-origin',
    headers: opts.body ? { 'Content-Type': 'application/json' } : {}, body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401 && path !== '/login' && path !== '/me') { state.user = null; render(); throw new Error('Please sign in'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}
function toast(msg, err) {
  const t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.textContent = msg;
  $('#toasts').append(t); setTimeout(() => t.remove(), 3500);
}
const guard = fn => async (...a) => { try { return await fn(...a); } catch (e) { toast(e.message, true); } };
const fmtDate = d => d ? new Date(d.length === 10 ? d + 'T00:00' : d.replace(' ', 'T') + 'Z').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const fmtDT = d => d ? new Date(d.replace(' ', 'T') + 'Z').toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
const todayStr = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
const AV = ['#0f766e', '#2563eb', '#9333ea', '#c2410c', '#be185d', '#4d7c0f', '#0369a1', '#a16207'];
const avatar = (name, size = 28) => {
  const i = (name || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const c = AV[[...(name || '?')].reduce((a, ch) => a + ch.charCodeAt(0), 0) % AV.length];
  return h`<span class="av" style="width:${size}px;height:${size}px;background:${c};font-size:${size * .4}px" title="${name}">${i}</span>`;
};
const pillS = s => h`<span class="pill s-${s}">${S_LABEL[s]}</span>`;
const pillP = p => h`<span class="pill p-${p}">${P_LABEL[p]}</span>`;
const dueLabel = t => !t.due_date ? raw('<span class="muted">No due date</span>') :
  t.overdue ? h`<span class="late">⚠ ${fmtDate(t.due_date)}</span>` : h`<span>${fmtDate(t.due_date)}</span>`;

// ---------- state ----------
const state = { user: null, meta: null, users: [], view: 'dashboard', tasks: [], filters: {}, stats: null, notifs: { items: [], unread: 0 }, navOpen: false, scope: 'all' };
const isMgr = () => state.user && state.user.role !== 'user';
const app = $('#app');
const theme = (() => { try { return localStorage.getItem('tms-theme'); } catch { return null; } })();
if (theme) document.documentElement.dataset.theme = theme;

// ---------- boot ----------
async function boot() {
  try { const m = await api('/me'); state.user = m.user; state.meta = m; await loadUsers(); } catch { state.user = null; }
  const v = location.hash.slice(2); if (v) state.view = v;
  render();
  setInterval(() => { if (state.user) pollNotifs(); }, 30000);
}
const loadUsers = async () => { state.users = await api('/users'); };
async function pollNotifs() { try { state.notifs = await api('/notifications'); const b = $('#bellcount'); if (b) { b.textContent = state.notifs.unread; b.classList.toggle('hidden', !state.notifs.unread); } } catch { } }

function render() {
  if (!state.user) return renderLogin();
  const views = viewsFor();
  if (!views.find(v => v.id === state.view)) state.view = 'dashboard';
  const nav = views.map(v => h`<a data-nav="${v.id}" class="${v.id === state.view ? 'active' : ''}">${ico(v.icon)} ${v.label}</a>`);
  app.innerHTML = h`<div class="shell">
    <aside class="side ${state.navOpen ? 'open' : ''}">
      <div class="logo">${LOGO}<div>GIS Team Tasks<div class="small muted" style="font-weight:400">Task management</div></div></div>
      <nav class="nav">${nav}</nav>
      <div class="me">
        <div style="display:flex;gap:10px;align-items:center">${avatar(state.user.name, 36)}
          <div style="min-width:0"><div style="font-weight:600;overflow:hidden;text-overflow:ellipsis">${state.user.name}</div><div class="small muted">${R_LABEL[state.user.role]}</div></div></div>
        <div style="display:flex;gap:6px;margin-top:10px">
          <button class="btn sm" data-act="password">Password</button>
          <button class="btn sm" data-act="theme" title="Toggle dark mode">${ico('moon')}</button>
          <button class="btn sm" data-act="logout" title="Sign out">${ico('out')}</button></div>
      </div>
    </aside>
    <main class="main"><div id="view"></div></main></div>`;
  loadView();
  if (state.user.must_change) passwordModal(true);
}
function viewsFor() {
  const v = [{ id: 'dashboard', label: 'Dashboard', icon: 'dash' }, { id: 'mine', label: 'My Tasks', icon: 'list' }, { id: 'board', label: 'Board', icon: 'board' }];
  if (isMgr()) v.push({ id: 'all', label: 'All Tasks', icon: 'all' }, { id: 'team', label: 'Team Workload', icon: 'team' });
  if (isMgr()) v.push({ id: 'users', label: 'Manage Users', icon: 'user' });
  v.push({ id: 'notifications', label: 'Notifications', icon: 'bell' });
  return v;
}
const loadView = guard(async () => {
  const el = $('#view'); if (!el) return;
  history.replaceState(null, '', '#/' + state.view);
  await pollNotifs();
  const V = { dashboard: vDashboard, mine: vTasks, all: vTasks, board: vBoard, team: vTeam, users: vUsers, notifications: vNotifs }[state.view];
  await V(el);
});
function header(title, sub, actions = '') {
  return h`<div class="top"><button class="btn icon menu-btn" data-act="menu">${ico('menu')}</button>
    <div class="grow"><h1>${title}</h1><div class="muted">${sub}</div></div>${actions}
    <button class="btn icon" data-nav="notifications" title="Notifications">${ico('bell')}<span id="bellcount" class="badge-dot ${state.notifs.unread ? '' : 'hidden'}">${state.notifs.unread}</span></button></div>`;
}
const newBtn = () => h`<button class="btn primary" data-act="new-task">${ico('plus')} ${isMgr() ? 'New task' : 'Add task'}</button>`;

// ---------- login ----------
function renderLogin() {
  app.innerHTML = h`<div class="login"><form class="card" id="login">
    <div style="text-align:center;margin-bottom:18px"><div style="width:52px;margin:0 auto 10px">${LOGO}</div><h1>GIS Team Tasks</h1><div class="muted">Sign in to continue</div></div>
    <div class="field"><label>Username</label><input name="username" autocomplete="username" autofocus required></div>
    <div class="field"><label>Password</label><input name="password" type="password" autocomplete="current-password" required></div>
    <div class="error" id="lerr"></div>
    <button class="btn primary" style="width:100%;justify-content:center">Sign in</button>
    </form></div>`;
  $('#login').onsubmit = async e => {
    e.preventDefault(); const f = new FormData(e.target);
    try {
      await api('/login', { method: 'POST', body: Object.fromEntries(f) });
      const m = await api('/me'); state.user = m.user; state.meta = m; await loadUsers(); state.view = 'dashboard'; render();
    } catch (err) { $('#lerr').textContent = err.message; }
  };
}

// ---------- dashboard ----------
const vDashboard = async el => {
  const mine = isMgr() && state.scope === 'mine';
  const [s, tasks] = await Promise.all([api('/stats' + (isMgr() && state.scope === 'mine' ? '?scope=mine' : '')), api('/tasks' + (mine ? '?assignee=' + state.user.id : ''))]);
  const total = s.byStatus.reduce((a, b) => a + b.n, 0);
  const cnt = k => s.byStatus.find(x => x.status === k)?.n || 0;
  const hr = new Date().getHours(); const greet = hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
  const days = [...Array(14)].map((_, i) => { const d = new Date(Date.now() - (13 - i) * 864e5); const k = new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); return { k, n: s.completedPerDay.find(x => x.d === k)?.n || 0, lbl: d.getDate() }; });
  const max = Math.max(1, ...days.map(d => d.n));
  const focus = tasks.filter(t => t.status !== 'done' && (t.overdue || (t.due_date && t.due_date <= new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10)) || t.priority === 'urgent')).slice(0, 6);
  el.innerHTML = h`${header(`${greet}, ${state.user.name.split(' ')[0]}`, isMgr() ? 'Here is how the team is doing.' : 'Here is where your work stands.',
    h`${isMgr() ? h`<select id="scope" style="width:auto"><option value="all" ${mine ? '' : 'selected'}>Whole team</option><option value="mine" ${mine ? 'selected' : ''}>Only mine</option></select>` : ''}${newBtn()}`)}
  <div class="grid stats">
    ${stat(total - cnt('done'), 'Open tasks', 'var(--progress)')}
    ${stat(s.overdue, 'Overdue', 'var(--urgent)', s.overdue > 0)}
    ${stat(s.dueSoon, 'Due in 3 days', 'var(--review)')}
    ${stat(s.awaitingReview, 'Awaiting review', 'var(--review)')}
    ${stat(s.doneThisWeek, 'Done this week', 'var(--done)')}
    ${stat(s.hoursThisWeek, 'Hours logged (7d)', 'var(--brand)')}
    ${isMgr() ? stat(s.unassigned, 'Unassigned', 'var(--todo)') : ''}
  </div>
  <div class="grid cols2">
    <div class="card"><h2>Status breakdown</h2>
      <div class="stack">${['todo', 'in_progress', 'review', 'done'].map(k => h`<span style="width:${total ? cnt(k) / total * 100 : 0}%;background:${raw(S_COLOR[k])}" title="${S_LABEL[k]}: ${cnt(k)}"></span>`)}</div>
      <div class="legend">${['todo', 'in_progress', 'review', 'done'].map(k => h`<span><i class="dot" style="background:${raw(S_COLOR[k])}"></i>${S_LABEL[k]} <b>${cnt(k)}</b></span>`)}</div>
      <h2 style="margin-top:22px">Completed — last 14 days</h2>
      <div class="bars">${days.map(d => h`<div title="${d.k}: ${d.n}"><span>${d.n || ''}</span><i style="height:${d.n / max * 80}%"></i><span>${d.lbl}</span></div>`)}</div></div>
  </div>
  <div class="card"><h2 style="margin-bottom:6px">Needs attention</h2>
    ${focus.length ? taskTable(focus, { compact: true }) : h`<div class="empty">🎉 Nothing overdue or urgent right now.</div>`}</div>`;
  const sc = $('#scope'); if (sc) sc.onchange = () => { state.scope = sc.value; loadView(); };
  bindTaskTable(el, tasks);
};
const stat = (n, l, c, warn) => h`<div class="card stat ${warn ? 'warn' : ''}" style="border-top:3px solid ${raw(c)}"><div class="n">${n}</div><div class="l">${l}</div></div>`;

// ---------- task list ----------
function taskTable(tasks, o = {}) {
  if (!tasks.length) return h`<div class="empty">No tasks found.</div>`;
  return h`<div class="tablewrap"><table><thead><tr><th>Task</th><th>Status</th><th>Priority</th>${isMgr() && !o.compact ? h`<th>Assignee</th>` : ''}<th>Due</th><th>Hours</th></tr></thead><tbody>
  ${tasks.map(t => h`<tr class="click" data-task="${t.id}">
    <td><div class="title">${t.title}</div><div class="small muted">${t.project ? h`<span class="tag">${t.project}</span>` : ''}
      ${t.source === 'self' ? h`<span class="tag" title="Logged by the analyst">self-logged</span>` : ''} ${t.comment_count ? h`· 💬 ${t.comment_count}` : ''}</div></td>
    <td>${statusControl(t)}</td><td>${pillP(t.priority)}</td>
    ${isMgr() && !o.compact ? h`<td>${t.assignee_name ? h`<span style="display:flex;align-items:center;gap:7px">${avatar(t.assignee_name, 24)}${t.assignee_name}</span>` : raw('<span class="muted">Unassigned</span>')}</td>` : ''}
    <td>${dueLabel(t)}</td><td>${t.actual_hours ?? '–'}${t.est_hours ? h`<span class="muted"> / ${t.est_hours}</span>` : ''}</td></tr>`)}
  </tbody></table></div>`;
}
const allowedStatuses = t => (isMgr() || (t.created_by === state.user.id && t.assigned_to === state.user.id)) ? ['todo', 'in_progress', 'review', 'done'] : ['todo', 'in_progress', 'review'];
const statusControl = t => (t.status === 'done' && !isMgr() && t.created_by !== state.user.id) ? pillS(t.status) :
  h`<select class="status-sel s-${t.status}" data-status="${t.id}">${allowedStatuses(t).concat(allowedStatuses(t).includes(t.status) ? [] : [t.status]).map(s => h`<option value="${s}" ${s === t.status ? 'selected' : ''}>${S_LABEL[s]}</option>`)}</select>`;

function bindTaskTable(el) {
  $$('[data-status]', el).forEach(s => {
    s.onclick = e => e.stopPropagation();
    s.onchange = guard(async () => { await api('/tasks/' + s.dataset.status, { method: 'PATCH', body: { status: s.value } }); toast('Status updated'); loadView(); });
  });
}
function filterBar() {
  const f = state.filters, sel = (k, opts, ph) => h`<select data-f="${k}"><option value="">${ph}</option>${opts.map(([v, l]) => h`<option value="${v}" ${String(f[k]) === String(v) ? 'selected' : ''}>${l}</option>`)}</select>`;
  return h`<div class="filters"><input data-f="q" placeholder="Search title, project…" value="${f.q || ''}">
    ${sel('status', Object.entries(S_LABEL), 'All statuses')}${sel('priority', Object.entries(P_LABEL), 'All priorities')}
    ${isMgr() && state.view === 'all' ? sel('assignee', [['none', 'Unassigned'], ...state.users.filter(u => u.active).map(u => [u.id, u.name])], 'Everyone') : ''}
    ${sel('source', [['assigned', 'Assigned by lead'], ['self', 'Self-logged']], 'Any source')}
    <label style="display:flex;align-items:center;gap:6px;margin:0"><input type="checkbox" data-f="overdue" style="width:auto" ${f.overdue ? 'checked' : ''}> Overdue only</label>
    <button class="btn sm" data-act="clear-filters">Clear</button></div>`;
}
function bindFilters(el) {
  $$('[data-f]', el).forEach(i => {
    const ev = i.type === 'text' || i.tagName === 'INPUT' && i.type !== 'checkbox' ? 'input' : 'change';
    let tm; i.addEventListener(ev, () => {
      clearTimeout(tm); tm = setTimeout(() => {
        state.filters[i.dataset.f] = i.type === 'checkbox' ? (i.checked ? '1' : '') : i.value; refreshList();
      }, ev === 'input' ? 250 : 0);
    });
  });
}
function qs() {
  const f = { ...state.filters }; if (state.view === 'mine') f.assignee = state.user.id;
  return '?' + new URLSearchParams(Object.entries(f).filter(([, v]) => v !== '' && v != null)).toString();
}
const refreshList = guard(async () => {
  const tasks = await api('/tasks' + qs());
  const box = $('#list'); if (!box) return;
  box.innerHTML = taskTable(tasks); bindTaskTable(box);
  $('#count').textContent = `${tasks.length} task${tasks.length === 1 ? '' : 's'}`;
});
const vTasks = async el => {
  const mine = state.view === 'mine';
  el.innerHTML = h`${header(mine ? 'My Tasks' : 'All Tasks', mine ? 'Tasks assigned to you and work you have logged.' : 'Every task across the team.',
    h`<a class="btn" href="/api/export.csv${qs()}" download>${ico('dl')} Export CSV</a>${newBtn()}`)}
    ${!isMgr() ? h`<div class="callout">💡 Did some work that wasn't assigned? Use <b>Add task</b> and set the status to <b>Done</b> to log it for the team lead.</div>` : ''}
    ${filterBar()}<div class="card" style="padding:6px 8px"><div id="list"></div></div><div class="small muted" id="count" style="margin-top:8px"></div>`;
  bindFilters(el); await refreshList();
};

// ---------- board ----------
const vBoard = async el => {
  const f = state.filters.assignee || '';
  const tasks = await api('/tasks' + (isMgr() && f ? '?assignee=' + f : ''));
  el.innerHTML = h`${header('Board', 'Drag cards between columns to update progress.',
    h`${isMgr() ? h`<select id="bassignee" style="width:auto"><option value="">Everyone</option>${state.users.filter(u => u.active).map(u => h`<option value="${u.id}" ${String(f) === String(u.id) ? 'selected' : ''}>${u.name}</option>`)}</select>` : ''}${newBtn()}`)}
    <div class="board">${['todo', 'in_progress', 'review', 'done'].map(s => h`<div class="col" data-col="${s}">
      <h3><span class="s-${s}">${S_LABEL[s]}</span><span class="tag">${tasks.filter(t => t.status === s).length}</span></h3>
      ${tasks.filter(t => t.status === s).map(t => h`<div class="tcard pr-${t.priority}" draggable="true" data-task="${t.id}">
        <div style="font-weight:600">${t.title}</div>
        <div class="meta">${pillP(t.priority)}</div>
        <div class="meta" style="justify-content:space-between"><span>${dueLabel(t)}</span>${t.assignee_name ? avatar(t.assignee_name, 22) : ''}</div></div>`)}
      </div>`)}</div>`;
  const ba = $('#bassignee'); if (ba) ba.onchange = () => { state.filters.assignee = ba.value; loadView(); };
  let dragId = null;
  $$('.tcard', el).forEach(c => { c.ondragstart = e => { dragId = c.dataset.task; e.dataTransfer.effectAllowed = 'move'; }; });
  $$('.col', el).forEach(col => {
    col.ondragover = e => { e.preventDefault(); col.classList.add('over'); };
    col.ondragleave = () => col.classList.remove('over');
    col.ondrop = guard(async e => {
      e.preventDefault(); col.classList.remove('over'); if (!dragId) return;
      const t = tasks.find(x => x.id == dragId); if (t.status === col.dataset.col) return;
      try { await api('/tasks/' + dragId, { method: 'PATCH', body: { status: col.dataset.col } }); toast('Moved to ' + S_LABEL[col.dataset.col]); }
      catch (err) { toast(err.message, true); }
      loadView();
    });
  });
};

// ---------- team ----------
const vTeam = async el => {
  const s = await api('/stats');
  el.innerHTML = h`${header('Team Workload', 'Who is working on what, and who has capacity.', newBtn())}
  <div class="card"><div class="tablewrap"><table><thead><tr><th>Analyst</th><th>To Do</th><th>In Progress</th><th>In Review</th><th>Overdue</th><th>Done</th><th>Self-logged</th><th>Hours done</th><th>Load</th></tr></thead><tbody>
  ${s.workload.map(w => { const open = (w.todo || 0) + (w.in_progress || 0) + (w.review || 0); return h`<tr class="click" data-user="${w.id}">
    <td><span style="display:flex;gap:8px;align-items:center">${avatar(w.name, 28)}<b>${w.name}</b></span></td>
    <td>${w.todo || 0}</td><td>${w.in_progress || 0}</td><td>${w.review || 0}</td><td class="${w.overdue ? 'late' : ''}">${w.overdue || 0}</td>
    <td>${w.done || 0}</td><td>${w.self_logged || 0}</td><td>${w.hours_done}</td>
    <td style="min-width:110px"><div class="hbar" style="grid-template-columns:1fr;margin:0"><div class="track"><i style="width:${Math.min(100, open * 12.5)}%;background:${raw(open > 6 ? 'var(--urgent)' : open > 3 ? 'var(--review)' : 'var(--done)')}"></i></div></div><span class="small muted">${open} open</span></td></tr>`; })}
  </tbody></table></div>${s.workload.length ? '' : h`<div class="empty">No analysts yet.</div>`}</div>
  <p class="muted small">Click an analyst to see their tasks.</p>`;
  $$('[data-user]', el).forEach(r => r.onclick = () => { state.filters = { assignee: r.dataset.user }; state.view = 'all'; render(); });
};

// ---------- users ----------
const vUsers = async el => {
  await loadUsers();
  el.innerHTML = h`${header('Manage Users', 'Add team members, change roles, reset passwords.', h`<button class="btn primary" data-act="new-user">${ico('plus')} Add user</button>`)}
  <div class="card"><div class="tablewrap"><table><thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Status</th><th></th></tr></thead><tbody>
  ${state.users.map(u => h`<tr><td><span style="display:flex;gap:8px;align-items:center">${avatar(u.name, 28)}<b>${u.name}</b></span></td><td>${u.username}</td>
    <td><select data-role="${u.id}" style="width:auto" ${u.id === state.user.id ? 'disabled' : ''}>${Object.entries(R_LABEL).map(([k, l]) => h`<option value="${k}" ${k === u.role ? 'selected' : ''}>${l}</option>`)}</select></td>
    <td>${u.active ? raw('<span class="pill s-done">Active</span>') : raw('<span class="pill s-todo">Disabled</span>')}</td>
    <td class="right"><button class="btn sm" data-resetpw="${u.id}">Reset password</button>
      ${u.id !== state.user.id ? h`<button class="btn sm ${u.active ? 'danger' : ''}" data-toggle="${u.id}">${u.active ? 'Disable' : 'Enable'}</button>` : ''}</td></tr>`)}
  </tbody></table></div></div>`;
  $$('[data-role]', el).forEach(s => s.onchange = guard(async () => { await api('/users/' + s.dataset.role, { method: 'PATCH', body: { role: s.value } }); toast('Role updated'); }));
  $$('[data-toggle]', el).forEach(b => b.onclick = guard(async () => {
    const u = state.users.find(x => x.id == b.dataset.toggle);
    await api('/users/' + u.id, { method: 'PATCH', body: { active: !u.active } }); toast(u.active ? 'User disabled' : 'User enabled'); loadView();
  }));
  $$('[data-resetpw]', el).forEach(b => b.onclick = () => {
    const u = state.users.find(x => x.id == b.dataset.resetpw);
    modal(h`<div class="modal sm"><div class="modal-head"><h2>Reset password — ${u.name}</h2></div>
      <form id="rp"><div class="field"><label>Temporary password (min 8 chars)</label><input name="password" minlength="8" required autofocus></div>
      <div class="small muted">They'll be asked to choose a new one on next sign-in.</div>
      <div class="modal-foot"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Reset</button></div></form></div>`);
    $('#rp').onsubmit = guard(async e => { e.preventDefault(); await api('/users/' + u.id, { method: 'PATCH', body: { password: new FormData(e.target).get('password') } }); closeModal(); toast('Password reset'); });
  });
};
function newUserModal() {
  modal(h`<div class="modal sm"><div class="modal-head"><h2>Add user</h2></div><form id="nu">
    <div class="field"><label>Full name</label><input name="name" required autofocus></div>
    <div class="field"><label>Username</label><input name="username" required pattern="[a-zA-Z0-9._-]{3,30}"></div>
    <div class="field"><label>Role</label><select name="role">${Object.entries(R_LABEL).map(([k, l]) => h`<option value="${k}">${l}</option>`)}</select></div>
    <div class="field"><label>Temporary password (min 8 chars)</label><input name="password" minlength="8" required></div>
    <div class="modal-foot"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Create user</button></div></form></div>`);
  $('#nu').onsubmit = guard(async e => { e.preventDefault(); await api('/users', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); closeModal(); toast('User created'); loadView(); });
}

// ---------- notifications ----------
const vNotifs = async el => {
  const n = await api('/notifications'); state.notifs = n;
  el.innerHTML = h`${header('Notifications', n.unread ? `${n.unread} unread` : 'You are all caught up.', h`<button class="btn" data-act="read-all">Mark all read</button>`)}
  <div class="card" style="padding:0;overflow:hidden">${n.items.length ? n.items.map(i => h`<div class="notif ${i.read ? '' : 'unread'}" ${i.task_id ? h`data-task="${i.task_id}"` : ''}>${i.message}<div class="small muted">${fmtDT(i.created_at)}</div></div>`) : h`<div class="empty">Nothing here yet.</div>`}</div>`;
};

// ---------- modals ----------
function modal(content) {
  closeModal();
  const o = document.createElement('div'); o.className = 'overlay'; o.id = 'overlay'; o.innerHTML = content;
  o.addEventListener('mousedown', e => { if (e.target === o) closeModal(); });
  document.body.append(o);
}
const closeModal = () => $('#overlay')?.remove();
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

function passwordModal(forced) {
  modal(h`<div class="modal sm"><div class="modal-head"><h2>${forced ? 'Choose a new password' : 'Change password'}</h2></div>
    ${forced ? h`<div class="callout">For security, please replace your temporary password.</div>` : ''}
    <form id="pw"><div class="field"><label>Current password</label><input type="password" name="current" required autofocus></div>
    <div class="field"><label>New password (min 8 chars)</label><input type="password" name="next" minlength="8" required></div>
    <div class="modal-foot">${forced ? '' : h`<button type="button" class="btn" data-close>Cancel</button>`}<button class="btn primary">Save</button></div></form></div>`);
  $('#pw').onsubmit = guard(async e => { e.preventDefault(); await api('/password', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); state.user.must_change = false; closeModal(); toast('Password updated'); });
}

function taskForm(t) {
  const me = state.user, editing = !!t;
  const full = isMgr() || !editing || (t.created_by === me.id && t.assigned_to === me.id);
  const dis = full ? '' : 'disabled';
  const T = t || { title: '', description: '', category: 'Other', project: '', priority: 'medium', status: isMgr() ? 'todo' : 'todo', due_date: '', est_hours: '', actual_hours: '', assigned_to: isMgr() ? '' : me.id };
  const opt = (list, cur) => list.map(([v, l]) => h`<option value="${v}" ${String(v) === String(cur) ? 'selected' : ''}>${l}</option>`);
  const stats = editing ? allowedStatuses(t) : ['todo', 'in_progress', 'review', 'done'];
  return h`<form id="tf">
    <div class="field"><label>Title</label><input name="title" value="${T.title}" required maxlength="200" ${dis} ${editing ? '' : 'autofocus'}></div>
    <div class="field"><label>Description / notes</label><textarea name="description" maxlength="5000">${T.description}</textarea></div>
    <div class="row">
      <div class="field"><label>Project</label><input name="project" value="${T.project}" ${dis} maxlength="120" placeholder="e.g. Flood Study"></div>
      <div class="field"><label>Priority</label><select name="priority" ${dis}>${opt(Object.entries(P_LABEL), T.priority)}</select></div>
      <div class="field"><label>Status</label><select name="status">${opt(stats.concat(stats.includes(T.status) ? [] : [T.status]).map(s => [s, S_LABEL[s]]), T.status)}</select></div>
      <div class="field"><label>Due date</label><input type="date" name="due_date" value="${T.due_date || ''}" ${dis}></div>
      ${isMgr() ? h`<div class="field"><label>Assigned to</label><select name="assigned_to"><option value="">— Unassigned —</option>${opt(state.users.filter(u => u.active || u.id === T.assigned_to).map(u => [u.id, `${u.name} (${R_LABEL[u.role]})`]), T.assigned_to)}</select></div>` : ''}
      <div class="field"><label>Estimated hours</label><input type="number" step="0.25" min="0" name="est_hours" value="${T.est_hours ?? ''}" ${dis}></div>
      <div class="field"><label>Actual hours spent</label><input type="number" step="0.25" min="0" name="actual_hours" value="${T.actual_hours ?? ''}"></div>
    </div>
    ${!full ? h`<div class="small muted">This task was assigned to you — you can update status, hours and notes. Submit it for review when finished.</div>` : ''}
    <div class="modal-foot">
      ${editing && (isMgr() || (t.created_by === me.id && t.assigned_to === me.id)) ? h`<button type="button" class="btn danger" data-del style="margin-right:auto">Delete</button>` : ''}
      <button type="button" class="btn" data-close>Cancel</button><button class="btn primary">${editing ? 'Save changes' : (isMgr() ? 'Create task' : 'Add task')}</button></div></form>`;
}
function newTaskModal() {
  modal(h`<div class="modal"><div class="modal-head"><div><h2>${isMgr() ? 'New task' : 'Add a task'}</h2>
    ${!isMgr() ? h`<div class="muted small">Log work you did yourself — set status to Done if it's finished.</div>` : ''}</div></div>${taskForm(null)}</div>`);
  bindTaskForm(null);
}
function bindTaskForm(t) {
  $('#tf').onsubmit = guard(async e => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    for (const el of $$('#tf [disabled]')) delete body[el.name];
    if (t) await api('/tasks/' + t.id, { method: 'PATCH', body }); else await api('/tasks', { method: 'POST', body });
    closeModal(); toast(t ? 'Task updated' : 'Task created'); loadView();
  });
  const del = $('[data-del]'); if (del) del.onclick = guard(async () => {
    if (!confirm('Delete this task permanently?')) return;
    await api('/tasks/' + t.id, { method: 'DELETE' }); closeModal(); toast('Task deleted'); loadView();
  });
}
async function openTask(id, tab = 'details') {
  const t = await api('/tasks/' + id);
  const tabs = ['details', 'comments', 'activity'];
  modal(h`<div class="modal">
    <div class="modal-head"><div><h2 style="font-size:19px">${t.title}</h2>
      <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;align-items:center">${pillS(t.status)} ${pillP(t.priority)}
      ${t.source === 'self' ? raw('<span class="tag">self-logged</span>') : ''}</div>
      <div class="small muted" style="margin-top:8px">Assigned to <b>${t.assignee_name || 'nobody'}</b> · created by ${t.creator_name} · ${fmtDate(t.created_at)}
        ${t.completed_at ? h` · completed ${fmtDate(t.completed_at)}` : ''}</div></div>
      <button class="btn sm" data-close>✕</button></div>
    <div class="tabs">${tabs.map(x => h`<button data-tab="${x}" class="${x === tab ? 'on' : ''}">${x[0].toUpperCase() + x.slice(1)}${x === 'comments' ? ` (${t.comments.length})` : ''}</button>`)}</div>
    <div>${tab === 'details' ? taskForm(t) : tab === 'comments' ? h`
      ${t.comments.length ? t.comments.map(c => h`<div class="cmt"><span class="who">${c.user_name}</span> <span class="small muted">${fmtDT(c.created_at)}</span><p>${c.body}</p></div>`) : h`<div class="empty">No comments yet.</div>`}
      <form id="cf" style="margin-top:12px"><textarea name="body" placeholder="Write a comment…" required maxlength="3000"></textarea>
      <div class="modal-foot"><button class="btn primary">${ico('chat')} Comment</button></div></form>`
      : t.activity.map(a => h`<div class="cmt"><span class="who">${a.user_name}</span> ${a.action} <span class="small muted">· ${fmtDT(a.created_at)}</span></div>`)}</div></div>`);
  $$('[data-tab]').forEach(b => b.onclick = guard(() => openTask(id, b.dataset.tab)));
  if (tab === 'details') bindTaskForm(t);
  if (tab === 'comments') $('#cf').onsubmit = guard(async e => { e.preventDefault(); await api(`/tasks/${id}/comments`, { method: 'POST', body: { body: new FormData(e.target).get('body') } }); await openTask(id, 'comments'); });
}

// ---------- global events ----------
document.addEventListener('click', guard(async e => {
  const t = e.target.closest('[data-nav],[data-act],[data-task],[data-close]'); if (!t) return;
  if (t.dataset.close !== undefined) return closeModal();
  if (t.dataset.nav) { state.view = t.dataset.nav; state.navOpen = false; if (t.dataset.nav !== 'all' && t.dataset.nav !== 'mine') state.filters = {}; return render(); }
  if (t.dataset.task && !e.target.closest('select')) return openTask(t.dataset.task);
  switch (t.dataset.act) {
    case 'new-task': return newTaskModal();
    case 'new-user': return newUserModal();
    case 'menu': state.navOpen = !state.navOpen; return $('.side').classList.toggle('open', state.navOpen);
    case 'password': return passwordModal(false);
    case 'logout': await api('/logout', { method: 'POST' }); state.user = null; return render();
    case 'theme': { const d = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = d; try { localStorage.setItem('tms-theme', d); } catch { } return; }
    case 'clear-filters': state.filters = {}; return loadView();
    case 'read-all': await api('/notifications/read', { method: 'POST', body: {} }); return loadView();
  }
}));
boot();
