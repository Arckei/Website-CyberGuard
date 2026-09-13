// POST { classId, filename, contentType } with an Authorization bearer token.
// Admin-only — mirrors the same admin check used in firestore.rules, so
// this endpoint's notion of "admin" never drifts from the database rules.
import { verifyIdToken, adminDb } from "./_lib/firebaseAdmin.js";
import { presignPutUrl } from "./_lib/b2Client.js";
import { getBearerToken } from "./_lib/auth.js";

const ALLOWED_TYPES = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/msword": "doc",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx"
};

// Keep this mirrored with the admin allow-list in firestore.rules and
// services/firebase-service.js.
const ADMIN_UIDS = new Set(["GiCGuDEbtNcjALETb7oto1HntYS2", "nybe9fkHsMVysaCSMqG2oCWPEIn1"]);
const ADMIN_EMAILS = new Set(["keithwilsonplays@gmail.com", "neeon357@gmail.com"]);

async function isAdmin(decoded) {
  if (ADMIN_UIDS.has(decoded.uid)) return true;
  if (decoded.email_verified && ADMIN_EMAILS.has(String(decoded.email || "").toLowerCase())) return true;
  const snap = await adminDb().collection("users").doc(decoded.uid).get();
  return snap.exists && snap.data().role === "admin";
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed." });
  }

  const token = getBearerToken(req);
  if (!token) return res.status(401).json({ error: "Missing Authorization bearer token." });

  let decoded;
  try {
    decoded = await verifyIdToken(token);
  } catch (error) {
    console.error("b2-lesson-upload-url: token verification failed:", error.message || error);
    return res.status(401).json({ error: "Invalid or expired session." });
  }

  if (!(await isAdmin(decoded))) {
    return res.status(403).json({ error: "Admin access only." });
  }

  const { classId, filename, contentType } = req.body || {};
  const ext = ALLOWED_TYPES[contentType];
  if (!classId || typeof classId !== "string") {
    return res.status(400).json({ error: "Missing classId." });
  }
  if (!filename || !ext) {
    return res.status(400).json({ error: "Only PDF, DOC, DOCX, PPT, and PPTX files are allowed." });
  }

  const safeName = String(filename).replace(/[^a-zA-Z0-9._-]/g, "_");
  const key = `lessons/${classId}/${Date.now()}-${safeName}`;

  try {
    const uploadUrl = await presignPutUrl({
      bucket: process.env.B2_LESSONS_BUCKET,
      key,
      contentType
    });
    return res.status(200).json({ uploadUrl, key, contentType });
  } catch (error) {
    console.error("b2-lesson-upload-url:", error);
    return res.status(500).json({ error: "Could not create upload URL." });
  }
}
