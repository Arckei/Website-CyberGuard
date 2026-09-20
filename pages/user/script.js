import { fetchUsersByIds, subscribeToClass } from "../../services/firebase-service.js";
import {
  applyCurrentUserSettings,
  ensureState,
  escapeHtml,
  getActiveClass,
  getCombinedClassScore,
  getCurrentUser,
  getCurrentUserSettings,
  getState,
  hydrateStateFromFirebase,
  initPageAnimations,
  requireAuth,
  renderLeaderboard,
  renderSkeletonRows,
  saveLocalState,
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
  setupRealtimeLeaderboardSync();
  initPageAnimations();
});

// Keeps the leaderboard live. loadCyberGuardData() only fetches classmate
// profiles that existed by the time this page loaded (or by the time the
// 60s local session cache last refreshed), so anyone who joins afterward has
// their id land in klass.students with no matching entry in state.users —
// and renderLeaderboard() silently skips ids it can't resolve to a profile.
// This listens for class changes and backfills any missing profiles as soon
// as they show up, no reload needed.
function setupRealtimeLeaderboardSync() {
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
        console.warn("[CyberGuard] Could not load newly joined classmate profiles:", error);
      }
    }

    saveLocalState(nextState);
    renderUserDashboard();
  });
}

function renderUserDashboard() {
  const state = getState();
  const klass = getActiveClass(state);
  const user = getCurrentUser(state);
  const settings = getCurrentUserSettings(state);
  const score = getCombinedClassScore(klass, user?.id);
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
    .map((id) => ({ id, score: getCombinedClassScore(klass, id) }))
    .sort((a, b) => b.score - a.score);
  const index = rows.findIndex((row) => row.id === userId);
  return index >= 0 ? `#${index + 1}` : "-";
}

