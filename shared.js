// shared.js
// Single source of truth for state, auth glue, and common UI helpers.

import { 
  getSignedInUserProfile, 
  loadCyberGuardData, 
  saveCyberGuardData, 
  signOutUser 
} from "./firebase-service.js";

export const STORAGE_KEY = "cyberguard_state_v1";
const PENDING_VERIFICATION_KEY = "cyberguard_pending_verification";

// ==========================================================================
// 1. CONFIGURATION & CLEAN STATE SEEDING
// ==========================================================================

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
  users: [],
  classes: [],
  activeClassId: null
};

// ==========================================================================
// 2. SAFE LOCAL & REMOTE STATE STORAGE
// ==========================================================================

export function getState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(seedState);
    const parsed = JSON.parse(raw);
    return { ...structuredClone(seedState), ...parsed };
  } catch (error) {
    console.warn("[CyberGuard] Storage access restriction:", error);
    return structuredClone(seedState);
  }
}

export function saveLocalState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn("[CyberGuard] Unable to persist state to localStorage:", error);
  }
}

export function saveState(state, options = {}) {
  saveLocalState(state);
  if (state.isLoggedIn || state.currentUserId) {
    const sync = saveCyberGuardData(state);
    if (options.throwOnSyncError) return sync;
    return sync.catch((error) => {
      console.warn("[CyberGuard] Firebase state sync failed:", error);
    });
  }
  return Promise.resolve();
}

export function ensureState() {
  try {
    if (!localStorage.getItem(STORAGE_KEY)) {
      saveState(structuredClone(seedState));
    }
  } catch {
    saveState(structuredClone(seedState));
  }
}

export function isAuthenticated(state = getState()) {
  return Boolean(state.isLoggedIn || state.currentUserId);
}

export async function hydrateStateFromFirebase() {
  const authUser = await getSignedInUserProfile();
  if (!authUser || !authUser.emailVerified) return;

  try {
    const state = getState();
    const remoteState = await loadCyberGuardData();
    const nextState = {
      ...state,
      ...remoteState,
      currentUserId: authUser.id,
      isLoggedIn: true,
      activeClassId: remoteState?.activeClassId || state.activeClassId || remoteState?.classes?.[0]?.id || null
    };

    if (!nextState.users.some((user) => user.id === authUser.id)) {
      nextState.users = [...nextState.users.filter((user) => user.id !== authUser.id), authUser];
    }

    saveLocalState(nextState);
  } catch (error) {
    console.warn("[CyberGuard] Firebase profile load failed:", error);
  }
}

export async function redirectIfAuthenticated() {
  const authUser = await getSignedInUserProfile();
  if (!authUser || !authUser.emailVerified) return false;

  window.location.href = authUser.role === "admin" ? "../admin/" : "../user/";
  return true;
}

export async function requireAuth(redirectTo = "../login/") {
  const authUser = await getSignedInUserProfile();
  if (!authUser || !authUser.emailVerified) {
    window.location.href = redirectTo;
    return null;
  }

  const state = getState();
  const filteredUsers = state.users.filter((item) => item.id !== authUser.id && item.email !== authUser.email);
  const nextState = {
    ...state,
    users: [...filteredUsers, authUser],
    currentUserId: authUser.id,
    isLoggedIn: true
  };
  saveLocalState(nextState);
  return authUser;
}

export function sendToVerifyEmail(user) {
  try {
    sessionStorage.setItem(PENDING_VERIFICATION_KEY, JSON.stringify(user));
  } catch (error) {
    console.warn("[CyberGuard] SessionStorage unavailable:", error);
  }
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
  try {
    sessionStorage.removeItem(PENDING_VERIFICATION_KEY);
  } catch (error) {
    console.warn("[CyberGuard] SessionStorage clear failed:", error);
  }
}

export function signInLocally(user) {
  const state = getState();
  state.users = [...state.users.filter((item) => item.id !== user.id && item.email !== user.email), user];
  state.currentUserId = user.id;
  state.isLoggedIn = true;
  saveState(state);
  return state;
}

// ==========================================================================
// 3. NAVIGATION & UI HELPERS
// ==========================================================================

export function setupNav() {
  const toggle = document.querySelector("[data-nav-toggle]");
  const nav = document.querySelector("[data-nav]");
  if (!toggle || !nav) return;

  toggle.onclick = () => {
    const isOpen = nav.classList.toggle("open");
    toggle.setAttribute("aria-expanded", String(isOpen));
  };

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
    logoutLink.className = "main-nav-link";
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

function getHomeLinkFromCurrentDepth() {
  const depth = window.location.pathname.split("/pages/").length - 1;
  return depth > 0 ? "../../index.html" : "./index.html";
}

export function setupPasswordToggles() {
  document.querySelectorAll("[data-show-password]").forEach((checkbox) => {
    const selector = checkbox.dataset.showPassword;
    if (!selector) return;
    const targets = document.querySelectorAll(selector);
    if (!targets.length) return;

    checkbox.onchange = () => {
      targets.forEach((target) => {
        target.type = checkbox.checked ? "text" : "password";
      });
    };
  });
}

export function showToast(message) {
  const existing = document.querySelector(".toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.className = "toast";
  toast.role = "status";
  toast.ariaLive = "polite";
  toast.textContent = message;

  document.body.append(toast);
  setTimeout(() => toast.remove(), 2400);
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// ==========================================================================
// 4. USER / CLASS COMPONENT RENDERERS
// ==========================================================================

export function getCurrentUser(state) {
  return state?.users?.find((item) => item.id === state.currentUserId) || null;
}

export function getActiveClass(state) {
  if (!state?.classes || state.classes.length === 0) return null;
  return state.classes.find((item) => item.id === state.activeClassId) || state.classes[0];
}

export function fullName(user) {
  if (!user) return "";
  return `${user.firstName || ""} ${user.lastName || ""}`.trim();
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
  if (!avatar || !user) return;

  if (user.photo) {
    const img = document.createElement("img");
    img.src = user.photo;
    img.alt = `${escapeHtml(fullName(user))}'s profile photo`;
    avatar.replaceChildren(img);
  } else {
    avatar.replaceChildren();
    avatar.textContent = user.avatar || initials(user.firstName, user.lastName);
  }
}

export function renderBadges(state, user) {
  const badge = document.querySelector("[data-badges]");
  if (!badge || !user) return;

  const total = (state?.classes || []).reduce((sum, klass) => sum + (klass.scores?.[user.id] || 0), 0);
  badge.replaceChildren();

  const container = document.createElement("div");
  const h2 = document.createElement("h2");
  h2.textContent = total >= 50 ? "Cyber Shield" : "Starter Shield";

  const p = document.createElement("p");
  p.className = "muted";
  p.textContent = `${total} total points collected from gameplay.`;

  container.append(h2, p);
  badge.append(container);
}

export function renderLeaderboard(selector, state, klass) {
  const root = document.querySelector(selector);
  if (!root) return;

  if (!klass || !Array.isArray(klass.students) || klass.students.length === 0) {
    root.innerHTML = `<p class="muted">No students in this class yet.</p>`;
    return;
  }

  const rows = klass.students
    .map((id) => ({ id, user: state.users.find((item) => item.id === id), score: klass.scores?.[id] || 0 }))
    .filter((row) => row.user)
    .sort((a, b) => b.score - a.score);

  if (!rows.length) {
    root.innerHTML = `<p class="muted">No active scores yet.</p>`;
    return;
  }

  root.innerHTML = rows
    .map((row, index) => `
      <div class="leaderboard-row">
        <span class="rank">${index + 1}</span>
        <strong>${escapeHtml(fullName(row.user))}</strong>
        <span class="badge">${Number(row.score)} points</span>
      </div>
    `)
    .join("");
}

// ==========================================================================
// 5. PREFERENCES & SETTINGS
// ==========================================================================

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

// ==========================================================================
// 6. PASSWORD VALIDATION & ERROR HANDLERS
// ==========================================================================

export function passwordStatus(password = "", confirmPassword = "") {
  return {
    length: password.length >= 8,
    uppercase: /[A-Z]/.test(password),
    number: /[0-9]/.test(password),
    symbol: /[^A-Za-z0-9]/.test(password),
    match: Boolean(password) && password === confirmPassword
  };
}

export function validatePassword(password = "", confirmPassword = "") {
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

// ==========================================================================
// 7. GLOBE CANVAS ANIMATION ENGINE (CLEANABLE)
// ==========================================================================

let globeAnimationFrameId = null;

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
  lastScrollY: typeof window !== "undefined" ? window.scrollY : 0,
  revealProgress: 0
};

export function setupGlobe() {
  const canvas = document.querySelector("#globeCanvas");
  if (!canvas) return () => {};

  if (globeAnimationFrameId) {
    cancelAnimationFrame(globeAnimationFrameId);
    globeAnimationFrameId = null;
  }

  globeState.canvas = canvas;
  globeState.ctx = canvas.getContext("2d");

  if (!canvas.getAttribute("role")) {
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", "Interactive CyberGuard global threat monitor");
  }

  resizeGlobe();
  updateGlobeReveal();

  const onResize = () => resizeGlobe();
  let scrollTimer = null;

  const onScroll = () => {
    const delta = Math.abs(window.scrollY - globeState.lastScrollY);
    globeState.lastScrollY = window.scrollY;
    updateGlobeReveal();
    globeState.targetSpeed = Math.min(0.12, 0.01 + delta * 0.0018);

    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      globeState.targetSpeed = globeState.visible ? 0.006 : 0.02;
    }, 180);
  };

  window.addEventListener("resize", onResize);
  window.addEventListener("scroll", onScroll, { passive: true });

  const banner = document.querySelector("[data-globe-banner]");
  let observer = null;

  if (banner && "IntersectionObserver" in window) {
    observer = new IntersectionObserver(
      ([entry]) => {
        globeState.visible = entry.isIntersecting;
        globeState.targetSpeed = entry.isIntersecting ? 0.006 : 0.02;
      },
      { threshold: 0.35 }
    );
    observer.observe(banner);
  }

  globeAnimationFrameId = requestAnimationFrame(drawGlobe);

  return () => {
    if (globeAnimationFrameId) cancelAnimationFrame(globeAnimationFrameId);
    window.removeEventListener("resize", onResize);
    window.removeEventListener("scroll", onScroll);
    if (observer) observer.disconnect();
    clearTimeout(scrollTimer);
  };
}

function updateGlobeReveal() {
  const banner = document.querySelector("[data-globe-banner]");
  if (!banner || typeof window === "undefined") return;

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
    globeAnimationFrameId = requestAnimationFrame(drawGlobe);
    return;
  }

  if (time - globeState.lastFrame < 16) {
    globeAnimationFrameId = requestAnimationFrame(drawGlobe);
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
  globeAnimationFrameId = requestAnimationFrame(drawGlobe);
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