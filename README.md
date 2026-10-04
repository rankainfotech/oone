# OONE — Getting Your Website Live

## Updating an already-live site (read this first if you've deployed before)

1. Run `supabase/migration_002_profile_and_banking.sql` once in Supabase → SQL Editor. It only **adds** new columns/tables — nothing existing is touched.
2. On GitHub, replace these files in your repo with the new versions from this zip: `src/App.jsx` (rewritten), and add the two new files `src/logo.js` and `supabase/migration_002_profile_and_banking.sql`. Easiest way: for each file, click it in your GitHub repo → pencil (edit) icon → select all → delete → paste the new content → Commit. For the two new files, use "Add file → Create new file" with the exact path shown.
3. Also update `package.json` and `package-lock.json` the same way (a new dependency, `xlsx`, was added for the Excel backup feature).
4. Vercel will redeploy automatically once you commit, or trigger it manually under Deployments → Redeploy.

---


You do NOT need to know how to code to complete these steps. Just follow in order.

## Part 1 — Create your database (Supabase)

1. Go to **supabase.com** → sign up (free) → **New Project**.
   - Name it anything, set a database password (save it somewhere), pick a region close to India.
   - Wait ~2 minutes for it to finish setting up.
2. In the left sidebar, click **SQL Editor** → **New query**.
3. Open the file `supabase/schema.sql` from this folder, copy ALL of it, paste it into the SQL editor, click **Run**.
   - This creates all your tables (customers, items, receipts) and security rules automatically.
4. In the left sidebar, click **Project Settings → API**. You'll see:
   - **Project URL**
   - **anon public** key
   - Keep this tab open, you'll need both in Part 3.
5. (Recommended for testing) Go to **Authentication → Providers → Email** and turn OFF "Confirm email", so new sign-ups don't need to click an email link while you're testing. You can turn it back on later for real customers.

## Part 2 — Put the code on GitHub

1. Go to **github.com** → sign up (free) → click **New repository** → name it `oone` → **Create repository**.
2. On the new repo page, click **uploading an existing file**.
3. Drag in every file and folder from this project folder (keep the `src` and `supabase` folders intact).
4. Scroll down, click **Commit changes**.

## Part 3 — Deploy it live (Vercel)

1. Go to **vercel.com** → sign up (free, use "Continue with GitHub" — easiest).
2. Click **Add New… → Project**, select your `oone` repository, click **Import**.
3. Before clicking Deploy, open **Environment Variables** and add two:
   - `VITE_SUPABASE_URL` → paste your Project URL from Part 1
   - `VITE_SUPABASE_ANON_KEY` → paste your anon public key from Part 1
4. Click **Deploy**. In about a minute you'll get a live link like `oone-yourname.vercel.app` — **this is your real, live website.**

## Part 4 — Make yourself the Super Admin

1. Open your live website link, sign up with your own email as if you were the first customer (this creates your business account).
2. Go back to Supabase → **SQL Editor → New query**, and run (replace with your real email):
   ```sql
   update profiles set is_super_admin = true
   where id = (select id from auth.users where email = 'you@example.com');
   ```
3. Reload your live website and log in again. You'll now see an **Admin** tab at the bottom showing every business that signs up, with the ability to Suspend or Activate any of them.

## Part 5 — Connect your domain, OONE.in

You've already booked this, so just point it at your live site:

1. In Vercel: open your project → **Settings → Domains** → type `oone.in` (and optionally `www.oone.in`) → **Add**.
2. Vercel will show you 1–2 DNS records to add (usually an "A" record and/or a "CNAME"). Log into wherever you bought the domain (GoDaddy, Namecheap, BigRock, etc.), find **DNS settings / Manage DNS**, and add exactly what Vercel showed you.
3. Come back to Vercel and wait for the domain to show a green "Valid Configuration" tick — usually a few minutes, sometimes up to a few hours.
4. Once it's green, `https://oone.in` is your live website.

---

### If something doesn't work
- Blank page after deploy → double check the two environment variable names are spelled exactly `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, then redeploy.
- Sign-up fails silently → check Supabase → Authentication → Providers → Email → confirm "Confirm email" is off, or check your inbox for a confirmation link.
- "Admin" tab missing → make sure you ran the Part 4 SQL with the exact email you signed up with.

### What this app currently does NOT include (can be added later)
- Payment gateway / billing for tenants
- SMS/WhatsApp payment reminders
- Native mobile app (this works as a mobile website already, and can be added to a phone's home screen like an app)
