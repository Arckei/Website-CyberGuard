import { createClient } from "@supabase/supabase-js";

let client;

function getClient() {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("Supabase server secrets are not configured.");
    client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return client;
}

export function getBucket() {
  return process.env.SUPABASE_STORAGE_BUCKET || "cyberguard-lessons";
}

export async function createUploadUrl(path) {
  const { data, error } = await getClient().storage.from(getBucket()).createSignedUploadUrl(path);
  if (error) throw error;
  return data;
}

export async function createDownloadUrl(path) {
  const { data, error } = await getClient().storage.from(getBucket()).createSignedUrl(path, 300);
  if (error) throw error;
  return data.signedUrl;
}

export async function removeObject(path) {
  const { error } = await getClient().storage.from(getBucket()).remove([path]);
  if (error) throw error;
}
