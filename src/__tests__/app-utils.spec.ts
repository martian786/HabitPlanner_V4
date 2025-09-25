import { describe, it, expect, vi } from 'vitest';

// ⛳️ Prevent side-effects from App.tsx imports (Supabase, etc.)
vi.mock('../lib/supabase', () => ({ supabase: {} }));
vi.mock('../hooks/useDataService', () => ({ useDataService: vi.fn() }));
vi.mock('../hooks/useEntitlements', () => ({ useEntitlements: vi.fn() }));
vi.mock('../hooks/useSubscription', () => ({ useSubscription: vi.fn() }));
vi.mock('../components/Paywall', () => ({ default: () => null }));
vi.mock('../components/MFAChallenge', () => ({ default: () => null }));
vi.mock('../components/AccountSettings', () => ({ default: () => null }));
vi.mock('../components/SwatchPicker', () => ({ SWATCH_PALETTE: ['#f00','#0f0','#00f','#ff0'] }));
vi.mock('../assets/habitblock-logo.png', () => ({}));

// 👉 Now import the helpers from App.tsx
import {
  getWeekStart,
  formatTimeLabel,
  timeStrToMinutes,
  minutesToTimeStr,
  nextPaletteColor,
  computeWeeklyStats,
  buildCopyWeekPatch,
  countWeekBlocks,
} from '../App';

describe('date/time helpers', () => {
  it('getWeekStart respects Monday start', () => {
    const d = new Date('2025-03-02'); // Sunday
    const start = getWeekStart(d, 'Monday');
    expect(start.toISOString().slice(0,10)).toBe('2025-02-24');
  });

  it('getWeekStart respects Sunday start', () => {
    const d = new Date('2025-03-02'); // Sunday
    const start = getWeekStart(d, 'Sunday');
    expect(start.toISOString().slice(0,10)).toBe('2025-03-02');
  });

  it('format/time conversions roundtrip', () => {
    expect(timeStrToMinutes('13:45')).toBe(825);
    expect(minutesToTimeStr(825)).toBe('13:45');
    expect(formatTimeLabel(0)).toEqual({ time: '12:00', period: 'AM' });
    expect(formatTimeLabel(12*60)).toEqual({ time: '12:00', period: 'PM' });
  });
});

describe('palette & stats', () => {
  it('nextPaletteColor picks unused then least-used', () => {
    const palette = ['#a','#b','#c'];
    // we mocked SWATCH_PALETTE above; pass our own list via param if you modify function later
    const used = ['#a', '#a', '#b']; // #c is unused
    expect(nextPaletteColor(used, palette)).toBe('#c');
  });

  it('computeWeeklyStats calculates slots, completed, hours, percent', () => {
    const objectives = [{ id:'o1', name:'Deep Work', color:'#111' }];
    const days = ['2025-03-03','2025-03-04'];
    const schedule = {
      '2025-03-03': { 0:{id:'o1',completed:true}, 1:{id:'o1',completed:false} },
      '2025-03-04': { 0:{id:'o1',completed:true} }
    };
    const stats = computeWeeklyStats(objectives, days, schedule, 30);
    expect(stats[0]).toMatchObject({ slots:3, completedSlots:2, hours:1.5 });
    expect(Number(stats[0].percent.toFixed(2))).toBeCloseTo(66.67, 2);
  });
});

describe('week copy helpers', () => {
  it('buildCopyWeekPatch copies ids and resets ticks when carryTicks=false', () => {
    const srcDays = ['2025-03-03','2025-03-04','2025-03-05','2025-03-06','2025-03-07','2025-03-08','2025-03-09'];
    const destDays = ['2025-03-10','2025-03-11','2025-03-12','2025-03-13','2025-03-14','2025-03-15','2025-03-16'];
    const schedule = {
      '2025-03-03': { 0:{id:'o1',completed:true}, 1:{id:'o2',completed:false} },
      '2025-03-04': { 0:{id:'o1',completed:true} },
    };
    const { overwrite, count } = buildCopyWeekPatch(schedule, srcDays, destDays, /*carryTicks*/false);
    expect(count).toBe(3);
    expect(overwrite['2025-03-10'][0]).toEqual({ id:'o1', completed:false });
    expect(overwrite['2025-03-10'][1]).toEqual({ id:'o2', completed:false });
  });

  it('countWeekBlocks counts blocks over given days', () => {
    const schedule = {
      '2025-03-03': { 0:{id:'o1',completed:true}, 1:{id:'o2',completed:false} },
      '2025-03-04': { 0:{id:'o1',completed:true} },
    };
    const days = ['2025-03-03','2025-03-04','2025-03-05'];
    expect(countWeekBlocks(schedule, days)).toBe(3);
  });
});

describe('edge cases', () => {
  it('handles invalid time strings (returns NaN for invalid input)', () => {
    expect(timeStrToMinutes('')).toBeNaN();
    expect(timeStrToMinutes('invalid')).toBeNaN();
    expect(timeStrToMinutes('25:99')).toBe(25 * 60 + 99); // 1599 - function doesn't validate ranges
  });

  it('handles boundary time values', () => {
    expect(formatTimeLabel(0)).toEqual({ time: '12:00', period: 'AM' });
    expect(formatTimeLabel(1439)).toEqual({ time: '11:59', period: 'PM' }); // 23:59
    // Note: formatTimeLabel doesn't handle negative values gracefully
    expect(formatTimeLabel(1440)).toEqual({ time: '12:00', period: 'PM' }); // 1440min = 24h -> 12:00 PM
  });

  it('handles empty schedules and objectives', () => {
    expect(computeWeeklyStats([], [], {}, 30)).toEqual([]);
    expect(countWeekBlocks({}, ['2025-01-01'])).toBe(0);
  });

  it('nextPaletteColor handles malformed color data', () => {
    const existingColors = ['', '   ', '#invalid'];
    expect(() => nextPaletteColor(existingColors)).not.toThrow();
  });

  it('buildCopyWeekPatch validates day arrays', () => {
    expect(() => {
      buildCopyWeekPatch({}, ['invalid-date'], ['2025-01-01'], false);
    }).not.toThrow();
  });
});

describe('parameterized week start tests', () => {
  const testCases = [
    ['Monday', new Date('2025-01-06'), '2025-01-06'], // Monday -> Monday
    ['Monday', new Date('2025-01-07'), '2025-01-06'], // Tuesday -> Monday
    ['Monday', new Date('2025-01-08'), '2025-01-06'], // Wednesday -> Monday
    ['Sunday', new Date('2025-01-06'), '2025-01-05'], // Monday -> Sunday
    ['Sunday', new Date('2025-01-05'), '2025-01-05'], // Sunday -> Sunday
    ['Sunday', new Date('2025-01-11'), '2025-01-05'], // Saturday -> Sunday
  ] as const;

  testCases.forEach(([weekStart, inputDate, expectedStart]) => {
    it(`${weekStart} start: ${inputDate.toDateString()} -> ${expectedStart}`, () => {
      const result = getWeekStart(inputDate, weekStart);
      expect(result.toISOString().slice(0, 10)).toBe(expectedStart);
    });
  });
});

describe('workflow integration', () => {
  it('complete week planning workflow', () => {
    const objectives = [
      { id: 'work', name: 'Deep Work', color: '#ff0000' },
      { id: 'exercise', name: 'Exercise', color: '#00ff00' }
    ];

    // Plan a week
    const schedule = {
      '2025-01-06': { 0: {id: 'work', completed: false}, 1: {id: 'exercise', completed: true} },
      '2025-01-07': { 0: {id: 'work', completed: true} }
    };

    // Compute stats
    const days = ['2025-01-06', '2025-01-07'];
    const stats = computeWeeklyStats(objectives, days, schedule, 30);

    // Copy to next week
    const nextWeekDays = ['2025-01-13', '2025-01-14'];
    const { overwrite, count } = buildCopyWeekPatch(schedule, days, nextWeekDays, false);

    expect(stats[0].slots).toBe(2); // work appears twice
    expect(stats[1].slots).toBe(1); // exercise appears once
    expect(count).toBe(3); // total blocks copied
    expect(overwrite['2025-01-13'][1]?.completed).toBe(false); // ticks reset
  });

  it('handles carryTicks=true vs carryTicks=false', () => {
    const schedule = {
      '2025-01-01': { 0: {id: 'task', completed: true} }
    };
    const srcDays = ['2025-01-01'];
    const destDays = ['2025-01-08'];

    // With carryTicks=false (default behavior)
    const { overwrite: resetTicks } = buildCopyWeekPatch(schedule, srcDays, destDays, false);
    expect(resetTicks['2025-01-08'][0]?.completed).toBe(false);

    // With carryTicks=true
    const { overwrite: keepTicks } = buildCopyWeekPatch(schedule, srcDays, destDays, true);
    expect(keepTicks['2025-01-08'][0]?.completed).toBe(true);
  });
});

describe('performance tests', () => {
  it('handles large schedules efficiently', () => {
    const largeSchedule = {};
    const days = [];

    // Generate 30 days with 48 slots each (30min slots)
    for (let day = 1; day <= 30; day++) {
      const date = `2025-01-${String(day).padStart(2, '0')}`;
      days.push(date);
      largeSchedule[date] = {} as Record<string, unknown>;
      for (let slot = 0; slot < 48; slot++) {
        largeSchedule[date][slot] = { id: 'work', completed: Math.random() > 0.5 };
      }
    }

    const start = performance.now();
    const count = countWeekBlocks(largeSchedule, days);
    const duration = performance.now() - start;

    expect(count).toBe(30 * 48); // 1440 total blocks
    expect(duration).toBeLessThan(100); // Should complete in <100ms
  });

  it('computeWeeklyStats handles many objectives efficiently', () => {
    const objectives = Array.from({ length: 50 }, (_, i) => ({
      id: `obj${i}`,
      name: `Objective ${i}`,
      color: `#${i.toString(16).padStart(6, '0')}`
    }));

    const schedule = {};
    const days = [];
    for (let day = 1; day <= 7; day++) {
      const date = `2025-01-${String(day).padStart(2, '0')}`;
      days.push(date);
      schedule[date] = {} as Record<string, unknown>;
      for (let slot = 0; slot < 20; slot++) {
        const objIndex = slot % objectives.length;
        schedule[date][slot] = {
          id: objectives[objIndex].id,
          completed: Math.random() > 0.5
        };
      }
    }

    const start = performance.now();
    const stats = computeWeeklyStats(objectives, days, schedule, 30);
    const duration = performance.now() - start;

    expect(stats).toHaveLength(50);
    expect(duration).toBeLessThan(50); // Should complete quickly
  });
});

describe('data validation', () => {
  it('time functions handle extreme values', () => {
    expect(timeStrToMinutes('00:00')).toBe(0);
    expect(timeStrToMinutes('23:59')).toBe(1439);
    expect(minutesToTimeStr(0)).toBe('00:00');
    expect(minutesToTimeStr(1439)).toBe('23:59');
  });

  it('formatTimeLabel handles day boundaries', () => {
    expect(formatTimeLabel(0)).toEqual({ time: '12:00', period: 'AM' }); // midnight
    expect(formatTimeLabel(720)).toEqual({ time: '12:00', period: 'PM' }); // noon
    expect(formatTimeLabel(1439)).toEqual({ time: '11:59', period: 'PM' }); // 23:59
  });

  it('computeWeeklyStats handles missing schedule data', () => {
    const objectives = [{ id: 'test', name: 'Test', color: '#123' }];
    const days = ['2025-01-01', '2025-01-02'];
    const schedule = {
      '2025-01-01': { 0: { id: 'test', completed: true } }
      // Note: 2025-01-02 is missing
    };

    const stats = computeWeeklyStats(objectives, days, schedule, 30);
    expect(stats[0].slots).toBe(1); // Only counts existing slots
  });

  it('nextPaletteColor with empty palette returns undefined', () => {
    const result = nextPaletteColor(['#existing'], []);
    expect(result).toBeUndefined();
  });
});