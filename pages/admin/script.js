import { fetchUsersByIds, subscribeToClass } from "../../services/firebase-service.js";
import {
  ensureState,
  escapeHtml,
  fullName,
  getActiveClass,
  getCombinedClassScore,
  getCurrentUser,
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
  setupRealtimeStudentSync();
  initPageAnimations();
});

// Keeps the joined-students list live. loadCyberGuardData() only fetches
// profiles for students who had already joined by the time this page loaded
// (or by the time the 60s local session cache last refreshed), so anyone who
// joins afterward has their id land in klass.students with no matching entry
// in state.users — and renderAdminStudentList() silently skips ids it can't
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
    renderAdminDashboard();
  });
}

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
        <span class="badge">${getCombinedClassScore(klass, id)} points</span>
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