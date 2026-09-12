import { ensureState, hydrateStateFromFirebase, initPageAnimations, setupNav } from "../../services/shared.js";

document.addEventListener("DOMContentLoaded", async () => {
  ensureState();
  setupNav();
  // Best-effort only: keeps the "Logout" nav link accurate for a signed-in
  // visitor, but this page must render fine even if it's never signed in.
  await hydrateStateFromFirebase().catch(() => {});
  setupNav();
  initPageAnimations();
});
