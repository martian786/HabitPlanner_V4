import { supabase } from './supabase'

// Constants
export const MAX_OBJECTIVE_NAME_LENGTH = 24;

// Default objectives for new users
const DEFAULT_OBJECTIVES = [
  { name: "Deep Work", color: "#1d4ed8" },
  { name: "Admin", color: "#fb923c" },
  { name: "Break", color: "#22c55e" },
]

// Types
export interface Objective {
  id: string
  name: string
  color: string
  sort_order?: number
  archived?: boolean
  user_id: string
}

export interface UserPreferences {
  show_archived: boolean
  delete_mode: "soft" | "hard"
  // App settings
  start_minutes: number
  end_minutes: number
  slot_minutes: number
  week_starts_on: "Monday" | "Sunday"
  max_objectives: number
  tick_color: string
  show_objective_names: boolean
  prevent_overwrite?: boolean
}

export interface Week {
  user_id: string
  week_start: string
  schedule: Record<string, unknown>
  plan_name: string
  reflections: Record<string, unknown>
  visible_objectives: string[]
  updated_at?: string
}

// Validation schemas
export class ValidationError extends Error {
  public field?: string
  
  constructor(message: string, field?: string) {
    super(message)
    this.name = 'ValidationError'
    this.field = field
  }
}

export class NetworkError extends Error {
  public retryable: boolean
  
  constructor(message: string, retryable: boolean = true) {
    super(message)
    this.name = 'NetworkError'
    this.retryable = retryable
  }
}

// Input validation functions
function validateObjectiveName(name: string): void {
  if (!name || typeof name !== 'string') {
    throw new ValidationError('Objective name is required', 'name')
  }
  if (name.length < 1 || name.length > MAX_OBJECTIVE_NAME_LENGTH) {
    throw new ValidationError(`Objective name must be between 1 and ${MAX_OBJECTIVE_NAME_LENGTH} characters`, 'name')
  }
  // Prevent XSS
  if (/<[^>]*>/g.test(name)) {
    throw new ValidationError('Objective name cannot contain HTML tags', 'name')
  }
}

function validateColor(color: string): void {
  if (!color || typeof color !== 'string') {
    throw new ValidationError('Color is required', 'color')
  }
  // Validate hex color format
  if (!/^#[0-9A-Fa-f]{6}$/.test(color)) {
    throw new ValidationError('Color must be a valid hex color (e.g., #FF5733)', 'color')
  }
}

function validateWeekStart(weekStart: string): void {
  if (!weekStart || typeof weekStart !== 'string') {
    throw new ValidationError('Week start date is required', 'week_start')
  }
  // Validate ISO date format YYYY-MM-DD
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    throw new ValidationError('Week start must be in YYYY-MM-DD format', 'week_start')
  }
  const date = new Date(weekStart)
  if (isNaN(date.getTime())) {
    throw new ValidationError('Invalid week start date', 'week_start')
  }
}

function sanitizeString(input: string): string {
  return input.trim().replace(/<[^>]*>/g, '') // Remove HTML tags
}

// Rate limiting
class RateLimiter {
  private requests: Map<string, number[]> = new Map()
  private readonly maxRequests = 60 // requests per minute
  private readonly windowMs = 60 * 1000 // 1 minute

  canMakeRequest(key: string): boolean {
    const now = Date.now()
    const requests = this.requests.get(key) || []
    
    // Remove old requests outside the window
    const validRequests = requests.filter(timestamp => now - timestamp < this.windowMs)
    
    if (validRequests.length >= this.maxRequests) {
      return false
    }
    
    validRequests.push(now)
    this.requests.set(key, validRequests)
    return true
  }

  getRemainingRequests(key: string): number {
    const requests = this.requests.get(key) || []
    const now = Date.now()
    const validRequests = requests.filter(timestamp => now - timestamp < this.windowMs)
    return Math.max(0, this.maxRequests - validRequests.length)
  }
}

const rateLimiter = new RateLimiter()

// Error handling
function handleDatabaseError(error: { code?: string; message?: string; name?: string }, operation: string): never {
  console.error(`Database operation failed: ${operation}`, { 
    code: error.code,
    message: error.message,
    timestamp: new Date().toISOString()
  })

  // Don't expose internal database errors to users
  if (error.code === 'PGRST301' || error.code === 'PGRST116') {
    throw new NetworkError('Resource not found')
  }
  
  if (error.code === '23505') {
    throw new ValidationError('A record with this name already exists')
  }
  
  if (error.code === 'PGRST103') {
    throw new NetworkError('Authentication required')
  }
  
  // Network/timeout errors
  if (error.name === 'AbortError' || error.message?.includes('timeout')) {
    throw new NetworkError('Request timeout - please try again')
  }
  
  throw new NetworkError('An unexpected error occurred. Please try again.')
}

// Retry logic
async function withRetry<T>(
  operation: () => Promise<T>,
  maxAttempts: number = 3,
  delayMs: number = 1000
): Promise<T> {
  let lastError: Error
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation()
    } catch (error) {
      lastError = error as Error
      
      // Don't retry validation errors or non-retryable network errors
      if (error instanceof ValidationError || 
          (error instanceof NetworkError && !error.retryable)) {
        throw error
      }
      
      if (attempt === maxAttempts) {
        throw lastError
      }
      
      // Exponential backoff
      await new Promise(resolve => setTimeout(resolve, delayMs * Math.pow(2, attempt - 1)))
    }
  }
  
  throw lastError!
}

// Cache implementation
class SimpleCache {
  private cache = new Map<string, { data: unknown; timestamp: number; ttl: number }>()

  set(key: string, data: unknown, ttlMs: number = 30000): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl: ttlMs
    })
  }

  get(key: string): unknown | null {
    const entry = this.cache.get(key)
    if (!entry) return null
    
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key)
      return null
    }
    
    return entry.data
  }

  invalidate(pattern: string): void {
    for (const key of this.cache.keys()) {
      if (key.includes(pattern)) {
        this.cache.delete(key)
      }
    }
  }

  clear(): void {
    this.cache.clear()
  }
}

const cache = new SimpleCache()

// Data service class
export class DataService {
  private userId: string

  constructor(userId: string) {
    if (!userId) {
      throw new Error('User ID is required for DataService')
    }
    this.userId = userId
  }

  private checkRateLimit(operation: string): void {
    const key = `${this.userId}:${operation}`
    if (!rateLimiter.canMakeRequest(key)) {
      throw new NetworkError('Rate limit exceeded. Please slow down.', false)
    }
  }

  // Objectives operations
  async getObjectives(includeArchived: boolean = false): Promise<Objective[]> {
    this.checkRateLimit('getObjectives')
    
    const cacheKey = `objectives:${this.userId}:${includeArchived}`
    const cached = cache.get(cacheKey) as Objective[] | null
    if (cached) return cached

    return withRetry(async () => {
      let query = supabase
        .from('objectives')
        .select('id, name, color, sort_order, archived, user_id')
        .eq('user_id', this.userId)
        .order('sort_order', { ascending: true })

      if (!includeArchived) {
        query = query.or('archived.is.null,archived.eq.false')
      }

      const { data, error } = await query

      if (error) {
        handleDatabaseError(error, 'getObjectives')
      }

      let objectives = (data as Objective[]) || []
      
      // If user has no objectives, seed defaults
      if (objectives.length === 0 && !includeArchived) {
        await this.seedDefaultObjectives()
        // Fetch again after seeding
        const { data: newData, error: newError } = await query
        if (newError) {
          handleDatabaseError(newError, 'getObjectives after seeding')
        }
        objectives = (newData as Objective[]) || []
      }
      
      cache.set(cacheKey, objectives)
      return objectives
    })
  }

  private async seedDefaultObjectives(): Promise<void> {
    const toSeed = DEFAULT_OBJECTIVES.map((o, i) => ({
      user_id: this.userId,
      name: o.name,
      color: o.color,
      sort_order: i
    }))

    const { error } = await supabase
      .from('objectives')
      .insert(toSeed)

    if (error) {
      handleDatabaseError(error, 'seedDefaultObjectives')
    }
  }

  async createObjective(name: string, color: string): Promise<Objective> {
    this.checkRateLimit('createObjective')
    
    validateObjectiveName(name)
    validateColor(color)
    
    const sanitizedName = sanitizeString(name)
    
    return withRetry(async () => {
      const { data, error } = await supabase
        .from('objectives')
        .insert({
          user_id: this.userId,
          name: sanitizedName,
          color: color.toLowerCase()
        })
        .select('id, name, color, sort_order, archived, user_id')
        .single()

      if (error) {
        handleDatabaseError(error, 'createObjective')
      }

      const objective = data as Objective
      cache.invalidate(`objectives:${this.userId}`)
      return objective
    })
  }

  async updateObjective(
    id: string, 
    updates: Partial<Pick<Objective, "name" | "color" | "sort_order" | "archived">>
  ): Promise<void> {
    this.checkRateLimit('updateObjective')
    
    if (!id) {
      throw new ValidationError('Objective ID is required', 'id')
    }

    // Validate updates
    if (updates.name !== undefined) {
      validateObjectiveName(updates.name)
      updates.name = sanitizeString(updates.name)
    }
    
    if (updates.color !== undefined) {
      validateColor(updates.color)
      updates.color = updates.color.toLowerCase()
    }

    return withRetry(async () => {
      const { error } = await supabase
        .from('objectives')
        .update(updates)
        .eq('id', id)
        .eq('user_id', this.userId)

      if (error) {
        handleDatabaseError(error, 'updateObjective')
      }

      cache.invalidate(`objectives:${this.userId}`)
    })
  }

  async deleteObjective(id: string): Promise<void> {
    this.checkRateLimit('deleteObjective')
    
    if (!id) {
      throw new ValidationError('Objective ID is required', 'id')
    }

    return withRetry(async () => {
      const { error } = await supabase
        .from('objectives')
        .delete()
        .eq('id', id)
        .eq('user_id', this.userId)

      if (error) {
        handleDatabaseError(error, 'deleteObjective')
      }

      cache.invalidate(`objectives:${this.userId}`)
    })
  }

  // User preferences operations
  async getUserPreferences(): Promise<UserPreferences> {
    this.checkRateLimit('getUserPreferences')
    
    const cacheKey = `preferences:${this.userId}`
    const cached = cache.get(cacheKey) as UserPreferences | null
    if (cached) return cached

    return withRetry(async () => {
      const { data, error } = await supabase
        .from('user_preferences')
        .select('*')
        .eq('user_id', this.userId)
        .single()

      if (error) {
        if (error.code === 'PGRST116') {
          // No preferences found, create default
          const defaultPrefs: UserPreferences = {
            show_archived: false,
            delete_mode: 'soft',
            start_minutes: 6 * 60, // 6:00 AM
            end_minutes: 22 * 60, // 10:00 PM  
            slot_minutes: 20,
            week_starts_on: 'Monday',
            max_objectives: 6,
            tick_color: '#16a34a',
            show_objective_names: true,
            prevent_overwrite: true
          }
          await this.updateUserPreferences(defaultPrefs)
          return defaultPrefs
        }
        handleDatabaseError(error, 'getUserPreferences')
      }

      const preferences = data as UserPreferences
      cache.set(cacheKey, preferences)
      return preferences
    })
  }

  async updateUserPreferences(updates: Partial<UserPreferences>): Promise<void> {
    this.checkRateLimit('updateUserPreferences')
    
    // Validate updates
    if (updates.delete_mode && !['soft', 'hard'].includes(updates.delete_mode)) {
      throw new ValidationError('Delete mode must be "soft" or "hard"', 'delete_mode')
    }

    return withRetry(async () => {
      // Use update instead of upsert to only modify specific fields
      const { error } = await supabase
        .from('user_preferences')
        .update(updates)
        .eq('user_id', this.userId)

      if (error) {
        // If no record exists yet, create one with defaults + updates
        if (error.code === 'PGRST116') {
          const { error: insertError } = await supabase
            .from('user_preferences')
            .insert({
              user_id: this.userId,
              show_archived: false,
              delete_mode: 'soft',
              start_minutes: 6 * 60, // 6:00 AM
              end_minutes: 22 * 60, // 10:00 PM  
              slot_minutes: 20,
              week_starts_on: 'Monday',
              max_objectives: 6,
              tick_color: '#16a34a',
              show_objective_names: true,
              prevent_overwrite: true,
              ...updates
            })
          
          if (insertError) {
            handleDatabaseError(insertError, 'updateUserPreferences insert')
          }
        } else {
          handleDatabaseError(error, 'updateUserPreferences')
        }
      }

      cache.invalidate(`preferences:${this.userId}`)
    })
  }

  // Week operations
  async getWeek(weekStart: string): Promise<Week | null> {
    this.checkRateLimit('getWeek')
    validateWeekStart(weekStart)
    
    const cacheKey = `week:${this.userId}:${weekStart}`
    const cached = cache.get(cacheKey) as Week | null
    if (cached) return cached

    return withRetry(async () => {
      const { data, error } = await supabase
        .from('weeks')
        .select('*')
        .eq('user_id', this.userId)
        .eq('week_start', weekStart)
        .single()

      if (error) {
        if (error.code === 'PGRST116') {
          // No week found
          return null
        }
        handleDatabaseError(error, 'getWeek')
      }

      const week = data as Week
      cache.set(cacheKey, week, 60000) // Cache for 1 minute
      return week
    })
  }

  async saveWeek(week: Partial<Week> & { week_start: string }): Promise<void> {
    this.checkRateLimit('saveWeek')
    validateWeekStart(week.week_start)
    
    if (week.plan_name && typeof week.plan_name === 'string') {
      week.plan_name = sanitizeString(week.plan_name)
    }

    return withRetry(async () => {
      const payload: Week = {
        user_id: this.userId,
        week_start: week.week_start,
        schedule: week.schedule || {},
        plan_name: week.plan_name || '',
        reflections: week.reflections || {},
        visible_objectives: week.visible_objectives || [],
        updated_at: new Date().toISOString()
      }

      const { error } = await supabase
        .from('weeks')
        .upsert(payload, { 
          onConflict: 'user_id,week_start',
          ignoreDuplicates: false 
        })

      if (error) {
        handleDatabaseError(error, 'saveWeek')
      }

      cache.invalidate(`week:${this.userId}:${week.week_start}`)
    })
  }

  // Check if user has any weeks with calendar content
  async hasAnyCalendarEntries(): Promise<boolean> {
    this.checkRateLimit('hasAnyCalendarEntries')
    
    const cacheKey = `hasCalendarEntries:${this.userId}`
    const cached = cache.get(cacheKey) as boolean | null
    if (cached !== null) return cached

    return withRetry(async () => {
      const { data, error } = await supabase
        .from('weeks')
        .select('schedule')
        .eq('user_id', this.userId)

      if (error) {
        handleDatabaseError(error, 'hasAnyCalendarEntries')
      }

      const weeks = (data as { schedule: Record<string, unknown> }[]) || []
      
      // Check if any week has actual calendar entries
      for (const week of weeks) {
        const schedule = week.schedule || {}
        for (const iso in schedule) {
          const dayMap = schedule[iso] || {}
          if (typeof dayMap === 'object' && dayMap !== null && Object.keys(dayMap).length > 0) {
            cache.set(cacheKey, true, 60000) // Cache for 1 minute
            return true
          }
        }
      }
      
      // No weeks with calendar content found
      cache.set(cacheKey, false, 60000) // Cache for 1 minute
      return false
    })
  }

  // Utility methods
  clearCache(): void {
    cache.clear()
  }

  getRateLimitInfo(): { remaining: number } {
    return {
      remaining: rateLimiter.getRemainingRequests(this.userId)
    }
  }
}