import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
    })
  }

  try {
    // Get all driver profiles with push tokens
    const { data: drivers } = await supabase
      .from('profiles')
      .select('id, name, push_token')
      .eq('role', 'driver')
      .not('push_token', 'is', null)

    if (!drivers || drivers.length === 0) {
      return new Response(JSON.stringify({ sent: 0, message: 'No drivers with push tokens' }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      })
    }

    // Send silent push with check_for_update flag to each driver
    const tokens = drivers.map(d => d.push_token).filter(Boolean)
    const names = drivers.map(d => d.name)

    // Expo push API — batch send
    const messages = tokens.map(token => ({
      to: token,
      sound: null,
      priority: 'high',
      data: { type: 'check_for_update', silent: true },
      _contentAvailable: true,
    }))

    // Send in batches of 100 (Expo limit)
    let totalSent = 0
    for (let i = 0; i < messages.length; i += 100) {
      const batch = messages.slice(i, i + 100)
      const res = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(batch),
      })
      if (res.ok) totalSent += batch.length
    }

    // Log it
    await supabase.from('system_logs').insert({
      source: 'edge_function',
      level: 'info',
      event: 'push_ota_update',
      message: `Sent OTA update push to ${totalSent} driver(s): ${names.join(', ')}`,
      metadata: { sent: totalSent, driver_count: drivers.length },
    })

    return new Response(JSON.stringify({ sent: totalSent, drivers: names }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  }
})
