
import type { VercelRequest, VercelResponse } from '@vercel/node';
// @ts-ignore
import clientPromise from './_lib/mongodb.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { tripId } = req.query;

  if (!tripId || typeof tripId !== 'string') {
    return res.status(400).json({ error: 'Missing tripId' });
  }

  try {
    const client = await clientPromise;
    const db = client.db("sl_tracker");
    
    const trip = await db.collection("vehicle_trails").findOne(
      { tripId: tripId },
      { projection: { trail: 1, _id: 0 } }
    );

    if (!trip) {
      return res.status(200).json({ path: [] });
    }

    // Returnera objekt med lat, lng och ts istället för bara array
    const path = (trip.trail as any[])
        .sort((a, b) => a.ts - b.ts)
        .map(p => ({
            lat: p.lat, 
            lng: p.lng, 
            ts: p.ts
        }));

    return res.status(200).json({ path });
  } catch (error) {
    console.error("History fetch error:", error);
    return res.status(200).json({ path: [] });
  }
}
