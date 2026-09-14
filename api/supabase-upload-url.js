import { verifyIdToken, adminDb } from "./_lib/firebaseAdmin.js";
import { createUploadUrl, getBucket } from "./_lib/supabaseAdmin.js";
import { getBearerToken } from "./_lib/auth.js";

const LESSON_TYPES = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/msword": "doc",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx"
};
const AVATAR_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const ADMIN_UIDS = new Set(["GiCGuDEbtNcjALETb7oto1HntYS2", "nybe9fkHsMVysaCSMqG2oCWPEIn1"]);
const ADMIN_EMAILS = new Set(["keithwilsonplays@gmail.com", "neeon357@gmail.com"]);

async function isAdmin(decoded) {
  if (decoded.admin === true || ADMIN_UIDS.has(decoded.uid)) return true;
  if (decoded.email_verified && ADMIN_EMAILS.has(String(decoded.email || "").toLowerCase())) return true;
  const snap = await adminDb().collection("users").doc(decoded.uid).get();
  return snap.exists && snap.data().role === "admin";
}

function safe(value) {
  return String(value || "").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "file";
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  const token = getBearerToken(req);
  if (!token) return res.status(401).json({ error: "Missing Authorization bearer token." });

  let decoded;
  try { decoded = await verifyIdToken(token); }
  catch { return res.status(401).json({ error: "Invalid or expired session." }); }

  const { kind, classId, filename, contentType } = req.body || {};
  const isAvatar = kind === "avatar";
  if (isAvatar && !AVATAR_TYPES.has(contentType)) return res.status(400).json({ error: "Unsupported image type." });
  if (!isAvatar && (!(await isAdmin(decoded)) || !classId || !LESSON_TYPES[contentType])) {
    return res.status(403).json({ error: "Admin access only or unsupported lesson type." });
  }

  const path = isAvatar
    ? `avatars/${decoded.uid}-${Date.now()}-${safe(filename)}`
    : `classes/${safe(classId)}/lesson-${Date.now()}-${safe(filename)}`;

  try {
    const data = await createUploadUrl(path);
    return res.status(200).json({ bucket: getBucket(), path, token: data.token });
  } catch (error) {
    console.error("supabase-upload-url:", error);
    return res.status(500).json({ error: "Could not create secure upload URL." });
  }
}
