// POST { contentType } with an Authorization: Bearer <Firebase ID token> header.
// Returns a short-lived presigned PUT url for the CALLER'S OWN avatar object —
// nobody can request an upload URL for someone else's UID.
import { verifyIdToken } from "./_lib/firebaseAdmin.js";
import { presignPutUrl } from "./_lib/b2Client.js";
import { getBearerToken } from "./_lib/auth.js";

const ALLOWED_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif"
};
const MAX_BYTES = 2 * 1024 * 1024; // 2MB, matches the client-side check

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
    console.error("b2-avatar-upload-url: token verification failed:", error.message || error);
    return res.status(401).json({ error: "Invalid or expired session." });
  }

  const { contentType, size } = req.body || {};
  const ext = ALLOWED_TYPES[contentType];
  if (!ext) return res.status(400).json({ error: "Unsupported image type." });
  if (typeof size === "number" && size > MAX_BYTES) {
    return res.status(400).json({ error: "Image is too large (2MB max)." });
  }

  const key = `avatars/${decoded.uid}.${ext}`;

  try {
    const uploadUrl = await presignPutUrl({
      bucket: process.env.B2_AVATARS_BUCKET,
      key,
      contentType
    });
    return res.status(200).json({ uploadUrl, key });
  } catch (error) {
    console.error("b2-avatar-upload-url:", error);
    return res.status(500).json({ error: "Could not create upload URL." });
  }
}
