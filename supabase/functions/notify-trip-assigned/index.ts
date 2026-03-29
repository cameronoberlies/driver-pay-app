// notify-trip-assigned Edge Function
// Sends push notification to driver(s) when they are assigned a new trip
// Called with { trip_id, driver_ids: [id1, id2?], city, scheduled_pickup }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    );

    const { trip_id, driver_ids, city, scheduled_pickup } = await req.json();

    if (!trip_id || !driver_ids || !Array.isArray(driver_ids) || driver_ids.length === 0) {
      return new Response(
        JSON.stringify({ error: 'trip_id and driver_ids[] are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Get push tokens for the assigned drivers
    const { data: drivers, error: driversError } = await supabaseAdmin
      .from('profiles')
      .select('id, push_token')
      .in('id', driver_ids)
      .not('push_token', 'is', null);

    if (driversError || !drivers || drivers.length === 0) {
      return new Response(
        JSON.stringify({ success: true, sent: 0, message: 'No valid recipients' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const pushTokens = drivers
      .map((d) => d.push_token)
      .filter((t): t is string => !!t && t.startsWith('ExponentPushToken'));

    if (pushTokens.length === 0) {
      return new Response(
        JSON.stringify({ success: true, sent: 0, message: 'No valid push tokens' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Format pickup time
    let timeStr = '';
    if (scheduled_pickup) {
      const d = new Date(scheduled_pickup);
      timeStr = ` at ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })}`;
    }

    const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
    const notifications = pushTokens.map((pushToken) => ({
      to: pushToken,
      sound: 'default' as const,
      title: '🚗 New Trip Assigned',
      body: `${city || 'New trip'}${timeStr}`,
      data: { type: 'trip_assigned', trip_id },
    }));

    const pushResponse = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(notifications),
    });

    const pushResult = await pushResponse.json();

    return new Response(
      JSON.stringify({ success: true, sent: pushTokens.length, expo_response: pushResult }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
