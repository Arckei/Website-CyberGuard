// profile-viewer.js
// A small, self-contained "View Profile" modal: gameplay score, quiz
// score, the combined total, and a history of quizzes taken. Anyone with a
// uid can open it — pass a classId too so the score breakdown resolves;
// without one it just shows the account info and quiz history.
//
// Usage: import { openProfileViewer } from "./profile-viewer.js";
//        openProfileViewer({ uid, classId });

import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
import { db } from "./firebase-service.js";
import { escapeHtml, fullName } from "./shared.js";

const AVATAR_COLORS = ["#ff303c", "#d9aa6a", "#34c684", "#4aa8ff", "#c77dff", "#ffb03a"];

function avatarColorFor(uid) {
  const seed = [...(uid || "")].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return AVATAR_COLORS[seed % AVATAR_COLORS.length];
}

function ensureStyles() {
  if (document.getElementById("cg-profile-viewer-styles")) return;
  const style = document.createElement("style");
  style.id = "cg-profile-viewer-styles";
  style.textContent = `
    #cg-profile-overlay {
      position: fixed; inset: 0; z-index: 9200;
      background: rgba(3,4,5,0.72);
      display: none; align-items: center; justify-content: center; padding: 18px;
    }
    #cg-profile-overlay.cg-open { display: flex; }
    #cg-profile-modal {
      width: min(420px, 100%); max-height: 88vh; overflow-y: auto;
      background: #0e1114; border: 1px solid #2b3036; border-radius: 16px;
      padding: 22px; color: #f2f4f5;
    }
    .cg-profile-close { float: right; background: none; border: none; color: #9aa3ad; font-size: 18px; cursor: pointer; }
    .cg-profile-head { display: flex; align-items: center; gap: 14px; margin-bottom: 16px; }
    .cg-profile-avatar {
      width: 56px; height: 56px; border-radius: 50%; flex-shrink: 0;
      display: grid; place-items: center; font-size: 20px; font-weight: 800; color: #06120c;
    }
    .cg-profile-head h2 { margin: 0; font-size: 18px; }
    .cg-profile-head p { margin: 2px 0 0; color: #9aa3ad; font-size: 13px; }
    .cg-profile-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 16px; }
    .cg-profile-stat { border: 1px solid #2b3036; border-radius: 10px; padding: 10px; text-align: center; }
    .cg-profile-stat strong { display: block; font-size: 18px; }
    .cg-profile-stat span { font-size: 11px; color: #9aa3ad; text-transform: uppercase; }
    .cg-profile-history-row {
      display: flex; justify-content: space-between; align-items: baseline; gap: 10px; padding: 8px 0;
      border-bottom: 1px solid #2b3036; font-size: 13px;
    }
    .cg-profile-history-row > span:first-child { flex: 1; min-width: 0; overflow-wrap: break-word; }
    .cg-profile-history-row > span:last-child { flex-shrink: 0; white-space: nowrap; }
    .cg-profile-history-row small { display: block; color: #9aa3ad; font-size: 11px; }
  `;
  document.head.append(style);
}

function buildModal() {
  ensureStyles();
  if (!document.getElementById("cg-profile-overlay")) {
    const overlay = document.createElement("div");
    overlay.id = "cg-profile-overlay";
    overlay.innerHTML = `<div id="cg-profile-modal" role="dialog" aria-modal="true"><button class="cg-profile-close" type="button" data-cg-profile-close aria-label="Close">\u2715</button><div data-cg-profile-body></div></div>`;
    document.body.append(overlay);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) overlay.classList.remove("cg-open");
    });
    overlay.querySelector("[data-cg-profile-close]").addEventListener("click", () => {
      overlay.classList.remove("cg-open");
    });
  }
  return {
    overlay: document.getElementById("cg-profile-overlay"),
    body: document.querySelector("[data-cg-profile-body]")
  };
}

export async function openProfileViewer({ uid, classId }) {
  if (!uid) return;
  const { overlay, body } = buildModal();
  overlay.classList.add("cg-open");
  body.innerHTML = `<p class="muted">Loading profile\u2026</p>`;

  try {
    const [userSnap, classSnap] = await Promise.all([
      getDoc(doc(db, "users", uid)),
      classId ? getDoc(doc(db, "classes", classId)) : Promise.resolve(null)
    ]);

    if (!userSnap.exists()) {
      body.innerHTML = `<p class="muted">This student's profile couldn't be found.</p>`;
      return;
    }

    const user = { id: uid, ...userSnap.data() };
    const classData = classSnap?.exists() ? classSnap.data() : null;
    const gameplayScore = Number(classData?.scores?.[uid] || 0);
    const quizScore = Number(classData?.quizScores?.[uid] || 0);
    const total = gameplayScore + quizScore;

    const history = Array.isArray(user.quizHistory)
      ? [...user.quizHistory].sort((a, b) => (b.awardedAt || 0) - (a.awardedAt || 0))
      : [];

    const historyHtml = history.length
      ? history
          .slice(0, 10)
          .map(
            (entry) => `
              <div class="cg-profile-history-row">
                <span>${escapeHtml(entry.quizTitle || "Quiz")}<small>${entry.awardedAt ? new Date(entry.awardedAt).toLocaleDateString() : ""}</small></span>
                <span>${Number(entry.score) || 0} pts</span>
              </div>
            `
          )
          .join("")
      : `<p class="muted">No quizzes taken yet.</p>`;

    body.innerHTML = `
      <div class="cg-profile-head">
        <span class="cg-profile-avatar" style="background:${avatarColorFor(uid)};">${escapeHtml((user.avatar || fullName(user).charAt(0) || "S").slice(0, 2))}</span>
        <div>
          <h2>${escapeHtml(fullName(user))}</h2>
          <p>${escapeHtml(user.email || "")}</p>
        </div>
      </div>
      <div class="cg-profile-stats">
        <div class="cg-profile-stat"><strong>${gameplayScore}</strong><span>Gameplay</span></div>
        <div class="cg-profile-stat"><strong>${quizScore}</strong><span>Quizzes</span></div>
        <div class="cg-profile-stat"><strong>${total}</strong><span>Total</span></div>
      </div>
      <h3 style="font-size:14px; margin-bottom:6px;">Quiz History</h3>
      <div>${historyHtml}</div>
    `;
  } catch (error) {
    console.warn("[CyberGuard] Could not load profile:", error);
    body.innerHTML = `<p class="muted">Could not load this profile right now.</p>`;
  }
}
