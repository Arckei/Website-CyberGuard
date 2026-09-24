import { auth, subscribeToClass, subscribeToCurrentUser, updateClassScore } from "../../services/firebase-service.js";
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

// Episode Zero's task list. Edit this array to change what shows up in the
// checklist — the episode is marked "Done" once every task here is checked.
const EPISODE_ZERO_TASKS = [
  { id: "watch-intro", label: "Watch the Episode 0 intro" },
  { id: "play-level", label: "Play through the in-game challenge" },
  { id: "reflection", label: "Answer the reflection question in-game" },
  { id: "done-ep0", label: "Done Ep 0: Cyber Security Attack Tutorial" }
];

const EPISODE_ZERO_TASK_POINTS = {
  "watch-intro": 25,
  "play-level": 50,
  "reflection": 50,
  "done-ep0": 50
};

// Short intro clip shown before a student's first playthrough. encodeURI()
// for the same reason as the Unity build/lesson paths below — the filename
// has literal spaces in it.
const INTRO_VIDEO_URL = encodeURI("../../assets/Ep 0 Intro/What is Cyber Security_  (Explained in 1 Minute!).mp4");

// Episode 0's own score, kept separate from Episode 1's — both episodes
// used to write into the SAME shared klass.scores[uid] "gameplay" bucket
// via Math.max, which meant whichever episode had the LOWER raw score
// never actually moved the number (this episode finishing with 150 then
// Episode 1 finishing with 90 left the total stuck at 150 — Episode 1's
// points were silently swallowed). Each episode now keeps its own
// best-score-so-far under user.episodeScores[EPISODE_KEY], and the two are
// summed back into klass.scores[uid] (see syncCombinedScore) so the class
// leaderboard and the quiz feature's own "scores + quizScores" total still
// see the full combined amount — quiz points are untouched, they live in a
// completely separate klass.quizScores field this code never writes to.
const EPISODE_KEY = "ep0";

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
  initPageAnimations();
  setupRealtimeClassSync();
  setupGameScoreCapture();
  setupIntro();
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

function setupGameScoreCapture() {
  installUnityScoreCapture((score, source) => {
    console.log("[CyberGuard] Caught in-game score from", source, score);
    handleShiftOperationComplete(score);
  });

  subscribeToCurrentUser((remoteUser) => {
    const score = parseGameScorePayload(remoteUser);
    if (score === null) return;
    handleShiftOperationComplete(score);
  });
}

// Fires once the in-game "Shift operation is completed" screen writes its
// score (tutorialScore in Firestore). Always forwards to completeEpisode0 —
// it used to bail out early once every task was already checked off, which
// meant a duplicate event (the same completion gets reported to us multiple
// times: once from the outgoing fetch/XHR body, once from its response, and
// again when Firestore echoes the value back through subscribeToCurrentUser)
// AND a genuinely later, higher score both looked identical and got silently
// ignored. setTaskComplete and applyIncomingScore are both already safe to
// call repeatedly — they no-op once nothing has actually changed — so
// there's no need to guard here.
function handleShiftOperationComplete(score) {
  window.CyberGuardBridge.completeEpisode0(score);
}

function setupUnityLaunch() {
  const loadingPanel = document.querySelector("[data-unity-loading]");
  if (loadingPanel) loadingPanel.hidden = false;

  const config = UNITY_EPISODES.episode0;
  const title = document.querySelector("[data-game-title]");
  if (title) title.textContent = config.title;
  const downloadSize = document.querySelector("[data-unity-download-size]");
  if (downloadSize) downloadSize.textContent = config.size;

  // Don't auto-download. This used to fire loadUnityGame() on page load, which
  // pulled ~76 MB the moment anyone opened Modules, and also used to announce
  // "Episode 0 is loading" while nothing was actually loading.
  const button = document.querySelector("[data-unity-download]");
  if (hasDownloadedEpisode("episode0")) {
    if (button) button.innerHTML = `Play ${config.title} <span>Downloaded</span>`;
    setUnityLoadingText(`${config.title} is already downloaded on this device. Press play to start.`);
  } else {
    setUnityLoadingText(`Press download to start ${config.title}. First play downloads ${config.size}.`);
  }
}

function setupEpisodeTabs() {
  document.querySelector("[data-unity-download]")?.addEventListener("click", () => startEpisode("episode0"));
}

function startEpisode(episode) {
  const button = document.querySelector("[data-unity-download]");
  const alreadyDownloaded = hasDownloadedEpisode(episode);
  if (button) {
    button.disabled = true;
    button.classList.add("loading");
    button.innerHTML = alreadyDownloaded
      ? "Loading&hellip; <span>Please wait</span>"
      : "Downloading&hellip; <span>Please wait</span>";
  }
  setUnityLoadingText(
    alreadyDownloaded
      ? "Loading the game from your device. No need to re-download."
      : "Downloading the game. This only happens on your first play."
  );
  loadUnityGame(episode, button);
}

// ---------------- Episode intro clip ----------------
// Shown once, before a student's first playthrough. Finishing it (or
// skipping it) checks off the "watch-intro" task and immediately kicks off
// the Unity download/launch, so watching the intro is the only extra step —
// the student never has to also press "Download Episode" themselves.
// Reopening it later via the toolbar's "Rewatch Intro" button just replays
// the clip without re-triggering a fresh download.
function setupIntro() {
  const overlay = document.querySelector("[data-intro-overlay]");
  const video = document.querySelector("[data-intro-video]");
  const skipButton = document.querySelector("[data-intro-skip]");
  const rewatchButton = document.querySelector("[data-rewatch-intro]");
  if (!overlay || !video) return;

  video.src = INTRO_VIDEO_URL;

  let isFirstWatch = false;

  const closeOverlay = () => {
    overlay.setAttribute("hidden", "");
    video.pause();
    if (isFirstWatch) {
      isFirstWatch = false;
      startEpisode("episode0");
    }
  };

  const markWatchedAndClose = () => {
    setTaskComplete("watch-intro", true);
    closeOverlay();
  };

  video.addEventListener("ended", markWatchedAndClose);
  // Pressing play already counts as "watching it" — check the box the
  // moment playback actually starts rather than only once it finishes.
  video.addEventListener("play", () => setTaskComplete("watch-intro", true), { once: true });
  skipButton?.addEventListener("click", markWatchedAndClose);

  rewatchButton?.addEventListener("click", () => {
    isFirstWatch = false;
    overlay.removeAttribute("hidden");
    video.currentTime = 0;
    video.play().catch(() => {});
  });

  const alreadyWatched = getEpisodeProgress(getState())["watch-intro"];
  if (!alreadyWatched) {
    isFirstWatch = true;
    overlay.removeAttribute("hidden");
    // Autoplay can be blocked by the browser — that's fine, the visible
    // <video controls> let the student press play themselves, and the
    // "play" listener above still checks the box the moment they do.
    video.play().catch(() => {});
  }
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
  reconcileTasksWithExistingScore();
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

// Self-heals a mismatch between "there's a real Episode 0 score" and
// "not all 3 checklist items are marked done". This can happen for a
// student whose progress predates the checkboxes being locked to
// game-only completion (e.g. only some tasks were ever manually ticked
// before that fix shipped) — the reconciliation in handleShiftOperationComplete
// only reacts to the user doc's `tutorialScore` field, which is a DIFFERENT
// field from `user.episodeScores.ep0`, so the two can end up out of step for
// a student who never got a fresh tutorialScore write. This does NOT call
// setTaskComplete (which would re-award points via awardTaskPoints) — the
// score already exists, so this only fixes the checkboxes, never the total.
function reconcileTasksWithExistingScore() {
  const state = getState();
  const user = getCurrentUser(state);
  if (!user) return;

  const existingScore = Number(user.episodeScores?.[EPISODE_KEY] || 0);
  if (existingScore <= 0) return;

  const tasks = getEpisodeProgress(state);
  if (EPISODE_ZERO_TASKS.every((task) => tasks[task.id])) return;

  user.taskProgress = user.taskProgress || {};
  user.taskProgress.episode1 = user.taskProgress.episode1 || { tasks: {} };
  user.taskProgress.episode1.tasks = user.taskProgress.episode1.tasks || {};
  EPISODE_ZERO_TASKS.forEach((task) => {
    user.taskProgress.episode1.tasks[task.id] = true;
  });
  user.taskProgress.episode1.complete = true;

  const klass = getActiveClass(state);
  if (klass) {
    klass.modules = klass.modules || {};
    klass.modules.phishing = klass.modules.phishing || {};
    klass.modules.phishing.complete = true;
  }

  saveState(state);
  renderTaskList();
}

function renderTaskList() {
  const state = getState();
  const taskListRoot = document.querySelector("[data-task-list]");
  const tasks = getEpisodeProgress(state);

  const taskMarkup = (task) => `
    <li class="${tasks[task.id] ? "done" : ""}">
      <input type="checkbox" id="task-${task.id}" data-task-checkbox="${task.id}" ${tasks[task.id] ? "checked" : ""} disabled title="Completed automatically by playing the game — not editable here" />
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
    ${taskMarkup(EPISODE_ZERO_TASKS[3])}
    <li class="lesson-inline-section">
      <p class="lesson-section-label">Uploaded Files</p>
      <ul class="task-list lesson-task-list" data-lesson-task-list>
        <li class="muted">Loading uploads&hellip;</li>
      </ul>
    </li>`;

  // Checkboxes above are `disabled` — completion is driven entirely by
  // CyberGuardBridge (the actual game finishing a task/episode), never by a
  // student clicking the box themself. No change-event wiring needed here
  // anymore.

  // renderTaskList() rebuilds this whole block from scratch — including the
  // "Loading files…" placeholders — every time a task completes or a
  // realtime class update comes in (see setupRealtimeClassSync). Without
  // re-populating them here too, they'd only ever get filled in once, on the
  // very first render, and stay stuck on "Loading files…" after that.
  renderLocalLessonList();
  renderLessonTaskList();

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

  const task = EPISODE_ZERO_TASKS.find((entry) => entry.id === taskId);
  const points = task ? Number(EPISODE_ZERO_TASK_POINTS[task.id] || 0) : 0;
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
    klass.modules.phishing = klass.modules.phishing || {};

    const tasks = getEpisodeProgress(state);
    klass.modules.phishing.complete = EPISODE_ZERO_TASKS.every((entry) => tasks[entry.id]);
  }

  syncCombinedScore(state, user, klass);
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

  scoreEl.textContent = `Ep 0 Score: ${Math.max(0, Number(score) || 0)}`;
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
// NOTE: encodeURI() here for the same reason the Unity build URLs need it —
// "Ep 0" has a literal space, and an unencoded space in a fetch() path
// isn't reliably resolved once deployed (works locally, 404s on Vercel).
const LOCAL_LESSON_FALLBACK = [
  {
    id: "local-what-is-phishing-1",
    name: "What is Phishing",
    type: "DOCX",
    url: encodeURI("../../Docs/Ep 0/What-is-Phishing-1.docx")
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
    buildUrl: "./Ep 0/Build",
    buildName: "CyberGuard Ep0 v1.02",
    size: "76.0 MB"
  },
  episode1: {
    title: "Episode 1",
    buildUrl: "./Ep 1/Build",
    buildName: "CyberGuard Ep1 v1.00",
    size: "77.5 MB"
  }
};

// There's no browser API that reliably answers "is this URL already in the
// HTTP cache?" ahead of time — the only thing we can actually know is
// whether *we* successfully finished loading it on this device before. This
// remembers that in localStorage so the button doesn't keep telling a
// returning student to "Download 76 MB" once they already have it.
const DOWNLOADED_EPISODES_KEY = "cyberguard_downloaded_episodes";

function getDownloadedEpisodes() {
  try {
    const stored = JSON.parse(localStorage.getItem(DOWNLOADED_EPISODES_KEY) || "[]");
    return Array.isArray(stored) ? stored : [];
  } catch {
    return [];
  }
}

function hasDownloadedEpisode(episode) {
  return getDownloadedEpisodes().includes(episode);
}

function markEpisodeDownloaded(episode) {
  try {
    const downloaded = new Set(getDownloadedEpisodes());
    downloaded.add(episode);
    localStorage.setItem(DOWNLOADED_EPISODES_KEY, JSON.stringify([...downloaded]));
  } catch (error) {
    console.warn("[CyberGuard] Could not remember that the game was downloaded:", error);
  }
}

let unityInstance = null;
let unityLoadRequest = 0;

function setUnityLoadingText(text) {
  const loadingText = document.querySelector("[data-unity-loading-text]");
  if (loadingText) loadingText.textContent = text;
}

// This page only ever loads Episode 0. Episode 1 lives at /pages/ep1/ as its
// own document — Unity WebGL parks a lot of state on `window` (the WASM heap,
// createUnityInstance, the audio context, input handlers) and has no supported
// way to tear one build down and start another in the same page. A normal link
// between the two pages lets the browser destroy the old context outright, and
// cancels any download still in flight for the other episode.
function loadUnityGame(episode = "episode0", downloadButton = null) {
  const episodeConfig = UNITY_EPISODES[episode] || UNITY_EPISODES.episode0;
  const canvas = document.querySelector("#unity-canvas");
  const embed = document.querySelector("[data-unity-embed]");
  const progressFill = document.querySelector("[data-unity-progress]");
  const fullscreenButton = document.querySelector("[data-unity-fullscreen]");
  if (!canvas || !embed) return;

  const failed = (label, message) => {
    if (downloadButton) {
      downloadButton.disabled = false;
      downloadButton.classList.remove("loading");
      downloadButton.innerHTML = `${label} <span>${episodeConfig.size}</span>`;
    }
    setUnityLoadingText(message);
  };

  const script = document.createElement("script");
  script.dataset.unityLoader = "true";
  // Build filenames contain spaces ("CyberGuard Ep0 v1.02.loader.js"), so
  // encode them rather than relying on every fetch path to tolerate raw spaces.
  script.src = encodeURI(`${episodeConfig.buildUrl}/${episodeConfig.buildName}.loader.js`);

  script.onload = () => {
    if (typeof createUnityInstance !== "function") {
      console.error("CyberGuard: Unity loader ran but createUnityInstance is missing.");
      failed("Try Again", "The game failed to start. Please refresh and try again.");
      return;
    }

    createUnityInstance(canvas, {
      dataUrl: encodeURI(`${episodeConfig.buildUrl}/${episodeConfig.buildName}.data`),
      frameworkUrl: encodeURI(`${episodeConfig.buildUrl}/${episodeConfig.buildName}.framework.js`),
      codeUrl: encodeURI(`${episodeConfig.buildUrl}/${episodeConfig.buildName}.wasm`),
      companyName: "CyberGuard",
      productName: episodeConfig.title,
      productVersion: "1.0"
    }, (progress) => {
      if (progressFill) progressFill.style.width = `${Math.round(progress * 100)}%`;
    }).then((instance) => {
      unityInstance = instance;
      embed.classList.add("loaded");
      window.CyberGuardUnityInstance = instance;
      markEpisodeDownloaded(episode);
      if (downloadButton) {
        downloadButton.disabled = false;
        downloadButton.classList.remove("loading");
        downloadButton.innerHTML = `Restart ${episodeConfig.title} <span>Downloaded</span>`;
      }
      if (fullscreenButton) fullscreenButton.onclick = () => instance.SetFullscreen(1);
    }).catch((error) => {
      console.error("CyberGuard: Unity failed to load", error);
      failed("Try Again", "The game failed to load. Please try again.");
    });
  };

  script.onerror = () => {
    console.error("CyberGuard: could not download the Unity loader.");
    failed("Try Again", "The game failed to download. Please check your connection and try again.");
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
  return user ? Number(user.episodeScores?.[EPISODE_KEY] || 0) : 0;
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

