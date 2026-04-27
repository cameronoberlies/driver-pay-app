// detect-stops Edge Function
// Runs via pg_cron every 2 minutes
// Checks driver_locations for stationary drivers and creates/closes stops server-side
// Uses driver_stop_state table for persistent state (not logs)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const DEALERSHIP = { lat: 35.270366805900295, lon: -81.49624707303701, radius: 250 }
const MIN_TRIP_MINUTES = 15
const STOP_THRESHOLD_METERS = 50    // within 50m = stationary
const MOVE_THRESHOLD_METERS = 100   // moved 100m+ from stop = driving again
const STOP_TIME_MINUTES = 5         // stationary 5+ min = create stop
const STALE_LOCATION_MINUTES = 15   // ignore locations older than 15 min

function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
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

    // ─── BATCH PRELOAD ────────────────────────────────────────────────────────
    const { data: activeTrips } = await supabase
      .from('trips')
      .select('id, driver_id, designated_driver_id, second_driver_id, actual_start')
      .eq('status', 'in_progress')

    if (!activeTrips || activeTrips.length === 0) {
      return new Response(
        JSON.stringify({ processed: 0, message: 'No active trips' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const driverIds = [...new Set(
      activeTrips.flatMap(t => [t.driver_id, t.second_driver_id].filter(Boolean))
    )]

    // Batch: locations, open stops, stop state, and push tokens — all at once
    const [
      { data: locations },
      { data: allOpenStops },
      { data: allStopStates },
    ] = await Promise.all([
      supabase.from('driver_locations').select('driver_id, latitude, longitude, updated_at, obd_speed').in('driver_id', driverIds),
      supabase.from('trip_stops').select('id, trip_id, driver_id, latitude, longitude, started_at').is('ended_at', null),
      supabase.from('driver_stop_state').select('*').in('driver_id', driverIds),
    ])

    if (!locations || locations.length === 0) {
      return new Response(
        JSON.stringify({ processed: 0, message: 'No driver locations' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // Index for fast lookup
    const openStopsByDriver = new Map<string, any>()
    for (const s of (allOpenStops || [])) {
      openStopsByDriver.set(`${s.driver_id}:${s.trip_id}`, s)
    }
    const stopStateByDriver = new Map<string, any>()
    for (const s of (allStopStates || [])) {
      stopStateByDriver.set(s.driver_id, s)
    }

    // ─── DEALERSHIP PROXIMITY AUTO-END ─────────────────────────────────────────
    let tripsAutoEnded = 0
    const autoEndedDriverIds: string[] = []

    for (const loc of locations) {
      const distToDealership = distanceMeters(
        Number(loc.latitude), Number(loc.longitude),
        DEALERSHIP.lat, DEALERSHIP.lon
      )

      if (distToDealership <= DEALERSHIP.radius) {
        const trip = activeTrips.find(t =>
          t.driver_id === loc.driver_id || t.second_driver_id === loc.driver_id
        )
        if (!trip) continue

        const tripDuration = (Date.now() - new Date(trip.actual_start).getTime()) / 60000
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

        // Auto-end the trip
        await supabase.from('trips').update({
          status: 'completed',
          actual_end: new Date().toISOString(),
        }).eq('id', trip.id)

        // Close any open stops
        await supabase.from('trip_stops')
          .update({ ended_at: new Date().toISOString(), duration_minutes: 0 })
          .eq('trip_id', trip.id)
          .is('ended_at', null)

        // Clean up state
        await supabase.from('driver_stop_state').delete().eq('driver_id', loc.driver_id)
        await supabase.from('driver_locations').delete().eq('driver_id', loc.driver_id)

        // Log it
        await supabase.from('system_logs').insert({
          source: 'detect-stops',
          level: 'info',
          event: 'server_auto_end',
          message: `Server auto-ended trip for driver at dealership (${Math.round(distToDealership)}m away)`,
          metadata: { trip_id: trip.id, driver_id: loc.driver_id, distance: Math.round(distToDealership) },
        })

        // Send push notification
        const { data: driverProfile } = await supabase
          .from('profiles')
          .select('push_token')
          .eq('id', loc.driver_id)
          .single()

        if (driverProfile?.push_token?.startsWith('ExponentPushToken')) {
          const tripInfo = activeTrips.find(t => t.id === trip.id)
          await fetch('https://exp.host/--/api/v2/push/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              to: driverProfile.push_token,
              sound: 'default',
              title: 'Trip Complete!',
              body: `Your trip has been ended automatically.`,
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
      if (autoEndedDriverIds.includes(loc.driver_id)) continue

      const trip = activeTrips.find(t =>
        t.driver_id === loc.driver_id || t.second_driver_id === loc.driver_id
      )
      if (!trip) continue

      const locAge = (Date.now() - new Date(loc.updated_at).getTime()) / 60000
      const lat = Number(loc.latitude)
      const lon = Number(loc.longitude)
      const openStop = openStopsByDriver.get(`${loc.driver_id}:${trip.id}`) || null
      const state = stopStateByDriver.get(loc.driver_id) || null

      if (openStop) {
        // ── OPEN STOP: check if driver moved away or went stale ────────────

        // If location is stale (15+ min), auto-close the stop — we lost tracking
        if (locAge > STALE_LOCATION_MINUTES) {
          const endTime = new Date(loc.updated_at).getTime()
          const startTime = new Date(openStop.started_at).getTime()
          await supabase.from('trip_stops').update({
            ended_at: new Date(loc.updated_at).toISOString(),
            duration_minutes: Math.max(0, Math.round((endTime - startTime) / 60000)),
          }).eq('id', openStop.id)
          stopsClosed++
          continue
        }

        const dist = distanceMeters(
          Number(openStop.latitude), Number(openStop.longitude), lat, lon
        )

        if (dist > MOVE_THRESHOLD_METERS) {
          const stopDuration = Math.max(0, Math.round(
            (Date.now() - new Date(openStop.started_at).getTime()) / 60000
          ))
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
              const stateStr = geoData.address?.state || ''
              const cityName = city && stateStr ? `${city}, ${stateStr}` : city || stateStr || null
              if (cityName) {
                await supabase.from('trip_stops').update({ city: cityName }).eq('id', openStop.id)
              }
            }
          } catch {}

          // Reset stop state — driver is moving
          await supabase.from('driver_stop_state').upsert({
            driver_id: loc.driver_id,
            last_lat: lat,
            last_lon: lon,
            stationary_since: null,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'driver_id' })

          stopsClosed++
        }
        // If still within threshold, stop stays open — nothing to do

      } else {
        // ── NO OPEN STOP: check if driver is stationary ────────────────────
        // Skip stale locations — can't trust GPS from 15+ min ago for new stops
        if (locAge > STALE_LOCATION_MINUTES) continue

        // OBD-based stationary detection (most reliable when available)
        // If OBD reports speed = 0, the vehicle is definitively not moving
        // regardless of GPS drift from driver walking around with phone
        const hasObdSpeed = (loc as any).obd_speed != null
        const obdStationary = hasObdSpeed && (loc as any).obd_speed === 0

        if (state) {
          const dist = distanceMeters(state.last_lat, state.last_lon, lat, lon)
          // GPS-stationary OR OBD-stationary (vehicle not moving)
          const isStationary = dist < STOP_THRESHOLD_METERS || obdStationary

          if (isStationary) {
            // Still in same spot — check if stationary long enough
            const stationarySince = state.stationary_since
              ? new Date(state.stationary_since)
              : new Date() // first time seeing them here

            const stationaryMinutes = (Date.now() - stationarySince.getTime()) / 60000

            if (!state.stationary_since) {
              // Mark when they first became stationary
              await supabase.from('driver_stop_state').upsert({
                driver_id: loc.driver_id,
                last_lat: lat,
                last_lon: lon,
                stationary_since: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              }, { onConflict: 'driver_id' })
            } else if (stationaryMinutes >= STOP_TIME_MINUTES) {
              // Stationary long enough — create a stop
              await supabase.from('trip_stops').insert({
                trip_id: trip.id,
                driver_id: loc.driver_id,
                latitude: lat,
                longitude: lon,
                started_at: stationarySince.toISOString(),
              })
              stopsCreated++

              // Update state timestamp
              await supabase.from('driver_stop_state').upsert({
                driver_id: loc.driver_id,
                last_lat: lat,
                last_lon: lon,
                stationary_since: stationarySince.toISOString(),
                updated_at: new Date().toISOString(),
              }, { onConflict: 'driver_id' })
            }
            // else: stationary but not long enough yet — wait for next check

          } else {
            // Moved — reset stationary timer
            await supabase.from('driver_stop_state').upsert({
              driver_id: loc.driver_id,
              last_lat: lat,
              last_lon: lon,
              stationary_since: null,
              updated_at: new Date().toISOString(),
            }, { onConflict: 'driver_id' })
          }

        } else {
          // First time seeing this driver — store their position
          await supabase.from('driver_stop_state').upsert({
            driver_id: loc.driver_id,
            last_lat: lat,
            last_lon: lon,
            stationary_since: null,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'driver_id' })
        }
      }
    }

    // Clean up stop state for drivers who no longer have active trips
    const activeDriverSet = new Set(driverIds)
    for (const s of (allStopStates || [])) {
      if (!activeDriverSet.has(s.driver_id)) {
        await supabase.from('driver_stop_state').delete().eq('driver_id', s.driver_id)
      }
    }

    return new Response(
      JSON.stringify({
        processed: locations.length,
        stops_created: stopsCreated,
        stops_closed: stopsClosed,
        trips_auto_ended: tripsAutoEnded,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
