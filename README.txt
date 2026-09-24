CyberGuard update: intro video, uploaded-lessons bug, episode tagging
======================================================================

HOW TO APPLY
------------
Drop every file here into the same path in your repo, overwriting what's
there, then commit + push. All the .min.js/.min.css files were generated
by actually running YOUR OWN scripts/minify.mjs (terser + clean-css, same
settings), so they match what `npm run build` would produce - no need to
re-run the build yourself unless you edit the source files further.

firestore.rules needs a separate `firebase deploy --only firestore:rules`
(or however you normally ship rule changes) - pushing to Vercel does not
touch Firestore rules.


1) EPISODE 1 INTRO VIDEO
-------------------------
File: pages/ep1/script.js (+ .min.js)

INTRO_VIDEO_URL was still pointing at the old placeholder clip
("What is Cyber Security_ (Explained in 1 Minute!).mp4"). Repointed it at
the real one you added: assets/Ep 1 Intro/CyberGuard - Episode 1.mp4.
Nothing else references the old filename, so this is the only change
needed for the redirect.


2) "UPLOADED FILES" BUG (the actual bug)
------------------------------------------
Files: pages/modules/script.js, pages/ep1/script.js (+ .min.js both)

Root cause: renderLessonTaskList() in pages/modules/script.js was a stub
that always wrote "No uploaded files available locally." - it never
queried anything. pages/ep1/script.js didn't even have that function; the
same text was just hardcoded straight into the HTML template. So no
matter what admin uploaded, students could never see it, on either page.

Fixed both to actually call getLessonsForClass(classId) (already existed
in services/firebase-service.js, already scoped by class - the class-
scoping you asked about was already correct at the data layer, it just
never got read on the student side), resolve each file's secure Supabase
URL, and render clickable rows wired into the existing lesson-preview
modal (openLessonModal - also already existed, just never got called from
here for anything but the local /Docs files).


3) EPISODE TAGGING + ADMIN INDICATOR
--------------------------------------
Files: services/firebase-service.js (+.min.js), firestore.rules,
       pages/class/index.html, pages/class/script.js (+.min.js),
       pages/admin/style.css (+.min.css)

Lesson docs in Firestore now carry an `episode` field: "episode0" or
"episode1". Admin's class page (pages/class/) has a new "Upload to:
Episode 0 / Episode 1" dropdown next to the Upload button - whatever is
selected there at upload time gets stamped on the lesson. Each uploaded
file in admin's list now shows a small badge with which episode it's
tagged for (this is the "indicator" - lets admin see at a glance where
each already-uploaded file goes without opening it).

On the student side: pages/modules/ (Episode 0) shows only lessons tagged
"episode0", pages/ep1/ shows only "episode1". Lessons uploaded before this
change has no episode field at all - both pages treat a missing episode as
"show it anyway" rather than hiding it, so nothing already uploaded
disappears; admin can go re-tag or re-upload those later if needed.

firestore.rules' create rule for /lessons now requires episode to be
exactly "episode0" or "episode1", matching the same strictness the rule
already had for classId/name/storagePath.


NOT CHANGED / WORTH KNOWING
-----------------------------
- Root-level firebase-service.js and shared.js (the copies sitting directly
  in the repo root, NOT inside services/) are not imported by any page I
  could find - looks like a leftover from before those moved into
  services/. Left untouched since deleting them wasn't part of what was
  asked and I didn't want to remove something without checking with you
  first, but worth confirming they're safe to delete since they're stale
  duplicates that could confuse future edits (e.g. someone edits the root
  copy by mistake and wonders why nothing changes).
