import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
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

const ADMIN_EMAILS = new Set([
  "keithwilsonplays@gmail.com",
  "neeon357@gmail.com"
]);
const ADMIN_USER_IDS = new Set([
  "GiCGuDEbtNcjALETb7oto1HntYS2",
  "nybe9fkHsMVysaCSMqG2oCWPEIn1"
]);

export async function signupStudent({ email, password, firstName, lastName }) {
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(credential.user, {
    displayName: `${firstName} ${lastName}`.trim()
  });

  const user = toCyberGuardUser({
    id: credential.user.uid,
    email,
    firstName,
    lastName,
    role: "student"
  });

  await setDoc(doc(db, "users", user.id), {
    ...user,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  // Fire off the verification email but don't let a failure here block signup.
  try {
    await sendEmailVerification(credential.user);
  } catch (error) {
    console.warn("CyberGuard: failed to send verification email", error);
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

  const user = toCyberGuardUser({
    id: authUser.uid,
    email: authUser.email || "",
    firstName: userSnap.data()?.firstName || nameParts[0] || "New",
    lastName: userSnap.data()?.lastName || nameParts.slice(1).join(" ") || "Student",
    role: userSnap.data()?.role || "student",
    settings: userSnap.data()?.settings,
    photo: userSnap.data()?.photo,
    taskProgress: userSnap.data()?.taskProgress
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
      photo: storedUser.photo,
      taskProgress: storedUser.taskProgress
    }),
    emailVerified: Boolean(authUser.emailVerified)
  };
}

export async function loadCyberGuardData() {
  const authUser = await getReadyAuthUser();
  if (!authUser) return {};

  const [usersSnap, classesSnap, appStateSnap] = await Promise.all([
    getDocs(collection(db, "users")),
    getDocs(collection(db, "classes")),
    getDoc(doc(db, "appState", "cyberguard"))
  ]);

  const users = usersSnap.docs.map((item) => toCyberGuardUser({ id: item.id, ...item.data() }));
  const classes = classesSnap.docs.map((item) => toCyberGuardClass({ id: item.id, ...item.data() }));
  const appState = appStateSnap.exists() ? appStateSnap.data() : {};

  return {
    ...(users.length ? { users } : {}),
    ...(classes.length ? { classes } : {}),
    ...(appState.activeClassId || classes[0]?.id ? { activeClassId: appState.activeClassId || classes[0]?.id } : {})
  };
}

// Adds the signed-in user to a class by code with one narrow, targeted
// write to just that class document — not the full classes/users batch
// that saveCyberGuardData() does. This matters because Firestore rules only
// let a student touch a class doc to add themselves as a student; a student
// is never allowed to write the whole classes collection the way an admin
// can, and the old join flow (which routed through saveState() -> the full
// batch sync) got silently rejected by the security rules for that reason.
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

  return toCyberGuardClass({ id: classDoc.id, ...classData, students: [...(classData.students || []), authUser.uid] });
}

// ---------------- Lessons ----------------
// Supabase Storage is used for lesson files when configured. Firestore still
// stores lesson metadata, with a small base64 fallback for unconfigured demos.
// No Firebase Storage (Blaze plan) here — lesson files are stored directly
// in Firestore as base64 text, one document per lesson. Firestore documents
// cap out at 1 MiB total, and base64 inflates a file by roughly 1.37x, so
// we enforce a conservative max original file size well under that limit.
const MAX_SUPABASE_LESSON_FILE_BYTES = 25 * 1024 * 1024; // 25MB
const MAX_LESSON_FILE_BYTES = 650 * 1024; // ~650KB original file (~890KB base64)

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
    throw new Error(`That file is ${fileMb}MB, but the fallback limit is ${maxMb}MB. Set up Supabase Storage in supabase-config.js to upload bigger lesson files.`);
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
    throw new Error(`That file is ${fileMb}MB, but the Supabase upload limit in this app is ${maxMb}MB.`);
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
    supabaseStorageConfig.enabled &&
    supabaseStorageConfig.url &&
    supabaseStorageConfig.anonKey &&
    supabaseStorageConfig.bucket
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

export async function saveCyberGuardData(state) {
  const authUser = await getReadyAuthUser();
  if (!authUser) return;

  const batch = writeBatch(db);
  const users = Array.isArray(state.users) ? state.users : [];
  const classes = Array.isArray(state.classes) ? state.classes : [];
  const updatedBy = state.currentUserId || authUser.uid;

  users.forEach((user) => {
    if (!user?.id) return;
    batch.set(doc(db, "users", user.id), {
      ...toCyberGuardUser(user),
      updatedAt: serverTimestamp()
    }, { merge: true });
  });

  classes.forEach((klass) => {
    if (!klass?.id) return;
    const safeClass = toCyberGuardClass(klass);
    batch.set(doc(db, "classes", safeClass.id), {
      ...safeClass,
      updatedAt: serverTimestamp(),
      updatedBy
    }, { merge: true });

    safeClass.students.forEach((studentId) => {
      const progressId = `${safeClass.id}_${studentId}_phishing`;
      batch.set(doc(db, "progress", progressId), {
        id: progressId,
        classId: safeClass.id,
        userId: studentId,
        moduleId: "phishing",
        score: safeClass.scores[studentId] || 0,
        complete: Boolean(safeClass.modules?.phishing?.complete),
        updatedAt: serverTimestamp(),
        updatedBy
      }, { merge: true });
    });
  });

  batch.set(doc(db, "appState", "cyberguard"), {
    activeClassId: state.activeClassId || classes[0]?.id || null,
    updatedAt: serverTimestamp(),
    updatedBy
  }, { merge: true });

  await batch.commit();
}

function toCyberGuardUser({ id, email, firstName, lastName, role, settings, photo, taskProgress }) {
  const safeFirstName = firstName || "New";
  const safeLastName = lastName || "Student";

  const user = {
    id,
    role: isAdminIdentity({ id, email, firstName: safeFirstName, lastName: safeLastName }) ? "admin" : normalizeRole(role),
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

function getReadyAuthUser() {
  if (auth.currentUser) return Promise.resolve(auth.currentUser);

  return new Promise((resolve) => {
    let unsubscribe = () => {};
    const timer = setTimeout(() => {
      unsubscribe();
      resolve(auth.currentUser);
    }, 1500);

    unsubscribe = onAuthStateChanged(auth, (user) => {
      clearTimeout(timer);
      unsubscribe();
      resolve(user);
    });
  });
}
