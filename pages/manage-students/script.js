import {
  ensureState,
  escapeHtml,
  fullName,
  getActiveClass,
  getState,
  hydrateStateFromFirebase,
  initPageAnimations,
  renderSkeletonRows,
  requireAuth,
  saveState,
  setupNav,
  setupPasswordToggles,
  showToast
} from "../../services/shared.js";

renderSkeletonRows("[data-student-list]", {
  count: 3,
  rowHtml: () => `
    <div class="student-row skeleton" aria-hidden="true">
      <strong>&nbsp;</strong>
      <span class="badge">&nbsp;</span>
      <button class="btn danger" type="button" disabled>&nbsp;</button>
    </div>
  `
});

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
  renderManageStudents();
  initPageAnimations();
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

