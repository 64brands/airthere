/**
 * Reusable AirThere image viewer.
 * Admin passes authenticated original URLs.
 * The client gallery passes authenticated Standard 2000px URLs.
 */
(() => {
  const state = {
    items: [],
    index: 0,
    open: false,
    scrollY: 0,
  };

  let root = null;

  const padSeq = (seq) => {
    const n = Number(seq);
    if (!Number.isInteger(n) || n < 1) return String(seq || "");
    return n > 999 ? String(n) : String(n).padStart(3, "0");
  };

  const els = () => {
    ensure();
    return {
      root,
      backdrop: root.querySelector(".lightbox-backdrop"),
      close: root.querySelector(".lightbox-close"),
      prev: root.querySelector(".lightbox-prev"),
      next: root.querySelector(".lightbox-next"),
      image: root.querySelector(".lightbox-image"),
      seq: root.querySelector(".lightbox-seq"),
      name: root.querySelector(".lightbox-name"),
    };
  };

  const ensure = () => {
    if (root) return root;
    root = document.createElement("div");
    root.className = "lightbox";
    root.hidden = true;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "Image viewer");
    root.innerHTML = `
      <div class="lightbox-backdrop" data-lightbox-close="true"></div>
      <button type="button" class="lightbox-close" data-lightbox-close="true" aria-label="Close">×</button>
      <button type="button" class="lightbox-nav lightbox-prev" data-lightbox-dir="-1" aria-label="Previous image">‹</button>
      <button type="button" class="lightbox-nav lightbox-next" data-lightbox-dir="1" aria-label="Next image">›</button>
      <figure class="lightbox-stage">
        <img class="lightbox-image" alt="" />
        <figcaption class="lightbox-caption">
          <span class="lightbox-seq"></span>
          <span class="lightbox-name"></span>
        </figcaption>
      </figure>
    `;
    document.body.appendChild(root);

    root.addEventListener("click", (event) => {
      if (event.target.closest("[data-lightbox-close]")) {
        event.preventDefault();
        close();
        return;
      }
      const nav = event.target.closest("[data-lightbox-dir]");
      if (nav) {
        event.preventDefault();
        step(Number(nav.getAttribute("data-lightbox-dir")));
      }
    });
    return root;
  };

  const showItem = () => {
    const item = state.items[state.index];
    if (!item) return;
    const ui = els();
    ui.image.src = item.src;
    ui.image.alt = item.alt || item.label || item.filename || "Project photograph";
    ui.seq.textContent = item.counter || padSeq(item.seq);
    ui.seq.hidden = !ui.seq.textContent;
    ui.name.textContent = item.label || item.filename || "";
    ui.name.hidden = !ui.name.textContent;
    const last = state.items.length - 1;
    ui.prev.hidden = state.items.length < 2 || state.index <= 0;
    ui.next.hidden = state.items.length < 2 || state.index >= last;
    ui.prev.disabled = ui.prev.hidden;
    ui.next.disabled = ui.next.hidden;
  };

  const step = (delta) => {
    if (!state.open) return;
    const next = state.index + delta;
    if (next < 0 || next >= state.items.length) return;
    state.index = next;
    showItem();
  };

  const open = (items, index = 0) => {
    const list = Array.isArray(items) ? items.filter((item) => item && item.src) : [];
    if (!list.length) return;
    const start = Math.min(Math.max(Number(index) || 0, 0), list.length - 1);
    ensure();
    state.items = list;
    state.index = start;
    state.open = true;
    state.scrollY = window.scrollY;
    document.body.classList.add("lightbox-open");
    root.hidden = false;
    showItem();
    els().close.focus();
  };

  const close = () => {
    if (!state.open) return;
    state.open = false;
    state.items = [];
    state.index = 0;
    if (root) {
      const ui = els();
      ui.image.removeAttribute("src");
      ui.image.alt = "";
      root.hidden = true;
    }
    document.body.classList.remove("lightbox-open");
    window.scrollTo(0, state.scrollY);
  };

  document.addEventListener("keydown", (event) => {
    if (!state.open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      step(-1);
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      step(1);
    }
  });

  window.AirThereLightbox = { open, close, step };
})();
