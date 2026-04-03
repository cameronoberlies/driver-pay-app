// File: supabase/functions/notify-drivers/index.ts
// UPDATED: notify-drivers Edge Function
// Deploy to: supabase/functions/notify-drivers/index.ts
// This version ONLY sends 30-min reminders for FLY trips (not DRIVE trips)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

async function sendPushNotification(token: string, title: string, body: string) {
  if (!token.startsWith("ExponentPushToken")) return;
  const res = await fetch(EXPO_PUSH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to: token, title, body, sound: "default" }),
  });
  const result = await res.json();
  console.log("Expo push result:", JSON.stringify(result));
}

Deno.serve(async () => {
  const now = new Date();
  const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);
  const sixtyMinutesAgo = new Date(now.getTime() - 60 * 60 * 1000);

  // Find FLY trips where pickup was 30-35 minutes ago, still pending, not yet notified
  // CHANGED: Added .eq("trip_type", "fly") filter
  const { data: trips, error } = await supabase
    .from("trips")
    .select(
      `
      id, city, crm_id, trip_type, scheduled_pickup,
      driver_id, second_driver_id,
      driver:profiles!trips_driver_id_fkey(push_token),
      second_driver:profiles!trips_second_driver_id_fkey(push_token)
    `,
    )
    .eq("status", "pending")
    .eq("trip_type", "fly")  // ← NEW: ONLY FLY TRIPS
    .is("notified_at", null)
    .gte("scheduled_pickup", sixtyMinutesAgo.toISOString())
    .lte("scheduled_pickup", thirtyMinutesAgo.toISOString());

  if (error) {
    console.error("Error fetching trips:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
    });
  }

  if (!trips || trips.length === 0) {
    return new Response(JSON.stringify({ notified: 0 }), { status: 200 });
  }

  let notified = 0;

  for (const trip of trips) {
    // CHANGED: Updated message to be flight-specific
    const title = "Flight Trip Reminder";
    const body = `Your flight to ${trip.city} was scheduled 30 minutes ago. Ready to start your trip?`;

    // Notify primary driver
    const driverToken = (trip.driver as any)?.push_token;
    if (driverToken) {
      await sendPushNotification(driverToken, title, body);
      notified++;
    }

    // REMOVED: Second driver notification (flights only have one driver)
    // Drive trips with second drivers won't get notified anymore (they use geofence instead)

    // Mark as notified
    await supabase
      .from("trips")
      .update({ notified_at: now.toISOString() })
      .eq("id", trip.id);
  }

  return new Response(JSON.stringify({ notified }), { status: 200 });
});