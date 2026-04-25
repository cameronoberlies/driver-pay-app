// File: supabase/functions/notify-capacity/index.ts
// notify-capacity Edge Function
// Deploy to: supabase/functions/notify-capacity/index.ts
//
// Triggered by pg_cron every minute.
// Checks capacity_notifications for unprocessed rows,
// sends Expo push to all admin + caller role users,
// marks rows as processed.

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
  // 1. Find unprocessed capacity notifications (no processed_at yet)
  const { data: notifications, error: notifError } = await supabase
    .from("capacity_notifications")
    .select("id, date, message")
    .is("processed_at", null)
    .order("sent_at", { ascending: true });

  if (notifError) {
    console.error("Error fetching notifications:", notifError);
    return new Response(JSON.stringify({ error: notifError.message }), { status: 500 });
  }

  if (!notifications || notifications.length === 0) {
    return new Response(JSON.stringify({ notified: 0 }), { status: 200 });
  }

  // 2. Get all admin + caller users who have a push token
  const { data: recipients, error: profilesError } = await supabase
    .from("profiles")
    .select("id, name, push_token, role")
    .in("role", ["admin", "manager", "caller"])
    .not("push_token", "is", null);

  if (profilesError) {
    console.error("Error fetching recipients:", profilesError);
    return new Response(JSON.stringify({ error: profilesError.message }), { status: 500 });
  }

  if (!recipients || recipients.length === 0) {
    console.log("No admin/caller recipients with push tokens found");
    return new Response(JSON.stringify({ notified: 0 }), { status: 200 });
  }

  let notified = 0;

  // 3. For each unprocessed notification, push to all recipients
  for (const notification of notifications) {
    const title = "📋 Capacity Update";
    const body = notification.message;

    for (const recipient of recipients) {
      if (recipient.push_token) {
        await sendPushNotification(recipient.push_token, title, body);
        notified++;
      }
    }

    // 4. Mark notification as processed so it doesn't fire again
    await supabase
      .from("capacity_notifications")
      .update({ processed_at: new Date().toISOString() })
      .eq("id", notification.id);
  }

  console.log(`Sent capacity notification to ${notified} recipients`);
  return new Response(JSON.stringify({ notified }), { status: 200 });
});