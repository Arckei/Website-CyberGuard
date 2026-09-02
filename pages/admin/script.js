import {
  ensureState,
  escapeHtml,
  fullName,
  getActiveClass,
  getCurrentUser,
  getState,
  hideLoadingOverlay,
  hydrateStateFromFirebase,
  renderSkeletonRows,
  requireAuth,
  saveState,
  setupNav,
  setupPasswordToggles,
  showLoadingOverlay,
  showToast
} from "../../services/shared.js";

showLoadingOverlay();
renderSkeletonRows("[data-admin-student-list]", { count: 3, rowHtml: studentRowSkeleton });

document.addEventListener("DOMContentLoaded", async () => {
  ensureState();
  const authUser = await requireAuth("../login/");
  if (!authUser) return;
  await hydrateStateFromFirebase();
  setupNav();
  setupPasswordToggles();

  if (authUser.role !== "admin") {
    showToast("Admin access only.");
    window.location.href = "../user/";
    return;
  }

  renderAdminDashboard();
  await hideLoadingOverlay();
});

function studentRowSkeleton() {
  return `
    <div class="student-row skeleton" aria-hidden="true">
      <strong>&nbsp;</strong>
      <span class="badge">&nbsp;</span>
      <button class="btn danger" type="button" disabled>&nbsp;</button>
    </div>
  `;
}

function renderAdminDashboard() {
  const state = getState();
  const klass = getActiveClass(state);
  // The Leaderboard box is now owned by the React widget (leaderboard-mount.js),
  // which manages its own loading state — no vanilla render call needed here.
  renderAdminStudentList(state, klass);
  const tracker = document.querySelector("[data-class-tracker]");
  if (tracker) {
    tracker.textContent = `${state.classes.length} class${state.classes.length === 1 ? "" : "es"} ready`;
  }
}

function renderAdminStudentList(state, klass) {
  const list = document.querySelector("[data-admin-student-list]");
  if (!list || !klass) return;

  list.innerHTML = klass.students.map((id) => {
    const user = state.users.find((item) => item.id === id);
    if (!user) return "";
    return `
      <div class="student-row">
        <strong>${escapeHtml(fullName(user))}</strong>
        <span class="badge">${klass.scores[id] || 0} points</span>
        <button class="btn danger" type="button" data-admin-remove-student="${id}">Remove</button>
      </div>
    `;
  }).join("");

  list.querySelectorAll("[data-admin-remove-student]").forEach((button) => {
    button.addEventListener("click", () => {
      const studentId = button.dataset.adminRemoveStudent;
      const student = state.users.find((u) => u.id === studentId);
      klass.students = klass.students.filter((id) => id !== studentId);
      delete klass.scores[studentId];
      saveState(state);
      renderAdminStudentList(state, klass);
      showToast(`${student ? fullName(student) : "Student"} removed from class.`);
    });
  });
}