const { createState, requireEnv, setStateCookie } = require('../_lib/auth');

module.exports = async function handler(req, res) {
  try {
    const clientId = requireEnv('GOOGLE_CLIENT_ID');
    const appUrl = requireEnv('APP_URL').replace(/\/$/, '');
    const allowedDomain = process.env.ALLOWED_DOMAIN || '4people.pl';
    const state = createState();

    setStateCookie(res, state);

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: `${appUrl}/api/auth/callback`,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      hd: allowedDomain,
      prompt: 'select_account',
      include_granted_scopes: 'true',
    });

    res.statusCode = 302;
    res.setHeader('Location', `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
    res.end();
  } catch (error) {
    console.error('[Auth login]', error);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Logowanie Google nie jest jeszcze skonfigurowane na serwerze.');
  }
};
