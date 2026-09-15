import { auth, getLessonsForClass } from "../../services/firebase-service.js";
import { getSecureFileUrl } from "../../services/supabase-service.js";
import {
  ensureState,
  escapeHtml,
  getActiveClass,
  getCurrentUser,
  getState,
  hydrateStateFromFirebase,
  initPageAnimations,
  requireAuth,
  saveState,
  setupNav,
  setupPasswordToggles
} from "../../services/shared.js";

// Episode One's task list. Edit this array to change what shows up in the
// checklist — the episode is marked "Done" once every task here is checked.
const EPISODE_ZERO_TASKS = [
  { id: "play-level", label: "Play through the in-game challenge" },
  { id: "reflection", label: "Answer the reflection question in-game" },
  { id: "done-ep0", label: "Done Ep 0: Cyber Security Attack Tutorial" }
];

const EPISODE_ZERO_TASK_POINTS = {
  "play-level": 50,
  "reflection": 50,
  "done-ep0": 50
};

document.addEventListener("DOMContentLoaded", async () => {
  ensureState();
  const authUser = await requireAuth("../login/");
  if (!authUser) return;
  await hydrateStateFromFirebase();
  setupNav();
  setupPasswordToggles();
  setupEpisodeChecklist();
  setupLessonModal();
  renderLocalLessonList();
  renderLessonTaskList();
  initPageAnimations();
  setupUnityLaunch(); // ~70MB build: only fetched once the student clicks Load game
});

function setupUnityLaunch() {
  const launchButton = document.querySelector("[data-unity-launch-button]");
  const launchPanel = document.querySelector("[data-unity-launch]");
  const loadingPanel = document.querySelector("[data-unity-loading]");
  if (!launchButton) return;
  launchButton.addEventListener("click", () => {
    launchButton.disabled = true;
    if (launchPanel) launchPanel.hidden = true;
    if (loadingPanel) loadingPanel.hidden = false;
    loadUnityGame();
  }, { once: true });
}

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
  EPISODE_ZERO_TASKS.forEach((task) => {
    tasks[task.id] = Boolean(stored[task.id]);
  });
  return tasks;
}

function renderTaskList() {
  const state = getState();
  const taskListRoot = document.querySelector("[data-task-list]");
  const tasks = getEpisodeProgress(state);

  const taskMarkup = (task) => `
    <li class="${tasks[task.id] ? "done" : ""}">
      <input type="checkbox" id="task-${task.id}" data-task-checkbox="${task.id}" ${tasks[task.id] ? "checked" : ""} />
      <label for="task-${task.id}"><span>${task.label}</span></label>
    </li>
  `;

  taskListRoot.innerHTML = `${taskMarkup(EPISODE_ZERO_TASKS[0])}
    <li class="lesson-inline-section">
      <p class="lesson-section-label">Lesson Files</p>
      <ul class="task-list lesson-task-list" data-local-lesson-list>
        <li class="muted">Loading files&hellip;</li>
      </ul>
    </li>
    ${taskMarkup(EPISODE_ZERO_TASKS[1])}
    ${taskMarkup(EPISODE_ZERO_TASKS[2])}
    <li class="lesson-inline-section">
      <p class="lesson-section-label">Uploaded Files</p>
      <ul class="task-list lesson-task-list" data-lesson-task-list>
        <li class="muted">Loading uploads&hellip;</li>
      </ul>
    </li>`;

  taskListRoot.querySelectorAll("[data-task-checkbox]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      setTaskComplete(checkbox.dataset.taskCheckbox, checkbox.checked);
    });
  });

  updateEpisodeStatus(tasks);
}

function awardTaskPoints(taskId, complete) {
  const state = getState();
  const user = getCurrentUser(state);
  const klass = getActiveClass(state);
  if (!user || !klass || !complete) return;

  const task = EPISODE_ZERO_TASKS.find((entry) => entry.id === taskId);
  const points = task ? Number(EPISODE_ZERO_TASK_POINTS[task.id] || 0) : 0;
  if (!points) return;

  klass.scores = klass.scores || {};
  const previousScore = Number(klass.scores[user.id] || 0);
  const nextScore = previousScore + points;
  klass.scores[user.id] = nextScore;

  if (!klass.modules || typeof klass.modules !== "object") {
    klass.modules = {};
  }
  klass.modules.phishing = klass.modules.phishing || {};

  const tasks = getEpisodeProgress(state);
  klass.modules.phishing.complete = EPISODE_ZERO_TASKS.every((entry) => tasks[entry.id]);
  saveState(state);
}

function setTaskComplete(taskId, complete) {
  const state = getState();
  const user = getCurrentUser(state);
  if (!user) return;

  user.taskProgress = user.taskProgress || {};
  user.taskProgress.episode1 = user.taskProgress.episode1 || { tasks: {} };
  user.taskProgress.episode1.tasks = user.taskProgress.episode1.tasks || {};

  const previousValue = Boolean(user.taskProgress.episode1.tasks[taskId]);
  user.taskProgress.episode1.tasks[taskId] = complete;

  const tasks = getEpisodeProgress(state);
  user.taskProgress.episode1.complete = EPISODE_ZERO_TASKS.every((task) => tasks[task.id]);

  const klass = getActiveClass(state);
  if (klass) {
    klass.modules = klass.modules || {};
    klass.modules.phishing = klass.modules.phishing || {};
    klass.modules.phishing.complete = EPISODE_ZERO_TASKS.every((task) => tasks[task.id]);
  }

  if (complete && !previousValue) {
    awardTaskPoints(taskId, true);
  }

  saveState(state);
  renderTaskList();
}

function showCongratulationPopup(score) {
  const total = Number(score || 0);
  let popup = document.querySelector("[data-cyberguard-score-popup]");

  if (!popup) {
    popup = document.createElement("div");
    popup.setAttribute("data-cyberguard-score-popup", "true");
    popup.style.position = "fixed";
    popup.style.right = "20px";
    popup.style.bottom = "20px";
    popup.style.maxWidth = "360px";
    popup.style.padding = "18px 20px";
    popup.style.borderRadius = "14px";
    popup.style.background = "rgba(15, 20, 26, 0.96)";
    popup.style.border = "1px solid rgba(255,255,255,0.18)";
    popup.style.boxShadow = "0 18px 45px rgba(0, 0, 0, 0.42)";
    popup.style.color = "#fff";
    popup.style.zIndex = "4000";
    popup.style.fontFamily = "system-ui, sans-serif";
    popup.style.display = "none";

    const title = document.createElement("div");
    title.textContent = "🎉 Congrats!";
    title.style.fontSize = "1.1rem";
    title.style.fontWeight = "700";
    title.style.marginBottom = "8px";

    const body = document.createElement("div");
    body.setAttribute("data-score-body", "true");
    body.style.fontSize = "0.96rem";
    body.style.lineHeight = "1.5";
    body.style.color = "rgba(255,255,255,0.9)";

    const value = document.createElement("strong");
    value.setAttribute("data-score-value", "true");
    value.style.fontSize = "1.4rem";
    value.style.display = "inline-block";
    value.style.marginTop = "4px";
    value.style.color = "#9ae6b4";

    body.appendChild(document.createTextNode("You completed the tutorial and earned "));
    body.appendChild(value);
    body.appendChild(document.createTextNode(" points."));

    popup.append(title, body);
    document.body.appendChild(popup);
  }

  const scoreValue = popup.querySelector("[data-score-value]");
  if (scoreValue) scoreValue.textContent = `${total}`;

  popup.style.display = "block";
  clearTimeout(popup.__hideTimer);
  popup.__hideTimer = setTimeout(() => {
    popup.style.display = "none";
  }, 4000);
}

function applyIncomingScore(score) {
  const state = getState();
  const user = getCurrentUser(state);
  const klass = getActiveClass(state);
  if (!user || !klass) return false;

  const incomingValue = Number(score);
  if (!Number.isFinite(incomingValue) || incomingValue < 0) return false;

  klass.scores = klass.scores || {};
  const previousValue = Number(klass.scores[user.id] || 0);
  const nextValue = Math.max(previousValue, incomingValue);
  klass.scores[user.id] = nextValue;

  saveState(state);
  showCongratulationPopup(nextValue);
  return true;
}

const RING_CIRCUMFERENCE = 2 * Math.PI * 15.5;

function updateEpisodeStatus(tasks) {
  const episodeItem = document.querySelector("[data-episode='episode1']");
  const statusEl = document.querySelector("[data-episode-status]");
  const ringFill = document.querySelector("[data-ring-fill]");
  if (!episodeItem || !statusEl) return;

  const total = EPISODE_ZERO_TASKS.length;
  const completedCount = EPISODE_ZERO_TASKS.filter((task) => tasks[task.id]).length;
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

// Files shipped with the project and kept in /Docs are shown in the first
// lesson section. Uploaded class files are rendered separately below.
const LOCAL_LESSON_FALLBACK = [
  {
    id: "local-what-is-phishing-1",
    name: "What is Phishing",
    type: "DOCX",
    url: "../../Docs/What-is-Phishing-1.docx"
  }
];

function renderLocalLessonList() {
  const listRoot = document.querySelector("[data-local-lesson-list]");
  if (!listRoot) return;

  listRoot.innerHTML = LOCAL_LESSON_FALLBACK.map((lesson) => `
    <li class="lesson-task" data-local-lesson-task="${escapeHtml(lesson.id)}">
      <button class="lesson-task-row" type="button" data-local-lesson-toggle="${escapeHtml(lesson.id)}">
        <span class="lesson-task-icon">${escapeHtml(lesson.type || "FILE")}</span>
        <span>${escapeHtml(lesson.name)}</span>
        <span class="lesson-task-chevron">▾</span>
      </button>
    </li>
  `).join("");

  LOCAL_LESSON_FALLBACK.forEach((lesson) => {
    const row = listRoot.querySelector(`[data-local-lesson-toggle="${cssEscape(lesson.id)}"]`);
    row?.addEventListener("click", () => openLessonModal(lesson));
  });
}

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
    listRoot.innerHTML = `<li class="muted">No uploaded files yet.</li>`;
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

  if (!modal || !body) return;

  if (title) title.textContent = lesson.name || "Document";
  if (icon) icon.textContent = lesson.type || "FILE";

  body.innerHTML = "<p class=\"muted\">Loading preview&hellip;</p>";
  modal.hidden = false;

  let source = lesson.dataUrl || lesson.url;
  if (lesson.storageProvider === "supabase" && lesson.storagePath) {
    try {
      source = await getSecureFileUrl(lesson.storagePath, auth.currentUser);
    } catch (error) {
      console.error("CyberGuard: could not get lesson download URL", error);
      body.innerHTML = "<p class=\"lesson-unavailable\">Could not load this file. Please try again.</p>";
      return;
    }
  }
  if (openNewButton) {
    openNewButton.href = source || "#";
    openNewButton.toggleAttribute("hidden", !source);
  }

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
    const normalized = String(taskId || "").trim().toLowerCase();
    if (!normalized) return;

    if (normalized === "episode0" || normalized === "tutorial" || normalized === "tutorial-complete" || normalized === "done-ep0" || normalized === "ep0-complete") {
      window.CyberGuardBridge.completeEpisode0();
      return;
    }

    setTaskComplete(normalized, true);
  },
  uncompleteTask(taskId) {
    setTaskComplete(String(taskId || "").trim().toLowerCase(), false);
  },
  setScore(score) {
    applyIncomingScore(score);
  },
  finishEpisode(score) {
    const finalScore = typeof score === "number" ? score : Number(score || 0);
    window.CyberGuardBridge.completeEpisode0(finalScore);
  },
  completeEpisode0(score) {
    EPISODE_ZERO_TASKS.forEach((task) => setTaskComplete(task.id, true));
    if (Number.isFinite(Number(score)) && Number(score) >= 0) {
      applyIncomingScore(score);
    } else {
      const fallback = EPISODE_ZERO_TASKS.reduce((sum, task) => sum + (EPISODE_ZERO_TASK_POINTS[task.id] || 0), 0);
      applyIncomingScore(fallback);
    }
  }
};

window.addEventListener("message", (event) => {
  const payload = event?.data;
  if (!payload || typeof payload !== "object") return;

  const rawScore = payload.score ?? payload.points ?? payload.totalScore ?? payload.finalScore;
  const taskId = payload.taskId ?? payload.task ?? payload.stage;

  if (typeof rawScore !== "undefined") {
    if (taskId === "play-level" || taskId === "reflection" || taskId === "done-ep0" || taskId === "episode0") {
      window.CyberGuardBridge.completeTask(taskId);
    }
    applyIncomingScore(rawScore);
  }

  if (taskId && (taskId === "episode0" || taskId === "tutorial" || taskId === "done-ep0" || taskId === "ep0-complete")) {
    window.CyberGuardBridge.completeEpisode0(rawScore);
  }
});

window.CyberGuardBridge.completeEpisode0 = function completeEpisode0(score) {
  EPISODE_ZERO_TASKS.forEach((task) => setTaskComplete(task.id, true));
  if (Number.isFinite(Number(score)) && Number(score) >= 0) {
    applyIncomingScore(score);
  } else {
    const fallback = EPISODE_ZERO_TASKS.reduce((sum, task) => sum + (EPISODE_ZERO_TASK_POINTS[task.id] || 0), 0);
    applyIncomingScore(fallback);
  }
};

