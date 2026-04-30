
import { SLStop, SLLineRoute, SearchResult, SLVehicle, HistoryPoint } from '../types';
// @ts-ignore
import protobuf from 'protobufjs';

const DB_NAME = 'SL_Tracker_DB_v6';
const DB_VERSION = 1;
const STATIC_TS_KEY = 'sl_static_timestamp_v6';
const CACHE_DURATION = 1000 * 60 * 60 * 24 * 7; 

const RT_VEHICLE_URL = '/api/gtfs-rt';
const RT_TRIP_UPDATES_URL = '/api/trip-updates';

export interface LineManifestEntry {
    id: string;
    line: string;
    description?: string;
    from: string;
    to: string;
    agency: 'SL' | 'WAAB';
}

interface TripMapEntry {
  r: string; // route_id
  h?: string; // headsign
}

// Map: RouteID -> DirectionID -> Headsign
interface RouteDirectionMap {
    [routeId: string]: {
        [directionId: string]: string;
    }
}

class SLService {
  private db: IDBDatabase | null = null;
  private isInitialized = false;
  private rtRoot: any = null;
  private tripToRouteMap: Record<string, TripMapEntry> | null = null;
  private routeDirections: RouteDirectionMap | null = null;
  private stopsMap: Map<string, string> = new Map();
  private manifest: LineManifestEntry[] = [];
  private contractorMap: Map<string, string> = new Map();
  private cachedTripUpdatesBuffer: ArrayBuffer | null = null;
  private lastTripUpdatesFetchTime: number = 0;

  public areKeysConfigured(): boolean { return true; }

  private async getDB(): Promise<IDBDatabase> {
    if (this.db) return this.db;
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (db.objectStoreNames.contains('stops')) db.deleteObjectStore('stops');
        if (db.objectStoreNames.contains('routes')) db.deleteObjectStore('routes');
        db.createObjectStore('stops', { keyPath: 'id' }).createIndex('name', 'name');
        db.createObjectStore('routes', { keyPath: 'id' }).createIndex('line', 'line');
      };
      request.onsuccess = () => { this.db = request.result; resolve(this.db); };
      request.onerror = () => reject(request.error);
    });
  }
  
  async initialize() {
    if (this.isInitialized) return;
    await this.getDB();
    const lastUpdate = localStorage.getItem(STATIC_TS_KEY);
    if (!lastUpdate || (Date.now() - parseInt(lastUpdate)) > CACHE_DURATION) {
      await this.loadStaticDataFromFiles();
    } else {
      await this.loadStopsFromDB();
      this.manifest = await this.getManifestFromDB();
    }
    await this.loadHelperMaps();
    await this.loadContractors();
    this.isInitialized = true;
  }

  async getManifest(): Promise<LineManifestEntry[]> {
    await this.initialize();
    return this.manifest;
  }

  private async loadContractors() {
    try {
        const res = await fetch('/api/contractors');
        if (res.ok) {
            const data = await res.json();
            // Data innehåller arrayer för 'bus', 'metro', etc.
            Object.values(data).forEach((modeList: any) => {
                if (Array.isArray(modeList)) {
                    modeList.forEach((line: any) => {
                        if (line.gid && line.contractor?.name) {
                            this.contractorMap.set(line.gid.toString(), line.contractor.name);
                        }
                    });
                }
            });
        }
    } catch (e) { 
        console.warn("Kunde inte ladda entreprenörsdata:", e); 
    }
  }

  public getContractor(routeId: string): string | undefined {
      return this.contractorMap.get(routeId);
  }

  private async loadHelperMaps() {
    try {
        const tripRes = await fetch(`/data/trip-to-route.json?v=${Date.now()}`);
        if (tripRes.ok) this.tripToRouteMap = await tripRes.json();
        
        const dirRes = await fetch(`/data/route-directions.json?v=${Date.now()}`);
        if (dirRes.ok) {
            this.routeDirections = await dirRes.json();
        }
    } catch(e) { console.warn("Kunde inte ladda hjälpkartor:", e); }
  }

  private async loadStopsFromDB() {
      const db = await this.getDB();
      const tx = db.transaction('stops', 'readonly');
      const req = tx.objectStore('stops').getAll();
      req.onsuccess = () => { if (req.result) req.result.forEach((s: SLStop) => this.stopsMap.set(s.id, s.name)); };
  }

  private async getManifestFromDB(): Promise<LineManifestEntry[]> {
    const db = await this.getDB();
    return new Promise(resolve => {
        const req = db.transaction('routes', 'readonly').objectStore('routes').getAll();
        req.onsuccess = () => resolve(req.result);
    });
  }

  private async loadStaticDataFromFiles() {
    try {
      const [manifestRes, stopsRes] = await Promise.all([fetch('/data/manifest.json'), fetch('/data/stops.json')]);
      this.manifest = await manifestRes.json();
      const stops: SLStop[] = await stopsRes.json();
      stops.forEach(s => this.stopsMap.set(s.id, s.name));

      const db = await this.getDB();
      const tx = db.transaction(['stops', 'routes'], 'readwrite');
      stops.forEach(s => tx.objectStore('stops').put(s));
      this.manifest.forEach((r: LineManifestEntry) => tx.objectStore('routes').put(r));
      localStorage.setItem(STATIC_TS_KEY, Date.now().toString());
    } catch (e) { console.error("Kunde inte ladda data."); }
  }
  
  async search(query: string, currentAgency: 'SL' | 'WAAB'): Promise<SearchResult[]> {
    await this.initialize();
    if (query.trim().length < 1) return [];
    const q = query.toLowerCase();
    const db = await this.getDB();

    return new Promise(resolve => {
        const results: SearchResult[] = [];
        const tx = db.transaction(['routes', 'stops'], 'readonly');
        
        tx.objectStore('routes').openCursor().onsuccess = (e) => {
            const cursor = (e.target as any).result;
            if (cursor) {
                const r = cursor.value as LineManifestEntry;
                // Begränsa antalet linjer till 50 så att vi inte fyller resultatet med bara linjer
                if (results.length < 50 && r.line.toLowerCase().includes(q) && r.agency === currentAgency) {
                    results.push({ type: 'line', id: r.id, title: `Linje ${r.line}`, subtitle: `${r.from} - ${r.to}`, agency: r.agency });
                }
                cursor.continue();
            } else {
                tx.objectStore('stops').openCursor().onsuccess = (e2) => {
                    const c2 = (e2.target as any).result;
                    // Tillåt upp till 100 resultat totalt för att ge plats åt hållplatser
                    if (c2 && results.length < 100) {
                        const s = c2.value as SLStop;
                        const stopAgency = s.agency || 'SL';
                        if (s.name.toLowerCase().includes(q) && stopAgency === currentAgency) {
                            results.push({ type: 'stop', id: s.id, title: s.name, subtitle: currentAgency === 'WAAB' ? 'Brygga' : 'Hållplats', agency: stopAgency });
                        }
                        c2.continue();
                    } else resolve(results);
                };
            }
        };
    });
  }

  async getLineRoute(routeId: string): Promise<SLLineRoute | null> {
    const res = await fetch(`/data/lines/${routeId}.json`);
    if (!res.ok) return null;
    return await res.json();
  }

  async getStopInfo(stopId: string): Promise<SLStop | null> {
    const db = await this.getDB();
    return new Promise(resolve => {
      const req = db.transaction('stops', 'readonly').objectStore('stops').get(stopId);
      req.onsuccess = () => resolve(req.result);
    });
  }

  async getLiveVehicles(currentAgency?: 'SL' | 'WAAB'): Promise<SLVehicle[]> {
    await this.initialize();
    try {
        const now = Date.now();
        const shouldFetchUpdates = !this.cachedTripUpdatesBuffer || (now - this.lastTripUpdatesFetchTime > 30000);

        let posResPromise = fetch(RT_VEHICLE_URL);
        let updatesResPromise = shouldFetchUpdates ? fetch(RT_TRIP_UPDATES_URL) : Promise.resolve(null);

        const [posRes, updatesRes] = await Promise.all([posResPromise, updatesResPromise]);

        const posBuffer = await posRes.arrayBuffer();
        
        let updatesBuffer: ArrayBuffer;
        if (shouldFetchUpdates && updatesRes) {
            updatesBuffer = await updatesRes.arrayBuffer();
            this.cachedTripUpdatesBuffer = updatesBuffer;
            this.lastTripUpdatesFetchTime = now;
        } else {
            updatesBuffer = this.cachedTripUpdatesBuffer!;
        }

        const root = await this.getRTRoot();
        const FeedMessage = root.lookupType("transit_realtime.FeedMessage");
        
        const posMessage = FeedMessage.decode(new Uint8Array(posBuffer));
        const posObject = FeedMessage.toObject(posMessage, { enums: String, longs: String });

        const updatesMessage = FeedMessage.decode(new Uint8Array(updatesBuffer));
        const updatesObject = FeedMessage.toObject(updatesMessage, { enums: String, longs: String });

        // Mappa tripId -> delay, directionId, routeId och lastStopId
        const tripInfoMap: Map<string, { delay?: number, directionId?: number, routeId?: string, lastStopId?: string }> = new Map();
        
        (updatesObject.entity || []).forEach((e: any) => {
            if (e.tripUpdate && e.tripUpdate.trip) {
                const tId = e.tripUpdate.trip.tripId || e.tripUpdate.trip.trip_id;
                const stu = e.tripUpdate.stopTimeUpdate;
                if (stu && stu.length > 0) {
                    const first = stu[0];
                    const delay = first.arrival?.delay !== undefined ? first.arrival.delay : 
                                 first.departure?.delay !== undefined ? first.departure.delay : undefined;
                    
                    // Hämta lastStopId från sista uppdateringen
                    const last = stu[stu.length - 1];
                    const lastStopId = last?.stopId || last?.stop_id;
                    
                    // Hämta directionId och routeId från tripUpdate (gammal enkel logik)
                    const directionId = e.tripUpdate.trip.directionId ?? e.tripUpdate.trip.direction_id;
                    const routeId = e.tripUpdate.trip.routeId ?? e.tripUpdate.trip.route_id;
                    
                    // Om vi har tripId, spara all information
                    if (tId) {
                        tripInfoMap.set(tId, { delay, directionId, routeId, lastStopId });
                    }
                }
            }
        });
        
        const vehicles: SLVehicle[] = [];
        for (const entity of (posObject.entity || [])) {
            const v = entity.vehicle;
            if (!v || !v.trip || !v.position) continue;
            const tripId = v.trip.tripId || v.trip.trip_id;
            const mapInfo = this.tripToRouteMap?.[tripId];
            if (!mapInfo) continue;

            // Hämta info från tripInfoMap för att fylla i saknade värden (gammal enkel logik)
            const info = tripInfoMap.get(tripId);

            let routeId = mapInfo.r;
            if (!routeId && info?.routeId) routeId = info.routeId;
            let directionId = v.trip.directionId ?? v.trip.direction_id;
            
            // Fyll i från tripInfo om det saknas
            if (info) {
                if (directionId === undefined || directionId === null) directionId = info.directionId;
                if (!routeId && info.routeId) routeId = info.routeId;
            }

            const routeManifest = this.manifest.find(m => m.id === routeId);
            if (!routeManifest) continue;

            if (currentAgency && routeManifest.agency !== currentAgency) continue;

            // Använd sofistikerad destination-logik från gamla versionen
            let headsign = "Okänd";
            let fallbackUsed = "none";
            
            // Försök med mapInfo.h först
            if (mapInfo.h) {
                headsign = mapInfo.h;
                fallbackUsed = "mapInfo.h";
            }
            
            // Fallback till routeDirections om det finns
            if ((!headsign || headsign === "Okänd") && directionId !== undefined && directionId !== null && this.routeDirections) {
                const dirStr = String(directionId);
                const fallbackHeadsign = this.routeDirections[routeId]?.[dirStr];
                if (fallbackHeadsign) {
                    headsign = fallbackHeadsign;
                    fallbackUsed = "routeDirections";
                }
            }
            
            // Tredje fallback: använd lastStopId för att få hållplatsnamn
            if (!headsign || headsign === "Okänd") {
                if (info?.lastStopId) {
                    const stopName = this.stopsMap.get(info.lastStopId);
                    if (stopName) {
                        headsign = stopName;
                        fallbackUsed = "lastStopId";
                    }
                }
            }
            
            // Fjärde fallback: använd route manifest to/from som destination
            if (!headsign || headsign === "Okänd") {
                // Använd "to" fältet från route manifest som destination
                if (routeManifest.to && routeManifest.to !== routeManifest.from) {
                    headsign = routeManifest.to;
                    fallbackUsed = "routeManifest.to";
                }
            }
            
            vehicles.push({
                id: v.vehicle?.id || entity.id,
                line: routeId,
                tripId: tripId,
                operator: routeManifest.agency === 'WAAB' ? "Blidösundsbolaget" : "SL",
                vehicleNumber: v.vehicle?.label || v.vehicle?.id?.slice(-4) || "N/A",
                lat: v.position.latitude,
                lng: v.position.longitude,
                bearing: v.position.bearing || 0,
                speed: (v.position.speed || 0) * 3.6,
                destination: headsign,
                type: routeManifest.agency === 'WAAB' ? 'Färja' : 'Buss',
                agency: routeManifest.agency,
                delay: info?.delay
            });
        }
        return vehicles;
    } catch(e) { 
        console.error("Fel vid hämtning av realtidsdata:", e);
        return []; 
    }
  }

  async findVehicle(vNum: string): Promise<{vehicle: SLVehicle, routeId: string} | null> {
    const all = await this.getLiveVehicles();
    const found = all.find(v => v.vehicleNumber === vNum || v.id.endsWith(vNum));
    return found ? { vehicle: found, routeId: found.line } : null;
  }

  async getVehicleHistory(tripId: string): Promise<HistoryPoint[]> {
      const res = await fetch(`/api/history?tripId=${tripId}`);
      if (!res.ok) return [];
      const data = await res.json();
      return data.path || [];
  }

  private async getRTRoot() {
    if (this.rtRoot) return this.rtRoot;
    this.rtRoot = await protobuf.parse(`
      syntax = "proto2";
      package transit_realtime;
      message FeedMessage { required FeedHeader header = 1; repeated FeedEntity entity = 2; }
      message FeedHeader { required string gtfs_realtime_version = 1; optional uint64 timestamp = 3; }
      message FeedEntity { required string id = 1; optional VehiclePosition vehicle = 4; optional TripUpdate trip_update = 3; }
      message VehiclePosition { optional TripDescriptor trip = 1; optional VehicleDescriptor vehicle = 8; optional Position position = 2; }
      message TripUpdate { optional TripDescriptor trip = 1; repeated StopTimeUpdate stop_time_update = 2; }
      message StopTimeUpdate { optional uint32 stop_sequence = 1; optional string stop_id = 4; optional StopTimeEvent arrival = 2; optional StopTimeEvent departure = 3; }
      message StopTimeEvent { optional int32 delay = 1; optional int64 time = 2; }
      message TripDescriptor { optional string trip_id = 1; optional string route_id = 5; optional uint32 direction_id = 6; }
      message VehicleDescriptor { optional string id = 1; optional string label = 2; }
      message Position { required float latitude = 1; required float longitude = 2; optional float bearing = 3; optional float speed = 5; }
    `).root;
    return this.rtRoot;
  }
}
export const slService = new SLService();
