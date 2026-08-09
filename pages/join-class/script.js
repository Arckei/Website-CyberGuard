import { joinClassByCode } from "../../firebase-service.js";
import {
  ensureState,
  getCurrentUser,
  getState,
  hydrateStateFromFirebase,
  requireAuth,
  saveLocalState,
  setupNav,
  setupPasswordToggles,
  showToast
} from "../../shared.js";

document.addEventListener("DOMContentLoaded", async () => {
  ensureState();
  const authUser = await requireAuth("../login/");
  if (!authUser) return;
  await hydrateStateFromFirebase();
  setupNav();
  setupPasswordToggles();
  setupJoinClass();
});

function setupJoinClass() {
  const form = document.querySelector("[data-join-class-form]");
  if (!form) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const code = form.classCode.value.trim().toUpperCase();
    const submitButton = form.querySelector("[type='submit']");
    if (submitButton) submitButton.disabled = true;

    try {
      const klass = await joinClassByCode(code);

      if (!klass) {
        showToast("Class code was not found.");
        return;
      }

      // Reflect the join locally right away (cache only — the write
      // already landed in Firestore via joinClassByCode above).
      const state = getState();
      const user = getCurrentUser(state);
      const existingIndex = state.classes.findIndex((item) => item.id === klass.id);
      if (existingIndex >= 0) state.classes[existingIndex] = klass;
      else state.classes.push(klass);
      state.activeClassId = klass.id;
      if (user) klass.scores[user.id] = klass.scores[user.id] || 0;
      saveLocalState(state);

      showToast("Joined class.");
      window.location.href = "../user/";
    } catch (error) {
      console.error("CyberGuard: join class failed", error);
      showToast("Couldn't join that class. Please try again.");
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });
}

