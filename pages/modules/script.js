import {
  ensureState,
  getCurrentUser,
  getState,
  hydrateStateFromFirebase,
  saveState,
  setupNav,
  setupPasswordToggles
} from "../../shared.js";

// Episode One's task list. Edit this array to change what shows up in the
// checklist — the episode is marked "Done" once every task here is checked.
const EPISODE_ONE_TASKS = [
  { id: "watch-intro", label: "Watch the Episode One introduction" },
  { id: "play-level", label: "Play through the in-game challenge" },
  { id: "reflection", label: "Answer the reflection question in-game" }
];

document.addEventListener("DOMContentLoaded", async () => {
  ensureState();
  await hydrateStateFromFirebase();
  setupNav();
  setupPasswordToggles();
  setupEpisodeChecklist();
  loadUnityGame();
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
