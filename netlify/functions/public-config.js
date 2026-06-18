exports.handler = async () => {
  const body = {
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
    stripeMonthlyPriceId: process.env.STRIPE_PRICE_MONTHLY || '',
    stripeYearlyPriceId: process.env.STRIPE_PRICE_YEARLY || '',
    appUrl: process.env.URL || process.env.DEPLOY_PRIME_URL || ''
  };

  return {
    statusCode: 200,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'public, max-age=300'
    },
    body: JSON.stringify(body)
  };
};
