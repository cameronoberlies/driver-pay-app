import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    )

    const body = await req.json()
    const { 
      action, 
      email, 
      password, 
      name, 
      role, 
      userId, 
      willing_to_fly,
      can_drive_manual,
      // Driver-specific fields (optional, only for drivers)
      phone_number,
      date_of_birth,
      drivers_license_number,
      drivers_license_photo_url
    } = body

    if (action === 'create') {
      // Validate required fields for all users
      if (!email || !password || !name || !role) {
        return new Response(
          JSON.stringify({ error: 'Missing required fields: email, password, name, role' }), 
          {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          }
        )
      }

      // Create auth user
      const { data: newUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      })

      if (authError) throw authError

      // Build profile data - start with common fields
      const profileData: any = {
        id: newUser.user.id,
        name,
        email,
        role,
      }

      // If creating a driver, add driver-specific fields
      // For admin users, these fields will be NULL (allowed by schema)
      if (role === 'driver') {
        profileData.phone_number = phone_number || null
        profileData.date_of_birth = date_of_birth || null
        profileData.drivers_license_number = drivers_license_number || null
        profileData.drivers_license_photo_url = drivers_license_photo_url || null
        profileData.willing_to_fly = willing_to_fly || false
        profileData.can_drive_manual = can_drive_manual || false
      }

      // Create profile
      const { error: profileError } = await supabaseAdmin
        .from('profiles')
        .insert(profileData)

      if (profileError) {
        // Clean up auth user if profile creation fails
        await supabaseAdmin.auth.admin.deleteUser(newUser.user.id)
        throw profileError
      }

      return new Response(JSON.stringify({ success: true, userId: newUser.user.id, user: newUser.user }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (action === 'delete') {
      // Delete profile first (FK constraint)
      const { error: profileError } = await supabaseAdmin
        .from('profiles')
        .delete()
        .eq('id', userId)

      if (profileError) throw profileError

      // Delete auth user
      const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(userId)

      if (authError) throw authError

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (action === 'update-email') {
      if (!userId || !email) {
        return new Response(
          JSON.stringify({ error: 'userId and email are required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Update email in auth.users
      const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
        email,
        email_confirm: true,
      })
      if (authError) throw authError

      // Update email in profiles table (if column exists)
      await supabaseAdmin
        .from('profiles')
        .update({ email })
        .eq('id', userId)

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    return new Response(JSON.stringify({ error: 'Invalid action' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})