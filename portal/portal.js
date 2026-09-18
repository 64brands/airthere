(() => {
  const root = document.getElementById("portal-app");
  if (!root) return;

  const slug = document.body.getAttribute("data-slug") || "";
  const customerName = document.body.getAttribute("data-name") || "";

  const escapeHtml = (value) =>
    String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");

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
      const error = new Error(data.error || "Unable to load this record.");
      error.status = response.status;
      throw error;
    }
    return data;
  };

  const parsePath = () => {
    const parts = location.pathname.split("/").filter(Boolean);
    return {
      slug: parts[0] || slug,
      project: parts[1] || "",
      date: parts[2] || "",
    };
  };

  const go = (path, replace = false) => {
    const next = path.startsWith("/") ? path : `/${path}`;
    if (replace) history.replaceState({}, "", next);
    else history.pushState({}, "", next);
    render();
  };

  const empty = (message) => `<p class="portal-empty">${escapeHtml(message)}</p>`;

  const crumb = (items) =>
    `<nav class="portal-crumb" aria-label="Portal">${items
      .map((item) =>
        item.href
          ? `<a href="${escapeHtml(item.href)}">${escapeHtml(item.label)}</a>`
          : `<span>${escapeHtml(item.label)}</span>`
      )
      .join('<span class="portal-crumb-sep" aria-hidden="true">/</span>')}</nav>`;

  const renderProjects = (payload) => {
    const projects = payload.projects || [];
    if (projects.length === 1) {
      go(`/${slug}/${projects[0].code}`, true);
      return;
    }
    if (!projects.length) {
      root.innerHTML = `
        <section class="portal-page">
          ${crumb([{ label: customerName }])}
          <h1 class="portal-heading">${escapeHtml(customerName)}</h1>
          ${empty("No project records are available yet.")}
        </section>
      `;
      return;
    }
    root.innerHTML = `
      <section class="portal-page">
      ${crumb([{ label: customerName }])}
      <h1 class="portal-heading">${escapeHtml(customerName)}</h1>
      <p class="portal-sub">Select a project</p>
      <div class="portal-project-list">
        ${projects
          .map(
            (project) =>
              `<a class="portal-project-card" href="/${escapeHtml(slug)}/${escapeHtml(
                project.code
              )}"><strong>${escapeHtml(project.name)}</strong></a>`
          )
          .join("")}
      </div>
      </section>
    `;
  };

  const projectTitleHtml = (value) => {
    const escaped = escapeHtml(value);
    const idx = escaped.lastIndexOf(" ");
    if (idx === -1) return escaped;
    return `${escaped.slice(0, idx)}\u00a0${escaped.slice(idx + 1)}`;
  };

  const renderShoots = (payload) => {
    const project = payload.project || {};
    const shoots = payload.shoots || [];
    const heading = project.name || customerName;
    if (!shoots.length) {
      root.innerHTML = `
        <section class="portal-page">
        ${crumb([
          { href: `/${slug}`, label: customerName },
          { label: heading },
        ])}
        <h1 class="portal-heading portal-project-title">${projectTitleHtml(heading)}</h1>
        ${empty("No project records are available yet.")}
        </section>
      `;
      return;
    }
    root.innerHTML = `
      <section class="portal-page">
      ${crumb([
        { href: `/${slug}`, label: customerName },
        { label: heading },
      ])}
      <h1 class="portal-heading portal-project-title">${projectTitleHtml(heading)}</h1>
      <div class="portal-shoot-grid">
        ${shoots
          .map((shoot) => {
            const href = `/${slug}/${project.code}/${shoot.date}`;
            const count = Number(shoot.image_count || 0);
            const countLabel = `${count} image${count === 1 ? "" : "s"}`;
            const photo = shoot.cover_src
              ? `<img src="${escapeHtml(shoot.cover_src)}" alt="" />`
              : "";
            return `<a class="portal-shoot-card" href="${escapeHtml(href)}">
              ${photo}
              <span class="portal-shoot-shade" aria-hidden="true"></span>
              <span class="portal-shoot-copy">
                <strong>${escapeHtml(shoot.display_date)}</strong>
                <span>${escapeHtml(countLabel)}</span>
              </span>
            </a>`;
          })
          .join("")}
      </div>
      </section>
    `;
  };

  const openLightbox = (images, index) => {
    if (!window.AirThereLightbox) return;
    window.AirThereLightbox.open(
      images.map((image, index, list) => ({
        src: image.src,
        seq: image.seq,
        counter: `${index + 1} of ${list.length}`,
        alt: "Project photograph",
      })),
      index
    );
  };

  const renderGallery = (payload) => {
    const project = payload.project || {};
    const shoot = payload.shoot || {};
    const images = payload.images || [];
    const heading = shoot.display_date || "Project record";
    root.innerHTML = `
      <section class="portal-page portal-page-gallery">
      ${crumb([
        { href: `/${slug}`, label: customerName },
        { href: `/${slug}/${project.code}`, label: project.name || "Project" },
        { label: heading },
      ])}
      <p class="portal-sub">${escapeHtml(project.name || "")}</p>
      <div class="portal-gallery-head">
        <h1 class="portal-heading">${escapeHtml(heading)}</h1>
        ${
          images.length
            ? `<div class="portal-share">
                <form class="portal-share-form" id="portal-share-form">
                  <label class="portal-share-label" for="portal-share-email">Recipient email</label>
                  <input id="portal-share-email" name="email" type="email" inputmode="email" autocomplete="email" spellcheck="false" required placeholder="Recipient email" />
                  <button class="button" type="submit">Share Report</button>
                </form>
                <p class="portal-share-status" id="portal-share-status" role="status"></p>
              </div>`
            : ""
        }
      </div>
      ${
        images.length
          ? `<div class="portal-gallery">
              ${images
                .map(
                  (image, index) =>
                    `<button class="portal-gallery-item" type="button" data-index="${index}">
                      <img src="${escapeHtml(image.src)}" alt="Photograph ${Number(image.seq) || index + 1}" />
                    </button>`
                )
                .join("")}
            </div>`
          : empty("This record is being prepared.")
      }
      </section>
    `;
    root.querySelectorAll("[data-index]").forEach((button) => {
      button.addEventListener("click", () => {
        openLightbox(images, Number(button.getAttribute("data-index")));
      });
    });
    const hashId = String(location.hash || "").replace(/^#image-/, "");
    if (hashId) {
      const index = images.findIndex((image) => image.id === hashId);
      if (index >= 0) openLightbox(images, index);
    }
    bindShareForm(project.code, shoot.date);
  };

  const bindShareForm = (projectCode, shootDate) => {
    const form = root.querySelector("#portal-share-form");
    const status = root.querySelector("#portal-share-status");
    const emailInput = root.querySelector("#portal-share-email");
    if (!form) return;

    const setStatus = (message, kind = "") => {
      if (!status) return;
      status.classList.remove("is-error", "is-success");
      if (kind === "success") {
        status.classList.add("is-success");
        status.innerHTML = `<span class="portal-share-confirm"><span class="portal-share-ok">Report shared ✓</span><span class="portal-share-sent">Sent to ${escapeHtml(
          message
        )}</span></span>`;
        return;
      }
      if (kind === "error" && message) status.classList.add("is-error");
      status.textContent = message || "";
    };

    emailInput?.addEventListener("input", () => {
      if (status?.classList.contains("is-success")) setStatus("");
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const email = String(new FormData(form).get("email") || "").trim();
      const submit = form.querySelector('button[type="submit"]');
      if (submit) submit.disabled = true;
      setStatus("Sending…");
      try {
        await api(
          `/api/portal/projects/${encodeURIComponent(projectCode)}/shoots/${encodeURIComponent(
            shootDate
          )}/share`,
          { method: "POST", body: { email } }
        );
        form.reset();
        setStatus(email, "success");
      } catch (error) {
        setStatus(error.message || "The report could not be shared.", "error");
      } finally {
        if (submit) submit.disabled = false;
      }
    });
  };

  const render = async () => {
    const path = parsePath();
    try {
      if (!path.project) {
        renderProjects(await api("/api/portal/projects"));
        return;
      }
      if (!path.date) {
        renderShoots(await api(`/api/portal/projects/${encodeURIComponent(path.project)}`));
        return;
      }
      renderGallery(
        await api(
          `/api/portal/projects/${encodeURIComponent(path.project)}/shoots/${encodeURIComponent(
            path.date
          )}`
        )
      );
    } catch (error) {
      if (error.status === 401) {
        location.assign(`/${slug}`);
        return;
      }
      root.innerHTML = empty("This record is not available.");
    }
  };

  root.addEventListener("click", (event) => {
    const link = event.target.closest("a[href]");
    if (!link) return;
    const url = new URL(link.href, location.origin);
    if (url.origin !== location.origin) return;
    if (!url.pathname.startsWith(`/${slug}`)) return;
    event.preventDefault();
    go(url.pathname);
  });

  window.addEventListener("popstate", render);
  window.addEventListener("hashchange", render);
  render();
})();
