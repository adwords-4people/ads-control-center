(function () {
  const state = { loaded: false, loading: false, googleSources: [], metaSources: [] };

  function text(value) { return String(value == null ? '' : value).trim(); }
  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function feedback(message, error) {
    const el = document.getElementById('accountModalFeedback');
    if (!el) return;
    el.textContent = message || '';
    el.className = 'admin-modal-feedback' + (error ? ' err' : '');
  }

  async function loadOptions(force) {
    if (!window.AUTH_CAN_ADD_ACCOUNT) return;
    if (state.loaded && !force) return;
    if (state.loading) return;
    state.loading = true;
    try {
      const response = await fetch('/api/accounts/self-service', {
        cache: 'no-store', credentials: 'same-origin'
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.message || payload.error || `HTTP ${response.status}`);
      state.googleSources = payload.googleSources || [];
      state.metaSources = payload.metaSources || [];
      state.loaded = true;
      updateAccountSourceOptions();
    } finally {
      state.loading = false;
    }
  }

  window.updateAccountSourceOptions = function updateAccountSourceOptions() {
    const platform = text(document.getElementById('accountPlatform') && document.getElementById('accountPlatform').value) || 'Google Ads';
    const select = document.getElementById('accountSource');
    const label = document.getElementById('accountSourceLabel');
    const note = document.getElementById('accountModalNote');
    const idInput = document.getElementById('accountId');
    if (!select || !label) return;

    const google = platform === 'Google Ads';
    const options = google ? state.googleSources : state.metaSources;
    label.textContent = google ? 'MCK' : 'Business Manager';
    if (idInput) idInput.placeholder = google ? 'np. 123-456-7890' : 'np. act_123456789012345';

    if (!options.length) {
      select.innerHTML = `<option value="">${google ? 'Brak przypisanego aktywnego MCK' : 'Brak aktywnego Business Managera'}</option>`;
      select.disabled = true;
      select.required = false;
      if (note) note.textContent = google
        ? 'Nie masz przypisanego aktywnego MCK. Poproś Admina o uzupełnienie konfiguracji.'
        : 'Brak aktywnego Business Managera w konfiguracji. Poproś Admina o sprawdzenie ustawień Meta.';
      return;
    }

    select.disabled = false;
    select.required = true;
    select.innerHTML = options.map(item => {
      const details = item.externalId ? ` · ${item.externalId}` : '';
      return `<option value="${esc(item.id)}">${esc(item.name || item.id)}${esc(details)}</option>`;
    }).join('');
    if (note) note.textContent = 'Po dodaniu konto pojawi się w raportach po najbliższej automatycznej synchronizacji.';
  };

  window.openAccountModal = async function openAccountModal() {
    if (!window.AUTH_CAN_ADD_ACCOUNT) return;
    const modal = document.getElementById('accountModal');
    if (!modal) return;
    feedback('Ładowanie konfiguracji…', false);
    modal.hidden = false;
    try {
      await loadOptions(false);
      feedback('', false);
      const platform = document.getElementById('accountPlatform');
      if (platform) {
        if (!state.googleSources.length && state.metaSources.length) platform.value = 'Meta Ads';
        else platform.value = 'Google Ads';
      }
      updateAccountSourceOptions();
      setTimeout(() => document.getElementById('accountId') && document.getElementById('accountId').focus(), 0);
    } catch (error) {
      console.error('[Account self-service]', error);
      feedback(error.message, true);
    }
  };

  window.closeAccountModal = function closeAccountModal() {
    const modal = document.getElementById('accountModal');
    if (modal) modal.hidden = true;
    const form = document.getElementById('accountForm');
    if (form) form.reset();
    feedback('', false);
    updateAccountSourceOptions();
  };

  window.saveAccount = async function saveAccount(event) {
    event.preventDefault();
    if (!window.AUTH_CAN_ADD_ACCOUNT) return;
    const btn = document.getElementById('accountSaveBtn');
    const source = document.getElementById('accountSource');
    const platform = text(document.getElementById('accountPlatform').value);
    if (!source || source.disabled || !text(source.value)) {
      feedback(platform === 'Google Ads' ? 'Brak aktywnego MCK do przypisania konta.' : 'Brak aktywnego Business Managera.', true);
      return;
    }

    btn.disabled = true;
    feedback('Dodawanie konta…', false);
    try {
      const budgetRaw = text(document.getElementById('accountBudget').value);
      const payload = {
        platform,
        accountId: text(document.getElementById('accountId').value),
        name: text(document.getElementById('accountName').value),
        type: text(document.getElementById('accountType').value),
        budget: budgetRaw === '' ? '' : Number(budgetRaw),
        sourceId: text(source.value),
      };
      const response = await fetch('/api/accounts/self-service', {
        method: 'POST', cache: 'no-store', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.message || result.error || `HTTP ${response.status}`);
      window.closeAccountModal();
      if (typeof showToast === 'function') showToast('Konto dodane. Dane pojawią się po najbliższej synchronizacji.', 'ok');
      state.loaded = false;
    } catch (error) {
      feedback(error.message, true);
    } finally {
      btn.disabled = false;
    }
  };

  document.addEventListener('keydown', event => {
    const modal = document.getElementById('accountModal');
    if (event.key === 'Escape' && modal && !modal.hidden) window.closeAccountModal();
  });

  if (typeof waitForAuth === 'function') {
    waitForAuth().then(session => {
      if (session && session.authenticated && window.AUTH_CAN_ADD_ACCOUNT) {
        loadOptions(false).catch(error => console.warn('[Account self-service preload]', error));
      }
    });
  }
})();
