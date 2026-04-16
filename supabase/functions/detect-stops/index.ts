// detect-stops Edge Function
// Runs via pg_cron every 2 minutes
// Checks driver_locations for stationary drivers and creates/closes stops server-side

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

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

    // Get all in-progress trips with driver locations
    const { data: activeTrips } = await supabase
      .from('trips')
      .select('id, driver_id, designated_driver_id, second_driver_id')
      .eq('status', 'in_progress')

    if (!activeTrips || activeTrips.length === 0) {
      return new Response(
        JSON.stringify({ processed: 0, message: 'No active trips' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // Get all driver IDs from active trips
    const driverIds = [...new Set(
      activeTrips.flatMap(t => [t.driver_id, t.second_driver_id].filter(Boolean))
    )]

    // Get current locations
    const { data: locations } = await supabase
      .from('driver_locations')
      .select('driver_id, latitude, longitude, updated_at')
      .in('driver_id', driverIds)

    if (!locations || locations.length === 0) {
      return new Response(
        JSON.stringify({ processed: 0, message: 'No driver locations' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // Haversine distance in meters
    function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
      const R = 6371e3
      const dLat = (lat2 - lat1) * Math.PI / 180
      const dLon = (lon2 - lon1) * Math.PI / 180
      const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) ** 2
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    }

    // ─── DEALERSHIP PROXIMITY AUTO-END ─────────────────────────────────────────
    // Safety net: if a driver with an active trip is within 250m of the dealership,
    // auto-end their trip server-side. Backs up the client-side geofence which
    // can miss iOS enter events.
    const DEALERSHIP = { lat: 35.270366805900295, lon: -81.49624707303701, radius: 250 }
    const MIN_TRIP_MINUTES = 15
    let tripsAutoEnded = 0
    const autoEndedDriverIds: string[] = []

    for (const loc of locations) {
      const distToDealership = distanceMeters(
        Number(loc.latitude), Number(loc.longitude),
        DEALERSHIP.lat, DEALERSHIP.lon
      )

      if (distToDealership <= DEALERSHIP.radius) {
        // Driver is at the dealership — check if they have an active trip worth ending
        const trip = activeTrips.find(t =>
          t.driver_id === loc.driver_id || t.second_driver_id === loc.driver_id
        )
        if (!trip) continue

        // Check trip has been running long enough (avoid ending trips that just started at the lot)
        const { data: tripData } = await supabase
          .from('trips')
          .select('actual_start, status')
          .eq('id', trip.id)
          .single()

        if (!tripData || tripData.status !== 'in_progress') continue

        const tripDuration = (Date.now() - new Date(tripData.actual_start).getTime()) / 60000
        if (tripDuration < MIN_TRIP_MINUTES) continue

        // Dedup: check if we already auto-ended this trip recently
        const { data: recentEnd } = await supabase
          .from('system_logs')
          .select('id')
          .eq('event', 'server_auto_end')
          .gte('created_at', new Date(Date.now() - 10 * 60 * 1000).toISOString())
          .contains('metadata', { trip_id: trip.id })
          .limit(1)

        if (recentEnd && recentEnd.length > 0) continue

        // Auto-end the trip (don't overwrite miles/hours — client may have better data)
        await supabase.from('trips').update({
          status: 'completed',
          actual_end: new Date().toISOString(),
        }).eq('id', trip.id)

        // Close any open stops
        await supabase.from('trip_stops')
          .update({ ended_at: new Date().toISOString(), duration_minutes: 0 })
          .eq('trip_id', trip.id)
          .is('ended_at', null)

        // Clean up driver location
        await supabase.from('driver_locations').delete().eq('driver_id', loc.driver_id)

        // Log it
        await supabase.from('system_logs').insert({
          source: 'detect-stops',
          level: 'info',
          event: 'server_auto_end',
          message: `Server auto-ended trip for driver at dealership (${Math.round(distToDealership)}m away)`,
          metadata: { trip_id: trip.id, driver_id: loc.driver_id, distance: Math.round(distToDealership) },
        })

        // Send push notification to the driver
        const { data: driverProfile } = await supabase
          .from('profiles')
          .select('push_token')
          .eq('id', loc.driver_id)
          .single()

        if (driverProfile?.push_token?.startsWith('ExponentPushToken')) {
          const { data: tripInfo } = await supabase
            .from('trips')
            .select('city')
            .eq('id', trip.id)
            .single()

          await fetch('https://exp.host/--/api/v2/push/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              to: driverProfile.push_token,
              sound: 'default',
              title: '🏁 Trip Complete!',
              body: `Your trip to ${tripInfo?.city || 'destination'} has been ended automatically.`,
              data: { type: 'server_auto_end', trip_id: trip.id },
            }),
          })
        }

        // Notify admins
        await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/notify-trip-status`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
          },
          body: JSON.stringify({ trip_id: trip.id, driver_id: loc.driver_id, action: 'ended' }),
        })

        autoEndedDriverIds.push(loc.driver_id)
        tripsAutoEnded++
      }
    }

    // ─── STOP DETECTION ─────────────────────────────────────────────────────────
    let stopsCreated = 0
    let stopsClosed = 0

    for (const loc of locations) {
      // Skip drivers whose trips were just auto-ended above
      if (autoEndedDriverIds.includes(loc.driver_id)) continue

      const trip = activeTrips.find(t =>
        t.driver_id === loc.driver_id || t.second_driver_id === loc.driver_id
      )
      if (!trip) continue

      // Check for existing unclosed stop for this driver/trip
      const { data: openStops } = await supabase
        .from('trip_stops')
        .select('id, latitude, longitude, started_at')
        .eq('trip_id', trip.id)
        .eq('driver_id', loc.driver_id)
        .is('ended_at', null)
        .limit(1)

      const openStop = openStops && openStops.length > 0 ? openStops[0] : null

      // Check if location is stale (no update in 5+ minutes = probably not moving)
      const locAge = (Date.now() - new Date(loc.updated_at).getTime()) / 60000

      if (openStop) {
        // There's an open stop — check if driver has moved away from stop location
        const dist = distanceMeters(
          Number(openStop.latitude), Number(openStop.longitude),
          Number(loc.latitude), Number(loc.longitude)
        )

        if (dist > 100) {
          // Moved more than 100m from stop location — close the stop
          const stopDuration = Math.round(
            (Date.now() - new Date(openStop.started_at).getTime()) / 60000
          )
          await supabase.from('trip_stops').update({
            ended_at: new Date().toISOString(),
            duration_minutes: stopDuration,
          }).eq('id', openStop.id)

          // Geocode the stop location
          try {
            const geoRes = await fetch(
              `https://us1.locationiq.com/v1/reverse?key=pk.ad8425665c12e1b7f5d7827258d59077&lat=${openStop.latitude}&lon=${openStop.longitude}&format=json`
            )
            if (geoRes.ok) {
              const geoData = await geoRes.json()
              const city = geoData.address?.city || geoData.address?.town || geoData.address?.village || geoData.address?.county || ''
              const state = geoData.address?.state || ''
              const cityName = city && state ? `${city}, ${state}` : city || state || null
              if (cityName) {
                await supabase.from('trip_stops').update({ city: cityName }).eq('id', openStop.id)
              }
            }
          } catch {}

          stopsClosed++
        }
        // If still within 100m, stop stays open — nothing to do
      } else {
        // No open stop — check if driver has been stationary
        // We consider them stationary if their location hasn't updated significantly
        // and the last update was recent (meaning app is alive but not moving)
        if (locAge < 3) {
          // Location is fresh — check if they've been at roughly the same spot
          // Look at the location's updated_at vs trip start to avoid creating stops too early
          const tripStart = activeTrips.find(t => t.id === trip.id)

          // Check previous location by looking at a recent stop that was just closed
          // or use a simpler heuristic: if the driver hasn't moved in the last few checks,
          // we detect it by storing the previous location check

          // Simple approach: check if there are recent location entries that are close together
          // We'll use the driver_locations table which only has the latest position
          // So we need a different signal — use the trip_stops "last_check" approach

          // For now: if location is fresh (< 3 min old), check if we've seen this position before
          // by looking for recent closed stops nearby (within 100m, closed in last 2 min)
          // If found, they're bouncing — don't create a new stop

          // Simpler: just check if location hasn't changed much by storing a "last_position" cache
          // But we don't have that in this stateless function

          // Simplest reliable approach: use a separate table or just check based on time
          // If the driver's location timestamp is recent but they've been at the same spot
          // for 5+ minutes, we know from the absence of movement

          // Actually, the best approach: store the first-seen timestamp for the current position
          // We can do this by checking: is there a recent (< 10 min) closed stop at this same location?
          // If yes, they just moved slightly and came back — skip
          // If no, check if there's been no stop in the last 5+ minutes AND location is fresh

          // Let's keep it simple for now:
          // We'll create a stop if the driver has had a fresh location for 5+ consecutive minutes
          // without an existing stop. Since this cron runs every 2 minutes, after 3 consecutive
          // runs seeing the same driver at roughly the same spot, we create a stop.

          // To track "consecutive sightings", we'll use system_logs with a lightweight entry
          const { data: recentCheck } = await supabase
            .from('system_logs')
            .select('metadata')
            .eq('event', 'stop_check')
            .eq('source', 'detect-stops')
            .gte('created_at', new Date(Date.now() - 6 * 60 * 1000).toISOString())
            .contains('metadata', { driver_id: loc.driver_id })
            .order('created_at', { ascending: false })
            .limit(1)

          const prevCheck = recentCheck?.[0]?.metadata as any

          if (prevCheck) {
            const prevLat = prevCheck.latitude
            const prevLon = prevCheck.longitude
            const dist = distanceMeters(prevLat, prevLon, Number(loc.latitude), Number(loc.longitude))

            if (dist < 50) {
              // Same spot as last check — how many consecutive checks?
              const consecutiveCount = (prevCheck.consecutive || 1) + 1

              if (consecutiveCount >= 3) {
                // 3+ consecutive checks at same spot (6+ minutes) — create a stop
                const stopStartTime = new Date(Date.now() - consecutiveCount * 2 * 60000).toISOString()
                await supabase.from('trip_stops').insert({
                  trip_id: trip.id,
                  driver_id: loc.driver_id,
                  latitude: loc.latitude,
                  longitude: loc.longitude,
                  started_at: stopStartTime,
                })
                stopsCreated++

                // Clear the check chain
                await supabase.from('system_logs').insert({
                  source: 'detect-stops',
                  level: 'info',
                  event: 'stop_check',
                  message: `Stop created for driver`,
                  metadata: { driver_id: loc.driver_id, latitude: Number(loc.latitude), longitude: Number(loc.longitude), consecutive: 0 },
                })
              } else {
                // Still counting — log this check
                await supabase.from('system_logs').insert({
                  source: 'detect-stops',
                  level: 'info',
                  event: 'stop_check',
                  message: `Stationary check ${consecutiveCount}`,
                  metadata: { driver_id: loc.driver_id, latitude: Number(loc.latitude), longitude: Number(loc.longitude), consecutive: consecutiveCount },
                })
              }
            } else {
              // Moved — reset counter
              await supabase.from('system_logs').insert({
                source: 'detect-stops',
                level: 'info',
                event: 'stop_check',
                message: `Driver moving`,
                metadata: { driver_id: loc.driver_id, latitude: Number(loc.latitude), longitude: Number(loc.longitude), consecutive: 0 },
              })
            }
          } else {
            // First check for this driver — log position
            await supabase.from('system_logs').insert({
              source: 'detect-stops',
              level: 'info',
              event: 'stop_check',
              message: `First position check`,
              metadata: { driver_id: loc.driver_id, latitude: Number(loc.latitude), longitude: Number(loc.longitude), consecutive: 1 },
            })
          }
        }
      }
    }

    return new Response(
      JSON.stringify({ processed: locations.length, stops_created: stopsCreated, stops_closed: stopsClosed, trips_auto_ended: tripsAutoEnded }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
