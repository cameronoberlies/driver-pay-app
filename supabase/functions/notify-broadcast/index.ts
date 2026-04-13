// File: supabase/functions/notify-broadcast/index.ts
// notify-broadcast Edge Function
// Sends a push notification from admin to all drivers (or all users)
// Called directly from the app with { message, title?, target?, sender_id }

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

    const { message, title, target, sender_id } = await req.json();

    if (!message) {
      return new Response(JSON.stringify({ error: 'message is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!sender_id) {
      return new Response(JSON.stringify({ error: 'sender_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Look up sender to get name and verify admin role
    const { data: callerProfile } = await supabaseAdmin
      .from('profiles')
      .select('role, name')
      .eq('id', sender_id)
      .single();

    if (!callerProfile || !['admin', 'manager'].includes(callerProfile.role)) {
      return new Response(JSON.stringify({ error: 'Admin only' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Determine recipients
    const recipientTarget = target || 'drivers';
    let roleFilter: string[];
    if (recipientTarget === 'all') {
      roleFilter = ['driver', 'admin', 'manager', 'caller'];
    } else if (recipientTarget === 'admins') {
      roleFilter = ['admin', 'manager', 'caller'];
    } else {
      roleFilter = ['driver'];
    }

    const { data: recipients, error: recipientsError } = await supabaseAdmin
      .from('profiles')
      .select('id, push_token')
      .in('role', roleFilter)
      .not('push_token', 'is', null)
      .neq('id', sender_id);

    if (recipientsError) {
      return new Response(JSON.stringify({ error: recipientsError.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!recipients || recipients.length === 0) {
      return new Response(
        JSON.stringify({ success: true, sent: 0, message: 'No recipients with push tokens' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const pushTokens = recipients
      .map((r) => r.push_token)
      .filter((t): t is string => !!t && t.startsWith('ExponentPushToken'));

    if (pushTokens.length === 0) {
      return new Response(
        JSON.stringify({ success: true, sent: 0, message: 'No valid push tokens' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
    const notifications = pushTokens.map((pushToken) => ({
      to: pushToken,
      sound: 'default' as const,
      title: title || `📢 ${callerProfile.name}`,
      body: message.substring(0, 500),
      data: { type: 'broadcast' },
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
