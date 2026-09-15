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
  busy: false,
  actionError: "",
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
    setStatus("Choose the customer, project, Shoot Date and JPEGs first.", true);
    return;
  }

  ingest.busy = true;
  const uploadButton = document.querySelector("#ingest-upload");
  if (uploadButton) uploadButton.disabled = true;

  const fileMap = new Map(ingest.files.map((file) => [file.name.toLowerCase(), file]));
  const failures = [];

  try {
    setStatus("Preparing shoot records…");
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
    ingest.files = [];
    ingest.rejected = [];
    ingest.shootDate = "";
    ingest.dateDraft = "";
    ingest.dateError = "";
    ingest.calendarOpen = false;
    await loadAll();
    ingest.busy = false;
    render();
    setStatus(completed.message || `${completed.image_count || total} originals in this shoot`);
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
    return { error: "Shoot Date must be a valid calendar date." };
  }
  if (year < 2000 || year > 2100) {
    return { error: "Shoot Date is outside the supported range." };
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
    <div class="ingest-calendar" role="dialog" aria-label="Shoot Date calendar">
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

const originalsCountLabel = (count) =>
  `${count} original${count === 1 ? "" : "s"} in this shoot`;

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
  shootView.busy = false;
  shootView.actionError = "";
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
    shootView.addFiles = [];
    shootView.addRejected = [];
    shootView.busy = false;
    await loadAll();
    await loadShootView(shoot.id);
    setStatus(completed.message || originalsCountLabel(shootView.images.length));
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

const removeShootImage = async (imageId) => {
  const shoot = shootView.shoot;
  if (!shoot || shootView.busy || !imageId) return;
  if (!window.confirm("Remove this image from the Shoot?")) return;

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

const shootStatusLabel = (shoot) => {
  const count = liveShootCount(shoot);
  if (shoot.status === "draft" && count === 0) return "Draft — no images";
  if (shoot.status === "uploading") {
    return count ? `Uploading — originals incomplete · ${count} JPEG${count === 1 ? "" : "s"}` : "Uploading";
  }
  if (shoot.status === "uploaded") {
    return originalsCountLabel(count);
  }
  if (shoot.status === "verified") return `Verified · ${count} images`;
  if (shoot.status === "published") return `Published · ${count} images`;
  return `${shoot.status}${count ? ` · ${count} images` : ""}`;
};

const renderCustomers = () => {
  titleEl.textContent = "Customers";
  leadEl.textContent =
    "Create and maintain customer records. Passwords are hashed and cannot be recovered — only replaced.";
  const selected = state.customers.find((item) => item.id === state.selectedCustomerId);
  const canManage = isSuperAdmin();
  app.innerHTML = `
    <div class="admin-layout">
      <section class="admin-panel">
        <h2>All customers</h2>
        ${
          state.customers.length
            ? `<ul class="admin-list">${state.customers
                .map(
                  (customer) => `
              <li>
                <button type="button" data-open-customer="${escapeHtml(customer.id)}">
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
            : `<p class="empty">No customers yet.</p>`
        }
      </section>
      <section class="admin-panel">
        <h2>${selected ? (canManage ? "Edit customer" : "Customer") : "New customer"}</h2>
        ${
          canManage
            ? `<form class="admin-form" id="customer-form">
          <input type="hidden" name="id" value="${escapeHtml(selected?.id || "")}" />
          <label>
            <span>Customer name</span>
            <input type="text" name="name" required maxlength="160" value="${escapeHtml(
              selected?.name || ""
            )}" />
          </label>
          <label>
            <span>Customer slug</span>
            <input type="text" name="slug" required maxlength="48" value="${escapeHtml(
              selected?.slug || ""
            )}" />
          </label>
          <p class="hint">Used in the portal URL, for example airthere.com.au/ovpg. Reserved website paths cannot be used.</p>
          <label>
            <span>${selected ? "Replace password" : "Customer password"}</span>
            <input type="password" name="password" autocomplete="new-password" minlength="8" />
          </label>
          <p class="hint">${
            selected?.password_set
              ? "Leave blank to keep the current password."
              : "Leave blank to create the customer with a pending password. The portal cannot sign in until a password is set."
          }</p>
          <label>
            <span>Status</span>
            <select name="status">
              <option value="active" ${selected?.status !== "disabled" ? "selected" : ""}>Active</option>
              <option value="disabled" ${selected?.status === "disabled" ? "selected" : ""}>Disabled</option>
            </select>
          </label>
          <button class="button" type="submit">${selected ? "Save customer" : "Create customer"}</button>
        </form>`
            : `<p class="empty">Customer records are view-only for this operator role.</p>`
        }
      </section>
    </div>
  `;
};

const renderProjects = () => {
  titleEl.textContent = "Projects";
  leadEl.textContent =
    "Projects belong to a customer. The filename-safe code is used in image names and archive paths, and should stay stable once images exist.";
  const selectedCustomerId = state.selectedCustomerId || state.customers[0]?.id || "";
  const visible = state.projects.filter(
    (project) => !selectedCustomerId || project.customer_id === selectedCustomerId
  );
  app.innerHTML = `
    <div class="admin-layout">
      <section class="admin-panel">
        <h2>Projects</h2>
        <label>
          <span>Customer</span>
          <select id="project-customer-filter">${customerOptions(selectedCustomerId)}</select>
        </label>
        ${
          visible.length
            ? `<ul class="admin-list">${visible
                .map(
                  (project) => `
              <li>
                <strong>${escapeHtml(project.name)}</strong>
                <span>${escapeHtml(project.code)}${
                  project.code_locked ? " · code locked" : ""
                }</span>
              </li>`
                )
                .join("")}</ul>`
            : `<p class="empty">No projects for this customer.</p>`
        }
      </section>
      <section class="admin-panel">
        <h2>New project</h2>
        ${
          isSuperAdmin()
            ? `<form class="admin-form" id="project-form">
          <label>
            <span>Customer</span>
            <select name="customer_id" required>${customerOptions(selectedCustomerId)}</select>
          </label>
          <label>
            <span>Project name</span>
            <input type="text" name="name" required maxlength="160" placeholder="Mount Whitsunday Stage 1" />
          </label>
          <label>
            <span>Filename-safe code</span>
            <input type="text" name="code" required maxlength="80" placeholder="mount_whitsunday_stage_1" />
          </label>
          <p class="hint">Suggested automatically from the project name. Confirm or edit it before creating the project.</p>
          <button class="button" type="submit">Create project</button>
        </form>`
            : `<p class="empty">Project creation is Super Admin only.</p>`
        }
      </section>
    </div>
  `;
};

const renderShoots = () => {
  titleEl.textContent = "Shoots";
  leadEl.textContent = "Customer, project, Shoot Date, then JPEGs. Shoot Date is the day the photography happened.";
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
        <h2>Shoot history</h2>
        <div class="field-row">
          <label>
            <span>Customer</span>
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
                <button type="button" data-view-shoot="${escapeHtml(shoot.id)}">
                  <strong>${escapeHtml(shoot.shoot_date_display)}</strong>
                  <span>${escapeHtml(shootStatusLabel(shoot))} · View Shoot</span>
                </button>
              </li>`
                )
                .join("")}</ul>`
            : `<p class="empty">No shoots for this project yet.</p>`
        }
      </section>
      <section class="admin-panel">
        <h2>New shoot</h2>
        <form class="admin-form ingest-form" id="ingest-form">
          <div class="field-row">
            <label>
              <span>Customer</span>
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
              <span>Shoot Date</span>
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
                <button type="button" class="cal-open" data-open-calendar aria-label="Open calendar">
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
                    ? `Shoot Date: ${escapeHtml(displayShootDate(shootDate))}`
                    : "Use the calendar or type YYYY-MM-DD. Historical dates are normal."
                }</p>`
          }
          ${
            blockingShoot
              ? `<p class="form-error" role="status">A Shoot already exists for this project on this date.</p>`
              : incompleteShoot
                ? `<p class="form-error" role="status">This shoot is incomplete. Re-select the same JPEGs to continue uploading originals.</p>`
                : ""
          }
          ${
            jpegCount
              ? `<div class="ingest-summary">
            <p><strong>${jpegCount} JPEG image${jpegCount === 1 ? "" : "s"}</strong> · ${escapeHtml(
                displayShootDate(shootDate) || "set Shoot Date"
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
            <p class="ingest-drop-copy">or click to choose multiple files</p>
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
          <button class="button" type="button" id="ingest-upload" ${ready ? "" : "disabled"}>Upload Shoot</button>
          <p class="hint">Original JPEGs stay private. Standard images and archive verification come later.</p>
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
        setStatus(originalsCountLabel(shootView.images.length));
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
    shootView.busy = false;
    shootView.actionError = "";
    loadShootView(shootId);
  }

  const shoot = shootView.shoot;
  titleEl.textContent = shoot ? `Shoot · ${shoot.shoot_date_display}` : "Shoot";
  leadEl.textContent = "Private originals for visual confirmation. These are the archive JPEGs, displayed smaller in the browser.";

  if (shootView.loading) {
    app.innerHTML = `<section class="admin-panel"><p class="empty">Loading shoot…</p></section>`;
    return;
  }
  if (shootView.error || !shoot) {
    app.innerHTML = `
      <section class="admin-panel">
        <p class="form-error">${escapeHtml(shootView.error || "Shoot not found.")}</p>
        <p><a class="text-link" href="#shoots">Back to Shoots</a></p>
      </section>`;
    return;
  }

  const count = shootView.images.length;
  const addCount = shootView.addFiles.length;
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
  const canRemove = isSuperAdmin();

  app.innerHTML = `
    <section class="admin-panel shoot-view">
      <p><a class="text-link" href="#shoots">← Shoots</a></p>
      <dl class="meta-grid shoot-meta">
        <div><dt>Customer</dt><dd>${escapeHtml(shoot.customer_name)}</dd></div>
        <div><dt>Project</dt><dd>${escapeHtml(shoot.project_name)}</dd></div>
        <div><dt>Shoot Date</dt><dd>${escapeHtml(shoot.shoot_date_display)} <span class="shoot-iso">${escapeHtml(
          shoot.shoot_date
        )}</span></dd></div>
        <div><dt>Images</dt><dd>${count} original${count === 1 ? "" : "s"}</dd></div>
      </dl>
      ${
        count
          ? `<div class="shoot-view-grid">${shootView.images
              .map(
                (image) => `
            <figure class="shoot-view-card">
              <img
                src="/api/admin/shoots/${escapeHtml(shoot.id)}/originals/${escapeHtml(image.id)}"
                alt="${escapeHtml(image.generated_filename)}"
                loading="lazy"
                decoding="async"
              />
              <figcaption>
                <span class="shoot-seq">${String(image.seq).padStart(3, "0")}</span>
                ${escapeHtml(image.generated_filename)}
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
          : `<p class="empty">No originals stored for this shoot yet.</p>`
      }
      <div class="shoot-add">
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
          <p class="ingest-drop-copy">or click to choose multiple files</p>
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
        <button class="button" type="button" id="shoot-add-upload" ${addReady ? "" : "disabled"}>Add to Shoot</button>
      </div>
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

const render = () => {
  const { view, customerId, shootId } = route();
  if (customerId) state.selectedCustomerId = customerId;
  document.body.classList.toggle("is-shoots", view === "shoots");
  if (!(view === "shoots" && shootId) && shootView.requestedId) {
    resetShootView();
  }
  if (view === "projects") renderProjects();
  else if (view === "shoots" && shootId) renderShootView(shootId);
  else if (view === "shoots") renderShoots();
  else renderCustomers();
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

  const removeImage = event.target.closest("[data-remove-image]");
  if (removeImage) {
    event.preventDefault();
    removeShootImage(removeImage.getAttribute("data-remove-image"));
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
  if (event.target.matches("#project-form [name=name]")) {
    const code = document.querySelector("#project-form [name=code]");
    if (code && !code.dataset.touched) code.value = suggestCode(event.target.value);
  }
});

document.addEventListener("input", (event) => {
  if (event.target.matches("#project-form [name=code]")) {
    event.target.dataset.touched = "true";
  }
});

const dropTarget = (event) =>
  event.target.closest("#ingest-drop") || event.target.closest("#shoot-add-drop");

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
  if (isAdd ? shootView.busy : ingest.busy) return;
  event.preventDefault();
  event.stopPropagation();
  drop.classList.remove("is-over");
  const files = collectDroppedFiles(event.dataTransfer);
  if (isAdd) addShootViewFiles(files);
  else addJpegFiles(files);
  render();
});

document.addEventListener("submit", async (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  if (form.id === "ingest-form") {
    event.preventDefault();
    return;
  }
  if (!["customer-form", "project-form"].includes(form.id)) return;
  event.preventDefault();
  setStatus("Saving…");
  const data = Object.fromEntries(new FormData(form));
  try {
    if (form.id === "customer-form") {
      const payload = {
        name: data.name,
        slug: data.slug,
        status: data.status,
      };
      if (data.password) payload.password = data.password;
      if (data.id) {
        await api(`/api/admin/customers/${data.id}`, { method: "PATCH", body: payload });
        setStatus("Customer saved.");
      } else {
        const created = await api("/api/admin/customers", { method: "POST", body: payload });
        state.selectedCustomerId = created.customer.id;
        setStatus(
          created.customer.password_set
            ? "Customer created."
            : "Customer created. Portal password is still pending."
        );
      }
    }
    if (form.id === "project-form") {
      await api("/api/admin/projects", { method: "POST", body: data });
      setStatus("Project created.");
    }
    await loadAll();
    render();
    if (form.id !== "customer-form") form.reset();
  } catch (error) {
    setStatus(error.message, true);
  }
});

window.addEventListener("hashchange", render);
boot();
