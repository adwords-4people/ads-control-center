(function () {
  const state = { overview: null, loading: false, editingEmail: '', assigningAccount: null };

  function esc(value) {
    return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function text(value) { return String(value == null ? '' : value).trim(); }
  function lower(value) { return text(value).toLowerCase(); }
  function normId(value) { return text(value).replace(/^act_/i, '').replace(/[^0-9]/g, ''); }
  function num(value) {
    const raw = text(value).replace(/\s|\u00a0|zł|PLN|%/gi, '').replace(',', '.');
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  function fmtNumber(value, max = 0) {
    if (value == null || !Number.isFinite(value)) return '—';
    return new Intl.NumberFormat('pl-PL', { maximumFractionDigits: max }).format(value);
  }
  function fmtMoney(value) {
    if (value == null || !Number.isFinite(value)) return '—';
    return new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN', maximumFractionDigits: 0 }).format(value);
  }
  function pick(row, names) {
    if (!row) return '';
    for (const name of names) {
      if (row[name] !== undefined && text(row[name]) !== '') return row[name];
    }
    return '';
  }
  function rowsFor(rows, account) {
    const id = normId(account.accountId);
    const name = lower(account.name);
    return (rows || []).filter(row => {
      const rid = normId(row['ID Konta'] || row['ID konta']);
      if (id && rid) return id === rid;
      return name && lower(row['Konto'] || row['Nazwa konta'] || row['Nazwa Konta']) === name;
    });
  }
  function sumField(rows, names) {
    let found = false;
    const total = (rows || []).reduce((sum, row) => {
      const n = num(pick(row, names));
      if (n == null) return sum;
      found = true;
      return sum + n;
    }, 0);
    return found ? total : null;
  }
  function firstField(rows, names) {
    for (const row of rows || []) {
      const value = pick(row, names);
      if (text(value) !== '') return value;
    }
    return '';
  }

  function metricsFor(account) {
    const meta = account.platform === 'Meta Ads';
    const spendRows = rowsFor(meta ? DATA.metaWydatki : DATA.wydatki, account);
    const resultRows = rowsFor(meta ? DATA.metaMiesieczny : DATA.wyniki, account);
    const valueRows = rowsFor(meta ? DATA.metaWartoscKonwersji : DATA.wartKonw, account);

    const spend = sumField(spendRows, ['Koszt (miesiąc, do dziś)', 'Koszt (Miesiąc)', 'Koszt (miesiąc)', 'Koszt']);
    const forecast = sumField(spendRows, ['Prognoza kosztu (cały miesiąc)', 'Prognoza kosztu']);
    const result = sumField(resultRows, ['Wynik (Miesiąc)', 'Konwersje (Miesiąc)', 'Wynik (miesiąc)', 'Konwersje (miesiąc)']);
    const statusRaw = firstField(spendRows, ['Status', 'Status budżetu']);

    let roas = null;
    if (meta) {
      const convValue = sumField(valueRows, ['Wartość konwersji (Miesiąc)', 'Wartość Konwersji (Miesiąc)', 'Wartość konwersji', 'Wartość zakupów (Miesiąc)']);
      if (convValue != null && spend != null && spend > 0) roas = convValue / spend;
      if (roas == null) {
        const direct = num(firstField(valueRows, ['ROAS']));
        if (direct != null) roas = direct;
      }
    } else {
      roas = num(firstField(valueRows, ['ROAS']));
    }

    return { spend, forecast, result, roas, statusRaw };
  }

  function budgetState(account, metrics) {
    if (!account.active) return { label: 'Nieaktywne', cls: 'b-muted', alert: false };
    const n = num(metrics.statusRaw);
    if (n == null) return { label: 'Brak statusu', cls: 'b-muted', alert: false };
    let thresholds = { budzet_min: 85, budzet_max: 115 };
    try {
      thresholds = account.platform === 'Meta Ads'
        ? (typeof getMetaThresholds === 'function' ? getMetaThresholds(account.name, account.accountId) : thresholds)
        : (typeof getThresholds === 'function' ? getThresholds(account.name, account.accountId) : thresholds);
    } catch (_) {}
    if (n > thresholds.budzet_max) return { label: `${fmtNumber(n, 1)}%`, cls: 'b-red', alert: true };
    if (n < thresholds.budzet_min) return { label: `${fmtNumber(n, 1)}%`, cls: 'b-amber', alert: true };
    return { label: `${fmtNumber(n, 1)}%`, cls: 'b-green', alert: false };
  }

  function clientRows() {
    if (!state.overview) return [];
    return (state.overview.accounts || []).map(account => {
      const metrics = metricsFor(account);
      return { ...account, metrics, budgetState: budgetState(account, metrics) };
    });
  }

  function setClientKpiLabels(labels) {
    const pairs = [
      ['adminKpiLabelAccounts', labels[0]],
      ['adminKpiLabelGoogle', labels[1]],
      ['adminKpiLabelMeta', labels[2]],
      ['adminKpiLabelOwners', labels[3]],
    ];
    pairs.forEach(([id, value]) => { const el = document.getElementById(id); if (el) el.textContent = value; });
  }

  function metricToneClass(tone) {
    return tone === 'red' ? 'metric-red' : tone === 'amber' ? 'metric-amber' : tone === 'green' ? 'metric-green' : 'metric-gray';
  }
  function pctText(value, signed) {
    if (value == null || !Number.isFinite(Number(value))) return '\u2014';
    const n = Number(value);
    return (signed && n > 0 ? '+' : '') + fmtNumber(n, 1) + '%';
  }
  function healthMetric(value, tone, formatter) {
    if (value == null || !Number.isFinite(Number(value))) return '<span class="metric-empty">\u2014</span>';
    const display = formatter ? formatter(Number(value)) : fmtNumber(Number(value), 1);
    return `<span class="manager-metric ${metricToneClass(tone)}">${esc(display)}</span>`;
  }
  function priorityMarkup(health) {
    const priority = health && health.priority || 'ok';
    const labels = { intervention: 'Interwencja', check: 'Sprawd\u017a', ok: 'OK', inactive: 'Nieaktywne' };
    const reasons = (health && health.reasons || []).slice(0, 3);
    return `<span class="manager-priority ${esc(priority)}">${esc(labels[priority] || priority)}</span>` +
      (reasons.length ? `<small class="manager-health-sub">${esc(reasons.join(' \u00b7 '))}</small>` : '');
  }

  window.renderAdminClients = function renderAdminClients() {
    if (!window.AUTH_CAN_CLIENTS) return;
    const body = document.getElementById('adminClientsBody');
    const head = document.getElementById('adminClientsHead');
    const note = document.getElementById('adminClientsNote');
    if (!body) return;
    if (!state.overview) {
      body.innerHTML = '<tr><td colspan="9" class="admin-loading">\u0141adowanie\u2026</td></tr>';
      return;
    }

    const managerMode = state.overview.viewMode === 'team';
    const q = lower(document.getElementById('searchInput') && document.getElementById('searchInput').value);
    const platform = text(document.getElementById('adminClientPlatform') && document.getElementById('adminClientPlatform').value);
    const all = state.overview.accounts || [];
    let rows = all.filter(row => {
      if (platform && row.platform !== platform) return false;
      if (!q) return true;
      return [row.name, row.accountId, row.ownerName, row.ownerEmail, row.type, row.platform].some(value => lower(value).includes(q));
    });

    if (managerMode) {
      rows = rows.sort((a, b) => Number(a.health && a.health.priorityRank != null ? a.health.priorityRank : 9) - Number(b.health && b.health.priorityRank != null ? b.health.priorityRank : 9)
        || (a.ownerName || a.ownerEmail || '').localeCompare(b.ownerName || b.ownerEmail || '', 'pl')
        || a.name.localeCompare(b.name, 'pl'));
    } else {
      rows = rows.sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, 'pl'));
    }

    if (typeof PAGE_COUNTS !== 'undefined') PAGE_COUNTS.clients = { shown: rows.length, total: all.length };
    if (typeof updateResultsCountDisplay === 'function') updateResultsCountDisplay();

    if (managerMode) {
      if (head) head.innerHTML = '<tr><th>Klient / konto</th><th>Platforma</th><th>Opiekun</th><th>Bud\u017cet</th><th>Wynik</th><th>Trend wy\u015b.</th><th>Anomalia d/d</th><th>ROAS / CPA</th><th>Priorytet</th></tr>';
      if (note) note.textContent = `Widok Teamu ${state.overview.team || ''}. Konta wymagaj\u0105ce interwencji s\u0105 automatycznie przenoszone na g\u00f3r\u0119.`;
      body.innerHTML = rows.length ? rows.map(row => {
        const platformClass = row.platform === 'Meta Ads' ? 'meta' : 'google';
        const owner = row.ownerName || row.ownerEmail || '\u2014';
        const h = row.health || { metrics: {}, tones: {}, priority: 'ok', reasons: [] };
        const m = h.metrics || {};
        const tones = h.tones || {};
        const resultMain = healthMetric(m.result, tones.result, value => fmtNumber(value, 1));
        const resultSub = m.resultRatio == null ? '' : `<small class="manager-health-sub">vs poprz. ${esc(pctText(m.resultRatio, false))}</small>`;
        let efficiency = '<span class="metric-empty">\u2014</span>';
        if (lower(row.type) === 'sklep' && m.roas != null) efficiency = healthMetric(m.roas, tones.roas, value => `ROAS ${fmtNumber(value, 0)}%`);
        else if (m.cpa != null) efficiency = healthMetric(m.cpa, 'gray', value => `CPA ${fmtMoney(value)}`);
        return `<tr${row.active ? '' : ' class="admin-inactive-row"'}>
          <td><strong>${esc(row.name || row.accountId)}</strong><small class="admin-cell-sub">${esc(row.accountId)}</small></td>
          <td><span class="note-platforma-badge ${platformClass}">${esc(row.platform)}</span></td>
          <td>${esc(owner)}</td>
          <td>${healthMetric(m.budgetPct, tones.budget, value => pctText(value, false))}<small class="admin-cell-sub">Bud\u017cet: ${esc(fmtMoney(num(row.budget)))}</small></td>
          <td class="manager-health-cell">${resultMain}${resultSub}</td>
          <td>${healthMetric(m.trend, tones.trend, value => pctText(value, true))}</td>
          <td>${healthMetric(m.anomaly, tones.anomaly, value => pctText(value, true))}</td>
          <td>${efficiency}</td>
          <td class="manager-health-cell">${priorityMarkup(h)}</td>
        </tr>`;
      }).join('') : '<tr><td colspan="9" class="admin-loading">Brak pasuj\u0105cych kont.</td></tr>';

      const active = all.filter(row => row.active);
      const intervention = active.filter(row => row.health && row.health.priority === 'intervention').length;
      const check = active.filter(row => row.health && row.health.priority === 'check').length;
      const ok = active.filter(row => row.health && row.health.priority === 'ok').length;
      setClientKpiLabels(['Wymaga interwencji', 'Do sprawdzenia', 'OK', 'Aktywne konta']);
      document.getElementById('adminKpiAccounts').textContent = fmtNumber(intervention);
      document.getElementById('adminKpiGoogleAccounts').textContent = fmtNumber(check);
      document.getElementById('adminKpiMetaAccounts').textContent = fmtNumber(ok);
      document.getElementById('adminKpiOwners').textContent = fmtNumber(active.length);
      return;
    }

    if (head) head.innerHTML = '<tr><th>Klient / konto</th><th>Platforma</th><th>Opiekun</th><th>Typ</th><th>Bud\u017cet</th><th>Akcje</th></tr>';
    if (note) note.textContent = 'Widok zarz\u0105dczy Admina. Wszystkie konta Google Ads i Meta Ads.';
    body.innerHTML = rows.length ? rows.map(row => {
      const platformClass = row.platform === 'Meta Ads' ? 'meta' : 'google';
      const owner = row.ownerName || row.ownerEmail || '\u2014';
      const budget = num(row.budget);
      const canAssign = Boolean(window.AUTH_CAN_ADMIN && state.overview.canAssignAccounts);
      return `<tr${row.active ? '' : ' class="admin-inactive-row"'}>
        <td><strong>${esc(row.name || row.accountId)}</strong><small class="admin-cell-sub">${esc(row.accountId)}</small></td>
        <td><span class="note-platforma-badge ${platformClass}">${esc(row.platform)}</span></td>
        <td>${esc(owner)}${row.ownerEmail && row.ownerName ? `<small class="admin-cell-sub">${esc(row.ownerEmail)}</small>` : ''}</td>
        <td>${esc(row.type || '\u2014')}</td>
        <td class="mono">${fmtMoney(budget)}</td>
        <td class="admin-actions">${canAssign ? `<button type="button" class="admin-link-btn" onclick="openAccountAssignment('${esc(row.platform)}','${esc(row.accountId)}')">Przypisz</button>` : '\u2014'}</td>
      </tr>`;
    }).join('') : '<tr><td colspan="6" class="admin-loading">Brak pasuj\u0105cych kont.</td></tr>';

    const active = all.filter(row => row.active);
    const googleCount = active.filter(row => row.platform === 'Google Ads').length;
    const metaCount = active.filter(row => row.platform === 'Meta Ads').length;
    const owners = new Set(active.map(row => lower(row.ownerEmail || row.ownerName)).filter(Boolean));
    setClientKpiLabels(['Aktywne konta', 'Google Ads', 'Meta Ads', 'Aktywni opiekunowie']);
    document.getElementById('adminKpiAccounts').textContent = fmtNumber(active.length);
    document.getElementById('adminKpiGoogleAccounts').textContent = fmtNumber(googleCount);
    document.getElementById('adminKpiMetaAccounts').textContent = fmtNumber(metaCount);
    document.getElementById('adminKpiOwners').textContent = fmtNumber(owners.size);
  };

  function statusSummary(group, platform) {
    if (group.error) return { platform, tone: 'bad', status: 'Błąd', meta: group.error, details: '' };
    const rows = group.rows || [];
    if (!rows.length) return { platform, tone: 'warn', status: 'Brak danych', meta: 'Brak wierszy statusu synchronizacji', details: '' };
    const statusKey = 'Status';
    const bad = rows.filter(row => upper(row[statusKey]) !== 'OK');
    const dates = rows.map(row => text(row['Ostatni sync'])).filter(Boolean).sort().reverse();
    const latest = dates[0] || '—';
    const counts = platform === 'Google Ads'
      ? `${rows.reduce((sum, row) => sum + (num(row['Konta']) || 0), 0)} kont`
      : `${rows.reduce((sum, row) => sum + (num(row['Konta OK']) || 0), 0)} kont OK`;
    return {
      platform,
      tone: bad.length ? 'warn' : 'ok',
      status: bad.length ? `${bad.length} ostrzeż.` : 'OK',
      meta: `Ostatni sync: ${latest}`,
      details: `${counts} · ${rows.length} ${platform === 'Google Ads' ? 'MCK' : 'BM'}`,
    };
  }
  function upper(value) { return text(value).toUpperCase(); }

  function renderSystemStatus() {
    const el = document.getElementById('adminSystemStatus');
    if (!el || !state.overview) return;
    const google = statusSummary(state.overview.sync.google || {}, 'Google Ads');
    const meta = statusSummary(state.overview.sync.meta || {}, 'Meta Ads');
    const access = { platform: 'Private Sheets / OIDC', tone: 'ok', status: 'OK', meta: 'Panel Admin pobrał prywatną konfigurację', details: 'WIF aktywne' };
    el.innerHTML = [google, meta, access].map(item => `<div class="admin-status-item ${item.tone}">
      <div><strong>${esc(item.platform)}</strong><span>${esc(item.meta)}</span></div>
      <div class="admin-status-right"><b>${esc(item.status)}</b><small>${esc(item.details)}</small></div>
    </div>`).join('');
  }

  function renderEmployees() {
    if (!window.AUTH_CAN_ADMIN) return;
    const body = document.getElementById('adminEmployeesBody');
    if (!body || !state.overview) return;
    const actualEmail = lower(window.AUTH_SESSION && window.AUTH_SESSION.actualUser && window.AUTH_SESSION.actualUser.email);
    const users = (state.overview.users || []).slice().sort((a, b) => Number(b.active) - Number(a.active) || (a.name || a.email).localeCompare(b.name || b.email, 'pl'));
    body.innerHTML = users.length ? users.map(user => {
      const self = lower(user.email) === actualEmail;
      return `<tr${user.active ? '' : ' class="admin-inactive-row"'}>
        <td><strong>${esc(user.name || '—')}</strong></td>
        <td>${esc(user.email)}</td>
        <td><span class="badge b-navy">${esc(user.role || '—')}</span></td>
        <td>${esc(user.team || '—')}</td>
        <td><span class="badge ${user.active ? 'b-green' : 'b-muted'}">${user.active ? 'Aktywny' : 'Nieaktywny'}</span></td>
        <td class="admin-actions">
          <button type="button" class="admin-link-btn" onclick="openEmployeeModal('${esc(user.email)}')">Edytuj</button>
          ${self ? '<span class="admin-self-label">Twoje konto</span>' : `<button type="button" class="admin-link-btn ${user.active ? 'danger' : ''}" onclick="toggleEmployee('${esc(user.email)}', ${user.active ? 'false' : 'true'})">${user.active ? 'Usuń' : 'Przywróć'}</button>`}
        </td>
      </tr>`;
    }).join('') : '<tr><td colspan="6" class="admin-loading">Brak pracowników.</td></tr>';
  }

  function renderAllAdmin() {
    if (window.AUTH_CAN_ADMIN) { renderEmployees(); renderSystemStatus(); }
    window.renderAdminClients();
  }

  window.loadAdminOverview = async function loadAdminOverview(force) {
    if (!window.AUTH_CAN_CLIENTS || state.loading) return;
    if (state.overview && !force) { renderAllAdmin(); return; }
    state.loading = true;
    try {
      const response = await fetch('/api/admin/overview', { cache: 'no-store', credentials: 'same-origin' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.message || payload.error || `HTTP ${response.status}`);
      state.overview = payload;
      renderAllAdmin();
    } catch (error) {
      console.error('[Admin overview]', error);
      const system = document.getElementById('adminSystemStatus');
      const clients = document.getElementById('adminClientsBody');
      const employees = document.getElementById('adminEmployeesBody');
      if (system) system.innerHTML = `<div class="admin-error">${esc(error.message)}</div>`;
      if (clients) clients.innerHTML = `<tr><td colspan="9" class="admin-error">${esc(error.message)}</td></tr>`;
      if (employees) employees.innerHTML = `<tr><td colspan="6" class="admin-error">${esc(error.message)}</td></tr>`;
    } finally {
      state.loading = false;
    }
  };

  function activeUsers() {
    return ((state.overview && state.overview.users) || [])
      .filter(user => user.active)
      .slice()
      .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email, 'pl'));
  }

  function updateAssignmentMckOptions() {
    const account = state.assigningAccount;
    const wrap = document.getElementById('assignmentMckWrap');
    const select = document.getElementById('assignmentMck');
    const note = document.getElementById('assignmentModalNote');
    const targetEmail = lower(document.getElementById('assignmentUser') && document.getElementById('assignmentUser').value);
    if (!account || !wrap || !select) return;

    if (account.platform !== 'Google Ads') {
      wrap.hidden = true;
      select.required = false;
      if (note) note.textContent = 'Meta Ads: zmienimy opiekuna konta. Business Manager pozostaje bez zmian.';
      return;
    }

    wrap.hidden = false;
    select.required = true;
    const mcks = ((state.overview && state.overview.mcks) || []).filter(item => lower(item.ownerEmail) === targetEmail);
    if (!mcks.length) {
      select.innerHTML = '<option value="">Brak aktywnego MCK tego pracownika</option>';
      select.disabled = true;
      if (note) note.textContent = 'Ten pracownik nie ma aktywnego MCK. Najpierw przypisz mu MCK w konfiguracji.';
      return;
    }
    select.disabled = false;
    select.innerHTML = mcks.map(item => {
      const suffix = item.externalId ? ` · ${item.externalId}` : '';
      const selected = item.id === account.sourceId ? ' selected' : '';
      return `<option value="${esc(item.id)}"${selected}>${esc(item.name || item.id)}${esc(suffix)}</option>`;
    }).join('');
    if (note) note.textContent = mcks.length > 1
      ? 'Google Ads: wybierz MCK nowego opiekuna, pod którym konto ma być synchronizowane.'
      : 'Google Ads: konto zostanie przeniesione na MCK nowego opiekuna.';
  }

  window.openAccountAssignment = function openAccountAssignment(platform, accountId) {
    if (!window.AUTH_CAN_ADMIN || !state.overview) return;
    const account = (state.overview.accounts || []).find(row => row.platform === platform && normId(row.accountId) === normId(accountId));
    if (!account) return;
    state.assigningAccount = account;

    const modal = document.getElementById('accountAssignModal');
    const userSelect = document.getElementById('assignmentUser');
    const feedback = document.getElementById('assignmentModalFeedback');
    const title = document.getElementById('assignmentAccountTitle');
    if (!modal || !userSelect) return;

    if (title) title.textContent = `${account.name || account.accountId} · ${account.platform}`;
    userSelect.innerHTML = activeUsers().map(user => {
      const selected = lower(user.email) === lower(account.ownerEmail) ? ' selected' : '';
      const role = user.role ? ` · ${user.role}` : '';
      return `<option value="${esc(user.email)}"${selected}>${esc(user.name || user.email)}${esc(role)}</option>`;
    }).join('');
    if (feedback) { feedback.textContent = ''; feedback.className = 'admin-modal-feedback'; }
    modal.hidden = false;
    updateAssignmentMckOptions();
  };

  window.updateAssignmentMckOptions = updateAssignmentMckOptions;

  window.closeAccountAssignment = function closeAccountAssignment() {
    const modal = document.getElementById('accountAssignModal');
    if (modal) modal.hidden = true;
    state.assigningAccount = null;
  };

  window.saveAccountAssignment = async function saveAccountAssignment(event) {
    event.preventDefault();
    const account = state.assigningAccount;
    if (!account || !window.AUTH_CAN_ADMIN) return;
    const btn = document.getElementById('assignmentSaveBtn');
    const feedback = document.getElementById('assignmentModalFeedback');
    const targetEmail = text(document.getElementById('assignmentUser').value);
    const mckSelect = document.getElementById('assignmentMck');
    const sourceId = account.platform === 'Google Ads' && mckSelect && !mckSelect.disabled ? text(mckSelect.value) : '';
    if (account.platform === 'Google Ads' && !sourceId) {
      feedback.textContent = 'Wybierz MCK nowego opiekuna.';
      feedback.className = 'admin-modal-feedback err';
      return;
    }

    btn.disabled = true;
    feedback.textContent = 'Przenoszenie konta…';
    feedback.className = 'admin-modal-feedback';
    try {
      const response = await fetch('/api/admin/accounts', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: account.platform, accountId: account.accountId, targetEmail, sourceId }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.message || result.error || `HTTP ${response.status}`);
      window.closeAccountAssignment();
      state.overview = null;
      await window.loadAdminOverview(true);
      if (typeof showToast === 'function') showToast('Konto przypisane do nowego opiekuna.', 'ok');
    } catch (error) {
      feedback.textContent = error.message;
      feedback.className = 'admin-modal-feedback err';
    } finally {
      btn.disabled = false;
    }
  };

  window.openEmployeeModal = function openEmployeeModal(email) {
    if (!window.AUTH_CAN_ADMIN) return;
    const modal = document.getElementById('employeeModal');
    const user = email && state.overview ? (state.overview.users || []).find(item => lower(item.email) === lower(email)) : null;
    state.editingEmail = user ? user.email : '';
    document.getElementById('employeeModalTitle').textContent = user ? 'Edytuj pracownika' : 'Dodaj pracownika';
    document.getElementById('employeeName').value = user ? user.name : '';
    const emailInput = document.getElementById('employeeEmail');
    emailInput.value = user ? user.email : '';
    emailInput.disabled = Boolean(user);
    document.getElementById('employeeRole').value = user && user.role ? user.role : 'Specjalista';
    document.getElementById('employeeTeam').value = user && user.team ? user.team : 'PPC';
    document.getElementById('employeeModalFeedback').textContent = '';
    modal.hidden = false;
    setTimeout(() => document.getElementById('employeeName').focus(), 0);
  };

  window.closeEmployeeModal = function closeEmployeeModal() {
    const modal = document.getElementById('employeeModal');
    if (modal) modal.hidden = true;
    state.editingEmail = '';
  };

  window.saveEmployee = async function saveEmployee(event) {
    event.preventDefault();
    const btn = document.getElementById('employeeSaveBtn');
    const feedback = document.getElementById('employeeModalFeedback');
    btn.disabled = true;
    feedback.textContent = 'Zapisywanie…';
    feedback.className = 'admin-modal-feedback';
    try {
      const payload = {
        action: 'save',
        name: text(document.getElementById('employeeName').value),
        email: state.editingEmail || text(document.getElementById('employeeEmail').value),
        role: text(document.getElementById('employeeRole').value),
        team: text(document.getElementById('employeeTeam').value),
      };
      const response = await fetch('/api/admin/employees', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.message || result.error || `HTTP ${response.status}`);
      window.closeEmployeeModal();
      state.overview = null;
      await window.loadAdminOverview(true);
      if (typeof showToast === 'function') showToast(result.created ? 'Pracownik dodany.' : 'Dane pracownika zapisane.', 'ok');
    } catch (error) {
      feedback.textContent = error.message;
      feedback.className = 'admin-modal-feedback err';
    } finally {
      btn.disabled = false;
    }
  };

  window.toggleEmployee = async function toggleEmployee(email, activate) {
    const actionText = activate ? 'przywrócić' : 'usunąć z aktywnego systemu';
    if (!window.confirm(`Czy na pewno chcesz ${actionText} pracownika ${email}?`)) return;
    try {
      const response = await fetch('/api/admin/employees', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: activate ? 'activate' : 'deactivate', email }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.message || result.error || `HTTP ${response.status}`);
      state.overview = null;
      await window.loadAdminOverview(true);
      if (typeof showToast === 'function') showToast(activate ? 'Pracownik przywrócony.' : 'Pracownik dezaktywowany.', 'ok');
    } catch (error) {
      if (typeof showToast === 'function') showToast(error.message, 'err');
      else window.alert(error.message);
    }
  };

  document.addEventListener('ppc:data-loaded', () => {
    if (window.AUTH_CAN_CLIENTS) window.renderAdminClients();
  });

  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (document.getElementById('employeeModal') && !document.getElementById('employeeModal').hidden) window.closeEmployeeModal();
    if (document.getElementById('accountAssignModal') && !document.getElementById('accountAssignModal').hidden) window.closeAccountAssignment();
  });

  if (typeof waitForAuth === 'function') {
    waitForAuth().then(session => {
      if (session && session.authenticated && window.AUTH_CAN_CLIENTS) window.loadAdminOverview();
    });
  }
})();
