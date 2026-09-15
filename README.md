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
| Policy name | `AirThere Operators` |
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

Until Access is configured, `/admin` shows that Access is required. After Access is on, AirThere still denies anyone who is not an active row in `admin_users`.

## Cloudflare configuration

Paul completed the following in the 64brands account. Wrangler is the source of truth for D1/R2 bindings. Pages **secrets stay in the dashboard** and are not committed.

| Environment | D1 | R2 (`env.IMAGES`) | Config / secrets |
|---|---|---|---|
| Production | `DB` → `airthere` | `airthere-images` | `CANONICAL_HOST`; secrets `CF_ACCESS_AUD`, `CF_ACCESS_TEAM_DOMAIN`, `SESSION_SECRET`, `RESEND_API_KEY` |
| Preview | `DB` → `airthere-preview` | `airthere-images-preview` | `CANONICAL_HOST`, `PREVIEW_LOCKDOWN=true`; secrets `CF_ACCESS_AUD`, `CF_ACCESS_TEAM_DOMAIN`, `SESSION_SECRET` |

Both R2 buckets are private: no `r2.dev` public URL, no public bucket access, no public custom domain.

Access application **AirThere Admin** protects `/admin*` and `/api/admin*` only. Policy **AirThere Operators** allows `paul@64.com.au`. Do not modify 64.au / 64OS Access.

Optional: a Cloudflare Redirect Rule for all `www` traffic is still a good extra if you want assets on www to canonicalise as well. HTML/app routes already 301 to the apex host.

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

`*.airthere.pages.dev` does not serve Admin, portal, or media. Preview uses D1 `airthere-preview` and R2 `airthere-images-preview` via the same `DB` and `IMAGES` binding names. Production originals must never be bound to preview.
