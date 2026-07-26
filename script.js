import {
  ensureState,
  getState,
  hydrateStateFromFirebase,
  isAuthenticated,
  setupGlobe,
  setupNav,
  setupPasswordToggles
} from "./shared.js";

document.addEventListener("DOMContentLoaded", async () => {
  ensureState();
  await hydrateStateFromFirebase();
  setupNav();
  setupPasswordToggles();
  setupLandingPage();
  setupGlobe();
});

function setupLandingPage() {
  const state = getState();
  const primaryButton = document.querySelector(".landing-actions .btn.primary");
  const secondaryButton = document.querySelector(".landing-actions .btn.ghost");
  const currentUser = state.users.find((user) => user.id === state.currentUserId);

  if (!primaryButton || !secondaryButton) return;

  if (isAuthenticated(state) && currentUser) {
    primaryButton.textContent = currentUser.role === "admin" ? "Open Admin Dashboard" : "Open Dashboard";
    primaryButton.href = currentUser.role === "admin" ? "./pages/admin/" : "./pages/user/";
    secondaryButton.textContent = "View Profile";
    secondaryButton.href = "./pages/profile/";
  } else {
    primaryButton.textContent = "Login";
    primaryButton.href = "./pages/login/";
    secondaryButton.textContent = "Sign Up";
    secondaryButton.href = "./pages/signup/";
  }

  setupLandingAnimations();
}

function setupLandingAnimations() {
  const animatedItems = document.querySelectorAll(
    ".feature-card, .certificate-card, .reveal-on-scroll"
  );

  if (!animatedItems.length) return;

  animatedItems.forEach((item) => item.classList.add("reveal-on-scroll"));

  if (!("IntersectionObserver" in window)) {
    animatedItems.forEach((item) => item.classList.add("is-visible"));
    return;
  }

  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-visible");
      revealObserver.unobserve(entry.target);
    });
  }, { threshold: 0.18, rootMargin: "0px 0px -40px" });

  animatedItems.forEach((item) => revealObserver.observe(item));
}
