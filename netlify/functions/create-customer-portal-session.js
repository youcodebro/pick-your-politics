const { getBearerUser, supabaseRest } = require('./_supabase');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  try {
    const user = await getBearerUser(event);
    if (!user) return { statusCode: 401, body: JSON.stringify({ error: 'Sign in required.' }) };

    const profile = await supabaseRest(`subscriptions?user_id=eq.${user.id}&select=stripe_customer_id`, {
      headers: { accept: 'application/json' }
    });
    const customer = profile?.[0]?.stripe_customer_id;
    if (!customer) throw new Error('No Stripe customer found.');

    const input = JSON.parse(event.body || '{}');
    const res = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        customer,
        return_url: input.returnUrl || event.headers.origin || process.env.URL || ''
      })
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error?.message || 'Could not create portal session.');
    return { statusCode: 200, body: JSON.stringify({ url: body.url }) };
  } catch (error) {
    return { statusCode: 400, body: JSON.stringify({ error: error.message }) };
  }
};
