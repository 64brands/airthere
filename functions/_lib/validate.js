import { isReservedSlug } from "./reserved.js";

export const SLUG_PATTERN = /^[a-z][a-z0-9-]{1,46}$/;
export const PROJECT_CODE_PATTERN = /^[a-z][a-z0-9_]{1,78}$/;
export const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export const clean = (value, limit = 200) =>
  typeof value === "string" ? value.trim().slice(0, limit) : "";

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const validateEmail = (value) => {
  const email = clean(value, 254).toLowerCase();
  if (!EMAIL_PATTERN.test(email) || email.includes("..") || email.startsWith(".") || email.endsWith(".")) {
    return { error: "Enter a valid email address." };
  }
  return { value: email };
};

export const suggestProjectCode = (name) =>
  clean(name, 120)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_")
    .slice(0, 80);

export const validateSlug = (slug) => {
  const value = clean(slug, 48).toLowerCase();
  if (!SLUG_PATTERN.test(value)) {
    return {
      error:
        "Use a lowercase slug starting with a letter, 2–48 characters, using letters, numbers and hyphens only.",
    };
  }
  if (isReservedSlug(value)) {
    return { error: "That slug is reserved for the AirThere website." };
  }
  return { value };
};

export const validateProjectCode = (code) => {
  const value = clean(code, 80).toLowerCase();
  if (!PROJECT_CODE_PATTERN.test(value)) {
    return {
      error:
        "Use a filename-safe code starting with a letter, using lowercase letters, numbers and underscores only.",
    };
  }
  return { value };
};

export const validateShootDate = (value) => {
  const date = clean(value, 10);
  const match = DATE_PATTERN.exec(date);
  if (!match) {
    return { error: "Shoot Date must be a valid calendar date." };
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return { error: "Shoot Date must be a valid calendar date." };
  }
  if (year < 2000 || year > 2100) {
    return { error: "Shoot Date is outside the supported range." };
  }
  return { value: date };
};

export const formatDisplayDate = (isoDate) => {
  const checked = validateShootDate(isoDate);
  if (checked.error) return isoDate;
  const [year, month, day] = checked.value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
};

export const validateLocation = (value) => {
  const location = clean(value, 200);
  return { value: location || null };
};

const parseCoordinate = (value, min, max, label) => {
  if (value === undefined || value === null || String(value).trim() === "") {
    return { value: null };
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    return { error: `${label} must be a number between ${min} and ${max}.` };
  }
  return { value: number };
};

export const validateLatitude = (value) => parseCoordinate(value, -90, 90, "Latitude");
export const validateLongitude = (value) => parseCoordinate(value, -180, 180, "Longitude");

export const formatGps = (latitude, longitude) => {
  if (latitude == null || longitude == null || latitude === "" || longitude === "") return "";
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return "";
  const latHem = lat < 0 ? "S" : "N";
  const lngHem = lng < 0 ? "W" : "E";
  return `${Math.abs(lat).toFixed(6)}° ${latHem}, ${Math.abs(lng).toFixed(6)}° ${lngHem}`;
};

export const formatTimestamp = (iso) => {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Australia/Sydney",
  }).format(date);
};

export const formatArchiveDate = (iso) => {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Australia/Sydney",
  }).format(date);
};

export const validateStatus = (value, allowed) => {
  const status = clean(value, 32).toLowerCase();
  if (!allowed.includes(status)) {
    return { error: `Status must be one of: ${allowed.join(", ")}.` };
  }
  return { value: status };
};
