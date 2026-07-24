const menuButton = document.querySelector(".menu-button");
const mobileNav = document.querySelector("#mobile-nav");
const contactForm = document.querySelector("#contact-form");
const formStatus = document.querySelector("#form-status");

document.querySelector("#year").textContent = new Date().getFullYear();

menuButton.addEventListener("click", () => {
  const isOpen = menuButton.getAttribute("aria-expanded") === "true";
  menuButton.setAttribute("aria-expanded", String(!isOpen));
  mobileNav.hidden = isOpen;
});

mobileNav.addEventListener("click", (event) => {
  if (event.target.matches("a")) {
    menuButton.setAttribute("aria-expanded", "false");
    mobileNav.hidden = true;
  }
});

contactForm.addEventListener("submit", (event) => {
  event.preventDefault();

  if (!contactForm.checkValidity()) {
    contactForm.reportValidity();
    return;
  }

  const submitButton = contactForm.querySelector('button[type="submit"]');
  const formData = Object.fromEntries(new FormData(contactForm));

  submitButton.disabled = true;
  submitButton.textContent = "Sending…";
  formStatus.textContent = "";

  fetch("/api/contact", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(formData),
  })
    .then(async (response) => {
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "We couldn't send your enquiry.");
      }

      contactForm.reset();
      formStatus.textContent =
        "Thanks — your enquiry has been sent. AirThere will be in touch shortly.";
    })
    .catch((error) => {
      formStatus.textContent =
        error.message || "We couldn't send your enquiry. Please try again.";
    })
    .finally(() => {
      submitButton.disabled = false;
      submitButton.textContent = "Send enquiry";
    });
});
