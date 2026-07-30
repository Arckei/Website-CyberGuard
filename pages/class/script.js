import {
  ensureState,
  escapeHtml,
  getActiveClass,
  getCurrentUser,
  getState,
  hydrateStateFromFirebase,
  saveState,
  setupNav,
  setupPasswordToggles,
  showToast
} from "../../shared.js";

const ALLOWED_LESSON_TYPES = new Set(["pdf", "docx", "ppt", "pptx"]);

document.addEventListener("DOMContentLoaded", async () => {
  ensureState();
  await hydrateStateFromFirebase();
  setupNav();
  setupPasswordToggles();

  const state = getState();
  const currentUser = getCurrentUser(state);
  if (!currentUser || currentUser.role !== "admin") {
    showToast("Admin access only.");
    window.location.href = "../user/";
    return;
  }

  setupClassPage();
});

function setupClassPage() {
  renderClassSelector();
  setupLessonUpload();
}

function renderClassSelector() {
  const state = getState();
  const selector = document.querySelector("[data-class-selector]");
  const classList = document.querySelector("[data-class-list]");
  if (!selector || !classList) return;

  if (!state.classes.length) {
    selector.innerHTML = `<option value="">No classes yet</option>`;
    classList.innerHTML = `<p class="muted">Create a class first.</p>`;
    renderLessonPanel(null);
    return;
  }

  if (!state.activeClassId || !state.classes.some((klass) => klass.id === state.activeClassId)) {
    state.activeClassId = state.classes[0].id;
    saveState(state);
  }

  selector.innerHTML = state.classes.map((klass) => `
    <option value="${escapeHtml(klass.id)}" ${klass.id === state.activeClassId ? "selected" : ""}>
      ${escapeHtml(klass.name)} / ${escapeHtml(klass.section)}
    </option>
  `).join("");

  classList.innerHTML = state.classes.map((klass) => `
    <button class="class-tab ${klass.id === state.activeClassId ? "active" : ""}" type="button" data-select-class="${escapeHtml(klass.id)}">
      <strong>${escapeHtml(klass.name)}</strong>
      <span>${escapeHtml(klass.section)} / ${escapeHtml(klass.code)}</span>
    </button>
  `).join("");

  selector.onchange = () => selectClass(selector.value);
  classList.querySelectorAll("[data-select-class]").forEach((button) => {
    button.addEventListener("click", () => selectClass(button.dataset.selectClass));
  });

  renderLessonPanel(getActiveClass(state));
}

function selectClass(classId) {
  const state = getState();
  state.activeClassId = classId;
  saveState(state);
  renderClassSelector();
}

function setupLessonUpload() {
  const uploadInput = document.querySelector("[data-lesson-upload]");
  if (!uploadInput) return;

  uploadInput.addEventListener("change", () => {
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

    klass.lessons = Array.isArray(klass.lessons) ? klass.lessons : [];
    klass.lessons.push({
      id: `lesson-${Date.now()}`,
      name: file.name,
      type: lessonFileType(file.name),
      size: file.size,
      storagePath: `uploads/${file.name}`,
      uploadedAt: new Date().toISOString()
    });

    saveState(state);
    renderClassSelector();
    showToast("Lesson added to selected class.");
  });
}

function renderLessonPanel(klass) {
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

  const lessons = Array.isArray(klass.lessons) ? klass.lessons : [];
  lessonList.innerHTML = lessons.length ? lessons.map((lesson) => `
    <article class="lesson-row">
      <span class="lesson-type">${escapeHtml(lesson.type || lessonFileType(lesson.name))}</span>
      <div>
        <strong>${escapeHtml(lesson.name)}</strong>
        <p class="muted">${formatFileSize(lesson.size)} / ${escapeHtml(lesson.storagePath || "uploads/")}</p>
      </div>
    </article>
  `).join("") : `
    <div class="empty-lessons">
      <strong>No lessons uploaded yet.</strong>
      <p class="muted">Upload PDF, DOCX, PPT, or PPTX files for this class.</p>
    </div>
  `;
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
