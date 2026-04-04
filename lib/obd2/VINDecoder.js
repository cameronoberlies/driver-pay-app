// VIN Decoder using NHTSA vPIC API (free, no API key needed)
// https://vpic.nhtsa.dot.gov/api/

const NHTSA_BASE = 'https://vpic.nhtsa.dot.gov/api/vehicles/decodevin';
const vinCache = {};

export async function decodeVIN(vin) {
  if (!vin || vin.length !== 17) return null;

  // Check cache
  if (vinCache[vin]) return vinCache[vin];

  try {
    const res = await fetch(`${NHTSA_BASE}/${vin}?format=json`);
    if (!res.ok) return null;

    const data = await res.json();
    const results = data.Results || [];

    function getValue(variableId) {
      const item = results.find(r => r.VariableId === variableId);
      return item?.Value?.trim() || null;
    }

    const vehicle = {
      vin,
      year: parseInt(getValue(29)) || null,       // Model Year
      make: getValue(26),                          // Make
      model: getValue(28),                         // Model
      trim: getValue(38),                          // Trim
      body: getValue(5),                           // Body Class
      engine: getValue(13),                        // Engine Model
      engineSize: getValue(11),                    // Displacement (L)
      cylinders: parseInt(getValue(9)) || null,    // Engine Number of Cylinders
      transmission: getValue(37),                  // Transmission Style
      driveType: getValue(15),                     // Drive Type
      fuelType: getValue(24),                      // Fuel Type - Primary
      doors: parseInt(getValue(14)) || null,       // Doors
      plant: getValue(31),                         // Plant Company Name
      vehicleType: getValue(39),                   // Vehicle Type
    };

    // Build display string
    vehicle.display = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ');
    if (vehicle.trim) vehicle.display += ` ${vehicle.trim}`;

    // Cache the result
    vinCache[vin] = vehicle;

    return vehicle;
  } catch (e) {
    console.log('[VIN] Decode error:', e.message);
    return null;
  }
}

// Quick display format: "2023 Honda Accord"
export function formatVehicle(vehicle) {
  if (!vehicle) return '';
  return vehicle.display || [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ');
}
