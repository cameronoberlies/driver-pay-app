// update-driver-etas Edge Function
// Runs via pg_cron every 10 minutes
// Calls Google Distance Matrix API to get real road ETA for active drivers

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const GOOGLE_API_KEY = 'AIzaSyBaWNi6dKRpz0BqwxkdA8Tk-MATwcHtTRE'
const DEALERSHIP = { lat: 35.270367, lng: -81.496247 }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    )

    // Get active trips
    const { data: activeTrips } = await supabase
      .from('trips')
      .select('id, driver_id, second_driver_id, designated_driver_id, trip_type, actual_start, scheduled_pickup')
      .eq('status', 'in_progress')

    if (!activeTrips || activeTrips.length === 0) {
      return new Response(
        JSON.stringify({ updated: 0, message: 'No active trips' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const activeDriverIds = [...new Set(
      activeTrips.flatMap(t => [t.driver_id, t.second_driver_id].filter(Boolean))
    )]

    // Get locations for active drivers
    const { data: locations } = await supabase
      .from('driver_locations')
      .select('driver_id, latitude, longitude, eta_updated_at')
      .in('driver_id', activeDriverIds)

    if (!locations || locations.length === 0) {
      return new Response(
        JSON.stringify({ updated: 0, message: 'No driver locations' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // Filter to drivers whose ETA is stale (>9 min old) or never set
    const STALE_THRESHOLD = 9 * 60 * 1000 // 9 minutes
    const now = Date.now()
    const staleDrivers = locations.filter(loc => {
      if (!loc.eta_updated_at) return true
      return (now - new Date(loc.eta_updated_at).getTime()) > STALE_THRESHOLD
    })

    if (staleDrivers.length === 0) {
      return new Response(
        JSON.stringify({ updated: 0, message: 'All ETAs are fresh' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // Build Distance Matrix request — batch all origins in one call
    // Distance Matrix supports up to 25 origins per request
    const origins = staleDrivers
      .map(loc => `${loc.latitude},${loc.longitude}`)
      .join('|')
    const destination = `${DEALERSHIP.lat},${DEALERSHIP.lng}`

    const dmUrl = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origins}&destinations=${destination}&mode=driving&units=imperial&key=${GOOGLE_API_KEY}`

    const dmRes = await fetch(dmUrl)
    if (!dmRes.ok) {
      return new Response(
        JSON.stringify({ error: `Distance Matrix API error: ${dmRes.status}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const dmData = await dmRes.json()

    if (dmData.status !== 'OK') {
      return new Response(
        JSON.stringify({ error: `Distance Matrix status: ${dmData.status}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // Update each driver's ETA
    let updated = 0
    let gasReminders = 0
    const nowISO = new Date().toISOString()

    for (let i = 0; i < staleDrivers.length; i++) {
      const row = dmData.rows[i]
      if (!row || !row.elements || !row.elements[0]) continue

      const element = row.elements[0]
      if (element.status !== 'OK') continue

      const durationSeconds = element.duration.value
      const distanceMeters = element.distance.value
      const etaMinutes = Math.round(durationSeconds / 60)
      const etaMiles = Math.round(distanceMeters / 1609.34)

      await supabase.from('driver_locations').update({
        eta_minutes: etaMinutes,
        eta_miles: etaMiles,
        eta_updated_at: nowISO,
      }).eq('driver_id', staleDrivers[i].driver_id)

      // ─── GAS REMINDER CHECK ────────────────────────────────────────────────
      // Fire when: drive trip, past scheduled pickup time, designated driver (Driver A), within 15 miles
      if (etaMiles <= 15) {
        const driverId = staleDrivers[i].driver_id
        const trip = activeTrips.find(t =>
          t.designated_driver_id === driverId && t.trip_type === 'drive'
        )

        if (trip) {
          // Only fire after the scheduled pickup time (means they've picked up and are returning)
          const pastPickup = trip.scheduled_pickup
            ? now > new Date(trip.scheduled_pickup).getTime()
            : (now - new Date(trip.actual_start).getTime()) / 3600000 >= 1 // fallback: 1hr if no pickup time
          if (pastPickup) {
            // Dedup: only send once per trip
            const { data: alreadySent } = await supabase
              .from('system_logs')
              .select('id')
              .eq('event', 'gas_reminder_sent')
              .contains('metadata', { trip_id: trip.id })
              .limit(1)

            if (!alreadySent || alreadySent.length === 0) {
              // Get driver's push token
              const { data: driverProfile } = await supabase
                .from('profiles')
                .select('push_token, name')
                .eq('id', driverId)
                .single()

              if (driverProfile?.push_token?.startsWith('ExponentPushToken')) {
                await fetch('https://exp.host/--/api/v2/push/send', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    to: driverProfile.push_token,
                    sound: 'default',
                    title: '⛽ Fuel Check',
                    body: 'You\'re getting close — please make sure the chase vehicle has at least 1/4 tank before returning it.',
                    data: { type: 'gas_reminder', trip_id: trip.id },
                  }),
                })
              }

              await supabase.from('system_logs').insert({
                source: 'edge_function',
                level: 'info',
                event: 'gas_reminder_sent',
                message: `Gas reminder sent to ${driverProfile?.name || 'driver'} (${etaMiles} mi out)`,
                metadata: { trip_id: trip.id, driver_id: driverId, eta_miles: etaMiles },
              })

              gasReminders++
            }
          }
        }
      }

      updated++
    }

    return new Response(
      JSON.stringify({ updated, total_drivers: staleDrivers.length, gas_reminders: gasReminders }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
