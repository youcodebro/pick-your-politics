const { getBearerUser, supabaseRest } = require('./_supabase');
const { appReturnUrl, stripePost } = require('./_stripe');

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
    const body = await stripePost('/billing_portal/sessions', {
      customer,
      return_url: appReturnUrl(input.returnUrl, event, 'dashboard')
    });
    return { statusCode: 200, body: JSON.stringify({ url: body.url }) };
  } catch (error) {
    return { statusCode: 400, body: JSON.stringify({ error: error.message }) };
  }
};
