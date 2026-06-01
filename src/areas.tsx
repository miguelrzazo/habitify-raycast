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
  Area,
  completeHabit,
  getAreas,
  getHabits,
  getTodayJournal,
  habitProgressLabel,
  habitStatusLabel,
  isHabitifyError,
  mergeJournalWithHabits,
  TodayHabit,
  undoHabit,
} from "./lib/habitify";

interface Preferences {
  apiKey: string;
}

function statusIcon(status: TodayHabit["status"]) {
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

function nextStatusForAction(action: "complete" | "undo") {
  return action === "complete" ? "completed" : "inprogress";
}

function AreaHabitsView({ area, apiKey }: { area: Area; apiKey: string }) {
  const [habits, setHabits] = useState<TodayHabit[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshCounter, setRefreshCounter] = useState(0);
  const [cacheNotice, setCacheNotice] = useState<string | null>(null);
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
        const habitsCacheKey = habitifyCacheKeys.habitsByArea(area.id);

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
          getHabits(apiKey, { archived: false, areaId: area.id }),
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
        setError(err instanceof Error ? err.message : "Unable to load area habits.");
      } finally {
        if (!silent) {
          setIsLoading(false);
        }
      }
    },
    [apiKey, area.id],
  );

  useEffect(() => {
    void loadHabits();
  }, [loadHabits, refreshCounter]);

  const updateHabitStatus = useCallback((habitId: string, status: TodayHabit["status"]) => {
    setHabits((current) => current.map((habit) => (habit.id === habitId ? { ...habit, status } : habit)));
  }, []);

  const mutateHabit = useCallback(
    async (habitId: string, habitName: string, action: "complete" | "undo") => {
      const targetDate = formatLocalDate(new Date());
      const rollbackSnapshot = habitsRef.current;
      const toastPromise = showToast({
        style: Toast.Style.Animated,
        title: action === "complete" ? "Completing habit…" : "Undoing habit…",
      });

      updateHabitStatus(habitId, nextStatusForAction(action));

      try {
        if (action === "complete") {
          await completeHabit(apiKey, habitId, targetDate);
        } else {
          await undoHabit(apiKey, habitId, targetDate);
        }

        const toast = await toastPromise;
        toast.style = Toast.Style.Success;
        toast.title = action === "complete" ? "Habit completed" : "Habit undone";
        toast.message = habitName;
        void loadHabits({ silent: true });
      } catch (err) {
        setHabits(rollbackSnapshot);

        const toast = await toastPromise;
        toast.style = Toast.Style.Failure;
        toast.title = action === "complete" ? "Could not complete habit" : "Could not undo habit";
        toast.message = isHabitifyError(err)
          ? `Habitify returned ${err.status}: ${err.message}`
          : err instanceof Error
            ? err.message
            : "Unknown error";
      }
    },
    [apiKey, loadHabits, updateHabitStatus],
  );

  const emptyView = useMemo(() => {
    if (error) {
      return (
        <List.EmptyView
          icon={Icon.ExclamationMark}
          title="Unable to load area habits"
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
        title={`No habits in ${area.name}`}
        description="This area does not have any active habits right now."
        actions={
          <ActionPanel>
            <Action title="Refresh" onAction={() => setRefreshCounter((value) => value + 1)} />
          </ActionPanel>
        }
      />
    );
  }, [area.name, error]);

  return (
    <List
      isLoading={isLoading}
      navigationTitle={cacheNotice ? `${area.name} (cached)` : area.name}
      searchBarPlaceholder={`Search ${area.name.toLowerCase()} habits`}
    >
      {habits.length === 0 ? (
        emptyView
      ) : (
        habits.map((habit) => {
          const detail = habitProgressLabel(habit);
          const accessories = [{ text: habitStatusLabel(habit.status), icon: statusIcon(habit.status) }];

          if (habit.currentStreak) {
            accessories.push({ text: `${habit.currentStreak.length}d`, icon: Icon.Gauge });
          }

          if (habit.currentTimeOfDay) {
            accessories.push({ text: habit.currentTimeOfDay.name, icon: Icon.Clock });
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
                    <Action
                      title="Undo Today"
                      icon={Icon.ArrowCounterClockwise}
                      onAction={() => void mutateHabit(habit.id, habit.name, "undo")}
                    />
                  ) : (
                    <Action
                      title="Mark Completed"
                      icon={Icon.CheckCircle}
                      onAction={() => void mutateHabit(habit.id, habit.name, "complete")}
                    />
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
        })
      )}
    </List>
  );
}

export default function Command() {
  const { apiKey } = getPreferenceValues<Preferences>();
  const [areas, setAreas] = useState<Area[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshCounter, setRefreshCounter] = useState(0);
  const [cacheNotice, setCacheNotice] = useState<string | null>(null);

  const loadAreas = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const cachedAreas = await readCache<Area[]>(habitifyCacheKeys.areas);
      if (cachedAreas) {
        setAreas(cachedAreas.data);
        setCacheNotice(`Showing cached data from ${formatCacheTimestamp(cachedAreas.savedAt)}`);
      }

      const response = await getAreas(apiKey);
      setAreas(response.data);
      await writeCache(habitifyCacheKeys.areas, response.data);
      setCacheNotice(null);
    } catch (err) {
      const cachedAreas = await readCache<Area[]>(habitifyCacheKeys.areas);
      if (cachedAreas) {
        setAreas(cachedAreas.data);
        setCacheNotice(`Showing cached data from ${formatCacheTimestamp(cachedAreas.savedAt)}`);
      } else {
        setError(err instanceof Error ? err.message : "Unable to load Habitify areas.");
      }
    } finally {
      setIsLoading(false);
    }
  }, [apiKey]);

  useEffect(() => {
    void loadAreas();
  }, [loadAreas, refreshCounter]);

  const emptyView = useMemo(() => {
    if (error) {
      return (
        <List.EmptyView
          icon={Icon.ExclamationMark}
          title="Unable to load Habitify areas"
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
        title="No areas found"
        description="Create areas in Habitify to organize your habits."
        actions={
          <ActionPanel>
            <Action title="Refresh" onAction={() => setRefreshCounter((value) => value + 1)} />
          </ActionPanel>
        }
      />
    );
  }, [error]);

  return (
    <List
      isLoading={isLoading}
      navigationTitle={cacheNotice ? "Habit Areas (cached)" : "Habit Areas"}
      searchBarPlaceholder="Search areas"
    >
      {areas.length === 0 ? (
        emptyView
      ) : (
        areas.map((area) => (
          <List.Item
            key={area.id}
            title={area.name}
            icon={Icon.House}
            accessories={[{ text: area.id.slice(0, 6), icon: Icon.Tag }]}
            actions={
              <ActionPanel title={area.name}>
                <Action.Push
                  title="Open Area Habits"
                  icon={Icon.ArrowRight}
                  target={<AreaHabitsView area={area} apiKey={apiKey} />}
                />
                <Action title="Refresh" icon={Icon.RotateClockwise} onAction={() => setRefreshCounter((value) => value + 1)} />
                <Action.CopyToClipboard title="Copy Area ID" content={area.id} />
              </ActionPanel>
            }
          />
        ))
      )}
    </List>
  );
}
