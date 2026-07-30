// Uploads lesson attachments (PPT/PDF/DOCX) straight to a GitHub repo via
// the Contents API, using the credentials in github-config.js. See that
// file for the security tradeoffs of storing files this way with no backend.

import { GITHUB_CONFIG } from "./github-config.js";

const GITHUB_API_ROOT = "https://api.github.com";
const UPLOAD_FOLDER = "uploads/lessons";

export function isGithubConfigured() {
  return Boolean(GITHUB_CONFIG.owner && GITHUB_CONFIG.repo && GITHUB_CONFIG.token)
    && GITHUB_CONFIG.token !== "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";
}

// Uploads a File object to the configured repo and returns the metadata
// needed to display/download it later. Throws with a readable message on
// any failure (auth, network, or GitHub API error) so the caller can show
// the admin what actually went wrong instead of a silent/false success.
export async function uploadLessonFileToGithub(file, classId) {
  if (!isGithubConfigured()) {
    throw new Error("GitHub isn't configured yet — add your token to github-config.js first.");
  }

  const branch = GITHUB_CONFIG.branch || "main";
  const safeName = sanitizeFileName(file.name);
  const path = `${UPLOAD_FOLDER}/${classId}/${Date.now()}-${safeName}`;
  const base64Content = await fileToBase64(file);

  const response = await fetch(
    `${GITHUB_API_ROOT}/repos/${GITHUB_CONFIG.owner}/${GITHUB_CONFIG.repo}/contents/${path}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${GITHUB_CONFIG.token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: `Add lesson file: ${file.name}`,
        content: base64Content,
        branch
      })
    }
  );

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(errorBody.message || `GitHub upload failed (HTTP ${response.status}).`);
  }

  const data = await response.json();

  return {
    name: file.name,
    extension: fileExtension(file.name),
    size: file.size,
    path,
    downloadUrl: data.content?.download_url || buildRawUrl(path, branch),
    sha: data.content?.sha || null
  };
}

function buildRawUrl(path, branch) {
  return `https://raw.githubusercontent.com/${GITHUB_CONFIG.owner}/${GITHUB_CONFIG.repo}/${branch}/${path}`;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      resolve(result.split(",")[1] || "");
    };
    reader.onerror = () => reject(new Error("Could not read the selected file."));
    reader.readAsDataURL(file);
  });
}

function sanitizeFileName(name = "file") {
  return name.replace(/[^a-zA-Z0-9._-]/g, "-");
}

function fileExtension(name = "") {
  return name.split(".").pop()?.toLowerCase() || "file";
}
