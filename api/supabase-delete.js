import { verifyIdToken, adminDb } from "./_lib/firebaseAdmin.js";
import { removeObject } from "./_lib/supabaseAdmin.js";
import { getBearerToken } from "./_lib/auth.js";

const ADMIN_UIDS = new Set(["GiCGuDEbtNcjALETb7oto1HntYS2", "nybe9fkHsMVysaCSMqG2oCWPEIn1"]);
const ADMIN_EMAILS = new Set(["keithwilsonplays@gmail.com", "neeon357@gmail.com"]);

async function isAdmin(decoded) {
  if (decoded.admin === true || ADMIN_UIDS.has(decoded.uid)) return true;
  if (decoded.email_verified && ADMIN_EMAILS.has(String(decoded.email || "").toLowerCase())) return true;
  const snap = await adminDb().collection("users").doc(decoded.uid).get();
  return snap.exists && snap.data().role === "admin";
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  const token = getBearerToken(req);
  if (!token) return res.status(401).json({ error: "Missing Authorization bearer token." });
  let decoded;
  try { decoded = await verifyIdToken(token); }
  catch { return res.status(401).json({ error: "Invalid or expired session." }); }
  if (!(await isAdmin(decoded))) return res.status(403).json({ error: "Admin access only." });

  const { path } = req.body || {};
  if (!path || typeof path !== "string" || !path.startsWith("classes/")) return res.status(400).json({ error: "Invalid lesson path." });
  try { await removeObject(path); return res.status(200).json({ ok: true }); }
  catch (error) {
    console.error("supabase-delete:", error);
    return res.status(500).json({ error: "Could not delete file." });
  }
}
