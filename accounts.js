(function () {
  const state = { loaded: false, loading: false, owners: [], googleSourcesByOwner: {}, metaSources: [], role: '' };

  function text(value) { return String(value == null ? '' : value).trim(); }
  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function lower(value) { return text(value).toLowerCase(); }

  function feedback(message, error) {
    const el = document.getElementById('accountModalFeedback');
    if (!el) return;
    el.textContent = message || '';
    el.className = 'admin-modal-feedback' + (error ? ' err' : '');
  }

  function selectedOwnerEmail() {
    const select = document.getElementById('accountOwner');
    return text(select && select.value);
  }

  function renderOwnerOptions() {
    const select = document.getElementById('accountOwner');
    if (!select) return;
    const owners = state.owners || [];
    select.innerHTML = owners.map(owner => {
      const role = owner.role ? ` · ${owner.role}` : '';
      return `<option value="${esc(owner.email)}">${esc(owner.name || owner.email)}${esc(role)}</option>`;
    }).join('');
    select.disabled = owners.length <= 1;
    select.required = true;

    const subtitle = document.getElementById('accountModalSubtitle');
    if (subtitle) {
      if (lower(state.role) === 'specjalista') subtitle.textContent = 'Konto zostanie przypisane do Ciebie i aktywowane w konfiguracji.';
      else if (lower(state.role) === 'manager') subtitle.textContent = 'Konto możesz przypisać do siebie lub aktywnej osoby z Twojego Teamu.';
      else subtitle.textContent = 'Konto możesz przypisać do dowolnego aktywnego pracownika.';
    }
  }

  async function loadOptions(force) {
    if (!window.AUTH_SHOW_ADD_ACCOUNT) return;
    if (state.loaded && !force) return;
    if (state.loading) return;
    state.loading = true;
    try {
      const response = await fetch('/api/accounts/self-service', {
        cache: 'no-store', credentials: 'same-origin'
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.message || payload.error || `HTTP ${response.status}`);
      state.owners = payload.owners || [];
      state.googleSourcesByOwner = payload.googleSourcesByOwner || {};
      state.metaSources = payload.metaSources || [];
      state.role = payload.role || '';
      state.loaded = true;
      renderOwnerOptions();
      window.updateAccountSourceOptions();
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
    const ownerEmail = selectedOwnerEmail();
    const options = google ? (state.googleSourcesByOwner[ownerEmail] || []) : state.metaSources;
    label.textContent = google ? 'MCK opiekuna' : 'Business Manager';
    if (idInput) idInput.placeholder = google ? 'np. 123-456-7890' : 'np. act_123456789012345';

    if (!options.length) {
      select.innerHTML = `<option value="">${google ? 'Brak aktywnego MCK dla wybranego opiekuna' : 'Brak aktywnego Business Managera'}</option>`;
      select.disabled = true;
      select.required = false;
      if (note) note.textContent = google
        ? 'Wybrany opiekun nie ma przypisanego aktywnego MCK. Admin musi najpierw uzupełnić konfigurację MCK.'
        : 'Brak aktywnego Business Managera w konfiguracji.';
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
    if (!window.AUTH_SHOW_ADD_ACCOUNT) return;
    const modal = document.getElementById('accountModal');
    if (!modal) return;
    feedback('Ładowanie konfiguracji…', false);
    modal.hidden = false;
    try {
      await loadOptions(false);
      feedback('', false);
      renderOwnerOptions();
      const platform = document.getElementById('accountPlatform');
      if (platform) platform.value = 'Google Ads';
      window.updateAccountSourceOptions();
      const saveBtn = document.getElementById('accountSaveBtn');
      if (saveBtn) {
        saveBtn.disabled = !window.AUTH_CAN_ADD_ACCOUNT;
        saveBtn.title = window.AUTH_CAN_ADD_ACCOUNT ? '' : 'Tryb Podgląd jako — zapis jest wyłączony.';
      }
      const note = document.getElementById('accountModalNote');
      if (!window.AUTH_CAN_ADD_ACCOUNT && note) {
        note.textContent = 'Tryb Podgląd jako: formularz odzwierciedla uprawnienia wybranej roli, ale zapis jest wyłączony.';
      }
      setTimeout(() => document.getElementById('accountId') && document.getElementById('accountId').focus(), 0);
    } catch (error) {
      console.error('[Account add]', error);
      feedback(error.message, true);
    }
  };

  window.closeAccountModal = function closeAccountModal() {
    const modal = document.getElementById('accountModal');
    if (modal) modal.hidden = true;
    const form = document.getElementById('accountForm');
    if (form) form.reset();
    feedback('', false);
  };

  window.saveAccount = async function saveAccount(event) {
    event.preventDefault();
    if (!window.AUTH_CAN_ADD_ACCOUNT) {
      feedback('Tryb Podgląd jako — zapis jest wyłączony.', true);
      return;
    }
    const btn = document.getElementById('accountSaveBtn');
    const source = document.getElementById('accountSource');
    const platform = text(document.getElementById('accountPlatform').value);
    const ownerEmail = selectedOwnerEmail();
    if (!ownerEmail) {
      feedback('Wybierz opiekuna konta.', true);
      return;
    }
    if (!source || source.disabled || !text(source.value)) {
      feedback(platform === 'Google Ads' ? 'Wybrany opiekun nie ma aktywnego MCK.' : 'Brak aktywnego Business Managera.', true);
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
        ownerEmail,
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
      if (session && session.authenticated && window.AUTH_SHOW_ADD_ACCOUNT) {
        loadOptions(false).catch(error => console.warn('[Account add preload]', error));
      }
    });
  }
})();
