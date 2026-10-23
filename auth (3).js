(function () {
  let resolveAuth;
  const ready = new Promise(resolve => { resolveAuth = resolve; });

  window.AUTH_SESSION = { authenticated: false, user: null };
  window.waitForAuth = function waitForAuth() { return ready; };

  function authMessageFromUrl() {
    const code = new URLSearchParams(window.location.search).get('auth');
    if (code === 'forbidden') return 'Twoje konto Google nie ma aktywnego dostępu do PPC Control Center.';
    if (code === 'domain_denied') return 'Zaloguj się kontem Google Workspace w domenie 4people.pl.';
    if (code === 'invalid_state') return 'Sesja logowania wygasła. Spróbuj zalogować się ponownie.';
    if (code === 'oauth_error') return 'Logowanie Google nie powiodło się. Spróbuj ponownie.';
    return '';
  }

  function cleanAuthQuery() {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('auth')) return;
    url.searchParams.delete('auth');
    history.replaceState(history.state, '', url.pathname + (url.search ? url.search : '') + url.hash);
  }

  function escapeHtml(value) {
    return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function createOverlay() {
    const overlay = document.createElement('div');
    overlay.className = 'auth-overlay';
    overlay.id = 'authOverlay';
    overlay.innerHTML = `
      <div class="auth-card" role="dialog" aria-labelledby="authTitle" aria-describedby="authDesc">
        <div class="auth-brand">4people</div>
        <h1 id="authTitle">PPC Control Center</h1>
        <p id="authDesc" class="auth-desc">Dostęp do firmowego dashboardu reklamowego.</p>
        <div class="auth-status" id="authStatus">Sprawdzam sesję…</div>
        <a class="auth-google-btn" id="authLoginBtn" href="/api/auth/login" hidden>
          <span class="auth-google-mark">G</span>Zaloguj przez Google Workspace
        </a>
        <p class="auth-foot">Dostęp tylko dla aktywnych użytkowników 4people.</p>
      </div>`;
    document.body.appendChild(overlay);
    return overlay;
  }

  function addPreviewBanner(session) {
    if (!session.previewing) return;
    const main = document.querySelector('.main');
    if (!main || document.getElementById('authPreviewBanner')) return;
    const banner = document.createElement('div');
    banner.id = 'authPreviewBanner';
    banner.className = 'auth-preview-banner';
    banner.innerHTML = `Tryb testowy: widok <strong>${escapeHtml(session.user.name || session.user.email)}</strong> · ${escapeHtml(session.user.role || '')}${session.user.team ? ' · ' + escapeHtml(session.user.team) : ''}`;
    main.prepend(banner);
  }

  async function setPreview(email) {
    const response = await fetch('/api/admin/preview', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email || '' }),
    });
    if (!response.ok) throw new Error('Nie udało się zmienić widoku testowego.');
    window.location.reload();
  }

  async function attachAdminPreview(select, session) {
    try {
      const response = await fetch('/api/admin/users', { cache: 'no-store', credentials: 'same-origin' });
      if (!response.ok) return;
      const payload = await response.json();
      const users = payload.users || [];
      const actualEmail = session.actualUser.email;
      const own = document.createElement('option');
      own.value = '';
      own.textContent = `Własny widok — ${session.actualUser.name || session.actualUser.email} (Admin)`;
      select.appendChild(own);
      users.filter(u => u.email !== actualEmail).forEach(user => {
        const option = document.createElement('option');
        option.value = user.email;
        option.textContent = `${user.name || user.email} — ${user.role}${user.team ? ' · ' + user.team : ''}`;
        if (session.previewing && session.user.email === user.email) option.selected = true;
        select.appendChild(option);
      });
      if (!session.previewing) own.selected = true;
      select.disabled = false;
      select.addEventListener('change', () => {
        select.disabled = true;
        setPreview(select.value).catch(error => {
          console.error('[Auth preview]', error);
          select.disabled = false;
        });
      });
    } catch (error) {
      console.warn('[Auth preview users]', error);
    }
  }

  function renderUserChip(session) {
    const user = session.user;
    const header = document.querySelector('.header');
    if (!header || document.getElementById('authUser')) return;
    const wrap = document.createElement('div');
    wrap.className = 'auth-user';
    wrap.id = 'authUser';
    wrap.innerHTML = `
      <div class="auth-user-main" aria-label="Aktywny widok użytkownika">
        <span class="auth-avatar">${String(user.name || user.email).trim().charAt(0).toUpperCase()}</span>
        <span class="auth-user-copy">
          <strong>${escapeHtml(user.name || user.email)}</strong>
          <small>${escapeHtml(user.role || '')}${user.team ? ' · ' + escapeHtml(user.team) : ''}</small>
        </span>
      </div>
      <button class="auth-logout" type="button" id="authLogoutBtn" title="Wyloguj">Wyloguj</button>`;

    if (session.actualUser && String(session.actualUser.role || '').toLowerCase() === 'admin') {
      const previewWrap = document.createElement('label');
      previewWrap.className = 'auth-preview-control';
      previewWrap.innerHTML = '<span>Podgląd jako</span><select id="authPreviewSelect" disabled><option>Ładowanie…</option></select>';
      wrap.prepend(previewWrap);
      header.appendChild(wrap);
      attachAdminPreview(previewWrap.querySelector('select'), session);
    } else {
      header.appendChild(wrap);
    }

    document.getElementById('authLogoutBtn').addEventListener('click', async () => {
      const btn = document.getElementById('authLogoutBtn');
      btn.disabled = true;
      try {
        await fetch('/api/logout', { method: 'POST', cache: 'no-store', credentials: 'same-origin' });
      } catch (_) {}
      window.location.assign('/');
    });

    addPreviewBanner(session);
  }

  async function initAuth() {
    const overlay = createOverlay();
    const status = document.getElementById('authStatus');
    const loginBtn = document.getElementById('authLoginBtn');
    const urlMessage = authMessageFromUrl();

    try {
      const response = await fetch('/api/me', { cache: 'no-store', credentials: 'same-origin' });
      const data = await response.json();

      if (data && data.authenticated && data.user) {
        window.AUTH_SESSION = data;
        const actualRole = data.actualUser ? String(data.actualUser.role || '').trim().toLowerCase() : '';
        const effectiveRole = data.user ? String(data.user.role || '').trim().toLowerCase() : '';
        const actualIsAdmin = actualRole === 'admin';

        window.AUTH_CAN_ADMIN = Boolean(actualIsAdmin && !data.previewing);
        window.AUTH_CAN_CLIENTS = Boolean(effectiveRole === 'admin' || effectiveRole === 'manager');

        const accountAddRoles = new Set(['admin', 'manager', 'specjalista']);
        window.AUTH_CAN_ADD_ACCOUNT = Boolean(accountAddRoles.has(actualRole) && !data.previewing);
        window.AUTH_SHOW_ADD_ACCOUNT = Boolean(accountAddRoles.has(effectiveRole));

        document.querySelectorAll('[data-admin-only]').forEach(el => { el.hidden = !window.AUTH_CAN_ADMIN; });
        document.querySelectorAll('[data-clients-access]').forEach(el => { el.hidden = !window.AUTH_CAN_CLIENTS; });
        document.querySelectorAll('[data-specialist-only]').forEach(el => { el.hidden = !window.AUTH_SHOW_ADD_ACCOUNT; });

        renderUserChip(data);
        overlay.remove();
        document.documentElement.classList.remove('auth-pending', 'auth-locked');
        cleanAuthQuery();
        resolveAuth(data);
        return;
      }

      status.textContent = urlMessage || 'Zaloguj się firmowym kontem Google Workspace.';
      loginBtn.hidden = false;
      document.documentElement.classList.remove('auth-pending');
      document.documentElement.classList.add('auth-locked');
      resolveAuth({ authenticated: false, user: null });
    } catch (error) {
      console.error('[Auth]', error);
      status.textContent = 'Nie udało się sprawdzić sesji. Odśwież stronę lub spróbuj ponownie za chwilę.';
      loginBtn.hidden = false;
      document.documentElement.classList.remove('auth-pending');
      document.documentElement.classList.add('auth-locked');
      resolveAuth({ authenticated: false, user: null, error: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAuth, { once: true });
  } else {
    initAuth();
  }
})();
