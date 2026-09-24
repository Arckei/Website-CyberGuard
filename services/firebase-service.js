import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  getAuth,
  sendEmailVerification,
  sendPasswordResetEmail,
  signOut,
  signInWithEmailAndPassword,
  signInWithPopup,
  EmailAuthProvider,
  reauthenticateWithCredential,
  updateProfile,
  updatePassword
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import {
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  documentId,
  getDoc,
  getDocs,
  getFirestore,
  query,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-database.js";

import { firebaseConfig } from "./firebase-config.js";
import { supabaseStorageConfig } from "./supabase-config.js";
import { deleteSecureLesson, uploadSecureFile } from "./supabase-service.js";

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);

// Realtime Database backs the live quiz feature (sessions, ready-check,
// answers, mini-game). It's wrapped in try/catch on purpose: this file is
// imported by EVERY page (login, signup, user, modules, admin...), so if
// Realtime Database isn't enabled yet, or firebase-config.js still has the
// placeholder databaseURL, getDatabase() throws immediately — and without
// this guard, that one throw would break the entire site, not just the
// quiz feature. Quiz code calls requireRtdb() below, which only fails when
// something actually tries to use the quiz feature.
let _rtdb = null;
try {
  _rtdb = getDatabase(app);
} catch (error) {
  console.warn(
    "[CyberGuard] Realtime Database isn't available yet — the live quiz feature needs a real databaseURL in services/firebase-config.js. Everything else on the site is unaffected.",
    error
  );
}
export const rtdb = _rtdb;

export function requireRtdb() {
  if (!rtdb) {
    throw new Error(
      "Realtime Database isn't set up yet. Add your project's real databaseURL to services/firebase-config.js (Firebase console \u2192 Build \u2192 Realtime Database) and reload the page."
    );
  }
  return rtdb;
}

// NOTE: Hardcoded admin IDs are client-side fallbacks only.
// Security MUST be enforced via Firestore Security Rules.
// Keep this list mirrored with the admin allow-list in firestore.rules —
// they're independent checks and both need to agree on who's an admin.
const ADMIN_EMAILS = new Set(["keithwilsonplays@gmail.com", "neeon357@gmail.com"]);
const ADMIN_USER_IDS = new Set(["GiCGuDEbtNcjALETb7oto1HntYS2", "nybe9fkHsMVysaCSMqG2oCWPEIn1"]);

// ==========================================================================
// 1. AUTHENTICATION & USER MANAGEMENT
// ==========================================================================

export async function signupStudent({ email, password, firstName, lastName }) {
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  const cleanFirst = String(firstName || "").trim();
  const cleanLast = String(lastName || "").trim();

  await updateProfile(credential.user, {
    displayName: `${cleanFirst} ${cleanLast}`.trim()
  });

  const user = toCyberGuardUser({
    id: credential.user.uid,
    email,
    firstName: cleanFirst,
    lastName: cleanLast,
    role: "student"
  });

  await setDoc(doc(db, "users", user.id), {
    ...user,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  try {
    await sendEmailVerification(credential.user);
  } catch (error) {
    console.warn("[CyberGuard] Failed to send verification email:", error);
  }

  return { ...user, emailVerified: Boolean(credential.user.emailVerified) };
}

export async function resendVerificationEmail() {
  const authUser = await getReadyAuthUser();
  if (!authUser) {
    throw new Error("No signed-in user.");
  }
  if (authUser.emailVerified) return false;
  await sendEmailVerification(authUser);
  return true;
}

export async function isCurrentUserEmailVerified() {
  const authUser = await getReadyAuthUser();
  if (!authUser) return false;
  await authUser.reload().catch(() => {});
  return Boolean(authUser.emailVerified);
}

export async function loginUser({ email, password }) {
  const credential = await signInWithEmailAndPassword(auth, email, password);
  const userRef = doc(db, "users", credential.user.uid);
  const userSnap = await getDoc(userRef);

  if (userSnap.exists()) {
    return {
      ...toCyberGuardUser({
        id: credential.user.uid,
        email: credential.user.email,
        ...userSnap.data()
      }),
      emailVerified: Boolean(credential.user.emailVerified)
    };
  }

  const user = toCyberGuardUser({
    id: credential.user.uid,
    email: credential.user.email || email,
    firstName: "New",
    lastName: "Student",
    role: "student"
  });

  await setDoc(userRef, {
    ...user,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  return { ...user, emailVerified: Boolean(credential.user.emailVerified) };
}

export async function loginWithGoogle() {
  const provider = new GoogleAuthProvider();
  const credential = await signInWithPopup(auth, provider);
  const authUser = credential.user;
  const userRef = doc(db, "users", authUser.uid);
  const userSnap = await getDoc(userRef);
  const nameParts = (authUser.displayName || "").trim().split(/\s+/).filter(Boolean);

  const existingData = userSnap.exists() ? userSnap.data() : {};

  const user = toCyberGuardUser({
    id: authUser.uid,
    email: authUser.email || "",
    firstName: existingData.firstName || nameParts[0] || "New",
    lastName: existingData.lastName || nameParts.slice(1).join(" ") || "Student",
    role: existingData.role || "student",
    settings: existingData.settings,
    photo: existingData.photo || authUser.photoURL,
    taskProgress: existingData.taskProgress,
    episodeScores: existingData.episodeScores
  });

  if (!userSnap.exists()) {
    await setDoc(userRef, {
      ...user,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  }

  return { ...user, emailVerified: Boolean(authUser.emailVerified) };
}

export async function signOutUser() {
  await signOut(auth);
}

export async function sendPasswordReset(email) {
  await sendPasswordResetEmail(auth, email);
}

export async function updateUserPassword(currentPassword, newPassword) {
  const authUser = await getReadyAuthUser();
  if (!authUser) {
    throw new Error("No signed-in user.");
  }
  if (!hasPasswordProvider(authUser)) {
    throw new Error("Password change is only supported for email/password accounts.");
  }

  const credential = EmailAuthProvider.credential(authUser.email, currentPassword);
  await reauthenticateWithCredential(authUser, credential);
  await updatePassword(authUser, newPassword);
}

// Google sign-in accounts still have an `email` field, so checking for an
// email alone isn't enough to tell them apart from password accounts —
// check providerData for an actual "password" provider entry instead.
export function hasPasswordProvider(authUser) {
  return Boolean(authUser?.providerData?.some((provider) => provider.providerId === "password"));
}

export async function getSignedInUserProfile() {
  const authUser = await getReadyAuthUser();
  if (!authUser) return null;

  const userSnap = await getDoc(doc(db, "users", authUser.uid));
  const storedUser = userSnap.exists() ? userSnap.data() : {};
  const nameParts = (authUser.displayName || "").trim().split(/\s+/).filter(Boolean);

  return {
    ...toCyberGuardUser({
      id: authUser.uid,
      email: authUser.email || storedUser.email,
      firstName: storedUser.firstName || nameParts[0] || "New",
      lastName: storedUser.lastName || nameParts.slice(1).join(" ") || "Student",
      role: storedUser.role || "student",
      settings: storedUser.settings,
      photo: storedUser.photo || authUser.photoURL,
      taskProgress: storedUser.taskProgress,
      quizHistory: storedUser.quizHistory,
      episodeScores: storedUser.episodeScores
    }),
    emailVerified: Boolean(authUser.emailVerified),
    hasPassword: hasPasswordProvider(authUser)
  };
}

// ==========================================================================
// 2. TARGETED DATA LOADING & SYNCHRONIZATION
// ==========================================================================

export async function loadCyberGuardData() {
  const authUser = await getReadyAuthUser();
  if (!authUser) return {};

  const userSnap = await getDoc(doc(db, "users", authUser.uid));
  const currentUser = userSnap.exists() ? toCyberGuardUser({ id: userSnap.id, ...userSnap.data() }) : null;
  const isAdmin = currentUser?.role === "admin";

  let classesQuery;
  if (isAdmin) {
    classesQuery = query(collection(db, "classes"));
  } else {
    classesQuery = query(collection(db, "classes"), where("students", "array-contains", authUser.uid));
  }

  const [classesSnap, appStateSnap] = await Promise.all([
    getDocs(classesQuery),
    getDoc(doc(db, "appState", "cyberguard"))
  ]);

  const classes = classesSnap.docs.map((item) => toCyberGuardClass({ id: item.id, ...item.data() }));
  const appState = appStateSnap.exists() ? appStateSnap.data() : {};

  const users = currentUser ? [currentUser] : [];

  // Pull in the actual student profiles referenced by every visible class,
  // otherwise admin views can only ever resolve their own profile and every
  // student row renders blank.
  const studentIds = new Set();
  classes.forEach((klass) => {
    klass.students.forEach((id) => {
      if (id && id !== currentUser?.id) studentIds.add(id);
    });
  });

  if (studentIds.size > 0) {
    const studentUsers = await fetchUsersByIds([...studentIds]);
    studentUsers.forEach((user) => users.push(user));
  }

  return {
    users,
    classes,
    activeClassId: appState.activeClassId || classes[0]?.id || null
  };
}

export async function createClassRecord(klass) {
  const authUser = await getReadyAuthUser();
  if (!authUser) throw new Error("Not signed in.");
  if (!klass?.id) throw new Error("Class details are incomplete.");

  await setDoc(doc(db, "classes", klass.id), {
    ...toCyberGuardClass(klass),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    updatedBy: authUser.uid
  });

  return toCyberGuardClass(klass);
}

export async function fetchUsersByIds(ids) {
  const CHUNK_SIZE = 10; // Firestore "in" query limit
  const results = [];

  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    const chunk = ids.slice(i, i + CHUNK_SIZE);
    const usersQuery = query(collection(db, "users"), where(documentId(), "in", chunk));
    const snap = await getDocs(usersQuery);
    snap.docs.forEach((docSnap) => {
      results.push(toCyberGuardUser({ id: docSnap.id, ...docSnap.data() }));
    });
  }

  return results;
}

export async function joinClassByCode(code) {
  const authUser = await getReadyAuthUser();
  if (!authUser) throw new Error("Not signed in.");
  const normalizedCode = String(code || "").trim().toUpperCase();
  if (!normalizedCode) throw new Error("Enter a class code.");

  const classesRef = collection(db, "classes");
  const matchQuery = query(classesRef, where("code", "==", normalizedCode));
  const matchSnap = await getDocs(matchQuery);

  if (matchSnap.empty) {
    return null;
  }

  const classDoc = matchSnap.docs[0];
  const classData = classDoc.data();
  const alreadyJoined = Array.isArray(classData.students) && classData.students.includes(authUser.uid);

  if (!alreadyJoined) {
    await updateDoc(classDoc.ref, {
      students: arrayUnion(authUser.uid),
      [`scores.${authUser.uid}`]: classData.scores?.[authUser.uid] || 0
    });
  }

  return toCyberGuardClass({ 
    id: classDoc.id, 
    ...classData, 
    students: Array.from(new Set([...(classData.students || []), authUser.uid])) 
  });
}

export async function updateClassScore(classId, score) {
  const authUser = await getReadyAuthUser();
  if (!authUser) throw new Error("Not signed in.");
  if (!classId) throw new Error("Class details are incomplete.");

  const numericScore = Number(score);
  if (!Number.isFinite(numericScore) || numericScore < 0) {
    throw new Error("Score must be a non-negative number.");
  }

  await updateDoc(doc(db, "classes", classId), {
    [`scores.${authUser.uid}`]: numericScore,
    updatedAt: serverTimestamp(),
    updatedBy: authUser.uid
  });
}

export function subscribeToClass(classId, onChange, onError) {
  if (!classId) return () => {};

  return onSnapshot(
    doc(db, "classes", classId),
    (snapshot) => {
      if (snapshot.exists()) onChange(toCyberGuardClass({ id: snapshot.id, ...snapshot.data() }));
    },
    (error) => {
      console.warn("[CyberGuard] Realtime class sync failed:", error);
      onError?.(error);
    }
  );
}

export function subscribeToCurrentUser(onChange, onError) {
  const uid = auth.currentUser?.uid;
  if (!uid) return () => {};

  return onSnapshot(
    doc(db, "users", uid),
    (snapshot) => {
      if (snapshot.exists()) onChange({ id: snapshot.id, ...snapshot.data() });
    },
    (error) => {
      console.warn("[CyberGuard] Realtime user score sync failed:", error);
      onError?.(error);
    }
  );
}

// ==========================================================================
// 3. LESSON STORAGE ENGINE (SUPABASE)
// ==========================================================================

const MAX_SUPABASE_LESSON_FILE_BYTES = 25 * 1024 * 1024; // 25MB

export async function uploadLesson(classId, file) {
  const authUser = await getReadyAuthUser();
  if (!authUser) throw new Error("Not signed in.");
  if (!classId) throw new Error("Select a class first.");

  if (isSupabaseStorageReady()) {
    return uploadSupabaseLesson(classId, file, authUser.uid);
  }
  throw new Error("Secure Supabase Storage is not configured.");
}

export async function uploadProfilePhoto(file, uid) {
  const authUser = await getReadyAuthUser();
  if (!authUser || authUser.uid !== uid) throw new Error("Not signed in.");
  return uploadSecureFile({ kind: "avatar", file, user: authUser });
}

export async function getLessonsForClass(classId) {
  const authUser = await getReadyAuthUser();
  if (!authUser || !classId) return [];

  const lessonsQuery = query(collection(db, "lessons"), where("classId", "==", classId));
  const snap = await getDocs(lessonsQuery);

  return snap.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}

export async function deleteLessonById(lessonId) {
  const authUser = await getReadyAuthUser();
  if (!authUser) throw new Error("Not signed in.");

  const lessonRef = doc(db, "lessons", lessonId);
  const lessonSnap = await getDoc(lessonRef);
  const lesson = lessonSnap.exists() ? lessonSnap.data() : null;

  if (lesson?.storageProvider === "supabase" && lesson.storagePath) {
    await deleteSecureLesson(lesson.storagePath, authUser);
  }
  await deleteDoc(lessonRef);
}

async function uploadSupabaseLesson(classId, file, uploadedBy) {
  if (file.size > MAX_SUPABASE_LESSON_FILE_BYTES) {
    const maxMb = (MAX_SUPABASE_LESSON_FILE_BYTES / (1024 * 1024)).toFixed(0);
    const fileMb = (file.size / (1024 * 1024)).toFixed(1);
    throw new Error(`File is ${fileMb}MB. Supabase upload limit is ${maxMb}MB.`);
  }

  const id = `lesson-${Date.now()}`;
  const storagePath = await uploadSecureFile({ kind: "lesson", classId, file, user: await getReadyAuthUser() });
  const lesson = {
    id,
    classId,
    name: file.name,
    type: lessonFileType(file.name),
    size: file.size,
    dataUrl: "",
    contentType: file.type || "application/octet-stream",
    storageProvider: "supabase",
    storageBucket: supabaseStorageConfig.bucket,
    storagePath
  };

  await setDoc(doc(db, "lessons", id), {
    ...lesson,
    uploadedAt: serverTimestamp(),
    uploadedBy
  });

  return lesson;
}

function isSupabaseStorageReady() {
  return Boolean(supabaseStorageConfig?.enabled && supabaseStorageConfig?.url && supabaseStorageConfig?.anonKey && supabaseStorageConfig?.bucket);
}

function lessonFileType(fileName = "") {
  return fileName.split(".").pop()?.toUpperCase() || "FILE";
}

// ==========================================================================
// 4. SAFE BATCH WRITE OPERATIONS
// ==========================================================================

export async function saveCyberGuardData(state) {
  const authUser = await getReadyAuthUser();
  if (!authUser) return;

  const operations = [];
  const users = Array.isArray(state.users) ? state.users : [];
  const classes = Array.isArray(state.classes) ? state.classes : [];
  const updatedBy = state.currentUserId || authUser.uid;

  // 1. Sync authenticated user profile only
  const selfUser = users.find((u) => u.id === authUser.uid);
  const isAdminUser = selfUser?.role === "admin";
  if (selfUser) {
    // `selfUser` comes from local app state (ultimately localStorage), which
    // is exactly what a tampered client could rewrite. Compute the safe
    // fields via toCyberGuardUser(), then deliberately drop `role` from the
    // write itself — this is a merge write, so omitting the key leaves
    // Firestore's already-stored role completely untouched. That's what
    // makes this both un-escalatable (a spoofed role never reaches the
    // database) and non-destructive (a real admin's role can't be
    // silently downgraded by their own routine profile syncs).
    const { role: _ignoredRole, ...syncedUser } = toCyberGuardUser(selfUser);
    operations.push({
      ref: doc(db, "users", authUser.uid),
      data: {
        ...syncedUser,
        updatedAt: serverTimestamp()
      }
    });
  }

  // 2. Sync classes
  classes.forEach((klass) => {
    if (!klass?.id) return;
    const safeClass = toCyberGuardClass(klass);

    // firestore.rules only lets a non-admin move their OWN `scores.<uid>`
    // entry on a class they've already joined (isUpdatingOwnScore) — never
    // the class doc wholesale. Queuing this full-object write for a student
    // used to get denied every time (their local copy also isn't guaranteed
    // fresh for classmates' scores), and because every op here shares ONE
    // atomic batch, that single denial rolled back the WHOLE batch —
    // including the student's own user-doc write above, which is why a
    // score could get caught client-side but never actually persist.
    // updateClassScore() (called separately by syncCombinedScore in the
    // episode pages) already writes just the caller's own `scores.<uid>`
    // field and is what a student needs; only an admin managing the roster
    // needs this full-document sync.
    if (isAdminUser) {
      operations.push({
        ref: doc(db, "classes", safeClass.id),
        data: {
          ...safeClass,
          updatedAt: serverTimestamp(),
          updatedBy
        }
      });
    }

    safeClass.students.forEach((studentId) => {
      // The progress rule only lets a signed-in user write their own
      // userId. This whole class's writes (including the score update
      // above) share ONE atomic batch, so queuing a classmate's progress
      // doc for a non-admin would get the classmate's write denied — and
      // Firestore rolls back the entire batch when that happens, taking
      // the student's own just-earned score down with it.
      if (!isAdminUser && studentId !== authUser.uid) return;

      const progressId = `${safeClass.id}_${studentId}_phishing`;
      operations.push({
        ref: doc(db, "progress", progressId),
        data: {
          id: progressId,
          classId: safeClass.id,
          userId: studentId,
          moduleId: "phishing",
          score: safeClass.scores[studentId] || 0,
          complete: Boolean(safeClass.modules?.phishing?.complete),
          updatedAt: serverTimestamp(),
          updatedBy
        }
      });
    });
  });

  // 3. Sync state pointers (admin-only doc: a regular student's own sync
  // has no business touching the site-wide "active class" pointer, and
  // queuing it for them just guarantees a permission-denied on every save)
  if (isAdminUser) {
    operations.push({
      ref: doc(db, "appState", "cyberguard"),
      data: {
        activeClassId: state.activeClassId || classes[0]?.id || null,
        updatedAt: serverTimestamp(),
        updatedBy
      }
    });
  }

  // Chunk into safe sub-batches (Max 400 writes per batch, limit is 500)
  const BATCH_LIMIT = 400;
  for (let i = 0; i < operations.length; i += BATCH_LIMIT) {
    const chunk = operations.slice(i, i + BATCH_LIMIT);
    const batch = writeBatch(db);

    chunk.forEach((op) => batch.set(op.ref, op.data, { merge: true }));
    await batch.commit();
  }
}

// ==========================================================================
// 5. DATA SANITIZERS & AUTH RESOLVER
// ==========================================================================

function toCyberGuardUser({ id, email, firstName, lastName, role, settings, photo, taskProgress, quizHistory, episodeScores }) {
  const safeFirstName = firstName || "New";
  const safeLastName = lastName || "Student";

  const user = {
    id,
    // Trust `role` here — every remaining caller (getSignedInUserProfile,
    // loginUser, loginWithGoogle) passes a value it just re-fetched fresh
    // from Firestore, or "student" for a brand-new account. isAdminIdentity()
    // still wins regardless, so the hardcoded bootstrap admin(s) always
    // resolve to "admin" even before their Firestore doc exists.
    // saveCyberGuardData() — the one caller whose `role` traces back to
    // client-controlled localStorage — strips `role` out of its own write
    // payload below, so a spoofed value here can never reach Firestore.
    role: isAdminIdentity({ id, email }) ? "admin" : (role === "admin" ? "admin" : "student"),
    email,
    firstName: safeFirstName,
    lastName: safeLastName,
    avatar: initials(safeFirstName, safeLastName)
  };

  if (settings && typeof settings === "object") user.settings = settings;
  if (photo) user.photo = photo;
  if (taskProgress && typeof taskProgress === "object") user.taskProgress = taskProgress;
  // Written by quiz-service.js's sendQuizScoresToStudents() — kept here so
  // the profile page (and the admin's profile viewer) can show a student's
  // quiz history instead of it silently getting dropped on every refresh.
  if (Array.isArray(quizHistory)) user.quizHistory = quizHistory;
  // { ep0: number, ep1: number } — each episode's own best score, written by
  // pages/modules/script.js and pages/ep1/script.js. Kept separate from
  // classes/{classId}.scores (the combined total the two are summed into).
  if (episodeScores && typeof episodeScores === "object") user.episodeScores = episodeScores;

  return user;
}

function isAdminIdentity({ id, email }) {
  return ADMIN_USER_IDS.has(String(id || "")) ||
    ADMIN_EMAILS.has(String(email || "").trim().toLowerCase());
}

function toCyberGuardClass({ id, name, section, code, teacher, students, scores, quizScores, modules }) {
  return {
    id,
    name: name || "Cyber Class",
    section: section || "Section",
    code: code || "CG2026",
    teacher: teacher || "Cyber Teacher",
    students: Array.isArray(students) ? students : [],
    scores: scores && typeof scores === "object" ? scores : {},
    // Kept separate from `scores` on purpose: gameplay scores are a
    // best-score-so-far value (see applyIncomingScore's Math.max in
    // pages/modules/script.js), while quiz points are cumulative across
    // every quiz taken. Mixing the two into one field would let a later
    // high game score silently overwrite quiz points that had been added
    // in. Anywhere a "total" is shown, it's scores[uid] + quizScores[uid].
    quizScores: quizScores && typeof quizScores === "object" ? quizScores : {},
    modules: modules && typeof modules === "object" ? modules : { phishing: { complete: false } }
  };
}

function initials(firstName, lastName) {
  return `${firstName?.[0] || ""}${lastName?.[0] || ""}`.toUpperCase() || "CG";
}

/**
 * Reliable Auth Engine: Prefers native authStateReady() over fixed timeouts.
 */
function getReadyAuthUser() {
  if (auth.currentUser) return Promise.resolve(auth.currentUser);

  if (typeof auth.authStateReady === "function") {
    return auth.authStateReady().then(() => auth.currentUser);
  }

  return new Promise((resolve) => {
    const unsubscribe = auth.onAuthStateChanged((user) => {
      unsubscribe();
      resolve(user);
    });
  });
}