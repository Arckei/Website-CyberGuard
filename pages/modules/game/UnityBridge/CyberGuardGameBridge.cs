using System.Runtime.InteropServices;
using UnityEngine;

public static class CyberGuardGameBridge
{
#if UNITY_WEBGL && !UNITY_EDITOR
    [DllImport("__Internal")]
    private static extern void CyberGuardSetScore(int score);

    [DllImport("__Internal")]
    private static extern void CyberGuardCompleteTask(string taskId);

    [DllImport("__Internal")]
    private static extern void CyberGuardFinishEpisode(int score);
#endif

    public static void SetScore(int score)
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        CyberGuardSetScore(Mathf.Max(0, score));
#endif
    }

    public static void CompleteTask(string taskId)
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        if (!string.IsNullOrWhiteSpace(taskId))
            CyberGuardCompleteTask(taskId);
#endif
    }

    public static void FinishEpisode(int score)
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        CyberGuardFinishEpisode(Mathf.Max(0, score));
#endif
    }
}
