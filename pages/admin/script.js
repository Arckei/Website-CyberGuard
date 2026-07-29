import {
  ensureState,
  escapeHtml,
  fullName,
  getActiveClass,
  getCurrentUser,
  getState,
  hydrateStateFromFirebase,
  renderLeaderboard,
  saveState,
  setupNav,
  setupPasswordToggles,
  showToast
} from "../../shared.js";

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
  renderAdminDashboard();
});

function renderAdminDashboard() {
  const state = getState();
  const klass = getActiveClass(state);
  renderLeaderboard("[data-leaderboard]", state, klass);
  renderAdminStudentList(state, klass);
  renderAdminClassWorkspace(state);
  const tracker = document.querySelector("[data-class-tracker]");
  if (tracker) {
    tracker.textContent = `${state.classes.length} class${state.classes.length === 1 ? "" : "es"} ready`;
  }
}

function renderAdminClassWorkspace(state) {
  const classList = document.querySelector("[data-admin-class-list]");
  const uploadInput = document.querySelector("[data-lesson-upload]");
  const active = getActiveClass(state);

  if (classList) {
    classList.innerHTML = state.classes.length ? state.classes.map((klass) => `
      <button class="class-tab ${klass.id === state.activeClassId ? "active" : ""}" type="button" data-select-class="${klass.id}">
        <strong>${escapeHtml(klass.name)}</strong>
        <span>${escapeHtml(klass.section)} / ${escapeHtml(klass.code)}</span>
      </button>
    `).join("") : `<p class="muted">No classes yet.</p>`;

    classList.querySelectorAll("[data-select-class]").forEach((button) => {
      button.addEventListener("click", () => {
        state.activeClassId = button.dataset.selectClass;
        saveState(state);
        renderAdminDashboard();
      });
    });
  }

  renderLessonPanel(active);

  if (uploadInput && !uploadInput.dataset.bound) {
    uploadInput.dataset.bound = "true";
    uploadInput.addEventListener("change", () => {
      const file = uploadInput.files?.[0];
      uploadInput.value = "";
      if (!file) return;

      const latestState = getState();
      const latestClass = getActiveClass(latestState);
      if (!latestClass) {
        showToast("Create a class first.");
        return;
      }

      if (!isAllowedLessonFile(file)) {
        showToast("Only PDF, DOCX, and PPTX files are allowed.");
        return;
      }

      latestClass.lessons = Array.isArray(latestClass.lessons) ? latestClass.lessons : [];
      latestClass.lessons.push({
        id: `lesson-${Date.now()}`,
        name: file.name,
        type: lessonFileType(file.name),
        size: file.size,
        storagePath: `uploads/${file.name}`,
        uploadedAt: new Date().toISOString()
      });
      saveState(latestState);
      renderAdminDashboard();
      showToast("Lesson added to class list.");
    });
  }
}

function renderLessonPanel(klass) {
  const title = document.querySelector("[data-admin-lesson-title]");
  const lessonList = document.querySelector("[data-admin-lesson-list]");
  if (title) title.textContent = klass ? `${klass.name} Lessons` : "Lessons";
  if (!lessonList) return;

  if (!klass) {
    lessonList.innerHTML = `<p class="muted">Create a class before uploading lessons.</p>`;
    return;
  }

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
      <p class="muted">Upload PDF, DOCX, or PPTX files for the selected class.</p>
    </div>
  `;
}

function isAllowedLessonFile(file) {
  return ["pdf", "docx", "pptx"].includes(lessonFileType(file.name).toLowerCase());
}

function lessonFileType(fileName = "") {
  return fileName.split(".").pop()?.toUpperCase() || "FILE";
}

function formatFileSize(size = 0) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
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
