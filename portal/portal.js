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

  const api = async (path) => {
    const response = await fetch(path, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
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
      .join('<span aria-hidden="true">/</span>')}</nav>`;

  const renderProjects = (payload) => {
    const projects = payload.projects || [];
    if (projects.length === 1) {
      go(`/${slug}/${projects[0].code}`, true);
      return;
    }
    if (!projects.length) {
      root.innerHTML = `
        ${crumb([{ label: customerName }])}
        <h1 class="portal-heading">${escapeHtml(customerName)}</h1>
        ${empty("No project records are available yet.")}
      `;
      return;
    }
    root.innerHTML = `
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
    `;
  };

  const renderShoots = (payload) => {
    const project = payload.project || {};
    const shoots = payload.shoots || [];
    const heading = project.name || customerName;
    if (!shoots.length) {
      root.innerHTML = `
        ${crumb([
          { href: `/${slug}`, label: customerName },
          { label: heading },
        ])}
        <h1 class="portal-heading">${escapeHtml(heading)}</h1>
        ${empty("No project records are available yet.")}
      `;
      return;
    }
    root.innerHTML = `
      ${crumb([
        { href: `/${slug}`, label: customerName },
        { label: heading },
      ])}
      <h1 class="portal-heading">${escapeHtml(heading)}</h1>
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
      ${crumb([
        { href: `/${slug}`, label: customerName },
        { href: `/${slug}/${project.code}`, label: project.name || "Project" },
        { label: heading },
      ])}
      <p class="portal-sub">${escapeHtml(project.name || "")}</p>
      <h1 class="portal-heading">${escapeHtml(heading)}</h1>
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
    `;
    root.querySelectorAll("[data-index]").forEach((button) => {
      button.addEventListener("click", () => {
        openLightbox(images, Number(button.getAttribute("data-index")));
      });
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
  render();
})();
