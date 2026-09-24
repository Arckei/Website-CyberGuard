import { subscribeToClass, subscribeToCurrentUser, updateClassScore } from "../../services/firebase-service.js";
import { installUnityScoreCapture, parseGameScorePayload } from "../../services/game-score.js";
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

// Episode One's task list. Edit this array to change what shows up in the
// checklist — the episode is marked "Done" once every task here is checked.
const EPISODE_ONE_TASKS = [
  { id: "watch-ep1", label: "Done watching Episode 1" },
  { id: "challenge-ep1", label: "Done challenge in Episode 1" }
];

const EPISODE_ONE_TASK_POINTS = {
  "watch-ep1": 75,
  "challenge-ep1": 75
};

// Episode 0 stores its checklist under `taskProgress.episode1` (a leftover
// naming quirk from before the episodes were renumbered — see
// pages/modules/script.js). Episode 1's own progress is kept under
// `taskProgress.episode2` here so it never overwrites Episode 0's saved
// checklist.
const PROGRESS_KEY = "episode2";
const MODULE_KEY = "malware";

// Episode 1's own score, kept separate from Episode 0's — each episode
// used to write into the SAME shared klass.scores[uid] "gameplay" bucket
// via Math.max, which meant whichever episode had the LOWER raw score
// never actually moved the number (Ep0 finishing with 150 then Ep1
// finishing with 90 left the total stuck at 150 — Ep1's points were
// silently swallowed). Each episode now keeps its own best-score-so-far
// under user.episodeScores[EPISODE_KEY], and the two are summed back into
// klass.scores[uid] (see syncCombinedScore) so the class leaderboard and
// the quiz feature's own "scores + quizScores" total still see the full
// combined amount — quiz points are untouched, they live in a completely
// separate klass.quizScores field this code never writes to.
const EPISODE_KEY = "ep1";

document.addEventListener("DOMContentLoaded", async () => {
  ensureState();
  const authUser = await requireAuth("../login/");
  if (!authUser) return;
  await hydrateStateFromFirebase();
  setupNav();
  setupPasswordToggles();
  setupEpisodeChecklist();
  setupLessonModal();
  initPageAnimations();
  setupRealtimeClassSync();
  setupGameScoreCapture();
  setupDownloadButton();
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

function setupGameScoreCapture() {
  installUnityScoreCapture((score, source) => {
    console.log("[CyberGuard] Caught in-game score from", source, score);
    handleEpisodeOneComplete(score);
  });

  subscribeToCurrentUser((remoteUser) => {
    const score = parseGameScorePayload(remoteUser);
    if (score === null) return;
    handleEpisodeOneComplete(score);
  });
}

// Fires once the in-game score write for Episode 1 lands (same
// FirebaseScoreBridge / tutorialScore mechanism Episode 0 uses — see
// services/game-score.js). Always forwards to completeEpisode1 — it used to
// bail out early once every task was already checked off, which is exactly
// why a freshly-caught, higher score sometimes never showed up: the very
// first catch flips both tasks to "done", so every catch after that (a
// replay with a better score, or the same tutorialScore write landing twice)
// got silently ignored before applyIncomingScore ever ran. setTaskComplete
// and applyIncomingScore are both already safe to call repeatedly — they
// no-op once nothing has actually changed — so there's no need to guard here.
function handleEpisodeOneComplete(score) {
  window.CyberGuardBridge.completeEpisode1(score);
}

// ---------------- Episode One checklist ----------------

function setupEpisodeChecklist() {
  const toggle = document.querySelector("[data-episode='ep1'] [data-episode-toggle]");
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
  const stored = user?.taskProgress?.[PROGRESS_KEY]?.tasks || {};
  const tasks = {};
  EPISODE_ONE_TASKS.forEach((task) => {
    tasks[task.id] = Boolean(stored[task.id]);
  });
  return tasks;
}

function renderTaskList() {
  const state = getState();
  const taskListRoot = document.querySelector("[data-task-list]");
  if (!taskListRoot) return;
  const tasks = getEpisodeProgress(state);

  const taskMarkup = (task) => `
    <li class="${tasks[task.id] ? "done" : ""}">
      <input type="checkbox" id="task-${task.id}" data-task-checkbox="${task.id}" ${tasks[task.id] ? "checked" : ""} disabled title="Completed automatically by playing the game — not editable here" />
      <label for="task-${task.id}"><span>${task.label}</span></label>
    </li>
  `;

  taskListRoot.innerHTML = `
    <li class="lesson-inline-section">
      <p class="lesson-section-label">Lesson Files</p>
      <ul class="task-list lesson-task-list" data-local-lesson-list>
        <li class="muted">Loading files&hellip;</li>
      </ul>
    </li>
    ${taskMarkup(EPISODE_ONE_TASKS[0])}
    ${taskMarkup(EPISODE_ONE_TASKS[1])}
    <li class="lesson-inline-section">
      <p class="lesson-section-label">Uploaded Files</p>
      <ul class="task-list lesson-task-list" data-lesson-task-list>
        <li class="muted">No uploaded files available locally.</li>
      </ul>
    </li>`;

  // Checkboxes above are `disabled` — completion is driven entirely by
  // CyberGuardBridge (the actual game finishing a task/episode), never by a
  // student clicking the box themself.

  renderLocalLessonList();

  updateEpisodeStatus(tasks);
}

// Recomputes the combined "current points" (klass.scores[uid]) as the sum
// of every episode's own best score, and pushes that combined number to
// Firestore — this is the SAME field the quiz feature's leaderboard math
// reads as "gameplayScore" (added to quizScores, never touched here) to
// show a student's total. Call this any time an episode's own score changes.
function syncCombinedScore(state, user, klass) {
  const perEpisode = user.episodeScores || {};
  const total = Object.values(perEpisode).reduce((sum, value) => sum + (Number(value) || 0), 0);

  if (klass) {
    klass.scores = klass.scores || {};
    klass.scores[user.id] = total;
    updateClassScore(klass.id, total).catch((error) => {
      console.warn("[CyberGuard] Game score sync failed:", error);
    });
  }

  saveState(state);
}

function awardTaskPoints(taskId, complete) {
  const state = getState();
  const user = getCurrentUser(state);
  const klass = getActiveClass(state);
  if (!user || !complete) return;

  const task = EPISODE_ONE_TASKS.find((entry) => entry.id === taskId);
  const points = task ? Number(EPISODE_ONE_TASK_POINTS[task.id] || 0) : 0;
  if (!points) return;

  user.episodeScores = user.episodeScores || {};
  const previousScore = Number(user.episodeScores[EPISODE_KEY] || 0);
  const nextScore = previousScore + points;
  user.episodeScores[EPISODE_KEY] = nextScore;
  updateEpisodeScore(nextScore);

  if (klass) {
    if (!klass.modules || typeof klass.modules !== "object") {
      klass.modules = {};
    }
    klass.modules[MODULE_KEY] = klass.modules[MODULE_KEY] || {};

    const tasks = getEpisodeProgress(state);
    klass.modules[MODULE_KEY].complete = EPISODE_ONE_TASKS.every((entry) => tasks[entry.id]);
  }

  syncCombinedScore(state, user, klass);
}

function setTaskComplete(taskId, complete) {
  const state = getState();
  const user = getCurrentUser(state);
  if (!user) return;

  user.taskProgress = user.taskProgress || {};
  user.taskProgress[PROGRESS_KEY] = user.taskProgress[PROGRESS_KEY] || { tasks: {} };
  user.taskProgress[PROGRESS_KEY].tasks = user.taskProgress[PROGRESS_KEY].tasks || {};

  const previousValue = Boolean(user.taskProgress[PROGRESS_KEY].tasks[taskId]);
  user.taskProgress[PROGRESS_KEY].tasks[taskId] = complete;

  const tasks = getEpisodeProgress(state);
  user.taskProgress[PROGRESS_KEY].complete = EPISODE_ONE_TASKS.every((task) => tasks[task.id]);

  const klass = getActiveClass(state);
  if (klass) {
    klass.modules = klass.modules || {};
    klass.modules[MODULE_KEY] = klass.modules[MODULE_KEY] || {};
    klass.modules[MODULE_KEY].complete = EPISODE_ONE_TASKS.every((task) => tasks[task.id]);
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

    body.appendChild(document.createTextNode("You completed Episode 1 and earned "));
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
  if (!user) return false;

  const incomingValue = Number(score);
  if (!Number.isFinite(incomingValue) || incomingValue < 0) return false;

  user.episodeScores = user.episodeScores || {};
  const previousValue = Number(user.episodeScores[EPISODE_KEY] || 0);
  const nextValue = Math.max(previousValue, incomingValue);
  const improved = nextValue > previousValue;
  user.episodeScores[EPISODE_KEY] = nextValue;

  updateEpisodeScore(nextValue);

  // Only sync + pop the congrats card when the score actually moved.
  // subscribeToCurrentUser re-fires on every write to the user doc
  // (including the write this function itself just made), so without this
  // guard the SAME tutorialScore value would keep re-triggering a Firestore
  // write and a fresh popup in a loop.
  if (improved) {
    syncCombinedScore(state, user, klass);
    showCongratulationPopup(nextValue);
  } else {
    saveLocalState(state);
  }
  return true;
}

function updateEpisodeScore(score = null) {
  const scoreEl = document.querySelector("[data-episode-score]");
  if (!scoreEl) return;

  if (score === null) {
    const state = getState();
    const user = getCurrentUser(state);
    score = user ? Number(user.episodeScores?.[EPISODE_KEY] || 0) : 0;
  }

  scoreEl.textContent = `Ep 1 Score: ${Math.max(0, Number(score) || 0)}`;
}

const RING_CIRCUMFERENCE = 2 * Math.PI * 15.5;

function updateEpisodeStatus(tasks) {
  const episodeItem = document.querySelector("[data-episode='ep1']");
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
  statusEl.textContent = allDone ? "Done" : "Playing";
  updateEpisodeScore();
}

// ---------------- Lesson files (inside Episode One) ----------------
// Same document-viewer modal as Episode 0: PDFs render in an iframe, DOCX is
// converted to plain HTML via mammoth.js (loaded on demand), other types
// show a short "can't preview this" note.
let mammothLoadPromise = null;

// Files shipped with the project and kept in /Docs are shown in the first
// lesson section. NOTE: encodeURI() — "Ep 1" has a literal space, and an
// unencoded space in a fetch() path isn't reliably resolved once deployed.
const LOCAL_LESSON_FALLBACK = [
  {
    id: "local-what-is-malware-1",
    name: "What is Malware",
    type: "DOCX",
    url: encodeURI("../../Docs/Ep 1/What-is-Malware-1.docx")
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
// This page only ever loads ONE Unity build and never swaps it. That is the
// whole point of splitting Episode 1 onto its own document: Unity WebGL parks
// a lot of state on `window` (createUnityInstance, the WASM heap, the audio
// context, input handlers) and has no supported way to tear one build down and
// start another in the same page. Navigating between episodes hands the old
// context to the browser to destroy, which also cancels any download still in
// flight for the other episode.
const BUILD_URL = "../modules/Ep 1/Build";
const BUILD_NAME = "CyberGuard Ep1 v1.00";
const DOWNLOAD_SIZE = "77.5 MB";

function setupDownloadButton() {
  const button = document.querySelector("[data-unity-download]");
  if (!button) return;
  button.addEventListener("click", () => {
    button.disabled = true;
    button.classList.add("loading");
    button.innerHTML = "Downloading&hellip; <span>Please wait</span>";
    loadUnityGame(button);
  });
}

function setUnityLoadingText(text) {
  const loadingText = document.querySelector("[data-unity-loading-text]");
  if (loadingText) loadingText.textContent = text;
}

function resetButton(button, label) {
  if (!button) return;
  button.disabled = false;
  button.classList.remove("loading");
  button.innerHTML = `${label} <span>${DOWNLOAD_SIZE}</span>`;
}

function loadUnityGame(downloadButton) {
  const canvas = document.querySelector("#unity-canvas");
  const embed = document.querySelector("[data-unity-embed]");
  const progressFill = document.querySelector("[data-unity-progress]");
  const fullscreenButton = document.querySelector("[data-unity-fullscreen]");
  if (!canvas || !embed) return;

  const script = document.createElement("script");
  // The build filenames contain spaces ("CyberGuard Ep1 v1.00.loader.js").
  // encodeURI keeps those from being mangled while leaving the path separators
  // alone — the browser is forgiving here but Unity's own internal fetches for
  // .data/.wasm are not always.
  script.src = encodeURI(`${BUILD_URL}/${BUILD_NAME}.loader.js`);

  script.onload = () => {
    if (typeof createUnityInstance !== "function") {
      console.error("CyberGuard: Unity loader ran but createUnityInstance is missing.");
      resetButton(downloadButton, "Try Again");
      setUnityLoadingText("The game failed to start. Please refresh and try again.");
      return;
    }

    createUnityInstance(canvas, {
      dataUrl: encodeURI(`${BUILD_URL}/${BUILD_NAME}.data`),
      frameworkUrl: encodeURI(`${BUILD_URL}/${BUILD_NAME}.framework.js`),
      codeUrl: encodeURI(`${BUILD_URL}/${BUILD_NAME}.wasm`),
      companyName: "CyberGuard",
      productName: "CyberGuard Episode 1",
      productVersion: "1.0"
    }, (progress) => {
      if (progressFill) progressFill.style.width = `${Math.round(progress * 100)}%`;
    }).then((instance) => {
      embed.classList.add("loaded");
      window.CyberGuardUnityInstance = instance;
      if (downloadButton) {
        downloadButton.disabled = false;
        downloadButton.classList.remove("loading");
        downloadButton.innerHTML = "Restart Episode 1 <span>Cached</span>";
      }
      if (fullscreenButton) fullscreenButton.onclick = () => instance.SetFullscreen(1);
    }).catch((error) => {
      console.error("CyberGuard: Unity failed to load", error);
      resetButton(downloadButton, "Try Again");
      setUnityLoadingText("The game failed to load. Please try again.");
    });
  };

  script.onerror = () => {
    console.error("CyberGuard: could not download the Unity loader for Episode 1.");
    resetButton(downloadButton, "Try Again");
    setUnityLoadingText("The game failed to download. Please check your connection and try again.");
  };

  document.body.appendChild(script);
}

// ---------------- Bridge for the Unity game ----------------
// The compiled WebGL build here doesn't call back into the page yet — that
// requires a small change *inside the Unity project* (a .jslib plugin + a C#
// call). Once that plugin exists, Unity can call these functions directly to
// check off tasks automatically as the player completes them in-game, e.g.
// from C#:
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

    if (["episode1", "ep1", "ep1-complete", "malware", "tutorial", "tutorial-complete"].includes(normalized)) {
      window.CyberGuardBridge.completeEpisode1();
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
    window.CyberGuardBridge.completeEpisode1(finalScore);
  },
  completeEpisode1(score) {
    EPISODE_ONE_TASKS.forEach((task) => setTaskComplete(task.id, true));
    if (Number.isFinite(Number(score)) && Number(score) >= 0) {
      applyIncomingScore(score);
    } else {
      const fallback = EPISODE_ONE_TASKS.reduce((sum, task) => sum + (EPISODE_ONE_TASK_POINTS[task.id] || 0), 0);
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

  if (["watch-ep1", "challenge-ep1", "episode1", "ep1", "tutorial", "tutorial-complete", "ep1-complete"].includes(normalized)) {
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
    if (taskId && completed && ["episode1", "ep1", "tutorial", "ep1-complete"].includes(taskId)) {
      window.CyberGuardBridge.completeEpisode1();
    }
    return;
  }

  if (["watch-ep1", "challenge-ep1", "episode1", "ep1"].includes(taskId)) {
    window.CyberGuardBridge.completeTask(taskId);
  }
  applyIncomingScore(rawScore);

  if (["episode1", "ep1", "tutorial", "ep1-complete"].includes(taskId)) {
    window.CyberGuardBridge.completeEpisode1(rawScore);
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
  return user ? Number(user.episodeScores?.[EPISODE_KEY] || 0) : 0;
};

window.dispatchEvent(new CustomEvent("cyberguard:bridge-ready"));
