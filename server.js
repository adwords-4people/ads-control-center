const express = require('express');
const path = require('path');

const app = express();

app.disable('x-powered-by');

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

function loadHandler(modulePath) {
  const loaded = require(modulePath);
  return loaded && loaded.default ? loaded.default : loaded;
}

function wrap(handler) {
  return async function cloudRunHandler(req, res, next) {
    try {
      await handler(req, res);
    } catch (error) {
      next(error);
    }
  };
}

// -------------------------------------------------------
// Health check Cloud Run
// -------------------------------------------------------

app.get('/api/health', (req, res) => {
  res.status(200).json({
    ok: true,
    service: 'ppc-control-center',
    runtime: 'cloud-run',
  });
});
app.get('/api/health/sheets', async (req, res) => {
  try {
    const {
      IDS,
      fetchSheetByName,
      serviceAccountEmail
    } = require('./api/_lib/sheets');

    const result = await fetchSheetByName(
      IDS.config,
      'Użytkownicy',
      req
    );

    res.status(200).json({
      ok: true,
      service: 'ppc-control-center',
      runtime: 'cloud-run',
      sheets: true,
      serviceAccount: serviceAccountEmail(),
      rows: Array.isArray(result.rows) ? result.rows.length : 0
    });
  } catch (error) {
    console.error('[Sheets health]', error);

    res.status(500).json({
      ok: false,
      service: 'ppc-control-center',
      runtime: 'cloud-run',
      sheets: false,
      error: error && error.message
        ? error.message
        : String(error)
    });
  }
});

// -------------------------------------------------------
// Existing API routes
// -------------------------------------------------------

app.all(
  '/api/auth/login',
  wrap(loadHandler('./api/auth/login'))
);

app.all(
  '/api/auth/callback',
  wrap(loadHandler('./api/auth/callback'))
);

app.all(
  '/api/logout',
  wrap(loadHandler('./api/logout'))
);

app.all(
  '/api/me',
  wrap(loadHandler('./api/me'))
);

app.all(
  '/api/dashboard-data',
  wrap(loadHandler('./api/dashboard-data'))
);

app.all(
  '/api/notes',
  wrap(loadHandler('./api/notes'))
);

app.all(
  '/api/accounts/self-service',
  wrap(loadHandler('./api/accounts/self-service'))
);

app.all(
  '/api/admin/accounts',
  wrap(loadHandler('./api/admin/accounts'))
);

app.all(
  '/api/admin/employees',
  wrap(loadHandler('./api/admin/employees'))
);

app.all(
  '/api/admin/overview',
  wrap(loadHandler('./api/admin/overview'))
);

app.all(
  '/api/admin/preview',
  wrap(loadHandler('./api/admin/preview'))
);

app.all(
  '/api/admin/users',
  wrap(loadHandler('./api/admin/users'))
);

// -------------------------------------------------------
// Frontend
// -------------------------------------------------------

const frontendFiles = [
  'styles.css',
  'auth.css',
  'data.js',
  'notes.js',
  'auth.js',
  'accounts.js',
  'admin.js',
  'dashboard.js',
  'bootstrap.js',
];

frontendFiles.forEach((file) => {
  app.get(`/${file}`, (req, res) => {
    res.sendFile(path.join(__dirname, file));
  });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// -------------------------------------------------------
// Errors / 404
// -------------------------------------------------------

app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
  });
});

app.use((error, req, res, next) => {
  console.error(error);

  if (res.headersSent) {
    return next(error);
  }

  res.status(500).json({
    error: 'Internal server error',
  });
});

// -------------------------------------------------------
// Start
// -------------------------------------------------------

const port = Number(process.env.PORT || 8080);

app.listen(port, '0.0.0.0', () => {
  console.log(`PPC Control Center listening on port ${port}`);
});