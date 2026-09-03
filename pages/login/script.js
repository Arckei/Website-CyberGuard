import { loginUser, loginWithGoogle, sendPasswordReset } from "../../services/firebase-service.js";
import {
  ensureState,
  firebaseErrorMessage,
  hideLightLoadingOverlay,
  hydrateStateFromFirebase,
  initPageAnimations,
  redirectIfAuthenticated,
  sendToVerifyEmail,
  setupNav,
  setupPasswordToggles,
  showLightLoadingOverlay,
  showToast,
  signInLocally
} from "../../services/shared.js";

showLightLoadingOverlay();

document.addEventListener("DOMContentLoaded", async () => {
  ensureState();
  await hydrateStateFromFirebase();
  setupNav();
  setupPasswordToggles();
  if (!(await redirectIfAuthenticated())) setupLogin();
  initPageAnimations();
  await hideLightLoadingOverlay();
});

function setupLogin() {
  const form = document.querySelector("[data-login-form]");
  if (!form) return;

  setupGoogleSignIn();
  setupForgotPassword(form);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const submitButton = form.querySelector("[type='submit']");
    if (submitButton) submitButton.disabled = true;

    try {
      const user = await loginUser({
        email: form.email.value.trim().toLowerCase(),
        password: form.password.value
      });

      if (!user.emailVerified) {
        sendToVerifyEmail(user);
        return;
      }

      signInLocally(user);
      showToast("Signed in with Firebase.");
      window.location.href = user.role === "admin" ? "../admin/" : "../user/";
    } catch (error) {
      showToast(firebaseErrorMessage(error));
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });
}

function setupForgotPassword(loginForm) {
  const openLink = document.querySelector("[data-forgot-password-open]");
  const modal = document.querySelector("[data-forgot-password-modal]");
  const closeButton = document.querySelector("[data-forgot-password-close]");
  const resetForm = document.querySelector("[data-forgot-password-form]");
  if (!openLink || !modal || !resetForm) return;

  const openModal = (event) => {
    event.preventDefault();
    // Carry over whatever email the person already typed into the login form.
    if (loginForm?.email?.value) {
      resetForm.email.value = loginForm.email.value.trim();
    }
    modal.hidden = false;
    resetForm.email.focus();
  };

  const closeModal = () => {
    modal.hidden = true;
  };

  openLink.addEventListener("click", openModal);
  closeButton?.addEventListener("click", closeModal);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.hidden) closeModal();
  });

  resetForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitButton = resetForm.querySelector("[type='submit']");
    if (submitButton) submitButton.disabled = true;

    try {
      await sendPasswordReset(resetForm.email.value.trim().toLowerCase());
      showToast("Password reset link sent. Check your email.");
      closeModal();
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
      if (!user.emailVerified) {
        sendToVerifyEmail(user);
        return;
      }
      signInLocally(user);
      window.location.href = user.role === "admin" ? "../admin/" : "../user/";
    } catch (error) {
      showToast(firebaseErrorMessage(error));
    } finally {
      button.disabled = false;
    }
  });
}

