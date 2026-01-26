
export interface SLStop {
  id: string;
  name: string;
  lat: number;
  lng: number;
  lines: string[];
}

export interface SLVehicle {
  id: string;
  line: string; // Detta kommer vara route_id
  tripId: string;
  operator: string;
  vehicleNumber: string;
  lat: number;
  lng: number;
  bearing: number;
  speed: number;
  destination: string;
  type: 'Buss' | 'Tåg' | 'Tunnelbana' | 'Spårvagn';
  delay?: number; // Försening i sekunder
}

export interface SLLineRoute {
  id: string; // route_id
  line: string; // short name, t.ex. "191"
  trip_ids: string[];
  path: [number, number][];
  stops: SLStop[];
}

export interface SearchResult {
  type: 'line' | 'stop';
  id: string;
  title: string;
  subtitle?: string;
}

export interface HistoryPoint {
  lat: number;
  lng: number;
  ts: number;
}
