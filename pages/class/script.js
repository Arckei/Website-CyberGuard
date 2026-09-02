import { deleteLessonById, getLessonsForClass, uploadLesson } from "../../services/firebase-service.js";
import {
  ensureState,
  escapeHtml,
  getActiveClass,
  getCurrentUser,
  getState,
  hydrateStateFromFirebase,
  requireAuth,
  saveState,
  setupNav,
  setupPasswordToggles,
  showToast
} from "../../services/shared.js";

const ALLOWED_LESSON_TYPES = new Set(["pdf", "docx", "ppt", "pptx"]);

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

  setupClassPage();
});

function setupClassPage() {
  renderClassList();
  setupLessonUpload();
}

function renderClassList() {
  const state = getState();
  const classList = document.querySelector("[data-class-list]");
  if (!classList) return;

  if (!state.classes.length) {
    classList.innerHTML = `<p class="muted">Create a class first.</p>`;
    renderLessonPanel(null);
    return;
  }

  if (!state.activeClassId || !state.classes.some((klass) => klass.id === state.activeClassId)) {
    state.activeClassId = state.classes[0].id;
    saveState(state);
  }

  classList.innerHTML = state.classes.map((klass) => `
    <button class="class-tab ${klass.id === state.activeClassId ? "active" : ""}" type="button" data-select-class="${escapeHtml(klass.id)}">
      <strong>${escapeHtml(klass.name)}</strong>
      <span>${escapeHtml(klass.section)} / ${escapeHtml(klass.code)}</span>
    </button>
  `).join("");

  classList.querySelectorAll("[data-select-class]").forEach((button) => {
    button.addEventListener("click", () => selectClass(button.dataset.selectClass));
  });

  renderLessonPanel(getActiveClass(state));
}

function selectClass(classId) {
  const state = getState();
  state.activeClassId = classId;
  saveState(state);
  renderClassList();
}

function setupLessonUpload() {
  const uploadInput = document.querySelector("[data-lesson-upload]");
  if (!uploadInput) return;

  uploadInput.addEventListener("change", async () => {
    const file = uploadInput.files?.[0];
    uploadInput.value = "";
    if (!file) return;

    const state = getState();
    const klass = getActiveClass(state);
    if (!klass) {
      showToast("Select a class first.");
      return;
    }

    if (!isAllowedLessonFile(file)) {
      showToast("Only PDF, DOCX, PPT, and PPTX files are allowed.");
      return;
    }

    showToast("Uploading lesson\u2026");

    try {
      await uploadLesson(klass.id, file);
      showToast("Lesson added to selected class.");
      renderLessonPanel(klass);
    } catch (error) {
      console.error("CyberGuard: lesson upload failed", error);
      showToast(error?.message || "Could not upload that lesson. Please try again.");
    }
  });
}

async function renderLessonPanel(klass) {
  const title = document.querySelector("[data-lesson-title]");
  const selectedClass = document.querySelector("[data-selected-class]");
  const lessonList = document.querySelector("[data-lesson-list]");
  if (title) title.textContent = klass ? `${klass.name} Lessons` : "Choose A Class";
  if (!lessonList || !selectedClass) return;

  if (!klass) {
    selectedClass.innerHTML = "";
    lessonList.innerHTML = `<p class="muted">Select or create a class before uploading lessons.</p>`;
    return;
  }

  selectedClass.innerHTML = `
    <strong>${escapeHtml(klass.name)}</strong>
    <span>${escapeHtml(klass.section)} / ${escapeHtml(klass.code)}</span>
  `;

  lessonList.innerHTML = `<p class="muted">Loading lessons\u2026</p>`;

  let lessons = [];
  try {
    lessons = await getLessonsForClass(klass.id);
  } catch (error) {
    console.error("CyberGuard: could not load lessons", error);
    lessonList.innerHTML = `<p class="muted">Could not load lessons. Please refresh.</p>`;
    return;
  }

  lessonList.innerHTML = lessons.length ? lessons.map((lesson) => `
    <article class="lesson-row">
      <span class="lesson-type">${escapeHtml(lesson.type || "FILE")}</span>
      <div>
        <strong>${escapeHtml(lesson.name)}</strong>
        <p class="muted">${formatFileSize(lesson.size)}</p>
      </div>
      <div class="lesson-actions">
        <a class="btn ghost" href="${lesson.dataUrl}" download="${escapeHtml(lesson.name)}" target="_blank" rel="noopener">View</a>
        <button class="btn danger" type="button" data-remove-lesson="${escapeHtml(lesson.id)}">Remove</button>
      </div>
    </article>
  `).join("") : `
    <div class="empty-lessons">
      <strong>No lessons uploaded yet.</strong>
      <p class="muted">Upload PDF, DOCX, PPT, or PPTX files for this class.</p>
    </div>
  `;

  lessonList.querySelectorAll("[data-remove-lesson]").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await deleteLessonById(button.dataset.removeLesson);
        showToast("Lesson removed.");
        renderLessonPanel(klass);
      } catch (error) {
        console.error("CyberGuard: could not remove lesson", error);
        showToast("Could not remove that lesson. Please try again.");
        button.disabled = false;
      }
    });
  });
}

function isAllowedLessonFile(file) {
  return ALLOWED_LESSON_TYPES.has(lessonFileType(file.name).toLowerCase());
}

function lessonFileType(fileName = "") {
  return fileName.split(".").pop()?.toUpperCase() || "FILE";
}

function formatFileSize(size = 0) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

