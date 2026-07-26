// shared.js
// Single source of truth for state, auth glue, and common UI helpers used by
// every page. Import what you need instead of copy-pasting these functions.

import { loadCyberGuardData, saveCyberGuardData, signOutUser } from "./firebase-service.js";

export const STORAGE_KEY = "cyberguard_state_v1";
const PENDING_VERIFICATION_KEY = "cyberguard_pending_verification";

export const DEFAULT_SETTINGS = {
  darkMode: true,
  reduceMotion: false,
  compactDashboard: false,
  showProgressDetails: true,
  privateDashboard: false,
  reminderPrompts: true
};

export const seedState = {
  currentUserId: null,
  isLoggedIn: false,
  users: [
    { id: "stu-1", role: "student", email: "student@mail.com", firstName: "Ari", lastName: "Reyes", avatar: "AR" },
    { id: "stu-2", role: "student", email: "kai@mail.com", firstName: "Kai", lastName: "Santos", avatar: "KS" },
    { id: "stu-3", role: "student", email: "mina@mail.com", firstName: "Mina", lastName: "Lee", avatar: "ML" },
    { id: "stu-4", role: "student", email: "jo@mail.com", firstName: "Jo", lastName: "Cruz", avatar: "JC" },
    { id: "admin-1", role: "admin", email: "admin@mail.com", firstName: "Cyber", lastName: "Teacher", avatar: "CT" }
  ],
  classes: [
    {
      id: "class-1",
      name: "STEM-11",
      section: "Alpha",
      code: "CG2026",
      teacher: "Cyber Teacher",
      students: ["stu-1", "stu-2", "stu-3", "stu-4"],
      scores: { "stu-1": 20, "stu-2": 10, "stu-3": 30, "stu-4": 0 },
      modules: { phishing: { complete: false } }
    }
  ],
  activeClassId: "class-1"
};

export const questions = [
  {
    text: "It is a form of social engineering where attackers deceive people into revealing sensitive information.",
    options: ["A. Phishing", "B. Hacking", "C. Fishing"],
    answer: 0
  },
  {
    text: "Which password is the strongest choice?",
    options: ["A. john123", "B. Q7!mR2#safe", "C. password"],
    answer: 1
  },
  {
    text: "What should you do before clicking a link in a suspicious email?",
    options: ["A. Check the sender and link", "B. Reply with your password", "C. Download the file"],
    answer: 0
  },
  {
    text: "A code sent to your phone after a password is called what?",
    options: ["A. Two-factor authentication", "B. Screen lock", "C. Spam"],
    answer: 0
  }
];

// ---------- State ----------

export function getState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return structuredClone(seedState);
  try {
    const parsed = JSON.parse(raw);
    return { ...structuredClone(seedState), ...parsed };
  } catch {
    return structuredClone(seedState);
  }
}

export function saveLocalState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function saveState(state) {
  saveLocalState(state);
  if (state.isLoggedIn || state.currentUserId) {
    saveCyberGuardData(state).catch((error) => {
      console.warn("CyberGuard Firebase sync failed", error);
    });
  }
}

export function ensureState() {
  if (!localStorage.getItem(STORAGE_KEY)) {
    saveState(structuredClone(seedState));
  }
}

export function isAuthenticated(state = getState()) {
  return Boolean(state.isLoggedIn || state.currentUserId);
}

export async function hydrateStateFromFirebase() {
  const state = getState();
  if (!isAuthenticated(state)) return;

  try {
    const remoteState = await loadCyberGuardData();
    const nextState = {
      ...state,
      ...remoteState,
      currentUserId: state.currentUserId,
      isLoggedIn: state.isLoggedIn,
      activeClassId: remoteState.activeClassId || state.activeClassId
    };
    saveLocalState(nextState);
  } catch (error) {
    console.warn("CyberGuard Firebase load failed", error);
  }
}

// Redirects an already-logged-in visitor away from login/signup.
export function redirectIfAuthenticated() {
  const state = getState();
  if (!isAuthenticated(state)) return false;
  const currentUser = getCurrentUser(state);
  window.location.href = currentUser?.role === "admin" ? "../admin/" : "../user/";
  return true;
}

// A signed-up-or-logged-in-but-not-yet-verified user is held on the
// verify-email page. We stash just enough of their profile in
// sessionStorage (never localStorage) so it survives the redirect without
// granting them an app session yet.
export function sendToVerifyEmail(user) {
  sessionStorage.setItem(PENDING_VERIFICATION_KEY, JSON.stringify(user));
  window.location.href = "../verify-email/";
}

export function getPendingVerificationUser() {
  try {
    const raw = sessionStorage.getItem(PENDING_VERIFICATION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearPendingVerificationUser() {
  sessionStorage.removeItem(PENDING_VERIFICATION_KEY);
}

// Grants an app session after Firebase Auth has confirmed the user
// (and, where required, that their email is verified).
export function signInLocally(user) {
  const state = getState();
  state.users = [...state.users.filter((item) => item.id !== user.id && item.email !== user.email), user];
  state.currentUserId = user.id;
  state.isLoggedIn = true;
  saveState(state);
  return state;
}

// ---------- Nav / shared UI ----------

export function setupNav() {
  const toggle = document.querySelector("[data-nav-toggle]");
  const nav = document.querySelector("[data-nav]");
  if (!toggle || !nav) return;
  toggle.addEventListener("click", () => nav.classList.toggle("open"));

  const state = getState();
  if (!isAuthenticated(state)) {
    nav.querySelector("[data-logout-link]")?.remove();
    return;
  }

  let logoutLink = nav.querySelector("[data-logout-link]");
  if (!logoutLink) {
    logoutLink = document.createElement("a");
    logoutLink.href = "#";
    logoutLink.textContent = "Logout";
    logoutLink.dataset.logoutLink = "true";
    nav.appendChild(logoutLink);
  }

  logoutLink.onclick = async (event) => {
    event.preventDefault();
    await signOutUser().catch(() => {});
    const activeState = getState();
    activeState.currentUserId = null;
    activeState.isLoggedIn = false;
    saveState(activeState);
    window.location.href = getHomeLinkFromCurrentDepth();
  };
}

// pages/<name>/index.html -> ../../index.html, root index.html -> ./index.html
function getHomeLinkFromCurrentDepth() {
  const depth = window.location.pathname.split("/pages/").length - 1;
  return depth > 0 ? "../../index.html" : "./index.html";
}

export function setupPasswordToggles() {
  document.querySelectorAll("[data-show-password]").forEach((checkbox) => {
    const targets = document.querySelectorAll(checkbox.dataset.showPassword);
    if (!targets.length) return;
    checkbox.addEventListener("change", () => {
      targets.forEach((target) => {
        target.type = checkbox.checked ? "text" : "password";
      });
    });
  });
}

export function showToast(message) {
  const existing = document.querySelector(".toast");
  if (existing) existing.remove();
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.append(toast);
  setTimeout(() => toast.remove(), 2400);
}

// Simple reusable popup. `actions` is an array of { label, onClick, primary }.
// Returns the overlay element in case the caller wants to close it manually.
export function showModal({ title, message, actions = [] }) {
  const existing = document.querySelector(".modal-overlay");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";

  const dialog = document.createElement("div");
  dialog.className = "modal-dialog";
  dialog.innerHTML = `
    <h2>${escapeHtml(title)}</h2>
    <p>${escapeHtml(message)}</p>
    <div class="modal-actions"></div>
  `;

  const actionsRoot = dialog.querySelector(".modal-actions");
  actions.forEach((action) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `btn ${action.primary ? "primary" : "ghost"}`;
    button.textContent = action.label;
    button.addEventListener("click", () => action.onClick?.(overlay));
    actionsRoot.appendChild(button);
  });

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  return overlay;
}

export function closeModal(overlay) {
  (overlay || document.querySelector(".modal-overlay"))?.remove();
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// ---------- User / class helpers ----------

export function getCurrentUser(state) {
  return state.users.find((item) => item.id === state.currentUserId) || state.users[0];
}

export function getActiveClass(state) {
  return state.classes.find((item) => item.id === state.activeClassId) || state.classes[0];
}

export function fullName(user) {
  return `${user.firstName} ${user.lastName}`.trim();
}

export function playerName(state, id) {
  const user = state.users.find((item) => item.id === id);
  return user ? fullName(user) : "Student";
}

export function initials(firstName, lastName) {
  const first = (firstName || "N").trim().charAt(0);
  const last = (lastName || "S").trim().charAt(0);
  return `${first}${last}`.toUpperCase();
}

export function makeCode() {
  return `CG${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

export function renderAvatar(user) {
  const avatar = document.querySelector("[data-avatar]");
  if (!avatar) return;

  if (user.photo) {
    avatar.innerHTML = `<img src="${user.photo}" alt="Profile photo" />`;
    return;
  }

  avatar.innerHTML = "";
  avatar.textContent = user.avatar || initials(user.firstName, user.lastName);
}

export function renderBadges(state, user) {
  const badge = document.querySelector("[data-badges]");
  if (!badge) return;
  const total = state.classes.reduce((sum, klass) => sum + (klass.scores[user.id] || 0), 0);
  badge.innerHTML = `
    <div>
      <h2>${total >= 50 ? "Cyber Shield" : "Starter Shield"}</h2>
      <p class="muted">${total} total points collected from gameplay.</p>
    </div>
  `;
}

export function renderLeaderboard(selector, state, klass) {
  const root = document.querySelector(selector);
  if (!root || !klass) return;
  const rows = klass.students
    .map((id) => ({ id, user: state.users.find((item) => item.id === id), score: klass.scores[id] || 0 }))
    .filter((row) => row.user)
    .sort((a, b) => b.score - a.score);

  root.innerHTML = rows.length ? rows.map((row, index) => `
    <div class="leaderboard-row">
      <span class="rank">${index + 1}</span>
      <strong>${escapeHtml(fullName(row.user))}</strong>
      <span class="badge">${row.score} points</span>
    </div>
  `).join("") : `<p class="muted">No students yet.</p>`;
}

// ---------- Per-user settings (dashboard/profile) ----------

export function getCurrentUserSettings(state = getState()) {
  const user = getCurrentUser(state);
  return { ...DEFAULT_SETTINGS, ...(user?.settings || {}) };
}

export function applySettings(settings = {}) {
  const merged = { ...DEFAULT_SETTINGS, ...settings };
  document.body.classList.toggle("theme-dark", merged.darkMode);
  document.body.classList.toggle("theme-light", !merged.darkMode);
  document.body.classList.toggle("reduce-motion", merged.reduceMotion);
  document.body.classList.toggle("compact-view", merged.compactDashboard);
  document.body.classList.toggle("private-dashboard", merged.privateDashboard);
  document.body.dataset.progressDetails = merged.showProgressDetails ? "on" : "off";
  document.body.dataset.reminders = merged.reminderPrompts ? "on" : "off";
}

export function applyCurrentUserSettings() {
  applySettings(getCurrentUserSettings());
}

// ---------- Password validation (signup / password change) ----------

export function passwordStatus(password, confirmPassword) {
  return {
    length: password.length >= 8,
    uppercase: /[A-Z]/.test(password),
    number: /[0-9]/.test(password),
    symbol: /[^A-Za-z0-9]/.test(password),
    match: Boolean(password) && password === confirmPassword
  };
}

export function validatePassword(password, confirmPassword) {
  if (password.length < 8) return "Password must be at least 8 characters.";
  if (!/[A-Z]/.test(password)) return "Password needs one uppercase letter.";
  if (!/[0-9]/.test(password)) return "Password needs one number.";
  if (!/[^A-Za-z0-9]/.test(password)) return "Password needs one symbol.";
  if (password !== confirmPassword) return "Passwords do not match.";
  return "";
}

export function firebaseErrorMessage(error) {
  const messages = {
    "auth/invalid-credential": "Email or password is incorrect.",
    "auth/user-not-found": "No account found for that email.",
    "auth/wrong-password": "Password is incorrect.",
    "auth/email-already-in-use": "An account with that email already exists.",
    "auth/weak-password": "Password is too weak.",
    "auth/popup-closed-by-user": "Google sign-in was cancelled.",
    "auth/popup-blocked": "Allow pop-ups, then try Google sign-in again.",
    "auth/operation-not-allowed": "Enable Google sign-in in Firebase Authentication first.",
    "auth/too-many-requests": "Too many attempts. Please try again later.",
    "auth/network-request-failed": "Network error. Check your connection and try again."
  };

  return messages[error?.code] || "Firebase sign-in failed. Please try again.";
}

export function firebasePasswordErrorMessage(error) {
  const messages = {
    "auth/wrong-password": "Current password is incorrect.",
    "auth/invalid-credential": "Current password is incorrect.",
    "auth/weak-password": "New password is too weak.",
    "auth/requires-recent-login": "Please log out and log back in, then try again.",
    "auth/too-many-requests": "Too many attempts. Please try again later.",
    "auth/network-request-failed": "Network error. Check your connection and try again."
  };

  return messages[error?.code] || "Could not update password. Please try again.";
}

// ---------- Globe animation (landing page banner) ----------

const globeState = {
  canvas: null,
  ctx: null,
  width: 0,
  height: 0,
  rotation: 0,
  speed: 0.006,
  targetSpeed: 0.006,
  visible: true,
  lastFrame: 0,
  lastScrollY: window.scrollY,
  revealProgress: 0
};

export function setupGlobe() {
  const canvas = document.querySelector("#globeCanvas");
  if (!canvas) return;
  globeState.canvas = canvas;
  globeState.ctx = canvas.getContext("2d");
  resizeGlobe();
  updateGlobeReveal();
  window.addEventListener("resize", resizeGlobe);
  window.addEventListener("scroll", () => {
    const delta = Math.abs(window.scrollY - globeState.lastScrollY);
    globeState.lastScrollY = window.scrollY;
    updateGlobeReveal();
    globeState.targetSpeed = Math.min(0.12, 0.01 + delta * 0.0018);
    clearTimeout(setupGlobe.scrollTimer);
    setupGlobe.scrollTimer = setTimeout(() => {
      globeState.targetSpeed = globeState.visible ? 0.006 : 0.02;
    }, 180);
  }, { passive: true });

  const banner = document.querySelector("[data-globe-banner]");
  if (banner) {
    const observer = new IntersectionObserver(([entry]) => {
      globeState.visible = entry.isIntersecting;
      globeState.targetSpeed = entry.isIntersecting ? 0.006 : 0.02;
    }, { threshold: 0.35 });
    observer.observe(banner);
  }
  requestAnimationFrame(drawGlobe);
}

function updateGlobeReveal() {
  const banner = document.querySelector("[data-globe-banner]");
  if (!banner) return;
  const bannerTop = banner.getBoundingClientRect().top + window.scrollY;
  const distance = Math.max(1, banner.offsetHeight * 0.75);
  const raw = (window.scrollY - bannerTop) / distance;
  globeState.revealProgress = Math.max(0, Math.min(1, raw));
}

function resizeGlobe() {
  const canvas = globeState.canvas;
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  globeState.width = Math.max(1, Math.floor(rect.width));
  globeState.height = Math.max(1, Math.floor(rect.height));
  canvas.width = Math.floor(globeState.width * dpr);
  canvas.height = Math.floor(globeState.height * dpr);
  globeState.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function drawGlobe(time) {
  const { ctx, width, height } = globeState;
  if (!ctx) return;
  if (document.hidden) {
    requestAnimationFrame(drawGlobe);
    return;
  }
  if (time - globeState.lastFrame < 33) {
    requestAnimationFrame(drawGlobe);
    return;
  }
  globeState.lastFrame = time;
  ctx.clearRect(0, 0, width, height);

  globeState.speed += (globeState.targetSpeed - globeState.speed) * 0.045;
  globeState.rotation += globeState.speed;

  const reveal = easeOutCubic(globeState.revealProgress);
  const cy = height * 0.5;
  const radius = Math.min(width, height) * lerp(0.72, 0.34, reveal);
  const rightPadding = Math.max(22, width * 0.025);
  const cx = lerp(width + radius * 0.5, width - radius - rightPadding, reveal);
  const pulse = Math.sin(time * 0.004) * 0.08 + 0.92;

  ctx.fillStyle = "#050607";
  ctx.fillRect(0, 0, width, height);
  ctx.globalCompositeOperation = "lighter";

  const glow = ctx.createRadialGradient(cx, cy, radius * 0.2, cx, cy, radius * 1.45);
  glow.addColorStop(0, "rgba(255, 48, 60, 0.36)");
  glow.addColorStop(1, "rgba(255, 48, 60, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 1.55, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = `rgba(255, 48, 60, ${0.72 * pulse})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();

  drawLatitudeLines(ctx, cx, cy, radius);
  drawLongitudeLines(ctx, cx, cy, radius);
  drawContinents(ctx, cx, cy, radius, globeState.rotation);
  drawGlitches(ctx, cx, cy, radius, time);

  ctx.globalCompositeOperation = "source-over";
  requestAnimationFrame(drawGlobe);
}

function drawLatitudeLines(ctx, cx, cy, radius) {
  for (let i = -3; i <= 3; i += 1) {
    const y = cy + (radius * i) / 4;
    const scale = Math.cos((i / 4) * Math.PI * 0.5);
    ctx.strokeStyle = "rgba(255, 83, 91, 0.24)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(cx, y, radius * scale, radius * 0.13 * scale, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawLongitudeLines(ctx, cx, cy, radius) {
  for (let i = 0; i < 8; i += 1) {
    const angle = globeState.rotation + (i * Math.PI) / 8;
    const scale = Math.abs(Math.cos(angle));
    ctx.strokeStyle = "rgba(255, 83, 91, 0.22)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(cx, cy, radius * scale, radius, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawContinents(ctx, cx, cy, radius, rotation) {
  const shapes = [
    [[-0.62, -0.22], [-0.38, -0.42], [-0.12, -0.28], [-0.22, -0.02], [-0.5, 0.04]],
    [[0.02, -0.34], [0.34, -0.24], [0.42, 0.04], [0.18, 0.2], [-0.02, 0.08]],
    [[-0.18, 0.22], [0.04, 0.18], [0.18, 0.48], [-0.12, 0.56], [-0.28, 0.38]]
  ];

  ctx.fillStyle = "rgba(255, 48, 60, 0.42)";
  shapes.forEach((shape) => {
    ctx.beginPath();
    shape.forEach(([x, y], index) => {
      const warpedX = Math.sin(x * Math.PI + rotation) * 0.8;
      const px = cx + warpedX * radius;
      const py = cy + y * radius;
      if (index === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();
    ctx.fill();
  });
}

function drawGlitches(ctx, cx, cy, radius, time) {
  const blink = Math.floor(time / 120) % 5 === 0;
  ctx.fillStyle = blink ? "rgba(255, 255, 255, 0.9)" : "rgba(255, 48, 60, 0.85)";
  for (let i = 0; i < 18; i += 1) {
    const angle = globeState.rotation * 1.7 + i * 1.83;
    const band = Math.sin(i * 2.1) * 0.72;
    const x = cx + Math.cos(angle) * radius * Math.cos(band);
    const y = cy + Math.sin(band) * radius;
    if ((x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2) {
      ctx.fillRect(x - 2, y - 2, blink ? 9 : 5, blink ? 3 : 5);
    }
  }
}

function lerp(start, end, amount) {
  return start + (end - start) * amount;
}

function easeOutCubic(value) {
  return 1 - Math.pow(1 - value, 3);
}
