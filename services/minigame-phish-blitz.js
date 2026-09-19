// minigame-phish-blitz.js
// "Phish or Legit Blitz" — the bonus mini-game the host can launch mid-quiz.
// A rapid-fire stream of short message previews; the student sorts each one
// into Phishing or Legit before the clock runs out. Fast + correct = more
// bonus points. Self-contained: no dependency on the quiz engine itself, so
// it can be dropped into any container and just reports a result back.

const ROUND_ITEMS = [
  { text: "\u201cYour package could not be delivered. Confirm your address in the next 10 minutes or it will be returned.\u201d", from: "delivery-status@parcel-trak.info", phishing: true },
  { text: "\u201cHi team, reminder that the sprint retro moved to 3pm today in the usual room.\u201d", from: "sched@yourcompany.com", phishing: false },
  { text: "\u201cWe detected unusual sign-in activity. Verify your identity now to avoid account suspension.\u201d", from: "security-alert@accountsverify-help.com", phishing: true },
  { text: "\u201cYour ride receipt for the trip on Tuesday is attached. Total: $8.40.\u201d", from: "receipts@rideapp.com", phishing: false },
  { text: "\u201cCongratulations! You have been selected to receive a free prize. Claim within 24 hours.\u201d", from: "winner-notice@claim-now-prizes.net", phishing: true },
  { text: "\u201cYour monthly statement is ready to view in your online banking portal.\u201d", from: "estatements@yourbank.com", phishing: false },
  { text: "\u201cUrgent: your mailbox is over quota. Click here immediately to avoid losing incoming mail.\u201d", from: "it-helpdesk@mailbox-quota-fix.com", phishing: true },
  { text: "\u201cHere's the shared folder for the group project we talked about in class.\u201d", from: "classmate@school.edu", phishing: false },
  { text: "\u201cYour subscription payment failed. Update your billing details right away to keep your account active.\u201d", from: "billing@update-my-account.co", phishing: true },
  { text: "\u201cReminder: library books are due back this Friday.\u201d", from: "library@school.edu", phishing: false },
  { text: "\u201cA new device signed in to your account from another country. If this wasn't you, secure it now.\u201d", from: "no-reply@secure-loginalert.com", phishing: true },
  { text: "\u201cThanks for signing up! Here's your receipt for the annual plan.\u201d", from: "receipts@streamingservice.com", phishing: false },
  { text: "\u201cYou have one unpaid toll. Pay now to avoid a late fee and legal action.\u201d", from: "tollpay@fastpass-billing.info", phishing: true },
  { text: "\u201cYour appointment with the school counselor is confirmed for Monday at 9am.\u201d", from: "guidance@school.edu", phishing: false },
  { text: "\u201cYour cloud storage is almost full. Click to upgrade instantly and avoid data loss.\u201d", from: "storage-notice@cloud-upgrade-now.com", phishing: true },
  { text: "\u201cGroup chat: don't forget to bring your laptop charger tomorrow.\u201d", from: "friend@personalmail.com", phishing: false }
];

function shuffled(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function ensureStyles() {
  if (document.getElementById("phish-blitz-styles")) return;
  const style = document.createElement("style");
  style.id = "phish-blitz-styles";
  style.textContent = `
    .phish-blitz { display: flex; flex-direction: column; gap: 14px; text-align: center; }
    .phish-blitz-hud { display: flex; justify-content: space-between; align-items: center; font-weight: 700; }
    .phish-blitz-timer-track { height: 8px; border-radius: 99px; background: rgba(154,163,173,0.25); overflow: hidden; }
    .phish-blitz-timer-fill { height: 100%; background: linear-gradient(90deg, #ff303c, #d9aa6a); transition: width 0.1s linear; }
    .phish-blitz-card { border: 1px solid rgba(154,163,173,0.35); border-radius: 14px; padding: 18px; background: rgba(154,163,173,0.06); min-height: 120px; display: flex; flex-direction: column; justify-content: center; gap: 8px; }
    .phish-blitz-card .from { font-size: 12px; opacity: 0.7; font-family: monospace; }
    .phish-blitz-card .msg { font-size: 15px; line-height: 1.4; }
    .phish-blitz-buttons { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .phish-blitz-buttons button { padding: 14px 10px; border-radius: 10px; border: none; font-weight: 800; font-size: 14px; cursor: pointer; transition: transform 0.08s ease; }
    .phish-blitz-buttons button:active { transform: scale(0.96); }
    .phish-blitz-flag { background: #ff303c; color: #fff; }
    .phish-blitz-legit { background: #34c684; color: #06120c; }
    .phish-blitz-card.flash-correct { animation: pb-flash-good 0.35s ease; }
    .phish-blitz-card.flash-wrong { animation: pb-flash-bad 0.35s ease; }
    @keyframes pb-flash-good { 0% { background: rgba(52,198,132,0.35); } 100% { background: rgba(154,163,173,0.06); } }
    @keyframes pb-flash-bad { 0% { background: rgba(255,48,60,0.35); } 100% { background: rgba(154,163,173,0.06); } }
    .phish-blitz-summary h3 { margin: 0 0 4px; }
  `;
  document.head.append(style);
}

/**
 * Mounts the mini-game inside `container`.
 * options: { durationSec, onFinish({hits, misses, streakBest, rawScore}) }
 */
export function mountPhishBlitz(container, { durationSec = 30, onFinish } = {}) {
  ensureStyles();
  const deck = shuffled(ROUND_ITEMS);
  let deckIndex = 0;
  let hits = 0;
  let misses = 0;
  let streak = 0;
  let streakBest = 0;
  let rawScore = 0;
  let finished = false;
  const endAt = Date.now() + durationSec * 1000;

  container.innerHTML = `
    <div class="phish-blitz">
      <div class="phish-blitz-hud">
        <span>\u26A1 Phish or Legit Blitz</span>
        <span data-pb-score>0 pts</span>
      </div>
      <div class="phish-blitz-timer-track"><div class="phish-blitz-timer-fill" data-pb-timer style="width:100%"></div></div>
      <div class="phish-blitz-card" data-pb-card>
        <span class="from" data-pb-from></span>
        <span class="msg" data-pb-msg></span>
      </div>
      <div class="phish-blitz-buttons">
        <button type="button" class="phish-blitz-flag" data-pb-choice="phishing">\u{1F6A9} Phishing</button>
        <button type="button" class="phish-blitz-legit" data-pb-choice="legit">\u2705 Legit</button>
      </div>
    </div>
  `;

  const els = {
    score: container.querySelector("[data-pb-score]"),
    timer: container.querySelector("[data-pb-timer]"),
    card: container.querySelector("[data-pb-card]"),
    from: container.querySelector("[data-pb-from]"),
    msg: container.querySelector("[data-pb-msg]"),
    choices: container.querySelectorAll("[data-pb-choice]")
  };

  function nextItem() {
    if (deckIndex >= deck.length) deckIndex = 0; // loop the deck if time remains
    const item = deck[deckIndex];
    deckIndex += 1;
    els.from.textContent = item.from;
    els.msg.textContent = item.text;
    container.dataset.pbCurrentIsPhishing = String(item.phishing);
    container.dataset.pbShownAt = String(Date.now());
  }

  function finish() {
    if (finished) return;
    finished = true;
    clearInterval(tickHandle);
    els.choices.forEach((button) => { button.disabled = true; });
    container.innerHTML = `
      <div class="phish-blitz phish-blitz-summary">
        <h3>Round Complete \u2014 ${rawScore} pts</h3>
        <p class="muted">${hits} correct \u00B7 ${misses} missed \u00B7 best streak ${streakBest}</p>
      </div>
    `;
    onFinish?.({ hits, misses, streakBest, rawScore });
  }

  function handleChoice(choice) {
    if (finished) return;
    const isPhishing = container.dataset.pbCurrentIsPhishing === "true";
    const correct = (choice === "phishing" && isPhishing) || (choice === "legit" && !isPhishing);
    const shownAt = Number(container.dataset.pbShownAt || Date.now());
    const reactionMs = Date.now() - shownAt;

    if (correct) {
      hits += 1;
      streak += 1;
      streakBest = Math.max(streakBest, streak);
      const speedBonus = Math.max(0, Math.round((2000 - Math.min(reactionMs, 2000)) / 100)); // up to +20
      rawScore += 10 + speedBonus;
      els.card.classList.remove("flash-wrong");
      void els.card.offsetWidth;
      els.card.classList.add("flash-correct");
    } else {
      misses += 1;
      streak = 0;
      els.card.classList.remove("flash-correct");
      void els.card.offsetWidth;
      els.card.classList.add("flash-wrong");
    }

    els.score.textContent = `${rawScore} pts`;
    nextItem();
  }

  els.choices.forEach((button) => {
    button.addEventListener("click", () => handleChoice(button.dataset.pbChoice));
  });

  nextItem();

  const tickHandle = setInterval(() => {
    const remainingMs = Math.max(0, endAt - Date.now());
    els.timer.style.width = `${(remainingMs / (durationSec * 1000)) * 100}%`;
    if (remainingMs <= 0) finish();
  }, 100);

  return {
    stop: finish
  };
}
