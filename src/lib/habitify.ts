export type HabitStatus = "completed" | "skipped" | "failed" | "inprogress";
export type HabitType = "good" | "bad";

export type TimeOfDay = {
  id: string;
  name: string;
  icon: string | null;
  startTime: string;
  endTime: string;
  colorHex: string | null;
};

export type JournalEntry = {
  id: string;
  name: string;
  status: HabitStatus;
  colorHex: string;
  icon: string | null;
  timeOfDayIds: string[];
  type: HabitType;
  currentStreak?: {
    length: number;
    unit: "day";
  };
  progress?: {
    current: number;
    target: number;
    unit?: string;
    periodicity: "daily" | "weekly" | "monthly" | "yearly";
  };
  logInfo?: {
    type: "manual" | "auto";
  };
};

export type Habit = {
  id: string;
  name: string;
  icon: string | null;
  colorHex: string;
  type: HabitType;
  description: string | null;
  startDate: string;
  createdAt: string;
  isArchived: boolean;
  logMethod: "manual" | "auto";
  customUnitName: string | null;
  timeOfDays: TimeOfDay[];
  goals: Array<{
    id: string;
    createdAt: string;
    periodicity: "daily" | "weekly" | "monthly" | "yearly";
    value: number;
    unit: string;
    isActive: boolean;
  }>;
};

export type HabitStatistics = {
  id: string;
  name: string;
  type: string;
  totalLogs: number;
  skips: number;
  fails: number;
  completions: number;
  unit?: {
    id: string;
    name: string;
    symbol: string;
  };
  periodicity: string;
  avg: number;
  dailyProgress?: Array<{
    date: string;
    totalLog: number;
    status: HabitStatus;
  }>;
};

export type Area = {
  id: string;
  name: string;
  colorHex: string | null;
  icon: string | null;
  createdAt: string;
};

export type TodayHabit = JournalEntry & {
  timeOfDays: TimeOfDay[];
  currentTimeOfDay: TimeOfDay | null;
};

export type TodayHabitGroup = {
  id: string;
  title: string;
  subtitle?: string;
  entries: TodayHabit[];
};

type HabitifyResponse<T> = {
  data: T;
  pagination?: {
    total: number;
    limit: number;
    offset: number;
  };
};

type HabitQuery = {
  archived?: boolean;
  areaId?: string;
  type?: HabitType;
  timeOfDay?: string;
  limit?: number;
  offset?: number;
};

class HabitifyError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "HabitifyError";
    this.status = status;
  }
}

function buildUrl(path: string, query?: Record<string, string | undefined>) {
  const url = new URL(`https://api.habitify.me/v2${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== "") {
        url.searchParams.set(key, value);
      }
    }
  }
  return url;
}

async function requestJson<T>(
  apiKey: string,
  path: string,
  options: RequestInit = {},
  query?: Record<string, string | undefined>,
): Promise<T> {
  const url = buildUrl(path, query);
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
      ...(options.headers ?? {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    let message = text || response.statusText;
    try {
      const parsed = JSON.parse(text) as { message?: string; error?: string };
      message = parsed.message ?? parsed.error ?? message;
    } catch {
      // Keep raw text.
    }
    throw new HabitifyError(message, response.status);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

function toQuery(query: HabitQuery) {
  return {
    archived: query.archived === undefined ? undefined : String(query.archived),
    areaId: query.areaId,
    type: query.type,
    timeOfDay: query.timeOfDay,
    limit: query.limit === undefined ? undefined : String(query.limit),
    offset: query.offset === undefined ? undefined : String(query.offset),
  };
}

export async function getTodayJournal(apiKey: string, date: string) {
  return requestJson<HabitifyResponse<JournalEntry[]>>(apiKey, "/habits/journal", {}, { date });
}

export async function getHabits(apiKey: string, query: HabitQuery = {}) {
  const pageSize = Math.min(query.limit ?? 100, 100);
  let offset = query.offset ?? 0;
  const items: Habit[] = [];
  let total = Number.POSITIVE_INFINITY;

  while (offset < total) {
    const response = await requestJson<HabitifyResponse<Habit[]>>(
      apiKey,
      "/habits",
      {},
      toQuery({ ...query, limit: pageSize, offset }),
    );

    items.push(...response.data);
    total = response.pagination?.total ?? items.length;

    if (response.data.length === 0) {
      break;
    }

    const increment = response.pagination?.limit ?? pageSize;
    offset += increment;

    if (!response.pagination || offset >= total) {
      break;
    }
  }

  return items;
}

export async function completeHabit(apiKey: string, habitId: string, targetDate: string) {
  await requestJson(apiKey, `/habits/${habitId}/logs/complete`, {
    method: "POST",
    body: JSON.stringify({ targetDate }),
  });
}

export async function undoHabit(apiKey: string, habitId: string, targetDate: string) {
  await requestJson(apiKey, `/habits/${habitId}/logs/undo`, {
    method: "POST",
    body: JSON.stringify({ targetDate }),
  });
}

export async function getHabit(apiKey: string, habitId: string) {
  return requestJson<HabitifyResponse<Habit>>(apiKey, `/habits/${habitId}`);
}

export async function getHabitStatistics(apiKey: string, habitId: string) {
  return requestJson<HabitifyResponse<HabitStatistics>>(apiKey, `/habits/${habitId}/statistics`);
}

export async function getAreas(apiKey: string) {
  return requestJson<HabitifyResponse<Area[]>>(apiKey, "/areas");
}

export function isHabitifyError(error: unknown): error is HabitifyError {
  return error instanceof HabitifyError;
}

export function habitStatusLabel(status: HabitStatus) {
  switch (status) {
    case "completed":
      return "Completed";
    case "skipped":
      return "Skipped";
    case "failed":
      return "Failed";
    default:
      return "In progress";
  }
}

export function habitProgressLabel(entry: JournalEntry) {
  if (!entry.progress) {
    return habitStatusLabel(entry.status);
  }

  const { current, target, unit } = entry.progress;
  const roundedCurrent = Number.isInteger(current) ? current : Number(current.toFixed(1));
  const roundedTarget = Number.isInteger(target) ? target : Number(target.toFixed(1));
  return `${roundedCurrent}/${roundedTarget}${unit ? ` ${unit}` : ""}`;
}

function parseClockToMinutes(value: string) {
  const [hours = 0, minutes = 0, seconds = 0] = value.split(":").map((part) => Number(part));
  return hours * 60 + minutes + seconds / 60;
}

function formatClock(value: string) {
  const [hours = "00", minutes = "00"] = value.split(":");
  return `${hours.padStart(2, "0")}:${minutes.padStart(2, "0")}`;
}

function periodStartMinutes(period: TimeOfDay) {
  return parseClockToMinutes(period.startTime);
}

function periodMatchesNow(period: TimeOfDay, now: Date) {
  const currentMinutes = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  const start = parseClockToMinutes(period.startTime);
  const end = parseClockToMinutes(period.endTime);

  if (start === end) {
    return true;
  }

  if (start < end) {
    return currentMinutes >= start && currentMinutes < end;
  }

  return currentMinutes >= start || currentMinutes < end;
}

export function sortTimeOfDays(periods: TimeOfDay[]) {
  return [...periods].sort((left, right) => {
    const timeDelta = periodStartMinutes(left) - periodStartMinutes(right);
    if (timeDelta !== 0) {
      return timeDelta;
    }
    return left.name.localeCompare(right.name);
  });
}

export function getCurrentTimeOfDay(periods: TimeOfDay[], now = new Date()) {
  return sortTimeOfDays(periods).find((period) => periodMatchesNow(period, now)) ?? null;
}

export function formatTimeOfDayRange(period: TimeOfDay) {
  return `${formatClock(period.startTime)}–${formatClock(period.endTime)}`;
}

export function mergeJournalWithHabits(journal: JournalEntry[], habits: Habit[], now = new Date()) {
  const habitMap = new Map(habits.map((habit) => [habit.id, habit]));
  const allTimeOfDays = Array.from(new Map(habits.flatMap((habit) => habit.timeOfDays.map((period) => [period.id, period]))).values());
  const currentTimeOfDay = getCurrentTimeOfDay(allTimeOfDays, now);

  return journal.map((entry) => {
    const timeOfDays = sortTimeOfDays(habitMap.get(entry.id)?.timeOfDays ?? []);
    const entryCurrentTimeOfDay = currentTimeOfDay && timeOfDays.some((period) => period.id === currentTimeOfDay.id)
      ? currentTimeOfDay
      : null;

    return {
      ...entry,
      timeOfDays,
      currentTimeOfDay: entryCurrentTimeOfDay,
    } satisfies TodayHabit;
  });
}

export function groupTodayHabits(habits: TodayHabit[]) {
  const currentPeriod = getCurrentTimeOfDay(
    Array.from(new Map(habits.flatMap((habit) => habit.timeOfDays.map((period) => [period.id, period]))).values()),
  );

  type Accumulator = {
    period: TimeOfDay | null;
    entries: TodayHabit[];
  };

  const groups = new Map<string, Accumulator>();

  for (const habit of habits) {
    const period = habit.timeOfDays.find((item) => item.id === currentPeriod?.id) ?? habit.timeOfDays[0] ?? null;
    const key = period?.id ?? "anytime";
    const existing = groups.get(key) ?? { period, entries: [] };
    existing.entries.push(habit);
    groups.set(key, existing);
  }

  const statusOrder: Record<HabitStatus, number> = {
    inprogress: 0,
    failed: 1,
    skipped: 2,
    completed: 3,
  };

  return Array.from(groups.entries())
    .map(([id, group]) => {
      const sortedEntries = [...group.entries].sort((left, right) => {
        const statusDelta = statusOrder[left.status] - statusOrder[right.status];
        if (statusDelta !== 0) {
          return statusDelta;
        }
        return left.name.localeCompare(right.name);
      });

      return {
        id,
        title: group.period?.name ?? "Any time",
        subtitle: group.period ? formatTimeOfDayRange(group.period) : undefined,
        isCurrent: group.period?.id === currentPeriod?.id,
        sortKey: group.period ? periodStartMinutes(group.period) : Number.POSITIVE_INFINITY,
        entries: sortedEntries,
      } satisfies TodayHabitGroup & { isCurrent: boolean; sortKey: number };
    })
    .sort((left, right) => {
      if (left.isCurrent !== right.isCurrent) {
        return left.isCurrent ? -1 : 1;
      }

      if (left.sortKey !== right.sortKey) {
        return left.sortKey - right.sortKey;
      }

      return left.title.localeCompare(right.title);
    });
}
