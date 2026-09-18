(() => {
  const view = document.body.getAttribute("data-view") || "";
  const token = document.body.getAttribute("data-token") || "";
  const imageId = document.body.getAttribute("data-image-id") || "";
  const galleryEl = document.getElementById("share-gallery");
  const gallery = galleryEl ? JSON.parse(galleryEl.textContent || "{}") : { images: [] };
  const images = gallery.images || [];

  const api = async (path, body) => {
    const response = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body || {}),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Please try again.");
    }
    return data;
  };

  const openLightbox = (index) => {
    if (!window.AirThereLightbox || !images.length) return;
    window.AirThereLightbox.open(
      images.map((image, idx, list) => ({
        src: image.src,
        seq: image.seq,
        counter: `${idx + 1} of ${list.length}`,
        alt: "Project photograph",
      })),
      index
    );
  };

  if (view === "image" && images.length) {
    const index = Math.max(
      0,
      images.findIndex((image) => image.id === imageId)
    );
    window.addEventListener("load", () => openLightbox(index < 0 ? 0 : index));
  }

  const form = document.getElementById("share-otp-form");
  const status = document.getElementById("share-status");
  const resend = document.getElementById("share-resend");
  if (!form || !token) return;

  const setStatus = (message) => {
    if (status) status.textContent = message || "";
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const submit = form.querySelector('button[type="submit"]');
    if (submit) submit.disabled = true;
    setStatus("");
    try {
      const result = await api(`/api/share/${encodeURIComponent(token)}/verify`, {
        code: String(data.get("code") || ""),
        next: String(data.get("next") || ""),
      });
      location.assign(result.next || `/share/${token}`);
    } catch (error) {
      setStatus(error.message);
    } finally {
      if (submit) submit.disabled = false;
    }
  });

  resend?.addEventListener("click", async () => {
    resend.disabled = true;
    setStatus("Sending a new code…");
    try {
      await api(`/api/share/${encodeURIComponent(token)}/otp`);
      setStatus("A new code has been sent.");
    } catch (error) {
      setStatus(error.message);
    } finally {
      resend.disabled = false;
    }
  });
})();
