import {
  Action,
  ActionPanel,
  Icon,
  List,
  getPreferenceValues,
  openExtensionPreferences,
} from "@raycast/api";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatLocalDate } from "./lib/date";
import { formatCacheTimestamp, habitifyCacheKeys, latestCacheTimestamp, readCache, writeCache } from "./lib/cache";
import {
  getHabits,
  getTodayJournal,
  habitStatusLabel,
  mergeJournalWithHabits,
  statusIcon,
  statusTintColor,
  streakIcon,
  TodayHabit,
} from "./lib/habitify";

interface Preferences {
  apiKey: string;
}

type Summary = {
  total: number;
  completed: number;
  inprogress: number;
  skipped: number;
  failed: number;
};

function computeSummary(habits: TodayHabit[]): Summary {
  return habits.reduce<Summary>(
    (acc, habit) => {
      acc.total += 1;
      acc[habit.status] += 1;
      return acc;
    },
    { total: 0, completed: 0, inprogress: 0, skipped: 0, failed: 0 },
  );
}

export default function Command() {
  const { apiKey } = getPreferenceValues<Preferences>();
  const [habits, setHabits] = useState<TodayHabit[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshCounter, setRefreshCounter] = useState(0);
  const [cacheNotice, setCacheNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
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
        setHabits(mergeJournalWithHabits(cachedJournal.data.data, cachedHabits.data));
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

      setHabits(mergeJournalWithHabits(journalData, habitCatalog));

      const usedCache = journalResult.status !== "fulfilled" || habitsResult.status !== "fulfilled";
      if (usedCache) {
        const cachedAt = latestCacheTimestamp(cachedJournal?.savedAt, cachedHabits?.savedAt);
        setCacheNotice(cachedAt ? `Showing cached data from ${formatCacheTimestamp(cachedAt)}` : "Showing cached data");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load Habitify statistics.");
    } finally {
      setIsLoading(false);
    }
  }, [apiKey]);

  useEffect(() => {
    void load();
  }, [load, refreshCounter]);

  const summary = useMemo(() => computeSummary(habits), [habits]);
  const completionRate = summary.total > 0 ? Math.round((summary.completed / summary.total) * 100) : 0;
  const summaryText = `Today: ${summary.completed}/${summary.total} completed, ${summary.inprogress} in progress, ${summary.skipped} skipped, ${summary.failed} failed.`;

  const streakHabits = useMemo(() => {
    return habits
      .filter((habit) => (habit.currentStreak?.length ?? 0) > 0)
      .sort((left, right) => (right.currentStreak?.length ?? 0) - (left.currentStreak?.length ?? 0) || left.name.localeCompare(right.name));
  }, [habits]);

  const byArea = useMemo(() => {
    const map = new Map<string, { id: string; name: string; count: number; completed: number }>();
    for (const habit of habits) {
      const areas = habit.areas.length > 0 ? habit.areas : [{ id: "no-area", name: "No Area" }];
      for (const area of areas) {
        const existing = map.get(area.id) ?? { id: area.id, name: area.name, count: 0, completed: 0 };
        existing.count += 1;
        existing.completed += habit.status === "completed" ? 1 : 0;
        map.set(area.id, existing);
      }
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [habits]);

  const byTimeOfDay = useMemo(() => {
    const map = new Map<string, { id: string; name: string; count: number; completed: number }>();
    for (const habit of habits) {
      const periods = habit.timeOfDays.length > 0 ? habit.timeOfDays : [{ id: "anytime", name: "Any time" }];
      for (const period of periods) {
        const existing = map.get(period.id) ?? { id: period.id, name: period.name, count: 0, completed: 0 };
        existing.count += 1;
        existing.completed += habit.status === "completed" ? 1 : 0;
        map.set(period.id, existing);
      }
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [habits]);

  const emptyView = useMemo(() => {
    if (!error) {
      return (
        <List.EmptyView
          icon={Icon.BarChart}
          title="No habits found"
          description="Habitify did not return any habits for today."
          actions={
            <ActionPanel>
              <Action title="Refresh" onAction={() => setRefreshCounter((value) => value + 1)} />
            </ActionPanel>
          }
        />
      );
    }

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
  }, [error]);

  const navigationTitle = cacheNotice ? "Today Stats (cached)" : "Today Stats";

  return (
    <List isLoading={isLoading} navigationTitle={navigationTitle} searchBarPlaceholder="Search stats">
      {habits.length === 0 ? (
        emptyView
      ) : (
        <>
          <List.Section title="Overview" subtitle={`${completionRate}% completed`}>
            <List.Item
              title="Completed"
              actions={
                <ActionPanel>
                  <Action title="Refresh" icon={Icon.RotateClockwise} onAction={() => setRefreshCounter((value) => value + 1)} />
                  <Action.CopyToClipboard title="Copy Summary" content={summaryText} />
                  <Action title="Open Extension Preferences" icon={Icon.Gear} onAction={openExtensionPreferences} />
                </ActionPanel>
              }
              accessories={[{ text: `${summary.completed}/${summary.total}`, icon: { source: statusIcon("completed"), tintColor: statusTintColor("completed") } }]}
            />
            <List.Item
              title="In Progress"
              actions={
                <ActionPanel>
                  <Action title="Refresh" icon={Icon.RotateClockwise} onAction={() => setRefreshCounter((value) => value + 1)} />
                  <Action.CopyToClipboard title="Copy Summary" content={summaryText} />
                  <Action title="Open Extension Preferences" icon={Icon.Gear} onAction={openExtensionPreferences} />
                </ActionPanel>
              }
              accessories={[{ text: `${summary.inprogress}/${summary.total}`, icon: { source: statusIcon("inprogress"), tintColor: statusTintColor("inprogress") } }]}
            />
            <List.Item
              title="Skipped"
              actions={
                <ActionPanel>
                  <Action title="Refresh" icon={Icon.RotateClockwise} onAction={() => setRefreshCounter((value) => value + 1)} />
                  <Action.CopyToClipboard title="Copy Summary" content={summaryText} />
                  <Action title="Open Extension Preferences" icon={Icon.Gear} onAction={openExtensionPreferences} />
                </ActionPanel>
              }
              accessories={[{ text: `${summary.skipped}/${summary.total}`, icon: { source: statusIcon("skipped"), tintColor: statusTintColor("skipped") } }]}
            />
            <List.Item
              title="Failed"
              actions={
                <ActionPanel>
                  <Action title="Refresh" icon={Icon.RotateClockwise} onAction={() => setRefreshCounter((value) => value + 1)} />
                  <Action.CopyToClipboard title="Copy Summary" content={summaryText} />
                  <Action title="Open Extension Preferences" icon={Icon.Gear} onAction={openExtensionPreferences} />
                </ActionPanel>
              }
              accessories={[{ text: `${summary.failed}/${summary.total}`, icon: { source: statusIcon("failed"), tintColor: statusTintColor("failed") } }]}
            />
          </List.Section>

          <List.Section title="Streaks" subtitle={streakHabits.length ? `${streakHabits.length} active` : "None"}>
            {streakHabits.length === 0 ? (
              <List.Item
                title="No active streaks"
                actions={
                  <ActionPanel>
                    <Action title="Refresh" icon={Icon.RotateClockwise} onAction={() => setRefreshCounter((value) => value + 1)} />
                    <Action.CopyToClipboard title="Copy Summary" content={summaryText} />
                    <Action title="Open Extension Preferences" icon={Icon.Gear} onAction={openExtensionPreferences} />
                  </ActionPanel>
                }
              />
            ) : (
              streakHabits.slice(0, 15).map((habit) => (
                <List.Item
                  key={habit.id}
                  title={habit.name}
                  subtitle={habitStatusLabel(habit.status)}
                  icon={statusIcon(habit.status)}
                  actions={
                    <ActionPanel>
                      <Action title="Refresh" icon={Icon.RotateClockwise} onAction={() => setRefreshCounter((value) => value + 1)} />
                      <Action.CopyToClipboard title="Copy Summary" content={summaryText} />
                      <Action title="Open Extension Preferences" icon={Icon.Gear} onAction={openExtensionPreferences} />
                    </ActionPanel>
                  }
                  accessories={[{ text: `${habit.currentStreak?.length ?? 0}d`, icon: streakIcon() }]}
                />
              ))
            )}
          </List.Section>

          <List.Section title="By Time of Day">
            {byTimeOfDay.map((period) => (
              <List.Item
                key={period.id}
                title={period.name}
                actions={
                  <ActionPanel>
                    <Action title="Refresh" icon={Icon.RotateClockwise} onAction={() => setRefreshCounter((value) => value + 1)} />
                    <Action.CopyToClipboard title="Copy Summary" content={summaryText} />
                    <Action title="Open Extension Preferences" icon={Icon.Gear} onAction={openExtensionPreferences} />
                  </ActionPanel>
                }
                accessories={[
                  { text: `${period.completed}/${period.count} completed`, icon: { source: Icon.CheckCircle, tintColor: "#20B26B" } },
                ]}
              />
            ))}
          </List.Section>

          <List.Section title="By Area">
            {byArea.map((area) => (
              <List.Item
                key={area.id}
                title={area.name}
                actions={
                  <ActionPanel>
                    <Action title="Refresh" icon={Icon.RotateClockwise} onAction={() => setRefreshCounter((value) => value + 1)} />
                    <Action.CopyToClipboard title="Copy Summary" content={summaryText} />
                    <Action title="Open Extension Preferences" icon={Icon.Gear} onAction={openExtensionPreferences} />
                  </ActionPanel>
                }
                accessories={[{ text: `${area.completed}/${area.count} completed`, icon: { source: Icon.CheckCircle, tintColor: "#20B26B" } }]}
              />
            ))}
          </List.Section>
        </>
      )}
    </List>
  );
}
