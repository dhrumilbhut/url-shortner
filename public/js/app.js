// ── State ──────────────────────────────────────────────────────────────────
const state = {
  token: localStorage.getItem('accessToken'),
  userId: localStorage.getItem('userId'),
  email: localStorage.getItem('email'),
  refreshToken: localStorage.getItem('refreshToken'),
  role: localStorage.getItem('role'),
  lastShortUrl: null,
};

// ── API helper ─────────────────────────────────────────────────────────────
async function api(path, options = {}, _retry = false) {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (state.token) headers['Authorization'] = `Bearer ${state.token}`;

  const res = await fetch(path, { ...options, headers });
  const data = res.status === 204 ? null : await res.json();

  if (res.status === 401 && state.token) {
    if (!_retry && state.userId && state.refreshToken) {
      const refreshed = await tryRefreshToken();
      if (refreshed) return api(path, options, true);
    }
    clearSession();
    showAuth();
    return null;
  }

  return { ok: res.ok, status: res.status, data };
}

async function tryRefreshToken() {
  try {
    const res = await fetch('/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: state.userId, refreshToken: state.refreshToken }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    state.token = data.accessToken;
    localStorage.setItem('accessToken', data.accessToken);
    return true;
  } catch {
    return false;
  }
}

// ── Session helpers ────────────────────────────────────────────────────────
function saveSession(token, userId, email, refreshToken) {
  const decoded = parseJwt(token);
  state.token = token;
  state.userId = userId;
  state.email = email;
  state.refreshToken = refreshToken || null;
  state.role = decoded.role || 'user';
  localStorage.setItem('accessToken', token);
  localStorage.setItem('userId', userId);
  localStorage.setItem('email', email);
  localStorage.setItem('role', state.role);
  if (refreshToken) localStorage.setItem('refreshToken', refreshToken);
}

function clearSession() {
  state.token = null;
  state.userId = null;
  state.email = null;
  state.refreshToken = null;
  state.role = null;
  localStorage.removeItem('accessToken');
  localStorage.removeItem('userId');
  localStorage.removeItem('email');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('role');
}

// ── View switching ─────────────────────────────────────────────────────────
function showAuth() {
  document.getElementById('auth-view').classList.remove('hidden');
  document.getElementById('dashboard-view').classList.add('hidden');
}

function showDashboard() {
  document.getElementById('auth-view').classList.add('hidden');
  document.getElementById('dashboard-view').classList.remove('hidden');
  document.getElementById('user-email-display').textContent = state.email;

  const isAdmin = state.role === 'admin';
  document.getElementById('admin-panel').classList.toggle('hidden', !isAdmin);
  document.getElementById('admin-badge').classList.toggle('hidden', !isAdmin);

  loadMyUrls();
  if (isAdmin) loadUsers();
}

function switchTab(tab) {
  const isLogin = tab === 'login';
  document.getElementById('login-form').classList.toggle('hidden', !isLogin);
  document.getElementById('register-form').classList.toggle('hidden', isLogin);
  document.getElementById('tab-login').classList.toggle('active', isLogin);
  document.getElementById('tab-register').classList.toggle('active', !isLogin);
  document.getElementById('login-error').textContent = '';
  document.getElementById('register-error').textContent = '';
  document.getElementById('register-success').textContent = '';
}

// ── Auth handlers ──────────────────────────────────────────────────────────
async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errorEl = document.getElementById('login-error');
  const btn = document.getElementById('login-btn');

  errorEl.textContent = '';
  btn.disabled = true;
  btn.textContent = 'Logging in...';

  const res = await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });

  btn.disabled = false;
  btn.textContent = 'Login';

  if (!res) return;

  if (!res.ok) {
    errorEl.textContent = res.data.error;
    return;
  }

  saveSession(res.data.accessToken, res.data.userId || parseJwt(res.data.accessToken).userId, email, res.data.refreshToken);
  showDashboard();
}

async function handleRegister(e) {
  e.preventDefault();
  const email = document.getElementById('register-email').value.trim();
  const password = document.getElementById('register-password').value;
  const errorEl = document.getElementById('register-error');
  const successEl = document.getElementById('register-success');
  const btn = document.getElementById('register-btn');

  errorEl.textContent = '';
  successEl.textContent = '';
  btn.disabled = true;
  btn.textContent = 'Creating account...';

  const res = await api('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });

  btn.disabled = false;
  btn.textContent = 'Create Account';

  if (!res) return;

  if (!res.ok) {
    errorEl.textContent = res.data.error;
    return;
  }

  successEl.textContent = 'Account created! You can now log in.';
  document.getElementById('register-email').value = '';
  document.getElementById('register-password').value = '';
  setTimeout(() => switchTab('login'), 1500);
}

async function handleLogout() {
  if (state.token) {
    await api('/auth/logout', { method: 'POST' });
  }
  clearSession();
  showAuth();
}

// ── URL handlers ───────────────────────────────────────────────────────────
async function handleShorten(e) {
  e.preventDefault();
  const url = document.getElementById('url-input').value.trim();
  const customCode = document.getElementById('custom-code-input').value.trim();
  const errorEl = document.getElementById('shorten-error');
  const btn = document.getElementById('shorten-btn');
  const resultBox = document.getElementById('shorten-result');

  errorEl.textContent = '';
  resultBox.classList.add('hidden');
  btn.disabled = true;
  btn.textContent = 'Shortening...';

  const body = { url };
  if (customCode) body.customCode = customCode;

  const res = await api('/shorten', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  btn.disabled = false;
  btn.textContent = 'Shorten';

  if (!res) return;

  if (!res.ok) {
    errorEl.textContent = res.data.error;
    return;
  }

  state.lastShortUrl = res.data.shortUrl;
  const linkEl = document.getElementById('result-link');
  linkEl.href = res.data.shortUrl;
  linkEl.textContent = res.data.shortUrl;
  resultBox.classList.remove('hidden');

  document.getElementById('url-input').value = '';
  document.getElementById('custom-code-input').value = '';
  document.getElementById('copy-btn').textContent = 'Copy';
  document.getElementById('copy-btn').classList.remove('copied');

  loadMyUrls();
}

function copyResult() {
  if (!state.lastShortUrl) return;
  navigator.clipboard.writeText(state.lastShortUrl);
  const btn = document.getElementById('copy-btn');
  btn.textContent = 'Copied!';
  btn.classList.add('copied');
  setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
}

async function loadMyUrls() {
  const container = document.getElementById('urls-container');
  container.innerHTML = '<p class="muted center" style="padding:20px">Loading...</p>';

  const res = await api('/urls/me');
  if (!res) return;

  if (!res.ok || res.data.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🔗</div>
        <p>No URLs yet. Shorten your first one above!</p>
      </div>`;
    return;
  }

  const rows = res.data.map(url => `
    <tr id="row-${url.shortCode}">
      <td>
        <a class="short-code-link" href="${url.shortUrl}" target="_blank">
          /r/${url.shortCode}
        </a>
      </td>
      <td>
        <span class="original-url" title="${url.originalUrl}">${url.originalUrl}</span>
      </td>
      <td class="created-at">${formatDate(url.createdAt)}</td>
      <td class="actions">
        <button class="btn-ghost" onclick="copyToClipboard('${url.shortUrl}', this)">Copy</button>
        <button class="btn-ghost" onclick="toggleAnalytics('${url.shortCode}')">Stats</button>
        <button class="btn-danger" onclick="handleDelete('${url.shortCode}')">Delete</button>
      </td>
    </tr>
    <tr class="analytics-panel hidden" id="analytics-${url.shortCode}">
      <td colspan="4">
        <div class="analytics-content">
          <div class="stat-block">
            <span class="stat-value" id="clicks-${url.shortCode}">—</span>
            <span class="stat-label">Total Clicks</span>
          </div>
          <div class="stat-block">
            <span class="stat-value" style="font-size:14px;color:var(--text)">${url.shortCode}</span>
            <span class="stat-label">Short Code</span>
          </div>
          <div class="stat-block">
            <span class="stat-value" style="font-size:14px;color:var(--text)">${formatDate(url.createdAt)}</span>
            <span class="stat-label">Created</span>
          </div>
        </div>
      </td>
    </tr>
  `).join('');

  container.innerHTML = `
    <table class="url-table">
      <thead>
        <tr>
          <th>Short URL</th>
          <th>Original URL</th>
          <th>Created</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

async function handleDelete(shortCode) {
  if (!confirm(`Delete /${shortCode}? This cannot be undone.`)) return;

  const res = await api(`/urls/${shortCode}`, { method: 'DELETE' });
  if (!res) return;

  if (!res.ok) {
    alert(res.data?.error || 'Failed to delete.');
    return;
  }

  loadMyUrls();
}

async function toggleAnalytics(shortCode) {
  const panel = document.getElementById(`analytics-${shortCode}`);
  const isHidden = panel.classList.contains('hidden');

  panel.classList.toggle('hidden');

  if (isHidden) {
    const res = await api(`/analytics/${shortCode}`);
    if (res && res.ok) {
      document.getElementById(`clicks-${shortCode}`).textContent = res.data.totalClicks;
    }
  }
}

function copyToClipboard(text, btn) {
  navigator.clipboard.writeText(text);
  const original = btn.textContent;
  btn.textContent = 'Copied!';
  setTimeout(() => { btn.textContent = original; }, 2000);
}

// ── Admin ──────────────────────────────────────────────────────────────────
async function loadUsers() {
  const container = document.getElementById('users-container');
  container.innerHTML = '<p class="muted center" style="padding:20px">Loading...</p>';

  const res = await api('/auth/admin/users');
  if (!res || !res.ok) {
    container.innerHTML = '<p class="muted center" style="padding:20px">Failed to load users.</p>';
    return;
  }

  if (res.data.length === 0) {
    container.innerHTML = '<p class="muted center" style="padding:20px">No users found.</p>';
    return;
  }

  const rows = res.data.map(user => `
    <tr id="user-row-${user.id}">
      <td>${user.email}</td>
      <td><span class="role-badge ${user.role}">${user.role}</span></td>
      <td><span class="${user.banned ? 'status-banned' : 'status-active'}">${user.banned ? 'Banned' : 'Active'}</span></td>
      <td class="actions">
        ${user.id === state.userId ? '<span class="muted" style="font-size:12px">you</span>' : user.banned
      ? `<button class="btn-ghost" onclick="handleUnban('${user.id}')">Unban</button>`
      : `<button class="btn-danger" onclick="handleBan('${user.id}', '${user.email}')">Ban</button>`
    }
      </td>
    </tr>
  `).join('');

  container.innerHTML = `
    <table class="url-table">
      <thead>
        <tr>
          <th>Email</th>
          <th>Role</th>
          <th>Status</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

async function handleBan(userId, email) {
  if (!confirm(`Ban ${email}? They will be immediately locked out.`)) return;

  const res = await api(`/auth/admin/ban/${userId}`, { method: 'POST' });
  if (!res) return;

  if (!res.ok) {
    alert(res.data?.error || 'Failed to ban user.');
    return;
  }

  loadUsers();
}

async function handleUnban(userId) {
  const res = await api(`/auth/admin/ban/${userId}`, { method: 'DELETE' });
  if (!res) return;

  if (!res.ok) {
    alert(res.data?.error || 'Failed to unban user.');
    return;
  }

  loadUsers();
}

// ── Utilities ──────────────────────────────────────────────────────────────
function parseJwt(token) {
  try {
    return JSON.parse(atob(token.split('.')[1]));
  } catch {
    return {};
  }
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

// ── Init ───────────────────────────────────────────────────────────────────
if (state.token) {
  showDashboard();
} else {
  showAuth();
}
