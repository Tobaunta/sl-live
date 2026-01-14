
import { SLStop, SLLineRoute, SearchResult, SLVehicle } from '../types';
// @ts-ignore
import protobuf from 'protobufjs';

const DB_NAME = 'SL_Tracker_DB_v3';
const DB_VERSION = 1;
const STATIC_TS_KEY = 'sl_static_timestamp_v2';
const CACHE_DURATION = 1000 * 60 * 60 * 24 * 7; 

const RT_API_URL = '/api/gtfs-rt';

const areKeysConfigured = () => true; 

export interface LineManifestEntry {
    id: string;
    line: string;
    description: string;
    from: string;
    to: string;
}

class SLService {
  private db: IDBDatabase | null = null;
  private isInitialized = false;
  private rtRoot: any = null;
  private tripToRouteMap: Record<string, string> | null = null;

  public areKeysConfigured(): boolean {
    return areKeysConfigured();
  }

  private async getDB(): Promise<IDBDatabase> {
    if (this.db) return this.db;
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (db.objectStoreNames.contains('stops')) db.deleteObjectStore('stops');
        if (db.objectStoreNames.contains('routes')) db.deleteObjectStore('routes');
        
        const stopStore = db.createObjectStore('stops', { keyPath: 'id' });
        stopStore.createIndex('name', 'name', { unique: false });
        
        const routeStore = db.createObjectStore('routes', { keyPath: 'id' });
        routeStore.createIndex('line', 'line', { unique: false });
      };
      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };
      request.onerror = () => reject(request.error);
    });
  }
  
  async initialize() {
    if (this.isInitialized) return;
    await this.getDB();
    const lastUpdate = localStorage.getItem(STATIC_TS_KEY);
    const now = Date.now();
    if (!lastUpdate || (now - parseInt(lastUpdate)) > CACHE_DURATION) {
      await this.loadStaticDataFromFiles();
    }
    await this.loadTripToRouteMap();
    this.isInitialized = true;
  }

  private async loadTripToRouteMap() {
    try {
        const response = await fetch('/data/trip-to-route.json');
        this.tripToRouteMap = await response.json();
    } catch(e) {
        console.error("Kunde inte ladda trip-till-rutt-mappning:", e);
    }
  }

  private async loadStaticDataFromFiles() {
    try {
      const [manifest, stops] = await Promise.all([
        fetch('/data/manifest.json').then(res => res.json()),
        fetch('/data/stops.json').then(res => res.json())
      ]);

      const db = await this.getDB();
      const tx = db.transaction(['stops', 'routes'], 'readwrite');
      const stopStore = tx.objectStore('stops');
      const routeStore = tx.objectStore('routes');

      stopStore.clear();
      routeStore.clear();

      stops.forEach((stop: SLStop) => stopStore.put(stop));
      manifest.forEach((route: LineManifestEntry) => routeStore.put(route));

      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      
      localStorage.setItem(STATIC_TS_KEY, Date.now().toString());
    } catch (e) {
      console.error("Kunde inte ladda och spara statisk data:", e);
    }
  }
  
  private async searchLines(query: string, db: IDBDatabase): Promise<SearchResult[]> {
    return new Promise<SearchResult[]>(resolve => {
        const results: SearchResult[] = [];
        const tx = db.transaction('routes', 'readonly');
        const store = tx.objectStore('routes');
        store.index('line').openCursor().onsuccess = (event) => {
            const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
            if (cursor) {
                const route = cursor.value as LineManifestEntry;
                if (route.line.toLowerCase().startsWith(query)) {
                    results.push({ type: 'line', id: route.id, title: `Linje ${route.line}`, subtitle: `${route.from} - ${route.to}` });
                }
                 if (results.length < 10) cursor.continue(); else resolve(results);
            } else {
                resolve(results);
            }
        };
    });
  }

  private async searchStops(query: string, db: IDBDatabase): Promise<SearchResult[]> {
    const getDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
      const R = 6371e3; // meter
      const φ1 = lat1 * Math.PI/180;
      const φ2 = lat2 * Math.PI/180;
      const Δφ = (lat2-lat1) * Math.PI/180;
      const Δλ = (lon2-lon1) * Math.PI/180;
      const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
                Math.cos(φ1) * Math.cos(φ2) *
                Math.sin(Δλ/2) * Math.sin(Δλ/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      return R * c;
    };

    return new Promise<SearchResult[]>(resolve => {
        const results: SearchResult[] = [];
        const existingResultsByLocation: Map<string, {lat: number, lng: number}[]> = new Map();
        
        const tx = db.transaction('stops', 'readonly');
        const store = tx.objectStore('stops');
        store.index('name').openCursor().onsuccess = (event) => {
            const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
            if (cursor) {
                const stop = cursor.value as SLStop;
                const stopName = stop.name;
                
                if (stopName.toLowerCase().includes(query)) {
                    const nearbyPoints = existingResultsByLocation.get(stopName) || [];
                    const isTooClose = nearbyPoints.some(p => getDistance(p.lat, p.lng, stop.lat, stop.lng) < 500);
                    
                    if (!isTooClose) {
                        if (!existingResultsByLocation.has(stopName)) existingResultsByLocation.set(stopName, []);
                        existingResultsByLocation.get(stopName)!.push({lat: stop.lat, lng: stop.lng});
                        results.push({ type: 'stop', id: stop.id, title: stopName, subtitle: `Hållplats` });
                    }
                }
                if (results.length < 10) cursor.continue(); else resolve(results);
            } else {
                resolve(results);
            }
        };
    });
  }
  
  async search(query: string, activeRoute?: SLLineRoute | null): Promise<SearchResult[]> {
    await this.initialize();
    if (query.trim().length < 1) return [];

    const q = query.toLowerCase();
    const db = await this.getDB();

    if (activeRoute && activeRoute.stops) {
        const stopResults = activeRoute.stops
            .filter(stop => stop.name.toLowerCase().includes(q))
            .map(stop => ({
                type: 'stop' as const,
                id: stop.id,
                title: stop.name,
                subtitle: `På linje ${activeRoute.line}`
            }));
        
        const lineResults = await this.searchLines(q, db);
        return [...lineResults, ...stopResults].slice(0, 15);
    }

    const [stops, lines] = await Promise.all([
        this.searchStops(q, db),
        this.searchLines(q, db)
    ]);
    return [...lines, ...stops].slice(0, 15);
  }

  async getLineRoute(routeId: string): Promise<SLLineRoute | null> {
    try {
        const response = await fetch(`/data/lines/${routeId}.json`);
        if (!response.ok) throw new Error('Line data not found');
        const lineData = await response.json();
        
        const stops: SLStop[] = lineData.stops.map((s: any) => ({
            id: s.id,
            name: s.name,
            lat: s.lat,
            lng: s.lng,
            lines: []
        }));
        
        return {
            id: lineData.id,
            line: lineData.line,
            trip_ids: lineData.trip_ids,
            path: lineData.path,
            stops: stops
        };
    } catch (e) {
        return null;
    }
  }

  async getStopInfo(stopId: string): Promise<SLStop | null> {
    await this.initialize();
    const db = await this.getDB();
    return new Promise((resolve) => {
      const req = db.transaction('stops', 'readonly').objectStore('stops').get(stopId);
      req.onsuccess = () => resolve(req.result || null);
    });
  }

  async getManifest(): Promise<LineManifestEntry[]> {
      await this.initialize();
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
          const tx = db.transaction('routes', 'readonly');
          const store = tx.objectStore('routes');
          const req = store.getAll();
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
      });
  }

  async getLiveVehicles(route?: SLLineRoute | null): Promise<SLVehicle[]> {
    if (!route || !this.tripToRouteMap) return [];

    const response = await fetch(RT_API_URL);
    if (!response.ok) throw new Error(`API Error: ${response.status}`);
    
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength < 20) return [];

    const root = await this.getRTRoot();
    const FeedMessage = root.lookupType("transit_realtime.FeedMessage");
    const message = FeedMessage.decode(new Uint8Array(buffer));
    const decodedObject = FeedMessage.toObject(message, { enums: String, longs: String });
    const entities = decodedObject.entity || [];
    
    const allVehicles: SLVehicle[] = [];
    for (const e of entities) {
        const v = e.vehicle;
        if (!v || !v.position || !v.trip) continue;

        const tripId = v.trip.tripId || v.trip.trip_id;
        if (!tripId) continue;
        
        let routeId = v.trip.routeId || v.trip.route_id;
        if (!routeId) {
            routeId = this.tripToRouteMap[tripId];
        }
        if (!routeId) continue;

        allVehicles.push({
            id: v.vehicle?.id || e.id,
            line: routeId,
            tripId: tripId,
            operator: "SL / Entreprenör",
            vehicleNumber: v.vehicle?.label || "N/A",
            lat: v.position.latitude,
            lng: v.position.longitude,
            bearing: v.position.bearing || 0,
            speed: (v.position.speed || 0) * 3.6,
            destination: "Okänd",
            type: "Buss"
        });
    }

    const tripIdSet = new Set(route.trip_ids);
    let filteredVehicles = allVehicles.filter(v => tripIdSet.has(v.tripId));
    
    if (filteredVehicles.length === 0 && allVehicles.length > 0) {
      const fallbackVehicles = allVehicles.filter(v => v.line === route.id);
      filteredVehicles = fallbackVehicles;
    }

    return filteredVehicles;
  }
  
  private async getRTRoot() {
    if (this.rtRoot) return this.rtRoot;
    this.rtRoot = await protobuf.parse(`
      syntax = "proto2";
      package transit_realtime;
      message FeedMessage { required FeedHeader header = 1; repeated FeedEntity entity = 2; }
      message FeedHeader { required string gtfs_realtime_version = 1; optional Incrementality incrementality = 2 [default = FULL_DATASET]; optional uint64 timestamp = 3; enum Incrementality { FULL_DATASET = 0; DIFFERENTIAL = 1; } }
      message FeedEntity { required string id = 1; optional bool is_deleted = 2 [default = false]; optional TripUpdate trip_update = 3; optional VehiclePosition vehicle = 4; optional Alert alert = 5; }
      message VehiclePosition { optional TripDescriptor trip = 1; optional VehicleDescriptor vehicle = 8; optional Position position = 2; optional uint64 timestamp = 5; }
      message TripDescriptor { optional string trip_id = 1; optional string route_id = 5; }
      message VehicleDescriptor { optional string id = 1; optional string label = 2; optional string license_plate = 3; }
      message Position { required float latitude = 1; required float longitude = 2; optional float bearing = 3; optional float speed = 5; }
      message TripUpdate {}
      message Alert {}
    `).root;
    return this.rtRoot;
  }
}

export const slService = new SLService();
