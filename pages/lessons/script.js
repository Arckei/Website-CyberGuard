import {
  ensureState,
  escapeHtml,
  getClassPosts,
  getCurrentUser,
  getState,
  hydrateStateFromFirebase,
  renderPostFeed,
  saveLocalState,
  setupNav,
  setupPasswordToggles
} from "../../shared.js";

document.addEventListener("DOMContentLoaded", async () => {
  ensureState();
  await hydrateStateFromFirebase();
  setupNav();
  setupPasswordToggles();
  renderLessonsPage();
});

function renderLessonsPage() {
  const state = getState();
  const user = getCurrentUser(state);
  const picker = document.querySelector("[data-lessons-class-picker]");
  const feed = document.querySelector("[data-lessons-feed]");
  const title = document.querySelector("[data-lessons-class-title]");
  if (!feed) return;

  if (!user) {
    if (picker) picker.innerHTML = "";
    if (title) title.textContent = "Lessons";
    feed.innerHTML = `
      <div class="empty-lessons">
        <strong>Please log in.</strong>
        <p class="muted">Log in to see your class lessons.</p>
      </div>
    `;
    return;
  }

  const myClasses = state.classes.filter(
    (klass) => Array.isArray(klass.students) && klass.students.includes(user.id)
  );

  if (!myClasses.length) {
    if (picker) picker.innerHTML = "";
    if (title) title.textContent = "Lessons";
    feed.innerHTML = `
      <div class="empty-lessons">
        <strong>You haven't joined a class yet.</strong>
        <p class="muted">Join a class first to see its lessons.</p>
      </div>
    `;
    return;
  }

  if (!state.activeClassId || !myClasses.some((klass) => klass.id === state.activeClassId)) {
    state.activeClassId = myClasses[0].id;
    // Local-only — matches the join-class flow, which also skips the full
    // saveState()/Firestore sync for this kind of change. A student isn't
    // allowed to batch-write the whole classes collection the way an admin
    // can (see firestore.rules), so this stays a local preference only.
    saveLocalState(state);
  }

  const activeClass = myClasses.find((klass) => klass.id === state.activeClassId) || myClasses[0];

  if (picker) {
    picker.innerHTML = myClasses.length > 1
      ? myClasses.map((klass) => `
          <button class="btn ${klass.id === activeClass.id ? "primary" : "ghost"}" type="button" data-select-class="${escapeHtml(klass.id)}">
            ${escapeHtml(klass.name)} / ${escapeHtml(klass.section)}
          </button>
        `).join("")
      : "";

    picker.querySelectorAll("[data-select-class]").forEach((button) => {
      button.addEventListener("click", () => {
        const nextState = getState();
        nextState.activeClassId = button.dataset.selectClass;
        saveLocalState(nextState);
        renderLessonsPage();
      });
    });
  }

  if (title) title.textContent = `${activeClass.name} ${activeClass.section} Lessons`;

  renderPostFeed(feed, getClassPosts(activeClass));
}
