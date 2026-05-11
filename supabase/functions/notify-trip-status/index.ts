// File: supabase/functions/notify-trip-status/index.ts
// notify-trip-status Edge Function
// Sends push notification to all admins when a driver starts or ends a trip
// Called from the driver's MyTripsScreen with { trip_id, driver_id, action: 'started' | 'ended' }

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

    const { trip_id, driver_id, action, metadata: actionMetadata } = await req.json();

    if (!trip_id || !driver_id || !action) {
      return new Response(
        JSON.stringify({ error: 'trip_id, driver_id, and action are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Get driver name
    const { data: driver } = await supabaseAdmin
      .from('profiles')
      .select('name')
      .eq('id', driver_id)
      .single();

    // Get trip details
    const { data: trip } = await supabaseAdmin
      .from('trips')
      .select('city, crm_id, trip_type')
      .eq('id', trip_id)
      .single();

    if (!driver || !trip) {
      return new Response(
        JSON.stringify({ error: 'Driver or trip not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // For 'reopened' action, target the designated driver instead of admins.
    // Other actions notify admins only.
    let recipients: any[] | null = null;
    let recipientsError: any = null;

    if (action === 'reopened') {
      // Get the designated driver's push token
      const { data: tripFull } = await supabaseAdmin
        .from('trips')
        .select('designated_driver_id, driver_id')
        .eq('id', trip_id)
        .single();
      const targetDriverId = tripFull?.designated_driver_id || tripFull?.driver_id;
      if (!targetDriverId) {
        return new Response(
          JSON.stringify({ success: true, sent: 0, message: 'No designated driver' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
      const result = await supabaseAdmin
        .from('profiles')
        .select('id, push_token')
        .eq('id', targetDriverId)
        .not('push_token', 'is', null);
      recipients = result.data;
      recipientsError = result.error;
    } else {
      const result = await supabaseAdmin
        .from('profiles')
        .select('id, push_token')
        .in('role', ['admin', 'manager', 'caller'])
        .not('push_token', 'is', null);
      recipients = result.data;
      recipientsError = result.error;
    }

    if (recipientsError || !recipients || recipients.length === 0) {
      return new Response(
        JSON.stringify({ success: true, sent: 0, message: 'No recipients' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const pushTokens = recipients
      .map((a) => a.push_token)
      .filter((t): t is string => !!t && t.startsWith('ExponentPushToken'));

    if (pushTokens.length === 0) {
      return new Response(
        JSON.stringify({ success: true, sent: 0, message: 'No valid push tokens' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Dedup: skip if same trip+action was notified in the last 5 minutes
    const { data: recentNotif } = await supabaseAdmin
      .from('system_logs')
      .select('id')
      .eq('event', `notify_trip_${action}`)
      .eq('source', 'edge_function')
      .gte('created_at', new Date(Date.now() - 5 * 60 * 1000).toISOString())
      .contains('metadata', { trip_id })
      .limit(1);

    if (recentNotif && recentNotif.length > 0) {
      return new Response(
        JSON.stringify({ success: true, sent: 0, message: 'Duplicate suppressed' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Log this notification for dedup
    await supabaseAdmin.from('system_logs').insert({
      source: 'edge_function',
      level: 'info',
      event: `notify_trip_${action}`,
      message: `Trip ${action} notification for ${trip_id}`,
      metadata: { trip_id, driver_id },
    });

    const tripType = trip.trip_type === 'fly' ? 'flight' : 'drive';
    let title: string;
    let body: string;

    switch (action) {
      case 'started':
        title = '🟢 Trip Started';
        body = `${driver.name} started their ${tripType} trip to ${trip.city}`;
        break;
      case 'ended':
        title = '🏁 Trip Ended';
        body = `${driver.name} ended their ${tripType} trip to ${trip.city}`;
        break;
      case 'paused':
        title = '⏸ Trip Paused';
        body = `${driver.name} paused their ${tripType} trip to ${trip.city}`;
        break;
      case 'resumed':
        title = '▶ Trip Resumed';
        body = `${driver.name} resumed their ${tripType} trip to ${trip.city}`;
        break;
      case 'reopened':
        title = '🔄 Trip Reopened';
        body = `Your trip to ${trip.city} has been reopened. Open the app to resume tracking.`;
        break;
      case 'dtc_detected': {
        const codes = (actionMetadata?.codes && Array.isArray(actionMetadata.codes))
          ? actionMetadata.codes.join(', ')
          : 'unknown';
        title = '⚠ Engine Code Detected';
        body = `${driver.name}'s vehicle reported engine code(s): ${codes} on trip to ${trip.city}`;
        break;
      }
      default:
        title = 'Trip Update';
        body = `${driver.name}'s trip to ${trip.city} was updated`;
    }

    const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
    const notifications = pushTokens.map((pushToken) => ({
      to: pushToken,
      sound: 'default' as const,
      title,
      body,
      data: { type: 'trip_status', trip_id, action },
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
