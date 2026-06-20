const crypto = require('crypto');
const { supabaseRest } = require('./_supabase');
const { planFromPrice, statusFromStripe, stripeGet } = require('./_stripe');

function verify(rawBody, header, secret) {
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET is missing.');
  const parts = {};
  (header || '').split(',').forEach(part => {
    const [key, ...rest] = part.split('=');
    if (key) parts[key] = rest.join('=');
  });
  if (!parts.t || !parts.v1) throw new Error('Missing Stripe signature.');
  const signed = `${parts.t}.${rawBody}`;
  const expected = crypto.createHmac('sha256', secret).update(signed).digest('hex');
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(parts.v1);
  if (expectedBuffer.length !== receivedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, receivedBuffer)) {
    throw new Error('Invalid Stripe signature.');
  }
}

async function mirrorSubscription(subscription) {
  const userId = subscription.metadata?.user_id;
  if (!userId) return;
  const item = subscription.items?.data?.[0];
  const priceId = item?.price?.id || null;
  const plan = planFromPrice(priceId) || subscription.metadata?.plan || null;
  const status = statusFromStripe(subscription.status);
  await supabaseRest('subscriptions?on_conflict=user_id', {
    method: 'POST',
    headers: { prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({
      user_id: userId,
      stripe_customer_id: subscription.customer,
      stripe_sub_id: subscription.id,
      plan,
      status,
      current_period_end: subscription.current_period_end
        ? new Date(subscription.current_period_end * 1000).toISOString()
        : null
    })
  });
}

async function mirrorCheckoutSession(session) {
  const userId = session.metadata?.user_id || session.client_reference_id;
  if (!userId) return;
  if (session.subscription) {
    const subscription = await stripeGet(`/subscriptions/${session.subscription}?expand[]=items.data.price`);
    subscription.metadata = { ...(subscription.metadata || {}), user_id: userId };
    await mirrorSubscription(subscription);
    return;
  }
  if (session.customer) {
    await supabaseRest('subscriptions?on_conflict=user_id', {
      method: 'POST',
      headers: { prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({
        user_id: userId,
        stripe_customer_id: session.customer,
        plan: session.metadata?.plan || null,
        status: 'inactive'
      })
    });
  }
}

exports.handler = async (event) => {
  try {
    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body || '', 'base64').toString('utf8')
      : (event.body || '');
    verify(rawBody, event.headers['stripe-signature'] || event.headers['Stripe-Signature'], process.env.STRIPE_WEBHOOK_SECRET);
    const stripeEvent = JSON.parse(rawBody || '{}');
    if (
      stripeEvent.type === 'customer.subscription.created' ||
      stripeEvent.type === 'customer.subscription.updated' ||
      stripeEvent.type === 'customer.subscription.deleted'
    ) {
      await mirrorSubscription(stripeEvent.data.object);
    } else if (stripeEvent.type === 'checkout.session.completed') {
      await mirrorCheckoutSession(stripeEvent.data.object);
    }
    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  } catch (error) {
    return { statusCode: 400, body: JSON.stringify({ error: error.message }) };
  }
};
