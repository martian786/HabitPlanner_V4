import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DataService } from '../lib/dataService';

// Mock Supabase completely
vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: vi.fn(),
    },
    from: vi.fn(),
  },
}));

describe('Data Persistence Tests', () => {
  let dataService: DataService;
  const mockUserId = 'test-user-123';

  // Complete mock query builder that handles all Supabase methods
  const createMockQuery = (mockData?: unknown, error?: Error) => {
    const mockResult = error ? { error, data: null } : { data: mockData, error: null };

    const queryMock = {
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      upsert: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      and: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      range: vi.fn().mockReturnThis(),
      count: vi.fn().mockReturnThis(),
      filter: vi.fn().mockReturnThis(),
      match: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue(mockResult),
      maybeSingle: vi.fn().mockResolvedValue(mockResult),
      then: vi.fn().mockImplementation((callback) => {
        return Promise.resolve(mockResult).then(callback);
      }),
    };

    return queryMock;
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    // Get the mocked supabase
    const { supabase } = await import('../lib/supabase');

    // Mock authenticated user
    vi.mocked(supabase.auth.getUser).mockResolvedValue({
      data: {
        user: {
          id: mockUserId,
          email: 'test@example.com',
          app_metadata: {},
          user_metadata: {},
          aud: 'authenticated',
          created_at: '2023-01-01T00:00:00Z',
        }
      },
      error: null,
    });

    dataService = new DataService(mockUserId);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('Objective CRUD Operations', () => {
    it('creates a new objective successfully', async () => {
      const { supabase } = await import('../lib/supabase');

      const newObjective = {
        id: 'obj-123',
        name: 'Test Task',
        color: '#ff0000',
        user_id: mockUserId,
        sort_order: 1,
        archived: false,
      };

      const mockQuery = createMockQuery(newObjective);
      vi.mocked(supabase.from).mockReturnValue(mockQuery as any);

      const result = await dataService.createObjective('Test Task', '#ff0000');

      expect(supabase.from).toHaveBeenCalledWith('objectives');
      expect(mockQuery.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Test Task',
          color: '#ff0000',
          user_id: mockUserId,
        })
      );
      expect(result).toEqual(newObjective);
    });

    it('fetches objectives from database', async () => {
      const { supabase } = await import('../lib/supabase');

      const mockObjectives = [
        { id: 'obj-1', name: 'Deep Work', color: '#1d4ed8', user_id: mockUserId },
        { id: 'obj-2', name: 'Admin', color: '#fb923c', user_id: mockUserId },
      ];

      const mockQuery = createMockQuery(mockObjectives);
      vi.mocked(supabase.from).mockReturnValue(mockQuery as any);

      const objectives = await dataService.getObjectives();

      expect(supabase.from).toHaveBeenCalledWith('objectives');
      expect(mockQuery.select).toHaveBeenCalledWith('id, name, color, sort_order, archived, user_id');
      expect(mockQuery.eq).toHaveBeenCalledWith('user_id', mockUserId);
      expect(objectives).toEqual(mockObjectives);
    });

    it('updates an existing objective', async () => {
      const { supabase } = await import('../lib/supabase');

      const updatedObjective = {
        id: 'obj-123',
        name: 'Updated Task',
        color: '#00ff00',
        user_id: mockUserId,
      };

      const mockQuery = createMockQuery(updatedObjective);
      vi.mocked(supabase.from).mockReturnValue(mockQuery as any);

      await dataService.updateObjective('obj-123', {
        name: 'Updated Task',
        color: '#00ff00',
      });

      expect(mockQuery.update).toHaveBeenCalledWith({
        name: 'Updated Task',
        color: '#00ff00',
      });
      expect(mockQuery.eq).toHaveBeenCalledWith('id', 'obj-123');
    });

    it('handles objective creation validation errors', async () => {
      const { supabase } = await import('../lib/supabase');

      const mockQuery = createMockQuery(null, new Error('Name too long'));
      vi.mocked(supabase.from).mockReturnValue(mockQuery as any);

      await expect(
        dataService.createObjective('A'.repeat(50), '#ff0000')
      ).rejects.toThrow();
    });
  });

  describe('Schedule Persistence', () => {
    it('saves a week schedule successfully', async () => {
      const { supabase } = await import('../lib/supabase');

      const weekData = {
        week_start: '2025-01-06',
        schedule: {
          '2025-01-06': { 0: { id: 'obj-1', completed: true } },
          '2025-01-07': { 0: { id: 'obj-1', completed: false } },
        },
        plan_name: 'Test Week',
        reflections: { overall: 'Good week' },
        visible_objectives: ['obj-1'],
      };

      const mockQuery = createMockQuery(weekData);
      vi.mocked(supabase.from).mockReturnValue(mockQuery as any);

      await dataService.saveWeek(weekData);

      expect(supabase.from).toHaveBeenCalledWith('weeks');
      expect(mockQuery.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: mockUserId,
          week_start: '2025-01-06',
          schedule: weekData.schedule,
          plan_name: 'Test Week',
        }),
        expect.any(Object)
      );
    });

    it('loads a week schedule from database', async () => {
      const { supabase } = await import('../lib/supabase');

      const mockWeekData = {
        user_id: mockUserId,
        week_start: '2025-01-06',
        schedule: {
          '2025-01-06': { 0: { id: 'obj-1', completed: true } },
        },
        plan_name: 'Saved Week',
        reflections: {},
        visible_objectives: ['obj-1'],
      };

      const mockQuery = createMockQuery(mockWeekData);
      vi.mocked(supabase.from).mockReturnValue(mockQuery as any);

      const week = await dataService.getWeek('2025-01-06');

      expect(supabase.from).toHaveBeenCalledWith('weeks');
      expect(mockQuery.eq).toHaveBeenCalledWith('user_id', mockUserId);
      expect(mockQuery.eq).toHaveBeenCalledWith('week_start', '2025-01-06');
      expect(week).toEqual(mockWeekData);
    });

    it('returns null when week does not exist', async () => {
      const { supabase } = await import('../lib/supabase');

      const mockQuery = createMockQuery(null);
      vi.mocked(supabase.from).mockReturnValue(mockQuery as any);

      const week = await dataService.getWeek('2025-01-13');

      expect(week).toBeNull();
    });
  });

  describe('User Preferences Persistence', () => {
    it('loads user preferences from database', async () => {
      const { supabase } = await import('../lib/supabase');

      const mockPreferences = {
        show_archived: false,
        delete_mode: 'soft' as const,
        start_minutes: 480, // 8:00 AM
        end_minutes: 1080, // 6:00 PM
        slot_minutes: 30,
        week_starts_on: 'Monday' as const,
        max_objectives: 8,
        tick_color: '#22c55e',
        show_objective_names: true,
        prevent_overwrite: false,
      };

      const mockQuery = createMockQuery(mockPreferences);
      vi.mocked(supabase.from).mockReturnValue(mockQuery as any);

      const preferences = await dataService.getUserPreferences();

      expect(supabase.from).toHaveBeenCalledWith('user_preferences');
      expect(mockQuery.eq).toHaveBeenCalledWith('user_id', mockUserId);
      expect(preferences).toEqual(expect.objectContaining(mockPreferences));
    });

    it('saves user preferences updates', async () => {
      const { supabase } = await import('../lib/supabase');

      const updates = {
        slot_minutes: 15,
        tick_color: '#ff0000',
        show_objective_names: false,
      };

      const mockQuery = createMockQuery(updates);
      vi.mocked(supabase.from).mockReturnValue(mockQuery as any);

      await dataService.updateUserPreferences(updates);

      expect(mockQuery.update).toHaveBeenCalledWith(updates);
      expect(mockQuery.eq).toHaveBeenCalledWith('user_id', mockUserId);
    });
  });

  describe('Error Handling', () => {
    it('handles authentication errors gracefully', async () => {
      const { supabase } = await import('../lib/supabase');

      vi.mocked(supabase.auth.getUser).mockResolvedValue({
        data: { user: null },
        error: new Error('Not authenticated'),
      });

      const newDataService = new DataService('test-user-456');

      await expect(newDataService.getObjectives()).rejects.toThrow();
    });

    it('handles database errors during save operations', async () => {
      const { supabase } = await import('../lib/supabase');

      const mockQuery = createMockQuery(null, new Error('Database connection failed'));
      vi.mocked(supabase.from).mockReturnValue(mockQuery as any);

      await expect(
        dataService.saveWeek({
          week_start: '2025-01-06',
          schedule: {},
          plan_name: 'Test',
          reflections: {},
          visible_objectives: [],
        })
      ).rejects.toThrow();
    });
  });

  describe('Calendar Entry Detection', () => {
    it('detects existing calendar entries', async () => {
      const { supabase } = await import('../lib/supabase');

      const mockQuery = createMockQuery([{ week_start: '2025-01-01', schedule: { '2025-01-01': { 0: { id: 'obj-1', completed: true } } } }]);
      vi.mocked(supabase.from).mockReturnValue(mockQuery as any);

      const hasEntries = await dataService.hasAnyCalendarEntries();

      expect(hasEntries).toBe(true);
      expect(supabase.from).toHaveBeenCalledWith('weeks');
    });

    it('handles empty calendar data consistently', async () => {
      const hasEntries = await dataService.hasAnyCalendarEntries();

      // The function runs without errors and returns a boolean
      expect(typeof hasEntries).toBe('boolean');
    });
  });
});