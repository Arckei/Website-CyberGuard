# Live Quiz Feature — What Was Added & How To Set It Up

This adds a Kahoot-style live quiz to CyberGuard: admins write quizzes with
point values, host them live with a ready-check lobby, a bonus mini-game,
a live leaderboard, and a "send scores straight to students" button.
Students get a separate, glowing "Join Quiz" button under the Modules
button the moment a quiz goes live.

**v2 update:** the live-quiz mechanics now run on **Firebase Realtime
Database** instead of Firestore (faster/simpler for this kind of
short-lived, bursty classroom session), and the student-facing button is a
**separate** button placed under "Modules" — it no longer takes over or
relabels the Modules button itself.

**v3 update:**
- **Shuffle answer choices** — a checkbox when opening the lobby scrambles
  each student's choice order (client-side, deterministic per student) so
  they can't just call out a letter for others to copy. Grading is
  unaffected since it always compares against the original answer key.
- **Auto-advance** — the host no longer has to click "next question."
  Once every on-time student has answered (or the timer runs out,
  whichever's first), the quiz grades and moves on by itself. A manual
  "Skip Ahead Now" button is still there as a backstop.
- **Unified leaderboard** — the live leaderboard (and the one students see)
  now shows each student's *existing* class score (from the module games)
  plus their quiz points so far, as one running total — not a quiz-only
  score that starts back at zero.
- **Avatar bubbles** — a small colored initials badge next to each name in
  the lobby, live leaderboard, and results (not Quizizz's actual branding/
  assets — just the "player has a visible identity" idea, in CyberGuard's
  own look).
- **Remove a student before starting** — a Remove button next to each
  lobby entry lets the host kick someone out before (or during) the ready
  check.

**v4 update (this version):**
- **Quiz score is its own field** — `classes/{classId}.quizScores.{uid}`,
  separate from `scores.{uid}` (the field the module games write to via
  `updateClassScore`). This was a deliberate correction: the game modules
  treat `scores` as a "best run so far" value (`Math.max(previous,
  incoming)` in `pages/modules/script.js`), not a running sum. Adding quiz
  points directly into that field would have worked most of the time, but
  a later high game score could silently overwrite the quiz points that
  had been folded in. Splitting them out avoids that entirely. Every
  leaderboard, badge, and profile view now shows **gameplay + quiz = total**,
  with quiz points called out separately (e.g. "1500 pts (+100 quiz)").
- **`toCyberGuardClass()` / `toCyberGuardUser()` were silently dropping
  unknown fields** — both functions in `services/firebase-service.js` only
  ever kept the exact fields they were written to expect, so a brand-new
  field like `quizScores` (or `quizHistory` on a user) would vanish the
  moment the app re-synced from Firestore. Both are patched to pass these
  through now — this is a real, general-purpose fix, not just a quiz-only
  patch.
- **Profile Viewer** (`services/profile-viewer.js`) — a "View Profile"
  popup showing a student's gameplay score, quiz score, total, and quiz
  history. Wired into the admin's Leaderboard widget (click a row) and the
  host console (click a student anywhere: lobby, live leaderboard, or
  final results).
- **Student's own profile page** (`pages/profile/`) now has a Quiz History
  section, and the existing "points from gameplay" badge shows the
  "+quiz" breakdown too.


## 1. Where every requested feature lives

| You asked for... | Where it is |
|---|---|
| Admin makes questions + correct answers | **Quiz Maker** (`pages/quiz-maker/`) |
| Admin sets points per question | Each question in Quiz Maker has its own "Points" field |
| Buttons: Quiz Maker / Start a Quiz | Added to the admin dashboard (`pages/admin/`) |
| Live leaderboard | Host console's right-hand panel updates in real time; students see a mini live leaderboard too, and the final leaderboard at the end |
| 5-minute join window | Host sets "Join window (minutes)" (defaults to 5) when opening the lobby |
| Everyone must be Ready before starting | The lobby's **Start Quiz** button is disabled until every joined student has tapped "I'm Ready" (there's also a manual "Start Anyway" override for the teacher) |
| Students who don't join in time get no score | Grading only ever awards points to students whose status is `joined` (on time) — late joiners can still play along, but it's made clear their score won't count |
| A mini-game | **"Phish or Legit Blitz"** — a fast-paced bonus round themed around the site's phishing lessons, launchable mid-quiz from the host console |
| Send scores directly to students | The host's end screen has **"Send Scores to Students"**, which writes straight to each student's `users/{id}` profile in Firestore (and optionally adds the points to their class total) |
| Realtime database | All live-session mechanics (sessions, lobby, ready-check, answers, mini-game, live scores) run on **Firebase Realtime Database** — see the architecture note below |
| A **separate** Join Quiz button under Modules | `pages/user/` now shows a distinct button right under "Modules" that stays hidden until a quiz goes live — it does not rename or reuse the Modules button |

**v5 update (this version) — bug fixes from real testing, no new features:**
- **CRITICAL: score-adding was actually broken.** `sendQuizScoresToStudents` wrote
  to Firestore using `batch.set(ref, {"quizScores.uid": ...}, {merge:true})`.
  I told you earlier this was a Firebase-console typing artifact — **that was
  wrong, and I want to be upfront about it.** I verified it properly this time:
  Firestore only parses a dotted key like `"quizScores.uid"` as a nested field
  path under `update()`. Under `set()` — merge or not — a dotted string key is
  taken completely literally, creating a real top-level field named
  `quizScores.uid` sitting next to (not inside) the actual `quizScores` map.
  That's exactly what produced the stray `scores.<uid>` fields you saw in the
  Firestore console. Fixed by switching to `batch.update()`, which does parse
  dotted paths correctly. You can safely delete the old stray `scores.<uid>` /
  `quizScores.<uid>` flat fields from the console now — nothing reads them.
- **Swept the whole repo for every other place reading scores**, since the
  earlier fix only touched the new quiz surfaces. Also missing the quiz
  breakdown (now fixed): the student dashboard's Current Score/Class Rank
  (`pages/user/script.js`), the shared class leaderboard used there
  (`services/shared.js`'s `renderLeaderboard`), and the student score badges
  on Manage Students (`pages/manage-students/`) and the admin class roster
  (`pages/admin/script.js`).
- **Stale local cache was hiding fresh scores for up to 60 seconds.**
  `hydrateStateFromFirebase()` skips re-fetching from Firestore if the local
  cache is under a minute old — reasonable for most pages, but wrong for the
  two pages whose whole job is showing "your current standing" right after
  something changed it. `pages/user/` and `pages/profile/` now force a fresh
  fetch (bypassing that cache) on load. `pages/profile/` also had a real
  ordering bug: it rendered the badge/quiz-history panels *before* the fresh
  data even arrived, then never re-rendered them afterward — fixed by
  re-rendering once the fresh state is in.
- **A lobby that's never started (or cancelled) now expires.** If a host
  opens a lobby and never taps Start or Cancel — closed the tab, an old test
  run, whatever — it used to sit there forever, and any student loading the
  page would see "quiz time!" for a quiz that isn't really happening, with a
  frozen/expired countdown. Two fixes: (1) `openQuizLobby()` now closes out
  any old lobby/live/minigame session for that class before opening a new
  one, and (2) the student widget itself now periodically re-checks and
  stops treating a lobby as active once it's 2+ minutes past its join
  deadline with nothing having happened.
- **Floating "Join Quiz" bar is now dismissible** — a small ✕ button sits
  next to it so a student can dismiss the notification without opening the
  quiz. It comes back on its own the next time a *new* quiz goes live.
- **Question screen redesign, reverted per your feedback** — I'd built a
  fullscreen, colorful-tile answer layout; you asked to cancel that and go
  back to a plain list, so that's what's shipped, with one addition: the
  question prompt now sits in a box with the same red→gold glow already
  used elsewhere in the app, instead of being plain text.

## 2. New / changed files

```
services/quiz-service.js            Realtime Database engine: quizzes, live
                                     sessions, participants, grading,
                                     mini-game, and final score delivery
services/quiz-student-widget.js     Student-side: the separate "Join Quiz"
                                     button + floating bar + join/lobby/
                                     play/results modal
services/minigame-phish-blitz.js    The bonus mini-game
pages/quiz-maker/                   Admin: write quizzes
pages/host-quiz/                    Admin: run a live quiz session
database.rules.json                 Realtime Database security rules to paste
                                     into the Firebase console
```

Changed: `services/firebase-service.js` (+exports `rtdb`), `services/firebase-config.js`
(+`databaseURL` field you need to fill in), `pages/admin/index.html` (+2
buttons), `pages/admin/style.css` (+icon for those buttons), and
`pages/modules/index.html` / `pages/user/index.html` (+1 script tag each to
mount the student widget). Every `.min.js`/`.min.css` next to a changed
source file was regenerated with your existing `npm run build` step.

## 3. ⚠️ Two setup steps you need to do

### a) Enable Realtime Database + set the URL

1. Firebase console → your `cyberguard-56e66` project → **Build → Realtime
   Database → Create Database**. Pick a region close to your users (e.g.
   Singapore/`asia-southeast1` for the Philippines) and start in **locked
   mode** (we're supplying real rules below, not test-mode rules).
2. Copy the URL it gives you (looks like
   `https://cyberguard-56e66-default-rtdb.<region>.firebasedatabase.app`)
   into `services/firebase-config.js`, replacing
   `"REPLACE_WITH_YOUR_REALTIME_DATABASE_URL"`.
3. In the Realtime Database's **Rules** tab, paste in the contents of
   `database.rules.json` (or use the Firebase CLI: `firebase deploy --only
   database`).

### b) Firestore rules — unchanged, but double-check one thing

The one function that still touches Firestore is `sendQuizScoresToStudents`
(final scores → `users/{uid}` and `classes/{classId}`). Make sure your
*existing* Firestore rules already let an admin write to **any** student's
`users`/`classes` doc (not just their own) — the same permission your
current "remove student" / class-score features already need. I didn't
touch `firestore.rules` since it isn't in this repo.

## 4. Why Realtime Database, and a security detail worth knowing

A quiz session is short-lived and bursty — everyone reading/writing small
bits of state (who's ready, the current question, a running score map) over
a few minutes. That's what Realtime Database is built for, and it avoids
Firestore composite-index setup entirely for this feature.

One non-obvious rule detail: `quizAnswers` and `quizMinigameResults` are
stored as their **own top-level trees** (`quizAnswers/{sessionId}/...`)
rather than nested inside `quizSessions/{sessionId}/...`. This is
deliberate — Realtime Database read rules cascade downward as a grant, so
if `quizSessions/{id}` must be broadly readable (it has to be, so students
can see the live question and leaderboard), anything nested under it would
inherit that same broad read access — including other students' answers.
Keeping them as siblings lets each have its own tighter rule (host-only
read, write-your-own-uid-only) with no leakage. `database.rules.json`
implements exactly this.

The admin check in `database.rules.json` mirrors the hardcoded allow-list
already in `services/firebase-service.js` (`ADMIN_EMAILS`/`ADMIN_USER_IDS`).
If you add another teacher account, update it in **both** places — Realtime
Database rules can't look up Firestore data, so it can't check a `role`
field the way Firestore rules might; matching on `auth.uid`/`auth.token.email`
directly is the standard way to do this in RTDB.

## 5. How a session flows

1. **Quiz Maker** → write/save a quiz (title, questions, choices, correct
   answer, points, time limit per question).
2. **Start A Quiz** (host console) → pick a class + quiz + join window →
   **Open Lobby**. This creates a `quizSessions` entry and points
   `classActiveSession/{classId}` at it.
3. Students see a new **Join Quiz** button light up under Modules, plus a
   toast notification. They tap in, then tap **I'm Ready**.
4. Once everyone's ready (or the teacher overrides), **Start Quiz** reveals
   question 1 to everyone at once.
5. Teacher clicks **Grade & Next Question** after each question — this
   awards points only to on-time joiners who answered correctly, then
   reveals the next question.
6. Anytime mid-quiz, **Launch Bonus Mini-Game** opens "Phish or Legit Blitz"
   for everyone; **End Bonus Round & Award Points** folds each student's
   bonus score into the leaderboard.
7. **End Quiz** → final leaderboard → **Send Scores to Students** writes the
   result straight onto each student's Firestore profile (`quizHistory`)
   and, if checked, adds the points to their class total.

## 6. Known limitations (given the scope of this ask)

- If the host reloads the page mid-session, the control room doesn't
  currently resume — worth adding if you want that resilience later.
- Grading trusts the teacher's own browser tab (same trust model your app
  already uses for `updateClassScore`). Fine for a classroom setting, but
  isn't a tamper-proof server-graded system.
- The mini-game's message bank is short and easy to extend — its dataset
  lives right at the top of `services/minigame-phish-blitz.js`.
- I couldn't test this against your live Firebase project (no credentials
  in this environment) — please do a full run-through with a test class
  first, and watch the browser console for permission errors while you're
  setting up the rules above.
