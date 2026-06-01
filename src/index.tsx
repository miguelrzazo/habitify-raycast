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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import HabitDetail from "./components/HabitDetail";
import { formatLocalDate } from "./lib/date";
import { formatCacheTimestamp, habitifyCacheKeys, latestCacheTimestamp, readCache, writeCache } from "./lib/cache";
import {
  completeHabit,
  getHabits,
  getTodayJournal,
  groupTodayHabits,
  habitProgressLabel,
  habitStatusLabel,
  isHabitifyError,
  mergeJournalWithHabits,
  resolveRowTint,
  skipHabit,
  sortTimeOfDays,
  statusTintColor,
  streakIcon,
  TodayHabit,
  undoHabit,
} from "./lib/habitify";

interface Preferences {
  apiKey: string;
  rowColorMode: "off" | "status" | "habit" | "area";
}

function statusIcon(status: TodayHabit["status"]) {
  switch (status) {
    case "completed":
      return Icon.CheckCircle;
    case "skipped":
      return Icon.ArrowRight;
    case "failed":
      return Icon.XMarkCircle;
    default:
      return Icon.Circle;
  }
}

function statusLabel(status: TodayHabit["status"]) {
  return habitStatusLabel(status);
}

function nextStatusForAction(action: "complete" | "undo") {
  return action === "complete" ? "completed" : "inprogress";
}

export default function Command() {
  const { apiKey, rowColorMode } = getPreferenceValues<Preferences>();
  const [habits, setHabits] = useState<TodayHabit[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshCounter, setRefreshCounter] = useState(0);
  const [cacheNotice, setCacheNotice] = useState<string | null>(null);
  const [timeFilter, setTimeFilter] = useState<string>("due-now");
  const [areaFilter, setAreaFilter] = useState<string>("all");
  const habitsRef = useRef<TodayHabit[]>([]);

  useEffect(() => {
    habitsRef.current = habits;
  }, [habits]);

  const loadHabits = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (!silent) {
        setIsLoading(true);
      }
      setError(null);
      setCacheNotice(null);

      try {
        const today = formatLocalDate(new Date());
        const journalCacheKey = habitifyCacheKeys.todayJournal(today);
        const habitsCacheKey = habitifyCacheKeys.activeHabits;

        const [cachedJournal, cachedHabits] = await Promise.all([
          readCache<Awaited<ReturnType<typeof getTodayJournal>>>(journalCacheKey),
          readCache<Awaited<ReturnType<typeof getHabits>>>(habitsCacheKey),
        ]);

        if (cachedJournal && cachedHabits) {
          const cachedMerged = mergeJournalWithHabits(cachedJournal.data.data, cachedHabits.data);
          setHabits(cachedMerged);
          const cachedAt = latestCacheTimestamp(cachedJournal.savedAt, cachedHabits.savedAt);
          setCacheNotice(cachedAt ? `Showing cached data from ${formatCacheTimestamp(cachedAt)}` : "Showing cached data");
        }

        const [journalResult, habitsResult] = await Promise.allSettled([
          getTodayJournal(apiKey, today),
          getHabits(apiKey, { archived: false }),
        ]);

        const journalData = journalResult.status === "fulfilled" ? journalResult.value.data : cachedJournal?.data.data;
        const habitCatalog = habitsResult.status === "fulfilled" ? habitsResult.value : cachedHabits?.data;

        if (!journalData || !habitCatalog) {
          throw new Error(
            journalResult.status === "rejected" && habitsResult.status === "rejected"
              ? "Habitify is unavailable and no cache exists yet."
              : "Habitify returned incomplete data.",
          );
        }

        if (journalResult.status === "fulfilled") {
          await writeCache(journalCacheKey, journalResult.value);
        }
        if (habitsResult.status === "fulfilled") {
          await writeCache(habitsCacheKey, habitsResult.value);
        }

        const merged = mergeJournalWithHabits(journalData, habitCatalog);
        setHabits(merged);

        const usedCache = journalResult.status !== "fulfilled" || habitsResult.status !== "fulfilled";
        if (usedCache) {
          const cachedAt = latestCacheTimestamp(cachedJournal?.savedAt, cachedHabits?.savedAt);
          setCacheNotice(cachedAt ? `Showing cached data from ${formatCacheTimestamp(cachedAt)}` : "Showing cached data");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to load Habitify habits.");
      } finally {
        if (!silent) {
          setIsLoading(false);
        }
      }
    },
    [apiKey],
  );

  useEffect(() => {
    void loadHabits();
  }, [loadHabits, refreshCounter]);

  const updateHabitStatus = useCallback((habitId: string, status: TodayHabit["status"]) => {
    setHabits((current) => current.map((habit) => (habit.id === habitId ? { ...habit, status } : habit)));
  }, []);

  const mutateHabit = useCallback(
    async (habitId: string, habitName: string, action: "complete" | "undo" | "skip") => {
      const targetDate = formatLocalDate(new Date());
      const rollbackSnapshot = habitsRef.current;
      const toastPromise = showToast({
        style: Toast.Style.Animated,
        title:
          action === "complete" ? "Completing habit…" : action === "skip" ? "Skipping habit…" : "Undoing habit…",
      });

      updateHabitStatus(habitId, action === "skip" ? "skipped" : nextStatusForAction(action));

      try {
        if (action === "complete") {
          await completeHabit(apiKey, habitId, targetDate);
        } else if (action === "skip") {
          await skipHabit(apiKey, habitId, targetDate);
        } else {
          await undoHabit(apiKey, habitId, targetDate);
        }

        const toast = await toastPromise;
        toast.style = Toast.Style.Success;
        toast.title = action === "complete" ? "Habit completed" : action === "skip" ? "Habit skipped" : "Habit undone";
        toast.message = habitName;
        void loadHabits({ silent: true });
      } catch (err) {
        setHabits(rollbackSnapshot);

        const toast = await toastPromise;
        toast.style = Toast.Style.Failure;
        toast.title =
          action === "complete"
            ? "Could not complete habit"
            : action === "skip"
              ? "Could not skip habit"
              : "Could not undo habit";
        toast.message = isHabitifyError(err)
          ? `Habitify returned ${err.status}: ${err.message}`
          : err instanceof Error
            ? err.message
            : "Unknown error";
      }
    },
    [apiKey, loadHabits, updateHabitStatus],
  );

  const timeOfDays = useMemo(() => {
    const pairs = habits.flatMap((habit) => habit.timeOfDays.map((period) => [period.id, period] as const));
    return sortTimeOfDays(Array.from(new Map(pairs).values()));
  }, [habits]);

  const areas = useMemo(() => {
    const pairs = habits.flatMap((habit) => habit.areas.map((area) => [area.id, area] as const));
    return Array.from(new Map(pairs).values()).sort((left, right) => left.name.localeCompare(right.name));
  }, [habits]);

  const filteredHabits = useMemo(() => {
    let next = habits;

    if (timeFilter === "due-now") {
      next = next.filter((habit) => habit.currentTimeOfDay !== null);
    } else if (timeFilter === "anytime") {
      next = next.filter((habit) => habit.timeOfDays.length === 0);
    } else if (timeFilter !== "all") {
      next = next.filter((habit) => habit.timeOfDays.some((period) => period.id === timeFilter));
    }

    if (areaFilter !== "all") {
      next = next.filter((habit) => habit.areas.some((area) => area.id === areaFilter));
    }

    return next;
  }, [areaFilter, habits, timeFilter]);

  const groups = useMemo(() => groupTodayHabits(filteredHabits), [filteredHabits]);

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

  const filteredEmptyView = useMemo(() => {
    if (habits.length === 0) {
      return emptyView;
    }

    return (
      <List.EmptyView
        icon={Icon.Filter}
        title="No habits match filters"
        description="Try switching to All Habits or clearing the area filter."
        actions={
          <ActionPanel>
            <Action title="Show All Habits" onAction={() => setTimeFilter("all")} />
            <Action title="Clear Area Filter" onAction={() => setAreaFilter("all")} />
            <Action title="Refresh" onAction={() => setRefreshCounter((value) => value + 1)} />
          </ActionPanel>
        }
      />
    );
  }, [emptyView, habits.length]);

  return (
    <List
      isLoading={isLoading}
      navigationTitle={cacheNotice ? "Today Habits (cached)" : "Today Habits"}
      searchBarPlaceholder="Search habits"
      searchBarAccessory={
        <>
          <List.Dropdown tooltip="Filter by time of day" value={timeFilter} onChange={setTimeFilter}>
            <List.Dropdown.Item title="Due Now" value="due-now" />
            <List.Dropdown.Item title="All Habits" value="all" />
            <List.Dropdown.Section title="Time of Day">
              {timeOfDays.map((period) => (
                <List.Dropdown.Item key={period.id} title={period.name} value={period.id} />
              ))}
              <List.Dropdown.Item title="Any time" value="anytime" />
            </List.Dropdown.Section>
          </List.Dropdown>
          <List.Dropdown tooltip="Filter by area" value={areaFilter} onChange={setAreaFilter}>
            <List.Dropdown.Item title="All Areas" value="all" />
            {areas.map((area) => (
              <List.Dropdown.Item key={area.id} title={area.name} value={area.id} />
            ))}
          </List.Dropdown>
        </>
      }
    >
      {filteredHabits.length === 0 ? (
        filteredEmptyView
      ) : (
        groups.map((group) => (
          <List.Section key={group.id} title={group.title} subtitle={group.subtitle}>
            {group.entries.map((habit) => {
              const detail = habitProgressLabel(habit);
              const accessories: List.Item.Accessory[] = [
                { text: statusLabel(habit.status), icon: { source: statusIcon(habit.status), tintColor: statusTintColor(habit.status) } },
              ];
              const rowTint = resolveRowTint(habit, rowColorMode);

              if (habit.currentStreak) {
                accessories.push({ text: `${habit.currentStreak.length}d`, icon: streakIcon() });
              }

              if (habit.timeOfDays.length > 1) {
                accessories.push({ text: `${habit.timeOfDays.length} slots`, icon: { source: Icon.Clock } });
              }

              return (
                <List.Item
                  key={habit.id}
                  title={habit.name}
                  subtitle={detail}
                  icon={rowTint ? { source: statusIcon(habit.status), tintColor: rowTint } : statusIcon(habit.status)}
                  accessories={accessories}
                  actions={
                    <ActionPanel title={habit.name}>
                      {habit.status === "completed" ? (
                        <Action
                          title="Undo Today"
                          icon={Icon.ArrowCounterClockwise}
                          onAction={() => void mutateHabit(habit.id, habit.name, "undo")}
                        />
                      ) : (
                        <>
                          <Action
                            title="Mark Completed"
                            icon={{ source: Icon.CheckCircle, tintColor: "#20B26B" }}
                            onAction={() => void mutateHabit(habit.id, habit.name, "complete")}
                          />
                          <Action
                            title="Skip Today"
                            icon={{ source: Icon.ArrowRight, tintColor: "#E8B200" }}
                            onAction={() => void mutateHabit(habit.id, habit.name, "skip")}
                          />
                        </>
                      )}
                      <Action.Push
                        title="View Statistics"
                        icon={Icon.BarChart}
                        target={
                          <HabitDetail
                            apiKey={apiKey}
                            habitId={habit.id}
                            habitName={habit.name}
                            onRefresh={() => setRefreshCounter((value) => value + 1)}
                          />
                        }
                      />
                      <Action
                        title="Refresh"
                        icon={Icon.RotateClockwise}
                        onAction={() => setRefreshCounter((value) => value + 1)}
                        shortcut={{ modifiers: ["cmd"], key: "r" }}
                      />
                      <Action.CopyToClipboard title="Copy Habit ID" content={habit.id} />
                    </ActionPanel>
                  }
                />
              );
            })}
          </List.Section>
        ))
      )}
    </List>
  );
}
