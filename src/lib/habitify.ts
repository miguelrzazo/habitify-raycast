export type HabitStatus = "completed" | "skipped" | "failed" | "inprogress";
export type HabitType = "good" | "bad";

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

type HabitifyResponse<T> = {
  data: T;
  pagination?: {
    total: number;
    limit: number;
    offset: number;
  };
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

export async function getTodayJournal(apiKey: string, date: string) {
  return requestJson<HabitifyResponse<JournalEntry[]>>(apiKey, "/habits/journal", {}, { date });
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
