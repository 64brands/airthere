const app = document.querySelector("#app");
const statusEl = document.querySelector("#status");
const titleEl = document.querySelector("#view-title");
const leadEl = document.querySelector("#view-lead");

const ROLE_LABELS = {
  super_admin: "Super Admin",
  manager: "Manager",
};

const nameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

const state = {
  user: null,
  customers: [],
  projects: [],
  shoots: [],
  selectedCustomerId: "",
  selectedProjectId: "",
};

const ingest = {
  shootDate: "",
  dateDraft: "",
  dateError: "",
  files: [],
  rejected: [],
  busy: false,
  calendarOpen: false,
  calendarYear: 0,
  calendarMonth: 0,
};

const shootView = {
  requestedId: "",
  loading: false,
  error: "",
  shoot: null,
  images: [],
  addFiles: [],
  addRejected: [],
  recoverFiles: [],
  recoverRejected: [],
  busy: false,
  actionError: "",
  deleteOpen: false,
  deleteConfirmText: "",
};

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const COMPLETE_SHOOT_STATUSES = new Set(["uploaded", "verified", "published"]);

const isSuperAdmin = () => state.user?.role === "super_admin";

const canDeleteShoot = () =>
  Array.isArray(state.user?.capabilities)
    ? state.user.capabilities.includes("delete_shoots")
    : isSuperAdmin();

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const setStatus = (message, isError = false) => {
  statusEl.textContent = message || "";
  statusEl.style.color = isError ? "#e15f28" : "#1f3356";
};

const api = async (path, options = {}) => {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Request failed.");
  }
  return data;
};

const uploadOriginalBytes = async (path, file) => {
  const response = await fetch(path, {
    method: "PUT",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "image/jpeg",
    },
    body: file,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Original upload failed.");
  }
  return data;
};

const currentIngestSelection = () => {
  const selectedCustomerId = state.selectedCustomerId || state.customers[0]?.id || "";
  const customer = state.customers.find((item) => item.id === selectedCustomerId);
  const projects = state.projects.filter((project) => project.customer_id === selectedCustomerId);
  const selectedProjectId = projects.some((project) => project.id === state.selectedProjectId)
    ? state.selectedProjectId
    : projects[0]?.id || "";
  const project = projects.find((item) => item.id === selectedProjectId);
  return { customer, project, shootDate: ingest.shootDate };
};

const uploadShoot = async () => {
  if (ingest.busy) return;
  const { customer, project, shootDate } = currentIngestSelection();
  if (!customer || !project || !shootDate || !ingest.files.length) {
    setStatus("Choose the client, project, Capture Date and JPEGs first.", true);
    return;
  }

  ingest.busy = true;
  const uploadButton = document.querySelector("#ingest-upload");
  if (uploadButton) uploadButton.disabled = true;

  const fileMap = new Map(ingest.files.map((file) => [file.name.toLowerCase(), file]));
  const failures = [];

  try {
    setStatus("Preparing capture…");
    const started = await api("/api/admin/shoots/ingest", {
      method: "POST",
      body: {
        project_id: project.id,
        shoot_date: shootDate,
        files: ingest.files.map((file) => ({
          original_filename: file.name,
          byte_size: file.size,
        })),
      },
    });

    const images = started.images || [];
    const total = images.length;
    let storedCount = images.filter((image) => image.stored).length;

    for (let index = 0; index < images.length; index += 1) {
      const image = images[index];
      if (image.stored) continue;
      const file = fileMap.get(String(image.original_filename || "").toLowerCase());
      if (!file) {
        failures.push(`${image.original_filename}: re-select this original JPEG to continue.`);
        continue;
      }
      setStatus(`Uploading ${index + 1} of ${total}`);
      try {
        await uploadOriginalBytes(
          `/api/admin/shoots/${started.shoot_id}/originals/${image.id}`,
          file
        );
        storedCount += 1;
      } catch (error) {
        failures.push(`${file.name}: ${error.message}`);
      }
    }

    if (failures.length) {
      throw new Error(
        `Upload incomplete. ${storedCount} of ${total} originals stored. ${failures.join(" ")}`
      );
    }

    const completed = await api(`/api/admin/shoots/${started.shoot_id}/complete`, {
      method: "POST",
      body: {},
    });
    let verified;
    try {
      verified = await api(`/api/admin/shoots/${started.shoot_id}/verify`, {
        method: "POST",
        body: {},
      });
    } catch (error) {
      ingest.files = [];
      ingest.rejected = [];
      ingest.shootDate = "";
      ingest.dateDraft = "";
      ingest.dateError = "";
      ingest.calendarOpen = false;
      await loadAll();
      ingest.busy = false;
      location.hash = `shoots/view/${started.shoot_id}`;
      setStatus(error.message, true);
      return;
    }
    ingest.files = [];
    ingest.rejected = [];
    ingest.shootDate = "";
    ingest.dateDraft = "";
    ingest.dateError = "";
    ingest.calendarOpen = false;
    await loadAll();
    ingest.busy = false;
    try {
      const standards = await generateMissingStandards(started.shoot_id);
      location.hash = `shoots/view/${started.shoot_id}`;
      setStatus(
        standardImagesLabel({
          standard_expected: standards?.standard_expected,
          standard_ready: standards?.standard_ready,
        }) ||
          verified.message ||
          completed.message ||
          `${completed.image_count || total} originals in this capture`
      );
    } catch (error) {
      location.hash = `shoots/view/${started.shoot_id}`;
      setStatus(error.message, true);
    }
  } catch (error) {
    ingest.busy = false;
    try {
      await loadAll();
    } catch {
      /* keep the local ingest selection visible */
    }
    render();
    setStatus(error.message, true);
  }
};

const suggestCode = (name) =>
  String(name || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);

const filenameDateFromShootDate = (shootDate) => {
  const [year, month, day] = String(shootDate).split("-");
  return `${day}${month}${year.slice(2)}`;
};

const padSeq = (seq) => (seq > 999 ? String(seq) : String(seq).padStart(3, "0"));

const generatedFilename = (projectCode, shootDate, seq) =>
  `${projectCode}_${filenameDateFromShootDate(shootDate)}_${padSeq(seq)}.jpg`;

const displayShootDate = (isoDate) => {
  if (!isoDate) return "";
  const [year, month, day] = isoDate.split("-").map(Number);
  if (!year || !month || !day) return isoDate;
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
};

const parseIsoShootDate = (value) => {
  const date = String(value || "").trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) {
    return { error: "Use YYYY-MM-DD, for example 2025-03-21." };
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
    return { error: "Capture Date must be a valid calendar date." };
  }
  if (year < 2000 || year > 2100) {
    return { error: "Capture Date is outside the supported range." };
  }
  return { value: date };
};

const utcTodayIso = () => {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(
    now.getUTCDate()
  ).padStart(2, "0")}`;
};

const ensureCalendarCursor = () => {
  const source = parseIsoShootDate(ingest.shootDate || ingest.dateDraft);
  const iso = source.value || utcTodayIso();
  const [year, month] = iso.split("-").map(Number);
  if (!ingest.calendarYear || !ingest.calendarMonth) {
    ingest.calendarYear = year;
    ingest.calendarMonth = month;
  }
};

const shiftCalendar = (delta) => {
  ensureCalendarCursor();
  const date = new Date(Date.UTC(ingest.calendarYear, ingest.calendarMonth - 1 + delta, 1));
  ingest.calendarYear = date.getUTCFullYear();
  ingest.calendarMonth = date.getUTCMonth() + 1;
};

const renderCalendar = (selectedIso) => {
  ensureCalendarCursor();
  const year = ingest.calendarYear;
  const month = ingest.calendarMonth;
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const jsWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const leading = (jsWeekday + 6) % 7;
  const cells = [];
  for (let i = 0; i < leading; i += 1) cells.push("<span class=\"cal-day is-empty\"></span>");
  for (let day = 1; day <= days; day += 1) {
    const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const selected = iso === selectedIso ? " is-selected" : "";
    cells.push(
      `<button type="button" class="cal-day${selected}" data-pick-date="${iso}">${day}</button>`
    );
  }
  return `
    <div class="ingest-calendar" role="dialog" aria-label="Capture Date calendar">
      <div class="cal-header">
        <button type="button" class="cal-nav" data-cal-shift="-1" aria-label="Previous month">‹</button>
        <p>${MONTH_NAMES[month - 1]} ${year}</p>
        <button type="button" class="cal-nav" data-cal-shift="1" aria-label="Next month">›</button>
      </div>
      <div class="cal-weekdays">${WEEKDAY_LABELS.map((label) => `<span>${label}</span>`).join("")}</div>
      <div class="cal-grid">${cells.join("")}</div>
    </div>
  `;
};

const collectDroppedFiles = (dataTransfer) => {
  if (dataTransfer?.files && dataTransfer.files.length) {
    return Array.from(dataTransfer.files);
  }
  const files = [];
  const items = dataTransfer?.items;
  if (!items) return files;
  for (const item of items) {
    if (item.kind === "file") {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }
  return files;
};

const isJpegFile = (file) => {
  const name = String(file?.name || "").toLowerCase();
  const type = String(file?.type || "").toLowerCase();
  return (
    type === "image/jpeg" ||
    type === "image/jpg" ||
    name.endsWith(".jpg") ||
    name.endsWith(".jpeg")
  );
};

const addJpegFilesTo = (store, fileList) => {
  const incoming = Array.from(fileList || []);
  const existing = new Set(store.files.map((file) => file.name.toLowerCase()));
  incoming.forEach((file) => {
    if (!isJpegFile(file)) {
      store.rejected.push({ name: file.name, reason: "JPEG required" });
      return;
    }
    const key = file.name.toLowerCase();
    if (existing.has(key)) {
      store.rejected.push({ name: file.name, reason: "already selected" });
      return;
    }
    existing.add(key);
    store.files.push(file);
  });
  store.files.sort((a, b) => nameCollator.compare(a.name, b.name));
  if (store.rejected.length > 8) store.rejected.splice(0, store.rejected.length - 8);
};

const addJpegFiles = (fileList) =>
  addJpegFilesTo({ files: ingest.files, rejected: ingest.rejected }, fileList);

const addShootViewFiles = (fileList) =>
  addJpegFilesTo({ files: shootView.addFiles, rejected: shootView.addRejected }, fileList);

const missingShootImages = () => shootView.images.filter((image) => !image.stored);

const recoverNameMap = () => {
  const map = new Map();
  missingShootImages().forEach((image) => {
    if (image.original_filename) map.set(String(image.original_filename).toLowerCase(), image);
    if (image.generated_filename) map.set(String(image.generated_filename).toLowerCase(), image);
  });
  return map;
};

const addRecoverFiles = (fileList) => {
  const missing = recoverNameMap();
  Array.from(fileList || []).forEach((file) => {
    if (!isJpegFile(file)) {
      shootView.recoverRejected.push({ name: file.name, reason: "JPEG required" });
      return;
    }
    const key = file.name.toLowerCase();
    if (!missing.has(key)) {
      shootView.recoverRejected.push({
        name: file.name,
        reason: "not one of the missing originals",
      });
      return;
    }
    if (shootView.recoverFiles.some((item) => item.name.toLowerCase() === key)) {
      shootView.recoverRejected.push({ name: file.name, reason: "already selected" });
      return;
    }
    shootView.recoverFiles.push(file);
  });
  if (shootView.recoverRejected.length > 8) {
    shootView.recoverRejected.splice(0, shootView.recoverRejected.length - 8);
  }
};

const originalsCountLabel = (count) =>
  `${count} original${count === 1 ? "" : "s"} in this capture`;

const standardImagesLabel = (shoot) => {
  const expected = Number(shoot?.standard_expected || 0);
  const ready = Number(shoot?.standard_ready || 0);
  if (!expected) return "";
  if (ready === expected) return `Standard images: ${ready} of ${expected} ready ✓`;
  return `Standard images: ${ready} of ${expected} ready`;
};

const generateMissingStandards = async (shootId, retryFailed = false) => {
  const skipIds = [];
  let last = null;
  for (let index = 0; index < 220; index += 1) {
    last = await api(`/api/admin/shoots/${shootId}/standards`, {
      method: "POST",
      body: { retry: retryFailed, skip_ids: skipIds },
    });
    const item = last.processed?.[0];
    if (!item) break;
    if (item.status === "failed") skipIds.push(item.image_id);
    const expected = Number(last.standard_expected || 0);
    const ready = Number(last.standard_ready || 0);
    if (expected) setStatus(`Standard images: ${ready} of ${expected} ready`);
    if (Number(last.remaining_pending || 0) === 0) {
      if (!retryFailed) break;
      if (Number(last.standard_failed || 0) === 0) break;
      if (skipIds.length >= Number(last.standard_failed || 0)) break;
    }
  }
  return last;
};

const liveShootCount = (shoot, images = []) => {
  if (Array.isArray(images) && images.length) return images.length;
  if (shoot && shoot.image_count != null) return Number(shoot.image_count || 0);
  return Number(shoot?.expected_count || 0);
};

const resetShootView = () => {
  shootView.requestedId = "";
  shootView.loading = false;
  shootView.error = "";
  shootView.shoot = null;
  shootView.images = [];
  shootView.addFiles = [];
  shootView.addRejected = [];
  shootView.recoverFiles = [];
  shootView.recoverRejected = [];
  shootView.busy = false;
  shootView.actionError = "";
  shootView.deleteOpen = false;
  shootView.deleteConfirmText = "";
};

const addToShoot = async () => {
  const shoot = shootView.shoot;
  if (!shoot || shootView.busy || !shootView.addFiles.length) return;

  shootView.busy = true;
  shootView.actionError = "";
  const uploadButton = document.querySelector("#shoot-add-upload");
  if (uploadButton) uploadButton.disabled = true;

  const fileMap = new Map(shootView.addFiles.map((file) => [file.name.toLowerCase(), file]));
  const failures = [];

  try {
    setStatus("Preparing new originals…");
    const started = await api(`/api/admin/shoots/${shoot.id}/originals`, {
      method: "POST",
      body: {
        files: shootView.addFiles.map((file) => ({
          original_filename: file.name,
          byte_size: file.size,
        })),
      },
    });

    const images = started.images || [];
    const total = images.length;
    let storedCount = images.filter((image) => image.stored).length;

    for (let index = 0; index < images.length; index += 1) {
      const image = images[index];
      if (image.stored) continue;
      const file = fileMap.get(String(image.original_filename || "").toLowerCase());
      if (!file) {
        failures.push(`${image.original_filename}: re-select this original JPEG to continue.`);
        continue;
      }
      setStatus(`Adding ${index + 1} of ${total}`);
      try {
        await uploadOriginalBytes(
          `/api/admin/shoots/${shoot.id}/originals/${image.id}`,
          file
        );
        storedCount += 1;
      } catch (error) {
        failures.push(`${file.name}: ${error.message}`);
      }
    }

    if (failures.length) {
      throw new Error(
        `Add incomplete. ${storedCount} of ${total} originals stored. ${failures.join(" ")}`
      );
    }

    const completed = await api(`/api/admin/shoots/${shoot.id}/complete`, {
      method: "POST",
      body: {},
    });
    let verified;
    try {
      verified = await api(`/api/admin/shoots/${shoot.id}/verify`, {
        method: "POST",
        body: {},
      });
    } catch (error) {
      shootView.addFiles = [];
      shootView.addRejected = [];
      shootView.busy = false;
      await loadAll();
      await loadShootView(shoot.id);
      setStatus(error.message, true);
      return;
    }
    shootView.addFiles = [];
    shootView.addRejected = [];
    shootView.busy = false;
    try {
      await generateMissingStandards(shoot.id);
    } catch (error) {
      await loadAll();
      await loadShootView(shoot.id);
      setStatus(error.message, true);
      return;
    }
    await loadAll();
    await loadShootView(shoot.id);
    setStatus(verified.message || completed.message || originalsCountLabel(shootView.images.length));
  } catch (error) {
    shootView.busy = false;
    shootView.actionError = error.message;
    const leftover = shootView.addFiles.slice();
    try {
      await loadAll();
      await loadShootView(shoot.id);
      if (missingShootImages().length && leftover.length) {
        shootView.addFiles = [];
        addRecoverFiles(leftover);
        render();
      }
    } catch {
      render();
    }
    setStatus(error.message, true);
  }
};

const removeShootImage = async (imageId) => {
  const shoot = shootView.shoot;
  if (!shoot || shootView.busy || !imageId) return;
  if (!window.confirm("Remove this image from the Capture?")) return;

  shootView.busy = true;
  shootView.actionError = "";
  try {
    setStatus("Removing image…");
    await api(`/api/admin/shoots/${shoot.id}/originals/${imageId}`, { method: "DELETE" });
    shootView.busy = false;
    await loadAll();
    await loadShootView(shoot.id);
    setStatus(originalsCountLabel(shootView.images.length));
  } catch (error) {
    shootView.busy = false;
    shootView.actionError = error.message;
    render();
    setStatus(error.message, true);
  }
};

const deleteShootFromView = async () => {
  const shoot = shootView.shoot;
  if (!shoot || shootView.busy || !canDeleteShoot()) return;
  if (String(shootView.deleteConfirmText || "").trim() !== "DELETE") return;

  shootView.busy = true;
  shootView.actionError = "";
  const submit = document.querySelector("#shoot-delete-submit");
  if (submit) submit.disabled = true;

  try {
    setStatus("Deleting capture…");
    await api(`/api/admin/shoots/${shoot.id}`, {
      method: "DELETE",
      body: { confirm: "DELETE" },
    });
    await loadAll();
    resetShootView();
    setStatus("");
    if (location.hash.replace(/^#/, "") === "shoots") render();
    else location.hash = "shoots";
  } catch (error) {
    shootView.busy = false;
    shootView.actionError = error.message;
    render();
    setStatus(error.message, true);
  }
};

const continueShootUpload = async () => {
  const shoot = shootView.shoot;
  const missing = missingShootImages();
  if (!shoot || shootView.busy || !missing.length || !shootView.recoverFiles.length) return;

  shootView.busy = true;
  shootView.actionError = "";
  const uploadButton = document.querySelector("#shoot-recover-upload");
  if (uploadButton) uploadButton.disabled = true;

  const fileMap = new Map(shootView.recoverFiles.map((file) => [file.name.toLowerCase(), file]));
  const failures = [];
  let storedCount = 0;

  try {
    for (let index = 0; index < missing.length; index += 1) {
      const image = missing[index];
      const file =
        fileMap.get(String(image.original_filename || "").toLowerCase()) ||
        fileMap.get(String(image.generated_filename || "").toLowerCase());
      if (!file) {
        failures.push(`${image.generated_filename}: supply this original to continue.`);
        continue;
      }
      setStatus(`Uploading missing original ${index + 1} of ${missing.length}`);
      try {
        await uploadOriginalBytes(`/api/admin/shoots/${shoot.id}/originals/${image.id}`, file);
        storedCount += 1;
      } catch (error) {
        failures.push(`${file.name}: ${error.message}`);
      }
    }

    if (failures.length) {
      throw new Error(
        `Upload incomplete. ${storedCount} of ${missing.length} missing originals stored. ${failures.join(" ")}`
      );
    }

    await api(`/api/admin/shoots/${shoot.id}/complete`, { method: "POST", body: {} });
    let verified;
    try {
      verified = await api(`/api/admin/shoots/${shoot.id}/verify`, { method: "POST", body: {} });
    } catch (error) {
      shootView.recoverFiles = [];
      shootView.recoverRejected = [];
      shootView.busy = false;
      await loadAll();
      await loadShootView(shoot.id);
      setStatus(error.message, true);
      return;
    }
    shootView.recoverFiles = [];
    shootView.recoverRejected = [];
    shootView.busy = false;
    try {
      await generateMissingStandards(shoot.id);
    } catch (error) {
      await loadAll();
      await loadShootView(shoot.id);
      setStatus(error.message, true);
      return;
    }
    await loadAll();
    await loadShootView(shoot.id);
    setStatus(verified.message || originalsCountLabel(shootView.images.length));
  } catch (error) {
    shootView.busy = false;
    shootView.actionError = error.message;
    try {
      await loadAll();
    } catch {
      /* keep the selected files visible */
    }
    render();
    setStatus(error.message, true);
  }
};

const verifyShootArchive = async () => {
  const shoot = shootView.shoot;
  if (!shoot || shootView.busy) return;
  shootView.busy = true;
  shootView.actionError = "";
  try {
    setStatus("Verifying original archive…");
    const verified = await api(`/api/admin/shoots/${shoot.id}/verify`, {
      method: "POST",
      body: {},
    });
    try {
      await generateMissingStandards(shoot.id);
    } catch (error) {
      shootView.busy = false;
      await loadAll();
      await loadShootView(shoot.id);
      setStatus(error.message, true);
      return;
    }
    shootView.busy = false;
    await loadAll();
    await loadShootView(shoot.id);
    setStatus(verified.message || originalsCountLabel(shootView.images.length));
  } catch (error) {
    shootView.busy = false;
    shootView.actionError = error.message;
    try {
      await loadShootView(shoot.id);
    } catch {
      render();
    }
    setStatus(error.message, true);
  }
};

const generateShootStandardsFromView = async () => {
  const shoot = shootView.shoot;
  if (!shoot || shootView.busy) return;
  shootView.busy = true;
  shootView.actionError = "";
  try {
    setStatus("Generating Standard images…");
    const result = await generateMissingStandards(shoot.id, true);
    shootView.busy = false;
    await loadAll();
    await loadShootView(shoot.id);
    setStatus(standardImagesLabel(result) || standardImagesLabel(shootView.shoot));
  } catch (error) {
    shootView.busy = false;
    shootView.actionError = error.message;
    try {
      await loadShootView(shoot.id);
    } catch {
      render();
    }
    setStatus(error.message, true);
  }
};

const REPORT_FILENAME_FALLBACK = "OVERSITE_project_progress_report.pdf";
const REPORT_BLOB_REVOKE_MS = 120000;

const reportFilenameFromDisposition = (header, fallback = REPORT_FILENAME_FALLBACK) => {
  const value = String(header || "");
  const utf = /filename\*=UTF-8''([^;]+)/i.exec(value);
  if (utf) {
    try {
      return decodeURIComponent(utf[1].trim());
    } catch {
      /* use quoted filename */
    }
  }
  const quoted = /filename="([^"]+)"/i.exec(value);
  if (quoted) return quoted[1];
  const plain = /filename=([^;]+)/i.exec(value);
  if (plain) return plain[1].trim().replace(/^["']|["']$/g, "");
  return fallback;
};

const revokeObjectUrlLater = (url) => {
  window.setTimeout(() => URL.revokeObjectURL(url), REPORT_BLOB_REVOKE_MS);
};

const closeReportTab = (tab) => {
  if (!tab || tab.closed) return;
  try {
    tab.close();
  } catch {
    /* ignore */
  }
};

const writeReportWaitingPage = (tab) => {
  if (!tab || tab.closed) return false;
  try {
    tab.document.open();
    tab.document.write(`<!DOCTYPE html>
<html lang="en-AU">
<head>
  <meta charset="utf-8">
  <title>Generating Project Progress Report</title>
  <style>
    html, body { height: 100%; }
    body {
      margin: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #fff;
      color: #1f3356;
      font-family: Inter, "Helvetica Neue", Arial, sans-serif;
      text-align: center;
    }
    main { padding: 3.5rem 1.5rem; max-width: 28rem; }
    .mark {
      display: block;
      width: min(320px, 72vw);
      height: auto;
      margin: 0 auto 2.1rem;
    }
    p { margin: 0 0 0.55rem; font-size: 1.05rem; line-height: 1.45; font-weight: 600; }
    .note { color: #5d6570; font-size: 0.92rem; font-weight: 400; }
  </style>
</head>
<body>
  <main>
    <img class="mark" src="${location.origin}/assets/oversite-logo.png" alt="OVERSITE by AirThere" />
    <p>Generating Project Progress Report&hellip;</p>
    <p class="note">This may take a few seconds.</p>
  </main>
</body>
</html>`);
    tab.document.close();
    return true;
  } catch {
    return false;
  }
};

const openReportTab = () => {
  const tab = window.open("about:blank", "_blank");
  if (!tab || tab.closed) return null;
  writeReportWaitingPage(tab);
  try {
    tab.focus();
  } catch {
    /* ignore */
  }
  return tab;
};

const downloadReportBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  revokeObjectUrlLater(url);
};

const generateShootReportFromView = async (reportTab) => {
  const shoot = shootView.shoot;
  if (!shoot || shootView.busy) {
    closeReportTab(reportTab);
    return;
  }
  const tabOpened = Boolean(reportTab && !reportTab.closed);
  shootView.busy = true;
  shootView.actionError = "";
  try {
    setStatus("Generating report…");
    const response = await fetch(`/api/admin/shoots/${shoot.id}/report`, {
      credentials: "same-origin",
      headers: { Accept: "application/pdf, application/json" },
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "Report failed.");
    }
    const blob = await response.blob();
    const filename = reportFilenameFromDisposition(
      response.headers.get("Content-Disposition"),
      REPORT_FILENAME_FALLBACK
    );
    if (tabOpened && reportTab && !reportTab.closed) {
      const url = URL.createObjectURL(blob);
      reportTab.location = url;
      revokeObjectUrlLater(url);
      shootView.busy = false;
      render();
      setStatus("Report opened.");
      return;
    }
    try {
      downloadReportBlob(blob, filename);
    } catch {
      throw new Error(
        "Your browser blocked the report. Please allow pop-ups/downloads and try again."
      );
    }
    shootView.busy = false;
    render();
    setStatus("Report downloaded.");
  } catch (error) {
    closeReportTab(reportTab);
    shootView.busy = false;
    shootView.actionError = error.message;
    render();
    setStatus(error.message, true);
  }
};

const logoutFromAdmin = () => {
  const host = location.hostname;
  if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") {
    location.href = "/";
    return;
  }
  const returnTo = `${location.origin}/`;
  location.href = `/cdn-cgi/access/logout?returnTo=${encodeURIComponent(returnTo)}`;
};

const route = () => {
  const hash = location.hash.replace(/^#/, "") || "customers";
  const parts = hash.split("/").filter(Boolean);
  return {
    view: parts[0] || "customers",
    customerId: parts[0] === "customers" ? parts[1] || "" : "",
    shootId: parts[0] === "shoots" && parts[1] === "view" ? parts[2] || "" : "",
  };
};

const customerOptions = (selected) =>
  state.customers
    .map(
      (customer) =>
        `<option value="${escapeHtml(customer.id)}" ${
          customer.id === selected ? "selected" : ""
        }>${escapeHtml(customer.name)}</option>`
    )
    .join("");

const shootHistoryMeta = (shoot) => {
  const count = liveShootCount(shoot);
  const expected = Number(shoot.expected_count || count || 0);
  const stored = Number(shoot.stored_count ?? count);
  const verified = Number(shoot.verified_count || 0);
  const originalWord = count === 1 ? "original" : "originals";
  if (shoot.status === "draft" && count === 0) return "No images";
  if (shoot.status === "uploading") {
    if (expected > 0) return `${stored} of ${expected} originals uploaded · Incomplete`;
    return stored ? `Incomplete · ${stored}` : "Uploading";
  }
  if (shoot.status === "verified") return `${count} ${originalWord} · Verified`;
  if (shoot.status === "published") return `${count} ${originalWord} · Published`;
  if (shoot.status === "uploaded") {
    if (verified > 0 && verified < expected) {
      return `Archive incomplete · ${verified} of ${expected} verified`;
    }
    return `${count} ${originalWord} · Verification pending`;
  }
  return `${count} ${originalWord}`;
};

const shootHistoryAction = (shoot) => {
  if (shoot.status === "uploading") return "Continue Upload";
  return "View";
};

const renderCustomers = () => {
  titleEl.textContent = "Clients";
  leadEl.textContent = "Select a client, or create a new one.";
  const selected = state.customers.find((item) => item.id === state.selectedCustomerId);
  const canManage = isSuperAdmin();
  app.innerHTML = `
    <div class="admin-layout">
      <section class="admin-panel">
        <h2>All clients</h2>
        ${
          state.customers.length
            ? `<ul class="admin-list">${state.customers
                .map(
                  (customer) => `
              <li>
                <button type="button" class="${
                  customer.id === selected?.id ? "is-selected" : ""
                }" data-open-customer="${escapeHtml(customer.id)}">
                  <strong>${escapeHtml(customer.name)} ${
                    customer.status === "disabled" ? `<span class="badge">Disabled</span>` : ""
                  }</strong>
                  <span>/${escapeHtml(customer.slug)} · ${
                    customer.password_set ? "password set" : "password pending"
                  }</span>
                </button>
              </li>`
                )
                .join("")}</ul>`
            : `<p class="empty">No clients yet.</p>`
        }
      </section>
      <section class="admin-panel admin-panel-surface">
        <h2>${selected ? (canManage ? "Edit client" : "Client") : "New client"}</h2>
        ${
          canManage
            ? `<form class="admin-form" id="customer-form">
          <input type="hidden" name="id" value="${escapeHtml(selected?.id || "")}" />
          <label>
            <span>Client name</span>
            <input type="text" name="name" required maxlength="160" value="${escapeHtml(
              selected?.name || ""
            )}" />
          </label>
          <label>
            <span>Client slug</span>
            <input type="text" name="slug" required maxlength="48" autocomplete="username" value="${escapeHtml(
              selected?.slug || ""
            )}" />
          </label>
          <p class="hint">Used in the portal URL, for example airthere.com.au/ovpg.</p>
          <label>
            <span>${
              selected?.password_set ? "Replace password" : "Set portal password"
            }</span>
            <input type="password" id="customer-password" name="password" autocomplete="new-password" minlength="8"${
              selected && !selected.password_set ? " required" : ""
            } />
          </label>
          <p class="hint">${
            selected?.password_set
              ? "Leave blank to keep the current password."
              : selected
                ? "A portal password of at least 8 characters is required before this portal can become available."
                : "Leave blank to create the client with a pending password. The portal cannot sign in until a password is set."
          }</p>
          <label>
            <span>Status</span>
            <select name="status">
              <option value="active" ${selected?.status !== "disabled" ? "selected" : ""}>Active</option>
              <option value="disabled" ${selected?.status === "disabled" ? "selected" : ""}>Disabled</option>
            </select>
          </label>
          <button class="button" type="submit">${selected ? "Save client" : "Create client"}</button>
        </form>`
            : `<p class="empty">Client records are view-only for this operator role.</p>`
        }
      </section>
    </div>
  `;
};

const renderProjects = () => {
  titleEl.textContent = "Projects";
  leadEl.textContent = "Choose a client, then create or update a project.";
  const selectedCustomerId = state.selectedCustomerId || state.customers[0]?.id || "";
  const visible = state.projects.filter(
    (project) => !selectedCustomerId || project.customer_id === selectedCustomerId
  );
  const selected =
    visible.find((project) => project.id === state.selectedProjectId) || null;
  const canManage = isSuperAdmin();
  app.innerHTML = `
    <div class="admin-layout">
      <section class="admin-panel">
        <h2>Projects</h2>
        <label>
          <span>Client</span>
          <select id="project-customer-filter">${customerOptions(selectedCustomerId)}</select>
        </label>
        ${
          visible.length
            ? `<ul class="admin-list">${visible
                .map(
                  (project) => `
              <li>
                <button type="button" class="${
                  project.id === selected?.id ? "is-selected" : ""
                }" data-open-project="${escapeHtml(project.id)}">
                  <strong>${escapeHtml(project.name)} ${
                    project.code_locked ? `<span class="badge">Code locked</span>` : ""
                  }</strong>
                  <span><code class="code-chip">${escapeHtml(project.code)}</code>${
                    project.location
                      ? ` · ${escapeHtml(project.location)}`
                      : " · location pending"
                  }</span>
                </button>
              </li>`
                )
                .join("")}</ul>`
            : `<p class="empty">No projects for this client.</p>`
        }
      </section>
      <section class="admin-panel admin-panel-surface">
        <h2>${selected ? (canManage ? "Edit project" : "Project") : "New project"}</h2>
        ${
          canManage
            ? `<form class="admin-form" id="project-form">
          <input type="hidden" name="id" value="${escapeHtml(selected?.id || "")}" />
          <label>
            <span>Client</span>
            <select name="customer_id" required ${selected ? "disabled" : ""}>${customerOptions(
              selected?.customer_id || selectedCustomerId
            )}</select>
          </label>
          <label>
            <span>Project name</span>
            <input type="text" name="name" required maxlength="160" placeholder="Mount Whitsunday Stage 1" value="${escapeHtml(
              selected?.name || ""
            )}" />
          </label>
          <label>
            <span>Filename code</span>
            <input type="text" name="code" required maxlength="80" placeholder="mount_whitsunday_stage_1" value="${escapeHtml(
              selected?.code || ""
            )}" ${selected?.code_locked ? "disabled" : ""} />
          </label>
          ${
            selected?.code_locked
              ? `<p class="hint">This code is locked because images already exist for the project.</p>`
              : selected
                ? `<p class="hint">Keep this code stable. It locks once images exist.</p>`
                : `<p class="hint">Suggested from the project name. Confirm it before creating the project.</p>`
          }
          <label>
            <span>Project location</span>
            <input type="text" name="location" maxlength="200" placeholder="Mount Whitsunday, Airlie Beach QLD" value="${escapeHtml(
              selected?.location || ""
            )}" />
          </label>
          <p class="hint">Site location shown on progress reports.</p>
          <div class="field-row">
            <label>
              <span>Latitude</span>
              <input type="text" name="latitude" inputmode="decimal" placeholder="-20.267000" value="${escapeHtml(
                selected?.latitude == null ? "" : String(selected.latitude)
              )}" />
            </label>
            <label>
              <span>Longitude</span>
              <input type="text" name="longitude" inputmode="decimal" placeholder="148.716700" value="${escapeHtml(
                selected?.longitude == null ? "" : String(selected.longitude)
              )}" />
            </label>
          </div>
          <p class="hint">Central site coordinates. Enter both, or leave both blank.</p>
          ${
            selected
              ? `<label>
            <span>Status</span>
            <select name="status">
              <option value="active" ${selected.status !== "disabled" ? "selected" : ""}>Active</option>
              <option value="disabled" ${selected.status === "disabled" ? "selected" : ""}>Disabled</option>
            </select>
          </label>`
              : ""
          }
          <div class="shoot-delete-actions">
            <button class="button" type="submit">${selected ? "Save project" : "Create project"}</button>
            ${
              selected
                ? `<button class="text-clear" type="button" id="project-new">New project</button>`
                : ""
            }
          </div>
        </form>`
            : selected
              ? `<dl class="meta-grid shoot-meta">
                  <div><dt>Name</dt><dd>${escapeHtml(selected.name)}</dd></div>
                  <div><dt>Code</dt><dd>${escapeHtml(selected.code)}</dd></div>
                  <div><dt>Location</dt><dd>${escapeHtml(selected.location || "—")}</dd></div>
                  <div><dt>GPS</dt><dd>${escapeHtml(selected.gps_display || "—")}</dd></div>
                </dl>`
              : `<p class="empty">Project creation is Super Admin only.</p>`
        }
      </section>
    </div>
  `;
};

const renderShoots = () => {
  titleEl.textContent = "Captures";
  leadEl.textContent = "Client, project, Capture Date, then JPEGs.";
  const selectedCustomerId = state.selectedCustomerId || state.customers[0]?.id || "";
  const customer = state.customers.find((item) => item.id === selectedCustomerId);
  const projects = state.projects.filter((project) => project.customer_id === selectedCustomerId);
  const selectedProjectId = projects.some((project) => project.id === state.selectedProjectId)
    ? state.selectedProjectId
    : projects[0]?.id || "";
  const project = projects.find((item) => item.id === selectedProjectId);
  const visible = state.shoots.filter((shoot) => shoot.project_id === selectedProjectId);
  const shootDate = ingest.shootDate;
  const existingShoot =
    shootDate &&
    selectedProjectId &&
    state.shoots.find((shoot) => shoot.project_id === selectedProjectId && shoot.shoot_date === shootDate);
  const blockingShoot = existingShoot && COMPLETE_SHOOT_STATUSES.has(existingShoot.status);
  const incompleteShoot = existingShoot && !blockingShoot;
  const jpegCount = ingest.files.length;
  const ready = Boolean(customer && project && shootDate && jpegCount && !blockingShoot && !ingest.busy);
  const previewCount = Math.min(3, jpegCount);
  const previewNames =
    project && shootDate
      ? Array.from({ length: previewCount }, (_, index) =>
          generatedFilename(project.code, shootDate, index + 1)
        )
      : [];

  app.innerHTML = `
    <div class="admin-layout">
      <section class="admin-panel">
        <h2>Capture History</h2>
        <div class="field-row history-filters">
          <label>
            <span>Client</span>
            <select id="shoot-customer-filter">${customerOptions(selectedCustomerId)}</select>
          </label>
          <label>
            <span>Project</span>
            <select id="shoot-project-filter">
              ${projects
                .map(
                  (item) =>
                    `<option value="${escapeHtml(item.id)}" ${
                      item.id === selectedProjectId ? "selected" : ""
                    }>${escapeHtml(item.name)}</option>`
                )
                .join("")}
            </select>
          </label>
        </div>
        ${
          visible.length
            ? `<ul class="admin-list">${visible
                .map(
                  (shoot) => `
              <li>
                <button type="button" class="shoot-row" data-view-shoot="${escapeHtml(shoot.id)}">
                  <strong class="shoot-row-date">${escapeHtml(shoot.shoot_date_display)}</strong>
                  <span class="shoot-row-count">${escapeHtml(shootHistoryMeta(shoot))}</span>
                  <span class="shoot-row-action">${escapeHtml(shootHistoryAction(shoot))}</span>
                </button>
              </li>`
                )
                .join("")}</ul>`
            : `<p class="empty">No captures for this project yet.</p>`
        }
      </section>
      <section class="admin-panel admin-panel-surface">
        <h2>New Capture</h2>
        <form class="admin-form ingest-form" id="ingest-form">
          <div class="field-row">
            <label>
              <span>Client</span>
              <select id="ingest-customer" required>${customerOptions(selectedCustomerId)}</select>
            </label>
            <label>
              <span>Project</span>
              <select id="ingest-project" required>
                ${projects
                  .map(
                    (item) =>
                      `<option value="${escapeHtml(item.id)}" ${
                        item.id === selectedProjectId ? "selected" : ""
                      }>${escapeHtml(item.name)}</option>`
                  )
                  .join("")}
              </select>
            </label>
          </div>
          <div class="ingest-date-wrap">
            <label>
              <span>Capture Date</span>
              <div class="ingest-date-control">
                <input
                  type="text"
                  id="ingest-date"
                  inputmode="numeric"
                  autocomplete="off"
                  spellcheck="false"
                  maxlength="10"
                  placeholder="YYYY-MM-DD"
                  required
                  value="${escapeHtml(ingest.dateDraft || shootDate)}"
                />
                <button type="button" class="cal-open button-secondary" data-open-calendar aria-label="Open calendar">
                  Calendar
                </button>
              </div>
            </label>
            ${ingest.calendarOpen ? renderCalendar(shootDate) : ""}
          </div>
          ${
            ingest.dateError
              ? `<p class="form-error" role="alert">${escapeHtml(ingest.dateError)}</p>`
              : `<p class="hint">${
                  shootDate
                    ? `Capture Date: ${escapeHtml(displayShootDate(shootDate))}`
                    : "Use the calendar or type YYYY-MM-DD. Historical dates are normal."
                }</p>`
          }
          ${
            blockingShoot
              ? `<p class="form-error" role="status">A Capture already exists for this project on this date.</p>`
              : incompleteShoot
                ? `<p class="form-error" role="status">This capture is incomplete. <a class="text-link" href="#shoots/view/${escapeHtml(
                    existingShoot.id
                  )}">Continue Upload</a> from the existing Capture.</p>`
                : ""
          }
          ${
            jpegCount
              ? `<div class="ingest-summary">
            <p><strong>${jpegCount} JPEG image${jpegCount === 1 ? "" : "s"}</strong> · ${escapeHtml(
                displayShootDate(shootDate) || "set Capture Date"
              )}</p>
            <p class="ingest-filenames">${previewNames.map((name) => escapeHtml(name)).join("<br />")}${
                jpegCount > previewCount
                  ? `<br /><span>and ${jpegCount - previewCount} more</span>`
                  : ""
              }</p>
            <button class="text-clear" type="button" id="ingest-clear">Clear images</button>
          </div>`
              : ""
          }
          <div class="ingest-drop${jpegCount ? " is-compact" : ""}" id="ingest-drop" tabindex="0">
            <input class="ingest-file-input" id="ingest-files" type="file" accept=".jpg,.jpeg,image/jpeg" multiple />
            <p class="ingest-drop-title">${jpegCount ? "Add more JPEG images" : "Drop JPEG images here"}</p>
            <p class="ingest-drop-copy">or tap to choose files</p>
          </div>
          ${
            ingest.rejected.length
              ? `<ul class="ingest-rejected">${ingest.rejected
                  .map(
                    (item) =>
                      `<li>Not added: ${escapeHtml(item.name)} (${escapeHtml(item.reason)})</li>`
                  )
                  .join("")}</ul>`
              : ""
          }
          <button class="button" type="button" id="ingest-upload" ${ready ? "" : "disabled"}>Upload Capture</button>
          <p class="hint">Originals stay private. Verification confirms every expected image is stored.</p>
        </form>
      </section>
    </div>
  `;
};

const loadShootView = async (shootId) => {
  try {
    const data = await api(`/api/admin/shoots/${shootId}`);
    if (shootView.requestedId !== shootId) return;
    shootView.shoot = data.shoot || null;
    shootView.images = data.images || [];
    shootView.error = "";
  } catch (error) {
    if (shootView.requestedId !== shootId) return;
    shootView.error = error.message;
    shootView.shoot = null;
    shootView.images = [];
  } finally {
    if (shootView.requestedId === shootId) {
      shootView.loading = false;
      render();
      if (shootView.shoot && !shootView.actionError) {
        const shoot = shootView.shoot;
        if (shoot.status === "verified") {
          setStatus(
            `${Number(shoot.verified_count || shootView.images.length)} of ${
              Number(shoot.expected_count || shootView.images.length)
            } originals verified`
          );
        } else {
          const missing = missingShootImages().length;
          const stored = shootView.images.length - missing;
          if (missing) {
            setStatus(`${stored} of ${shootView.images.length} originals uploaded · Incomplete`);
          } else {
            setStatus(originalsCountLabel(shootView.images.length));
          }
        }
      }
    }
  }
};

const renderShootView = (shootId) => {
  if (shootView.requestedId !== shootId) {
    shootView.requestedId = shootId;
    shootView.loading = true;
    shootView.error = "";
    shootView.shoot = null;
    shootView.images = [];
    shootView.addFiles = [];
    shootView.addRejected = [];
    shootView.recoverFiles = [];
    shootView.recoverRejected = [];
    shootView.busy = false;
    shootView.actionError = "";
    shootView.deleteOpen = false;
    shootView.deleteConfirmText = "";
    loadShootView(shootId);
  }

  const shoot = shootView.shoot;
  titleEl.textContent = shoot ? `Capture · ${shoot.shoot_date_display}` : "Capture";
  leadEl.textContent = "Original images from this capture.";

  if (shootView.loading) {
    app.innerHTML = `<section class="admin-panel"><p class="empty">Loading capture…</p></section>`;
    return;
  }
  if (shootView.error || !shoot) {
    app.innerHTML = `
      <section class="admin-panel">
        <p class="form-error">${escapeHtml(shootView.error || "Capture not found.")}</p>
        <p><a class="text-link shoot-back" href="#shoots">Back to Captures</a></p>
      </section>`;
    return;
  }

  const count = shootView.images.length;
  const missing = missingShootImages();
  const storedImages = shootView.images.filter((image) => image.stored);
  const lightboxIndexById = new Map(storedImages.map((image, index) => [image.id, index]));
  const addCount = shootView.addFiles.length;
  const recoverCount = shootView.recoverFiles.length;
  const nextSeq =
    Math.max(
      Number(shoot.max_seq || 0),
      ...shootView.images.map((image) => Number(image.seq || 0)),
      0
    ) + 1;
  const previewCount = Math.min(3, addCount);
  const previewNames = Array.from({ length: previewCount }, (_, index) =>
    generatedFilename(shoot.project_code, shoot.shoot_date, nextSeq + index)
  );
  const addReady = Boolean(addCount && !shootView.busy);
  const recoverReady = Boolean(recoverCount && missing.length && !shootView.busy);
  const canRemove = isSuperAdmin();
  const showRecover = missing.length > 0;
  const showVerify =
    !showRecover && count > 0 && shoot.status !== "verified" && shoot.status !== "published";
  const showAdd = !showRecover && shoot.status !== "published";
  const verifiedCount = Number(shoot.verified_count || 0);
  const archiveBanner =
    shoot.status === "verified"
      ? `<div class="archive-banner archive-banner-ok">
          <p class="archive-kicker">Original archive verified ✓</p>
          <p class="archive-count">${verifiedCount} of ${Number(
            shoot.expected_count || count
          )} originals verified</p>
          ${
            shoot.verified_at_display
              ? `<p class="archive-date">${escapeHtml(shoot.verified_at_display)}</p>`
              : ""
          }
        </div>`
      : showRecover
        ? `<div class="archive-banner archive-banner-warn">
          <p class="archive-kicker">Archive incomplete</p>
          <p class="archive-count">${count - missing.length} of ${count} originals uploaded</p>
        </div>`
        : shoot.status === "uploaded" && verifiedCount > 0 && verifiedCount < count
          ? `<div class="archive-banner archive-banner-warn">
          <p class="archive-kicker">Archive incomplete</p>
          <p class="archive-count">${verifiedCount} of ${count} originals verified</p>
        </div>`
          : "";
  const showGenerateStandards =
    Number(shoot.standard_expected || 0) > 0 &&
    Number(shoot.standard_ready || 0) < Number(shoot.standard_expected || 0);
  const showReport = (shoot.status === "verified" || shoot.status === "published") && count > 0;
  const reportReady =
    showReport &&
    Number(shoot.standard_expected || 0) === count &&
    Number(shoot.standard_ready || 0) === count &&
    Number(shoot.standard_failed || 0) === 0;
  const standardsLine = standardImagesLabel(shoot);
  const standardsBanner = standardsLine
    ? `<div class="archive-standards">
        <p class="archive-count">${escapeHtml(standardsLine)}</p>
        ${
          showGenerateStandards
            ? `<button class="button-secondary" type="button" id="shoot-generate-standards" ${
                shootView.busy ? "disabled" : ""
              }>Generate Standard Images</button>`
            : ""
        }
        ${
          showReport
            ? `<button class="button" type="button" id="shoot-generate-report" ${
                shootView.busy || !reportReady ? "disabled" : ""
              }>Generate Report</button>`
            : ""
        }
      </div>
      ${
        showReport && !reportReady
          ? `<p class="hint">Generate Standard Images for every photograph before creating the PDF report.</p>`
          : ""
      }`
    : showReport
      ? `<div class="archive-standards">
          <button class="button-secondary" type="button" id="shoot-generate-report" disabled>Generate Report</button>
        </div>
        <p class="hint">Generate Standard Images for every photograph before creating the PDF report.</p>`
      : "";

  app.innerHTML = `
    <section class="admin-panel shoot-view">
      <p><a class="text-link shoot-back" href="#shoots">Back to Captures</a></p>
      <dl class="meta-grid shoot-meta">
        <div><dt>Client</dt><dd>${escapeHtml(shoot.customer_name)}</dd></div>
        <div><dt>Project</dt><dd>${escapeHtml(shoot.project_name)}</dd></div>
        <div><dt>Capture Date</dt><dd>${escapeHtml(shoot.shoot_date_display)} <span class="shoot-iso">${escapeHtml(
          shoot.shoot_date
        )}</span></dd></div>
        <div><dt>Images</dt><dd>${count} original${count === 1 ? "" : "s"}</dd></div>
        ${
          shoot.project_location
            ? `<div><dt>Location</dt><dd>${escapeHtml(shoot.project_location)}</dd></div>`
            : ""
        }
        ${
          shoot.project_gps_display
            ? `<div><dt>GPS</dt><dd>${escapeHtml(shoot.project_gps_display)}</dd></div>`
            : ""
        }
      </dl>
      ${archiveBanner}
      ${standardsBanner}
      ${
        count
          ? `<div class="shoot-view-grid">${shootView.images
              .map(
                (image) => `
            <figure class="shoot-view-card${image.stored ? "" : " is-missing"}">
              ${
                image.stored
                  ? `<button
                type="button"
                class="shoot-view-open"
                data-lightbox-index="${lightboxIndexById.get(image.id)}"
                aria-label="View ${escapeHtml(image.generated_filename)}"
              >
                <img
                  src="/api/admin/shoots/${escapeHtml(shoot.id)}/originals/${escapeHtml(image.id)}"
                  alt="${escapeHtml(image.generated_filename)}"
                  loading="lazy"
                  decoding="async"
                />
              </button>`
                  : `<div class="shoot-missing-thumb">Missing</div>`
              }
              <figcaption>
                <span class="shoot-seq">${String(image.seq).padStart(3, "0")}</span>
                <span class="shoot-filename">${escapeHtml(image.generated_filename)}</span>
                ${
                  canRemove
                    ? `<button type="button" class="shoot-remove" data-remove-image="${escapeHtml(
                        image.id
                      )}" ${shootView.busy ? "disabled" : ""}>Remove</button>`
                    : ""
                }
              </figcaption>
            </figure>`
              )
              .join("")}</div>`
          : `<p class="empty">No originals stored for this capture yet.</p>`
      }
      ${
        showRecover
          ? `<div class="shoot-recover">
        <p class="shoot-add-label">Continue Upload</p>
        <p class="hint">Supply the missing source files. They keep their already-assigned archive names.</p>
        <ul class="recover-missing">${missing
          .map(
            (image) =>
              `<li><span class="shoot-seq">${String(image.seq).padStart(3, "0")}</span> ${escapeHtml(
                image.generated_filename
              )} <span class="recover-source">${escapeHtml(image.original_filename || "")}</span></li>`
          )
          .join("")}</ul>
        ${
          recoverCount
            ? `<div class="ingest-summary">
          <p><strong>${recoverCount} JPEG image${recoverCount === 1 ? "" : "s"}</strong> selected for recovery</p>
          <button class="text-clear" type="button" id="shoot-recover-clear" ${
            shootView.busy ? "disabled" : ""
          }>Clear selection</button>
        </div>`
            : ""
        }
        <div class="ingest-drop${recoverCount ? " is-compact" : ""}" id="shoot-recover-drop" tabindex="0">
          <input class="ingest-file-input" id="shoot-recover-files" type="file" accept=".jpg,.jpeg,image/jpeg" multiple ${
            shootView.busy ? "disabled" : ""
          } />
          <p class="ingest-drop-title">${recoverCount ? "Add missing JPEG images" : "Drop missing JPEG images here"}</p>
          <p class="ingest-drop-copy">Match the original filenames listed above</p>
        </div>
        ${
          shootView.recoverRejected.length
            ? `<ul class="ingest-rejected">${shootView.recoverRejected
                .map(
                  (item) =>
                    `<li>Not added: ${escapeHtml(item.name)} (${escapeHtml(item.reason)})</li>`
                )
                .join("")}</ul>`
            : ""
        }
        <button class="button" type="button" id="shoot-recover-upload" ${
          recoverReady ? "" : "disabled"
        }>Continue Upload</button>
      </div>`
          : ""
      }
      ${
        showVerify
          ? `<div class="shoot-verify">
        <button class="button" type="button" id="shoot-verify" ${shootView.busy ? "disabled" : ""}>Verify original archive</button>
      </div>`
          : ""
      }
      ${
        showAdd
          ? `<div class="shoot-add">
        <p class="shoot-add-label">Add JPEG images</p>
        ${
          addCount
            ? `<div class="ingest-summary">
          <p><strong>${addCount} JPEG image${addCount === 1 ? "" : "s"}</strong> selected</p>
          <p class="ingest-filenames">${previewNames.map((name) => escapeHtml(name)).join("<br />")}${
              addCount > previewCount
                ? `<br /><span>and ${addCount - previewCount} more</span>`
                : ""
            }</p>
          <button class="text-clear" type="button" id="shoot-add-clear" ${
            shootView.busy ? "disabled" : ""
          }>Clear selection</button>
        </div>`
            : ""
        }
        <div class="ingest-drop${addCount ? " is-compact" : ""}" id="shoot-add-drop" tabindex="0">
          <input class="ingest-file-input" id="shoot-add-files" type="file" accept=".jpg,.jpeg,image/jpeg" multiple ${
            shootView.busy ? "disabled" : ""
          } />
          <p class="ingest-drop-title">${addCount ? "Add more JPEG images" : "Drop JPEG images here"}</p>
          <p class="ingest-drop-copy">or tap to choose files</p>
        </div>
        ${
          shootView.addRejected.length
            ? `<ul class="ingest-rejected">${shootView.addRejected
                .map(
                  (item) =>
                    `<li>Not added: ${escapeHtml(item.name)} (${escapeHtml(item.reason)})</li>`
                )
                .join("")}</ul>`
            : ""
        }
        <button class="button" type="button" id="shoot-add-upload" ${addReady ? "" : "disabled"}>Add to Capture</button>
      </div>`
          : ""
      }
      ${
        canDeleteShoot()
          ? `<div class="shoot-danger">
        ${
          shootView.deleteOpen
            ? `<div class="shoot-delete-confirm">
          <p class="shoot-delete-kicker">Delete Capture</p>
          <p class="shoot-delete-warning">This permanently removes the Capture, all original images, and all Standard images. This cannot be undone.</p>
          <label class="shoot-delete-label">
            <span>Type DELETE to confirm</span>
            <input
              id="shoot-delete-confirm"
              type="text"
              autocomplete="off"
              autocapitalize="characters"
              spellcheck="false"
              value="${escapeHtml(shootView.deleteConfirmText)}"
              ${shootView.busy ? "disabled" : ""}
            />
          </label>
          ${
            shootView.actionError
              ? `<p class="form-error">${escapeHtml(shootView.actionError)}</p>`
              : ""
          }
          <div class="shoot-delete-actions">
            <button class="text-clear" type="button" id="shoot-delete-cancel" ${
              shootView.busy ? "disabled" : ""
            }>Cancel</button>
            <button class="button-secondary shoot-delete-submit" type="button" id="shoot-delete-submit" ${
              shootView.busy || String(shootView.deleteConfirmText || "").trim() !== "DELETE"
                ? "disabled"
                : ""
            }>Delete Capture</button>
          </div>
        </div>`
            : `<button class="shoot-delete-open" type="button" id="shoot-delete-open" ${
                shootView.busy ? "disabled" : ""
              }>Delete Capture</button>`
        }
      </div>`
          : ""
      }
    </section>
  `;
};

const loadAll = async () => {
  const [customers, projects, shoots] = await Promise.all([
    api("/api/admin/customers"),
    api("/api/admin/projects"),
    api("/api/admin/shoots"),
  ]);
  state.customers = customers.customers || [];
  state.projects = projects.projects || [];
  state.shoots = shoots.shoots || [];
  if (!state.selectedCustomerId && state.customers[0]) {
    state.selectedCustomerId = state.customers[0].id;
  }
};

let activeRouteKey = "";

const render = () => {
  const { view, customerId, shootId } = route();
  const routeKey = `${view}:${shootId || ""}`;
  if (activeRouteKey && routeKey !== activeRouteKey) {
    setStatus("");
  }
  activeRouteKey = routeKey;
  if (customerId) state.selectedCustomerId = customerId;
  document.body.classList.toggle("is-shoots", view === "shoots");
  if (!(view === "shoots" && shootId)) {
    window.AirThereLightbox?.close();
  }
  if (!(view === "shoots" && shootId) && shootView.requestedId) {
    resetShootView();
  }
  if (view === "projects") renderProjects();
  else if (view === "shoots" && shootId) renderShootView(shootId);
  else if (view === "shoots") renderShoots();
  else renderCustomers();

  document.querySelectorAll(".app-header nav a[href^='#']").forEach((link) => {
    const hash = (link.getAttribute("href") || "").replace("#", "");
    link.classList.toggle("is-current", view === hash);
  });
};

const bindAccount = () => {
  const account = document.querySelector("#account");
  const nameEl = document.querySelector("#account-name");
  const roleEl = document.querySelector("#account-role");
  if (!account || !state.user?.name) return;
  account.hidden = false;
  nameEl.textContent = state.user.name;
  roleEl.textContent = ROLE_LABELS[state.user.role] || state.user.role;
};

const boot = async () => {
  try {
    const me = await api("/api/admin/me");
    state.user = me.user || null;
    bindAccount();
    const yearEl = document.querySelector("#admin-year");
    if (yearEl) yearEl.textContent = String(new Date().getFullYear());
    await loadAll();
    render();
  } catch (error) {
    app.innerHTML = `<section class="admin-panel"><p class="empty">${escapeHtml(
      error.message
    )}</p></section>`;
  }
};

document.addEventListener("click", (event) => {
  const logout = event.target.closest("#admin-logout");
  if (logout) {
    event.preventDefault();
    logoutFromAdmin();
    return;
  }

  const customerButton = event.target.closest("[data-open-customer]");
  if (customerButton) {
    state.selectedCustomerId = customerButton.getAttribute("data-open-customer");
    location.hash = `customers/${state.selectedCustomerId}`;
    render();
    return;
  }

  const projectButton = event.target.closest("[data-open-project]");
  if (projectButton) {
    state.selectedProjectId = projectButton.getAttribute("data-open-project");
    render();
    return;
  }

  if (event.target.id === "project-new") {
    event.preventDefault();
    state.selectedProjectId = "";
    render();
    return;
  }

  const viewShoot = event.target.closest("[data-view-shoot]");
  if (viewShoot) {
    event.preventDefault();
    location.hash = `shoots/view/${viewShoot.getAttribute("data-view-shoot")}`;
    return;
  }

  if (event.target.closest("[data-open-calendar]")) {
    if (ingest.busy) return;
    ingest.calendarOpen = !ingest.calendarOpen;
    if (ingest.calendarOpen) {
      ingest.calendarYear = 0;
      ingest.calendarMonth = 0;
      ensureCalendarCursor();
    }
    render();
    return;
  }

  if (event.target.id === "ingest-date") {
    if (ingest.busy) return;
    const alreadyOpen = ingest.calendarOpen;
    ingest.calendarOpen = true;
    ingest.calendarYear = 0;
    ingest.calendarMonth = 0;
    ensureCalendarCursor();
    if (!alreadyOpen) {
      render();
      document.querySelector("#ingest-date")?.focus();
    }
    return;
  }

  const shift = event.target.closest("[data-cal-shift]");
  if (shift) {
    event.preventDefault();
    shiftCalendar(Number(shift.getAttribute("data-cal-shift")));
    ingest.calendarOpen = true;
    render();
    return;
  }

  const picked = event.target.closest("[data-pick-date]");
  if (picked) {
    event.preventDefault();
    const checked = parseIsoShootDate(picked.getAttribute("data-pick-date"));
    if (!checked.error) {
      ingest.shootDate = checked.value;
      ingest.dateDraft = checked.value;
      ingest.dateError = "";
    }
    ingest.calendarOpen = false;
    render();
    return;
  }

  if (ingest.calendarOpen && !event.target.closest(".ingest-date-wrap")) {
    ingest.calendarOpen = false;
    render();
  }

  if (event.target.id === "ingest-clear") {
    if (ingest.busy) return;
    ingest.files = [];
    ingest.rejected = [];
    render();
    return;
  }

  if (event.target.id === "shoot-add-clear") {
    if (shootView.busy) return;
    shootView.addFiles = [];
    shootView.addRejected = [];
    render();
    return;
  }

  if (event.target.id === "shoot-recover-clear") {
    if (shootView.busy) return;
    shootView.recoverFiles = [];
    shootView.recoverRejected = [];
    render();
    return;
  }

  const removeImage = event.target.closest("[data-remove-image]");
  if (removeImage) {
    event.preventDefault();
    removeShootImage(removeImage.getAttribute("data-remove-image"));
    return;
  }

  const lightboxOpen = event.target.closest("[data-lightbox-index]");
  if (lightboxOpen && shootView.shoot) {
    event.preventDefault();
    const index = Number(lightboxOpen.getAttribute("data-lightbox-index"));
    window.AirThereLightbox?.open(
      shootView.images
        .filter((image) => image.stored)
        .map((image) => ({
          src: `/api/admin/shoots/${shootView.shoot.id}/originals/${image.id}`,
          seq: image.seq,
          filename: image.generated_filename,
        })),
      index
    );
    return;
  }

  if (event.target.id === "ingest-upload") {
    event.preventDefault();
    uploadShoot();
    return;
  }

  if (event.target.id === "shoot-add-upload") {
    event.preventDefault();
    addToShoot();
    return;
  }

  if (event.target.id === "shoot-recover-upload") {
    event.preventDefault();
    continueShootUpload();
    return;
  }

  if (event.target.id === "shoot-verify") {
    event.preventDefault();
    verifyShootArchive();
    return;
  }

  if (event.target.id === "shoot-generate-standards") {
    event.preventDefault();
    generateShootStandardsFromView();
    return;
  }

  if (event.target.id === "shoot-generate-report") {
    event.preventDefault();
    if (!shootView.shoot || shootView.busy) return;
    const reportTab = openReportTab();
    generateShootReportFromView(reportTab);
    return;
  }

  if (event.target.id === "shoot-delete-open") {
    event.preventDefault();
    if (shootView.busy || !canDeleteShoot()) return;
    shootView.deleteOpen = true;
    shootView.deleteConfirmText = "";
    shootView.actionError = "";
    render();
    document.querySelector("#shoot-delete-confirm")?.focus();
    return;
  }

  if (event.target.id === "shoot-delete-cancel") {
    event.preventDefault();
    if (shootView.busy) return;
    shootView.deleteOpen = false;
    shootView.deleteConfirmText = "";
    shootView.actionError = "";
    render();
    return;
  }

  if (event.target.id === "shoot-delete-submit") {
    event.preventDefault();
    deleteShootFromView();
  }
});

document.addEventListener("change", (event) => {
  if (ingest.busy && event.target.closest("#ingest-form")) return;
  if (event.target.id === "project-customer-filter" || event.target.id === "shoot-customer-filter") {
    state.selectedCustomerId = event.target.value;
    state.selectedProjectId = "";
    render();
    return;
  }
  if (event.target.id === "shoot-project-filter") {
    state.selectedProjectId = event.target.value;
    render();
    return;
  }
  if (event.target.id === "ingest-customer") {
    state.selectedCustomerId = event.target.value;
    state.selectedProjectId = "";
    render();
    return;
  }
  if (event.target.id === "ingest-project") {
    state.selectedProjectId = event.target.value;
    render();
    return;
  }
  if (event.target.id === "ingest-date") {
    const checked = parseIsoShootDate(event.target.value);
    if (checked.error) {
      ingest.shootDate = "";
      ingest.dateDraft = String(event.target.value || "").trim();
      ingest.dateError = checked.error;
      render();
      return;
    }
    ingest.shootDate = checked.value;
    ingest.dateDraft = checked.value;
    ingest.dateError = "";
    ingest.calendarYear = 0;
    ingest.calendarMonth = 0;
    render();
    return;
  }
  if (event.target.id === "ingest-files") {
    if (ingest.busy) return;
    addJpegFiles(event.target.files);
    event.target.value = "";
    render();
    return;
  }
  if (event.target.id === "shoot-add-files") {
    if (shootView.busy) return;
    addShootViewFiles(event.target.files);
    event.target.value = "";
    render();
    return;
  }
  if (event.target.id === "shoot-recover-files") {
    if (shootView.busy) return;
    addRecoverFiles(event.target.files);
    event.target.value = "";
    render();
    return;
  }
  if (event.target.matches("#project-form [name=name]")) {
    const code = document.querySelector("#project-form [name=code]");
    if (code && !code.dataset.touched) code.value = suggestCode(event.target.value);
  }
});

document.addEventListener("input", (event) => {
  if (event.target.matches("#project-form [name=code]")) {
    event.target.dataset.touched = "true";
  }
  if (event.target.id === "shoot-delete-confirm") {
    shootView.deleteConfirmText = event.target.value;
    const submit = document.querySelector("#shoot-delete-submit");
    if (submit) {
      submit.disabled =
        shootView.busy || String(shootView.deleteConfirmText || "").trim() !== "DELETE";
    }
  }
});

const dropTarget = (event) =>
  event.target.closest("#ingest-drop") ||
  event.target.closest("#shoot-add-drop") ||
  event.target.closest("#shoot-recover-drop");

document.addEventListener("dragenter", (event) => {
  const drop = dropTarget(event);
  if (!drop) return;
  event.preventDefault();
  drop.classList.add("is-over");
});

document.addEventListener("dragover", (event) => {
  const drop = dropTarget(event);
  if (!drop) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  drop.classList.add("is-over");
});

document.addEventListener("dragleave", (event) => {
  const drop = dropTarget(event);
  if (!drop) return;
  if (drop.contains(event.relatedTarget)) return;
  drop.classList.remove("is-over");
});

document.addEventListener("drop", (event) => {
  const drop = dropTarget(event);
  if (!drop) return;
  const isAdd = drop.id === "shoot-add-drop";
  const isRecover = drop.id === "shoot-recover-drop";
  if ((isAdd || isRecover) && shootView.busy) return;
  if (!isAdd && !isRecover && ingest.busy) return;
  event.preventDefault();
  event.stopPropagation();
  drop.classList.remove("is-over");
  const files = collectDroppedFiles(event.dataTransfer);
  if (isRecover) addRecoverFiles(files);
  else if (isAdd) addShootViewFiles(files);
  else addJpegFiles(files);
  render();
});

document.addEventListener("submit", async (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  // Named controls shadow form.id (this form has <input name="id">).
  const formId = form.getAttribute("id");
  if (formId === "ingest-form") {
    event.preventDefault();
    return;
  }
  if (!["customer-form", "project-form"].includes(formId)) return;
  event.preventDefault();
  setStatus("Saving…");
  const data = Object.fromEntries(new FormData(form));
  try {
    if (formId === "customer-form") {
      const passwordInput = form.querySelector("#customer-password");
      const password =
        passwordInput instanceof HTMLInputElement ? String(passwordInput.value || "") : "";
      const payload = {
        name: data.name,
        slug: data.slug,
        status: data.status,
      };
      if (password) payload.password = password;
      if (data.id) {
        const existing = state.customers.find((item) => item.id === data.id);
        if (existing && !existing.password_set && !password) {
          throw new Error("Set a portal password before saving.");
        }
        if (password && password.length < 8) {
          throw new Error("Portal password must be at least 8 characters.");
        }
        const saved = await api(`/api/admin/customers/${data.id}`, {
          method: "PATCH",
          body: payload,
        });
        if (password && saved.customer?.password_set !== true) {
          throw new Error("Portal password was not saved. Try again.");
        }
        setStatus(
          password ? "Portal password set." : "Client saved."
        );
      } else {
        const created = await api("/api/admin/customers", { method: "POST", body: payload });
        state.selectedCustomerId = created.customer.id;
        if (password && created.customer?.password_set !== true) {
          throw new Error("Portal password was not saved. Try again.");
        }
        setStatus(
          created.customer.password_set
            ? "Client created."
            : "Client created. Portal password is still pending."
        );
      }
    }
    if (formId === "project-form") {
      const payload = {
        customer_id: data.customer_id,
        name: data.name,
        code: data.code,
        status: data.status || "active",
        location: data.location || "",
        latitude: data.latitude || "",
        longitude: data.longitude || "",
      };
      if (data.id) {
        await api(`/api/admin/projects/${data.id}`, { method: "PATCH", body: payload });
        setStatus("Project saved.");
      } else {
        const created = await api("/api/admin/projects", { method: "POST", body: payload });
        state.selectedProjectId = created.project.id;
        setStatus("Project created.");
      }
    }
    await loadAll();
    render();
    if (formId !== "customer-form" && formId !== "project-form") form.reset();
  } catch (error) {
    setStatus(error.message, true);
  }
});

window.addEventListener("hashchange", render);
document.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  if (event.target?.id !== "shoot-delete-confirm") return;
  event.preventDefault();
  deleteShootFromView();
});
boot();
