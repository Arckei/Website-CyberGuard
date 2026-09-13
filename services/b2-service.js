// Client-side helper for the Backblaze B2 upload/download flow. Every call
// here talks to our own /api/* functions (never to Backblaze directly with a
// secret key) — the browser only ever gets short-lived, single-purpose URLs.
//
// Every exported function takes the signed-in Firebase Auth `user` object
// (the thing with .getIdToken() on it) as a parameter, rather than importing
// `auth` from firebase-service.js — that would create a circular import,
// since firebase-service.js's uploadLesson()/deleteLessonById() call into
// this file too.

async function callApi(path, user, body) {
  if (!user) throw new Error("Not signed in.");
  const token = await user.getIdToken();
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`
    },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Request to ${path} failed (${response.status}).`);
    // A definitive rejection (bad file, not an admin) shouldn't be treated
    // the same as "the endpoint isn't reachable" — callers use this to
    // decide whether falling back to another storage path even makes sense.
    error.status = response.status;
    throw error;
  }
  return data;
}

async function putFile(uploadUrl, file) {
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "content-type": file.type },
    body: file
  });
  if (!response.ok) {
    throw new Error(`Upload to storage failed (${response.status}).`);
  }
}

// Uploads the signed-in user's own avatar. Returns the storage key to save
// on their profile — the avatars bucket is private (Backblaze requires
// email verification + a payment method to unlock public buckets, which we
// don't have), so there's no permanent public URL; a signed link is
// requested fresh each time the photo is displayed, same as lesson files.
export async function uploadAvatar(file, user) {
  const { uploadUrl, key } = await callApi("/api/b2-avatar-upload-url", user, {
    contentType: file.type,
    size: file.size
  });
  await putFile(uploadUrl, file);
  return key;
}

// Owner or admin only (matches firestore.rules' users/{userId} read rule):
// exchanges an avatar's storage key for a short-lived signed link.
export async function getAvatarDownloadUrl(uid, key, user) {
  const { downloadUrl } = await callApi("/api/b2-avatar-download-url", user, { uid, key });
  return downloadUrl;
}

// Admin-only: uploads a lesson file for a class. Returns the storage key to
// save on the lesson document (NOT a permanent URL — lessons are private,
// so a fresh signed link is requested each time one is opened).
export async function uploadLessonFile(classId, file, user) {
  const { uploadUrl, key } = await callApi("/api/b2-lesson-upload-url", user, {
    classId,
    filename: file.name,
    contentType: file.type
  });
  await putFile(uploadUrl, file);
  // Verifies the real uploaded bytes server-side and deletes the object if
  // they don't match — throws here means the file never gets recorded as a
  // lesson (see the caller in firebase-service.js).
  await callApi("/api/b2-lesson-finalize", user, { key, filename: file.name });
  return key;
}

// Any signed-in user: exchanges a lesson's storage key for a short-lived
// signed link, right before it's opened.
export async function getLessonDownloadUrl(key, user) {
  const { downloadUrl } = await callApi("/api/b2-lesson-download-url", user, { key });
  return downloadUrl;
}

// Admin-only: permanently deletes a lesson file from storage.
export async function deleteLessonFile(key, user) {
  await callApi("/api/b2-lesson-delete", user, { key });
}
