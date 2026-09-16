mergeInto(LibraryManager.library, {
  CyberGuardSetScore: function (score) {
    if (typeof window !== "undefined" && window.CyberGuardBridge) {
      window.CyberGuardBridge.receiveScore(score);
    }
  },
  CyberGuardCompleteTask: function (taskId) {
    if (typeof window !== "undefined" && window.CyberGuardBridge) {
      window.CyberGuardBridge.receiveTask(UTF8ToString(taskId), true);
    }
  },
  CyberGuardFinishEpisode: function (score) {
    if (typeof window !== "undefined" && window.CyberGuardBridge) {
      window.CyberGuardBridge.finishEpisode(score);
    }
  }
});