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
          <span class="auth-google-mark">G</span>
          Zaloguj przez Google Workspace
        </a>
        <p class="auth-foot">Dostęp tylko dla aktywnych użytkowników 4people.</p>
      </div>`;
    document.body.appendChild(overlay);
    return overlay;
  }

  function renderUserChip(user) {
    const header = document.querySelector('.header');
    if (!header || document.getElementById('authUser')) return;

    const wrap = document.createElement('div');
    wrap.className = 'auth-user';
    wrap.id = 'authUser';
    wrap.innerHTML = `
      <button class="auth-user-main" type="button" aria-label="Zalogowany użytkownik">
        <span class="auth-avatar">${String(user.name || user.email).trim().charAt(0).toUpperCase()}</span>
        <span class="auth-user-copy">
          <strong>${escapeHtml(user.name || user.email)}</strong>
          <small>${escapeHtml(user.role || '')}${user.team ? ' · ' + escapeHtml(user.team) : ''}</small>
        </span>
      </button>
      <button class="auth-logout" type="button" id="authLogoutBtn" title="Wyloguj">Wyloguj</button>`;
    header.appendChild(wrap);

    document.getElementById('authLogoutBtn').addEventListener('click', async () => {
      const btn = document.getElementById('authLogoutBtn');
      btn.disabled = true;
      try { await fetch('/api/logout', { method: 'POST', cache: 'no-store' }); } catch (_) {}
      window.location.assign('/');
    });
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
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
        renderUserChip(data.user);
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
