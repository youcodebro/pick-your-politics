const crypto = require('crypto');
const { supabaseRest } = require('./_supabase');

function verify(rawBody, header, secret) {
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET is missing.');
  const parts = Object.fromEntries((header || '').split(',').map(part => part.split('=')));
  const signed = `${parts.t}.${rawBody}`;
  const expected = crypto.createHmac('sha256', secret).update(signed).digest('hex');
  const received = parts.v1 || '';
  if (!received || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received))) {
    throw new Error('Invalid Stripe signature.');
  }
}

async function mirrorSubscription(subscription) {
  const userId = subscription.metadata?.user_id;
  if (!userId) return;
  const item = subscription.items?.data?.[0];
  await supabaseRest('profiles', {
    method: 'POST',
    headers: { prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({
      id: userId,
      stripe_customer_id: subscription.customer,
      subscription_status: subscription.status,
      stripe_subscription_id: subscription.id,
      price_id: item?.price?.id || null,
      current_period_end: subscription.current_period_end
        ? new Date(subscription.current_period_end * 1000).toISOString()
        : null
    })
  });
}

exports.handler = async (event) => {
  try {
    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body || '', 'base64').toString('utf8')
      : (event.body || '');
    verify(rawBody, event.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
    const stripeEvent = JSON.parse(rawBody || '{}');
    if (
      stripeEvent.type === 'customer.subscription.created' ||
      stripeEvent.type === 'customer.subscription.updated' ||
      stripeEvent.type === 'customer.subscription.deleted'
    ) {
      await mirrorSubscription(stripeEvent.data.object);
    }
    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  } catch (error) {
    return { statusCode: 400, body: JSON.stringify({ error: error.message }) };
  }
};
