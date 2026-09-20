import React, { useEffect, useState } from "https://esm.sh/react@18";
import { fullName, getActiveClass, getState, hydrateStateFromFirebase } from "../../services/shared.js";
import { openProfileViewer } from "../../services/profile-viewer.js";

// A small, self-contained React version of the admin Leaderboard box.
// It manages its OWN loading state (skeleton rows) while it waits for
// Firebase data, instead of the box just sitting empty like before.
export function LeaderboardWidget() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [emptyMessage, setEmptyMessage] = useState(null);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      await hydrateStateFromFirebase();
      if (cancelled) return;
      const state = getState();
      const klass = getActiveClass(state);
      if (!klass || !Array.isArray(klass.students) || klass.students.length === 0) {
        setEmptyMessage("No students in this class yet.");
        setRows([]);
        setLoading(false);
        return;
      }
      const nextRows = klass.students.map(id => {
        const gameplayScore = klass.scores?.[id] || 0;
        const quizScore = klass.quizScores?.[id] || 0;
        return {
          id,
          classId: klass.id,
          user: state.users.find(item => item.id === id),
          gameplayScore,
          quizScore,
          score: gameplayScore + quizScore
        };
      }).filter(row => row.user).sort((a, b) => b.score - a.score);
      setEmptyMessage(nextRows.length === 0 ? "No active scores yet." : null);
      setRows(nextRows);
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);
  if (loading) {
    return /*#__PURE__*/React.createElement("div", {
      "aria-busy": "true",
      "aria-live": "polite"
    }, [0, 1, 2].map(key => /*#__PURE__*/React.createElement("div", {
      className: "leaderboard-row skeleton",
      key: key
    }, /*#__PURE__*/React.createElement("span", {
      className: "rank"
    }, "\xA0"), /*#__PURE__*/React.createElement("strong", null, "\xA0"), /*#__PURE__*/React.createElement("span", {
      className: "badge"
    }, "\xA0"))));
  }
  if (emptyMessage) {
    return /*#__PURE__*/React.createElement("p", {
      className: "muted"
    }, emptyMessage);
  }
  return /*#__PURE__*/React.createElement(React.Fragment, null, rows.map((row, index) => /*#__PURE__*/React.createElement("div", {
    className: "leaderboard-row",
    key: row.id,
    style: { cursor: "pointer" },
    title: "View profile",
    onClick: () => openProfileViewer({ uid: row.id, classId: row.classId })
  }, /*#__PURE__*/React.createElement("span", {
    className: "rank"
  }, index + 1), /*#__PURE__*/React.createElement("strong", null, fullName(row.user)), /*#__PURE__*/React.createElement("span", {
    className: "badge"
  }, Number(row.score), " points", row.quizScore > 0 ? ` (+${row.quizScore} quiz)` : ""))));
}