import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const FLIGHT_API_URL = 'http://45.33.120.41:5000'

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

// ─── TOOL DEFINITIONS ────────────────────────────────────────────────────────

const tools = [
  // READ tools
  {
    name: 'get_active_drivers',
    description: 'Get all drivers currently on active trips with their live GPS location, trip details, miles driven, and elapsed time.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'get_todays_flights',
    description: 'Get all flights scheduled for today with status, passenger name, route, times, delays, and aircraft position.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'get_driver_history',
    description: 'Get trip history and stats for a specific driver.',
    input_schema: {
      type: 'object' as const,
      properties: {
        driver_name: { type: 'string', description: 'Driver name (partial match OK)' },
        days_back: { type: 'number', description: 'Days of history. Default 30.' },
      },
      required: ['driver_name'],
    },
  },
  {
    name: 'get_all_trips_today',
    description: 'Get all trips for today — pending, in progress, completed, and finalized.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'get_trip_stats',
    description: 'Get aggregate trip and cost statistics for a date range.',
    input_schema: {
      type: 'object' as const,
      properties: {
        days_back: { type: 'number', description: 'Days to include. Default 7.' },
      },
      required: [],
    },
  },
  {
    name: 'get_driver_list',
    description: 'Get a list of all drivers with their IDs. Use this to look up driver IDs before creating or editing trips.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },

  // ACTION tools — these return a confirmation, they don't execute immediately
  {
    name: 'propose_create_trip',
    description: 'Propose creating a new trip. Returns a confirmation for the user to approve. Use when the user asks to create, schedule, or set up a trip. Always look up driver IDs first with get_driver_list.',
    input_schema: {
      type: 'object' as const,
      properties: {
        trip_type: { type: 'string', description: 'fly, drive, aa, courier, or airport' },
        driver_name: { type: 'string', description: 'Primary driver name' },
        driver_id: { type: 'string', description: 'Primary driver UUID' },
        second_driver_name: { type: 'string', description: 'Second driver name (drive trips only)' },
        second_driver_id: { type: 'string', description: 'Second driver UUID (drive trips only)' },
        city: { type: 'string', description: 'Destination city' },
        scheduled_pickup: { type: 'string', description: 'ISO datetime for pickup' },
        crm_id: { type: 'string', description: 'CRM/Carpage ID (optional)' },
        notes: { type: 'string', description: 'Trip notes (optional)' },
      },
      required: ['trip_type', 'driver_id', 'city', 'scheduled_pickup'],
    },
  },
  {
    name: 'propose_edit_trip',
    description: 'Propose editing an existing trip. Look up the trip first with get_all_trips_today. Returns a confirmation.',
    input_schema: {
      type: 'object' as const,
      properties: {
        trip_id: { type: 'string', description: 'The trip UUID to edit' },
        changes: {
          type: 'object' as const,
          description: 'Fields to change: city, crm_id, notes, scheduled_pickup, driver_id, second_driver_id, trip_type',
        },
        summary: { type: 'string', description: 'Human-readable summary of what is being changed' },
      },
      required: ['trip_id', 'changes', 'summary'],
    },
  },
  {
    name: 'propose_delete_trip',
    description: 'Propose deleting a pending trip. Only pending trips can be deleted. Returns a confirmation.',
    input_schema: {
      type: 'object' as const,
      properties: {
        trip_id: { type: 'string', description: 'The trip UUID to delete' },
        summary: { type: 'string', description: 'Human-readable description of the trip being deleted' },
      },
      required: ['trip_id', 'summary'],
    },
  },
  {
    name: 'propose_end_trip',
    description: 'Propose ending an in-progress trip (admin force-end). Returns a confirmation.',
    input_schema: {
      type: 'object' as const,
      properties: {
        trip_id: { type: 'string', description: 'The trip UUID to end' },
        summary: { type: 'string', description: 'Human-readable description of the trip being ended' },
      },
      required: ['trip_id', 'summary'],
    },
  },
  {
    name: 'execute_action',
    description: 'Execute a previously proposed action after user confirmation. Only call this when the user explicitly confirms (says yes, confirm, do it, etc).',
    input_schema: {
      type: 'object' as const,
      properties: {
        action_type: { type: 'string', description: 'create_trip, edit_trip, delete_trip, or end_trip' },
        action_data: { type: 'object' as const, description: 'The full action payload from the proposal' },
      },
      required: ['action_type', 'action_data'],
    },
  },
]

const SYSTEM_PROMPT = `You are the AI assistant for Discovery Automotive's DriverPay system. You help the operations team track drivers, flights, trips, and costs.

Current time: ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'full', timeStyle: 'short' })} Eastern

Key context:
- The dealership is in Shelby, NC
- If a driver's location hasn't updated in over 30 minutes, mention tracking is stale. Keep it factual.
- NEVER give opinions, advice, warnings, or suggestions. Just report the data. No "keep an eye on it", no "you may want to check", no "heads up". Just facts.
- The dealership coordinates are 35.2704°N, 81.4962°W (Shelby, NC). When reporting driver locations, calculate approximate distance from the dealership. Report like "~120 miles out, about 2 hours" (estimate drive time at 60 mph). Always include distance when asked where a driver is.
- NEVER include raw coordinates (lat/lon) in responses — users don't care about numbers. Convert to a city/region name or landmark instead.
- Drivers do Drive trips (chase car to pick up vehicles), Fly trips (fly out, buy vehicle, drive back), AA trips (convoy to Auto Advantage sister dealership), and Courier trips (parts/paperwork runs)
- "Where is [name]" could mean a driver on a road trip OR a passenger on a flight — check both
- Times should be displayed in Eastern Time
- Dollar amounts should be formatted with $ and two decimals
- Driver names may be partial — match fuzzy (e.g. "Angel" matches "Angel Saucedo")
- If you don't have data for something, say so clearly

Response formatting rules:
- NEVER use markdown tables or raw coordinates. This is a chat bubble.
- NEVER use bold (**text**) or markdown formatting. Just plain text.
- Keep responses short and natural. Talk like a coworker giving a quick update, not a report.
- One driver per line when listing multiple.
- Example good response: "Hailey's near the VA/NC border, about 90 miles out. Should be back in an hour and a half. Her tracking went stale about 2 hours ago though."
- Example bad response: "Hailey Stevens is on a drive trip (GN054). Using coordinates (36.5008°N, 80.7424°W) vs dealership..."
- Don't repeat back the question. Don't say "let me check" or "here's what I found." Just answer.
- Don't end with "let me know if you need anything" or similar filler.

Action rules:
- When the user wants to create, edit, delete, or end a trip, use the propose_ tools first.
- ALWAYS look up driver IDs with get_driver_list before proposing a trip creation or edit.
- After proposing an action, present a clear summary and ask the user to confirm.
- Format the confirmation like: "[ACTION] Drive trip to Austin, TX — Angel Saucedo + Cameron (Test) — Apr 9, 5:00 PM ET — Confirm?"
- ONLY call execute_action when the user explicitly confirms (yes, confirm, do it, go ahead, etc).
- If the user says no, cancel, or nevermind, acknowledge and move on.
- If the user provides partial info for a trip (e.g. "create a trip for Angel"), ask for the missing pieces one at a time. Required fields by type:
  - Drive: driver 1, driver 2 (REQUIRED — always ask), city, pickup time
  - Fly: driver, city, pickup time. Then ask "Will there be an airport driver?" If yes, create a linked airport trip.
  - AA: drivers (multiple), city (usually "AA" for Auto Advantage), pickup time, stock numbers (optional)
  - Courier: driver, city/description, pickup time
- If only one driver is given for a drive trip, treat them as driver 1 and ask who driver 2 is.
- For scheduled_pickup, convert natural language to ISO datetime. "tomorrow at 5pm" = tomorrow's date at 17:00 Eastern (UTC-4). Today is ${new Date().toISOString().slice(0, 10)}.
- When creating an airport driver trip, set trip_type to "airport" and include parent_trip_id pointing to the fly trip.`

// ─── TOOL HANDLERS ───────────────────────────────────────────────────────────

async function handleTool(name: string, input: Record<string, unknown>): Promise<string> {
  switch (name) {
    case 'get_active_drivers': {
      const { data: trips } = await supabase
        .from('trips')
        .select('*, profiles!trips_driver_id_fkey(name)')
        .in('status', ['in_progress'])

      const { data: locations } = await supabase
        .from('driver_locations')
        .select('*')

      const { data: stops } = await supabase
        .from('trip_stops')
        .select('*')
        .is('ended_at', null)

      const drivers = (trips ?? []).map((t: any) => {
        const loc = (locations ?? []).find((l: any) => l.driver_id === t.driver_id)
        const stop = (stops ?? []).find((s: any) => s.driver_id === t.driver_id)
        const elapsed = t.actual_start
          ? Math.round((Date.now() - new Date(t.actual_start).getTime()) / 60000)
          : 0
        return {
          driver_name: t.profiles?.name ?? 'Unknown',
          trip_type: t.trip_type,
          city: t.city,
          crm_id: t.crm_id,
          trip_id: t.id,
          status: t.status,
          miles: t.miles ?? 0,
          elapsed_minutes: elapsed,
          started_at: t.actual_start,
          latitude: loc?.latitude,
          longitude: loc?.longitude,
          last_location_update: loc?.updated_at,
          is_stopped: !!stop,
          stop_started: stop?.started_at,
        }
      })
      return JSON.stringify(drivers)
    }

    case 'get_todays_flights': {
      try {
        const res = await fetch(`${FLIGHT_API_URL}/api/flights/today`)
        const flights = await res.json()
        return JSON.stringify(flights)
      } catch (e) {
        return JSON.stringify({ error: 'Flight monitor unreachable' })
      }
    }

    case 'get_driver_history': {
      const driverName = String(input.driver_name ?? '')
      const daysBack = Number(input.days_back ?? 30)
      const since = new Date(Date.now() - daysBack * 86400000).toISOString().slice(0, 10)

      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, name')
        .eq('role', 'driver')

      const driver = (profiles ?? []).find((p: any) =>
        p.name.toLowerCase().includes(driverName.toLowerCase())
      )
      if (!driver) return JSON.stringify({ error: `No driver found matching "${driverName}"` })

      const { data: entries } = await supabase
        .from('entries')
        .select('*')
        .eq('driver_id', driver.id)
        .gte('date', since)
        .order('date', { ascending: false })

      const { data: trips } = await supabase
        .from('trips')
        .select('*')
        .eq('driver_id', driver.id)
        .gte('created_at', since + 'T00:00:00')
        .order('created_at', { ascending: false })

      const totalPay = (entries ?? []).reduce((s: number, e: any) => s + Number(e.pay ?? 0), 0)
      const totalMiles = (entries ?? []).reduce((s: number, e: any) => s + Number(e.miles ?? 0), 0)
      const totalCost = (entries ?? []).reduce((s: number, e: any) => s + Number(e.actual_cost ?? 0), 0)

      return JSON.stringify({
        driver_name: driver.name,
        period: `Last ${daysBack} days`,
        total_trips: (entries ?? []).length,
        total_pay: totalPay,
        total_miles: totalMiles,
        total_cost: totalCost,
        avg_pay_per_trip: (entries ?? []).length > 0 ? Math.round(totalPay / (entries ?? []).length) : 0,
        trips_by_type: {
          drive: (trips ?? []).filter((t: any) => t.trip_type === 'drive').length,
          fly: (trips ?? []).filter((t: any) => t.trip_type === 'fly').length,
          aa: (trips ?? []).filter((t: any) => t.trip_type === 'aa').length,
          courier: (trips ?? []).filter((t: any) => t.trip_type === 'courier').length,
        },
        recent_entries: (entries ?? []).slice(0, 10).map((e: any) => ({
          date: e.date,
          city: e.city,
          pay: e.pay,
          miles: e.miles,
          trip_type: e.trip_type,
        })),
      })
    }

    case 'get_all_trips_today': {
      const today = new Date().toISOString().slice(0, 10)
      const { data: trips } = await supabase
        .from('trips')
        .select('*, profiles!trips_driver_id_fkey(name)')
        .gte('scheduled_pickup', today + 'T00:00:00')
        .lte('scheduled_pickup', today + 'T23:59:59')
        .order('scheduled_pickup', { ascending: true })

      const result = (trips ?? []).map((t: any) => ({
        trip_id: t.id,
        driver: t.profiles?.name ?? 'Unknown',
        driver_id: t.driver_id,
        trip_type: t.trip_type,
        city: t.city,
        crm_id: t.crm_id,
        status: t.status,
        scheduled_pickup: t.scheduled_pickup,
        actual_start: t.actual_start,
        actual_end: t.actual_end,
        miles: t.miles,
        stock_numbers: t.stock_numbers,
      }))
      return JSON.stringify(result)
    }

    case 'get_trip_stats': {
      const daysBack = Number(input.days_back ?? 7)
      const since = new Date(Date.now() - daysBack * 86400000).toISOString().slice(0, 10)

      const { data: entries } = await supabase
        .from('entries')
        .select('*')
        .gte('date', since)

      const all = entries ?? []
      const totalCost = all.reduce((s: number, e: any) => s + Number(e.actual_cost ?? 0), 0)
      const totalEstimated = all.reduce((s: number, e: any) => s + Number(e.estimated_cost ?? 0), 0)
      const totalMiles = all.reduce((s: number, e: any) => s + Number(e.miles ?? 0), 0)
      const totalPay = all.reduce((s: number, e: any) => s + Number(e.pay ?? 0), 0)

      return JSON.stringify({
        period: `Last ${daysBack} days`,
        total_trips: all.length,
        total_cost: totalCost,
        total_estimated: totalEstimated,
        cost_variance: totalCost - totalEstimated,
        total_miles: totalMiles,
        total_pay: totalPay,
        avg_cost_per_trip: all.length > 0 ? Math.round(totalCost / all.length) : 0,
        avg_miles_per_trip: all.length > 0 ? Math.round(totalMiles / all.length) : 0,
        trips_by_type: {
          drive: all.filter((e: any) => e.trip_type === 'drive').length,
          fly: all.filter((e: any) => e.trip_type === 'fly').length,
          aa: all.filter((e: any) => e.trip_type === 'aa').length,
          courier: all.filter((e: any) => e.trip_type === 'courier').length,
        },
      })
    }

    case 'get_driver_list': {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, name, role, willing_to_fly')
        .in('role', ['driver'])
        .order('name')

      return JSON.stringify((profiles ?? []).map((p: any) => ({
        id: p.id,
        name: p.name,
        willing_to_fly: p.willing_to_fly,
      })))
    }

    // ─── ACTION PROPOSALS (return confirmation, don't execute) ────────────

    case 'propose_create_trip': {
      return JSON.stringify({
        action: 'create_trip',
        pending: true,
        data: input,
      })
    }

    case 'propose_edit_trip': {
      return JSON.stringify({
        action: 'edit_trip',
        pending: true,
        trip_id: input.trip_id,
        changes: input.changes,
        summary: input.summary,
      })
    }

    case 'propose_delete_trip': {
      return JSON.stringify({
        action: 'delete_trip',
        pending: true,
        trip_id: input.trip_id,
        summary: input.summary,
      })
    }

    case 'propose_end_trip': {
      return JSON.stringify({
        action: 'end_trip',
        pending: true,
        trip_id: input.trip_id,
        summary: input.summary,
      })
    }

    // ─── EXECUTE CONFIRMED ACTIONS ───────────────────────────────────────

    case 'execute_action': {
      const actionType = String(input.action_type)
      const actionData = input.action_data as Record<string, any>

      switch (actionType) {
        case 'create_trip': {
          const payload: Record<string, any> = {
            driver_id: actionData.driver_id,
            designated_driver_id: actionData.driver_id,
            trip_type: actionData.trip_type,
            city: actionData.city,
            scheduled_pickup: actionData.scheduled_pickup,
            crm_id: actionData.crm_id || null,
            notes: actionData.notes || null,
            status: 'pending',
          }
          if (actionData.trip_type === 'drive' && actionData.second_driver_id) {
            payload.second_driver_id = actionData.second_driver_id
          }

          const { data: trip, error } = await supabase
            .from('trips')
            .insert(payload)
            .select()
            .single()

          if (error) return JSON.stringify({ success: false, error: error.message })
          return JSON.stringify({ success: true, trip_id: trip.id, message: 'Trip created' })
        }

        case 'edit_trip': {
          const changes = actionData.changes || actionData
          const tripId = actionData.trip_id

          const { error } = await supabase
            .from('trips')
            .update(changes)
            .eq('id', tripId)

          if (error) return JSON.stringify({ success: false, error: error.message })
          return JSON.stringify({ success: true, message: 'Trip updated' })
        }

        case 'delete_trip': {
          const tripId = actionData.trip_id

          // Only allow deleting pending trips
          const { data: trip } = await supabase
            .from('trips')
            .select('status')
            .eq('id', tripId)
            .single()

          if (trip?.status !== 'pending') {
            return JSON.stringify({ success: false, error: 'Only pending trips can be deleted' })
          }

          const { error } = await supabase
            .from('trips')
            .delete()
            .eq('id', tripId)

          if (error) return JSON.stringify({ success: false, error: error.message })
          return JSON.stringify({ success: true, message: 'Trip deleted' })
        }

        case 'end_trip': {
          const tripId = actionData.trip_id

          const { data: trip } = await supabase
            .from('trips')
            .select('status, driver_id, second_driver_id')
            .eq('id', tripId)
            .single()

          if (trip?.status !== 'in_progress') {
            return JSON.stringify({ success: false, error: 'Only in-progress trips can be ended' })
          }

          const { error } = await supabase
            .from('trips')
            .update({ status: 'completed', actual_end: new Date().toISOString() })
            .eq('id', tripId)

          if (error) return JSON.stringify({ success: false, error: error.message })

          // Clean up driver locations
          await supabase.from('driver_locations').delete().eq('driver_id', trip.driver_id)
          if (trip.second_driver_id) {
            await supabase.from('driver_locations').delete().eq('driver_id', trip.second_driver_id)
          }
          // Close unclosed stops
          await supabase.from('trip_stops')
            .update({ ended_at: new Date().toISOString(), duration_minutes: 0 })
            .eq('trip_id', tripId)
            .is('ended_at', null)

          return JSON.stringify({ success: true, message: 'Trip ended' })
        }

        default:
          return JSON.stringify({ success: false, error: `Unknown action: ${actionType}` })
      }
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` })
  }
}

// ─── MAIN HANDLER ────────────────────────────────────────────────────────────

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
    const { message, history } = await req.json()

    if (!message) {
      return new Response(JSON.stringify({ error: 'Message is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      })
    }

    const messages: Array<{ role: string; content: any }> = []

    if (history && Array.isArray(history)) {
      for (const h of history) {
        messages.push(h)
      }
    }

    messages.push({ role: 'user', content: message })

    let response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        tools,
        messages,
      }),
    })

    let result = await response.json()
    console.log('Claude API response:', JSON.stringify(result).slice(0, 500))

    if (result.error) {
      return new Response(JSON.stringify({ reply: `API Error: ${result.error.message || JSON.stringify(result.error)}` }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      })
    }

    while (result.stop_reason === 'tool_use') {
      const toolUseBlocks = result.content.filter((b: any) => b.type === 'tool_use')
      const toolResults = []

      for (const block of toolUseBlocks) {
        const toolResult = await handleTool(block.name, block.input)
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: toolResult,
        })
      }

      messages.push({ role: 'assistant', content: result.content })
      messages.push({ role: 'user', content: toolResults })

      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY!,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 1024,
          system: SYSTEM_PROMPT,
          tools,
          messages,
        }),
      })

      result = await response.json()
    }

    const textBlock = result.content?.find((b: any) => b.type === 'text')
    const reply = textBlock?.text ?? 'No response generated.'

    return new Response(JSON.stringify({ reply }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })

  } catch (error) {
    console.error('AI Chat error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  }
})
