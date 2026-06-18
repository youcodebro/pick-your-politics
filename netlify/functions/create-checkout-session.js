const { getBearerUser, supabaseRest } = require('./_supabase');

const STRIPE_API = 'https://api.stripe.com/v1';

function form(data) {
  const params = new URLSearchParams();
  Object.entries(data).forEach(([key, value]) => {
    if (value !== undefined && value !== null) params.append(key, value);
  });
  return params;
}

async function stripe(path, data) {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY is missing.');
  const res = await fetch(`${STRIPE_API}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      'content-type': 'application/x-www-form-urlencoded'
    },
    body: form(data)
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message || 'Stripe request failed.');
  return body;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  try {
    const user = await getBearerUser(event);
    if (!user) return { statusCode: 401, body: JSON.stringify({ error: 'Sign in required.' }) };

    const input = JSON.parse(event.body || '{}');
    const plan = input.plan === 'yearly' ? 'yearly' : 'monthly';
    const price = plan === 'yearly' ? process.env.STRIPE_PRICE_YEARLY : process.env.STRIPE_PRICE_MONTHLY;
    if (!price) throw new Error(`Stripe ${plan} price id is missing.`);

    const existing = await supabaseRest(`profiles?id=eq.${user.id}&select=stripe_customer_id,email`, {
      headers: { accept: 'application/json' }
    });
    let customerId = existing?.[0]?.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe('/customers', {
        email: user.email,
        'metadata[user_id]': user.id
      });
      customerId = customer.id;
      await supabaseRest('profiles', {
        method: 'POST',
        headers: { prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify({ id: user.id, email: user.email, stripe_customer_id: customerId })
      });
    }

    const fallbackApp = `${process.env.URL || event.headers.origin || ''}/app.html`;
    const appUrl = input.returnUrl || fallbackApp;
    const cleanAppUrl = appUrl.split('#')[0].split('?')[0];
    const session = await stripe('/checkout/sessions', {
      mode: 'subscription',
      customer: customerId,
      'line_items[0][price]': price,
      'line_items[0][quantity]': '1',
      success_url: `${cleanAppUrl}?checkout=success#dashboard`,
      cancel_url: `${cleanAppUrl}?checkout=cancel#upgrade`,
      'metadata[user_id]': user.id,
      'subscription_data[metadata][user_id]': user.id
    });

    return { statusCode: 200, body: JSON.stringify({ url: session.url }) };
  } catch (error) {
    return { statusCode: 400, body: JSON.stringify({ error: error.message }) };
  }
};
