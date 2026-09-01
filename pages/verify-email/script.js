import { isCurrentUserEmailVerified, resendVerificationEmail, signOutUser } from "../../firebase-service.js";
import {
  clearPendingVerificationUser,
  ensureState,
  firebaseErrorMessage,
  getPendingVerificationUser,
  hideLoadingOverlay,
  setupNav,
  setupPasswordToggles,
  showLoadingOverlay,
  showToast,
  signInLocally
} from "../../shared.js";

showLoadingOverlay();

const CHECK_INTERVAL_MS = 4000;
let pollTimer = null;

document.addEventListener("DOMContentLoaded", async () => {
  ensureState();
  setupNav();
  setupPasswordToggles();

  const pendingUser = getPendingVerificationUser();
  if (!pendingUser) {
    // Nobody in the middle of signing up/in — nothing to hold them for.
    window.location.href = "../login/";
    return;
  }

  const messageEl = document.querySelector("[data-verify-message]");
  if (messageEl) {
    messageEl.textContent = `We sent a verification link to ${pendingUser.email}. Open it, then come back here to continue.`;
  }

  wireButtons(pendingUser);
  pollTimer = setInterval(() => checkVerification(pendingUser, { silent: true }), CHECK_INTERVAL_MS);
  await hideLoadingOverlay();
});

function wireButtons(pendingUser) {
  const resendButton = document.querySelector("[data-resend-btn]");
  const continueButton = document.querySelector("[data-continue-btn]");
  const differentAccountLink = document.querySelector("[data-different-account]");

  resendButton?.addEventListener("click", async () => {
    resendButton.disabled = true;
    try {
      const sent = await resendVerificationEmail();
      showToast(sent ? "Verification email resent." : "Your email is already verified — click Continue.");
    } catch (error) {
      showToast(firebaseErrorMessage(error));
    } finally {
      resendButton.disabled = false;
    }
  });

  continueButton?.addEventListener("click", async () => {
    continueButton.disabled = true;
    const verified = await checkVerification(pendingUser, { silent: false });
    if (!verified) continueButton.disabled = false;
  });

  differentAccountLink?.addEventListener("click", async (event) => {
    event.preventDefault();
    clearInterval(pollTimer);
    await signOutUser().catch(() => {});
    clearPendingVerificationUser();
    window.location.href = "../login/";
  });
}

async function checkVerification(pendingUser, { silent }) {
  const verified = await isCurrentUserEmailVerified();
  if (!verified) {
    if (!silent) showToast("Still not verified. Open the link in the email we sent, then try again.");
    return false;
  }

  clearInterval(pollTimer);
  markVerified();
  signInLocally({ ...pendingUser, emailVerified: true });
  clearPendingVerificationUser();

  setTimeout(() => {
    window.location.href = pendingUser.role === "admin" ? "../admin/" : "../user/";
  }, silent ? 900 : 300);

  return true;
}

function markVerified() {
  const status = document.querySelector("[data-verify-status]");
  const statusText = document.querySelector("[data-verify-status-text]");
  status?.classList.add("verified");
  if (statusText) statusText.textContent = "Verified! Taking you to your dashboard\u2026";
}

