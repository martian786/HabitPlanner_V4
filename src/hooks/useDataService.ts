import { useState, useEffect, useCallback, useRef } from 'react'
import { DataService, ValidationError, NetworkError } from '../lib/dataService'
import type { Objective, UserPreferences, Week } from '../lib/dataService'
import { supabase } from '../lib/supabase'

export interface DataServiceState {
  // Data
  objectives: Objective[]
  userPreferences: UserPreferences | null
  currentWeek: Week | null
  hasAnyWeeks: boolean | null
  
  // Loading states
  loading: {
    objectives: boolean
    preferences: boolean
    week: boolean
    saving: boolean
  }
  
  // Error states
  errors: {
    objectives: string | null
    preferences: string | null
    week: string | null
    saving: string | null
  }
  
  // Meta info
  rateLimitInfo: { remaining: number }
  lastSync: Date | null
}

export interface DataServiceActions {
  // Objectives
  loadObjectives: (includeArchived?: boolean) => Promise<void>
  createObjective: (name: string, color: string) => Promise<Objective | null>
  updateObjective: (id: string, updates: Partial<Objective>) => Promise<boolean>
  deleteObjective: (id: string) => Promise<boolean>
  
  // Preferences  
  loadUserPreferences: () => Promise<void>
  updateUserPreferences: (updates: Partial<UserPreferences>) => Promise<boolean>
  
  // Week data
  loadWeek: (weekStart: string) => Promise<void>
  saveWeek: (week: Partial<Week> & { week_start: string }) => Promise<boolean>
  
  // Utilities
  clearErrors: () => void
  clearCache: () => void
  retry: (operation: string) => Promise<void>
  checkHasAnyWeeks: () => Promise<void>
}

export type UseDataServiceReturn = DataServiceState & DataServiceActions

let globalDataService: DataService | null = null

export function useDataService(userId: string | null): UseDataServiceReturn {
  // Initialize data service
  useEffect(() => {
    if (userId && (!globalDataService || (globalDataService as any).userId !== userId)) {
      try {
        globalDataService = new DataService(userId)
      } catch (error) {
        console.error('Failed to initialize DataService:', error)
        globalDataService = null
      }
    } else if (!userId) {
      globalDataService = null
    }
  }, [userId])

  // State
  const [state, setState] = useState<DataServiceState>({
    objectives: [],
    userPreferences: null,
    currentWeek: null,
    hasAnyWeeks: null,
    loading: {
      objectives: false,
      preferences: false,
      week: false,
      saving: false
    },
    errors: {
      objectives: null,
      preferences: null,
      week: null,
      saving: null
    },
    rateLimitInfo: { remaining: 60 },
    lastSync: null
  })

  // Refs for optimistic updates rollback and debouncing
  const rollbackRef = useRef<{
    objectives?: Objective[]
    preferences?: UserPreferences
    week?: Week
  }>({})
  
  const lastPreferenceUpdateRef = useRef<number>(0)

  // Error handling helper
  const handleError = useCallback((error: unknown, operation: keyof DataServiceState['errors']) => {
    let message = 'An unexpected error occurred'
    
    if (error instanceof ValidationError) {
      message = error.message
    } else if (error instanceof NetworkError) {
      message = error.message
    }
    
    setState(prev => ({
      ...prev,
      errors: {
        ...prev.errors,
        [operation]: message
      }
    }))
    
    // Auto-clear errors after 5 seconds
    setTimeout(() => {
      setState(prev => ({
        ...prev,
        errors: {
          ...prev.errors,
          [operation]: null
        }
      }))
    }, 5000)
  }, [])

  // Loading helper
  const setLoading = useCallback((operation: keyof DataServiceState['loading'], loading: boolean) => {
    setState(prev => ({
      ...prev,
      loading: {
        ...prev.loading,
        [operation]: loading
      }
    }))
  }, [])

  // Update rate limit info
  const updateRateLimit = useCallback(() => {
    if (globalDataService) {
      setState(prev => ({
        ...prev,
        rateLimitInfo: globalDataService!.getRateLimitInfo()
      }))
    }
  }, [])

  // Optimistic update helper
  const performOptimisticUpdate = useCallback(<T,>(
    operation: () => Promise<T>,
    optimisticUpdate: () => void,
    rollback: () => void
  ): Promise<T | null> => {
    try {
      optimisticUpdate()
      return operation().catch((error) => {
        rollback()
        throw error
      })
    } catch (error) {
      rollback()
      throw error
    }
  }, [])

  // Objectives operations
  const loadObjectives = useCallback(async (includeArchived = false) => {
    if (!globalDataService) return

    setLoading('objectives', true)
    setState(prev => ({ ...prev, errors: { ...prev.errors, objectives: null }}))

    try {
      const objectives = await globalDataService.getObjectives(includeArchived)
      setState(prev => ({
        ...prev,
        objectives,
        lastSync: new Date()
      }))
      updateRateLimit()
    } catch (error) {
      handleError(error, 'objectives')
    } finally {
      setLoading('objectives', false)
    }
  }, [setLoading, handleError, updateRateLimit])

  const createObjective = useCallback(async (name: string, color: string): Promise<Objective | null> => {
    if (!globalDataService) return null

    try {
      const newObjective = await performOptimisticUpdate(
        () => globalDataService!.createObjective(name, color),
        () => {
          // Optimistic update: add temporary objective
          const tempObjective: Objective = {
            id: `temp-${Date.now()}`,
            name,
            color,
            user_id: userId!,
            sort_order: state.objectives.length
          }
          rollbackRef.current.objectives = state.objectives
          setState(prev => ({
            ...prev,
            objectives: [...prev.objectives, tempObjective]
          }))
        },
        () => {
          // Rollback: restore previous objectives
          if (rollbackRef.current.objectives) {
            setState(prev => ({
              ...prev,
              objectives: rollbackRef.current.objectives!
            }))
          }
        }
      )

      if (newObjective) {
        // Replace temp objective with real one
        setState(prev => ({
          ...prev,
          objectives: prev.objectives.map(obj => 
            obj.id.startsWith('temp-') && obj.name === name ? newObjective : obj
          ),
          lastSync: new Date()
        }))
        updateRateLimit()
        return newObjective
      }
    } catch (error) {
      handleError(error, 'objectives')
    }
    
    return null
  }, [state.objectives, userId, performOptimisticUpdate, handleError, updateRateLimit])

  const updateObjective = useCallback(async (
    id: string, 
    updates: Partial<Objective>
  ): Promise<boolean> => {
    if (!globalDataService) return false

    try {
      await performOptimisticUpdate(
        () => globalDataService!.updateObjective(id, updates),
        () => {
          // Optimistic update
          rollbackRef.current.objectives = state.objectives
          setState(prev => ({
            ...prev,
            objectives: prev.objectives.map(obj => 
              obj.id === id ? { ...obj, ...updates } : obj
            )
          }))
        },
        () => {
          // Rollback
          if (rollbackRef.current.objectives) {
            setState(prev => ({
              ...prev,
              objectives: rollbackRef.current.objectives!
            }))
          }
        }
      )

      setState(prev => ({ ...prev, lastSync: new Date() }))
      updateRateLimit()
      return true
    } catch (error) {
      handleError(error, 'objectives')
      return false
    }
  }, [state.objectives, performOptimisticUpdate, handleError, updateRateLimit])

  const deleteObjective = useCallback(async (id: string): Promise<boolean> => {
    if (!globalDataService) return false

    try {
      await performOptimisticUpdate(
        () => globalDataService!.deleteObjective(id),
        () => {
          // Optimistic update: remove objective
          rollbackRef.current.objectives = state.objectives
          setState(prev => ({
            ...prev,
            objectives: prev.objectives.filter(obj => obj.id !== id)
          }))
        },
        () => {
          // Rollback: restore objective
          if (rollbackRef.current.objectives) {
            setState(prev => ({
              ...prev,
              objectives: rollbackRef.current.objectives!
            }))
          }
        }
      )

      setState(prev => ({ ...prev, lastSync: new Date() }))
      
      // Refresh hasAnyWeeks after deleting objectives (might affect calendar entries)
      try {
        // Clear cache to ensure fresh database check
        globalDataService.clearCache()
        const hasCalendarEntries = await globalDataService.hasAnyCalendarEntries()
        setState(prev => ({
          ...prev,
          hasAnyWeeks: hasCalendarEntries
        }))
      } catch (error) {
        console.warn('Failed to refresh hasAnyWeeks after delete:', error)
      }
      
      updateRateLimit()
      return true
    } catch (error) {
      handleError(error, 'objectives')
      return false
    }
  }, [state.objectives, performOptimisticUpdate, handleError, updateRateLimit])

  // User preferences operations
  const loadUserPreferences = useCallback(async () => {
    if (!globalDataService) return

    setLoading('preferences', true)
    setState(prev => ({ ...prev, errors: { ...prev.errors, preferences: null }}))

    try {
      const preferences = await globalDataService.getUserPreferences()
      setState(prev => ({
        ...prev,
        userPreferences: preferences,
        lastSync: new Date()
      }))
      updateRateLimit()
    } catch (error) {
      handleError(error, 'preferences')
    } finally {
      setLoading('preferences', false)
    }
  }, [setLoading, handleError, updateRateLimit])

  const updateUserPreferences = useCallback(async (updates: Partial<UserPreferences>): Promise<boolean> => {
    if (!globalDataService) return false

    try {
      // Set timestamp to prevent subscription reload conflicts
      lastPreferenceUpdateRef.current = Date.now()
      
      await performOptimisticUpdate(
        () => globalDataService!.updateUserPreferences(updates),
        () => {
          // Optimistic update
          rollbackRef.current.preferences = state.userPreferences || undefined
          setState(prev => ({
            ...prev,
            userPreferences: prev.userPreferences ? 
              { ...prev.userPreferences, ...updates } : 
              { 
                show_archived: false, 
                delete_mode: 'soft',
                start_minutes: 6 * 60, // 6:00 AM
                end_minutes: 22 * 60, // 10:00 PM  
                slot_minutes: 15,
                week_starts_on: 'Monday',
                max_objectives: 6,
                tick_color: '#16a34a',
                show_objective_names: false,
                ...updates 
              }
          }))
        },
        () => {
          // Rollback
          setState(prev => ({
            ...prev,
            userPreferences: rollbackRef.current.preferences || null
          }))
        }
      )

      setState(prev => ({ ...prev, lastSync: new Date() }))
      updateRateLimit()
      
      // Force reload preferences to ensure they're in sync with database
      await loadUserPreferences()
      
      return true
    } catch (error) {
      handleError(error, 'preferences')
      return false
    }
  }, [state.userPreferences, performOptimisticUpdate, handleError, updateRateLimit, loadUserPreferences])

  // Week operations
  const loadWeek = useCallback(async (weekStart: string) => {
    if (!globalDataService) return

    setLoading('week', true)
    setState(prev => ({ ...prev, errors: { ...prev.errors, week: null }}))

    try {
      const week = await globalDataService.getWeek(weekStart)
      setState(prev => ({
        ...prev,
        currentWeek: week,
        lastSync: new Date()
      }))
      updateRateLimit()
    } catch (error) {
      handleError(error, 'week')
    } finally {
      setLoading('week', false)
    }
  }, [setLoading, handleError, updateRateLimit])

  const saveWeek = useCallback(async (week: Partial<Week> & { week_start: string }): Promise<boolean> => {
    if (!globalDataService) return false

    setLoading('saving', true)
    setState(prev => ({ ...prev, errors: { ...prev.errors, saving: null }}))

    try {
      await globalDataService.saveWeek(week)
      setState(prev => ({ 
        ...prev, 
        currentWeek: prev.currentWeek ? { ...prev.currentWeek, ...week } : null,
        lastSync: new Date() 
      }))
      
      // Refresh hasAnyWeeks to keep it accurate
      // Clear cache to ensure fresh database check
      globalDataService.clearCache()
      const hasCalendarEntries = await globalDataService.hasAnyCalendarEntries()
      setState(prev => ({
        ...prev,
        hasAnyWeeks: hasCalendarEntries
      }))
      
      updateRateLimit()
      return true
    } catch (error) {
      handleError(error, 'saving')
      return false
    } finally {
      setLoading('saving', false)
    }
  }, [setLoading, handleError, updateRateLimit])

  // Utility operations
  const clearErrors = useCallback(() => {
    setState(prev => ({
      ...prev,
      errors: {
        objectives: null,
        preferences: null,
        week: null,
        saving: null
      }
    }))
  }, [])

  const clearCache = useCallback(() => {
    if (globalDataService) {
      globalDataService.clearCache()
    }
  }, [])

  const retry = useCallback(async (operation: string) => {
    switch (operation) {
      case 'objectives':
        await loadObjectives()
        break
      case 'preferences':
        await loadUserPreferences()
        break
      case 'week':
        if (state.currentWeek?.week_start) {
          await loadWeek(state.currentWeek.week_start)
        }
        break
      default:
        console.warn(`Unknown operation for retry: ${operation}`)
    }
  }, [loadObjectives, loadUserPreferences, loadWeek, state.currentWeek])

  // Real-time subscriptions
  useEffect(() => {
    if (!userId) return

    const subscriptions = [
      // Subscribe to objectives changes
      supabase
        .channel('objectives_changes')
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'objectives',
          filter: `user_id=eq.${userId}`
        }, () => {
          // Debounce objective reloads to prevent rapid reloads during navigation
          setTimeout(() => {
            console.log('Real-time: Reloading objectives due to database change')
            loadObjectives(true)
          }, 200)
        })
        .subscribe(),

      // Subscribe to user preferences changes  
      supabase
        .channel('preferences_changes')
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'user_preferences',
          filter: `user_id=eq.${userId}`
        }, async () => {
          // Prevent subscription reload if we just updated preferences
          // iOS devices need longer prevention window due to timing issues
          const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
          const preventionWindow = isIOS ? 10000 : 5000
          const timeSinceLastUpdate = Date.now() - lastPreferenceUpdateRef.current
          
          if (timeSinceLastUpdate < preventionWindow) {
            console.log('Skipping preference reload - recent update detected')
            return
          }
          
          // Reload preferences when they change from external source
          await loadUserPreferences()
          // Always reload all objectives (including archived) to maintain data integrity
          await loadObjectives(true)
        })
        .subscribe()
    ]

    return () => {
      subscriptions.forEach(sub => sub.unsubscribe())
    }
  }, [userId, loadObjectives, loadUserPreferences])

  // Simple weeks existence check - only called on login
  const checkHasAnyWeeks = useCallback(async () => {
    if (!globalDataService) return

    try {
      const hasWeeks = await globalDataService.hasAnyCalendarEntries()
      setState(prev => ({
        ...prev,
        hasAnyWeeks: hasWeeks
      }))
    } catch (error) {
      console.warn('Failed to check weeks existence:', error)
      // Don't set error state, this is not critical
    }
  }, [])

  // Auto-load data when user changes
  useEffect(() => {
    if (userId) {
      loadUserPreferences()
      loadObjectives(true) // Always load all objectives including archived
      checkHasAnyWeeks() // Simple check, only once on login
    } else {
      // Clear data when user logs out
      setState({
        objectives: [],
        userPreferences: null,
        currentWeek: null,
        hasAnyWeeks: null,
        loading: {
          objectives: false,
          preferences: false,
          week: false,
          saving: false
        },
        errors: {
          objectives: null,
          preferences: null,
          week: null,
          saving: null
        },
        rateLimitInfo: { remaining: 60 },
        lastSync: null
      })
    }
  }, [userId, loadUserPreferences, loadObjectives, checkHasAnyWeeks])

  // Note: Objective reloading on preference change is handled by the real-time subscription above

  return {
    // State
    ...state,
    
    // Actions
    loadObjectives,
    createObjective,
    updateObjective,
    deleteObjective,
    loadUserPreferences,
    updateUserPreferences,
    loadWeek,
    saveWeek,
    clearErrors,
    clearCache,
    retry,
    checkHasAnyWeeks
  }
}