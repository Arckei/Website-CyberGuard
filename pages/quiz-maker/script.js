import {
  createQuiz,
  deleteQuiz,
  subscribeToQuizzes,
  updateQuiz
} from "../../services/quiz-service.js";
import {
  ensureState,
  escapeHtml,
  hydrateStateFromFirebase,
  initPageAnimations,
  requireAuth,
  setupNav,
  setupPasswordToggles,
  showToast
} from "../../services/shared.js";

let quizzes = [];
let editingQuizId = null; // null = creating a new quiz
let unsubscribeQuizzes = () => {};

document.addEventListener("DOMContentLoaded", async () => {
  ensureState();
  const authUser = await requireAuth("../login/");
  if (!authUser) return;
  await hydrateStateFromFirebase();
  setupNav();
  setupPasswordToggles();

  if (authUser.role !== "admin") {
    showToast("Admin access only.");
    window.location.href = "../user/";
    return;
  }

  unsubscribeQuizzes = subscribeToQuizzes((nextQuizzes) => {
    quizzes = nextQuizzes;
    renderQuizList();
  });

  resetEditorForNewQuiz();
  wireStaticButtons();
  initPageAnimations();
});

window.addEventListener("beforeunload", () => unsubscribeQuizzes());

// ==========================================================================
// LIST RENDERING
// ==========================================================================

function renderQuizList() {
  const list = document.querySelector("[data-quiz-list]");
  if (!list) return;

  if (quizzes.length === 0) {
    list.innerHTML = `<p class="muted">No quizzes yet. Click "+ New Quiz" to write your first one.</p>`;
    return;
  }

  list.innerHTML = quizzes
    .map(
      (quiz) => `
        <button class="quiz-list-row ${quiz.id === editingQuizId ? "active" : ""}" type="button" data-open-quiz="${quiz.id}">
          <strong>${escapeHtml(quiz.title)}</strong>
          <span class="badge">${(quiz.questions || []).length} question${(quiz.questions || []).length === 1 ? "" : "s"}</span>
        </button>
      `
    )
    .join("");

  list.querySelectorAll("[data-open-quiz]").forEach((button) => {
    button.addEventListener("click", () => openQuizForEditing(button.dataset.openQuiz));
  });
}

// ==========================================================================
// EDITOR: static button wiring
// ==========================================================================

function wireStaticButtons() {
  document.querySelector("[data-new-quiz]").addEventListener("click", resetEditorForNewQuiz);
  document.querySelector("[data-cancel-edit]").addEventListener("click", resetEditorForNewQuiz);
  document.querySelector("[data-add-question]").addEventListener("click", () => addQuestionCard());
  document.querySelector("[data-delete-quiz]").addEventListener("click", handleDeleteQuiz);
  document.querySelector("[data-quiz-form]").addEventListener("submit", handleSaveQuiz);
}

function resetEditorForNewQuiz() {
  editingQuizId = null;
  document.querySelector("[data-editor-eyebrow]").textContent = "New Quiz";
  document.querySelector("[data-editor-title]").textContent = "Untitled Quiz";
  document.querySelector("[data-quiz-form]").reset();
  document.querySelector("[data-question-list]").innerHTML = "";
  document.querySelector("[data-delete-quiz]").hidden = true;
  addQuestionCard(); // start with one blank question so the form isn't empty
  renderQuizList();
}

function openQuizForEditing(quizId) {
  const quiz = quizzes.find((item) => item.id === quizId);
  if (!quiz) return;

  editingQuizId = quizId;
  document.querySelector("[data-editor-eyebrow]").textContent = "Editing Quiz";
  document.querySelector("[data-editor-title]").textContent = quiz.title;
  const form = document.querySelector("[data-quiz-form]");
  form.elements.title.value = quiz.title || "";
  form.elements.description.value = quiz.description || "";

  document.querySelector("[data-question-list]").innerHTML = "";
  (quiz.questions || []).forEach((question) => addQuestionCard(question));
  document.querySelector("[data-delete-quiz]").hidden = false;
  renderQuizList();
  document.querySelector(".quiz-editor-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ==========================================================================
// EDITOR: dynamic question / choice cards
// ==========================================================================

function addQuestionCard(question = null) {
  const questionTemplate = document.querySelector("[data-question-template]");
  const card = questionTemplate.content.firstElementChild.cloneNode(true);
  const list = document.querySelector("[data-question-list]");
  list.append(card);

  card.querySelector("[data-q-prompt]").value = question?.prompt || "";
  card.querySelector("[data-q-points]").value = question?.points ?? 100;
  card.querySelector("[data-q-time]").value = question?.timeLimitSec ?? 20;

  const choices = question?.choices?.length ? question.choices : ["", ""];
  choices.forEach((choiceText, index) => {
    addChoiceRow(card, { text: choiceText, correct: index === (question?.correctIndex ?? 0) });
  });

  card.querySelector("[data-remove-question]").addEventListener("click", () => {
    card.remove();
    renumberQuestions();
  });
  card.querySelector("[data-add-choice]").addEventListener("click", () => addChoiceRow(card));

  renumberQuestions();
}

function addChoiceRow(card, { text = "", correct = false } = {}) {
  const choiceTemplate = document.querySelector("[data-choice-template]");
  const row = choiceTemplate.content.firstElementChild.cloneNode(true);
  const choiceList = card.querySelector("[data-choice-list]");
  const groupName = card.dataset.groupName || (card.dataset.groupName = `correct-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);

  const radio = row.querySelector("[data-choice-correct]");
  radio.name = groupName;
  radio.checked = correct;
  row.querySelector("[data-choice-text]").value = text;

  row.querySelector("[data-remove-choice]").addEventListener("click", () => {
    if (choiceList.children.length <= 2) {
      showToast("A question needs at least 2 answer choices.");
      return;
    }
    const wasCorrect = radio.checked;
    row.remove();
    if (wasCorrect) {
      const firstRadio = choiceList.querySelector("[data-choice-correct]");
      if (firstRadio) firstRadio.checked = true;
    }
  });

  choiceList.append(row);
}

function renumberQuestions() {
  document.querySelectorAll("[data-question-card]").forEach((card, index) => {
    card.querySelector("[data-question-number]").textContent = `Question ${index + 1}`;
  });
}

// ==========================================================================
// SAVE / DELETE
// ==========================================================================

function collectQuestionsFromForm() {
  return [...document.querySelectorAll("[data-question-card]")].map((card) => {
    const choiceRows = [...card.querySelectorAll(".choice-row")];
    const correctRowIndex = choiceRows.findIndex((row) => row.querySelector("[data-choice-correct]").checked);
    return {
      prompt: card.querySelector("[data-q-prompt]").value,
      points: card.querySelector("[data-q-points]").value,
      timeLimitSec: card.querySelector("[data-q-time]").value,
      correctIndex: correctRowIndex,
      choices: choiceRows.map((row) => row.querySelector("[data-choice-text]").value)
    };
  });
}

async function handleSaveQuiz(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const title = form.elements.title.value;
  const description = form.elements.description.value;
  const questions = collectQuestionsFromForm();

  const saveButton = document.querySelector("[data-save-quiz]");
  saveButton.disabled = true;
  saveButton.textContent = "Saving\u2026";

  try {
    if (editingQuizId) {
      await updateQuiz(editingQuizId, { title, description, questions });
      showToast("Quiz updated.");
    } else {
      const quiz = await createQuiz({ title, description, questions });
      editingQuizId = quiz.id;
      document.querySelector("[data-delete-quiz]").hidden = false;
      showToast("Quiz saved. Ready to host!");
    }
  } catch (error) {
    showToast(error.message || "Could not save this quiz.");
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = "Save Quiz";
  }
}

async function handleDeleteQuiz() {
  if (!editingQuizId) return;
  if (!window.confirm("Delete this quiz? This can't be undone.")) return;

  try {
    await deleteQuiz(editingQuizId);
    showToast("Quiz deleted.");
    resetEditorForNewQuiz();
  } catch (error) {
    showToast(error.message || "Could not delete this quiz.");
  }
}
