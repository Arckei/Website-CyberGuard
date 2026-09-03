import {
  ensureState,
  getState,
  hydrateStateFromFirebase,
  initPageAnimations,
  makeCode,
  requireAuth,
  saveState,
  setupNav,
  setupPasswordToggles,
  showToast
} from "../../services/shared.js";

document.addEventListener("DOMContentLoaded", async () => {
  ensureState();
  const authUser = await requireAuth("../login/");
  if (!authUser) return;
  if (authUser.role !== "admin") {
    showToast("Admin access only.");
    window.location.href = "../user/";
    return;
  }
  await hydrateStateFromFirebase();
  setupNav();
  setupPasswordToggles();
  setupCreateClass();
  initPageAnimations();
});

function setupCreateClass() {
  const form = document.querySelector("[data-create-class-form]");
  const generate = document.querySelector("[data-generate-code]");
  const code = document.querySelector("#classCode");

  if (generate && code) {
    generate.addEventListener("click", () => {
      code.value = makeCode();
    });
  }

  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const state = getState();
    const id = `class-${Date.now()}`;
    const submitButton = form.querySelector('button[type="submit"]');
    const formData = new FormData(form);
    const firstName = String(formData.get("firstName") || "").trim();
    const lastName = String(formData.get("lastName") || "").trim();
    const className = String(formData.get("className") || "").trim();
    const section = String(formData.get("section") || "").trim();
    const classCode = String(formData.get("classCode") || "").trim().toUpperCase();
    const klass = {
      id,
      name: className || "Cyber Class",
      section: section || "Section",
      code: classCode || makeCode(),
      teacher: `${firstName} ${lastName}`.trim() || "Cyber Teacher",
      students: [],
      scores: {},
      modules: { phishing: { complete: false } }
    };
    state.classes.push(klass);
    state.activeClassId = id;

    if (submitButton) submitButton.disabled = true;
    try {
      await saveState(state, { throwOnSyncError: true });
      showToast("Class created.");
      window.location.href = "../manage-class/";
    } catch (error) {
      state.classes = state.classes.filter((item) => item.id !== id);
      state.activeClassId = state.classes[0]?.id || null;
      saveState(state);
      showToast(error?.message || "Could not create class. Please try again.");
      if (submitButton) submitButton.disabled = false;
    }
  });
}

