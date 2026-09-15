/** Binding and secret *presence* only. Never return secret values. */

export const bindingPresence = (env) => ({
  db: Boolean(env?.DB),
  images: Boolean(env?.IMAGES),
});

export const secretPresence = (env) => ({
  access_aud: Boolean(env?.CF_ACCESS_AUD),
  access_team_domain: Boolean(env?.CF_ACCESS_TEAM_DOMAIN),
  session: Boolean(env?.SESSION_SECRET),
  resend: Boolean(env?.RESEND_API_KEY),
});
