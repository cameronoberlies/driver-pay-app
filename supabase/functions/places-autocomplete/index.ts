import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const GOOGLE_PLACES_KEY = 'AIzaSyBaWNi6dKRpz0BqwxkdA8Tk-MATwcHtTRE'

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
      },
    })
  }

  try {
    const url = new URL(req.url)
    const input = url.searchParams.get('input')

    if (!input || input.length < 3) {
      return new Response(JSON.stringify({ predictions: [] }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      })
    }

    const res = await fetch(
      `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(input)}&types=address&components=country:us&key=${GOOGLE_PLACES_KEY}`
    )
    const data = await res.json()

    const predictions = (data.predictions || []).map((p: any) => ({
      description: p.description,
      place_id: p.place_id,
    }))

    return new Response(JSON.stringify({ predictions }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message, predictions: [] }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  }
})
