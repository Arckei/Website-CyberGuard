import {
  ensureState,
  getCurrentUser,
  getState,
  hydrateStateFromFirebase,
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
  setupJoinClass();
});

function setupJoinClass() {
  const form = document.querySelector("[data-join-class-form]");
  if (!form) return;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const state = getState();
    const code = form.classCode.value.trim().toUpperCase();
    const klass = state.classes.find((item) => item.code.toUpperCase() === code);
    const user = getCurrentUser(state);

    if (!klass || !user) {
      showToast("Class code was not found.");
      return;
    }

    if (!klass.students.includes(user.id)) {
      klass.students.push(user.id);
      klass.scores[user.id] = klass.scores[user.id] || 0;
    }
    state.activeClassId = klass.id;
    saveState(state);
    showToast("Joined class.");
    window.location.href = "../user/";
  });
}
