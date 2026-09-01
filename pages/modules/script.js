import { getLessonsForClass } from "../../firebase-service.js";
import {
  ensureState,
  escapeHtml,
  getActiveClass,
  getCurrentUser,
  getState,
  hideLoadingOverlay,
  hydrateStateFromFirebase,
  requireAuth,
  saveState,
  setupNav,
  setupPasswordToggles,
  showLoadingOverlay
} from "../../shared.js";

showLoadingOverlay();

// Episode One's task list. Edit this array to change what shows up in the
// checklist — the episode is marked "Done" once every task here is checked.
const EPISODE_ONE_TASKS = [
  { id: "watch-intro", label: "Watch the Episode One introduction" },
  { id: "play-level", label: "Play through the in-game challenge" },
  { id: "reflection", label: "Answer the reflection question in-game" }
];

document.addEventListener("DOMContentLoaded", async () => {
  ensureState();
  const authUser = await requireAuth("../login/");
  if (!authUser) return;
  await hydrateStateFromFirebase();
  setupNav();
  setupPasswordToggles();
  setupEpisodeChecklist();
  renderLessonTaskList();
  await hideLoadingOverlay();
  loadUnityGame(); // has its own progress bar, so it loads after the page overlay is gone
});

// ---------------- Episode One checklist ----------------

function setupEpisodeChecklist() {
  const toggle = document.querySelector("[data-episode-toggle]");
  const tasksPanel = document.querySelector("[data-episode-tasks]");
  const taskListRoot = document.querySelector("[data-task-list]");
  if (!toggle || !tasksPanel || !taskListRoot) return;

  toggle.addEventListener("click", () => {
    const isHidden = tasksPanel.hasAttribute("hidden");
    if (isHidden) tasksPanel.removeAttribute("hidden");
    else tasksPanel.setAttribute("hidden", "");
  });

  renderTaskList();
}

function getEpisodeProgress(state) {
  const user = getCurrentUser(state);
  const stored = user?.taskProgress?.episode1?.tasks || {};
  const tasks = {};
  EPISODE_ONE_TASKS.forEach((task) => {
    tasks[task.id] = Boolean(stored[task.id]);
  });
  return tasks;
}

function renderTaskList() {
  const state = getState();
  const taskListRoot = document.querySelector("[data-task-list]");
  const tasks = getEpisodeProgress(state);

  taskListRoot.innerHTML = EPISODE_ONE_TASKS.map((task) => `
    <li class="${tasks[task.id] ? "done" : ""}">
      <input type="checkbox" id="task-${task.id}" data-task-checkbox="${task.id}" ${tasks[task.id] ? "checked" : ""} />
      <label for="task-${task.id}"><span>${task.label}</span></label>
    </li>
  `).join("");

  taskListRoot.querySelectorAll("[data-task-checkbox]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      setTaskComplete(checkbox.dataset.taskCheckbox, checkbox.checked);
    });
  });

  updateEpisodeStatus(tasks);
}

function setTaskComplete(taskId, complete) {
  const state = getState();
  const user = getCurrentUser(state);
  if (!user) return;

  user.taskProgress = user.taskProgress || {};
  user.taskProgress.episode1 = user.taskProgress.episode1 || { tasks: {} };
  user.taskProgress.episode1.tasks = user.taskProgress.episode1.tasks || {};
  user.taskProgress.episode1.tasks[taskId] = complete;

  const tasks = getEpisodeProgress(state);
  user.taskProgress.episode1.complete = EPISODE_ONE_TASKS.every((task) => tasks[task.id]);

  saveState(state);
  renderTaskList();
}

const RING_CIRCUMFERENCE = 2 * Math.PI * 15.5;

function updateEpisodeStatus(tasks) {
  const episodeItem = document.querySelector("[data-episode='episode1']");
  const statusEl = document.querySelector("[data-episode-status]");
  const ringFill = document.querySelector("[data-ring-fill]");
  if (!episodeItem || !statusEl) return;

  const total = EPISODE_ONE_TASKS.length;
  const completedCount = EPISODE_ONE_TASKS.filter((task) => tasks[task.id]).length;
  const progress = total ? completedCount / total : 0;
  const allDone = completedCount === total;

  if (ringFill) {
    ringFill.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - progress));
  }

  episodeItem.classList.toggle("complete", allDone);
  statusEl.textContent = allDone ? "Done" : "In progress";
}

// ---------------- Lesson files (inside Episode One) ----------------
// Rendered like extra task rows. Clicking a row opens a document-viewer
// modal (topbar with file name + close button), similar to how Google
// Classroom/Drive preview attachments. PDFs render natively in an iframe;
// DOCX is converted to plain HTML in the browser (via mammoth.js, loaded
// on demand); other types show a short "can't preview this" note since
// browsers can't render PPT/PPTX natively without a heavier library.
let mammothLoadPromise = null;

// If Firestore can't be reached (offline, no lessons synced for this class
// yet, permission hiccup, etc.), fall back to whatever files are sitting in
// the project's /Docs folder so students still see something instead of an
// empty or broken list. Add one entry here per file placed in /Docs.
const LOCAL_LESSON_FALLBACK = [
  {
    id: "local-what-is-phishing-1",
    name: "What is Phishing",
    type: "DOCX",
    url: "../../Docs/What-is-Phishing-1.docx"
  }
];

async function renderLessonTaskList() {
  const listRoot = document.querySelector("[data-lesson-task-list]");
  if (!listRoot) return;

  const state = getState();
  const klass = getActiveClass(state);
  if (!klass) {
    listRoot.innerHTML = `<li class="muted">Join a class to see lesson files here.</li>`;
    return;
  }

  let lessons = [];
  try {
    lessons = await getLessonsForClass(klass.id);
  } catch (error) {
    console.error("CyberGuard: could not load lessons from Firestore, using local files instead", error);
    lessons = [];
  }

  if (!lessons.length) {
    lessons = LOCAL_LESSON_FALLBACK;
  }

  if (!lessons.length) {
    listRoot.innerHTML = `<li class="muted">No lesson files yet.</li>`;
    return;
  }

  listRoot.innerHTML = lessons.map((lesson) => `
    <li class="lesson-task" data-lesson-task="${escapeHtml(lesson.id)}">
      <button class="lesson-task-row" type="button" data-lesson-toggle="${escapeHtml(lesson.id)}">
        <span class="lesson-task-icon">${escapeHtml(lesson.type || "FILE")}</span>
        <span>${escapeHtml(lesson.name)}</span>
        <span class="lesson-task-chevron">▾</span>
      </button>
    </li>
  `).join("");

  lessons.forEach((lesson) => {
    const row = listRoot.querySelector(`[data-lesson-toggle="${cssEscape(lesson.id)}"]`);
    row?.addEventListener("click", () => openLessonModal(lesson));
  });

  setupLessonModal();
}

function setupLessonModal() {
  const modal = document.querySelector("[data-lesson-modal]");
  const closeButton = document.querySelector("[data-lesson-modal-close]");
  const openNewButton = document.querySelector("[data-lesson-modal-open]");
  const body = document.querySelector("[data-lesson-modal-body]");

  if (!modal) return;

  const closeModal = () => {
    if (body) body.innerHTML = "";
    modal.hidden = true;
  };

  closeButton?.addEventListener("click", closeModal);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeModal();
  });

  if (openNewButton) {
    openNewButton.addEventListener("click", () => {
      modal.hidden = true;
    });
  }
}

async function openLessonModal(lesson) {
  const modal = document.querySelector("[data-lesson-modal]");
  const title = document.querySelector("[data-lesson-modal-title]");
  const icon = document.querySelector("[data-lesson-modal-icon]");
  const openNewButton = document.querySelector("[data-lesson-modal-open]");
  const body = document.querySelector("[data-lesson-modal-body]");
  const source = lesson.dataUrl || lesson.url;

  if (!modal || !body) return;

  if (title) title.textContent = lesson.name || "Document";
  if (icon) icon.textContent = lesson.type || "FILE";
  if (openNewButton) {
    openNewButton.href = source || "#";
    openNewButton.toggleAttribute("hidden", !source);
  }

  body.innerHTML = "<p class=\"muted\">Loading preview&hellip;</p>";
  modal.hidden = false;

  if (!source) {
    body.innerHTML = "<p class=\"muted\">No file available.</p>";
    return;
  }

  const type = (lesson.type || "").toLowerCase();
  if (type === "pdf") {
    body.innerHTML = `<iframe src="${source}" title="${escapeHtml(lesson.name)}"></iframe>`;
    return;
  }

  if (type === "docx") {
    try {
      const mammoth = await loadMammoth();
      const arrayBuffer = lesson.dataUrl
        ? dataUrlToArrayBuffer(lesson.dataUrl)
        : await fetch(source).then((res) => res.arrayBuffer());
      const result = await mammoth.convertToHtml({ arrayBuffer });
      body.innerHTML = `<div class="lesson-doc-preview">${result.value}</div>`;
    } catch (error) {
      console.error("CyberGuard: could not render docx preview", error);
      body.innerHTML = `<p class="lesson-unavailable">Could not preview this document. Use Open in new tab to view it.</p>`;
    }
    return;
  }

  body.innerHTML = `<p class="lesson-unavailable">Preview is not available for ${escapeHtml(lesson.type || "this")} files. Use Open in new tab to download.</p>`;
}

function cssEscape(value) {
  return window.CSS?.escape ? window.CSS.escape(value) : value;
}


function loadMammoth() {
  if (window.mammoth) return Promise.resolve(window.mammoth);
  if (mammothLoadPromise) return mammothLoadPromise;

  mammothLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/mammoth@1.7.0/mammoth.browser.min.js";
    script.onload = () => resolve(window.mammoth);
    script.onerror = () => reject(new Error("Could not load the document previewer."));
    document.body.appendChild(script);
  });

  return mammothLoadPromise;
}

function dataUrlToArrayBuffer(dataUrl) {
  const base64 = dataUrl.split(",")[1] || "";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

// ---------------- Unity WebGL embed ----------------

const UNITY_BUILD_URL = "./game/Build";
const UNITY_LOADER_URL = `${UNITY_BUILD_URL}/Prototype-CyberGuard-0.0.1.loader.js`;
const UNITY_CONFIG = {
  dataUrl: `${UNITY_BUILD_URL}/Prototype-CyberGuard-0.0.1.data`,
  frameworkUrl: `${UNITY_BUILD_URL}/Prototype-CyberGuard-0.0.1.framework.js`,
  codeUrl: `${UNITY_BUILD_URL}/Prototype-CyberGuard-0.0.1.wasm`,
  companyName: "CyberGuard",
  productName: "Prototype CyberGuard",
  productVersion: "0.0.1"
};

function loadUnityGame() {
  const canvas = document.querySelector("#unity-canvas");
  const embed = document.querySelector("[data-unity-embed]");
  const progressFill = document.querySelector("[data-unity-progress]");
  const fullscreenButton = document.querySelector("[data-unity-fullscreen]");
  if (!canvas || !embed) return;

  const script = document.createElement("script");
  script.src = UNITY_LOADER_URL;
  script.onload = () => {
    createUnityInstance(canvas, UNITY_CONFIG, (progress) => {
      if (progressFill) progressFill.style.width = `${Math.round(progress * 100)}%`;
    }).then((unityInstance) => {
      embed.classList.add("loaded");
      window.CyberGuardUnityInstance = unityInstance;

      if (fullscreenButton) {
        fullscreenButton.addEventListener("click", () => unityInstance.SetFullscreen(1));
      }
    }).catch((message) => {
      console.error("CyberGuard: Unity failed to load", message);
      const loadingText = document.querySelector("[data-unity-loading] p");
      if (loadingText) loadingText.textContent = "The game failed to load. Please refresh and try again.";
    });
  };
  document.body.appendChild(script);
}

// ---------------- Bridge for the Unity game ----------------
// The compiled WebGL build here doesn't call back into the page yet — that
// requires a small change *inside the Unity project* (a .jslib plugin +
// a C# call), which can't be done from the compiled build alone. Once that
// plugin exists, Unity can call these functions directly to check off tasks
// automatically as the player completes them in-game, e.g. from C#:
//
//   [System.Runtime.InteropServices.DllImport("__Internal")]
//   private static extern void CyberGuardCompleteTask(string taskId);
//
// and a matching .jslib:
//
//   mergeInto(LibraryManager.library, {
//     CyberGuardCompleteTask: function (taskId) {
//       window.CyberGuardBridge.completeTask(UTF8ToString(taskId));
//     }
//   });
window.CyberGuardBridge = {
  completeTask(taskId) {
    setTaskComplete(taskId, true);
  },
  uncompleteTask(taskId) {
    setTaskComplete(taskId, false);
  }
};

