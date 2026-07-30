import {
  ensureState,
  escapeHtml,
  getActiveClass,
  getClassPosts,
  getCurrentUser,
  getState,
  hydrateStateFromFirebase,
  isAllowedLessonFile,
  renderPostFeed,
  saveState,
  setupNav,
  setupPasswordToggles,
  showToast
} from "../../shared.js";

import { addClassPost } from "../../firebase-service.js";
import { isGithubConfigured, uploadLessonFileToGithub } from "../../github-service.js";

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

  setupClassPage(currentUser);
});

function setupClassPage(currentUser) {
  renderClassSelector();
  setupComposeForm(currentUser);
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

function setupComposeForm(currentUser) {
  const form = document.querySelector("[data-compose-form]");
  const fileInput = document.querySelector("[data-compose-file]");
  const fileNameLabel = document.querySelector("[data-compose-file-name]");
  const submitButton = document.querySelector("[data-compose-submit]");
  if (!form || !fileInput || !submitButton) return;

  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file) {
      fileNameLabel.textContent = "No file selected";
      return;
    }
    if (!isAllowedLessonFile(file)) {
      showToast("Only PDF, DOCX, PPT, and PPTX files are allowed.");
      fileInput.value = "";
      fileNameLabel.textContent = "No file selected";
      return;
    }
    fileNameLabel.textContent = file.name;
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const state = getState();
    const klass = getActiveClass(state);
    if (!klass) {
      showToast("Select a class first.");
      return;
    }

    const messageInput = document.querySelector("[data-compose-message]");
    const message = messageInput.value.trim();
    const file = fileInput.files?.[0] || null;

    if (!message && !file) {
      showToast("Write an announcement or attach a file first.");
      return;
    }
    if (file && !isAllowedLessonFile(file)) {
      showToast("Only PDF, DOCX, PPT, and PPTX files are allowed.");
      return;
    }
    if (file && !isGithubConfigured()) {
      showToast("GitHub upload isn't configured yet — add a token to github-config.js.");
      return;
    }

    submitButton.disabled = true;
    submitButton.textContent = file ? "Uploading file…" : "Posting…";

    try {
      let attachment = null;
      if (file) {
        attachment = await uploadLessonFileToGithub(file, klass.id);
      }

      const post = {
        id: `post-${Date.now()}`,
        authorId: currentUser.id,
        authorName: `${currentUser.firstName} ${currentUser.lastName}`.trim(),
        message,
        attachment,
        createdAt: new Date().toISOString()
      };

      // Awaited, targeted write — the "Posted" toast below only fires once
      // Firestore has actually confirmed the save, unlike the old upload
      // flow where the success message showed regardless of whether the
      // background sync worked.
      await addClassPost(klass.id, post);

      const freshState = getState();
      const freshClass = freshState.classes.find((item) => item.id === klass.id);
      if (freshClass) {
        freshClass.posts = Array.isArray(freshClass.posts) ? freshClass.posts : [];
        freshClass.posts.push(post);
        saveState(freshState);
      }

      form.reset();
      fileNameLabel.textContent = "No file selected";
      renderClassSelector();
      showToast("Posted to the class feed.");
    } catch (error) {
      console.error("CyberGuard: failed to post lesson", error);
      showToast(error?.message || "Couldn't post. Please try again.");
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "Post";
    }
  });
}

function renderLessonPanel(klass) {
  const title = document.querySelector("[data-lesson-title]");
  const selectedClass = document.querySelector("[data-selected-class]");
  const lessonList = document.querySelector("[data-lesson-list]");
  const composeForm = document.querySelector("[data-compose-form]");
  if (title) title.textContent = klass ? `${klass.name} Lessons` : "Choose A Class";
  if (!lessonList || !selectedClass) return;

  if (!klass) {
    selectedClass.innerHTML = "";
    lessonList.innerHTML = `<p class="muted">Select or create a class before posting lessons.</p>`;
    if (composeForm) composeForm.style.display = "none";
    return;
  }

  if (composeForm) composeForm.style.display = "";
  selectedClass.innerHTML = `
    <strong>${escapeHtml(klass.name)}</strong>
    <span>${escapeHtml(klass.section)} / ${escapeHtml(klass.code)}</span>
  `;

  renderPostFeed(lessonList, getClassPosts(klass));
}
