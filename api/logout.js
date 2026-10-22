const { clearSessionCookie } = require('./_lib/auth');

module.exports = async function handler(req, res) {
  clearSessionCookie(res);
  res.setHeader('Cache-Control', 'no-store');
  res.statusCode = 204;
  res.end();
};
