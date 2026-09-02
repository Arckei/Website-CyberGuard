import {
  ensureState,
  escapeHtml,
  getActiveClass,
  getState,
  hydrateStateFromFirebase,
  renderSkeletonRows,
  requireAuth,
  saveState,
  setupNav,
  setupPasswordToggles,
  showToast
} from "../../services/shared.js";

renderSkeletonRows("[data-class-list]", {
  count: 3,
  rowHtml: () => `
    <button class="class-tab skeleton" type="button" disabled aria-hidden="true">
      <strong>&nbsp;</strong><br />
      <span class="muted">&nbsp;</span>
    </button>
  `
});
renderSkeletonRows("[data-section-list]", {
  count: 1,
  rowHtml: () => `
    <div class="section-row skeleton" aria-hidden="true">
      <div>
        <h2>&nbsp;</h2>
        <p class="muted">&nbsp;</p>
      </div>
      <a class="btn" aria-hidden="true">&nbsp;</a>
    </div>
  `
});

document.addEventListener("DOMContentLoaded", async () => {
  ensureState();
  const authUser = await requireAuth("../login/");
  if (!authUser) return;
  if (authUser.role !== "admin") {
    showToast("Admin access only.");
    window.location.href = "../user/";
    return;
  }
  await hydrateStateFromFirebase();
  setupNav();
  setupPasswordToggles();
  renderManageClass();
});

function renderManageClass() {
  const state = getState();
  const classList = document.querySelector("[data-class-list]");
  const sectionList = document.querySelector("[data-section-list]");
  const active = getActiveClass(state);

  if (classList) {
    classList.innerHTML = state.classes.map((klass) => `
      <button class="class-tab ${klass.id === state.activeClassId ? "active" : ""}" type="button" data-select-class="${klass.id}">
        <strong>${escapeHtml(klass.name)}</strong><br />
        <span class="muted">${escapeHtml(klass.section)}</span>
      </button>
    `).join("");

    classList.querySelectorAll("[data-select-class]").forEach((button) => {
      button.addEventListener("click", () => {
        state.activeClassId = button.dataset.selectClass;
        saveState(state);
        renderManageClass();
      });
    });
  }

  if (sectionList && active) {
    sectionList.innerHTML = `
      <div class="section-row">
        <div>
          <h2>${escapeHtml(active.section)}</h2>
          <p class="muted">${active.students.length} students joined with code ${escapeHtml(active.code)}</p>
        </div>
        <a class="btn" href="../manage-students/">Manage</a>
      </div>
    `;
  }
}

