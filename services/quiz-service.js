// quiz-service.js
// Firestore engine for CyberGuard's live quiz feature (Kahoot-style): quiz
// authoring, hosting a live session, the ready-check lobby, answer
// collection + host-side grading, the bonus mini-game.
//
// v3 update: moved off Firebase Realtime Database and onto Firestore.
// Firestore's onSnapshot() gives the same live-listener behavior RTDB's
// onValue() did, so nothing about the "live" feel changes — this just drops
// the second database (and its separate databaseURL/console setup/rules
// file) so everything lives in the one Firestore project the rest of the
// app already uses.
//
// Data model (Firestore):
//   quizzes/{quizId}                         -> full quiz incl. correct
//                                                answers (admin-only)
//   classActiveSession/{classId}             -> { sessionId } pointer, so a
//                                                student's client can find
//                                                "the" session for their
//                                                class without a query
//   quizSessions/{sessionId}                 -> live session state, readable
//                                                by any signed-in user
//                                                (never contains answers)
//     /participants/{uid}                    -> one doc per joined student
//     /answers/{questionId_uid}               -> one doc per answer
//     /minigameResults/{uid}                  -> one doc per mini-game run
//
// Unlike Realtime Database, Firestore security rules do NOT cascade a grant
// on a parent path down to its subcollections — each `match` block below is
// independent. That's what let the answers/minigameResults subcollections
// move IN under quizSessions/{sessionId} (cleaner than RTDB's workaround of
// keeping them as separate top-level trees) while still keeping their own
// tighter rule (own-doc-only, or admin) with no risk of a broad session-read
// grant leaking into them. See firestore.rules for the actual rules.

import {
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

import { auth, db } from "./firebase-service.js";

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

// Mirrors the old RTDB helper's shape ({ uid, id, ...data }) so every
// calling file (host-quiz, quiz-student-widget, the leaderboard widgets)
// keeps working unchanged.
function snapshotToArray(snap) {
  return snap.docs.map((docSnap) => ({ uid: docSnap.id, id: docSnap.id, ...docSnap.data() }));
}

function sortByUpdatedAtDesc(a, b) {
  const aTime = a.updatedAt?.toMillis ? a.updatedAt.toMillis() : Number(a.updatedAt) || 0;
  const bTime = b.updatedAt?.toMillis ? b.updatedAt.toMillis() : Number(b.updatedAt) || 0;
  return bTime - aTime;
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

  const id = doc(collection(db, "quizzes")).id;
  const quiz = {
    id,
    title: cleanTitle,
    description: String(description || "").trim(),
    questions: cleanQuestions,
    createdBy: uid
  };

  await setDoc(doc(db, "quizzes", id), {
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

  await updateDoc(doc(db, "quizzes", quizId), patch);
}

export async function deleteQuiz(quizId) {
  await deleteDoc(doc(db, "quizzes", quizId));
}

export async function getQuiz(quizId) {
  const snap = await getDoc(doc(db, "quizzes", quizId));
  return snap.exists() ? { id: quizId, ...snap.data() } : null;
}

export async function listQuizzes() {
  const snap = await getDocs(query(collection(db, "quizzes"), orderBy("updatedAt", "desc")));
  return snapshotToArray(snap);
}

export function subscribeToQuizzes(onChange, onError) {
  return onSnapshot(
    query(collection(db, "quizzes"), orderBy("updatedAt", "desc")),
    (snap) => onChange(snapshotToArray(snap).sort(sortByUpdatedAtDesc)),
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

  const id = doc(collection(db, "quizSessions")).id;
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

  await setDoc(doc(db, "quizSessions", id), {
    ...session,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  await setDoc(doc(db, "classActiveSession", classId), { sessionId: id });

  return session;
}

export function subscribeToSession(sessionId, onChange, onError) {
  if (!sessionId) return () => {};
  return onSnapshot(
    doc(db, "quizSessions", sessionId),
    (snap) => onChange(snap.exists() ? { id: sessionId, ...snap.data() } : null),
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

  const unsubscribePointer = onSnapshot(
    doc(db, "classActiveSession", classId),
    (pointerSnap) => {
      unsubscribeSession();
      const sessionId = pointerSnap.exists() ? pointerSnap.data().sessionId : null;
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
  await updateDoc(doc(db, "quizSessions", sessionId), {
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
  await updateDoc(doc(db, "quizSessions", sessionId), {
    status: "live",
    currentQuestionIndex: index,
    currentQuestion: publicQ,
    updatedAt: serverTimestamp()
  });
  return publicQ;
}

export async function endQuizSession(sessionId) {
  await updateDoc(doc(db, "quizSessions", sessionId), {
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
  await setDoc(doc(db, "quizSessions", sessionId, "participants", uid), {
    uid,
    name: name || "Student",
    ready: false,
    status: onTime ? "joined" : "late",
    joinedAt: serverTimestamp()
  }, { merge: true });
}

export async function setReady(sessionId, ready) {
  const uid = requireUid();
  await setDoc(doc(db, "quizSessions", sessionId, "participants", uid), { ready: Boolean(ready) }, { merge: true });
}

export function subscribeToParticipants(sessionId, onChange, onError) {
  if (!sessionId) return () => {};
  return onSnapshot(
    collection(db, "quizSessions", sessionId, "participants"),
    (snap) => onChange(snapshotToArray(snap)),
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
// public, answer-free version of the current question. Answer docs are
// readable by their own author or an admin only (see firestore.rules), so
// classmates can't peek at each other's picks before grading.
// ==========================================================================

export async function submitAnswer(sessionId, questionId, choiceIndex) {
  const uid = requireUid();
  await setDoc(doc(db, "quizSessions", sessionId, "answers", `${questionId}_${uid}`), {
    uid,
    questionId,
    choiceIndex,
    answeredAt: serverTimestamp()
  }, { merge: true });
}

export function subscribeToAnswers(sessionId, questionId, onChange, onError) {
  if (!sessionId || !questionId) return () => {};
  return onSnapshot(
    query(collection(db, "quizSessions", sessionId, "answers"), where("questionId", "==", questionId)),
    (snap) => onChange(snapshotToArray(snap)),
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

  const patch = { updatedAt: serverTimestamp() };
  let correctCount = 0;

  answers.forEach((answer) => {
    if (!eligibleIds.has(answer.uid)) return;
    if (Number(answer.choiceIndex) === Number(question.correctIndex)) {
      patch[`scores.${answer.uid}`] = increment(question.points);
      correctCount += 1;
    }
  });

  await updateDoc(doc(db, "quizSessions", sessionId), patch);
  return { correctCount, totalAnswers: answers.length };
}

// ==========================================================================
// 5. BONUS MINI-GAME ("Phish or Legit Blitz")
// ==========================================================================

export async function launchMiniGame(sessionId, { durationSec = 30 } = {}) {
  const now = Date.now();
  await updateDoc(doc(db, "quizSessions", sessionId), {
    status: "minigame",
    miniGame: { active: true, startedAt: now, deadlineAt: now + durationSec * 1000 },
    updatedAt: serverTimestamp()
  });
}

// Returns to the live quiz view (host can then advance to the next
// question, or end the session) without wiping question progress.
export async function endMiniGame(sessionId) {
  await updateDoc(doc(db, "quizSessions", sessionId), {
    "miniGame.active": false,
    status: "live",
    updatedAt: serverTimestamp()
  });
}

export async function submitMiniGameResult(sessionId, result) {
  const uid = requireUid();
  await setDoc(doc(db, "quizSessions", sessionId, "minigameResults", uid), {
    uid,
    ...result,
    submittedAt: serverTimestamp()
  }, { merge: true });
}

export function subscribeToMiniGameResults(sessionId, onChange, onError) {
  if (!sessionId) return () => {};
  return onSnapshot(
    collection(db, "quizSessions", sessionId, "minigameResults"),
    (snap) => onChange(snapshotToArray(snap)),
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
  await updateDoc(doc(db, "quizSessions", sessionId), {
    [`scores.${uid}`]: increment(bonusPoints),
    updatedAt: serverTimestamp()
  });
}

// ==========================================================================
// 6. SENDING FINAL SCORES DIRECTLY TO EACH STUDENT'S PROFILE
// Already lived on Firestore before this port — unchanged.
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
        // Separate from the game's `scores` field on purpose — profile-viewer.js
        // already reads gameplayScore (scores) and quizScore (quizScores)
        // independently and adds them for the "total" it displays. Merging
        // quiz points into `scores` here would double them into that total
        // and make it impossible to tell how a student's total was earned.
        data: { [`quizScores.${participant.uid}`]: increment(score) }
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

  await updateDoc(doc(db, "quizSessions", session.id), {
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
