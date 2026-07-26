import { loginUser, loginWithGoogle } from "../../firebase-service.js";
import {
  ensureState,
  firebaseErrorMessage,
  getState,
  hydrateStateFromFirebase,
  redirectIfAuthenticated,
  saveState,
  setupNav,
  setupPasswordToggles,
  showToast
} from "../../shared.js";

document.addEventListener("DOMContentLoaded", async () => {
  ensureState();
  await hydrateStateFromFirebase();
  setupNav();
  setupPasswordToggles();
  if (!redirectIfAuthenticated()) setupLogin();
});

function setupLogin() {
  const form = document.querySelector("[data-login-form]");
  const authOptions = document.querySelectorAll("[data-auth-method]");
  if (!form) return;

  authOptions.forEach((button) => {
    button.addEventListener("click", () => {
      authOptions.forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      form.dataset.authMethod = button.dataset.authMethod;
    });
  });

  setupGoogleSignIn();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if ((form.dataset.authMethod || "email") === "otp") {
      showToast("One-time code login is not connected yet. Use email and password.");
      return;
    }

    const submitButton = form.querySelector("[type='submit']");
    if (submitButton) submitButton.disabled = true;

    try {
      const user = await loginUser({
        email: form.email.value.trim().toLowerCase(),
        password: form.password.value
      });
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
      signInLocally(user);
      window.location.href = user.role === "admin" ? "../admin/" : "../user/";
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
