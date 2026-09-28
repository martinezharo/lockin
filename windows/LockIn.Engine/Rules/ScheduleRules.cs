using LockIn.Engine.Models;

namespace LockIn.Engine.Rules;

/// <summary>
/// Schedule evaluation and the local-day key, ported from the PowerShell
/// watchdog. Days use the same numbering as JavaScript's getDay(): 0 = Sunday.
/// </summary>
public static class ScheduleRules
{
    public static bool IsWithinSchedule(GroupSchedule? schedule, DateTimeOffset localNow)
    {
        if (schedule?.Days is not { Count: > 0 }) return false;
        var day = (int)localNow.DayOfWeek;
        var minutes = localNow.Hour * 60 + localNow.Minute;
        var days = schedule.Days;
        var windows = schedule.EffectiveWindows();
        foreach (var window in windows)
        {
            var start = window.Start;
            var end = window.End;
            if (start == end && days.Contains(day)) return true;
            if (start < end && days.Contains(day) && minutes >= start && minutes < end) return true;
            if (start > end)
            {
                var previous = (day + 6) % 7;
                if ((days.Contains(day) && minutes >= start) || (days.Contains(previous) && minutes < end))
                {
                    return true;
                }
            }
        }
        return false;
    }

    public static string TodayKey(long nowMs)
    {
        return DateTimeOffset.FromUnixTimeMilliseconds(nowMs).ToLocalTime().ToString("yyyy-MM-dd");
    }

    public static DateTimeOffset LocalNow(long nowMs) => DateTimeOffset.FromUnixTimeMilliseconds(nowMs).ToLocalTime();
}
