import { auth, getSignedInUserProfile, hasPasswordProvider, signOutUser, updateUserPassword, uploadProfilePhoto } from "../../services/firebase-service.js";
import {
  applyCurrentUserSettings,
  applySettings,
  ensureState,
  escapeHtml,
  firebasePasswordErrorMessage,
  fullName,
  getCurrentUser,
  getCurrentUserSettings,
  getState,
  hydrateStateFromFirebase,
  initials,
  initPageAnimations,
  passwordStatus,
  renderAvatar,
  renderBadges,
  requireAuth,
  saveLocalState,
  saveState,
  setupNav,
  setupPasswordToggles,
  showToast,
  validatePassword
} from "../../services/shared.js";

document.addEventListener("DOMContentLoaded", async () => {
  ensureState();
  const authUser = await requireAuth("../login/");
  if (!authUser) return;
  applyCurrentUserSettings();
  setupNav();
  setupPasswordToggles();
  await setupProfile();
  // Forced (bypasses the 60s local cache): renderBadges()/renderQuizHistory()
  // already ran once above using whatever was in localStorage, which can be
  // stale right after a quiz just posted new scores. Re-render with the
  // freshly-hydrated state so the badge and history reflect the real
  // current totals instead of silently no-op'ing on a "fresh enough" cache.
  await hydrateStateFromFirebase(true);
  const freshState = getState();
  const freshUser = getCurrentUser(freshState);
  if (freshUser) {
    renderBadges(freshState, freshUser);
    renderQuizHistory(freshUser);
  }
  initPageAnimations();
});

async function setupProfile() {
  const state = getState();
  const form = document.querySelector("[data-profile-form]");
  const passwordForm = document.querySelector("[data-password-form]");
  const logoutButton = document.querySelector("[data-logout-btn]");
  const photoInput = document.querySelector("[data-profile-photo]");
  if (passwordForm) setupPasswordSection(passwordForm);
  let user = getCurrentUser(state);
  if (!form || !user) return;

  populateProfileFields(form, user);
  const settings = getCurrentUserSettings(state);
  form.darkMode.checked = settings.darkMode;
  form.reduceMotion.checked = settings.reduceMotion;
  form.compactDashboard.checked = settings.compactDashboard;
  form.showProgressDetails.checked = settings.showProgressDetails;
  form.privateDashboard.checked = settings.privateDashboard;
  form.reminderPrompts.checked = settings.reminderPrompts;
  applySettings(settings);
  renderAvatar(user);
  renderProfileIdentity(user);
  renderBadges(state, user);
  renderQuizHistory(user);

  const firebaseUser = await getSignedInUserProfile().catch(() => null);
  if (firebaseUser) {
    state.users = [...state.users.filter((item) => item.id !== firebaseUser.id && item.email !== firebaseUser.email), firebaseUser];
    state.currentUserId = firebaseUser.id;
    state.isLoggedIn = true;
    user = firebaseUser;
    saveLocalState(state);
    populateProfileFields(form, user);
    renderAvatar(user);
    renderProfileIdentity(user);
    renderBadges(state, user);
    renderQuizHistory(user);
  }

  const syncSettings = () => {
    user.settings = {
      darkMode: form.darkMode.checked,
      reduceMotion: form.reduceMotion.checked,
      compactDashboard: form.compactDashboard.checked,
      showProgressDetails: form.showProgressDetails.checked,
      privateDashboard: form.privateDashboard.checked,
      reminderPrompts: form.reminderPrompts.checked
    };
    saveState(state);
    applySettings(user.settings);
  };

  const MAX_PHOTO_BYTES = 2 * 1024 * 1024; // 2MB
  const ALLOWED_PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

  if (photoInput) {
    photoInput.addEventListener("change", async () => {
      const file = photoInput.files?.[0];
      if (!file) return;

      if (!ALLOWED_PHOTO_TYPES.has(file.type)) {
        showToast("Please choose a JPG, PNG, WEBP, or GIF image.");
        photoInput.value = "";
        return;
      }
      if (file.size > MAX_PHOTO_BYTES) {
        showToast("That image is too large. Please choose one under 2MB.");
        photoInput.value = "";
        return;
      }

      const previousPhoto = user.photo;
      showToast("Uploading photo\u2026");

      try {
        user.photo = await uploadProfilePhoto(file, user.id);
        if (!user.photo) {
          user.photo = await fileToDataUrl(file);
        }
        user.avatar = initials(user.firstName, user.lastName);
        renderAvatar(user);
        await saveState(state, { throwOnSyncError: true });
        showToast("Profile photo updated.");
      } catch (error) {
        console.error("CyberGuard: profile photo upload failed", error);
        user.photo = previousPhoto;
        renderAvatar(user);
        showToast(error?.message || "Could not save your photo. Please try again.");
      }
      photoInput.value = "";
    });
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    user.firstName = form.firstName.value.trim() || user.firstName;
    user.lastName = form.lastName.value.trim() || user.lastName;
    user.email = form.email.value.trim() || user.email;
    user.avatar = initials(user.firstName, user.lastName);
    syncSettings();
    renderAvatar(user);
    renderProfileIdentity(user);
    showToast("Profile saved.");
  });

  form.querySelectorAll("[data-setting-toggle]").forEach((toggle) => {
    toggle.addEventListener("change", () => {
      syncSettings();
      showToast("Settings updated.");
    });
  });

  if (logoutButton) {
    logoutButton.addEventListener("click", async () => {
      await signOutUser().catch(() => {});
      state.currentUserId = null;
      state.isLoggedIn = false;
      saveState(state);
      window.location.href = "../../index.html";
    });
  }
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("Could not read that image. Please try again."));
    reader.readAsDataURL(file);
  });
}

function applyPasswordFormAvailability(form, canChangePassword) {
  if (!form) return;

  const note = document.querySelector("[data-google-password-note]");
  if (note) note.hidden = canChangePassword;

  form.querySelectorAll("input, button").forEach((el) => {
    el.disabled = !canChangePassword;
  });

  form.classList.toggle("is-disabled", !canChangePassword);
}

// Decides whether the Change Password panel is usable, then locks or unlocks
// it. Google accounts have no CyberGuard password at all (updateUserPassword
// rejects them outright — see hasPasswordProvider), so for those the form is
// disabled and an explanation is shown instead: a student should be told
// their password lives in Google, not handed a form that can only fail.
//
// The answer comes from the LIVE Firebase Auth user, never from the cached
// profile in localStorage, and it is resolved here — first thing — rather
// than further down setupProfile(), which returns early whenever the cached
// user record is missing and used to leave the panel editable by accident.
function setupPasswordSection(form) {
  if (!form) return;

  setupPasswordChange(form);

  const decide = (authUser) => {
    // `null` means we could not read a signed-in user at all (requireAuth()
    // is already bouncing this page to the login screen), so leave the panel
    // exactly as it is instead of guessing.
    if (!authUser) return;
    applyPasswordFormAvailability(form, hasPasswordProvider(authUser));
  };

  // Usually already restored by the time this page runs, which keeps the
  // panel from flickering through a locked state on the way to unlocked.
  if (auth.currentUser) {
    decide(auth.currentUser);
    return;
  }

  const ready = typeof auth.authStateReady === "function" ? auth.authStateReady() : Promise.resolve();
  ready
    .catch(() => {})
    .then(() => decide(auth.currentUser));
}

function setupPasswordChange(form) {
  const passwordInput = form.querySelector("[name='newPassword']");
  const confirmInput = form.querySelector("[name='confirmPassword']");
  const passwordChecks = form.querySelectorAll("[data-password-check]");
  if (!passwordInput || !confirmInput) return;

  const updatePasswordChecks = () => {
    const status = passwordStatus(passwordInput.value, confirmInput.value);
    passwordChecks.forEach((indicator) => {
      const passed = Boolean(status[indicator.dataset.passwordCheck]);
      indicator.classList.toggle("valid", passed);
      indicator.closest(".password-check")?.classList.toggle("valid", passed);
    });
  };

  passwordInput.addEventListener("input", updatePasswordChecks);
  confirmInput.addEventListener("input", updatePasswordChecks);
  updatePasswordChecks();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    updatePasswordChecks();

    const passwordError = validatePassword(passwordInput.value, confirmInput.value);
    if (passwordError) {
      showToast(passwordError);
      if (passwordError === "Passwords do not match.") {
        confirmInput.focus();
      } else {
        passwordInput.focus();
      }
      return;
    }

    const submitButton = form.querySelector("[type='submit']");
    if (submitButton) submitButton.disabled = true;

    try {
      const currentPassword = form.querySelector("[name='currentPassword']")?.value;
      await updateUserPassword(currentPassword, passwordInput.value);
      form.reset();
      updatePasswordChecks();
      showToast("Password updated.");
    } catch (error) {
      showToast(firebasePasswordErrorMessage(error));
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });
}

function populateProfileFields(form, user) {
  const firstNameInput = form.querySelector("[name='firstName']");
  const lastNameInput = form.querySelector("[name='lastName']");
  const emailInput = form.querySelector("[name='email']");

  if (firstNameInput) firstNameInput.value = user.firstName || "";
  if (lastNameInput) lastNameInput.value = user.lastName || "";
  if (emailInput) emailInput.value = user.email || "";
}

function renderProfileIdentity(user) {
  const identity = document.querySelector("[data-profile-identity]");
  if (!identity) return;

  identity.innerHTML = `<strong>${escapeHtml(fullName(user))}</strong><span>${escapeHtml(user.email)}</span>`;
}

// Lists the student's own quizzes taken, newest first — the self-service
// version of the admin's "View Profile" popup (services/profile-viewer.js).
function renderQuizHistory(user) {
  const container = document.querySelector("[data-quiz-history]");
  if (!container) return;

  const history = Array.isArray(user.quizHistory)
    ? [...user.quizHistory].sort((a, b) => (b.awardedAt || 0) - (a.awardedAt || 0))
    : [];

  if (history.length === 0) {
    container.innerHTML = `<h2>Quiz History</h2><p class="muted">No quizzes taken yet.</p>`;
    return;
  }

  const rows = history
    .slice(0, 10)
    .map(
      (entry) => `
        <div style="display:flex; align-items:baseline; justify-content:space-between; gap:14px; padding:8px 0; border-bottom:1px solid rgba(154,163,173,0.2); font-size:14px;">
          <span style="min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(entry.quizTitle || "Quiz")}</span>
          <span class="muted" style="flex-shrink:0; white-space:nowrap;">${entry.score || 0} pts \u00B7 ${entry.awardedAt ? new Date(entry.awardedAt).toLocaleDateString() : ""}</span>
        </div>
      `
    )
    .join("");

  container.innerHTML = `<h2>Quiz History</h2>${rows}`;
}

