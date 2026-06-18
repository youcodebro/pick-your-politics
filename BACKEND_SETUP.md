# PYP Backend Setup

## Supabase
1. Create a Supabase project.
2. Run `supabase/schema.sql` in the Supabase SQL editor.
3. Enable Google OAuth in Supabase Auth if you want Google sign-in.
4. Add these environment variables in Netlify:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`

## Stripe
1. Create monthly and yearly recurring prices in Stripe.
2. Add these environment variables in Netlify:
   - `STRIPE_SECRET_KEY`
   - `STRIPE_WEBHOOK_SECRET`
   - `STRIPE_PRICE_MONTHLY`
   - `STRIPE_PRICE_YEARLY`
3. Point the Stripe webhook endpoint to:
   - `https://YOUR_SITE.netlify.app/.netlify/functions/stripe-webhook`
4. Subscribe the webhook to:
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`

## Local Development
Use Netlify Dev for functions:

```powershell
netlify dev
```

The static app can still run with:

```powershell
python -m http.server 8000 -d public
```

Backend features require Netlify Functions, so use `netlify dev` when testing auth config, checkout, webhooks, and OG images locally.
