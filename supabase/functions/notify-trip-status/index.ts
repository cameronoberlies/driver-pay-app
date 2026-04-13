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

    const { trip_id, driver_id, action } = await req.json();

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

    // Get all admin/caller push tokens
    const { data: admins, error: adminsError } = await supabaseAdmin
      .from('profiles')
      .select('id, push_token')
      .in('role', ['admin', 'manager', 'caller'])
      .not('push_token', 'is', null);

    if (adminsError || !admins || admins.length === 0) {
      return new Response(
        JSON.stringify({ success: true, sent: 0, message: 'No admin recipients' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const pushTokens = admins
      .map((a) => a.push_token)
      .filter((t): t is string => !!t && t.startsWith('ExponentPushToken'));

    if (pushTokens.length === 0) {
      return new Response(
        JSON.stringify({ success: true, sent: 0, message: 'No valid push tokens' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

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
