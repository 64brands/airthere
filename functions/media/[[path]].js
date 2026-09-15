import { json } from "../_lib/http.js";

export const onRequest = async () =>
  json({ error: "Authenticated media delivery is not available yet." }, 404);
