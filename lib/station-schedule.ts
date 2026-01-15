export type ScheduleDay = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface StationScheduleRule {
  id: string;
  name: string;
  days: ScheduleDay[];
  startTime: string;
  endTime: string;
  stationIds: string[];
}

export interface StationScheduleState {
  enabled: boolean;
  rules: StationScheduleRule[];
}

export const STATION_SCHEDULE_STORAGE_KEY = 'stationSchedule';
export const STATION_SCHEDULE_EVENT = 'stationScheduleChange';

const EMPTY_STATE: StationScheduleState = { enabled: false, rules: [] };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const parseTimeToMinutes = (value: string): number | null => {
  const parts = value.split(':');
  if (parts.length !== 2) return null;
  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (hours < 0 || hours > 23) return null;
  if (minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
};

const sanitizeDays = (days: unknown): ScheduleDay[] => {
  if (!Array.isArray(days)) return [];
  const unique = new Set<ScheduleDay>();
  days.forEach((day) => {
    if (Number.isInteger(day) && day >= 0 && day <= 6) {
      unique.add(day as ScheduleDay);
    }
  });
  return Array.from(unique).sort((a, b) => a - b);
};

const sanitizeStationIds = (stationIds: unknown): string[] => {
  if (!Array.isArray(stationIds)) return [];
  const unique = new Set<string>();
  stationIds.forEach((id) => {
    if (typeof id === 'string' && id.trim()) {
      unique.add(id);
    }
  });
  return Array.from(unique);
};

const normalizeRule = (rule: StationScheduleRule): StationScheduleRule => ({
  id: rule.id,
  name: rule.name,
  days: sanitizeDays(rule.days),
  startTime: rule.startTime,
  endTime: rule.endTime,
  stationIds: sanitizeStationIds(rule.stationIds),
});

const isValidRule = (value: unknown): value is StationScheduleRule => {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string') return false;
  if (typeof value.name !== 'string') return false;
  if (typeof value.startTime !== 'string') return false;
  if (typeof value.endTime !== 'string') return false;
  if (!Array.isArray(value.days)) return false;
  if (!Array.isArray(value.stationIds)) return false;
  return true;
};

export const loadStationSchedule = (): StationScheduleState => {
  if (typeof window === 'undefined') return EMPTY_STATE;
  try {
    const saved = localStorage.getItem(STATION_SCHEDULE_STORAGE_KEY);
    if (!saved) return EMPTY_STATE;
    const parsed = JSON.parse(saved);
    if (!isRecord(parsed)) return EMPTY_STATE;
    const enabled = Boolean(parsed.enabled);
    const rules = Array.isArray(parsed.rules)
      ? parsed.rules
          .filter(isValidRule)
          .map((rule) => normalizeRule(rule as StationScheduleRule))
      : [];
    return { enabled, rules };
  } catch (err) {
    console.error('Error loading station schedule:', err);
    return EMPTY_STATE;
  }
};

export const saveStationSchedule = (state: StationScheduleState): void => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STATION_SCHEDULE_STORAGE_KEY, JSON.stringify(state));
    window.dispatchEvent(new CustomEvent(STATION_SCHEDULE_EVENT));
  } catch (err) {
    console.error('Error saving station schedule:', err);
  }
};

export const isScheduleRuleActive = (rule: StationScheduleRule, date: Date): boolean => {
  if (!rule.stationIds.length || !rule.days.length) return false;
  const startMinutes = parseTimeToMinutes(rule.startTime);
  const endMinutes = parseTimeToMinutes(rule.endTime);
  if (startMinutes === null || endMinutes === null) return false;

  const currentMinutes = date.getHours() * 60 + date.getMinutes();
  const today = date.getDay() as ScheduleDay;
  const yesterday = ((today + 6) % 7) as ScheduleDay;

  if (startMinutes === endMinutes) {
    return rule.days.includes(today);
  }

  if (startMinutes < endMinutes) {
    return rule.days.includes(today) && currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }

  const isLateWindow = rule.days.includes(today) && currentMinutes >= startMinutes;
  const isEarlyWindow = rule.days.includes(yesterday) && currentMinutes < endMinutes;
  return isLateWindow || isEarlyWindow;
};

export const getActiveScheduleRule = (
  state: StationScheduleState,
  date: Date = new Date()
): StationScheduleRule | null => {
  if (!state.enabled) return null;
  for (const rule of state.rules) {
    if (isScheduleRuleActive(rule, date)) {
      return rule;
    }
  }
  return null;
};
