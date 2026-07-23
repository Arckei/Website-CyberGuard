import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signOut,
  signInWithEmailAndPassword,
  signInWithPopup,
  EmailAuthProvider,
  reauthenticateWithCredential,
  updateProfile,
  updatePassword
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  serverTimestamp,
  setDoc,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);

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

  return user;
}

export async function loginUser({ email, password }) {
  const credential = await signInWithEmailAndPassword(auth, email, password);
  const userRef = doc(db, "users", credential.user.uid);
  const userSnap = await getDoc(userRef);

  if (userSnap.exists()) {
    return toCyberGuardUser({
      id: credential.user.uid,
      email: credential.user.email,
      ...userSnap.data()
    });
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

  return user;
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
    role: userSnap.data()?.role || "student"
  });

  if (!userSnap.exists()) {
    await setDoc(userRef, {
      ...user,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  }

  return user;
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

  return toCyberGuardUser({
    id: authUser.uid,
    email: authUser.email || storedUser.email,
    firstName: storedUser.firstName || nameParts[0] || "New",
    lastName: storedUser.lastName || nameParts.slice(1).join(" ") || "Student",
    role: storedUser.role || "student"
  });
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

function toCyberGuardUser({ id, email, firstName, lastName, role }) {
  const safeFirstName = firstName || "New";
  const safeLastName = lastName || "Student";

  return {
    id,
    role: role || "student",
    email,
    firstName: safeFirstName,
    lastName: safeLastName,
    avatar: initials(safeFirstName, safeLastName)
  };
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
