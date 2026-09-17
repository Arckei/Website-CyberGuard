import { auth, subscribeToClass, updateClassScore } from "../../services/firebase-service.js";
import {
  ensureState,
  escapeHtml,
  getActiveClass,
  getCurrentUser,
  getState,
  hydrateStateFromFirebase,
  initPageAnimations,
  requireAuth,
  saveLocalState,
  saveState,
  setupNav,
  setupPasswordToggles
} from "../../services/shared.js";

// Episode Zero's task list. Edit this array to change what shows up in the
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
  setupEpisodeTabs();
  setupLessonModal();
  renderLocalLessonList();
  renderLessonTaskList();
  initPageAnimations();
  setupRealtimeClassSync();
  setupUnityLaunch();
});

function setupRealtimeClassSync() {
  const state = getState();
  const klass = getActiveClass(state);
  if (!klass) return;

  subscribeToClass(klass.id, (remoteClass) => {
    const nextState = getState();
    const localClass = nextState.classes.find((item) => item.id === remoteClass.id);
    if (localClass) Object.assign(localClass, remoteClass);
    else nextState.classes.push(remoteClass);

    saveLocalState(nextState);
    updateEpisodeScore();
    renderTaskList();
  });
}

function setupUnityLaunch() {
  const loadingPanel = document.querySelector("[data-unity-loading]");
  if (loadingPanel) loadingPanel.hidden = false;
  // Select only — don't auto-download. This used to pass `true`, which
  // started a ~76 MB download the moment anyone opened the page, even though
  // the panel says "Select an episode and download the game to start" and
  // there's an explicit Download button right below it.
  selectEpisode("episode0", false);
}

function setupEpisodeTabs() {
  document.querySelectorAll("[data-episode-select]").forEach((button) => {
    // Loads immediately on click. This is safe even while another episode is
    // still downloading, because loadUnityGame() drops the previous iframe and
    // the browser cancels that build's in-flight requests with it.
    button.addEventListener("click", () => selectEpisode(button.dataset.episodeSelect, true));
  });
  document.querySelector("[data-unity-download]")?.addEventListener("click", () => startEpisode(selectedEpisode));
  document.querySelector("[data-demo-task]")?.addEventListener("change", (event) => {
    event.target.closest(".demo-task")?.classList.toggle("done", event.target.checked);
  });
}

let selectedEpisode = "episode0";

function selectEpisode(episode, loadGame = false) {
  selectedEpisode = episode;
  const config = UNITY_EPISODES[episode];
  if (!config) return;

  document.querySelectorAll("[data-episode]").forEach((item) => {
    item.classList.toggle("active", item.dataset.episode === episode);
  });

  const title = document.querySelector("[data-game-title]");
  if (title) title.textContent = config.title;

  const taskPanel = document.querySelector("[data-episode-tasks]");
  if (taskPanel) taskPanel.hidden = episode !== "episode0";
  const demoTasks = document.querySelector("[data-episode-demo-tasks]");
  if (demoTasks) demoTasks.hidden = episode !== "episode1";
  const downloadSize = document.querySelector("[data-unity-download-size]");
  if (downloadSize) downloadSize.textContent = config.size;
  const downloadButton = document.querySelector("[data-unity-download]");
  if (downloadButton) {
    downloadButton.disabled = false;
    downloadButton.classList.remove("loading");
    downloadButton.textContent = `Download ${config.title} `;
    const size = document.createElement("span");
    size.textContent = config.size;
    downloadButton.appendChild(size);
  }
  setUnityLoadingText(`${config.title} is loading. The first visit downloads ${config.size}.`);
  if (loadGame) loadUnityGame(episode, document.querySelector("[data-unity-download]"));
}

function startEpisode(episode) {
  selectEpisode(episode);
  const button = document.querySelector("[data-unity-download]");
  if (button) {
    button.disabled = true;
    button.classList.add("loading");
    button.innerHTML = "Downloading&hellip; <span>Please wait</span>";
  }
  loadUnityGame(episode, button);
}

// ---------------- Episode Zero checklist ----------------

function setupEpisodeChecklist() {
  const toggle = document.querySelector("[data-episode='episode0'] [data-episode-toggle]");
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
  updateEpisodeScore(nextScore);

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

  saveLocalState(state);
  updateClassScore(klass.id, nextValue).catch((error) => {
    console.warn("[CyberGuard] Game score sync failed:", error);
  });
  updateEpisodeScore(nextValue);
  showCongratulationPopup(nextValue);
  return true;
}

function updateEpisodeScore(score = null) {
  const scoreEl = document.querySelector("[data-episode-score]");
  if (!scoreEl) return;

  if (score === null) {
    const state = getState();
    const user = getCurrentUser(state);
    const klass = getActiveClass(state);
    score = user && klass ? Number(klass.scores?.[user.id] || 0) : 0;
  }

  scoreEl.textContent = `${Math.max(0, Number(score) || 0)} pts`;
}

const RING_CIRCUMFERENCE = 2 * Math.PI * 15.5;

function updateEpisodeStatus(tasks) {
  const episodeItem = document.querySelector("[data-episode='episode0']");
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
  updateEpisodeScore();
}

// ---------------- Lesson files (inside Episode Zero) ----------------
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
    url: "../../Docs/Ep 0/What-is-Phishing-1.docx"
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

  listRoot.innerHTML = `<li class="muted">No uploaded files available locally.</li>`;
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

const UNITY_EPISODES = {
  episode0: {
    title: "Episode 0",
    pageUrl: "./Ep 0/index.html",
    buildUrl: "./Ep 0/Build",
    buildName: "CyberGuard Ep0 v1.02",
    size: "76.0 MB"
  },
  episode1: {
    title: "Episode 1",
    pageUrl: "./Ep 1/index.html",
    buildUrl: "./Ep 1/Build",
    buildName: "CyberGuard Ep1 v1.00",
    size: "77.5 MB"
  }
};

let unityInstance = null;
let unityLoadRequest = 0;

function setUnityLoadingText(text) {
  const loadingText = document.querySelector("[data-unity-loading-text]");
  if (loadingText) loadingText.textContent = text;
}

// Each episode runs inside its OWN iframe pointing at that build's Unity
// index.html. This matters: Unity WebGL keeps a lot of state on `window`
// (createUnityInstance, the WASM heap, audio context, input handlers) and does
// not support tearing one instance down and standing another up in the same
// JS context. Swapping the iframe hands the whole old context to the browser
// to destroy, so you can jump to Episode 1 at any time — including while
// Episode 0 is still mid-download — and the new build always starts clean.
function loadUnityGame(episode = "episode0", downloadButton = null) {
  const requestId = ++unityLoadRequest;
  const episodeConfig = UNITY_EPISODES[episode] || UNITY_EPISODES.episode0;
  const embed = document.querySelector("[data-unity-embed]");
  const progressFill = document.querySelector("[data-unity-progress]");
  const fullscreenButton = document.querySelector("[data-unity-fullscreen]");
  if (!embed) return;

  // Dropping the old iframe cancels any download still in flight for the
  // previous episode — no lingering runtime, no half-loaded build.
  embed.querySelectorAll("[data-unity-frame]").forEach((frame) => frame.remove());
  unityInstance = null;
  window.CyberGuardUnityInstance = null;
  embed.classList.remove("loaded");
  if (progressFill) progressFill.style.width = "0%";

  const frame = document.createElement("iframe");
  frame.dataset.unityFrame = episode;
  frame.title = `${episodeConfig.title} game`;
  frame.allow = "autoplay; fullscreen; gamepad; cross-origin-isolated";
  frame.allowFullscreen = true;
  frame.src = episodeConfig.pageUrl;

  frame.addEventListener("load", () => {
    if (requestId !== unityLoadRequest) return;
    // Unity's own template renders its loading bar inside the frame, so the
    // outer panel steps aside once the frame is up.
    embed.classList.add("loaded");
    if (downloadButton) {
      downloadButton.disabled = false;
      downloadButton.classList.remove("loading");
      downloadButton.innerHTML = `Restart ${episodeConfig.title} <span>Cached</span>`;
    }
  });

  frame.addEventListener("error", () => {
    if (requestId !== unityLoadRequest) return;
    if (downloadButton) {
      downloadButton.disabled = false;
      downloadButton.classList.remove("loading");
      downloadButton.innerHTML = `Try Again <span>${episodeConfig.size}</span>`;
    }
    setUnityLoadingText("The game failed to load. Please try again.");
  });

  embed.appendChild(frame);

  if (fullscreenButton) {
    fullscreenButton.onclick = () => {
      const target = embed.querySelector("[data-unity-frame]");
      if (target?.requestFullscreen) target.requestFullscreen();
    };
  }
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

function normalizeTaskId(value) {
  return String(value ?? "").trim().toLowerCase();
}

function handleTaskCompletion(taskId, completed = true) {
  const normalized = normalizeTaskId(taskId);
  if (!normalized || !completed) return;

  if (normalized === "play-level" || normalized === "reflection" || normalized === "done-ep0" || normalized === "episode0" || normalized === "tutorial" || normalized === "tutorial-complete" || normalized === "ep0-complete") {
    window.CyberGuardBridge.completeTask(normalized);
  }
}

function handleGameScoreMessage(payload) {
  if (typeof payload === "number" || typeof payload === "string") {
    applyIncomingScore(payload);
    return;
  }
  if (!payload || typeof payload !== "object") return;

  const message = payload.data && typeof payload.data === "object" ? payload.data : payload;
  const type = String(message.type ?? payload.type ?? "").trim().toLowerCase();
  const rawScore = message.score ?? message.points ?? message.totalScore ?? message.finalScore;
  const taskId = normalizeTaskId(message.taskId ?? message.task ?? message.stage ?? message.id ?? message.name ?? "");
  const completed =
    message.completed ??
    message.isComplete ??
    message.success ??
    message.resolved ??
    ((message.status === "resolved" || message.status === "complete") ||
    type === "cyberguard:task");

  if (taskId && completed) {
    handleTaskCompletion(taskId, true);
  }

  if (typeof rawScore === "undefined") {
    if (taskId && completed && (taskId === "episode0" || taskId === "tutorial" || taskId === "done-ep0" || taskId === "ep0-complete")) {
      window.CyberGuardBridge.completeEpisode0();
    }
    return;
  }

  if (taskId === "play-level" || taskId === "reflection" || taskId === "done-ep0" || taskId === "episode0") {
    window.CyberGuardBridge.completeTask(taskId);
  }
  applyIncomingScore(rawScore);

  if (taskId === "episode0" || taskId === "tutorial" || taskId === "done-ep0" || taskId === "ep0-complete") {
    window.CyberGuardBridge.completeEpisode0(rawScore);
  }
}

window.addEventListener("message", (event) => {
  handleGameScoreMessage(event?.data);
});

window.addEventListener("cyberguard:score", (event) => {
  console.log("CyberGuard: caught cyberguard:score event", event?.detail);
  handleGameScoreMessage(event?.detail);
});

window.addEventListener("cyberguard:task", (event) => {
  const detail = event?.detail ?? event?.data ?? {};
  const taskId = normalizeTaskId(detail.taskId ?? detail.task ?? detail.id ?? detail.name ?? "");
  const completed = detail.completed ?? detail.isComplete ?? detail.success ?? detail.resolved ?? true;
  console.log("CyberGuard: task event received", detail, taskId, completed);
  if (taskId && completed) {
    handleTaskCompletion(taskId, true);
  }
});

window.CyberGuardBridge.receiveScore = (score) => {
  console.log("CyberGuard: receiveScore called with", score);
  handleGameScoreMessage(score);
};

window.CyberGuardBridge.receiveTask = (taskId, completed = true) => {
  console.log("CyberGuard: receiveTask called with", taskId, completed);
  handleTaskCompletion(taskId, completed);
};

window.CyberGuardBridge.receiveGameEvent = (payload) => {
  console.log("CyberGuard: receiveGameEvent called with", payload);
  handleGameScoreMessage(payload);
};

window.CyberGuardBridge.getScore = () => {
  const state = getState();
  const user = getCurrentUser(state);
  const klass = getActiveClass(state);
  return user && klass ? Number(klass.scores?.[user.id] || 0) : 0;
};

window.dispatchEvent(new CustomEvent("cyberguard:bridge-ready"));

window.CyberGuardBridge.completeEpisode0 = function completeEpisode0(score) {
  EPISODE_ZERO_TASKS.forEach((task) => setTaskComplete(task.id, true));
  if (Number.isFinite(Number(score)) && Number(score) >= 0) {
    applyIncomingScore(score);
  } else {
    const fallback = EPISODE_ZERO_TASKS.reduce((sum, task) => sum + (EPISODE_ZERO_TASK_POINTS[task.id] || 0), 0);
    applyIncomingScore(fallback);
  }
};

