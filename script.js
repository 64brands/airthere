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

  const formData = new FormData(contactForm);
  const name = formData.get("name");
  const company = formData.get("company");
  const email = formData.get("email");
  const phone = formData.get("phone");
  const project = formData.get("project");

  const subject = `AirThere project enquiry — ${company || name}`;
  const body = [
    `Name: ${name}`,
    `Company: ${company || "Not provided"}`,
    `Email: ${email}`,
    `Phone: ${phone || "Not provided"}`,
    "",
    "Project details:",
    project,
  ].join("\n");

  formStatus.textContent = "Opening your email app with your enquiry ready to send…";
  window.location.href =
    `mailto:data@airthere.com.au?subject=${encodeURIComponent(subject)}` +
    `&body=${encodeURIComponent(body)}`;
});
