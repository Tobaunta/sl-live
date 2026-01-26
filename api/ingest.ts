
import type { VercelRequest, VercelResponse } from '@vercel/node';
// @ts-ignore
import clientPromise from './_lib/mongodb.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.MONGODB_URI) {
    return res.status(500).json({ error: 'Server misconfiguration' });
  }

  const { vehicles } = req.body;

  if (!vehicles || !Array.isArray(vehicles) || vehicles.length === 0) {
    return res.status(200).json({ message: 'No data' });
  }

  try {
    const client = await clientPromise;
    const db = client.db("sl_tracker");
    const collection = db.collection("vehicle_trails");

    await collection.createIndex({ tripId: 1 }, { unique: true });
    await collection.createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 }); 

    const now = Date.now();
    const expireTime = new Date(now + 4 * 60 * 60 * 1000);

    const validVehicles = vehicles.filter((v: any) => v.tripId && typeof v.tripId === 'string');
    
    if (validVehicles.length === 0) {
        return res.status(200).json({ message: 'No valid vehicles found' });
    }

    const ops = validVehicles.map((v: any) => ({
        updateOne: {
          filter: { tripId: v.tripId },
          update: {
            $set: {
              line: v.line,
              vehicleId: v.id,
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

    return res.status(200).json({ 
        success: true, 
        count: ops.length, 
        modified: result.modifiedCount,
        upserted: result.upsertedCount 
    });

  } catch (error: any) {
    console.error("Ingest error:", error);
    return res.status(500).json({ error: 'Database error' });
  }
}
