// File: supabase/functions/notify-stale-trips/index.ts
// notify-stale-trips Edge Function
// Runs daily at 2 PM ET via pg_cron
// Sends push notification to admins for trips stuck in "completed" status for 18+ hours

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

    // Find trips completed 18+ hours ago that haven't been finalized
    const cutoff = new Date(Date.now() - 18 * 60 * 60 * 1000).toISOString();

    const { data: staleTrips, error: tripsError } = await supabaseAdmin
      .from('trips')
      .select('id, city, crm_id, actual_end, driver_id')
      .eq('status', 'completed')
      .lt('actual_end', cutoff)
      .order('actual_end', { ascending: true });

    if (tripsError) {
      return new Response(
        JSON.stringify({ error: tripsError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    if (!staleTrips || staleTrips.length === 0) {
      return new Response(
        JSON.stringify({ success: true, sent: 0, message: 'No stale trips' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Dedup: skip if we already notified about stale trips in the last 24 hours
    const { data: recentNotif } = await supabaseAdmin
      .from('system_logs')
      .select('id')
      .eq('event', 'stale_trips_notified')
      .eq('source', 'edge_function')
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .limit(1);

    if (recentNotif && recentNotif.length > 0) {
      return new Response(
        JSON.stringify({ success: true, sent: 0, message: 'Already notified in last 24h' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Get admin push tokens
    const { data: admins } = await supabaseAdmin
      .from('profiles')
      .select('id, push_token')
      .in('role', ['admin', 'manager', 'caller'])
      .not('push_token', 'is', null);

    const pushTokens = (admins || [])
      .map((a) => a.push_token)
      .filter((t): t is string => !!t && t.startsWith('ExponentPushToken'));

    if (pushTokens.length === 0) {
      return new Response(
        JSON.stringify({ success: true, sent: 0, message: 'No admin push tokens' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Build notification
    let title: string;
    let body: string;

    if (staleTrips.length === 1) {
      const trip = staleTrips[0];
      const label = trip.crm_id || trip.city;
      title = 'Trip Awaiting Finalization';
      body = `Trip ${label} has been completed for 18+ hours and needs to be finalized.`;
    } else {
      title = `${staleTrips.length} Trips Awaiting Finalization`;
      const labels = staleTrips.slice(0, 3).map((t) => t.crm_id || t.city).join(', ');
      const extra = staleTrips.length > 3 ? ` and ${staleTrips.length - 3} more` : '';
      body = `${labels}${extra} — completed 18+ hours ago.`;
    }

    const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
    const notifications = pushTokens.map((pushToken) => ({
      to: pushToken,
      sound: 'default' as const,
      title,
      body,
      data: { type: 'stale_trips', trip_ids: staleTrips.map((t) => t.id) },
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
      event: 'stale_trips_notified',
      message: `Notified admins about ${staleTrips.length} stale trip(s)`,
      metadata: {
        trip_ids: staleTrips.map((t) => t.id),
        recipients: pushTokens.length,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        stale_trips: staleTrips.length,
        sent: pushTokens.length,
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
