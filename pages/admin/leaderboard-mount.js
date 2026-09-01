import React from "https://esm.sh/react@18";
import { createRoot } from "https://esm.sh/react-dom@18/client";
import { LeaderboardWidget } from "./LeaderboardWidget.js";
const container = document.querySelector("[data-leaderboard]");
if (container) {
  const root = createRoot(container);
  root.render(/*#__PURE__*/React.createElement(LeaderboardWidget, null));
}