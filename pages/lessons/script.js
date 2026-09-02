import { getLessonsForClass } from "../../services/firebase-service.js";
import {
  ensureState,
  escapeHtml,
  getCurrentUser,
  getState,
  hydrateStateFromFirebase,
  renderSkeletonRows,
  requireAuth,
  saveLocalState,
  setupNav,
  setupPasswordToggles
} from "../../services/shared.js";

renderSkeletonRows("[data-lessons-feed]", { count: 3, rowHtml: lessonRowSkeleton });

document.addEventListener("DOMContentLoaded", async () => {
  ensureState();
  const authUser = await requireAuth("../login/");
  if (!authUser) return;
  await hydrateStateFromFirebase();
  setupNav();
  setupPasswordToggles();
  await renderLessonsPage();
});

function lessonRowSkeleton() {
  return `
    <article class="lesson-row skeleton" aria-hidden="true">
      <span class="lesson-type">&nbsp;</span>
      <div>
        <strong>&nbsp;</strong>
        <p class="muted">&nbsp;</p>
      </div>
      <div class="lesson-actions">
        <a class="btn ghost" aria-hidden="true">&nbsp;</a>
      </div>
    </article>
  `;
}

async function renderLessonsPage() {
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
    // Local-only — a student isn't allowed to batch-write the whole classes
    // collection the way an admin can (see firestore.rules), so switching
    // which class you're viewing here stays a local preference only.
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

  feed.innerHTML = Array.from({ length: 3 }, lessonRowSkeleton).join("");

  let lessons = [];
  try {
    lessons = await getLessonsForClass(activeClass.id);
  } catch (error) {
    console.error("CyberGuard: could not load lessons", error);
    feed.innerHTML = `<p class="muted">Could not load lessons. Please refresh.</p>`;
    return;
  }

  feed.innerHTML = lessons.length ? lessons.map((lesson) => `
    <article class="lesson-row">
      <span class="lesson-type">${escapeHtml(lesson.type || "FILE")}</span>
      <div>
        <strong>${escapeHtml(lesson.name)}</strong>
        <p class="muted">${formatFileSize(lesson.size)}</p>
      </div>
      <div class="lesson-actions">
        <a class="btn ghost" href="${lesson.dataUrl}" download="${escapeHtml(lesson.name)}" target="_blank" rel="noopener">View</a>
      </div>
    </article>
  `).join("") : `
    <div class="empty-lessons">
      <strong>No lessons uploaded yet.</strong>
      <p class="muted">Your teacher hasn't added any lessons to this class yet.</p>
    </div>
  `;
}

function formatFileSize(size = 0) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

