import { Action, ActionPanel, Detail, Icon, showToast, Toast } from "@raycast/api";
import { useEffect, useMemo, useState } from "react";
import {
  completeHabit,
  getHabit,
  getHabitStatistics,
  Habit,
  HabitStatistics,
  habitStatusLabel,
  isHabitifyError,
  undoHabit,
} from "../lib/habitify";
import { formatLocalDate } from "../lib/date";

type Props = {
  apiKey: string;
  habitId: string;
  habitName: string;
  onRefresh?: () => void;
};

function formatNumber(value: number) {
  return Number.isInteger(value) ? `${value}` : value.toFixed(1);
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

  return `# ${habit.name}\n\n- *Type:* ${habit.type}\n- *Status:* ${habit.isArchived ? "Archived" : "Active"}\n- *Start date:* ${habit.startDate}\n- *Goal:* ${progressText}\n- *Total logs:* ${formatNumber(stats.totalLogs)}\n- *Completions:* ${stats.completions}\n- *Fails:* ${stats.fails}\n- *Skips:* ${stats.skips}\n- *Average:* ${formatNumber(stats.avg)}${unit ? ` ${unit}` : ""}\n\n## Recent daily progress\n${recentMarkdown}`;
}

export default function HabitDetail({ apiKey, habitId, habitName, onRefresh }: Props) {
  const [habit, setHabit] = useState<Habit | null>(null);
  const [stats, setStats] = useState<HabitStatistics | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [habitResponse, statsResponse] = await Promise.all([
        getHabit(apiKey, habitId),
        getHabitStatistics(apiKey, habitId),
      ]);
      setHabit(habitResponse.data);
      setStats(statsResponse.data);
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
    const toast = await showToast({
      style: Toast.Style.Animated,
      title: action === "complete" ? "Completing habit…" : "Undoing habit…",
    });

    try {
      if (action === "complete") {
        await completeHabit(apiKey, habitId, targetDate);
      } else {
        await undoHabit(apiKey, habitId, targetDate);
      }
      toast.style = Toast.Style.Success;
      toast.title = action === "complete" ? "Habit completed" : "Habit undone";
      toast.message = `Updated ${habitName} for ${targetDate}.`;
      await load();
      onRefresh?.();
    } catch (err) {
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
      navigationTitle={habitName}
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
