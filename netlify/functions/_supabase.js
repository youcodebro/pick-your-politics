const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function supabaseHeaders(extra = {}) {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error('Supabase server environment is not configured.');
  }
  return {
    apikey: SERVICE_KEY,
    authorization: `Bearer ${SERVICE_KEY}`,
    'content-type': 'application/json',
    ...extra
  };
}

async function supabaseRest(path, options = {}) {
  if (!SUPABASE_URL) throw new Error('SUPABASE_URL is missing.');
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: supabaseHeaders(options.headers || {})
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = data?.message || data?.error || res.statusText;
    throw new Error(msg);
  }
  return data;
}

async function getBearerUser(event) {
  const auth = event.headers.authorization || event.headers.Authorization || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token || !SUPABASE_URL) return null;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: process.env.SUPABASE_ANON_KEY || SERVICE_KEY,
      authorization: `Bearer ${token}`
    }
  });
  if (!res.ok) return null;
  return res.json();
}

module.exports = { supabaseRest, getBearerUser };
