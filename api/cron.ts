
import type { VercelRequest, VercelResponse } from '@vercel/node';
// @ts-ignore
import clientPromise from './_lib/mongodb.js';
import protobuf from 'protobufjs';

const API_ENDPOINT = 'https://opendata.samtrafiken.se/gtfs-rt-sweden/sl/VehiclePositionsSweden.pb';

// Protobuf-definition
const PROTO_DEF = `
syntax = "proto2";
package transit_realtime;
message FeedMessage { required FeedHeader header = 1; repeated FeedEntity entity = 2; }
message FeedHeader { required string gtfs_realtime_version = 1; optional Incrementality incrementality = 2 [default = FULL_DATASET]; optional uint64 timestamp = 3; enum Incrementality { FULL_DATASET = 0; DIFFERENTIAL = 1; } }
message FeedEntity { required string id = 1; optional bool is_deleted = 2 [default = false]; optional TripUpdate trip_update = 3; optional VehiclePosition vehicle = 4; optional Alert alert = 5; }
message VehiclePosition { optional TripDescriptor trip = 1; optional VehicleDescriptor vehicle = 8; optional Position position = 2; optional uint64 timestamp = 5; }
message TripUpdate { optional TripDescriptor trip = 1; repeated StopTimeUpdate stop_time_update = 2; }
message StopTimeUpdate { optional uint32 stop_sequence = 1; optional string stop_id = 4; optional StopTimeEvent arrival = 2; optional StopTimeEvent departure = 3; }
message StopTimeEvent { optional int32 delay = 1; optional int64 time = 2; optional int32 uncertainty = 3; }
message TripDescriptor { optional string trip_id = 1; optional string route_id = 5; optional uint32 direction_id = 6; }
message VehicleDescriptor { optional string id = 1; optional string label = 2; optional string license_plate = 3; }
message Position { required float latitude = 1; required float longitude = 2; optional float bearing = 3; optional float speed = 5; }
message Alert {}
`;

// Helper function to fetch and save data once
async function fetchAndSaveData(apiKey: string, db: any) {
    const response = await fetch(`${API_ENDPOINT}?key=${apiKey}`);
    if (!response.ok) throw new Error(`Upstream API failed: ${response.status}`);
    
    const arrayBuffer = await response.arrayBuffer();
    const root = protobuf.parse(PROTO_DEF).root;
    const FeedMessage = root.lookupType("transit_realtime.FeedMessage");
    const message = FeedMessage.decode(new Uint8Array(arrayBuffer));
    
    const object = FeedMessage.toObject(message, { 
        enums: String, 
        longs: String, 
        defaults: true 
    });
    
    const entities = object.entity || [];
    
    if (entities.length === 0) {
        return { saved: 0, message: "0 entities returned" };
    }

    const now = Date.now();
    const expireTime = new Date(now + 2 * 60 * 60 * 1000); 

    const validVehicles = entities
        .map((e: any) => {
            if (!e.vehicle || !e.vehicle.trip) return null;
            const trip = e.vehicle.trip;
            const tripId = trip.tripId || trip.trip_id;
            const routeId = trip.routeId || trip.route_id;

            if (!tripId) return null;

            return {
                tripId: tripId,
                line: routeId, 
                vehicleId: e.vehicle.vehicle?.id || e.id,
                lat: e.vehicle.position?.latitude,
                lng: e.vehicle.position?.longitude,
                ts: now
            };
        })
        .filter((v: any) => v !== null && v.lat !== undefined && v.lng !== undefined);

    if (validVehicles.length === 0) {
        return { saved: 0, message: "No valid vehicles found" };
    }

    const collection = db.collection("vehicle_trails");
    
    // Ensure indexes exist (doing this every loop is cheap if they exist)
    await collection.createIndex({ tripId: 1 }, { unique: true });
    await collection.createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 }); 

    const ops = validVehicles.map((v: any) => ({
        updateOne: {
          filter: { tripId: v.tripId },
          update: {
            $set: {
              line: v.line,
              vehicleId: v.vehicleId,
              expireAt: expireTime,
              lastUpdate: now
            },
            $push: {
              trail: {
                lat: v.lat,
                lng: v.lng,
                ts: now
              }
            }
          },
          upsert: true
        }
    }));

    const result = await collection.bulkWrite(ops as any[], { ordered: false });

    return { 
        saved: ops.length, 
        modified: result.modifiedCount,
        upserted: result.upsertedCount 
    };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const authHeader = req.headers['authorization'];
  const queryKey = req.query.key;
  
  if (process.env.CRON_SECRET) {
      if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && queryKey !== process.env.CRON_SECRET) {
          return res.status(401).json({ error: 'Unauthorized' });
      }
  }

  const apiKey = process.env.RT_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'RT_API_KEY is missing' });
  }

  // Configuration for Pro Plan
  const TOTAL_RUN_TIME_MS = 58000; // Stop just before the next minute starts (58s)
  const INTERVAL_MS = 10000; // Target interval: 10 seconds
  const startTime = Date.now();

  try {
    const client = await clientPromise;
    const db = client.db("sl_tracker");
    
    const results = [];
    let iterations = 0;

    // Loop logic to fill the minute
    while ((Date.now() - startTime) < TOTAL_RUN_TIME_MS) {
        const loopStart = Date.now();
        iterations++;

        try {
            console.log(`Cron iteration ${iterations} starting at ${new Date().toISOString()}`);
            const result = await fetchAndSaveData(apiKey, db);
            results.push({ iteration: iterations, timestamp: Date.now(), ...result });
        } catch (err: any) {
            console.error(`Error in iteration ${iterations}:`, err);
            results.push({ iteration: iterations, error: err.message });
        }

        // Calculate time spent processing
        const workDuration = Date.now() - loopStart;
        
        // Calculate needed sleep to maintain 10s interval
        // If work took 2s, we sleep 8s. If work took 12s, we sleep 0s.
        const sleepTime = Math.max(0, INTERVAL_MS - workDuration);

        // Check if sleeping would push us over the total limit
        if ((Date.now() - startTime) + sleepTime >= TOTAL_RUN_TIME_MS) {
            break;
        }

        if (sleepTime > 0) {
            await new Promise(resolve => setTimeout(resolve, sleepTime));
        }
    }

    return res.status(200).json({ 
        success: true, 
        iterations,
        total_time_ms: Date.now() - startTime,
        details: results 
    });

  } catch (error: any) {
    console.error("CRON Fatal Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
