
import path from 'path';
import fs from 'fs';
import yauzl from 'yauzl-promise';
import { parse } from 'csv-parse';
import process from 'process';

// --- Konfiguration ---
const DATA_DIR = path.resolve(process.cwd(), 'data/raw');
const ZIP_FILE = path.join(DATA_DIR, 'sweden.zip');
const PUBLIC_DIR = path.resolve(process.cwd(), 'public');
const OUT_DIR = path.join(PUBLIC_DIR, 'data');
const LINES_OUT_DIR = path.join(OUT_DIR, 'lines');
const SL_AGENCY_ID = '505000000000000001'; // SL:s unika identifierare

// --- Hjälpfunktion för att strömma CSV från en zip-post ---
async function streamCsvFromEntry(entry, processRow, fileNameForError) {
    if (!entry) {
        throw new Error(`Nödvändig fil '${fileNameForError}' hittades inte i zip-arkivet.`);
    }
    const readStream = await entry.openReadStream();
    const parser = readStream.pipe(parse({
        columns: true,
        skip_empty_lines: true,
    }));

    for await (const row of parser) {
        processRow(row);
    }
}

// --- Huvudfunktion ---
async function processGTFS() {
    console.log('--- Startar GTFS-bearbetning för SL ---');

    if (!fs.existsSync(ZIP_FILE)) {
        console.error(`\nFEL: Zip-filen hittades inte på sökvägen: ${ZIP_FILE}`);
        console.error('Ladda ner sweden.zip från Trafiklab och placera den där.');
        process.exit(1);
    }
    
    // Skapa utdatamappar
    [PUBLIC_DIR, OUT_DIR, LINES_OUT_DIR].forEach(dir => {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    });

    const zipfile = await yauzl.open(ZIP_FILE);

    // Steg 0: Läs in alla filposter i en karta för snabb åtkomst
    console.log('Läser zip-filens innehållsförteckning...');
    const entries = new Map();
    for await (const entry of zipfile) {
        entries.set(entry.filename, entry);
    }
    console.log(` -> Hittade ${entries.size} filer.`);

    try {
        // Steg 1: Hitta alla SL-rutter
        console.log('\n[1/7] Filtrerar SL-rutter...');
        const slRouteIds = new Set();
        const routesData = new Map();
        await streamCsvFromEntry(entries.get('routes.txt'), (row) => {
            if (row.agency_id === SL_AGENCY_ID) {
                slRouteIds.add(row.route_id);
                routesData.set(row.route_id, row);
            }
        }, 'routes.txt');
        console.log(` -> Hittade ${slRouteIds.size} SL-rutter.`);

        // Steg 2: Hitta alla resor, former och skapa trip -> route mappning
        console.log('\n[2/7] Filtrerar resor och skapar mappning...');
        const slTripIds = new Set();
        const slShapeIds = new Set();
        const tripsByRoute = new Map();
        const tripToRouteMap = {};
        await streamCsvFromEntry(entries.get('trips.txt'), (row) => {
            if (slRouteIds.has(row.route_id)) {
                slTripIds.add(row.trip_id);
                if (row.shape_id) slShapeIds.add(row.shape_id);
                
                if (!tripsByRoute.has(row.route_id)) tripsByRoute.set(row.route_id, []);
                tripsByRoute.get(row.route_id).push(row);
                
                tripToRouteMap[row.trip_id] = row.route_id;
            }
        }, 'trips.txt');
        console.log(` -> Hittade ${slTripIds.size} SL-resor med ${slShapeIds.size} unika former.`);

        // Steg 3: Spara trip -> route mappningen
        console.log('\n[3/7] Sparar trip-till-rutt-mappning...');
        fs.writeFileSync(path.join(OUT_DIR, 'trip-to-route.json'), JSON.stringify(tripToRouteMap));
        console.log(` -> Sparade mappning till public/data/trip-to-route.json`);


        // Steg 4: Hitta alla hållplatstider och unika hållplatser
        console.log('\n[4/7] Filtrerar hållplatstider...');
        const slStopIds = new Set();
        const stopTimesByTrip = new Map();
        await streamCsvFromEntry(entries.get('stop_times.txt'), (row) => {
            if (slTripIds.has(row.trip_id)) {
                slStopIds.add(row.stop_id);
                if (!stopTimesByTrip.has(row.trip_id)) stopTimesByTrip.set(row.trip_id, []);
                stopTimesByTrip.get(row.trip_id).push(row);
            }
        }, 'stop_times.txt');
        console.log(` -> Hittade ${stopTimesByTrip.size} resor med avgångstider och ${slStopIds.size} unika hållplatser.`);
        
        // Steg 5: Läs in alla relevanta hållplatser och former i minnet
        console.log('\n[5/7] Laddar hållplats- och form-data...');
        const stopsMap = new Map();
        await streamCsvFromEntry(entries.get('stops.txt'), (row) => {
            if (slStopIds.has(row.stop_id)) {
                stopsMap.set(row.stop_id, row);
            }
        }, 'stops.txt');
        const shapesMap = new Map();
        await streamCsvFromEntry(entries.get('shapes.txt'), (row) => {
            if (slShapeIds.has(row.shape_id)) {
                if (!shapesMap.has(row.shape_id)) shapesMap.set(row.shape_id, []);
                shapesMap.get(row.shape_id).push(row);
            }
        }, 'shapes.txt');
        console.log(` -> Laddade ${stopsMap.size} hållplatser och ${shapesMap.size} former.`);
        
        // Steg 6: Spara alla SL-hållplatser till en enda fil
        console.log('\n[6/7] Sparar alla SL-hållplatser...');
        const allStops = Array.from(stopsMap.values()).map(s => ({
            id: s.stop_id,
            name: s.stop_name,
            lat: parseFloat(s.stop_lat),
            lng: parseFloat(s.stop_lon),
        }));
        fs.writeFileSync(path.join(OUT_DIR, 'stops.json'), JSON.stringify(allStops));
        console.log(` -> Sparade ${allStops.length} hållplatser till public/data/stops.json.`);

        // Steg 7: Generera en JSON-fil för varje rutt
        console.log('\n[7/7] Genererar JSON-filer för varje linje...');
        const manifest = [];
        let generatedCount = 0;
        
        for (const routeId of slRouteIds) {
            const route = routesData.get(routeId);
            const tripsForRoute = tripsByRoute.get(routeId) || [];
            if (tripsForRoute.length === 0) continue;

            let bestTrip = null;
            let maxStops = 0;
            for (const trip of tripsForRoute) {
                const stopCount = (stopTimesByTrip.get(trip.trip_id) || []).length;
                if (stopCount > maxStops) {
                    maxStops = stopCount;
                    bestTrip = trip;
                }
            }
            if (!bestTrip) continue;

            const tripStopsRaw = (stopTimesByTrip.get(bestTrip.trip_id) || [])
                .sort((a, b) => parseInt(a.stop_sequence) - parseInt(b.stop_sequence));
            
            const stops = tripStopsRaw
                .map(st => stopsMap.get(st.stop_id))
                .filter(Boolean)
                .map(s => ({
                    id: s.stop_id,
                    name: s.stop_name,
                    lat: parseFloat(s.stop_lat),
                    lng: parseFloat(s.stop_lon)
                }));
            
            if (stops.length < 2) continue;

            const shapePoints = (shapesMap.get(bestTrip.shape_id) || [])
                .sort((a, b) => parseInt(a.shape_pt_sequence) - parseInt(b.shape_pt_sequence))
                .map(s => [parseFloat(s.shape_pt_lat), parseFloat(s.shape_pt_lon)]);
            
            const allTripIds = tripsForRoute.map(t => t.trip_id);

            const output = {
                id: route.route_id,
                line: route.route_short_name,
                description: route.route_long_name,
                trip_ids: allTripIds,
                path: shapePoints.length > 0 ? shapePoints : stops.map(s => [s.lat, s.lng]),
                stops: stops
            };

            fs.writeFileSync(path.join(LINES_OUT_DIR, `${route.route_id}.json`), JSON.stringify(output));
            manifest.push({
                id: route.route_id,
                line: route.route_short_name,
                description: route.route_long_name,
                from: stops[0].name,
                to: stops[stops.length - 1].name
            });
            generatedCount++;
        }
        
        fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest));
        console.log(` -> Genererade ${generatedCount} linjefiler och en manifest.json.`);

        console.log('\n--- Bearbetning klar! ---');
        console.log(`All data har sparats i mappen: ${OUT_DIR}`);

    } finally {
        await zipfile.close();
    }
}

processGTFS().catch(error => {
    console.error("\nEtt allvarligt fel uppstod:", error);
    process.exit(1);
});