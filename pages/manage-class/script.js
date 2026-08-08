import {
  ensureState,
  escapeHtml,
  getActiveClass,
  getState,
  hydrateStateFromFirebase,
  saveState,
  setupNav,
  setupPasswordToggles
} from "../../shared.js";

document.addEventListener("DOMContentLoaded", async () => {
  ensureState();
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

