import {
  ensureState,
  getCurrentUser,
  getState,
  hydrateStateFromFirebase,
  initHeroParallax,
  initPageAnimations,
  isAuthenticated,
  setupGlobe,
  setupNav,
  setupPasswordToggles
} from "./services/shared.js";

document.addEventListener("DOMContentLoaded", async () => {
  ensureState();
  const hydrate = hydrateStateFromFirebase();
  const mediaReady = setupCardMedia();
  const minVisibleTime = wait(400); // avoid a skeleton flash on fast connections

  await Promise.all([hydrate, mediaReady, minVisibleTime]);

  setupNav();
  setupPasswordToggles();
  setupLandingPage();
  setupFooterYear();
  setupGlobe();
  revealSkeletons();
  initPageAnimations();
  initHeroParallax();
});

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ==========================================================================
// SKELETON LOADING & PHOTO / FALLBACK-LINE HANDLING
// ==========================================================================

function setupCardMedia() {
  const wrappers = document.querySelectorAll("[data-card-media]");

  wrappers.forEach((wrapper) => {
    const img = wrapper.querySelector("[data-card-photo]");
    const line = wrapper.querySelector("[data-card-fallback]");
    if (!img) return;

    const showPhoto = () => {
      img.hidden = false;
      line?.classList.remove("is-visible");
    };

    const showFallbackLine = () => {
      img.hidden = true;
      line?.classList.add("is-visible");
    };

    const src = img.dataset.src || "";

    if (!src) {
      // No photo provided for this element at all — skip the fake-loading
      // skeleton state entirely and just show the line right away.
      wrapper.dataset.noPhoto = "true";
      showFallbackLine();
      return;
    }

    img.addEventListener("load", showPhoto, { once: true });
    img.addEventListener("error", () => {
      // Photo was supposed to exist but failed to load (404, bad path, etc).
      showFallbackLine();
    }, { once: true });
    img.src = src;
  });

  // Lazy images may not load until their card is near the viewport. Do not
  // block the page-wide skeleton reveal on those browser-controlled loads.
  return Promise.resolve();
}

function revealSkeletons() {
  document.querySelectorAll("[data-card].skeleton").forEach((card, index) => {
    // Small stagger so the cards settle in rather than popping in all at once.
    setTimeout(() => card.classList.remove("skeleton"), index * 60);
  });
}

function setupFooterYear() {
  const yearEl = document.querySelector("[data-current-year]");
  if (yearEl) yearEl.textContent = new Date().getFullYear();
}

function setupLandingPage() {
  const state = getState();
  const primaryButton = document.querySelector(".landing-actions .btn.primary");
  const secondaryButton = document.querySelector(".landing-actions .btn.ghost");
  const currentUser = getCurrentUser(state);

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
}