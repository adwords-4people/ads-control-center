(function () {
  'use strict';
  const BUILD = '1.7.3';
  let started = false;

  function esc(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function setStatus(message, isError) {
    window.PPC_BOOT_STATUS = message;
    const last = document.getElementById('lastUpdate');
    if (last) {
      last.textContent = (isError ? 'Błąd startu: ' : '') + message;
      last.title = 'PPC Dashboard build ' + BUILD;
    }
    if (isError) {
      const body = document.getElementById('statusBody');
      if (body) {
        body.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--red);padding:24px">' + esc(message) + '<br><br>Build: ' + BUILD + '</td></tr>';
      }
    }
  }

  function errText(error) {
    if (!error) return 'Nieznany błąd';
    return error.message || error.reason || String(error);
  }

  window.addEventListener('error', function (event) {
    const msg = '[runtime ' + BUILD + '] ' + (event.message || 'Błąd JavaScript') + (event.filename ? ' · ' + event.filename.split('/').pop() + ':' + event.lineno : '');
    console.error(msg, event.error || event);
    if (!started) setStatus(msg, true);
  });

  window.addEventListener('unhandledrejection', function (event) {
    const msg = '[promise ' + BUILD + '] ' + errText(event.reason);
    console.error(msg, event.reason);
    if (!started) setStatus(msg, true);
  });

  function timeout(ms, label) {
    return new Promise((_, reject) => setTimeout(() => reject(new Error(label)), ms));
  }

  async function boot() {
    if (started) return;
    started = true;
    setStatus('Start aplikacji ' + BUILD + '…', false);

    if (typeof window.waitForAuth !== 'function') {
      setStatus('auth.js nie udostępnił waitForAuth().', true);
      return;
    }

    let session;
    try {
      session = await Promise.race([
        window.waitForAuth(),
        timeout(15000, 'Timeout oczekiwania na sesję /api/me.')
      ]);
    } catch (error) {
      setStatus(errText(error), true);
      return;
    }

    if (!session || !session.authenticated) {
      setStatus('Brak aktywnej sesji użytkownika.', true);
      return;
    }

    if (typeof window.loadAllData !== 'function') {
      setStatus('dashboard.js nie udostępnił loadAllData(). Wersja dashboard.js: ' + String(window.PPC_DASHBOARD_JS_VERSION || 'nieznana'), true);
      return;
    }

    setStatus('Pobieranie danych ' + BUILD + '…', false);
    try {
      await window.loadAllData();
    } catch (error) {
      setStatus('loadAllData(): ' + errText(error), true);
    }
  }

  window.PPC_APP_BUILD = BUILD;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
