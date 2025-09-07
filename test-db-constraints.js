// Test script for database reflection constraints
// Run with: node test-db-constraints.js

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase environment variables')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function testConstraints() {
  console.log('Testing database reflection constraints...\n')
  
  // You'll need to authenticate first or use a service role key
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    console.error('Authentication required. Please login first.')
    return
  }

  const userId = user.id
  
  // Test 1: Valid data (should succeed)
  console.log('Test 1: Valid data (should succeed)')
  try {
    const { error } = await supabase
      .from('weeks')
      .upsert({
        user_id: userId,
        week_start: '2024-01-01',
        reflections: {
          '2024-01-01': {
            proud: 'This is a normal length reflection',
            improvements: 'Also normal length',
            thought: 'A regular thought',
            mood: 'happy'
          }
        },
        schedule: {},
        plan_name: 'Test Plan',
        visible_objectives: []
      })
    
    if (error) {
      console.error('❌ Test 1 failed unexpectedly:', error.message)
    } else {
      console.log('✅ Test 1 passed - valid data accepted')
    }
  } catch (err) {
    console.error('❌ Test 1 error:', err)
  }
  
  // Test 2: Proud field too long (should fail)  
  console.log('\nTest 2: Proud field too long (should fail)')
  try {
    const { error } = await supabase
      .from('weeks') 
      .upsert({
        user_id: userId,
        week_start: '2024-01-02',
        reflections: {
          '2024-01-02': {
            proud: 'x'.repeat(501), // 501 characters - should fail
            improvements: 'Normal text',
            thought: 'Normal thought',
            mood: 'happy'
          }
        },
        schedule: {},
        plan_name: 'Test Plan 2',
        visible_objectives: []
      })
      
    if (error) {
      console.log('✅ Test 2 passed - constraint blocked oversized proud field')
      console.log('   Error:', error.message)
    } else {
      console.error('❌ Test 2 failed - constraint did not block oversized data')
    }
  } catch (err) {
    console.log('✅ Test 2 passed - constraint blocked oversized data')
    console.log('   Error:', err.message)
  }
  
  // Test 3: Thought field too long (should fail)
  console.log('\nTest 3: Thought field too long (should fail)')
  try {
    const { error } = await supabase
      .from('weeks')
      .upsert({
        user_id: userId, 
        week_start: '2024-01-03',
        reflections: {
          '2024-01-03': {
            proud: 'Normal text',
            improvements: 'Normal text', 
            thought: 'y'.repeat(1001), // 1001 characters - should fail
            mood: 'happy'
          }
        },
        schedule: {},
        plan_name: 'Test Plan 3',
        visible_objectives: []
      })
      
    if (error) {
      console.log('✅ Test 3 passed - constraint blocked oversized thought field')
      console.log('   Error:', error.message)
    } else {
      console.error('❌ Test 3 failed - constraint did not block oversized data')
    }
  } catch (err) {
    console.log('✅ Test 3 passed - constraint blocked oversized data')
    console.log('   Error:', err.message)
  }
  
  console.log('\nConstraint testing complete!')
}

testConstraints().catch(console.error)