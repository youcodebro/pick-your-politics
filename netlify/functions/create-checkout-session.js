const { getBearerUser, supabaseRest } = require('./_supabase');
const { activeStatus, appReturnUrl, stripePost } = require('./_stripe');

function withCheckoutState(url, state) {
  const next = new URL(url);
  next.searchParams.set('checkout', state);
  return next.toString();
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

    await supabaseRest('users', {
      method: 'POST',
      headers: { prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({
        id: user.id,
        email: user.email,
        display_name: user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0] || null
      })
    });

    const existing = await supabaseRest(`subscriptions?user_id=eq.${user.id}&select=stripe_customer_id,status`, {
      headers: { accept: 'application/json' }
    });
    const subscription = existing?.[0];
    let customerId = subscription?.stripe_customer_id;

    const dashboardUrl = appReturnUrl(input.returnUrl, event, 'dashboard');
    const upgradeUrl = appReturnUrl(input.returnUrl, event, 'upgrade');

    if (customerId && activeStatus(subscription?.status)) {
      const portal = await stripePost('/billing_portal/sessions', {
        customer: customerId,
        return_url: dashboardUrl
      });
      return { statusCode: 200, body: JSON.stringify({ url: portal.url, mode: 'portal' }) };
    }

    if (!customerId) {
      const customer = await stripePost('/customers', {
        email: user.email,
        name: user.user_metadata?.full_name || user.user_metadata?.name || undefined,
        'metadata[user_id]': user.id
      });
      customerId = customer.id;
    }

    await supabaseRest('subscriptions?on_conflict=user_id', {
      method: 'POST',
      headers: { prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({
        user_id: user.id,
        stripe_customer_id: customerId,
        plan,
        status: 'inactive'
      })
    });

    const session = await stripePost('/checkout/sessions', {
      mode: 'subscription',
      customer: customerId,
      'line_items[0][price]': price,
      'line_items[0][quantity]': '1',
      success_url: withCheckoutState(dashboardUrl, 'success'),
      cancel_url: withCheckoutState(upgradeUrl, 'cancel'),
      client_reference_id: user.id,
      'metadata[user_id]': user.id,
      'metadata[plan]': plan,
      'subscription_data[metadata][user_id]': user.id
    });

    return { statusCode: 200, body: JSON.stringify({ url: session.url, mode: 'checkout' }) };
  } catch (error) {
    return { statusCode: 400, body: JSON.stringify({ error: error.message }) };
  }
};
