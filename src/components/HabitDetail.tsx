import { Action, ActionPanel, Detail, Icon, showToast, Toast } from "@raycast/api";
import { useEffect, useMemo, useState } from "react";
import {
  completeHabit,
  formatTimeOfDayRange,
  getHabit,
  getHabitStatistics,
  Habit,
  HabitStatistics,
  habitStatusLabel,
  isHabitifyError,
  sortTimeOfDays,
  TimeOfDay,
  undoHabit,
} from "../lib/habitify";
import { formatLocalDate } from "../lib/date";
import { formatCacheTimestamp, habitifyCacheKeys, latestCacheTimestamp, readCache, writeCache } from "../lib/cache";

type Props = {
  apiKey: string;
  habitId: string;
  habitName: string;
  onRefresh?: () => void;
};

function formatNumber(value: number) {
  return Number.isInteger(value) ? `${value}` : value.toFixed(1);
}

function formatTimeOfDaySummary(timeOfDays: TimeOfDay[]) {
  if (timeOfDays.length === 0) {
    return "Any time";
  }

  return sortTimeOfDays(timeOfDays)
    .map((period) => `${period.name} (${formatTimeOfDayRange(period)})`)
    .join(" · ");
}

function buildMarkdown(habit: Habit | null, stats: HabitStatistics | null) {
  if (!habit || !stats) {
    return "Loading habit details…";
  }

  const unit = stats.unit?.symbol ?? habit.customUnitName ?? "";
  const goal = habit.goals.find((item) => item.isActive);
  const progressText = goal
    ? `${goal.value} ${goal.unit}${habit.logMethod === "auto" ? " (auto)" : ""}`
    : "No active goal";

  const recentProgress = (stats.dailyProgress ?? []).slice(-7).reverse();
  const recentMarkdown =
    recentProgress.length > 0
      ? recentProgress
          .map((day) => `- ${day.date}: ${habitStatusLabel(day.status)}${day.totalLog ? ` (${formatNumber(day.totalLog)}${unit ? ` ${unit}` : ""})` : ""}`)
          .join("\n")
      : "- No recent progress available";

  const timeOfDaySummary = formatTimeOfDaySummary(habit.timeOfDays);

  return `# ${habit.name}\n\n- *Type:* ${habit.type}\n- *Status:* ${habit.isArchived ? "Archived" : "Active"}\n- *Start date:* ${habit.startDate}\n- *Schedule:* ${timeOfDaySummary}\n- *Goal:* ${progressText}\n- *Total logs:* ${formatNumber(stats.totalLogs)}\n- *Completions:* ${stats.completions}\n- *Fails:* ${stats.fails}\n- *Skips:* ${stats.skips}\n- *Average:* ${formatNumber(stats.avg)}${unit ? ` ${unit}` : ""}\n\n## Recent daily progress\n${recentMarkdown}`;
}

export default function HabitDetail({ apiKey, habitId, habitName, onRefresh }: Props) {
  const [habit, setHabit] = useState<Habit | null>(null);
  const [stats, setStats] = useState<HabitStatistics | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cacheNotice, setCacheNotice] = useState<string | null>(null);

  const load = async () => {
    setIsLoading(true);
    setError(null);
    setCacheNotice(null);

    try {
      const habitCacheKey = habitifyCacheKeys.habit(habitId);
      const statsCacheKey = habitifyCacheKeys.stats(habitId);
      const [cachedHabit, cachedStats] = await Promise.all([readCache<Habit>(habitCacheKey), readCache<HabitStatistics>(statsCacheKey)]);

      if (cachedHabit) {
        setHabit(cachedHabit.data);
      }
      if (cachedStats) {
        setStats(cachedStats.data);
      }
      if (cachedHabit && cachedStats) {
        const cachedAt = latestCacheTimestamp(cachedHabit.savedAt, cachedStats.savedAt);
        setCacheNotice(cachedAt ? `Showing cached data from ${formatCacheTimestamp(cachedAt)}` : "Showing cached data");
      }

      const [habitResponse, statsResponse] = await Promise.allSettled([
        getHabit(apiKey, habitId),
        getHabitStatistics(apiKey, habitId),
      ]);

      const liveHabit = habitResponse.status === "fulfilled" ? habitResponse.value.data : cachedHabit?.data;
      const liveStats = statsResponse.status === "fulfilled" ? statsResponse.value.data : cachedStats?.data;

      if (!liveHabit || !liveStats) {
        throw new Error(
          habitResponse.status === "rejected" && statsResponse.status === "rejected"
            ? "Habitify is unavailable and no cache exists yet."
            : "Habitify returned incomplete data.",
        );
      }

      setHabit(liveHabit);
      setStats(liveStats);

      if (habitResponse.status === "fulfilled") {
        await writeCache(habitCacheKey, habitResponse.value.data);
      }
      if (statsResponse.status === "fulfilled") {
        await writeCache(statsCacheKey, statsResponse.value.data);
      }

      if (habitResponse.status !== "fulfilled" || statsResponse.status !== "fulfilled") {
        const cachedAt = latestCacheTimestamp(cachedHabit?.savedAt, cachedStats?.savedAt);
        setCacheNotice(cachedAt ? `Showing cached data from ${formatCacheTimestamp(cachedAt)}` : "Showing cached data");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load habit details.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [apiKey, habitId]);

  const markdown = useMemo(() => {
    if (error) {
      return `# ${habitName}\n\n${error}`;
    }
    return buildMarkdown(habit, stats);
  }, [error, habit, habitName, stats]);

  const mutate = async (action: "complete" | "undo") => {
    const targetDate = formatLocalDate(new Date());
    const toastPromise = showToast({
      style: Toast.Style.Animated,
      title: action === "complete" ? "Completing habit…" : "Undoing habit…",
    });

    try {
      if (action === "complete") {
        await completeHabit(apiKey, habitId, targetDate);
      } else {
        await undoHabit(apiKey, habitId, targetDate);
      }
      const toast = await toastPromise;
      toast.style = Toast.Style.Success;
      toast.title = action === "complete" ? "Habit completed" : "Habit undone";
      toast.message = `Updated ${habitName} for ${targetDate}.`;
      await load();
      onRefresh?.();
    } catch (err) {
      const toast = await toastPromise;
      toast.style = Toast.Style.Failure;
      toast.title = action === "complete" ? "Could not complete habit" : "Could not undo habit";
      toast.message = isHabitifyError(err)
        ? `Habitify returned ${err.status}: ${err.message}`
        : err instanceof Error
          ? err.message
          : "Unknown error";
    }
  };

  return (
    <Detail
      isLoading={isLoading}
      markdown={markdown}
      navigationTitle={cacheNotice ? `${habitName} (cached)` : habitName}
      actions={
        <ActionPanel title={habitName}>
          <Action title="Refresh" icon={Icon.RotateClockwise} onAction={() => void load()} />
          <Action title="Mark Completed" icon={Icon.CheckCircle} onAction={() => void mutate("complete")} />
          <Action title="Undo Today" icon={Icon.ArrowCounterClockwise} onAction={() => void mutate("undo")} />
        </ActionPanel>
      }
    />
  );
}
