// File: supabase/functions/notify-payroll-reminder/index.ts
// notify-payroll-reminder Edge Function
// Runs Tuesday at 8 PM ET (midnight UTC Wednesday) via pg_cron
// Reminds admins to finalize any outstanding trips before Wednesday payroll

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

    // Find all trips in 'completed' status (not yet finalized)
    const { data: unfinalizedTrips, error: tripsError } = await supabaseAdmin
      .from('trips')
      .select('id, city, crm_id, driver_id, actual_end')
      .eq('status', 'completed')
      .order('actual_end', { ascending: true });

    if (tripsError) {
      return new Response(
        JSON.stringify({ error: tripsError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    if (!unfinalizedTrips || unfinalizedTrips.length === 0) {
      return new Response(
        JSON.stringify({ success: true, sent: 0, message: 'All trips finalized' }),
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
    const count = unfinalizedTrips.length;
    const title = 'Payroll Reminder';
    const labels = unfinalizedTrips.slice(0, 3).map((t) => t.crm_id || t.city || 'Unknown').join(', ');
    const extra = count > 3 ? ` and ${count - 3} more` : '';
    const body = `${count} trip${count > 1 ? 's' : ''} still need finalization before tomorrow's payroll: ${labels}${extra}`;

    const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
    const notifications = pushTokens.map((pushToken) => ({
      to: pushToken,
      sound: 'default' as const,
      title,
      body,
      data: { type: 'payroll_reminder', trip_ids: unfinalizedTrips.map((t) => t.id) },
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
      event: 'payroll_reminder_sent',
      message: `Reminded admins about ${count} unfinalized trip(s)`,
      metadata: {
        trip_count: count,
        trip_ids: unfinalizedTrips.map((t) => t.id),
        recipients: pushTokens.length,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        unfinalized: count,
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
