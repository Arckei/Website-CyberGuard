import { getSignedInUserProfile, signOutUser, updateUserPassword } from "../../firebase-service.js";
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
  passwordStatus,
  renderAvatar,
  renderBadges,
  saveLocalState,
  saveState,
  setupNav,
  setupPasswordToggles,
  showToast,
  validatePassword
} from "../../shared.js";

document.addEventListener("DOMContentLoaded", async () => {
  ensureState();
  applyCurrentUserSettings();
  setupNav();
  setupPasswordToggles();
  setupProfile();
  await hydrateStateFromFirebase();
});

async function setupProfile() {
  const state = getState();
  const form = document.querySelector("[data-profile-form]");
  const passwordForm = document.querySelector("[data-password-form]");
  const logoutButton = document.querySelector("[data-logout-btn]");
  const photoInput = document.querySelector("[data-profile-photo]");
  if (passwordForm) setupPasswordChange(passwordForm);
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

  if (photoInput) {
    photoInput.addEventListener("change", () => {
      const file = photoInput.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = () => {
        user.photo = reader.result;
        user.avatar = initials(user.firstName, user.lastName);
        saveState(state);
        renderAvatar(user);
        showToast("Profile photo updated.");
      };
      reader.readAsDataURL(file);
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
