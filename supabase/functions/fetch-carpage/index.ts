import { DOMParser } from "https://deno.land/x/deno_dom/deno-dom-wasm.ts";

Deno.serve(async (req) => {
  // Handle CORS
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  try {
    const { url } = await req.json();
    if (!url) {
      return new Response(JSON.stringify({ error: "URL is required" }), { status: 400 });
    }

    // Extract CRM ID from URL
    const urlObj = new URL(url);
    const crmId = urlObj.searchParams.get("cid") ?? "";

    // Fetch the CarPage pickup sheet
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; DriverPay/1.0)",
      },
    });

    if (!response.ok) {
      return new Response(JSON.stringify({ error: "Failed to fetch CarPage" }), { status: 400 });
    }

    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, "text/html");

    if (!doc) {
      return new Response(JSON.stringify({ error: "Failed to parse HTML" }), { status: 400 });
    }

    // Helper to get input value by name
    function getInput(name: string): string {
      return (doc.querySelector(`input[name="${name}"]`) as any)?.getAttribute("value") ?? "";
    }

    // Parse all fields
    const carInfo = getInput("car_info");
    const vin = getInput("car_vin");
    const boughtPrice = getInput("bought_price");
    const sellerPhone = getInput("contact_phone");
    const pickupTimeText = getInput("pickup_time_text");
    const place = getInput("place");
    const address = getInput("address");

    // Note is in a contenteditable div
    const noteEl = doc.querySelector("div[data-name='note']");
    const note = noteEl?.textContent?.trim() ?? "";

    // Seller name — find the Name row value div
    let sellerName = "";
    const rows = doc.querySelectorAll(".car-pickup__row");
    for (const row of rows) {
      const label = row.querySelector(".car-pickup__label");
      if (label?.textContent?.trim() === "Name:") {
        const valueDiv = row.querySelector(".car-pickup__value");
        // Name may be in a span or div inside the value
        sellerName = valueDiv?.textContent?.trim() ?? "";
        break;
      }
    }

    // Parse pickup time into ISO format
    let scheduledPickup = "";
    if (pickupTimeText) {
      try {
        const parsed = new Date(pickupTimeText);
        if (!isNaN(parsed.getTime())) {
          scheduledPickup = parsed.toISOString().slice(0, 16);
        }
      } catch {}
    }

    // Build city from address (last part before zip usually)
    // e.g. "2160 Logan Dr Jonesboro, Ga 30236" → "Jonesboro, GA"
    let city = "";
    if (address) {
      const match = address.match(/([A-Za-z\s]+),\s*([A-Za-z]{2})\s*\d{5}/);
      if (match) {
        city = `${match[1].trim()}, ${match[2].toUpperCase()}`;
      }
    }

    // Build notes string
    const notesParts = [];
    if (sellerName) notesParts.push(`Seller: ${sellerName}`);
    if (sellerPhone) notesParts.push(`Phone: ${sellerPhone}`);
    if (place) notesParts.push(`Place: ${place}`);
    if (note) notesParts.push(`Note: ${note}`);
    if (vin) notesParts.push(`VIN: ${vin}`);
    if (boughtPrice) notesParts.push(`Bought for: ${boughtPrice}`);
    const notes = notesParts.join(" | ");

    return new Response(JSON.stringify({
      crm_id: crmId,
      car: carInfo,
      vin,
      bought_price: boughtPrice,
      seller_name: sellerName,
      seller_phone: sellerPhone,
      pickup_time_text: pickupTimeText,
      scheduled_pickup: scheduledPickup,
      place,
      address,
      city,
      note,
      notes,
      carpage_link: url,
    }), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
});