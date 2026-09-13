// POST { uid, key } with an Authorization bearer token. Mirrors the same
// access boundary as firestore.rules' users/{userId} read rule: only the
// owner or an admin may view a given avatar.
import { verifyIdToken, adminDb } from "./_lib/firebaseAdmin.js";
import { presignGetUrl } from "./_lib/b2Client.js";
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
  } catch (error) {
    console.error("b2-avatar-download-url: token verification failed:", error.message || error);
    return res.status(401).json({ error: "Invalid or expired session." });
  }

  const { uid, key } = req.body || {};
  if (!uid || !key) return res.status(400).json({ error: "Missing uid or key." });

  const isSelf = decoded.uid === uid;
  if (!isSelf && !(await isAdmin(decoded))) {
    return res.status(403).json({ error: "You can only view your own profile photo." });
  }

  try {
    // 3 days — avatars are viewed far more often than lessons, so a longer
    // expiry means the app doesn't need to re-sign a URL on every render.
    const downloadUrl = await presignGetUrl({
      bucket: process.env.B2_AVATARS_BUCKET,
      key,
      expiresInSeconds: 259200
    });
    return res.status(200).json({ downloadUrl });
  } catch (error) {
    console.error("b2-avatar-download-url:", error);
    return res.status(500).json({ error: "Could not create download URL." });
  }
}
