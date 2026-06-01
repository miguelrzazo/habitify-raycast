import {
  Action,
  ActionPanel,
  Icon,
  List,
  getPreferenceValues,
  openExtensionPreferences,
  showToast,
  Toast,
} from "@raycast/api";
import { useCallback, useEffect, useMemo, useState } from "react";
import HabitDetail from "./components/HabitDetail";
import { formatLocalDate } from "./lib/date";
import {
  completeHabit,
  getTodayJournal,
  habitProgressLabel,
  habitStatusLabel,
  isHabitifyError,
  JournalEntry,
  undoHabit,
} from "./lib/habitify";

interface Preferences {
  apiKey: string;
}

function statusIcon(status: JournalEntry["status"]) {
  switch (status) {
    case "completed":
      return Icon.CheckCircle;
    case "skipped":
      return Icon.MinusCircle;
    case "failed":
      return Icon.XMarkCircle;
    default:
      return Icon.Circle;
  }
}

export default function Command() {
  const { apiKey } = getPreferenceValues<Preferences>();
  const [habits, setHabits] = useState<JournalEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshCounter, setRefreshCounter] = useState(0);

  const loadHabits = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await getTodayJournal(apiKey, formatLocalDate(new Date()));
      setHabits(response.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load Habitify habits.");
    } finally {
      setIsLoading(false);
    }
  }, [apiKey]);

  useEffect(() => {
    void loadHabits();
  }, [loadHabits, refreshCounter]);

  const complete = useCallback(
    async (habitId: string, habitName: string) => {
      const targetDate = formatLocalDate(new Date());
      const toast = await showToast({ style: Toast.Style.Animated, title: "Completing habit…" });
      try {
        await completeHabit(apiKey, habitId, targetDate);
        toast.style = Toast.Style.Success;
        toast.title = "Habit completed";
        toast.message = habitName;
        await loadHabits();
      } catch (err) {
        toast.style = Toast.Style.Failure;
        toast.title = "Could not complete habit";
        toast.message = isHabitifyError(err)
          ? `Habitify returned ${err.status}: ${err.message}`
          : err instanceof Error
            ? err.message
            : "Unknown error";
      }
    },
    [apiKey, loadHabits],
  );

  const undo = useCallback(
    async (habitId: string, habitName: string) => {
      const targetDate = formatLocalDate(new Date());
      const toast = await showToast({ style: Toast.Style.Animated, title: "Undoing habit…" });
      try {
        await undoHabit(apiKey, habitId, targetDate);
        toast.style = Toast.Style.Success;
        toast.title = "Habit undone";
        toast.message = habitName;
        await loadHabits();
      } catch (err) {
        toast.style = Toast.Style.Failure;
        toast.title = "Could not undo habit";
        toast.message = isHabitifyError(err)
          ? `Habitify returned ${err.status}: ${err.message}`
          : err instanceof Error
            ? err.message
            : "Unknown error";
      }
    },
    [apiKey, loadHabits],
  );

  const emptyView = useMemo(() => {
    if (error) {
      return (
        <List.EmptyView
          icon={Icon.ExclamationMark}
          title="Unable to load Habitify"
          description={error}
          actions={
            <ActionPanel>
              <Action title="Open Extension Preferences" onAction={openExtensionPreferences} />
              <Action title="Retry" onAction={() => setRefreshCounter((value) => value + 1)} />
            </ActionPanel>
          }
        />
      );
    }

    return (
      <List.EmptyView
        icon={Icon.House}
        title="No habits found"
        description="Habitify did not return any habits for today."
        actions={
          <ActionPanel>
            <Action title="Refresh" onAction={() => setRefreshCounter((value) => value + 1)} />
          </ActionPanel>
        }
      />
    );
  }, [error]);

  return (
    <List isLoading={isLoading} navigationTitle="Today Habits" searchBarPlaceholder="Search habits">
      {habits.length === 0 ? (
        emptyView
      ) : (
        habits.map((habit) => {
          const detail = habitProgressLabel(habit);
          const accessories = [
            { text: habitStatusLabel(habit.status), icon: statusIcon(habit.status) },
          ];

          if (habit.currentStreak) {
            accessories.push({ text: `${habit.currentStreak.length}d`, icon: Icon.Gauge });
          }

          if (habit.progress) {
            accessories.push({ text: detail, icon: Icon.BarChart });
          }

          return (
            <List.Item
              key={habit.id}
              title={habit.name}
              subtitle={detail}
              icon={statusIcon(habit.status)}
              accessories={accessories}
              actions={
                <ActionPanel title={habit.name}>
                  {habit.status === "completed" ? (
                    <Action title="Undo Today" icon={Icon.ArrowCounterClockwise} onAction={() => void undo(habit.id, habit.name)} />
                  ) : (
                    <Action title="Mark Completed" icon={Icon.CheckCircle} onAction={() => void complete(habit.id, habit.name)} />
                  )}
                  <Action.Push
                    title="View Statistics"
                    icon={Icon.BarChart}
                    target={
                      <HabitDetail apiKey={apiKey} habitId={habit.id} habitName={habit.name} onRefresh={() => setRefreshCounter((value) => value + 1)} />
                    }
                  />
                  <Action title="Refresh" icon={Icon.RotateClockwise} onAction={() => setRefreshCounter((value) => value + 1)} shortcut={{ modifiers: ["cmd"], key: "r" }} />
                  <Action.CopyToClipboard title="Copy Habit ID" content={habit.id} />
                </ActionPanel>
              }
            />
          );
        })
      )}
    </List>
  );
}
