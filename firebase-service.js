import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  getAuth,
  sendEmailVerification,
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
  getDoc,
  getDocs,
  getFirestore,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

import { firebaseConfig } from "./firebase-config.js";
import { supabaseStorageConfig } from "./supabase-config.js";

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);

// NOTE: Hardcoded admin IDs are client-side fallbacks only.
// Security MUST be enforced via Firestore Security Rules.
const ADMIN_EMAILS = new Set([
  "keithwilsonplays@gmail.com",
  "neeon357@gmail.com"
]);
const ADMIN_USER_IDS = new Set([
  "GiCGuDEbtNcjALETb7oto1HntYS2",
  "nybe9fkHsMVysaCSMqG2oCWPEIn1"
]);

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
    taskProgress: existingData.taskProgress
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

export async function updateUserPassword(currentPassword, newPassword) {
  const authUser = await getReadyAuthUser();
  if (!authUser) {
    throw new Error("No signed-in user.");
  }
  if (!authUser.email) {
    throw new Error("Password change is only supported for email/password accounts.");
  }

  const credential = EmailAuthProvider.credential(authUser.email, currentPassword);
  await reauthenticateWithCredential(authUser, credential);
  await updatePassword(authUser, newPassword);
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
      taskProgress: storedUser.taskProgress
    }),
    emailVerified: Boolean(authUser.emailVerified)
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

  return {
    users: currentUser ? [currentUser] : [],
    classes,
    activeClassId: appState.activeClassId || classes[0]?.id || null
  };
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
      [`scores.${authUser.uid}`]: classData.scores?.[authUser.uid] || 0,
      updatedAt: serverTimestamp(),
      updatedBy: authUser.uid
    });
  }

  return toCyberGuardClass({ 
    id: classDoc.id, 
    ...classData, 
    students: Array.from(new Set([...(classData.students || []), authUser.uid])) 
  });
}

// ==========================================================================
// 3. LESSON STORAGE ENGINE (SUPABASE / BASE64 FALLBACK)
// ==========================================================================

const MAX_SUPABASE_LESSON_FILE_BYTES = 25 * 1024 * 1024; // 25MB
const MAX_LESSON_FILE_BYTES = 650 * 1024; // ~650KB

export async function uploadLesson(classId, file) {
  const authUser = await getReadyAuthUser();
  if (!authUser) throw new Error("Not signed in.");
  if (!classId) throw new Error("Select a class first.");

  if (isSupabaseStorageReady()) {
    return uploadSupabaseLesson(classId, file, authUser.uid);
  }

  if (file.size > MAX_LESSON_FILE_BYTES) {
    const maxMb = (MAX_LESSON_FILE_BYTES / (1024 * 1024)).toFixed(2);
    const fileMb = (file.size / (1024 * 1024)).toFixed(2);
    throw new Error(`File is ${fileMb}MB. Fallback Firestore limit is ${maxMb}MB. Configure Supabase for larger files.`);
  }

  const dataUrl = await fileToDataUrl(file);
  const id = `lesson-${Date.now()}`;
  const lesson = {
    id,
    classId,
    name: file.name,
    type: lessonFileType(file.name),
    size: file.size,
    dataUrl
  };

  await setDoc(doc(db, "lessons", id), {
    ...lesson,
    uploadedAt: serverTimestamp(),
    uploadedBy: authUser.uid
  });

  return lesson;
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
    await deleteSupabaseLesson(lesson.storagePath);
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
  const storagePath = lessonStoragePath(classId, id, file.name);

  const response = await fetch(`${supabaseStorageBaseUrl()}/object/${supabaseStorageConfig.bucket}/${encodeStoragePath(storagePath)}`, {
    method: "POST",
    headers: supabaseStorageHeaders({
      "cache-control": "3600",
      "content-type": file.type || "application/octet-stream",
      "x-upsert": "false"
    }),
    body: file
  });

  if (!response.ok) {
    throw new Error(await supabaseStorageErrorMessage(response));
  }

  const publicUrl = `${supabaseStorageBaseUrl()}/object/public/${supabaseStorageConfig.bucket}/${encodeStoragePath(storagePath)}`;
  const lesson = {
    id,
    classId,
    name: file.name,
    type: lessonFileType(file.name),
    size: file.size,
    dataUrl: publicUrl,
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

async function deleteSupabaseLesson(storagePath) {
  const response = await fetch(`${supabaseStorageBaseUrl()}/object/${supabaseStorageConfig.bucket}`, {
    method: "DELETE",
    headers: supabaseStorageHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ prefixes: [storagePath] })
  });

  if (!response.ok) {
    throw new Error(await supabaseStorageErrorMessage(response));
  }
}

function isSupabaseStorageReady() {
  return Boolean(
    supabaseStorageConfig?.enabled &&
    supabaseStorageConfig?.url &&
    supabaseStorageConfig?.anonKey &&
    supabaseStorageConfig?.bucket
  );
}

function supabaseStorageBaseUrl() {
  return `${supabaseStorageConfig.url.replace(/\/$/, "")}/storage/v1`;
}

function supabaseStorageHeaders(extra = {}) {
  return {
    apikey: supabaseStorageConfig.anonKey,
    authorization: `Bearer ${supabaseStorageConfig.anonKey}`,
    ...extra
  };
}

function lessonStoragePath(classId, lessonId, fileName) {
  const safeClassId = sanitizeStorageSegment(classId);
  const safeName = sanitizeStorageSegment(fileName);
  return `classes/${safeClassId}/${lessonId}-${safeName}`;
}

function sanitizeStorageSegment(value = "") {
  return String(value)
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96) || "file";
}

function encodeStoragePath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

async function supabaseStorageErrorMessage(response) {
  try {
    const data = await response.json();
    return data.message || data.error || `Supabase Storage upload failed (${response.status}).`;
  } catch {
    return `Supabase Storage upload failed (${response.status}).`;
  }
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("Could not read file."));
    reader.readAsDataURL(file);
  });
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
  if (selfUser) {
    operations.push({
      ref: doc(db, "users", authUser.uid),
      data: {
        ...toCyberGuardUser(selfUser),
        updatedAt: serverTimestamp()
      }
    });
  }

  // 2. Sync classes
  classes.forEach((klass) => {
    if (!klass?.id) return;
    const safeClass = toCyberGuardClass(klass);

    operations.push({
      ref: doc(db, "classes", safeClass.id),
      data: {
        ...safeClass,
        updatedAt: serverTimestamp(),
        updatedBy
      }
    });

    safeClass.students.forEach((studentId) => {
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

  // 3. Sync state pointers
  operations.push({
    ref: doc(db, "appState", "cyberguard"),
    data: {
      activeClassId: state.activeClassId || classes[0]?.id || null,
      updatedAt: serverTimestamp(),
      updatedBy
    }
  });

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

function toCyberGuardUser({ id, email, firstName, lastName, role, settings, photo, taskProgress }) {
  const safeFirstName = firstName || "New";
  const safeLastName = lastName || "Student";

  const user = {
    id,
    role: isAdminIdentity({ id, email }) ? "admin" : normalizeRole(role),
    email,
    firstName: safeFirstName,
    lastName: safeLastName,
    avatar: initials(safeFirstName, safeLastName)
  };

  if (settings && typeof settings === "object") user.settings = settings;
  if (photo) user.photo = photo;
  if (taskProgress && typeof taskProgress === "object") user.taskProgress = taskProgress;

  return user;
}

function normalizeRole(role) {
  const clean = String(role || "").trim().toLowerCase();
  return clean === "admin" ? "admin" : "student";
}

function isAdminIdentity({ id, email }) {
  return ADMIN_USER_IDS.has(String(id || "")) ||
    ADMIN_EMAILS.has(String(email || "").trim().toLowerCase());
}

function toCyberGuardClass({ id, name, section, code, teacher, students, scores, modules }) {
  return {
    id,
    name: name || "Cyber Class",
    section: section || "Section",
    code: code || "CG2026",
    teacher: teacher || "Cyber Teacher",
    students: Array.isArray(students) ? students : [],
    scores: scores && typeof scores === "object" ? scores : {},
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