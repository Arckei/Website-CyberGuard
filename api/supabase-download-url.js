import { verifyIdToken, adminDb } from "./_lib/firebaseAdmin.js";
import { createDownloadUrl } from "./_lib/supabaseAdmin.js";
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

  const { path } = req.body || {};
  if (!path || typeof path !== "string") return res.status(400).json({ error: "Missing file path." });
  if (!path.startsWith("classes/") && !path.startsWith("avatars/")) return res.status(400).json({ error: "Invalid file path." });
  if (path.startsWith("avatars/") && !path.slice("avatars/".length).startsWith(`${decoded.uid}-`) && !(await isAdmin(decoded))) {
    return res.status(403).json({ error: "You can only view your own profile photo." });
  }

  try { return res.status(200).json({ url: await createDownloadUrl(path) }); }
  catch (error) {
    console.error("supabase-download-url:", error);
    return res.status(404).json({ error: "Could not create download URL." });
  }
}
