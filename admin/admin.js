const app = document.querySelector("#app");
const statusEl = document.querySelector("#status");
const titleEl = document.querySelector("#view-title");
const leadEl = document.querySelector("#view-lead");

const state = {
  user: null,
  customers: [],
  projects: [],
  shoots: [],
  selectedCustomerId: "",
  selectedProjectId: "",
};

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

const suggestCode = (name) =>
  String(name || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);

const route = () => {
  const hash = location.hash.replace(/^#/, "") || "customers";
  const [view, id] = hash.split("/");
  return { view, id };
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
  leadEl.textContent =
    "Shoot Date is the actual site date. It is never taken from the day you create this record, the file date, or the camera clock.";
  const selectedCustomerId = state.selectedCustomerId || state.customers[0]?.id || "";
  const projects = state.projects.filter((project) => project.customer_id === selectedCustomerId);
  const selectedProjectId = projects.some((project) => project.id === state.selectedProjectId)
    ? state.selectedProjectId
    : projects[0]?.id || "";
  const visible = state.shoots.filter((shoot) => shoot.project_id === selectedProjectId);
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
                  (project) =>
                    `<option value="${escapeHtml(project.id)}" ${
                      project.id === selectedProjectId ? "selected" : ""
                    }>${escapeHtml(project.name)}</option>`
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
                <strong>Shoot Date: ${escapeHtml(shoot.shoot_date_display)}</strong>
                <span>Record created: ${escapeHtml(shoot.created_at_display)} · ${escapeHtml(
                  shoot.status
                )}</span>
              </li>`
                )
                .join("")}</ul>`
            : `<p class="empty">No shoots for this project yet. Images are not required to create a shoot record.</p>`
        }
      </section>
      <section class="admin-panel">
        <h2>New shoot</h2>
        <form class="admin-form" id="shoot-form">
          <label>
            <span>Project</span>
            <select name="project_id" required>
              ${projects
                .map(
                  (project) =>
                    `<option value="${escapeHtml(project.id)}" ${
                      project.id === selectedProjectId ? "selected" : ""
                    }>${escapeHtml(project.name)}</option>`
                )
                .join("")}
            </select>
          </label>
          <label>
            <span>Shoot Date</span>
            <input type="date" name="shoot_date" required />
          </label>
          <p class="hint">This is the date of the site visit. Historical dates are expected. Do not use today’s date unless the shoot actually happened today.</p>
          <button class="button" type="submit">Create shoot</button>
        </form>
      </section>
    </div>
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
  const { view, id } = route();
  if (id) state.selectedCustomerId = id;
  if (view === "projects") renderProjects();
  else if (view === "shoots") renderShoots();
  else renderCustomers();
};

const boot = async () => {
  try {
    const me = await api("/api/admin/me");
    state.user = me.user || null;
    const operator = document.querySelector("#operator");
    if (operator && state.user?.name) {
      operator.hidden = false;
      operator.textContent = state.user.name;
    }
    await loadAll();
    render();
  } catch (error) {
    app.innerHTML = `<section class="admin-panel"><p class="empty">${escapeHtml(
      error.message
    )}</p></section>`;
  }
};

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-open-customer]");
  if (!button) return;
  state.selectedCustomerId = button.getAttribute("data-open-customer");
  location.hash = `customers/${state.selectedCustomerId}`;
  render();
});

document.addEventListener("change", (event) => {
  if (event.target.id === "project-customer-filter" || event.target.id === "shoot-customer-filter") {
    state.selectedCustomerId = event.target.value;
    state.selectedProjectId = "";
    render();
  }
  if (event.target.id === "shoot-project-filter") {
    state.selectedProjectId = event.target.value;
    render();
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

document.addEventListener("submit", async (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  if (!["customer-form", "project-form", "shoot-form"].includes(form.id)) return;
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
    if (form.id === "shoot-form") {
      await api("/api/admin/shoots", { method: "POST", body: data });
      setStatus("Shoot created. Check that Shoot Date is the site date, not today, unless that is correct.");
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
