// supabase/functions/notify-trip-message/index.ts
// Purpose: Send push notification when a trip message is created
// Trigger: Call this from database trigger or client-side after insert

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

interface TripMessage {
  id: string;
  trip_id: string;
  sender_id: string;
  content: string;
  created_at: string;
}

interface Profile {
  id: string;
  name: string;
  role: string;
  push_token: string | null;
}

interface Trip {
  id: string;
  crm_id: string;
  city: string;
  driver_id: string;
  second_driver_id: string | null;
}

serve(async (req) => {
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { message_id } = await req.json();

    if (!message_id) {
      return new Response(JSON.stringify({ error: 'message_id required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Fetch the message
    const { data: message, error: msgError } = await supabase
      .from('trip_messages')
      .select('*')
      .eq('id', message_id)
      .single();

    if (msgError || !message) {
      return new Response(JSON.stringify({ error: 'Message not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const msg = message as TripMessage;

    // Fetch trip details
    const { data: trip, error: tripError } = await supabase
      .from('trips')
      .select('id, crm_id, city, driver_id, second_driver_id')
      .eq('id', msg.trip_id)
      .single();

    if (tripError || !trip) {
      return new Response(JSON.stringify({ error: 'Trip not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const tripData = trip as Trip;

    // Fetch sender profile
    const { data: sender, error: senderError } = await supabase
      .from('profiles')
      .select('name, role')
      .eq('id', msg.sender_id)
      .single();

    if (senderError || !sender) {
      return new Response(JSON.stringify({ error: 'Sender not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const senderProfile = sender as Profile;

    // Determine recipients
    let recipientIds: string[] = [];

    if (senderProfile.role === 'admin') {
      // Admin sent it → notify the driver(s)
      recipientIds.push(tripData.driver_id);
      if (tripData.second_driver_id) {
        recipientIds.push(tripData.second_driver_id);
      }
    } else {
      // Driver sent it → notify all admins
      const { data: admins, error: adminsError } = await supabase
        .from('profiles')
        .select('id')
        .eq('role', 'admin');

      if (!adminsError && admins) {
        recipientIds = admins.map((a: Profile) => a.id);
      }
    }

    // Remove sender from recipients (don't notify yourself)
    recipientIds = recipientIds.filter((id) => id !== msg.sender_id);

    if (recipientIds.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No recipients to notify' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Fetch push tokens for recipients
    const { data: recipients, error: recipientsError } = await supabase
      .from('profiles')
      .select('id, push_token')
      .in('id', recipientIds);

    if (recipientsError || !recipients) {
      return new Response(JSON.stringify({ error: 'Failed to fetch recipients' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const recipientProfiles = recipients as Profile[];
    const pushTokens = recipientProfiles
      .map((r) => r.push_token)
      .filter((token): token is string => !!token);

    if (pushTokens.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No valid push tokens found' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Prepare push notification
    const notifications = pushTokens.map((token) => ({
      to: token,
      sound: 'default',
      title: `${tripData.crm_id} · ${tripData.city}`,
      body: `${senderProfile.name}: ${msg.content.substring(0, 100)}`,
      data: { trip_id: tripData.id, screen: 'TripChat' },
    }));

    // Send push notifications
    const pushResponse = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(notifications),
    });

    const pushResult = await pushResponse.json();

    return new Response(
      JSON.stringify({
        success: true,
        notifications_sent: pushTokens.length,
        expo_response: pushResult,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
notify-trip-message      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});