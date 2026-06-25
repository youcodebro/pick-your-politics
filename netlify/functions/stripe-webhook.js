const crypto = require('crypto');
const { supabaseRest } = require('./_supabase');
const { planFromPrice, statusFromStripe, stripeGet } = require('./_stripe');

const HANDLED_EVENTS = new Set([
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted'
]);

function verify(rawBody, header, secret) {
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET is missing.');
  const parts = {};
  (header || '').split(',').forEach(part => {
    const [key, ...rest] = part.split('=');
    if (key) parts[key] = rest.join('=');
  });
  if (!parts.t || !parts.v1) throw new Error('Missing Stripe signature.');
  const timestamp = Number(parts.t);
  const age = Math.abs(Math.floor(Date.now() / 1000) - timestamp);
  if (!Number.isFinite(timestamp) || age > 300) throw new Error('Stripe signature timestamp is outside tolerance.');
  const signed = `${parts.t}.${rawBody}`;
  const expected = crypto.createHmac('sha256', secret).update(signed).digest('hex');
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(parts.v1);
  if (expectedBuffer.length !== receivedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, receivedBuffer)) {
    throw new Error('Invalid Stripe signature.');
  }
}

async function markEventStarted(stripeEvent) {
  const rows = await supabaseRest('stripe_webhook_events?on_conflict=id', {
    method: 'POST',
    headers: { prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify({
      id: stripeEvent.id,
      event_type: stripeEvent.type,
      status: 'processing'
    })
  });
  if (Array.isArray(rows) && rows.length > 0) return true;

  const existing = await supabaseRest(
    `stripe_webhook_events?id=eq.${encodeURIComponent(stripeEvent.id)}&select=status&limit=1`,
    { headers: { accept: 'application/json' } }
  );
  if (existing?.[0]?.status !== 'failed') return false;

  await supabaseRest(`stripe_webhook_events?id=eq.${encodeURIComponent(stripeEvent.id)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      status: 'processing',
      error: null,
      processed_at: null
    })
  });
  return true;
}

async function markEventDone(stripeEvent, status = 'processed', error = null) {
  await supabaseRest(`stripe_webhook_events?id=eq.${encodeURIComponent(stripeEvent.id)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      status,
      error,
      processed_at: new Date().toISOString()
    })
  });
}

async function findUserIdForCustomer(customerId) {
  if (!customerId) return null;
  const rows = await supabaseRest(
    `subscriptions?stripe_customer_id=eq.${encodeURIComponent(customerId)}&select=user_id&limit=1`,
    { headers: { accept: 'application/json' } }
  );
  return rows?.[0]?.user_id || null;
}

async function mirrorSubscription(subscription) {
  const userId = subscription.metadata?.user_id || await findUserIdForCustomer(subscription.customer);
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
  let stripeEvent = null;
  try {
    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body || '', 'base64').toString('utf8')
      : (event.body || '');
    verify(rawBody, event.headers['stripe-signature'] || event.headers['Stripe-Signature'], process.env.STRIPE_WEBHOOK_SECRET);
    stripeEvent = JSON.parse(rawBody || '{}');

    if (!HANDLED_EVENTS.has(stripeEvent.type)) {
      await markEventStarted(stripeEvent).catch(() => false);
      await markEventDone(stripeEvent, 'ignored').catch(() => {});
      return { statusCode: 200, body: JSON.stringify({ received: true, ignored: true }) };
    }

    const firstDelivery = await markEventStarted(stripeEvent);
    if (!firstDelivery) {
      return { statusCode: 200, body: JSON.stringify({ received: true, duplicate: true }) };
    }

    if (
      stripeEvent.type === 'customer.subscription.created' ||
      stripeEvent.type === 'customer.subscription.updated' ||
      stripeEvent.type === 'customer.subscription.deleted'
    ) {
      await mirrorSubscription(stripeEvent.data.object);
    } else if (stripeEvent.type === 'checkout.session.completed') {
      await mirrorCheckoutSession(stripeEvent.data.object);
    }
    await markEventDone(stripeEvent);
    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  } catch (error) {
    if (stripeEvent?.id) {
      await markEventDone(stripeEvent, 'failed', error.message).catch(() => {});
    }
    return { statusCode: 400, body: JSON.stringify({ error: error.message }) };
  }
};
