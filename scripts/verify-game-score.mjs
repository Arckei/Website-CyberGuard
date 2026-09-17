import { parseGameScorePayload } from "../services/game-score.js";

const cases = [
  [{ fields: { tutorialScore: { integerValue: "120" } } }, 120],
  ['{"fields":{"tutorialScore":{"integerValue":"45"}}}', 45],
  [{ tutorialScore: 10 }, 10],
  [{ scoreValue: 80 }, 80],
  [0, 0],
  ["not-a-score", null],
  [{ fields: { tutorialScore: { integerValue: "-1" } } }, null]
];

let failed = 0;
for (const [input, expected] of cases) {
  const actual = parseGameScorePayload(input);
  if (actual !== expected) {
    failed += 1;
    console.error("FAIL", input, "expected", expected, "got", actual);
  }
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log(`Caught ${cases.length} score payload cases correctly.`);
}
