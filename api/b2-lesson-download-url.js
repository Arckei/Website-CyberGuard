// POST { key } with an Authorization bearer token. Any signed-in user may
// request a short-lived read link (matches firestore.rules' current
// `allow read: if isSignedIn();` on the lessons collection) — this endpoint
// doesn't add a stricter per-class check beyond what the app already allows.
import { verifyIdToken } from "./_lib/firebaseAdmin.js";
import { presignGetUrl } from "./_lib/b2Client.js";
import { getBearerToken } from "./_lib/auth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed." });
  }

  const token = getBearerToken(req);
  if (!token) return res.status(401).json({ error: "Missing Authorization bearer token." });

  try {
    await verifyIdToken(token);
  } catch (error) {
    console.error("b2-lesson-download-url: token verification failed:", error.message || error);
    return res.status(401).json({ error: "Invalid or expired session." });
  }

  const { key } = req.body || {};
  if (!key || typeof key !== "string") {
    return res.status(400).json({ error: "Missing file key." });
  }

  try {
    const downloadUrl = await presignGetUrl({
      bucket: process.env.B2_LESSONS_BUCKET,
      key,
      expiresInSeconds: 300
    });
    return res.status(200).json({ downloadUrl });
  } catch (error) {
    console.error("b2-lesson-download-url:", error);
    return res.status(500).json({ error: "Could not create download URL." });
  }
}
