// File: supabase/functions/flight-proxy/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const FLIGHT_API_URL = 'http://45.33.120.41:5000'

serve(async (req) => {
  // Get the path from the request
  const url = new URL(req.url)
  const path = url.pathname.replace('/flight-proxy', '')
  
  try {
    // Proxy the request to your Linode
    const response = await fetch(`${FLIGHT_API_URL}${path}`)
    const data = await response.json()
    
    return new Response(JSON.stringify(data), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})