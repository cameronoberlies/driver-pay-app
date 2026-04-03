// File: supabase/functions/notify-availability-reminder/index.ts
// notify-availability-reminder Edge Function
// Sends a push notification to all drivers reminding them to submit their availability
// Triggered by pg_cron every Saturday at noon ET

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

Deno.serve(async () => {
  try {
    // Get all drivers with push tokens
    const { data: drivers, error } = await supabase
      .from('profiles')
      .select('id, name, push_token')
      .eq('role', 'driver')
      .not('push_token', 'is', null);

    if (error) {
      console.error('Error fetching drivers:', error);
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }

    if (!drivers || drivers.length === 0) {
      return new Response(JSON.stringify({ notified: 0 }), { status: 200 });
    }

    const pushTokens = drivers
      .map((d) => d.push_token)
      .filter((t): t is string => !!t && t.startsWith('ExponentPushToken'));

    if (pushTokens.length === 0) {
      return new Response(JSON.stringify({ notified: 0 }), { status: 200 });
    }

    const notifications = pushTokens.map((token) => ({
      to: token,
      sound: 'default' as const,
      title: '📋 Availability Reminder',
      body: 'Please submit your availability for next week.',
      data: { type: 'availability_reminder' },
    }));

    const pushResponse = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(notifications),
    });

    const pushResult = await pushResponse.json();
    console.log(`Sent availability reminder to ${pushTokens.length} drivers`);

    return new Response(
      JSON.stringify({ notified: pushTokens.length, expo_response: pushResult }),
      { status: 200 },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500 },
    );
  }
});
