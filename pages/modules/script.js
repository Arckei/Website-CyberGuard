import {
  ensureState,
  escapeHtml,
  fullName,
  getActiveClass,
  getState,
  hydrateStateFromFirebase,
  playerName,
  questions,
  saveState,
  setupNav,
  setupPasswordToggles,
  showToast
} from "../../shared.js";

document.addEventListener("DOMContentLoaded", async () => {
  ensureState();
  await hydrateStateFromFirebase();
  setupNav();
  setupPasswordToggles();
  setupModules();
});

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
