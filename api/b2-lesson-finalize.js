// POST { classId, key, filename, contentType } with an Authorization bearer
// token. Admin-only. Call this AFTER the browser PUTs the file to the
// presigned URL from /api/b2-lesson-upload-url, and BEFORE trusting the
// upload as real.
//
// The upload endpoint only ever saw a client-DECLARED contentType — nothing
// stopped someone with valid admin creds from calling that endpoint honestly,
// then PUTting a completely different file to the resulting URL. This step
// reads the real bytes back from B2 with our own server credentials (works
// even though the bucket is private) and checks: (a) the file starts with
// the magic number its extension implies, and (b) its actual stored size is
// sane. If either check fails, the object is deleted from B2 immediately and
// the lesson is never allowed to be recorded.
import { verifyIdToken, adminDb } from "./_lib/firebaseAdmin.js";
import { headObject, readObjectHeader, deleteObject } from "./_lib/b2Client.js";
import { getBearerToken } from "./_lib/auth.js";

const ADMIN_UIDS = new Set(["GiCGuDEbtNcjALETb7oto1HntYS2", "nybe9fkHsMVysaCSMqG2oCWPEIn1"]);
const ADMIN_EMAILS = new Set(["keithwilsonplays@gmail.com", "neeon357@gmail.com"]);
const MAX_LESSON_BYTES = 25 * 1024 * 1024; // 25MB — must match the upload endpoint's ceiling

async function isAdmin(decoded) {
  if (ADMIN_UIDS.has(decoded.uid)) return true;
  if (decoded.email_verified && ADMIN_EMAILS.has(String(decoded.email || "").toLowerCase())) return true;
  const snap = await adminDb().collection("users").doc(decoded.uid).get();
  return snap.exists && snap.data().role === "admin";
}

function extensionOf(filename) {
  return String(filename).split(".").pop()?.toLowerCase() || "";
}

// Same magic-number check as the client-side sniff in pages/class/script.js,
// just no longer optional — this one can't be bypassed by calling the API
// directly, because it inspects the bytes that actually landed in storage.
function looksValid(ext, header) {
  const startsWith = (...bytes) => bytes.every((byte, i) => header[i] === byte);
  if (ext === "pdf") return startsWith(0x25, 0x50, 0x44, 0x46); // %PDF
  if (ext === "docx" || ext === "pptx") return startsWith(0x50, 0x4b, 0x03, 0x04); // ZIP
  if (ext === "doc" || ext === "ppt") return startsWith(0xd0, 0xcf, 0x11, 0xe0); // legacy OLE
  return false;
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
    console.error("b2-lesson-finalize: token verification failed:", error.message || error);
    return res.status(401).json({ error: "Invalid or expired session." });
  }

  if (!(await isAdmin(decoded))) {
    return res.status(403).json({ error: "Admin access only." });
  }

  const { key, filename } = req.body || {};
  if (!key || typeof key !== "string" || !filename) {
    return res.status(400).json({ error: "Missing key or filename." });
  }

  const bucket = process.env.B2_LESSONS_BUCKET;
  const ext = extensionOf(filename);

  try {
    const meta = await headObject({ bucket, key });
    if ((meta.ContentLength || 0) > MAX_LESSON_BYTES) {
      await deleteObject({ bucket, key });
      return res.status(400).json({ error: "Uploaded file exceeds the size limit." });
    }

    const header = await readObjectHeader({ bucket, key, bytes: 8 });
    if (!looksValid(ext, header)) {
      await deleteObject({ bucket, key });
      return res.status(400).json({ error: "That file doesn't match a valid PDF, DOC, DOCX, PPT, or PPTX." });
    }

    return res.status(200).json({ ok: true, size: meta.ContentLength });
  } catch (error) {
    console.error("b2-lesson-finalize:", error);
    // Fail closed: if we can't verify it, don't let it stand as a lesson.
    await deleteObject({ bucket, key }).catch(() => {});
    return res.status(500).json({ error: "Could not verify the uploaded file." });
  }
}
