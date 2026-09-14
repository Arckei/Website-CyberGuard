import { supabaseStorageConfig } from "./supabase-config.js";

function storageBaseUrl() {
  return `${supabaseStorageConfig.url.replace(/\/$/, "")}/storage/v1`;
}

function encodePath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function safe(value) {
  return String(value || "").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "file";
}

export async function uploadSecureFile({ kind, classId, file, user }) {
  if (!user) throw new Error("Not signed in.");
  const path = kind === "avatar"
    ? `avatars/${safe(user.uid)}-${Date.now()}-${safe(file.name)}`
    : `classes/${safe(classId)}/lesson-${Date.now()}-${safe(file.name)}`;
  const response = await fetch(`${storageBaseUrl()}/object/${supabaseStorageConfig.bucket}/${encodePath(path)}`, {
    method: "POST",
    headers: {
      apikey: supabaseStorageConfig.anonKey,
      authorization: `Bearer ${supabaseStorageConfig.anonKey}`,
      "content-type": file.type || "application/octet-stream",
      "x-upsert": "false"
    },
    body: file
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || data.error || `Supabase upload failed (${response.status}).`);
  }
  return path;
}

export async function getSecureFileUrl(path, user) {
  if (!user) throw new Error("Not signed in.");
  return `${storageBaseUrl()}/object/public/${supabaseStorageConfig.bucket}/${encodePath(path)}`;
}

export async function deleteSecureLesson(path, user) {
  if (!user) throw new Error("Not signed in.");
  const response = await fetch(`${storageBaseUrl()}/object/${supabaseStorageConfig.bucket}`, {
    method: "DELETE",
    headers: {
      apikey: supabaseStorageConfig.anonKey,
      authorization: `Bearer ${supabaseStorageConfig.anonKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ prefixes: [path] })
  });
  if (!response.ok) throw new Error(`Supabase delete failed (${response.status}).`);
}
