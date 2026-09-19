// quiz-service.js
// Firebase Realtime Database engine for CyberGuard's live quiz feature
// (Kahoot-style): quiz authoring, hosting a live session, the ready-check
// lobby, answer collection + host-side grading, the bonus mini-game.
//
// Why Realtime Database (not Firestore) for the live parts: a quiz session
// is short-lived, bursty (everyone reading/writing inside a few minutes),
// and mostly small pieces of state (who's ready, the current question, a
// running score map) — exactly what RTDB is built for, and it's simpler to
// reason about than Firestore's per-document listener model for this.
// Firestore remains the permanent home for user profiles and classes, so
// the one truly "permanent record" step — sending final scores to each
// student — still writes there (see sendQuizScoresToStudents at the bottom).
//
// Data model (Realtime Database JSON tree):
//   quizzes/{quizId}                          -> full quiz incl. correct
//                                                 answers (admin-only)
//   classActiveSession/{classId}              -> sessionId pointer, so a
//                                                 student's client can find
//                                                 "the" session for their
//                                                 class without a query
//   quizSessions/{sessionId}                  -> live session state, PUBLIC
//                                                 (never contains answers)
//     /participants/{uid}                     -> one entry per joined student
//   quizAnswers/{sessionId}/{questionId}/{uid}      -> one entry per answer
//   quizMinigameResults/{sessionId}/{uid}           -> one entry per mini-game run
//
// quizAnswers and quizMinigameResults are deliberately kept OUTSIDE the
// quizSessions tree (as separate top-level paths) rather than nested under
// it. Realtime Database read rules cascade downward as a grant — if
// quizSessions/{id} were readable by any signed-in user (which it must be,
// so students can see the live question and leaderboard), anything nested
// under it would inherit that same broad read access, including answers.
// Keeping them as siblings lets each have its own independent, tighter
// rule (admin-read / write-your-own-uid-only) with no leakage.
//
// IMPORTANT — Realtime Database Rules: this file assumes rules exist that
// (a) let only admins read/write `quizzes` and control `quizSessions`, and
// (b) let a signed-in student read a session and its participants, but
// write only their OWN participant/answer/mini-game entries. See
// database.rules.json in the repo root and QUIZ_FEATURE_README.md for the
// exact rules to paste into the Firebase console — this file cannot enforce
// security on its own, the rules must back it up.

import {
  get,
  increment,
  onValue,
  push,
  ref,
  remove,
  serverTimestamp,
  update
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-database.js";
import { arrayUnion, doc, increment as firestoreIncrement, writeBatch } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

import { auth, db, rtdb } from "./firebase-service.js";

export const DEFAULT_JOIN_WINDOW_MS = 5 * 60 * 1000; // "join is like 5mins"
export const DEFAULT_QUESTION_TIME_SEC = 20;
export const DEFAULT_QUESTION_POINTS = 100;

function requireUid() {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Not signed in.");
  return uid;
}

function newId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function objectToArray(val) {
  if (!val) return [];
  return Object.entries(val).map(([key, data]) => ({ uid: key, id: key, ...data }));
}

// ==========================================================================
// 1. QUIZ AUTHORING (admin only — includes correct answers)
// ==========================================================================

export function sanitizeQuestion(raw, index = 0) {
  const choices = (Array.isArray(raw?.choices) ? raw.choices : [])
    .map((choice) => String(choice ?? "").trim())
    .filter(Boolean)
    .slice(0, 6);

  if (choices.length < 2) throw new Error(`Question ${index + 1} needs at least 2 answer choices.`);

  const correctIndex = Number(raw?.correctIndex);
  if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= choices.length) {
    throw new Error(`Question ${index + 1} needs a correct answer selected.`);
  }

  const prompt = String(raw?.prompt || "").trim();
  if (!prompt) throw new Error(`Question ${index + 1} needs a question prompt.`);

  const points = Math.max(0, Math.round(Number(raw?.points) || DEFAULT_QUESTION_POINTS));
  const timeLimitSec = Math.min(120, Math.max(5, Math.round(Number(raw?.timeLimitSec) || DEFAULT_QUESTION_TIME_SEC)));

  return { id: raw?.id || newId("q"), prompt, choices, correctIndex, points, timeLimitSec };
}

export async function createQuiz({ title, description = "", questions }) {
  const uid = requireUid();
  const cleanTitle = String(title || "").trim();
  if (!cleanTitle) throw new Error("Give the quiz a title.");

  const cleanQuestions = (questions || []).map((question, index) => sanitizeQuestion(question, index));
  if (cleanQuestions.length === 0) throw new Error("Add at least one question.");

  const id = push(ref(rtdb, "quizzes")).key;
  const quiz = {
    id,
    title: cleanTitle,
    description: String(description || "").trim(),
    questions: cleanQuestions,
    createdBy: uid
  };

  await update(ref(rtdb, `quizzes/${id}`), {
    ...quiz,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  return quiz;
}

export async function updateQuiz(quizId, { title, description, questions }) {
  const uid = requireUid();
  const patch = { updatedAt: serverTimestamp(), updatedBy: uid };
  if (title != null) patch.title = String(title).trim();
  if (description != null) patch.description = String(description).trim();
  if (questions != null) patch.questions = questions.map((question, index) => sanitizeQuestion(question, index));

  await update(ref(rtdb, `quizzes/${quizId}`), patch);
}

export async function deleteQuiz(quizId) {
  await remove(ref(rtdb, `quizzes/${quizId}`));
}

export async function getQuiz(quizId) {
  const snap = await get(ref(rtdb, `quizzes/${quizId}`));
  return snap.exists() ? { id: quizId, ...snap.val() } : null;
}

export async function listQuizzes() {
  const snap = await get(ref(rtdb, "quizzes"));
  const val = snap.val() || {};
  return Object.entries(val)
    .map(([id, data]) => ({ id, ...data }))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export function subscribeToQuizzes(onChange, onError) {
  return onValue(
    ref(rtdb, "quizzes"),
    (snap) => {
      const val = snap.val() || {};
      const quizzes = Object.entries(val)
        .map(([id, data]) => ({ id, ...data }))
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      onChange(quizzes);
    },
    (error) => {
      console.warn("[CyberGuard] Quiz list sync failed:", error);
      onError?.(error);
    }
  );
}

// ==========================================================================
// 2. LIVE SESSION LIFECYCLE (the host's "Start A Quiz" control room)
// ==========================================================================

function publicQuestion(question, { revealedAt = Date.now(), overridePoints, overrideTimeLimitSec } = {}) {
  const timeLimitSec = overrideTimeLimitSec || question.timeLimitSec || DEFAULT_QUESTION_TIME_SEC;
  return {
    id: question.id,
    prompt: question.prompt,
    choices: question.choices,
    points: overridePoints ?? question.points,
    revealedAt,
    deadlineAt: revealedAt + timeLimitSec * 1000
  };
}

// Opens the 5-minute (configurable) ready-check lobby, and points
// classActiveSession/{classId} at it so students' clients can find it
// without running a query.
export async function openQuizLobby({ quizId, classId, joinWindowMs = DEFAULT_JOIN_WINDOW_MS }) {
  const uid = requireUid();
  const quiz = await getQuiz(quizId);
  if (!quiz) throw new Error("Quiz not found.");
  if (!quiz.questions?.length) throw new Error("This quiz has no questions yet.");
  if (!classId) throw new Error("Pick a class to host this quiz for.");

  const id = push(ref(rtdb, "quizSessions")).key;
  const now = Date.now();
  const session = {
    id,
    quizId,
    quizTitle: quiz.title,
    classId,
    hostId: uid,
    status: "lobby",
    joinOpenedAt: now,
    joinDeadlineAt: now + joinWindowMs,
    currentQuestionIndex: -1,
    currentQuestion: null,
    totalQuestions: quiz.questions.length,
    scores: {},
    scoresSent: false
  };

  await update(ref(rtdb, `quizSessions/${id}`), {
    ...session,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  await update(ref(rtdb, "classActiveSession"), { [classId]: id });

  return session;
}

export function subscribeToSession(sessionId, onChange, onError) {
  if (!sessionId) return () => {};
  return onValue(
    ref(rtdb, `quizSessions/${sessionId}`),
    (snap) => onChange(snap.exists() ? { id: sessionId, ...snap.val() } : null),
    (error) => {
      console.warn("[CyberGuard] Quiz session sync failed:", error);
      onError?.(error);
    }
  );
}

// Follows classActiveSession/{classId} and re-subscribes to whichever
// session it currently points at — no query/index needed, and it
// automatically picks up a brand-new session the moment a host opens one.
export function subscribeToActiveSessionForClass(classId, onChange, onError) {
  if (!classId) return () => {};
  let unsubscribeSession = () => {};

  const unsubscribePointer = onValue(
    ref(rtdb, `classActiveSession/${classId}`),
    (pointerSnap) => {
      unsubscribeSession();
      const sessionId = pointerSnap.val();
      if (!sessionId) {
        onChange(null);
        return;
      }
      unsubscribeSession = subscribeToSession(sessionId, onChange, onError);
    },
    (error) => {
      console.warn("[CyberGuard] Active quiz sync failed:", error);
      onError?.(error);
    }
  );

  return () => {
    unsubscribePointer();
    unsubscribeSession();
  };
}

export function isWithinJoinWindow(session) {
  if (!session || session.status !== "lobby") return false;
  return Date.now() < Number(session.joinDeadlineAt || 0);
}

// Locks the lobby and reveals question 1. Whoever hasn't joined by now (or
// isn't marked "joined" before this point) is locked out of scoring for the
// rest of the session — see gradeQuestion().
export async function startQuizSession(sessionId, quiz) {
  await update(ref(rtdb, `quizSessions/${sessionId}`), {
    status: "live",
    startedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  return advanceToQuestion(sessionId, quiz, 0);
}

export async function advanceToQuestion(sessionId, quiz, index, overrides = {}) {
  const question = quiz.questions[index];
  if (!question) {
    await endQuizSession(sessionId);
    return null;
  }
  const publicQ = publicQuestion(question, overrides);
  await update(ref(rtdb, `quizSessions/${sessionId}`), {
    status: "live",
    currentQuestionIndex: index,
    currentQuestion: publicQ,
    updatedAt: serverTimestamp()
  });
  return publicQ;
}

export async function endQuizSession(sessionId) {
  await update(ref(rtdb, `quizSessions/${sessionId}`), {
    status: "ended",
    currentQuestion: null,
    endedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

// ==========================================================================
// 3. PARTICIPANTS (join / ready-up / presence)
// ==========================================================================

export async function joinSession(sessionId, { name, onTime }) {
  const uid = requireUid();
  await update(ref(rtdb, `quizSessions/${sessionId}/participants/${uid}`), {
    uid,
    name: name || "Student",
    ready: false,
    status: onTime ? "joined" : "late",
    joinedAt: serverTimestamp()
  });
}

export async function setReady(sessionId, ready) {
  const uid = requireUid();
  await update(ref(rtdb, `quizSessions/${sessionId}/participants/${uid}`), { ready: Boolean(ready) });
}

export function subscribeToParticipants(sessionId, onChange, onError) {
  if (!sessionId) return () => {};
  return onValue(
    ref(rtdb, `quizSessions/${sessionId}/participants`),
    (snap) => onChange(objectToArray(snap.val())),
    (error) => {
      console.warn("[CyberGuard] Participant sync failed:", error);
      onError?.(error);
    }
  );
}

export function allJoinedAreReady(participants) {
  const joined = participants.filter((participant) => participant.status === "joined");
  return joined.length > 0 && joined.every((participant) => participant.ready);
}

// ==========================================================================
// 4. ANSWERS & GRADING
// Grading happens on the HOST's client, which is the only client holding
// the full quiz doc (with correctIndex) — students only ever receive the
// public, answer-free version of the current question.
// ==========================================================================

export async function submitAnswer(sessionId, questionId, choiceIndex) {
  const uid = requireUid();
  await update(ref(rtdb, `quizAnswers/${sessionId}/${questionId}/${uid}`), {
    uid,
    questionId,
    choiceIndex,
    answeredAt: serverTimestamp()
  });
}

export function subscribeToAnswers(sessionId, questionId, onChange, onError) {
  if (!sessionId || !questionId) return () => {};
  return onValue(
    ref(rtdb, `quizAnswers/${sessionId}/${questionId}`),
    (snap) => onChange(objectToArray(snap.val())),
    (error) => {
      console.warn("[CyberGuard] Answer sync failed:", error);
      onError?.(error);
    }
  );
}

// Awards `question.points` to every ELIGIBLE student (status === "joined")
// who answered correctly. Late joiners / no-shows are silently skipped —
// that's the "didn't make it into the room in time, no score" rule.
export async function gradeQuestion(sessionId, question, answers, participants) {
  const eligibleIds = new Set(
    participants.filter((participant) => participant.status === "joined").map((participant) => participant.uid)
  );

  const updates = { [`quizSessions/${sessionId}/updatedAt`]: serverTimestamp() };
  let correctCount = 0;

  answers.forEach((answer) => {
    if (!eligibleIds.has(answer.uid)) return;
    if (Number(answer.choiceIndex) === Number(question.correctIndex)) {
      updates[`quizSessions/${sessionId}/scores/${answer.uid}`] = increment(question.points);
      correctCount += 1;
    }
  });

  await update(ref(rtdb), updates);
  return { correctCount, totalAnswers: answers.length };
}

// ==========================================================================
// 5. BONUS MINI-GAME ("Phish or Legit Blitz")
// ==========================================================================

export async function launchMiniGame(sessionId, { durationSec = 30 } = {}) {
  const now = Date.now();
  await update(ref(rtdb, `quizSessions/${sessionId}`), {
    status: "minigame",
    miniGame: { active: true, startedAt: now, deadlineAt: now + durationSec * 1000 },
    updatedAt: serverTimestamp()
  });
}

// Returns to the live quiz view (host can then advance to the next
// question, or end the session) without wiping question progress.
export async function endMiniGame(sessionId) {
  await update(ref(rtdb, `quizSessions/${sessionId}/miniGame`), { active: false });
  await update(ref(rtdb, `quizSessions/${sessionId}`), { status: "live", updatedAt: serverTimestamp() });
}

export async function submitMiniGameResult(sessionId, result) {
  const uid = requireUid();
  await update(ref(rtdb, `quizMinigameResults/${sessionId}/${uid}`), {
    uid,
    ...result,
    submittedAt: serverTimestamp()
  });
}

export function subscribeToMiniGameResults(sessionId, onChange, onError) {
  if (!sessionId) return () => {};
  return onValue(
    ref(rtdb, `quizMinigameResults/${sessionId}`),
    (snap) => onChange(objectToArray(snap.val())),
    (error) => {
      console.warn("[CyberGuard] Mini-game sync failed:", error);
      onError?.(error);
    }
  );
}

// The host calls this once per student after the round ends, to turn a raw
// mini-game result into leaderboard points.
export async function awardMiniGameBonus(sessionId, uid, bonusPoints) {
  if (!bonusPoints) return;
  await update(ref(rtdb), {
    [`quizSessions/${sessionId}/scores/${uid}`]: increment(bonusPoints),
    [`quizSessions/${sessionId}/updatedAt`]: serverTimestamp()
  });
}

// ==========================================================================
// 6. SENDING FINAL SCORES DIRECTLY TO EACH STUDENT'S PROFILE
// This is the one step that deliberately stays on Firestore: it's where the
// rest of the app already keeps permanent student records (users/classes),
// so a quiz result becomes part of that same permanent history.
// ==========================================================================

export async function sendQuizScoresToStudents(session, participants, { addToClassScore = true } = {}) {
  const awardedAt = Date.now();
  const eligible = participants.filter((participant) => participant.status === "joined");

  const operations = [];
  eligible.forEach((participant) => {
    const score = Number(session.scores?.[participant.uid] || 0);

    operations.push({
      ref: doc(db, "users", participant.uid),
      data: {
        quizHistory: arrayUnion({
          sessionId: session.id,
          quizId: session.quizId,
          quizTitle: session.quizTitle,
          classId: session.classId,
          score,
          awardedAt
        })
      }
    });

    if (addToClassScore && session.classId) {
      operations.push({
        ref: doc(db, "classes", session.classId),
        data: { [`scores.${participant.uid}`]: firestoreIncrement(score) }
      });
    }
  });

  const BATCH_LIMIT = 400;
  for (let i = 0; i < operations.length; i += BATCH_LIMIT) {
    const chunk = operations.slice(i, i + BATCH_LIMIT);
    const batch = writeBatch(db);
    chunk.forEach((op) => batch.set(op.ref, op.data, { merge: true }));
    await batch.commit();
  }

  await update(ref(rtdb, `quizSessions/${session.id}`), {
    scoresSent: true,
    scoresSentAt: serverTimestamp()
  });

  return eligible.length;
}

export function leaderboardFromSession(session, participants) {
  const nameById = new Map(participants.map((participant) => [participant.uid, participant.name]));
  return Object.entries(session?.scores || {})
    .map(([uid, score]) => ({ uid, name: nameById.get(uid) || "Student", score: Number(score) || 0 }))
    .sort((a, b) => b.score - a.score);
}
