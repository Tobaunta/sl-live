
import { SLStop, SLLineRoute, SearchResult, SLVehicle, HistoryPoint } from '../types';
// @ts-ignore
import protobuf from 'protobufjs';

const DB_NAME = 'SL_Tracker_DB_v3';
const DB_VERSION = 1;
const STATIC_TS_KEY = 'sl_static_timestamp_v2';
const CACHE_DURATION = 1000 * 60 * 60 * 24 * 7; 

const RT_VEHICLE_URL = '/api/gtfs-rt';
const RT_TRIP_UPDATES_URL = '/api/trip-updates';

export interface LineManifestEntry {
    id: string;
    line: string;
    description: string;
    from: string;
    to: string;
}

interface TripMapEntry {
  r: string; // route_id
  h: string; // headsign
}

// Map: RouteID -> DirectionID -> Headsign
interface RouteDirectionMap {
    [routeId: string]: {
        [directionId: string]: string;
    }
}

interface TripUpdateInfo {
    delay?: number;
    directionId?: number;
    routeId?: string;
    lastStopId?: string;
}

class SLService {
  private db: IDBDatabase | null = null;
  private isInitialized = false;
  private rtRoot: any = null;
  private tripToRouteMap: Record<string, TripMapEntry> | null = null;
  private routeDirections: RouteDirectionMap | null = null;
  private stopsMap: Map<string, string> = new Map();

  public areKeysConfigured(): boolean {
    return true; 
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
    
    // Antingen ladda från filer eller från DB om vi har cache
    if (!lastUpdate || (now - parseInt(lastUpdate)) > CACHE_DURATION) {
      await this.loadStaticDataFromFiles();
    } else {
      await this.loadStopsFromDB();
    }
    
    await this.loadAuxiliaryMaps();
    this.isInitialized = true;
  }

  private isJson(response: Response) {
    const contentType = response.headers.get('content-type');
    return contentType && contentType.includes('application/json');
  }

  private async loadAuxiliaryMaps() {
    try {
        const [tripRes, dirRes] = await Promise.all([
            fetch(`/data/trip-to-route.json?v=${Date.now()}`), 
            fetch(`/data/route-directions.json?v=${Date.now()}`)
        ]);

        if (tripRes.ok && this.isJson(tripRes)) {
            this.tripToRouteMap = await tripRes.json();
        }

        if (dirRes.ok && this.isJson(dirRes)) {
            this.routeDirections = await dirRes.json();
        }
    } catch(e) {
        console.warn("Kunde inte ladda hjälpkartor:", e);
    }
  }

  private async loadStopsFromDB() {
      const db = await this.getDB();
      return new Promise<void>((resolve) => {
          const tx = db.transaction('stops', 'readonly');
          const store = tx.objectStore('stops');
          const req = store.getAll();
          req.onsuccess = () => {
              if (req.result) {
                  req.result.forEach((s: SLStop) => this.stopsMap.set(s.id, s.name));
              }
              resolve();
          };
          req.onerror = () => resolve();
      });
  }

  private async loadStaticDataFromFiles() {
    try {
      const [manifestRes, stopsRes] = await Promise.all([
        fetch('/data/manifest.json'),
        fetch('/data/stops.json')
      ]);

      if (!manifestRes.ok || !stopsRes.ok || !this.isJson(manifestRes) || !this.isJson(stopsRes)) {
         throw new Error(`Static files missing or invalid format.`);
      }

      const manifest = await manifestRes.json();
      const stops: SLStop[] = await stopsRes.json();

      // Uppdatera stopsMap i minnet
      stops.forEach(s => this.stopsMap.set(s.id, s.name));

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
      console.warn("Varning: Kunde inte ladda statisk data.", e);
    }
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
    return new Promise<SearchResult[]>(resolve => {
        const results: SearchResult[] = [];
        const tx = db.transaction('stops', 'readonly');
        const store = tx.objectStore('stops');
        store.index('name').openCursor().onsuccess = (event) => {
            const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
            if (cursor) {
                const stop = cursor.value as SLStop;
                if (stop.name.toLowerCase().includes(query)) {
                    results.push({ type: 'stop', id: stop.id, title: stop.name, subtitle: `Hållplats` });
                }
                if (results.length < 10) cursor.continue(); else resolve(results);
            } else {
                resolve(results);
            }
        };
    });
  }

  async getLineRoute(routeId: string): Promise<SLLineRoute | null> {
    try {
        const response = await fetch(`/data/lines/${routeId}.json`);
        if (!response.ok || !this.isJson(response)) throw new Error('Line data not found');
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

  async getVehicleHistory(tripId: string): Promise<HistoryPoint[]> {
      try {
          const res = await fetch(`/api/history?tripId=${tripId}`);
          if (!res.ok) return [];
          const data = await res.json();
          return data.path || [];
      } catch (e) {
          console.error("Failed to fetch history", e);
          return [];
      }
  }

  // Sök efter en specifik vagn globalt
  async findVehicle(vehicleNumber: string): Promise<{vehicle: SLVehicle, routeId: string} | null> {
      try {
        if (!this.isInitialized) await this.initialize();
      } catch (initErr) {
        console.error("Initialization failed in findVehicle:", initErr);
        return null; 
      }
      
      try {
          const posRes = await fetch(RT_VEHICLE_URL);
          if (!posRes.ok) throw new Error(`API Error: ${posRes.status}`);
          const posBuffer = await posRes.arrayBuffer();
          
          const root = await this.getRTRoot();
          const FeedMessage = root.lookupType("transit_realtime.FeedMessage");
          const posMessage = FeedMessage.decode(new Uint8Array(posBuffer));
          const posObject = FeedMessage.toObject(posMessage, { enums: String, longs: String });
          const posEntities = posObject.entity || [];
          
          const target = vehicleNumber.trim();

          for (const e of posEntities) {
              const v = e.vehicle;
              if (v && v.vehicle) {
                  const label = v.vehicle.label ? String(v.vehicle.label).trim() : '';
                  const vid = v.vehicle.id ? String(v.vehicle.id).trim() : '';
                  
                  if (label === target || (vid && vid.endsWith(target))) {
                       const tripId = v.trip?.tripId || v.trip?.trip_id;
                       let routeId = v.trip?.routeId || v.trip?.route_id;

                       if (tripId && this.tripToRouteMap && this.tripToRouteMap[tripId]) {
                           routeId = this.tripToRouteMap[tripId].r;
                       }

                       if (routeId) {
                           return {
                               vehicle: {
                                   id: v.vehicle.id || e.id,
                                   line: routeId,
                                   tripId: tripId || "",
                                   operator: "SL",
                                   vehicleNumber: v.vehicle.label || vid.slice(-4),
                                   lat: v.position.latitude,
                                   lng: v.position.longitude,
                                   bearing: v.position.bearing || 0,
                                   speed: (v.position.speed || 0) * 3.6,
                                   destination: "", 
                                   type: "Buss"
                               },
                               routeId: routeId
                           };
                       }
                  }
              }
          }
          return null;
      } catch (e) {
          console.error("Fel vid fordonssökning (detaljer):", e);
          return null;
      }
  }

  async getLiveVehicles(route?: SLLineRoute | null): Promise<SLVehicle[]> {
    if (!this.isInitialized) await this.initialize();

    try {
        const [posRes, updatesRes] = await Promise.all([
            fetch(RT_VEHICLE_URL),
            fetch(RT_TRIP_UPDATES_URL).catch(() => null)
        ]);

        if (!posRes.ok) throw new Error(`API Error: ${posRes.status}`);
        
        const posBuffer = await posRes.arrayBuffer();
        if (posBuffer.byteLength < 20) return [];

        const root = await this.getRTRoot();
        const FeedMessage = root.lookupType("transit_realtime.FeedMessage");
        
        const posMessage = FeedMessage.decode(new Uint8Array(posBuffer));
        const posObject = FeedMessage.toObject(posMessage, { enums: String, longs: String });
        const posEntities = posObject.entity || [];

        const tripInfoMap: Map<string, TripUpdateInfo> = new Map();

        if (updatesRes && updatesRes.ok) {
            const updatesBuffer = await updatesRes.arrayBuffer();
            const updatesMessage = FeedMessage.decode(new Uint8Array(updatesBuffer));
            const updatesObject = FeedMessage.toObject(updatesMessage, { enums: String, longs: String });
            const updateEntities = updatesObject.entity || [];

            for (const e of updateEntities) {
                if (e.tripUpdate && e.tripUpdate.trip) {
                    const tripId = e.tripUpdate.trip.tripId || e.tripUpdate.trip.trip_id;
                    const routeId = e.tripUpdate.trip.routeId || e.tripUpdate.trip.route_id;
                    const directionId = e.tripUpdate.trip.directionId ?? e.tripUpdate.trip.direction_id;

                    if (tripId) {
                        let delay = undefined;
                        let lastStopId = undefined;

                        if (e.tripUpdate.stopTimeUpdate && e.tripUpdate.stopTimeUpdate.length > 0) {
                            const updates = e.tripUpdate.stopTimeUpdate;
                            const firstUpdate = updates[0];
                            if (firstUpdate) {
                                if (firstUpdate.arrival && firstUpdate.arrival.delay !== undefined) {
                                    delay = parseInt(firstUpdate.arrival.delay);
                                } else if (firstUpdate.departure && firstUpdate.departure.delay !== undefined) {
                                    delay = parseInt(firstUpdate.departure.delay);
                                }
                            }
                            
                            const lastUpdate = updates[updates.length - 1];
                            if (lastUpdate) {
                                lastStopId = lastUpdate.stopId || lastUpdate.stop_id;
                            }
                        }
                        tripInfoMap.set(tripId, { delay, directionId, routeId, lastStopId });
                    }
                }
            }
        }
        
        const allVehicles: SLVehicle[] = [];
        for (const e of posEntities) {
            const v = e.vehicle;
            if (!v || !v.position || !v.trip) continue;

            const tripId = v.trip.tripId || v.trip.trip_id;
            if (!tripId) continue;
            
            let routeId = v.trip.routeId || v.trip.route_id;
            let directionId = v.trip.directionId ?? v.trip.direction_id;
            
            const info = tripInfoMap.get(tripId);
            if (info) {
                if (directionId === undefined || directionId === null) directionId = info.directionId;
                if (!routeId) routeId = info.routeId;
            }

            let headsign = "Okänd";

            if (this.tripToRouteMap && this.tripToRouteMap[tripId]) {
                const mapEntry = this.tripToRouteMap[tripId];
                if (!routeId) routeId = mapEntry.r; 
                if (mapEntry.h) headsign = mapEntry.h;
            }

            if ((!headsign || headsign === "Okänd") && routeId && directionId !== undefined && directionId !== null && this.routeDirections) {
                const dirStr = String(directionId);
                const fallbackHeadsign = this.routeDirections[routeId]?.[dirStr];
                if (fallbackHeadsign) {
                    headsign = fallbackHeadsign;
                }
            }

            if ((!headsign || headsign === "Okänd") && info?.lastStopId) {
                const stopName = this.stopsMap.get(info.lastStopId);
                if (stopName) {
                    headsign = stopName;
                }
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
                destination: headsign,
                type: "Buss",
                delay: info?.delay
            });
        }

        if (!route) {
            return allVehicles;
        }

        const tripIdSet = new Set(route.trip_ids);
        let filteredVehicles = allVehicles.filter(v => tripIdSet.has(v.tripId));
        
        if (filteredVehicles.length === 0 && allVehicles.length > 0) {
          filteredVehicles = allVehicles.filter(v => v.line === route.id);
        }

        return filteredVehicles;
    } catch(e) {
        console.error("Fel vid hämtning av realtidsdata:", e);
        return [];
    }
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
      message TripUpdate { optional TripDescriptor trip = 1; repeated StopTimeUpdate stop_time_update = 2; }
      message StopTimeUpdate { optional uint32 stop_sequence = 1; optional string stop_id = 4; optional StopTimeEvent arrival = 2; optional StopTimeEvent departure = 3; }
      message StopTimeEvent { optional int32 delay = 1; optional int64 time = 2; optional int32 uncertainty = 3; }
      message TripDescriptor { optional string trip_id = 1; optional string route_id = 5; optional uint32 direction_id = 6; }
      message VehicleDescriptor { optional string id = 1; optional string label = 2; optional string license_plate = 3; }
      message Position { required float latitude = 1; required float longitude = 2; optional float bearing = 3; optional float speed = 5; }
      message Alert {}
    `).root;
    return this.rtRoot;
  }
}

export const slService = new SLService();
