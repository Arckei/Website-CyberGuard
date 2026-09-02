import {
  applyCurrentUserSettings,
  ensureState,
  escapeHtml,
  getActiveClass,
  getCurrentUser,
  getCurrentUserSettings,
  getState,
  hydrateStateFromFirebase,
  requireAuth,
  renderLeaderboard,
  renderSkeletonRows,
  setupNav,
  setupPasswordToggles,
  showToast
} from "../../services/shared.js";

renderSkeletonRows("[data-leaderboard]", {
  count: 3,
  rowHtml: () => `
    <div class="leaderboard-row skeleton" aria-hidden="true">
      <span class="rank">&nbsp;</span>
      <strong>&nbsp;</strong>
      <span class="badge">&nbsp;</span>
    </div>
  `
});
renderSkeletonRows("[data-current-class]", {
  count: 1,
  rowHtml: () => `
    <div class="skeleton" aria-hidden="true">
      <h2>&nbsp;</h2>
      <p>&nbsp;</p>
    </div>
  `
});

document.addEventListener("DOMContentLoaded", async () => {
  ensureState();
  const authUser = await requireAuth("../login/");
  if (!authUser) return;
  await hydrateStateFromFirebase();
  if (authUser.role === "admin") {
    window.location.href = "../admin/";
    return;
  }
  applyCurrentUserSettings();
  setupNav();
  setupPasswordToggles();
  renderUserDashboard();
});

function renderUserDashboard() {
  const state = getState();
  const klass = getActiveClass(state);
  const user = getCurrentUser(state);
  const settings = getCurrentUserSettings(state);
  const score = klass?.scores[user?.id] || 0;
  renderLeaderboard("[data-leaderboard]", state, klass);
  const overview = document.querySelector("[data-current-class]");
  if (overview && klass) {
    const details = settings.showProgressDetails ? `
      <div class="progress-summary">
        <div>
          <span class="metric-label">Current Score</span>
          <strong>${score}</strong>
        </div>
        <div>
          <span class="metric-label">Class Rank</span>
          <strong>${studentRank(klass, user?.id)}</strong>
        </div>
        <div>
          <span class="metric-label">Classmates</span>
          <strong>${klass.students.length}</strong>
        </div>
      </div>
    ` : `<p class="muted">Progress details are hidden in your profile settings.</p>`;

    overview.innerHTML = `
      <h2>${escapeHtml(klass.name)} ${escapeHtml(klass.section)}</h2>
      <p>Class code: ${escapeHtml(klass.code)}</p>
      ${details}
    `;
  }

  if (settings.reminderPrompts && !sessionStorage.getItem("cyberguard_dashboard_reminder")) {
    sessionStorage.setItem("cyberguard_dashboard_reminder", "shown");
    setTimeout(() => showToast("Reminder: check your progress dashboard after each activity."), 500);
  }
}

function studentRank(klass, userId) {
  if (!userId) return "-";
  const rows = klass.students
    .map((id) => ({ id, score: klass.scores[id] || 0 }))
    .sort((a, b) => b.score - a.score);
  const index = rows.findIndex((row) => row.id === userId);
  return index >= 0 ? `#${index + 1}` : "-";
}

