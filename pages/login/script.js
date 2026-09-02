import { loginUser, loginWithGoogle } from "../../services/firebase-service.js";
import {
  ensureState,
  firebaseErrorMessage,
  hideLightLoadingOverlay,
  hydrateStateFromFirebase,
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
  await hideLightLoadingOverlay();
});

function setupLogin() {
  const form = document.querySelector("[data-login-form]");
  if (!form) return;

  setupGoogleSignIn();

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

