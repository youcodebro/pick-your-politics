const STRIPE_API = 'https://api.stripe.com/v1';

function requireStripeSecret() {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY is missing.');
  }
  return process.env.STRIPE_SECRET_KEY;
}

function form(data = {}) {
  const params = new URLSearchParams();
  Object.entries(data).forEach(([key, value]) => {
    if (value !== undefined && value !== null) params.append(key, value);
  });
  return params;
}

async function stripeRequest(method, path, data) {
  const options = {
    method,
    headers: {
      authorization: `Bearer ${requireStripeSecret()}`
    }
  };
  if (data && method !== 'GET') {
    options.headers['content-type'] = 'application/x-www-form-urlencoded';
    options.body = form(data);
  }
  const res = await fetch(`${STRIPE_API}${path}`, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error?.message || 'Stripe request failed.');
  return body;
}

function stripePost(path, data) {
  return stripeRequest('POST', path, data);
}

function stripeGet(path) {
  return stripeRequest('GET', path);
}

function planFromPrice(priceId) {
  if (priceId === process.env.STRIPE_PRICE_YEARLY) return 'yearly';
  if (priceId === process.env.STRIPE_PRICE_MONTHLY) return 'monthly';
  return null;
}

function statusFromStripe(status) {
  if (status === 'canceled') return 'cancelled';
  if (['active','cancelled','past_due','trialing','incomplete','inactive'].includes(status)) return status;
  return 'inactive';
}

function activeStatus(status) {
  return status === 'active' || status === 'trialing';
}

function appReturnUrl(inputUrl, event, hash = 'dashboard') {
  const origin = event.headers.origin || process.env.URL || process.env.DEPLOY_PRIME_URL || '';
  const fallback = `${origin}/app.html`;
  try {
    const candidate = new URL(inputUrl || fallback, origin || undefined);
    const expected = origin ? new URL(origin).origin : candidate.origin;
    if (candidate.origin !== expected) return `${fallback}#${hash}`;
    candidate.hash = hash;
    return candidate.toString();
  } catch {
    return `${fallback}#${hash}`;
  }
}

module.exports = {
  activeStatus,
  appReturnUrl,
  planFromPrice,
  statusFromStripe,
  stripeGet,
  stripePost
};
