# AirThere

Public website and shoot-management foundation for AirThere.

Live site: [https://airthere.com.au](https://airthere.com.au)

## What this repo is

A Cloudflare Pages project:

- static marketing homepage (`index.html`, `styles.css`, `script.js`)
- existing contact function (`/api/contact` → Resend)
- Admin at `/admin` (Cloudflare Access authenticates; AirThere authorises Super Admin / Manager)
- customer routes resolved from D1 (`/ovpg`, then other slugs later)
- D1 data model: **Customer → Project → Shoot → Images** plus operational `admin_users`

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
npx wrangler d1 execute airthere --local --file=migrations/0003_admin_users.sql
cp .dev.vars.example .dev.vars
npx wrangler pages dev .
```

`.dev.vars` is gitignored. Set `DEV_ADMIN_BYPASS=local` and `DEV_ADMIN_EMAIL` only for localhost. Local bypass still requires a matching active `admin_users` row.

## Access model

Cloudflare Access answers **who this person is**. AirThere answers **what they may do**.

| Layer | Super Admin / Manager | Client |
|---|---|---|
| URL | `/admin`, `/api/admin/*` | `/{customerSlug}` e.g. `/ovpg` |
| Authentication | Cloudflare Access | Shared customer portal password |
| Authorisation | `admin_users.role` | `customers.id` ownership |

Customers are never stored in `admin_users`. OVPG is a customer, not an operator.

### Cloudflare Access setup (do this in Zero Trust)

Create a **new** Access application for AirThere. Do **not** change the existing 64OS/`64.au` application or its **Paul only** policy.

Because Paul is currently the only operator, the AirThere policy may permit only `paul@64.com.au`. The application itself is not hard-coded to that email: another operator is added later by creating an `admin_users` row **and** adding them to this Access policy.

`/admin` and `/api/admin` can be protected together on **one** Access application with two public hostnames. Separate Access applications are not required.

#### AirThere Access Application

| Setting | Value |
|---|---|
| Name | `AirThere Admin` |
| Type | Self-hosted |
| Session duration | 24 hours |

Add **two destinations on the same application** (not two apps):

1. Application domain `airthere.com.au`, path `admin*`
2. Application domain `airthere.com.au`, path `api/admin*`

That covers `/admin`, `/admin/`, `/api/admin/customers`, etc. Do **not** put `/ovpg` or other customer slugs behind Access.

#### Initial Access Policy

| Setting | Value |
|---|---|
| Policy name | `AirThere operators` |
| Action | Allow |
| Include | Emails → `paul@64.com.au` |

Do not name this policy “Paul only”. The 64.au policy can keep that name; AirThere should stay independently manageable.

#### Authentication methods

Reuse whatever already authenticates `paul@64.com.au` on the existing 64.au Access application. Do not add Google Workspace/OAuth unless that is already how 64.au Access works.

#### Values AirThere needs after the app exists

| Secret | Where to copy it |
|---|---|
| `CF_ACCESS_TEAM_DOMAIN` | Zero Trust overview / Settings. It looks like `yourteam.cloudflareaccess.com` (hostname only, no `https://`). |
| `CF_ACCESS_AUD` | Open **AirThere Admin** → Settings / Overview → **Application Audience (AUD) Tag**. |

Both are Pages **secrets**, not git.

Until Access is on, `/admin` shows that Access is required. After Access is on, AirThere still denies anyone who is not an active row in `admin_users`.

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

Follow **Access model → Cloudflare Access setup** above. Summary:

1. Open [Cloudflare Zero Trust](https://one.dash.cloudflare.com/).
2. Add a **self-hosted** application named `AirThere Admin`.
3. Protect `airthere.com.au` paths `admin*` and `api/admin*` on that **same** application.
4. Policy name `AirThere operators`, Action **Allow**, Include email `paul@64.com.au`.
5. Reuse the login methods that already authenticate `paul@64.com.au` on 64.au. Do not modify 64.au.
6. Copy the team domain and the **AirThere Admin** AUD tag into Pages secrets.

Until this is done, `/admin` shows that Access is required and admin APIs return 503. After Access is on, Cloudflare login alone is still not enough — the identity must match an active `admin_users` row.

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

| Record | Name | Identifier |
| --- | --- | --- |
| Super Admin | Paul | `paul@64.com.au` (`super_admin` / `active`) |
| Customer | Ocean View Property Group | slug `ovpg` |
| Project | Mount Whitsunday Stage 1 | `mount_whitsunday_stage_1` |

There are **zero** Manager users. OVPG is a customer, not an operator, and is not stored in `admin_users`.

The Super Admin display name is stored as **Paul**, matching the brief identity. A longer profile name was not invented.

Operator IDs are in `migrations/0003_admin_users.sql`. Customer IDs are in `migrations/0002_seed_ovpg.sql`. The portal password hash is `NULL` until Paul sets it in Admin. Do not invent a password in git.

Stage 2 is not created.

## Preview safety

`*.airthere.pages.dev` does not serve Admin, portal, or media. Preview uses a separate D1 database. Production originals must never be bound to preview.
