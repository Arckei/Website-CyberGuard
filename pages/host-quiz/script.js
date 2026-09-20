import {
  advanceToQuestion,
  allJoinedAreReady,
  awardMiniGameBonus,
  endMiniGame,
  endQuizSession,
  gradeQuestion,
  getQuiz,
  launchMiniGame,
  leaderboardFromSession,
  listQuizzes,
  openQuizLobby,
  sendQuizScoresToStudents,
  startQuizSession,
  subscribeToAnswers,
  subscribeToMiniGameResults,
  subscribeToParticipants,
  subscribeToQuizzes,
  subscribeToSession
} from "../../services/quiz-service.js";
import {
  ensureState,
  escapeHtml,
  fullName,
  getState,
  hydrateStateFromFirebase,
  initPageAnimations,
  requireAuth,
  setupNav,
  setupPasswordToggles,
  showToast
} from "../../services/shared.js";

let classes = [];
let quizzes = [];

// The live session this host is currently running. `quiz` holds the FULL
// quiz doc (with correct answers) — only ever read by this admin client,
// never written to students.
const host = {
  session: null,
  quiz: null,
  participants: [],
  answers: [],
  miniGameResults: [],
  awardedMiniGameUids: new Set(),
  unsubscribeSession: () => {},
  unsubscribeParticipants: () => {},
  unsubscribeAnswers: () => {},
  unsubscribeMiniGame: () => {}
};

document.addEventListener("DOMContentLoaded", async () => {
  ensureState();
  const authUser = await requireAuth("../login/");
  if (!authUser) return;
  await hydrateStateFromFirebase();
  setupNav();
  setupPasswordToggles();

  if (authUser.role !== "admin") {
    showToast("Admin access only.");
    window.location.href = "../user/";
    return;
  }

  classes = getState().classes || [];
  populateClassSelect();

  quizzes = await listQuizzes();
  populateQuizSelect();
  subscribeToQuizzes((nextQuizzes) => {
    quizzes = nextQuizzes;
    populateQuizSelect();
  });

  document.querySelector("[data-open-lobby]").addEventListener("click", handleOpenLobby);
  initPageAnimations();
});

function populateClassSelect() {
  const select = document.querySelector("[data-select-class]");
  select.innerHTML = classes
    .map((klass) => `<option value="${klass.id}">${escapeHtml(klass.name)} \u2014 ${escapeHtml(klass.section)}</option>`)
    .join("") || `<option value="">No classes yet</option>`;
}

function populateQuizSelect() {
  const select = document.querySelector("[data-select-quiz]");
  const previousValue = select.value;
  select.innerHTML = quizzes
    .map((quiz) => `<option value="${quiz.id}">${escapeHtml(quiz.title)} (${(quiz.questions || []).length} Q)</option>`)
    .join("") || `<option value="">No quizzes yet \u2014 make one first</option>`;
  if (previousValue) select.value = previousValue;
}

// ==========================================================================
// STEP 1 -> STEP 2: open the lobby
// ==========================================================================

async function handleOpenLobby() {
  const classId = document.querySelector("[data-select-class]").value;
  const quizId = document.querySelector("[data-select-quiz]").value;
  const joinMinutes = Number(document.querySelector("[data-join-minutes]").value) || 5;

  if (!classId) return showToast("Pick a class first.");
  if (!quizId) return showToast("Pick (or make) a quiz first.");

  const button = document.querySelector("[data-open-lobby]");
  button.disabled = true;
  button.textContent = "Opening\u2026";

  try {
    host.quiz = await getQuiz(quizId);
    const session = await openQuizLobby({ quizId, classId, joinWindowMs: joinMinutes * 60 * 1000 });

    document.querySelector("[data-setup-panel]").hidden = true;
    document.querySelector("[data-console]").hidden = false;

    host.unsubscribeSession = subscribeToSession(session.id, onSessionChange);
    host.unsubscribeParticipants = subscribeToParticipants(session.id, onParticipantsChange);
  } catch (error) {
    showToast(error.message || "Could not open the quiz lobby.");
  } finally {
    button.disabled = false;
    button.textContent = "Start A Quiz \u2014 Open Lobby";
  }
}

function onSessionChange(session) {
  host.session = session;
  renderConsole();
  renderLeaderboard();
}

function onParticipantsChange(participants) {
  host.participants = participants;
  renderConsole();
  renderLeaderboard();
}

function renderLeaderboard() {
  const root = document.querySelector("[data-host-leaderboard]");
  if (!host.session) {
    root.innerHTML = `<p class="muted">Scores will appear here once the quiz starts.</p>`;
    return;
  }
  const rows = leaderboardFromSession(host.session, host.participants);
  root.innerHTML = rows.length
    ? rows
        .map(
          (row, index) => `
            <div class="leaderboard-row">
              <span class="rank">${index + 1}</span>
              <strong>${escapeHtml(row.name)}</strong>
<<<<<<< HEAD
              <span class="badge">${row.score} points</span>
=======
              <span class="badge">${row.score} pts</span>
              <div class="leaderboard-bar-track"><div class="leaderboard-bar-fill" style="width:${(row.score / maxScore) * 100}%"></div></div>
>>>>>>> parent of 077c475 (Add profile viewer modal for displaying user scores and quiz history)
            </div>
          `
        )
        .join("")
<<<<<<< HEAD
    : `<p class="muted">No points scored yet.</p>`;
=======
    : `<p class="muted">No one has joined yet.</p>`;
>>>>>>> parent of 077c475 (Add profile viewer modal for displaying user scores and quiz history)
}

// ==========================================================================
// CONSOLE RENDERING (one function per session status)
// ==========================================================================

function renderConsole() {
  if (!host.session) return;
  const body = document.querySelector("[data-console-body]");

  if (host.session.status === "lobby") return renderLobbyConsole(body);
  if (host.session.status === "live") return renderLiveConsole(body);
  if (host.session.status === "minigame") return renderMiniGameConsole(body);
  if (host.session.status === "ended") return renderEndedConsole(body);
}

function renderLobbyConsole(body) {
  const joined = host.participants.filter((p) => p.status === "joined");
  const readyCount = joined.filter((p) => p.ready).length;
  const canStart = allJoinedAreReady(host.participants);
  const msLeft = Number(host.session.joinDeadlineAt || 0) - Date.now();

  const rows = host.participants
    .map(
      (participant) => `
        <div class="student-row">
<<<<<<< HEAD
=======
          ${avatarBubble(participant)}
>>>>>>> parent of 077c475 (Add profile viewer modal for displaying user scores and quiz history)
          <strong>${escapeHtml(participant.name)}${participant.status === "late" ? " (late)" : ""}</strong>
          <span class="badge">${participant.ready ? "Ready \u2705" : "Not ready \u23F3"}</span>
        </div>
      `
    )
    .join("");

  body.innerHTML = `
    <h2>${escapeHtml(host.session.quizTitle)} \u2014 Lobby</h2>
    <p class="muted">Join window closes in <strong data-lobby-countdown>${formatCountdown(msLeft)}</strong>. ${joined.length} joined, ${readyCount} ready.</p>
    <div class="list-stack" style="margin-top: 12px;">${rows || '<p class="muted">Waiting for students to join\u2026</p>'}</div>
    <div class="button-row" style="margin-top: 18px;">
      <button class="btn primary" type="button" data-start-quiz ${canStart ? "" : "disabled"}>Start Quiz</button>
      <button class="btn ghost" type="button" data-start-anyway>Start Anyway</button>
      <button class="btn danger" type="button" data-cancel-lobby>Cancel</button>
    </div>
  `;

  document.querySelector("[data-start-quiz]").addEventListener("click", () => beginQuiz());
  document.querySelector("[data-start-anyway]").addEventListener("click", () => beginQuiz());
  document.querySelector("[data-cancel-lobby]").addEventListener("click", () => endQuizSession(host.session.id));
<<<<<<< HEAD
=======
  body.querySelectorAll("[data-remove-participant]").forEach((button) => {
    button.addEventListener("click", () => removeParticipant(host.session.id, button.dataset.removeParticipant));
  });
>>>>>>> parent of 077c475 (Add profile viewer modal for displaying user scores and quiz history)

  if (!body.dataset.tickerAttached) {
    body.dataset.tickerAttached = "true";
    const ticker = setInterval(() => {
      if (!host.session || host.session.status !== "lobby") {
        clearInterval(ticker);
        return;
      }
      const el = document.querySelector("[data-lobby-countdown]");
      if (el) el.textContent = formatCountdown(Number(host.session.joinDeadlineAt || 0) - Date.now());
    }, 1000);
  }
}

async function beginQuiz() {
  try {
    await startQuizSession(host.session.id, host.quiz);
  } catch (error) {
    showToast(error.message || "Could not start the quiz.");
  }
}

function renderLiveConsole(body) {
  const question = host.session.currentQuestion;
  const index = host.session.currentQuestionIndex;
  const fullQuestion = host.quiz.questions[index];
  delete document.querySelector("[data-console-body]").dataset.tickerAttached;

  if (!question || !fullQuestion) {
    host.unsubscribeAnswers();
    body.innerHTML = `<h2>${escapeHtml(host.session.quizTitle)}</h2><p class="muted">No more questions.</p>
      <div class="button-row" style="margin-top: 14px;"><button class="btn danger" type="button" data-end-quiz>End Quiz</button></div>`;
    document.querySelector("[data-end-quiz]").addEventListener("click", () => endQuizSession(host.session.id));
    return;
  }

  host.unsubscribeAnswers();
  host.answers = [];
  host.unsubscribeAnswers = subscribeToAnswers(host.session.id, question.id, (answers) => {
    host.answers = answers;
    const counter = document.querySelector("[data-answer-count]");
    if (counter) counter.textContent = `${answers.length}`;
  });

  const joinedCount = host.participants.filter((p) => p.status === "joined").length;
  const choicesHtml = fullQuestion.choices
    .map((choice, choiceIndex) => `<div class="student-row ${choiceIndex === fullQuestion.correctIndex ? "correct-choice" : ""}">${escapeHtml(choice)} ${choiceIndex === fullQuestion.correctIndex ? "\u2705 (correct)" : ""}</div>`)
    .join("");

  body.innerHTML = `
    <h2>Question ${index + 1} of ${host.quiz.questions.length}</h2>
    <p class="eyebrow">${question.points} points \u00B7 ${fullQuestion.timeLimitSec}s</p>
    <p style="font-size:18px; font-weight:700;">${escapeHtml(fullQuestion.prompt)}</p>
    <div class="list-stack" style="margin-top:10px;">${choicesHtml}</div>
    <p class="muted" style="margin-top:10px;"><span data-answer-count>${host.answers.length}</span> / ${joinedCount} students have answered.</p>
    <div class="button-row" style="margin-top: 18px;">
      <button class="btn primary" type="button" data-grade-next>${index + 1 >= host.quiz.questions.length ? "Grade & Finish" : "Grade & Next Question"}</button>
      <button class="btn secondary" type="button" data-launch-minigame>Launch Bonus Mini-Game</button>
      <button class="btn danger" type="button" data-end-quiz>End Quiz Now</button>
    </div>
  `;

  document.querySelector("[data-grade-next]").addEventListener("click", () => gradeAndAdvance(index, fullQuestion));
  document.querySelector("[data-launch-minigame]").addEventListener("click", () => launchMiniGame(host.session.id, { durationSec: 30 }));
  document.querySelector("[data-end-quiz]").addEventListener("click", () => endQuizSession(host.session.id));
}

async function gradeAndAdvance(index, fullQuestion) {
  const button = document.querySelector("[data-grade-next]");
  button.disabled = true;
  try {
    const result = await gradeQuestion(host.session.id, fullQuestion, host.answers, host.participants);
    showToast(`${result.correctCount} of ${result.totalAnswers} got it right.`);
    await advanceToQuestion(host.session.id, host.quiz, index + 1);
  } catch (error) {
    showToast(error.message || "Could not grade this question.");
    button.disabled = false;
  }
}

function renderMiniGameConsole(body) {
  host.unsubscribeMiniGame();
  host.miniGameResults = [];
  host.unsubscribeMiniGame = subscribeToMiniGameResults(host.session.id, (results) => {
    host.miniGameResults = results;
    const counter = document.querySelector("[data-minigame-count]");
    if (counter) counter.textContent = `${results.length}`;
  });

  body.innerHTML = `
    <h2>Bonus Mini-Game in Progress</h2>
    <p class="muted"><span data-minigame-count>${host.miniGameResults.length}</span> students have submitted a bonus score.</p>
    <div class="button-row" style="margin-top: 18px;">
      <button class="btn primary" type="button" data-end-minigame>End Bonus Round & Award Points</button>
    </div>
  `;

  document.querySelector("[data-end-minigame]").addEventListener("click", handleEndMiniGame);
}

async function handleEndMiniGame() {
  const button = document.querySelector("[data-end-minigame]");
  button.disabled = true;
  try {
    for (const result of host.miniGameResults) {
      if (host.awardedMiniGameUids.has(result.uid)) continue;
      await awardMiniGameBonus(host.session.id, result.uid, Number(result.rawScore) || 0);
      host.awardedMiniGameUids.add(result.uid);
    }
    await endMiniGame(host.session.id);
    showToast("Bonus points awarded!");
  } catch (error) {
    showToast(error.message || "Could not close the bonus round.");
    button.disabled = false;
  }
}

function renderEndedConsole(body) {
  const rows = leaderboardFromSession(host.session, host.participants)
<<<<<<< HEAD
    .map((row, index) => `<div class="student-row"><strong>${index + 1}. ${escapeHtml(row.name)}</strong><span class="badge">${row.score} pts</span></div>`)
=======
    .map((row, index) => `<div class="student-row">${avatarBubble(row)}<strong>${index + 1}. ${escapeHtml(row.name)}</strong><span class="badge">${row.score} pts</span></div>`)
>>>>>>> parent of 077c475 (Add profile viewer modal for displaying user scores and quiz history)
    .join("");

  body.innerHTML = `
    <h2>${escapeHtml(host.session.quizTitle)} \u2014 Final Results</h2>
    <div class="list-stack" style="margin-top: 10px;">${rows || '<p class="muted">No scores recorded.</p>'}</div>
    <label class="check-row" style="margin-top:16px;">
      <input type="checkbox" data-add-to-class checked />
      <span>Also add these points to each student's class total</span>
    </label>
    <div class="button-row" style="margin-top: 14px;">
      <button class="btn primary" type="button" data-send-scores ${host.session.scoresSent ? "disabled" : ""}>${host.session.scoresSent ? "Scores Sent \u2713" : "Send Scores to Students"}</button>
      <button class="btn ghost" type="button" data-host-another>Host Another Quiz</button>
    </div>
  `;

  document.querySelector("[data-send-scores]").addEventListener("click", handleSendScores);
  document.querySelector("[data-host-another]").addEventListener("click", resetToSetup);
}

async function handleSendScores() {
  const button = document.querySelector("[data-send-scores]");
  const addToClassScore = document.querySelector("[data-add-to-class]").checked;
  button.disabled = true;
  button.textContent = "Sending\u2026";
  try {
    const count = await sendQuizScoresToStudents(host.session, host.participants, { addToClassScore });
    showToast(`Sent scores directly to ${count} student${count === 1 ? "" : "s"}.`);
    button.textContent = "Scores Sent \u2713";
  } catch (error) {
    showToast(error.message || "Could not send scores.");
    button.disabled = false;
    button.textContent = "Send Scores to Students";
  }
}

function resetToSetup() {
  host.unsubscribeSession();
  host.unsubscribeParticipants();
  host.unsubscribeAnswers();
  host.unsubscribeMiniGame();
  host.session = null;
  host.quiz = null;
  host.participants = [];
  host.answers = [];
  host.miniGameResults = [];
  host.awardedMiniGameUids = new Set();

  document.querySelector("[data-console]").hidden = true;
  document.querySelector("[data-setup-panel]").hidden = false;
}

function formatCountdown(msRemaining) {
  const total = Math.max(0, Math.ceil(msRemaining / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

window.addEventListener("beforeunload", () => {
  host.unsubscribeSession();
  host.unsubscribeParticipants();
  host.unsubscribeAnswers();
  host.unsubscribeMiniGame();
});
