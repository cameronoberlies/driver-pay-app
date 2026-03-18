// Supabase Edge Function: notify-admins-flight
// Deploy to: supabase/functions/notify-admins-flight/index.ts

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'

interface FlightNotification {
  driver_name: string
  status: 'delayed' | 'in_air' | 'landed'
}

interface AdminProfile {
  id: string
  push_token: string
  name?: string
}

serve(async (req) => {
  try {
    // Parse the incoming request
    const { driver_name, status }: FlightNotification = await req.json()

    if (!driver_name || !status) {
      return new Response(
        JSON.stringify({ error: 'Missing driver_name or status' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Validate status
    const validStatuses = ['delayed', 'in_air', 'landed']
    if (!validStatuses.includes(status)) {
      return new Response(
        JSON.stringify({ error: 'Invalid status. Must be: delayed, in_air, or landed' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Initialize Supabase client with service role key for server-side access
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    
    console.log('Supabase URL:', supabaseUrl ? 'Set' : 'Missing')
    console.log('Service Role Key:', supabaseKey ? 'Set (length: ' + supabaseKey.length + ')' : 'Missing')
    
    const supabase = createClient(
      supabaseUrl ?? '',
      supabaseKey ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    )

    // Query all admin push tokens
    console.log('Querying profiles table for admin push tokens...')
    const { data: admins, error } = await supabase
      .from('profiles')
      .select('id, push_token, name')
      .eq('role', 'admin')
      .not('push_token', 'is', null)
    
    console.log('Query result - Admins found:', admins?.length ?? 0)
    console.log('Query error:', error)

    if (error) {
      console.error('Database error:', error)
      return new Response(
        JSON.stringify({ error: 'Failed to query admin profiles' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }

    if (!admins || admins.length === 0) {
      return new Response(
        JSON.stringify({ success: true, sent: 0, message: 'No admins with push tokens found' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Build notification message
    const statusMessages = {
      delayed: `${driver_name}'s flight is delayed`,
      in_air: `${driver_name}'s flight is in the air`,
      landed: `${driver_name}'s flight has landed`
    }

    const title = 'Flight Update'
    const body = statusMessages[status]

    // Build Expo push notifications
    const messages = admins.map((admin: AdminProfile) => ({
      to: admin.push_token,
      sound: 'default',
      title,
      body,
      data: {
        type: 'flight_status',
        driver_name,
        status
      }
    }))

    // Send to Expo
    const pushResponse = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messages)
    })

    const pushResult = await pushResponse.json()

    console.log('Expo push result:', pushResult)

    return new Response(
      JSON.stringify({
        success: true,
        sent: admins.length,
        driver_name,
        status,
        push_result: pushResult
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error in notify-admins-flight:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})