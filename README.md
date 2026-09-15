# AirThere

Public website and shoot-management foundation for AirThere.

Live site: [https://airthere.com.au](https://airthere.com.au)

## What this repo is

A Cloudflare Pages project:

- static marketing homepage (`index.html`, `styles.css`, `script.js`)
- existing contact function (`/api/contact` → Resend)
- Admin at `/admin` (Cloudflare Access)
- customer routes resolved from D1 (`/ovpg`, then other slugs later)
- D1 data model: **Customer → Project → Shoot → Images**

There is no build step. The repository is the deploy artifact. Pushing to `main` deploys production via Cloudflare Pages.

## Hard product rule

**Shoot Date** is the date Paul selects when creating a shoot.

It is the only date used for chronology, filenames, gallery titles and R2 paths.

**Record created / uploaded** is internal metadata only. Never infer Shoot Date from today, file dates, or EXIF.

Example filename for Shoot Date 14 March 2025:

`mount_whitsunday_stage_1_140325_001.jpg`

## Local development

```bash
npx wrangler d1 execute airthere --local --file=migrations/0001_init.sql
npx wrangler d1 execute airthere --local --file=migrations/0002_seed_ovpg.sql
cp .dev.vars.example .dev.vars
npx wrangler pages dev .
```

`.dev.vars` is gitignored. Set `DEV_ADMIN_BYPASS=local` only for localhost.

## Required Cloudflare actions

This environment can create D1 databases, but **cannot** create R2 buckets, edit Pages project settings, or configure Cloudflare Access. Paul needs to complete the following in the 64brands Cloudflare account before Admin and the archive can go live.

### 1. Enable Workers Paid

Workers & Pages → plan → Workers Paid (USD $5/month). Needed for authenticated app routes.

### 2. Create private R2 buckets

R2 → Create bucket:

| Bucket | Purpose |
|---|---|
| `airthere-images` | Production originals + web derivatives |
| `airthere-images-preview` | Preview only — keep empty of real customer files |

Do **not** enable a public `r2.dev` URL, custom domain, or public object access.

Then uncomment the `r2_buckets` bindings in `wrangler.jsonc` (production `IMAGES` → `airthere-images`, preview `IMAGES` → `airthere-images-preview`) and redeploy.

### 3. Cloudflare Access for Admin

Protect `/admin` and `/api/admin*` with Google Workspace. Do not put an admin password in the app.

1. Open [Cloudflare Zero Trust](https://one.dash.cloudflare.com/).
2. Complete Zero Trust onboarding if prompted. Note the team domain, for example `something.cloudflareaccess.com`.
3. Settings → Authentication → **Add a login method** → Google. Use the existing Google Workspace identity.
4. Access → Applications → **Add an application** → Self-hosted.
5. Name: `AirThere Admin`.
6. Add public hostnames:
   - `airthere.com.au/admin`
   - `airthere.com.au/api/admin`
7. Policy: **Allow** the AirThere operator identity (Google email). Do not make it public.
8. Copy the application **AUD** tag from the application settings.

Until this is done, `/admin` shows that Access is required and admin APIs return 503. That is intentional.

### 4. Pages secrets (production)

Pages → `airthere` → Settings → Variables and secrets.

Keep the existing secret:

- `RESEND_API_KEY` (already used by `/api/contact`)

Add:

| Secret | Purpose |
|---|---|
| `SESSION_SECRET` | Long random value for customer portal cookies. Example: `openssl rand -base64 48` |
| `CF_ACCESS_TEAM_DOMAIN` | Zero Trust team domain, e.g. `yourteam.cloudflareaccess.com` |
| `CF_ACCESS_AUD` | Access application AUD tag |

Do not add these to the repository.

### 5. Confirm D1 bindings after first deploy

Production D1 already exists:

- `airthere` (`4f80e221-9f3d-46b4-9493-dfd9bec8bcae`)
- `airthere-preview` (`faa4d482-cadd-4f1d-8bbb-1a3d067c5d53`)

`wrangler.jsonc` binds them as `DB`. After merge, confirm Pages Settings → Bindings shows `DB` on production and the preview database on preview.

### 6. Optional zone redirect

The app already 301s `www.airthere.com.au` → `airthere.com.au` for HTML/app routes. A Cloudflare Redirect Rule for all www traffic is still a good extra if you want assets on www to canonicalise as well.

## Seeded records

After migrations:

- Customer: Ocean View Property Group / `ovpg` / active
- Project: Mount Whitsunday Stage 1 / `mount_whitsunday_stage_1` / active
- Portal password: **pending** (not stored). Set it in Admin after Access is enabled. Do not invent a password in git.

Stage 2 is not created.

## Preview safety

`*.airthere.pages.dev` does not serve Admin, portal, or media. Preview uses a separate D1 database. Production originals must never be bound to preview.
