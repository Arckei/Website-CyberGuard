import { supabaseStorageConfig } from "./supabase-config.js";

async function api(path, user, body) {
  if (!user) throw new Error("Not signed in.");
  const token = await user.getIdToken();
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Storage request failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return data;
}

export async function uploadSecureFile({ kind, classId, file, user }) {
  const signed = await api("/api/supabase-upload-url", user, {
    kind,
    classId,
    filename: file.name,
    contentType: file.type
  });
  const response = await fetch(signed.signedUrl, {
    method: "PUT",
    headers: { "content-type": file.type || "application/octet-stream", "x-upsert": "false" },
    body: file
  });
  if (!response.ok) throw new Error(`Secure storage upload failed (${response.status}).`);
  return signed.path;
}

export async function getSecureFileUrl(path, user) {
  const data = await api("/api/supabase-download-url", user, { path });
  return data.url;
}

export async function deleteSecureLesson(path, user) {
  await api("/api/supabase-delete", user, { path });
}
