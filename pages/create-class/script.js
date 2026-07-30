import {
  ensureState,
  getCurrentUser,
  getState,
  hydrateStateFromFirebase,
  makeCode,
  saveState,
  setupNav,
  setupPasswordToggles,
  showToast
} from "../../shared.js";

document.addEventListener("DOMContentLoaded", async () => {
  ensureState();
  await hydrateStateFromFirebase();
  setupNav();
  setupPasswordToggles();

  const state = getState();
  const currentUser = getCurrentUser(state);
  if (!currentUser || currentUser.role !== "admin") {
    showToast("Admin access only.");
    window.location.href = "../user/";
    return;
  }

  setupCreateClass();
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
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const state = getState();
    const id = `class-${Date.now()}`;
    const klass = {
      id,
      name: form.className.value.trim() || "Cyber Class",
      section: form.section.value.trim() || "Section",
      code: form.classCode.value.trim().toUpperCase() || makeCode(),
      teacher: `${form.firstName.value.trim()} ${form.lastName.value.trim()}`.trim() || "Cyber Teacher",
      // Real students join later via the class code — no fake starter IDs.
      students: [],
      scores: {},
      modules: { phishing: { complete: false } }
    };
    state.classes.push(klass);
    state.activeClassId = id;
    saveState(state);
    showToast("Class created.");
    window.location.href = "../manage-class/";
  });
}
