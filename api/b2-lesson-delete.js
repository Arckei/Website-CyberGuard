// POST { key } with an Authorization bearer token. Admin-only, mirrors
// `allow delete: if isAdmin();` in firestore.rules.
import { verifyIdToken, adminDb } from "./_lib/firebaseAdmin.js";
import { deleteObject } from "./_lib/b2Client.js";
import { getBearerToken } from "./_lib/auth.js";

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
  } catch {
    return res.status(401).json({ error: "Invalid or expired session." });
  }

  if (!(await isAdmin(decoded))) {
    return res.status(403).json({ error: "Admin access only." });
  }

  const { key } = req.body || {};
  if (!key || typeof key !== "string") {
    return res.status(400).json({ error: "Missing file key." });
  }

  try {
    await deleteObject({ bucket: process.env.B2_LESSONS_BUCKET, key });
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("b2-lesson-delete:", error);
    return res.status(500).json({ error: "Could not delete file." });
  }
}
