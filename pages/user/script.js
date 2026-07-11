const STORAGE_KEY = "cyberguard_state_v1";

const DEFAULT_SETTINGS = {
  darkMode: true,
  reduceMotion: false,
  compactDashboard: false,
  showProgressDetails: true,
  privateDashboard: false,
  reminderPrompts: true
};

const seedState = {
  currentUserId: "stu-1",
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

const questions = [
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

let globeState = {
  canvas: null,
  ctx: null,
  width: 0,
  height: 0,
  rotation: 0,
  speed: 0.006,
  targetSpeed: 0.006,
  visible: true,
  lastScrollY: window.scrollY,
  revealProgress: 0
};

document.addEventListener("DOMContentLoaded", () => {
  ensureState();
  applyCurrentUserSettings();
  setupNav();
  setupPasswordToggles();
  setupPage();
  setupGlobe();
});

function getState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return structuredClone(seedState);
  try {
    const parsed = JSON.parse(raw);
    return { ...structuredClone(seedState), ...parsed };
  } catch {
    return structuredClone(seedState);
  }
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function ensureState() {
  if (!localStorage.getItem(STORAGE_KEY)) {
    saveState(structuredClone(seedState));
  }
}

function getCurrentUserSettings(state = getState()) {
  const user = getCurrentUser(state);
  return { ...DEFAULT_SETTINGS, ...(user?.settings || {}) };
}

function applyCurrentUserSettings() {
  applySettings(getCurrentUserSettings());
}

function applySettings(settings = {}) {
  const merged = { ...DEFAULT_SETTINGS, ...settings };
  document.body.classList.toggle("theme-dark", merged.darkMode);
  document.body.classList.toggle("theme-light", !merged.darkMode);
  document.body.classList.toggle("reduce-motion", merged.reduceMotion);
  document.body.classList.toggle("compact-view", merged.compactDashboard);
  document.body.classList.toggle("private-dashboard", merged.privateDashboard);
  document.body.dataset.progressDetails = merged.showProgressDetails ? "on" : "off";
  document.body.dataset.reminders = merged.reminderPrompts ? "on" : "off";
}

function setupPage() {
  const page = document.body.dataset.page;
  if (page === "login") setupLogin();
  if (page === "signup") setupSignup();
  if (page === "user") renderUserDashboard();
  if (page === "admin") renderAdminDashboard();
  if (page === "create-class") setupCreateClass();
  if (page === "manage-class") renderManageClass();
  if (page === "manage-students") renderManageStudents();
  if (page === "join-class") setupJoinClass();
  if (page === "profile") setupProfile();
  if (page === "modules") setupModules();
}

function setupNav() {
  const toggle = document.querySelector("[data-nav-toggle]");
  const nav = document.querySelector("[data-nav]");
  if (!toggle || !nav) return;
  toggle.addEventListener("click", () => nav.classList.toggle("open"));
}

function setupPasswordToggles() {
  document.querySelectorAll("[data-show-password]").forEach((checkbox) => {
    const target = document.querySelector(checkbox.dataset.showPassword);
    if (!target) return;
    checkbox.addEventListener("change", () => {
      target.type = checkbox.checked ? "text" : "password";
    });
  });
}

function setupLogin() {
  const form = document.querySelector("[data-login-form]");
  if (!form) return;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const state = getState();
    const email = form.email.value.trim().toLowerCase();
    const role = form.role.value;
    let user = state.users.find((item) => item.email.toLowerCase() === email);

    if (!user) {
      user = {
        id: `${role}-${Date.now()}`,
        role,
        email,
        firstName: role === "admin" ? "Cyber" : "New",
        lastName: role === "admin" ? "Teacher" : "Student",
        avatar: role === "admin" ? "CT" : "NS"
      };
      state.users.push(user);
    }

    user.role = role;
    state.currentUserId = user.id;
    saveState(state);
    window.location.href = role === "admin" ? "../admin/" : "../user/";
  });
}

function setupSignup() {
  const form = document.querySelector("[data-signup-form]");
  if (!form) return;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const state = getState();
    const user = {
      id: `stu-${Date.now()}`,
      role: "student",
      email: form.email.value.trim().toLowerCase(),
      firstName: form.firstName.value.trim() || "New",
      lastName: form.lastName.value.trim() || "Student",
      avatar: initials(form.firstName.value, form.lastName.value)
    };
    state.users = state.users.filter((item) => item.email !== user.email);
    state.users.push(user);
    state.currentUserId = user.id;
    saveState(state);
    showToast("Account created.");
    window.location.href = "../user/";
  });
}

function renderUserDashboard() {
  const state = getState();
  const klass = getActiveClass(state);
  const user = getCurrentUser(state);
  const settings = getCurrentUserSettings(state);
  const score = klass?.scores[user?.id] || 0;
  renderLeaderboard("[data-leaderboard]", state, klass, settings);
  const overview = document.querySelector("[data-current-class]");
  if (overview && klass) {
    const details = settings.showProgressDetails ? `
      <div class="progress-summary">
        <div>
          <span class="metric-label">Current Score</span>
          <strong>${score}</strong>
        </div>
        <div>
          <span class="metric-label">Class Rank</span>
          <strong>${studentRank(state, klass, user?.id)}</strong>
        </div>
        <div>
          <span class="metric-label">Classmates</span>
          <strong>${klass.students.length}</strong>
        </div>
      </div>
    ` : `<p class="muted">Progress details are hidden in your profile settings.</p>`;

    overview.innerHTML = `
      <h2>${escapeHtml(klass.name)} ${escapeHtml(klass.section)}</h2>
      <p>Class code: ${escapeHtml(klass.code)}</p>
      ${details}
    `;
  }

  if (settings.reminderPrompts && !sessionStorage.getItem("cyberguard_dashboard_reminder")) {
    sessionStorage.setItem("cyberguard_dashboard_reminder", "shown");
    setTimeout(() => showToast("Reminder: check your progress dashboard after each activity."), 500);
  }
}

function renderAdminDashboard() {
  const state = getState();
  const klass = getActiveClass(state);
  renderLeaderboard("[data-leaderboard]", state, klass);
  const tracker = document.querySelector("[data-class-tracker]");
  if (tracker) {
    tracker.textContent = `${state.classes.length} class${state.classes.length === 1 ? "" : "es"} ready`;
  }
}

function setupCreateClass() {
  const form = document.querySelector("[data-create-class-form]");
  const generate = document.querySelector("[data-generate-code]");
  const code = document.querySelector("#classCode");

  if (generate && code) {
    generate.addEventListener("click", () => {
      code.value = makeCode();
    });
  }

  if (!form) return;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const state = getState();
    const id = `class-${Date.now()}`;
    const klass = {
      id,
      name: form.className.value.trim() || "Cyber Class",
      section: form.section.value.trim() || "Section",
      code: form.classCode.value.trim().toUpperCase() || makeCode(),
      teacher: `${form.firstName.value.trim()} ${form.lastName.value.trim()}`.trim() || "Cyber Teacher",
      students: ["stu-1", "stu-2", "stu-3", "stu-4"],
      scores: { "stu-1": 0, "stu-2": 0, "stu-3": 0, "stu-4": 0 },
      modules: { phishing: { complete: false } }
    };
    state.classes.push(klass);
    state.activeClassId = id;
    saveState(state);
    showToast("Class created.");
    window.location.href = "../manage-class/";
  });
}

function renderManageClass() {
  const state = getState();
  const classList = document.querySelector("[data-class-list]");
  const sectionList = document.querySelector("[data-section-list]");
  const active = getActiveClass(state);

  if (classList) {
    classList.innerHTML = state.classes.map((klass) => `
      <button class="class-tab ${klass.id === state.activeClassId ? "active" : ""}" type="button" data-select-class="${klass.id}">
        <strong>${escapeHtml(klass.name)}</strong><br />
        <span class="muted">${escapeHtml(klass.section)}</span>
      </button>
    `).join("");

    classList.querySelectorAll("[data-select-class]").forEach((button) => {
      button.addEventListener("click", () => {
        state.activeClassId = button.dataset.selectClass;
        saveState(state);
        renderManageClass();
      });
    });
  }

  if (sectionList && active) {
    sectionList.innerHTML = `
      <div class="section-row">
        <div>
          <h2>${escapeHtml(active.section)}</h2>
          <p class="muted">${active.students.length} students joined with code ${escapeHtml(active.code)}</p>
        </div>
        <a class="btn" href="manage-students.html">Manage</a>
      </div>
    `;
  }
}

function renderManageStudents() {
  const state = getState();
  const klass = getActiveClass(state);
  const title = document.querySelector("[data-class-title]");
  const list = document.querySelector("[data-student-list]");
  if (!klass || !list) return;

  if (title) title.textContent = `${klass.name} / ${klass.section}`;
  list.innerHTML = klass.students.map((id) => {
    const user = state.users.find((item) => item.id === id);
    if (!user) return "";
    return `
      <div class="student-row">
        <strong>${escapeHtml(fullName(user))}</strong>
        <span class="badge">${klass.scores[id] || 0} points</span>
        <button class="btn danger" type="button" data-remove-student="${id}">Remove</button>
      </div>
    `;
  }).join("");

  list.querySelectorAll("[data-remove-student]").forEach((button) => {
    button.addEventListener("click", () => {
      klass.students = klass.students.filter((id) => id !== button.dataset.removeStudent);
      delete klass.scores[button.dataset.removeStudent];
      saveState(state);
      renderManageStudents();
    });
  });
}

function setupJoinClass() {
  const form = document.querySelector("[data-join-class-form]");
  if (!form) return;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const state = getState();
    const code = form.classCode.value.trim().toUpperCase();
    const klass = state.classes.find((item) => item.code.toUpperCase() === code);
    const user = getCurrentUser(state);

    if (!klass || !user) {
      showToast("Class code was not found.");
      return;
    }

    if (!klass.students.includes(user.id)) {
      klass.students.push(user.id);
      klass.scores[user.id] = klass.scores[user.id] || 0;
    }
    state.activeClassId = klass.id;
    saveState(state);
    showToast("Joined class.");
    window.location.href = "../user/";
  });
}

function setupProfile() {
  const state = getState();
  const user = getCurrentUser(state);
  const form = document.querySelector("[data-profile-form]");
  if (!form || !user) return;

  form.firstName.value = user.firstName;
  form.lastName.value = user.lastName;
  form.email.value = user.email;
  renderAvatar(user);
  renderBadges(state, user);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    user.firstName = form.firstName.value.trim() || user.firstName;
    user.lastName = form.lastName.value.trim() || user.lastName;
    user.email = form.email.value.trim() || user.email;
    user.avatar = initials(user.firstName, user.lastName);
    saveState(state);
    renderAvatar(user);
    showToast("Profile saved.");
  });
}

function setupModules() {
  renderGame();
  document.querySelectorAll("[data-module-button]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll("[data-module-button]").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      renderGame();
    });
  });
}

let gameTurn = 0;
let questionIndex = 0;
let lockedAnswer = false;

function renderGame() {
  const state = getState();
  const klass = getActiveClass(state);
  const root = document.querySelector("[data-game]");
  if (!root || !klass) return;
  const availablePlayers = klass.students.slice(0, 4);
  const question = questions[questionIndex % questions.length];

  root.innerHTML = `
    <div class="game-stage">
      <section class="question-panel">
        <div class="question-head">Question</div>
        <div class="question-body">
          <div class="question-text">${escapeHtml(question.text)}</div>
          <div class="answer-list">
            ${question.options.map((option, index) => `
              <button class="answer-option" type="button" data-answer="${index}">${escapeHtml(option)}</button>
            `).join("")}
          </div>
        </div>
      </section>
      <section class="players-floor">
        <div class="player-grid">
          ${availablePlayers.map((id, index) => playerCard(state, klass, id, index === gameTurn % availablePlayers.length)).join("")}
        </div>
      </section>
    </div>
  `;

  root.querySelectorAll("[data-answer]").forEach((button) => {
    button.addEventListener("click", () => answerQuestion(Number(button.dataset.answer)));
  });
}

function answerQuestion(index) {
  if (lockedAnswer) return;
  lockedAnswer = true;
  const state = getState();
  const klass = getActiveClass(state);
  if (!klass) return;
  const players = klass.students.slice(0, 4);
  const activeId = players[gameTurn % players.length];
  const question = questions[questionIndex % questions.length];
  const correct = index === question.answer;
  const buttons = document.querySelectorAll("[data-answer]");

  buttons.forEach((button) => {
    const answer = Number(button.dataset.answer);
    if (answer === question.answer) button.classList.add("correct");
    if (answer === index && !correct) button.classList.add("wrong");
  });

  klass.scores[activeId] = Math.max(0, (klass.scores[activeId] || 0) + (correct ? 10 : -2));
  saveState(state);
  showToast(`${playerName(state, activeId)} ${correct ? "earned 10 points" : "lost 2 points"}.`);

  setTimeout(() => {
    gameTurn = (gameTurn + 1) % players.length;
    questionIndex += 1;
    lockedAnswer = false;
    renderGame();
  }, 850);
}

function playerCard(state, klass, id, active) {
  const user = state.users.find((item) => item.id === id);
  return `
    <article class="player-card ${active ? "active" : ""}">
      <div class="player-status">${active ? "Playing" : "Available"}</div>
      <div class="pixel-student" aria-hidden="true"></div>
      <div class="player-meta">
        <strong>${escapeHtml(user ? fullName(user) : "Student")}</strong>
        <span class="score">${klass.scores[id] || 0} pts</span>
      </div>
    </article>
  `;
}

function renderLeaderboard(selector, state, klass, settings = getCurrentUserSettings(state)) {
  const root = document.querySelector(selector);
  if (!root || !klass) return;
  const rows = klass.students
    .map((id) => ({ id, user: state.users.find((item) => item.id === id), score: klass.scores[id] || 0 }))
    .filter((row) => row.user)
    .sort((a, b) => b.score - a.score);

  root.innerHTML = rows.length ? rows.map((row, index) => `
    <div class="leaderboard-row">
      <span class="rank">${index + 1}</span>
      <strong>${settings.privateDashboard ? `Student ${index + 1}` : escapeHtml(fullName(row.user))}</strong>
      <span class="badge">${row.score} points</span>
    </div>
  `).join("") : `<p class="muted">No students yet.</p>`;
}

function studentRank(state, klass, userId) {
  if (!userId) return "-";
  const rows = klass.students
    .map((id) => ({ id, score: klass.scores[id] || 0 }))
    .sort((a, b) => b.score - a.score);
  const index = rows.findIndex((row) => row.id === userId);
  return index >= 0 ? `#${index + 1}` : "-";
}

function setupGlobe() {
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
  const dpr = window.devicePixelRatio || 1;
  globeState.width = Math.max(1, Math.floor(rect.width));
  globeState.height = Math.max(1, Math.floor(rect.height));
  canvas.width = Math.floor(globeState.width * dpr);
  canvas.height = Math.floor(globeState.height * dpr);
  globeState.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function drawGlobe(time) {
  const { ctx, width, height } = globeState;
  if (!ctx) return;
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

function getCurrentUser(state) {
  return state.users.find((item) => item.id === state.currentUserId) || state.users[0];
}

function getActiveClass(state) {
  return state.classes.find((item) => item.id === state.activeClassId) || state.classes[0];
}

function fullName(user) {
  return `${user.firstName} ${user.lastName}`.trim();
}

function playerName(state, id) {
  const user = state.users.find((item) => item.id === id);
  return user ? fullName(user) : "Student";
}

function initials(firstName, lastName) {
  const first = (firstName || "N").trim().charAt(0);
  const last = (lastName || "S").trim().charAt(0);
  return `${first}${last}`.toUpperCase();
}

function makeCode() {
  return `CG${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function renderAvatar(user) {
  const avatar = document.querySelector("[data-avatar]");
  if (avatar) avatar.textContent = user.avatar || initials(user.firstName, user.lastName);
}

function renderBadges(state, user) {
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

function showToast(message) {
  const existing = document.querySelector(".toast");
  if (existing) existing.remove();
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.append(toast);
  setTimeout(() => toast.remove(), 2400);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

