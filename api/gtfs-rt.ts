
import type { VercelRequest, VercelResponse } from '@vercel/node';
// Fix: Import Buffer explicitly to resolve "Cannot find name 'Buffer'" error
import { Buffer } from 'buffer';

const API_ENDPOINT = 'https://opendata.samtrafiken.se/gtfs-rt-sweden/sl/VehiclePositionsSweden.pb';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Hämta API-nyckeln från en säker miljövariabel
  const apiKey = process.env.RT_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: 'API key is not configured on the server.' });
  }

  try {
    const fullUrl = `${API_ENDPOINT}?key=${apiKey}`;
    
    // Anropa Trafiklabs API från servern
    const apiResponse = await fetch(fullUrl);

    if (!apiResponse.ok) {
      // Skicka vidare felstatus från Trafiklab för enklare felsökning
      const errorText = await apiResponse.text();
      return res.status(apiResponse.status).send(`Upstream API Error: ${apiResponse.statusText} - ${errorText}`);
    }

    // Hämta svaret som binärdata (ArrayBuffer)
    const buffer = await apiResponse.arrayBuffer();

    // Skicka tillbaka den binära Protobuf-datan till klienten
    res.setHeader('Content-Type', 'application/x-protobuf');
    res.setHeader('Cache-Control', 's-maxage=5, stale-while-revalidate=5'); // Cachea i 5s
    
    return res.status(200).send(Buffer.from(buffer));
    
  } catch (error) {
    console.error('Error in proxy function:', error);
    return res.status(500).json({ error: 'Failed to fetch data from the upstream API.' });
  }
}