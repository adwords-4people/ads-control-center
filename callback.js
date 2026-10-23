const {
  consumeAndVerifyState,
  requireEnv,
  setSessionCookie,
} = require('../_lib/auth');
const { getActiveUserByEmail } = require('../_lib/users');

function redirect(res, location) {
  res.statusCode = 302;
  res.setHeader('Location', location);
  res.end();
}

module.exports = async function handler(req, res) {
  const appUrl = (process.env.APP_URL || '').replace(/\/$/, '');
  const fallback = appUrl || '/';

  try {
    if (req.query && req.query.error) return redirect(res, `${fallback}/?auth=oauth_error`);

    const code = req.query && req.query.code;
    const state = req.query && req.query.state;
    if (!code || !consumeAndVerifyState(req, res, state)) {
      return redirect(res, `${fallback}/?auth=invalid_state`);
    }

    const clientId = requireEnv('GOOGLE_CLIENT_ID');
    const clientSecret = requireEnv('GOOGLE_CLIENT_SECRET');
    const configuredAppUrl = requireEnv('APP_URL').replace(/\/$/, '');
    const allowedDomain = (process.env.ALLOWED_DOMAIN || '4people.pl').toLowerCase();

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: `${configuredAppUrl}/api/auth/callback`,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenResponse.ok) throw new Error(`Wymiana kodu OAuth nie powiodła się: HTTP ${tokenResponse.status}.`);
    const tokens = await tokenResponse.json();
    if (!tokens.id_token) throw new Error('Google nie zwrócił id_token.');

    const verifyResponse = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(tokens.id_token)}`,
      { cache: 'no-store' }
    );
    if (!verifyResponse.ok) throw new Error('Nie udało się zweryfikować tokenu Google.');
    const identity = await verifyResponse.json();

    const issuerOk = identity.iss === 'https://accounts.google.com' || identity.iss === 'accounts.google.com';
    const audienceOk = identity.aud === clientId;
    const email = String(identity.email || '').toLowerCase();
    const domainOk = identity.hd === allowedDomain && email.endsWith(`@${allowedDomain}`);
    const emailVerified = String(identity.email_verified) === 'true';

    if (!issuerOk || !audienceOk || !domainOk || !emailVerified) {
      return redirect(res, `${configuredAppUrl}/?auth=domain_denied`);
    }

    const user = await getActiveUserByEmail(email, req);
    if (!user) return redirect(res, `${configuredAppUrl}/?auth=forbidden`);

    setSessionCookie(res, user);
    return redirect(res, `${configuredAppUrl}/?auth=ok`);
  } catch (error) {
    console.error('[Auth callback]', error);
    return redirect(res, `${fallback}/?auth=oauth_error`);
  }
};
