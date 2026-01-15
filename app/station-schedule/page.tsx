'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Plus, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { StationSelector } from '@/components/station-selector';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { getStation } from '@/lib/subway-data';
import {
  type StationScheduleRule,
  type StationScheduleState,
  getActiveScheduleRule,
  loadStationSchedule,
  saveStationSchedule,
} from '@/lib/station-schedule';

interface StationConfig {
  stationId: string;
  direction: 'all' | 'N' | 'S';
  selectedRoutes?: string[];
}

const STORAGE_KEY = 'selectedStations';

const DAY_OPTIONS = [
  { label: 'Sun', value: 0 },
  { label: 'Mon', value: 1 },
  { label: 'Tue', value: 2 },
  { label: 'Wed', value: 3 },
  { label: 'Thu', value: 4 },
  { label: 'Fri', value: 5 },
  { label: 'Sat', value: 6 },
] as const;

const createRuleId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `rule_${Date.now()}_${Math.random().toString(16).slice(2)}`;
};

const createNewRule = (): StationScheduleRule => ({
  id: createRuleId(),
  name: '',
  days: [1, 2, 3, 4, 5],
  startTime: '06:00',
  endTime: '09:00',
  stationIds: [],
});

const loadStationConfigs = (): StationConfig[] => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return [];
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => typeof item?.stationId === 'string');
  } catch (err) {
    console.error('Error loading default stations:', err);
    return [];
  }
};

export default function StationSchedulePage() {
  const [scheduleState, setScheduleState] = useState<StationScheduleState>({
    enabled: false,
    rules: [],
  });
  const [defaultStationConfigs, setDefaultStationConfigs] = useState<StationConfig[]>([]);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    setScheduleState(loadStationSchedule());
    setDefaultStationConfigs(loadStationConfigs());
    setHasLoaded(true);
  }, []);

  useEffect(() => {
    if (!hasLoaded) return;
    saveStationSchedule(scheduleState);
  }, [hasLoaded, scheduleState]);

  useEffect(() => {
    if (!hasLoaded) return;
    try {
      if (defaultStationConfigs.length > 0) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(defaultStationConfigs));
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch (err) {
      console.error('Error saving default stations:', err);
    }
  }, [defaultStationConfigs, hasLoaded]);

  useEffect(() => {
    const interval = setInterval(() => {
      setNow(new Date());
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  const activeRule = useMemo(() => getActiveScheduleRule(scheduleState, now), [scheduleState, now]);

  const formatDays = (days: number[]): string => {
    const sorted = [...days].sort((a, b) => a - b);
    const everyDay = DAY_OPTIONS.every((day) => sorted.includes(day.value));
    if (everyDay) return 'Every day';
    const weekdays = [1, 2, 3, 4, 5];
    const isWeekdays = weekdays.every((day) => sorted.includes(day)) && sorted.length === 5;
    if (isWeekdays) return 'Weekdays';
    const isWeekend = sorted.length === 2 && sorted.includes(0) && sorted.includes(6);
    if (isWeekend) return 'Weekends';
    return sorted
      .map((day) => DAY_OPTIONS.find((option) => option.value === day)?.label)
      .filter(Boolean)
      .join(', ');
  };

  const formatTimeRange = (rule: StationScheduleRule) => `${rule.startTime} - ${rule.endTime}`;

  const updateRule = (ruleId: string, updates: Partial<StationScheduleRule>) => {
    setScheduleState((prev) => ({
      ...prev,
      rules: prev.rules.map((rule) => (rule.id === ruleId ? { ...rule, ...updates } : rule)),
    }));
  };

  const toggleRuleDay = (ruleId: string, day: number) => {
    setScheduleState((prev) => ({
      ...prev,
      rules: prev.rules.map((rule) => {
        if (rule.id !== ruleId) return rule;
        const nextDays = rule.days.includes(day as number)
          ? rule.days.filter((value) => value !== day)
          : [...rule.days, day as number];
        return { ...rule, days: nextDays };
      }),
    }));
  };

  const moveRule = (ruleId: string, direction: 'up' | 'down') => {
    setScheduleState((prev) => {
      const index = prev.rules.findIndex((rule) => rule.id === ruleId);
      if (index === -1) return prev;
      const nextIndex = direction === 'up' ? index - 1 : index + 1;
      if (nextIndex < 0 || nextIndex >= prev.rules.length) return prev;
      const nextRules = [...prev.rules];
      const [removed] = nextRules.splice(index, 1);
      nextRules.splice(nextIndex, 0, removed);
      return { ...prev, rules: nextRules };
    });
  };

  const addRule = () => {
    setScheduleState((prev) => ({
      ...prev,
      rules: [...prev.rules, createNewRule()],
    }));
  };

  const removeRule = (ruleId: string) => {
    setScheduleState((prev) => ({
      ...prev,
      rules: prev.rules.filter((rule) => rule.id !== ruleId),
    }));
  };

  const handleDefaultStationsChange = (stationIds: string[]) => {
    setDefaultStationConfigs((prev) =>
      stationIds.map((id) => {
        const existing = prev.find((config) => config.stationId === id);
        return existing || { stationId: id, direction: 'all', selectedRoutes: [] };
      })
    );
  };

  const defaultStationIds = useMemo(
    () => defaultStationConfigs.map((config) => config.stationId),
    [defaultStationConfigs]
  );

  const activeStationNames = useMemo(() => {
    if (!activeRule) return [];
    return activeRule.stationIds.map((id) => getStation(id)?.name || id);
  }, [activeRule]);

  return (
    <main className="min-h-screen bg-background py-8">
      <div className="container mx-auto p-4 max-w-4xl space-y-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold">Time-based stations</h1>
            <p className="text-sm text-muted-foreground">
              Set schedule rules to override stations shown on the home screen.
            </p>
          </div>
          <Link href="/" className="text-sm font-medium text-primary hover:underline">
            Back to home
          </Link>
        </div>

        <Card>
          <CardContent className="space-y-4 pt-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold">Enable schedule</div>
                <div className="text-sm text-muted-foreground">
                  When enabled, the first matching rule is used.
                </div>
              </div>
              <Switch
                checked={scheduleState.enabled}
                onCheckedChange={(checked) =>
                  setScheduleState((prev) => ({ ...prev, enabled: checked }))
                }
              />
            </div>
          </CardContent>
        </Card>

        {activeRule ? (
          <Alert>
            <AlertTitle>Schedule active now</AlertTitle>
            <AlertDescription>
              {activeRule.name?.trim() ? `${activeRule.name}: ` : ''}
              {formatDays(activeRule.days)} · {formatTimeRange(activeRule)} ·{' '}
              {activeStationNames.join(', ')}
            </AlertDescription>
          </Alert>
        ) : (
          <Alert>
            <AlertTitle>No active rule</AlertTitle>
            <AlertDescription>
              The home screen is using your default stations right now.
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-4">
          {scheduleState.rules.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No schedule rules yet. Add one to get started.
            </div>
          ) : null}

          {scheduleState.rules.map((rule, index) => (
            <Card key={rule.id}>
              <CardContent className="space-y-4 pt-6">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex flex-col gap-1 flex-1 min-w-[220px]">
                    <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Rule name
                    </label>
                    <input
                      type="text"
                      value={rule.name}
                      onChange={(e) => updateRule(rule.id, { name: e.target.value })}
                      placeholder="Weekday mornings"
                      className="w-full px-3 py-2 border rounded-lg bg-background"
                    />
                  </div>
                  <div className="flex items-center gap-2 ml-auto">
                    <button
                      type="button"
                      onClick={() => moveRule(rule.id, 'up')}
                      disabled={index === 0}
                      className="h-9 w-9 rounded-full border flex items-center justify-center disabled:opacity-50"
                      aria-label="Move rule up"
                    >
                      <ChevronUp className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveRule(rule.id, 'down')}
                      disabled={index === scheduleState.rules.length - 1}
                      className="h-9 w-9 rounded-full border flex items-center justify-center disabled:opacity-50"
                      aria-label="Move rule down"
                    >
                      <ChevronDown className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeRule(rule.id)}
                      className="h-9 w-9 rounded-full border border-destructive text-destructive flex items-center justify-center"
                      aria-label="Remove rule"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Days
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {DAY_OPTIONS.map((day) => {
                      const isActive = rule.days.includes(day.value);
                      return (
                        <button
                          key={day.value}
                          type="button"
                          onClick={() => toggleRuleDay(rule.id, day.value)}
                          className={cn(
                            'px-3 py-1 rounded-full border text-sm transition-colors',
                            isActive
                              ? 'bg-primary text-primary-foreground border-primary'
                              : 'bg-background text-foreground hover:bg-muted'
                          )}
                        >
                          {day.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Start time
                    </label>
                    <input
                      type="time"
                      value={rule.startTime}
                      onChange={(e) => updateRule(rule.id, { startTime: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg bg-background"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      End time
                    </label>
                    <input
                      type="time"
                      value={rule.endTime}
                      onChange={(e) => updateRule(rule.id, { endTime: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg bg-background"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Stations for this time window
                  </div>
                  <StationSelector
                    selectedStations={rule.stationIds}
                    onStationsChange={(stationIds) =>
                      updateRule(rule.id, { stationIds })
                    }
                  />
                </div>
              </CardContent>
            </Card>
          ))}

          <button
            type="button"
            onClick={addRule}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border bg-background hover:bg-muted transition-colors"
          >
            <Plus className="h-4 w-4" />
            Add rule
          </button>
        </div>

        <Card>
          <CardContent className="space-y-3 pt-6">
            <div>
              <h2 className="text-lg font-semibold">Default stations</h2>
              <p className="text-sm text-muted-foreground">
                Used whenever no schedule rule matches the current time.
              </p>
            </div>
            <StationSelector
              selectedStations={defaultStationIds}
              onStationsChange={handleDefaultStationsChange}
            />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
