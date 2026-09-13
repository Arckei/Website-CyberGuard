// Shared Firebase Admin bootstrap for the /api serverless functions.
// This runs server-side only (Vercel), never shipped to the browser.
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

function getServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT env var is not set.");
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`FIREBASE_SERVICE_ACCOUNT is not valid JSON: ${error.message}`);
  }
}

function getAdminApp() {
  if (!getApps().length) {
    initializeApp({ credential: cert(getServiceAccount()) });
  }
  return getApps()[0];
}

// Verifies a Firebase ID token sent from the browser. Throws if it's
// missing, expired, or forged — callers should catch and return 401.
export async function verifyIdToken(idToken) {
  return getAuth(getAdminApp()).verifyIdToken(idToken);
}

export function adminDb() {
  return getFirestore(getAdminApp());
}
