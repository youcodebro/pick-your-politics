# PYP Backend Setup

## Supabase
1. Create a Supabase project.
2. Run `supabase/schema.sql` in the Supabase SQL editor.
3. Enable Google OAuth in Supabase Auth if you want Google sign-in.
4. To grant admin access, set the user's auth app metadata role to `admin`. In the SQL editor, replace the email and run:

```sql
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
where email = 'admin@example.com';
```

5. Add these environment variables in Netlify:
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
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
5. Webhook deliveries are recorded in `stripe_webhook_events`, so Stripe retries are safe and duplicate events are ignored.
6. In local development, forward Stripe events to Netlify Dev:

```powershell
stripe listen --forward-to localhost:8888/.netlify/functions/stripe-webhook
```

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

## PWA
1. The app shell is cached by `public/service-worker.js`.
2. Main pages register the worker through `public/js/pyp-pwa.js`.
3. User data, auth, payments, and Netlify Function calls are network-only or network-first so cached results do not silently override live backend data.
4. After deployment, verify:
   - the app can be installed from the browser
   - `/offline.html` appears when offline and uncached pages are unavailable
   - `questions.html`, `app.html`, and `share.html` still fetch live Supabase data when online

## Public Share / OG Images
1. Signed-in users create share links through `/.netlify/functions/create-share-link`.
2. The public URL should be the Netlify Function URL returned by the API:
   - `/.netlify/functions/share?token=...`
3. That function renders dynamic OG tags for crawlers and redirects real visitors into:
   - `/share.html?token=...`
4. `/.netlify/functions/share-data?token=...` returns only public-safe snapshot data and increments view count.
5. `/.netlify/functions/og-image?token=...` renders the social preview image from the saved `share_links` snapshot.
