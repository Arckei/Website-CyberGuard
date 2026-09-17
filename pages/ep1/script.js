import {
  ensureState,
  hydrateStateFromFirebase,
  initPageAnimations,
  requireAuth,
  setupNav,
  setupPasswordToggles
} from "../../services/shared.js";

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

document.addEventListener("DOMContentLoaded", async () => {
  ensureState();
  const authUser = await requireAuth("../login/");
  if (!authUser) return;
  await hydrateStateFromFirebase();
  setupNav();
  setupPasswordToggles();
  setupDemoTask();
  setupDownloadButton();
  initPageAnimations();
});

function setupDemoTask() {
  document.querySelector("[data-demo-task]")?.addEventListener("change", (event) => {
    event.target.closest(".demo-task")?.classList.toggle("done", event.target.checked);
  });
}

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
