// File: supabase/functions/wake-stale-drivers/index.ts
// wake-stale-drivers Edge Function
// Runs every 10 minutes via pg_cron
// Sends silent push notifications to drivers with active trips whose location is stale (10+ min)
// iOS will wake the app for ~30 seconds, allowing the background task to push a location update

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

    // Get all in_progress trips with their designated driver
    const { data: activeTrips, error: tripsError } = await supabaseAdmin
      .from('trips')
      .select('id, city, designated_driver_id')
      .eq('status', 'in_progress');

    if (tripsError || !activeTrips || activeTrips.length === 0) {
      return new Response(
        JSON.stringify({ success: true, woken: 0, message: 'No active trips' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const driverIds = [...new Set(activeTrips.map((t) => t.designated_driver_id).filter(Boolean))];

    // Get driver locations to check staleness
    const { data: locations } = await supabaseAdmin
      .from('driver_locations')
      .select('driver_id, updated_at')
      .in('driver_id', driverIds);

    const locationMap: Record<string, string> = {};
    (locations || []).forEach((l) => {
      locationMap[l.driver_id] = l.updated_at;
    });

    // Find stale drivers (no location or location older than 10 minutes)
    const now = Date.now();
    const STALE_THRESHOLD = 10 * 60 * 1000; // 10 minutes

    const staleDriverIds = driverIds.filter((id) => {
      const lastUpdate = locationMap[id];
      if (!lastUpdate) return true; // No location at all
      return (now - new Date(lastUpdate).getTime()) > STALE_THRESHOLD;
    });

    if (staleDriverIds.length === 0) {
      return new Response(
        JSON.stringify({ success: true, woken: 0, message: 'All drivers are fresh' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Get push tokens for stale drivers
    const { data: profiles } = await supabaseAdmin
      .from('profiles')
      .select('id, name, push_token')
      .in('id', staleDriverIds)
      .not('push_token', 'is', null);

    const pushTokens = (profiles || [])
      .filter((p) => p.push_token?.startsWith('ExponentPushToken'))
      .map((p) => ({
        token: p.push_token!,
        name: p.name,
        id: p.id,
      }));

    if (pushTokens.length === 0) {
      return new Response(
        JSON.stringify({ success: true, woken: 0, message: 'No push tokens for stale drivers' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Send silent push notifications
    const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
    const notifications = pushTokens.map((p) => ({
      to: p.token,
      // Silent push: no title, body, or sound — just data
      data: { type: 'wake_location', silent: true },
      priority: 'high',
      // iOS content-available flag for silent push
      _contentAvailable: true,
    }));

    const pushResponse = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(notifications),
    });

    const pushResult = await pushResponse.json();

    // Log to system_logs
    await supabaseAdmin.from('system_logs').insert({
      source: 'edge_function',
      level: 'info',
      event: 'wake_stale_drivers',
      message: `Sent silent push to ${pushTokens.length} stale driver(s): ${pushTokens.map((p) => p.name).join(', ')}`,
      metadata: {
        stale_driver_ids: staleDriverIds,
        push_sent: pushTokens.length,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        woken: pushTokens.length,
        drivers: pushTokens.map((p) => p.name),
        expo_response: pushResult,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
