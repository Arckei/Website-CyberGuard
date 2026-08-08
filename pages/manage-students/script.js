import {
  ensureState,
  escapeHtml,
  fullName,
  getActiveClass,
  getState,
  hydrateStateFromFirebase,
  saveState,
  setupNav,
  setupPasswordToggles
} from "../../shared.js";

document.addEventListener("DOMContentLoaded", async () => {
  ensureState();
  await hydrateStateFromFirebase();
  setupNav();
  setupPasswordToggles();
  renderManageStudents();
});

function renderManageStudents() {
  const state = getState();
  const klass = getActiveClass(state);
  const title = document.querySelector("[data-class-title]");
  const list = document.querySelector("[data-student-list]");
  if (!klass || !list) return;

  if (title) title.textContent = `${klass.name} / ${klass.section}`;
  list.innerHTML = klass.students.map((id) => {
    const user = state.users.find((item) => item.id === id);
    if (!user) return "";
    return `
      <div class="student-row">
        <strong>${escapeHtml(fullName(user))}</strong>
        <span class="badge">${klass.scores[id] || 0} points</span>
        <button class="btn danger" type="button" data-remove-student="${id}">Remove</button>
      </div>
    `;
  }).join("");

  list.querySelectorAll("[data-remove-student]").forEach((button) => {
    button.addEventListener("click", () => {
      klass.students = klass.students.filter((id) => id !== button.dataset.removeStudent);
      delete klass.scores[button.dataset.removeStudent];
      saveState(state);
      renderManageStudents();
    });
  });
}

