import { fetchUsersByIds, subscribeToClass } from "../../services/firebase-service.js";
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
  saveLocalState,
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
  await hydrateStateFromFirebase(true);
  setupNav();
  setupPasswordToggles();
  renderManageStudents();
  setupRealtimeStudentSync();
  initPageAnimations();
});

// Keeps this list live. loadCyberGuardData() only fetches profiles for
// students who had already joined by the time this page loaded (or by the
// time the 60s local session cache last refreshed), so anyone who joins
// afterward has their id land in klass.students with no matching entry in
// state.users — and renderManageStudents() silently skips ids it can't
// resolve to a profile. This listens for class changes and backfills any
// missing student profiles as soon as they show up, no reload needed.
function setupRealtimeStudentSync() {
  const state = getState();
  const klass = getActiveClass(state);
  if (!klass) return;

  subscribeToClass(klass.id, async (remoteClass) => {
    const nextState = getState();
    const localClass = nextState.classes.find((item) => item.id === remoteClass.id);
    if (localClass) Object.assign(localClass, remoteClass);
    else nextState.classes.push(remoteClass);

    const knownIds = new Set(nextState.users.map((user) => user.id));
    const missingIds = remoteClass.students.filter((id) => !knownIds.has(id));

    if (missingIds.length > 0) {
      try {
        const fetchedUsers = await fetchUsersByIds(missingIds);
        nextState.users = [...nextState.users, ...fetchedUsers];
      } catch (error) {
        console.warn("[CyberGuard] Could not load newly joined student profiles:", error);
      }
    }

    saveLocalState(nextState);
    renderManageStudents();
  });
}

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

