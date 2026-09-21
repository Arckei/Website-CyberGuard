// quiz-student-widget.js
// Drop this <script type="module" src="../../services/quiz-student-widget.js">
// tag onto any signed-in student page. It:
//   1. Watches the student's active class for a live quiz session.
//   2. Lights up a floating "Join Quiz" bar (and, on the dashboard, turns
//      the existing "Modules" button into a glowing "Join Quiz" button)
//      the moment the admin opens the lobby, with a toast notification.
//   3. Runs the whole student flow in a modal: ready-check lobby with a
//      countdown, live question answering, the bonus mini-game, and the
//      final results screen.
// It does nothing (and adds nothing to the page) for admins, or for
// students who aren't in a class yet.

import {
  isWithinJoinWindow,
  joinSession,
  leaderboardFromSession,
  setReady,
  subscribeToActiveSessionForClass,
  subscribeToParticipants,
  submitAnswer,
  submitMiniGameResult
} from "./quiz-service.js";
import { mountPhishBlitz } from "./minigame-phish-blitz.js";
import { escapeHtml, fullName, getActiveClass, getCurrentUser, getState, initials, showToast } from "./shared.js";

const answeredStore = {
  key: (sessionId) => `cg_quiz_answered_${sessionId}`,
  has(sessionId, questionId) {
    try {
      const raw = JSON.parse(localStorage.getItem(this.key(sessionId)) || "[]");
      return raw.includes(questionId);
    } catch {
      return false;
    }
  },
  add(sessionId, questionId) {
    try {
      const raw = JSON.parse(localStorage.getItem(this.key(sessionId)) || "[]");
      if (!raw.includes(questionId)) raw.push(questionId);
      localStorage.setItem(this.key(sessionId), JSON.stringify(raw));
    } catch {
      // best-effort only — worst case the student can re-tap an answer
    }
  }
};

function formatCountdown(msRemaining) {
  const total = Math.max(0, Math.ceil(msRemaining / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

// Small colored initials badge — a lightweight "player profile" look next
// to names in the lobby and leaderboard, without fetching every photo.
const AVATAR_COLORS = ["#ff303c", "#d9aa6a", "#34c684", "#4aa8ff", "#c77dff", "#ffb03a"];
function avatarBubble(participant) {
  const seed = [...(participant.uid || "")].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const color = AVATAR_COLORS[seed % AVATAR_COLORS.length];
  const label = escapeHtml((participant.avatarInitials || participant.name || "S").slice(0, 2));
  return `<span class="cg-quiz-avatar" style="background:${color};">${label}</span>`;
}

// Deterministic shuffle seeded by a string (uid + question id), so a given
// student sees the same shuffled choice order on every re-render, but two
// different students see different orders — that's the whole point of the
// "shuffle answers" option (no more "sagot niyo C" across the room).
function seededShuffle(array, seedStr) {
  let seed = 0;
  for (let i = 0; i < seedStr.length; i += 1) {
    seed = (Math.imul(31, seed) + seedStr.charCodeAt(i)) | 0;
  }
  seed = seed >>> 0;
  const next = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const result = array.slice();
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function ensureStyles() {
  if (document.getElementById("cg-quiz-widget-styles")) return;
  const style = document.createElement("style");
  style.id = "cg-quiz-widget-styles";
  style.textContent = `
    @keyframes cg-quiz-glow {
      0%, 100% { box-shadow: 0 0 0 0 rgba(255, 48, 60, 0.55); }
      50% { box-shadow: 0 0 0 10px rgba(255, 48, 60, 0); }
    }
    #cg-quiz-bar {
      position: fixed;
      left: 50%;
      bottom: 22px;
      transform: translateX(-50%) translateY(120%);
      z-index: 9000;
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px;
      border-radius: 999px;
      background: linear-gradient(90deg, #ff303c, #d9aa6a);
      box-shadow: 0 12px 28px rgba(0,0,0,0.35);
      transition: transform 0.35s ease, opacity 0.35s ease;
      opacity: 0;
    }
    #cg-quiz-bar.cg-visible { transform: translateX(-50%) translateY(0); opacity: 1; }
    #cg-quiz-bar.cg-glow { animation: cg-quiz-glow 1.6s ease-in-out infinite; }
    #cg-quiz-bar .cg-quiz-dot { width: 8px; height: 8px; border-radius: 50%; background: #fff; }
    .cg-quiz-bar-open {
      display: flex; align-items: center; gap: 10px;
      padding: 8px 16px; border-radius: 999px; border: none;
      background: transparent; color: #fff; font-weight: 800; font-size: 14px; cursor: pointer;
    }
    .cg-quiz-bar-dismiss {
      width: 26px; height: 26px; border-radius: 50%; border: none;
      background: rgba(0,0,0,0.2); color: #fff; font-size: 13px; line-height: 1; cursor: pointer;
      display: grid; place-items: center; flex-shrink: 0;
    }

    .action-quiz.quiz-live,
    .cg-quiz-inline-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
    }
    .cg-quiz-inline-btn {
      width: 100%;
      margin-top: 10px;
      background: linear-gradient(90deg, #ff303c, #d9aa6a);
      color: #fff;
      border: none;
    }
    .cg-quiz-inline-btn.cg-glow { animation: cg-quiz-glow 1.6s ease-in-out infinite; }
    .cg-quiz-inline-icon {
      width: 18px;
      height: 18px;
      background: #fff;
      -webkit-mask-image: url("data:image/svg+xml,%3Csvg%20xmlns%3D%27http%3A//www.w3.org/2000/svg%27%20viewBox%3D%270%200%2024%2024%27%20fill%3D%27none%27%20stroke%3D%27black%27%20stroke-width%3D%272%27%20stroke-linecap%3D%27round%27%20stroke-linejoin%3D%27round%27%3E%3Cpath%20d%3D%27M13%202%203%2014h7l-1%208%2010-12h-7l1-8z%27/%3E%3C/svg%3E");
      mask-image: url("data:image/svg+xml,%3Csvg%20xmlns%3D%27http%3A//www.w3.org/2000/svg%27%20viewBox%3D%270%200%2024%2024%27%20fill%3D%27none%27%20stroke%3D%27black%27%20stroke-width%3D%272%27%20stroke-linecap%3D%27round%27%20stroke-linejoin%3D%27round%27%3E%3Cpath%20d%3D%27M13%202%203%2014h7l-1%208%2010-12h-7l1-8z%27/%3E%3C/svg%3E");
      -webkit-mask-size: contain;
      mask-size: contain;
    }

    #cg-quiz-overlay {
      position: fixed; inset: 0; z-index: 9100;
      background: rgba(3,4,5,0.72);
      display: none;
      align-items: center;
      justify-content: center;
      padding: 18px;
    }
    #cg-quiz-overlay.cg-open { display: flex; }
    #cg-quiz-modal {
      width: min(460px, 100%);
      max-height: 88vh;
      overflow-y: auto;
      background: linear-gradient(180deg, #24272b 0%, #16181b 55%, #0e1114 100%);
      border: 1px solid #2b3036;
      border-radius: 16px;
      padding: 22px;
      color: #f2f4f5;
      position: relative;
    }
    #cg-quiz-modal h2 { margin: 0 0 4px; font-size: 19px; }
    #cg-quiz-modal .muted { color: #9aa3ad; font-size: 13px; }
    .cg-quiz-close { float: right; background: none; border: none; color: #9aa3ad; font-size: 18px; cursor: pointer; }
    .cg-quiz-countdown { font-size: 30px; font-weight: 800; text-align: center; margin: 10px 0; }
    .cg-quiz-btn {
      display: block; width: 100%; padding: 13px; margin-top: 12px;
      border-radius: 10px; border: none; background: #ff303c; color: #fff;
      font-weight: 800; font-size: 14px; cursor: pointer;
    }
    .cg-quiz-btn.secondary { background: #171b1f; border: 1px solid #2b3036; color: #f2f4f5; }
    .cg-quiz-btn:disabled { opacity: 0.55; cursor: default; }
    /* The question prompt gets the same red\u2192gold glow already used for
       the site's primary buttons/bars, so it reads as the focal point of
       the screen. It also softly pulses/shifts on its own (not tied to a
       timer) so the question area feels alive, not static. Answer choices
       stay a plain, easy-to-scan list. */
    .cg-quiz-question-box {
      background: linear-gradient(135deg, rgba(255,48,60,0.18), rgba(217,170,106,0.12));
      border: 1px solid rgba(217,170,106,0.4);
      border-radius: 14px;
      padding: 18px;
      margin-top: 10px;
      animation: cg-quiz-question-glow 4s ease-in-out infinite;
    }
    @keyframes cg-quiz-question-glow {
      0%, 100% { box-shadow: 0 0 22px rgba(255,48,60,0.28); }
      50% { box-shadow: 0 0 40px rgba(217,170,106,0.4); }
    }
    .cg-quiz-question-box h2 { font-size: 20px; }
    .cg-quiz-choice-list { display: flex; flex-direction: column; gap: 8px; margin-top: 14px; }
    .cg-quiz-choice {
      text-align: left; padding: 13px 16px; border-radius: 10px;
      border: 1px solid #2b3036; background: #171b1f; color: #f2f4f5;
      cursor: pointer; font-size: 15px;
    }
    .cg-quiz-choice[disabled] { cursor: default; opacity: 0.7; }
    .cg-quiz-choice.picked { border-color: #ff303c; background: rgba(255,48,60,0.15); }
    .cg-quiz-timer-track { height: 6px; border-radius: 99px; background: #171b1f; margin-top: 10px; overflow: hidden; }
    .cg-quiz-timer-fill { height: 100%; background: #d9aa6a; transition: width 0.1s linear; }
    .cg-quiz-participant-row, .cg-quiz-lb-row {
      display: flex; align-items: center; gap: 10px; justify-content: space-between; padding: 8px 0;
      border-bottom: 1px solid #2b3036; font-size: 13px;
    }
    .cg-quiz-participant-row > span:first-child, .cg-quiz-lb-row > span:first-child {
      display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0;
    }
    .cg-quiz-avatar {
      width: 26px; height: 26px; border-radius: 50%; flex-shrink: 0;
      display: grid; place-items: center; font-size: 11px; font-weight: 800; color: #06120c;
    }
    .cg-quiz-lb-bar-track { height: 4px; border-radius: 99px; background: #171b1f; margin-top: 4px; overflow: hidden; }
    .cg-quiz-lb-bar-fill { height: 100%; background: linear-gradient(90deg, #ff303c, #d9aa6a); }
    .cg-quiz-late-note {
      background: rgba(217,170,106,0.15); border: 1px solid rgba(217,170,106,0.4);
      color: #d9aa6a; padding: 8px 10px; border-radius: 8px; font-size: 12px; margin-bottom: 10px;
    }
    #cg-quiz-minigame-slot { margin-top: 10px; }
  `;
  document.head.append(style);
}

function buildDom() {
  ensureStyles();

  if (!document.getElementById("cg-quiz-bar")) {
    const bar = document.createElement("div");
    bar.id = "cg-quiz-bar";
    bar.innerHTML = `
      <button type="button" class="cg-quiz-bar-open" data-cg-bar-open><span class="cg-quiz-dot"></span><span data-cg-quiz-bar-label>Quiz</span></button>
      <button type="button" class="cg-quiz-bar-dismiss" data-cg-bar-dismiss aria-label="Dismiss">\u2715</button>
    `;
    document.body.append(bar);
  }

  // A separate button placed right under the existing "Modules" button on
  // the student dashboard — not a takeover of that button. Hidden until a
  // quiz goes live for the student's class.
  const moduleButton = document.querySelector(".action-module");
  if (moduleButton && !document.getElementById("cg-quiz-inline-btn")) {
    const inlineBtn = document.createElement("button");
    inlineBtn.id = "cg-quiz-inline-btn";
    inlineBtn.type = "button";
    inlineBtn.className = "btn cg-quiz-inline-btn";
    inlineBtn.hidden = true;
    inlineBtn.innerHTML = `<span class="cg-quiz-inline-icon" aria-hidden="true"></span><span data-cg-inline-label>Join Quiz</span>`;
    moduleButton.insertAdjacentElement("afterend", inlineBtn);
  }

  if (!document.getElementById("cg-quiz-overlay")) {
    const overlay = document.createElement("div");
    overlay.id = "cg-quiz-overlay";
    overlay.innerHTML = `<div id="cg-quiz-modal" role="dialog" aria-modal="true"><button class="cg-quiz-close" type="button" data-cg-quiz-close aria-label="Close">\u2715</button><div data-cg-quiz-body></div></div>`;
    document.body.append(overlay);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) overlay.classList.remove("cg-open");
    });
    overlay.querySelector("[data-cg-quiz-close]").addEventListener("click", () => {
      overlay.classList.remove("cg-open");
    });
  }

  return {
    bar: document.getElementById("cg-quiz-bar"),
    barOpen: document.querySelector("[data-cg-bar-open]"),
    barDismiss: document.querySelector("[data-cg-bar-dismiss]"),
    barLabel: document.querySelector("[data-cg-quiz-bar-label]"),
    inlineBtn: document.getElementById("cg-quiz-inline-btn"),
    overlay: document.getElementById("cg-quiz-overlay"),
    body: document.querySelector("[data-cg-quiz-body]")
  };
}

export function mountQuizStudentWidget() {
  const state = getState();
  const user = getCurrentUser(state);
  if (!user || user.role === "admin") return () => {};

  const klass = getActiveClass(state);
  if (!klass?.id) return () => {};

  const dom = buildDom();

  let currentSession = null;
  let participants = [];
  let lastStatus = null;
  let intervalHandle = null;
  let unsubscribeParticipants = () => {};
  let barDismissedForSessionId = null; // reset per-session so a NEW quiz always re-shows the bar

  dom.barOpen.addEventListener("click", () => {
    dom.overlay.classList.add("cg-open");
    render();
  });

  dom.barDismiss.addEventListener("click", () => {
    barDismissedForSessionId = currentSession?.id || null;
    updateBarAndButton();
  });

  if (dom.inlineBtn) {
    dom.inlineBtn.addEventListener("click", () => {
      dom.overlay.classList.add("cg-open");
      render();
    });
  }

  function myParticipant() {
    return participants.find((participant) => participant.uid === user.id) || null;
  }

  function updateBarAndButton() {
    const status = currentSession?.status;
    const isLive = status === "lobby" || status === "live" || status === "minigame";
    const dismissed = currentSession?.id && currentSession.id === barDismissedForSessionId;

    dom.bar.classList.toggle("cg-visible", (isLive || status === "ended") && !dismissed);
    dom.bar.classList.toggle("cg-glow", isLive && !dismissed);

    if (dom.inlineBtn) {
      dom.inlineBtn.hidden = !(isLive || status === "ended");
      dom.inlineBtn.classList.toggle("cg-glow", isLive);
      const inlineLabel = dom.inlineBtn.querySelector("[data-cg-inline-label]");
      if (inlineLabel) {
        if (status === "lobby") inlineLabel.textContent = "Join Quiz";
        else if (status === "live") inlineLabel.textContent = "Quiz Live \u2014 Tap In";
        else if (status === "minigame") inlineLabel.textContent = "Bonus Round!";
        else if (status === "ended") inlineLabel.textContent = "View Quiz Results";
      }
    }

    if (status === "lobby") dom.barLabel.textContent = "Quiz Time \u2014 Join Now";
    else if (status === "live") dom.barLabel.textContent = "Quiz Live \u2014 Tap In";
    else if (status === "minigame") dom.barLabel.textContent = "Bonus Round!";
    else if (status === "ended") dom.barLabel.textContent = "Quiz Ended \u2014 Results";
    else dom.barLabel.textContent = "Quiz";
  }

  function announceTransition(nextStatus) {
    if (nextStatus === lastStatus) return;
    if (nextStatus === "lobby") {
      showToast(`\uD83D\uDCDD Quiz time! You have 5 minutes to join "${currentSession.quizTitle}".`);
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        new Notification("CyberGuard Quiz", { body: `"${currentSession.quizTitle}" is starting \u2014 join now!` });
      }
    } else if (nextStatus === "live" && lastStatus === "lobby") {
      showToast("\u25B6 The quiz has started!");
    } else if (nextStatus === "minigame") {
      showToast("\uD83C\uDFAE Bonus mini-game unlocked!");
    } else if (nextStatus === "ended") {
      showToast("\u2705 Quiz ended \u2014 check your results.");
    }
    lastStatus = nextStatus;
  }

  function render() {
    if (!dom.overlay.classList.contains("cg-open")) return;
    if (!currentSession) {
      dom.body.innerHTML = `<h2>No quiz right now</h2><p class="muted">You'll be notified the moment your teacher starts one.</p>`;
      return;
    }

    const late = myParticipant()?.status === "late";
    const lateNote = late
      ? `<div class="cg-quiz-late-note">You joined after the 5-minute window closed, so this round won't count toward your score \u2014 but jump in and play along!</div>`
      : "";

    if (currentSession.status === "lobby") return renderLobby(lateNote);
    if (currentSession.status === "live") return renderLive(lateNote);
    if (currentSession.status === "minigame") return renderMiniGame(lateNote);
    if (currentSession.status === "ended") return renderEnded();
  }

  function renderLobby(lateNote) {
    const joined = Boolean(myParticipant());
    const msLeft = Number(currentSession.joinDeadlineAt || 0) - Date.now();

    if (!joined) {
      dom.body.innerHTML = `
        ${lateNote}
        <h2>${escapeHtml(currentSession.quizTitle)}</h2>
        <p class="muted">Tap Join before the timer runs out \u2014 no join, no score.</p>
        <div class="cg-quiz-countdown">${formatCountdown(msLeft)}</div>
        <button class="cg-quiz-btn" type="button" data-cg-join>Join Quiz</button>
      `;
      dom.body.querySelector("[data-cg-join]").addEventListener("click", async () => {
        try {
          await joinSession(currentSession.id, {
            name: fullName(user),
            avatarInitials: user.avatar || initials(user.firstName, user.lastName),
            onTime: isWithinJoinWindow(currentSession)
          });
        } catch (error) {
          showToast(error.message || "Could not join the quiz.");
        }
      });
      return;
    }

    const ready = Boolean(myParticipant()?.ready);
    const readyCount = participants.filter((participant) => participant.ready).length;
    const rows = participants
      .map((participant) => `
        <div class="cg-quiz-participant-row">
          <span>${avatarBubble(participant)}${escapeHtml(participant.name)}${participant.status === "late" ? " (late)" : ""}</span>
          <span>${participant.ready ? "\u2705" : "\u23F3"}</span>
        </div>
      `)
      .join("");

    dom.body.innerHTML = `
      ${lateNote}
      <h2>${escapeHtml(currentSession.quizTitle)}</h2>
      <p class="muted">You're in! ${readyCount}/${participants.length} ready. Waiting for your teacher to start.</p>
      <div class="cg-quiz-countdown">${formatCountdown(msLeft)}</div>
      <button class="cg-quiz-btn ${ready ? "secondary" : ""}" type="button" data-cg-ready>${ready ? "You're ready \u2713" : "I'm Ready"}</button>
      <div style="margin-top:14px;">${rows || '<p class="muted">Waiting for classmates\u2026</p>'}</div>
    `;
    dom.body.querySelector("[data-cg-ready]").addEventListener("click", async () => {
      await setReady(currentSession.id, !ready);
    });
  }

  function renderLive(lateNote) {
    const question = currentSession.currentQuestion;
    if (!question) {
      dom.body.innerHTML = `${lateNote}<h2>${escapeHtml(currentSession.quizTitle)}</h2><p class="muted">Get ready for the next question\u2026</p>`;
      return;
    }

    const answered = answeredStore.has(currentSession.id, question.id);
    const msLeft = Number(question.deadlineAt || 0) - Date.now();

    if (!answered && msLeft > 0) {
      const displayOrder = currentSession.shuffleChoices
        ? seededShuffle(question.choices.map((_, i) => i), `${user.id}:${question.id}`)
        : question.choices.map((_, i) => i);
      const choicesHtml = displayOrder
        .map((originalIndex, displayPos) => `<button class="cg-quiz-choice" type="button" data-cg-choice="${originalIndex}">${String.fromCharCode(65 + displayPos)}. ${escapeHtml(question.choices[originalIndex])}</button>`)
        .join("");
      dom.body.innerHTML = `
        ${lateNote}
        <div class="cg-quiz-question-box">
          <h2>${escapeHtml(question.prompt)}</h2>
          <p class="muted">Worth ${question.points} points</p>
          <div class="cg-quiz-timer-track"><div class="cg-quiz-timer-fill" data-cg-timer style="width:100%"></div></div>
        </div>
        <div class="cg-quiz-choice-list">${choicesHtml}</div>
      `;
      dom.body.querySelectorAll("[data-cg-choice]").forEach((button) => {
        button.addEventListener("click", async () => {
          dom.body.querySelectorAll("[data-cg-choice]").forEach((b) => { b.disabled = true; });
          button.classList.add("picked");
          answeredStore.add(currentSession.id, question.id);
          try {
            await submitAnswer(currentSession.id, question.id, Number(button.dataset.cgChoice));
          } catch (error) {
            showToast(error.message || "Could not submit your answer.");
          }
          setTimeout(render, 400);
        });
      });

      const timerFill = dom.body.querySelector("[data-cg-timer]");
      const tick = () => {
        const remaining = Number(question.deadlineAt || 0) - Date.now();
        if (timerFill) timerFill.style.width = `${Math.max(0, (remaining / (question.deadlineAt - question.revealedAt)) * 100)}%`;
        if (remaining <= 0) {
          clearInterval(liveTick);
          render();
        }
      };
      const liveTick = setInterval(tick, 150);
      return;
    }

    const leaderboard = leaderboardFromSession(currentSession, participants).slice(0, 5);
    const maxScore = Math.max(1, ...leaderboard.map((row) => row.score));
    const rows = leaderboard
      .map(
        (row, index) => `
        <div style="margin-bottom:6px;">
          <div class="cg-quiz-lb-row" style="border-bottom:none; padding-bottom:2px;">
            <span>${avatarBubble(row)}${index + 1}. ${escapeHtml(row.name)}</span>
            <span>${row.score} pts${row.quizScore > 0 ? ` (+${row.quizScore} quiz)` : ""}</span>
          </div>
          <div class="cg-quiz-lb-bar-track"><div class="cg-quiz-lb-bar-fill" style="width:${(row.score / maxScore) * 100}%"></div></div>
        </div>
      `
      )
      .join("");
    dom.body.innerHTML = `
      ${lateNote}
      <h2>Answer locked in!</h2>
      <p class="muted">Waiting for your teacher to move to the next question.</p>
      <div style="margin-top:12px;">${rows || '<p class="muted">Scores will appear here soon.</p>'}</div>
    `;
  }

  function renderMiniGame(lateNote) {
    const already = Boolean(currentSession.miniGame?.active === false);
    dom.body.innerHTML = `
      ${lateNote}
      <h2>Bonus Round!</h2>
      <p class="muted">Sort each message as fast as you can \u2014 bonus points get added to your quiz score.</p>
      <div id="cg-quiz-minigame-slot"></div>
    `;
    if (already) {
      dom.body.querySelector("#cg-quiz-minigame-slot").innerHTML = `<p class="muted">Bonus round has ended.</p>`;
      return;
    }
    const durationSec = Math.max(5, Math.round((Number(currentSession.miniGame?.deadlineAt || 0) - Date.now()) / 1000));
    const slot = dom.body.querySelector("#cg-quiz-minigame-slot");
    if (answeredStore.has(currentSession.id, `minigame-${currentSession.miniGame?.startedAt}`)) {
      slot.innerHTML = `<p class="muted">You already played this bonus round. Nice work!</p>`;
      return;
    }
    mountPhishBlitz(slot, {
      durationSec,
      onFinish: async (result) => {
        answeredStore.add(currentSession.id, `minigame-${currentSession.miniGame?.startedAt}`);
        try {
          await submitMiniGameResult(currentSession.id, result);
        } catch (error) {
          showToast(error.message || "Could not submit your bonus round score.");
        }
      }
    });
  }

  function renderEnded() {
    // Ranked by points earned THIS quiz, not the combined running total.
    const leaderboard = [...leaderboardFromSession(currentSession, participants)]
      .sort((a, b) => b.quizPoints - a.quizPoints)
      .slice(0, 10);
    const mine = leaderboard.find((row) => row.uid === user.id);
    const maxPoints = Math.max(1, ...leaderboard.map((row) => row.quizPoints));
    const rows = leaderboard
      .map(
        (row, index) => `
        <div style="margin-bottom:6px;">
          <div class="cg-quiz-lb-row" style="border-bottom:none; padding-bottom:2px;">
            <span>${avatarBubble(row)}${index + 1}. ${escapeHtml(row.name)}</span>
            <span>${row.quizPoints} pts this quiz</span>
          </div>
          <div class="cg-quiz-lb-bar-track"><div class="cg-quiz-lb-bar-fill" style="width:${(row.quizPoints / maxPoints) * 100}%"></div></div>
        </div>
      `
      )
      .join("");
    dom.body.innerHTML = `
      <h2>${escapeHtml(currentSession.quizTitle)} \u2014 Final Results</h2>
      <p class="muted">${mine ? `You earned ${mine.quizPoints} pts this quiz \u2014 your class total is now ${mine.score}.` : "You didn't score in this round."}</p>
      <div style="margin-top:10px;">${rows || '<p class="muted">No scores recorded.</p>'}</div>
      ${currentSession.scoresSent ? '<p class="muted" style="margin-top:10px;">Your score has been added to your profile.</p>' : ""}
    `;
  }

  // A lobby the host opened but never started (or cancelled) sits at
  // status "lobby" forever with an expired countdown — from an old test,
  // an accidental double-open, whatever. Without this, students keep
  // seeing "quiz time!" indefinitely for a quiz that isn't really running
  // anymore, even though the host's own console shows nothing active.
  const LOBBY_ABANDON_GRACE_MS = 2 * 60 * 1000;
  function isAbandonedLobby(session) {
    if (!session || session.status !== "lobby") return false;
    return Date.now() > Number(session.joinDeadlineAt || 0) + LOBBY_ABANDON_GRACE_MS;
  }

  function handleSessionChange(rawSession) {
    const session = isAbandonedLobby(rawSession) ? null : rawSession;
    currentSession = session;
    updateBarAndButton();
    if (session) {
      announceTransition(session.status);
      unsubscribeParticipants();
      unsubscribeParticipants = subscribeToParticipants(session.id, (nextParticipants) => {
        participants = nextParticipants;
        render();
      });
    } else {
      unsubscribeParticipants();
      participants = [];
      lastStatus = null;
    }
    render();
  }

  const unsubscribeSession = subscribeToActiveSessionForClass(klass.id, handleSessionChange);

  // Only the lobby countdown needs a heartbeat re-render here — the live
  // question view manages its own per-question timer internally (see
  // renderLive), so re-rendering it from here too would stack up duplicate
  // interval timers every second. This is also where an abandoned lobby
  // (see isAbandonedLobby above) actually gets noticed: RTDB won't fire a
  // new update just because time passed with nobody touching the session,
  // so without this periodic re-check a stale lobby would stay showing as
  // "active" forever once it was first loaded as a real one.
  intervalHandle = setInterval(() => {
    if (currentSession?.status !== "lobby") return;
    if (isAbandonedLobby(currentSession)) {
      handleSessionChange(null);
      return;
    }
    render();
  }, 1000);

  return () => {
    unsubscribeSession();
    unsubscribeParticipants();
    clearInterval(intervalHandle);
  };
}

document.addEventListener("DOMContentLoaded", () => {
  mountQuizStudentWidget();
});
