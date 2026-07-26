import { loginWithGoogle, signupStudent } from "../../firebase-service.js";
import {
  ensureState,
  firebaseErrorMessage,
  getState,
  hydrateStateFromFirebase,
  passwordStatus,
  redirectIfAuthenticated,
  saveState,
  setupNav,
  setupPasswordToggles,
  showToast,
  validatePassword
} from "../../shared.js";

document.addEventListener("DOMContentLoaded", async () => {
  ensureState();
  await hydrateStateFromFirebase();
  setupNav();
  setupPasswordToggles();
  if (!redirectIfAuthenticated()) setupSignup();
});

function setupSignup() {
  const form = document.querySelector("[data-signup-form]");
  if (!form) return;
  setupGoogleSignIn();

  const passwordInput = form.password;
  const confirmInput = form.confirmPassword;
  const passwordChecks = document.querySelectorAll("[data-password-check]");
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
    const passwordError = validatePassword(form.password.value, form.confirmPassword.value);
    if (passwordError) {
      showToast(passwordError);
      if (passwordError === "Passwords do not match.") {
        form.confirmPassword.focus();
      } else {
        form.password.focus();
      }
      return;
    }

    const submitButton = form.querySelector("[type='submit']");
    if (submitButton) submitButton.disabled = true;

    try {
      const user = await signupStudent({
        email: form.email.value.trim().toLowerCase(),
        password: form.password.value,
        firstName: form.firstName.value.trim() || "New",
        lastName: form.lastName.value.trim() || "Student"
      });
      signInLocally(user);
      showToast("Account created with Firebase.");
      window.location.href = "../user/";
    } catch (error) {
      showToast(firebaseErrorMessage(error));
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });
}

function setupGoogleSignIn() {
  const button = document.querySelector("[data-google-sign-in]");
  if (!button) return;

  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const user = await loginWithGoogle();
      signInLocally(user);
      window.location.href = "../user/";
    } catch (error) {
      showToast(firebaseErrorMessage(error));
    } finally {
      button.disabled = false;
    }
  });
}

function signInLocally(user) {
  const state = getState();
  state.users = [...state.users.filter((item) => item.id !== user.id && item.email !== user.email), user];
  state.currentUserId = user.id;
  state.isLoggedIn = true;
  saveState(state);
}
