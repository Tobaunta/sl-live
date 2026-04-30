
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, CircleMarker, useMap, Tooltip } from 'react-leaflet';
import L from 'leaflet';
import SearchBar from './components/SearchBar';
import VehiclePopup from './components/VehiclePopup';
import VehicleSearch from './components/VehicleSearch';
import { slService, LineManifestEntry } from './services/slService';
import { SLVehicle, SLLineRoute, SearchResult, SLStop, HistoryPoint } from './types';
import { RefreshCw, Clock, Timer, X, Train, Ship, TramFront, Bus, Trash2, Building2, ArrowDown, TrainFront } from 'lucide-react';

// Fix för Leaflet ikoner
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

interface MapView {
  center: [number, number];
  zoom: number;
  bounds?: L.LatLngBoundsExpression;
}

const SL_DEFAULT_VIEW: MapView = {
  center: [59.3293, 18.0686],
  zoom: 12,
  bounds: undefined
};

const WAAB_DEFAULT_VIEW: MapView = {
  center: [59.35, 18.65], // Panorerat mer mot skärgården (mellan Vaxholm, Möja och Sandhamn)
  zoom: 10,
  bounds: undefined
};

const NO_BEARING_LINES = ['7', '12', '21', '25', '26', '27', '28', '29', '30', '31'];

const getDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const R = 6371e3;
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

// Hjälpfunktion för att hämta färg baserat på linjenummer (samma logik som i SearchBar/Popup)
const getLineColor = (lineString: string, agency?: string) => {
    if (agency === 'WAAB') return '#0891b2'; // Cyan
    const lineName = lineString.replace('Linje ', '').trim();
    const num = parseInt(lineName);
    const blueBusLines = [1, 2, 3, 4, 5, 6, 172, 173, 176, 177, 178, 179, 471, 474, 670, 676, 677, 873, 875];
    
    if (!isNaN(num)) {
        if (blueBusLines.includes(num)) return '#2563eb'; // Blue-600
        if ([10, 11].includes(num)) return '#1d4ed8'; // Blue-700 (TB Blå)
        if ([13, 14].includes(num)) return '#dc2626'; // Red-600 (TB Röd)
        if ([17, 18, 19].includes(num)) return '#16a34a'; // Green-600 (TB Grön)
        if ([40, 41, 42, 43, 44, 48].includes(num)) return '#ec4899'; // Pink-500 (Pendel)
        if (num === 7) return '#4b5563'; // Gray-600 (Spårväg City)
        if (num === 12) return '#475569'; // Slate-600 (Nockeby)
        if (num === 21) return '#b45309'; // Amber-700 (Lidingö)
        if ([30, 31].includes(num)) return '#ea580c'; // Orange-600 (Tvärbanan)
        if ([25, 26].includes(num)) return '#0d9488'; // Teal-600 (Saltsjö)
        if ([27, 28, 29].includes(num)) return '#9333ea'; // Purple-600 (Roslags)
        if ([80, 82, 83, 84, 89].includes(num)) return '#0891b2'; // Cyan-600 (Båt)
        
        // Standard röd buss
        const isRedBus = ![10, 11, 13, 14, 17, 18, 19, 7, 12, 30, 31, 21, 25, 26, 27, 28, 29, 40, 41, 42, 43, 44, 48, 80, 82, 83, 84, 89].includes(num);
        if (isRedBus) return '#dc2626'; 
    }
    return '#2563eb'; // Default Blue
};

// Hjälpfunktion för att hämta ikon baserat på linje
const getTransportIcon = (lineString: string, agency?: string) => {
    if (agency === 'WAAB') return Ship;
    const lineName = lineString.replace('Linje ', '').trim();
    const num = parseInt(lineName);
    
    if (isNaN(num)) return Bus;

    // Tunnelbana
    if ([10, 11, 13, 14, 17, 18, 19].includes(num)) return TrainFront;

    // Spårväg / Lokalbanor
    if ([7, 12, 21, 30, 31].includes(num)) return TramFront;

    // Tåg
    if ([25, 26, 27, 28, 29, 40, 41, 42, 43, 44, 48].includes(num)) return Train;

    // Båt
    if ([80, 82, 83, 84, 89].includes(num)) return Ship;

    return Bus;
};

interface VehicleMarkerProps {
  vehicle: SLVehicle;
  lineShortName: string;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onDeselect: () => void;
}

const VehicleMarker: React.FC<VehicleMarkerProps> = ({ vehicle, lineShortName, isSelected, onSelect, onDeselect }) => {
  const markerRef = useRef<L.Marker>(null);
  
  const icon = useMemo(() => {
    // Använd lineShortName (t.ex. "40") istället för vehicle.line (routeId) för att få rätt färg
    const color = getLineColor(lineShortName, vehicle.agency);
    const isNoBearing = NO_BEARING_LINES.includes(lineShortName);
    
    let markerHtml = '';
    if (isNoBearing) {
      markerHtml = `
        <div style="width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; position: relative;">
          <div style="width: 20px; height: 20px; background: ${color}; border: 3px solid white; border-radius: 50%; box-shadow: 0 2px 8px rgba(0,0,0,0.5);"></div>
          <div style="position: absolute; top: -14px; left: 50%; transform: translateX(-50%); background: ${color}; color: white; padding: 1px 6px; border-radius: 4px; font-size: 10px; font-weight: 800; white-space: nowrap; box-shadow: 0 2px 4px rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.2);">
            ${lineShortName}
          </div>
        </div>
      `;
    } else {
      markerHtml = `
        <div style="transform: rotate(${vehicle.bearing}deg); width: 34px; height: 34px; display: flex; align-items: center; justify-content: center; position: relative;">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="width: 100%; height: 100%; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.4));">
            <path d="M12 2L4 21L12 17L20 21L12 2Z" fill="${color}" stroke="white" stroke-width="2" stroke-linejoin="round"/>
          </svg>
          <div style="position: absolute; top: -15px; left: 50%; transform: translateX(-50%) rotate(${-vehicle.bearing}deg); background: ${color}; color: white; padding: 1px 5px; border-radius: 3px; font-size: 9px; font-weight: 800; white-space: nowrap; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">
            ${lineShortName}
          </div>
        </div>
      `;
    }

    return L.divIcon({
        className: 'custom-vehicle-icon',
        html: markerHtml,
        iconSize: isNoBearing ? [40, 40] : [34, 34],
        iconAnchor: isNoBearing ? [20, 20] : [17, 17]
      });
  }, [vehicle.bearing, lineShortName, vehicle.agency]); 

  useEffect(() => {
    if (markerRef.current) {
        if (isSelected) {
            if (!markerRef.current.isPopupOpen()) markerRef.current.openPopup();
        } else {
            if (markerRef.current.isPopupOpen()) markerRef.current.closePopup();
        }
    }
  }, [isSelected, vehicle.lat, vehicle.lng]);

  return (
    <Marker 
      ref={markerRef} 
      position={[vehicle.lat, vehicle.lng]} 
      icon={icon} 
      eventHandlers={{ 
        click: () => onSelect(vehicle.id), 
        popupclose: () => { if (isSelected) onDeselect(); }
      }}
    >
      <Popup className="custom-popup" autoPan={false} closeButton={true}>
        <VehiclePopup vehicle={vehicle} lineShortName={lineShortName} />
      </Popup>
    </Marker>
  );
};

const MapController = ({ center, zoom, bounds }: { center: [number, number]; zoom: number; bounds?: L.LatLngBoundsExpression }) => {
  const map = useMap();
  useEffect(() => { if (bounds) map.fitBounds(bounds, { padding: [50, 50] }); else map.setView(center, zoom); }, [center, zoom, bounds, map]);
  return null;
};

const App: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [agency, setAgency] = useState<'SL' | 'WAAB'>('SL');
  const [vehicles, setVehicles] = useState<SLVehicle[]>([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  
  const [selectedRoutes, setSelectedRoutes] = useState<SLLineRoute[]>([]);
  
  const [activeStop, setActiveStop] = useState<SLStop | null>(null);
  const [mapConfig, setMapConfig] = useState<MapView>(SL_DEFAULT_VIEW);
  const [routeManifest, setRouteManifest] = useState<Map<string, LineManifestEntry>>(new Map());
  const [searchQuery, setSearchQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const activeTripIdRef = useRef<string | null>(null);
  const lastHistoryFetchRef = useRef<number>(0);
  const currentTripIdRef = useRef<string | null>(null);

  useEffect(() => {
    (async () => {
      await slService.initialize();
      const m = await slService.getManifest();
      setRouteManifest(new Map(m.map(x => [x.id, x])));
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (loading) return;
    const fetchData = async () => {
      const v = await slService.getLiveVehicles(agency);
      setVehicles(v);
    };
    fetchData();
    const i = setInterval(fetchData, 5000);
    return () => clearInterval(i);
  }, [loading, agency]);

  useEffect(() => {
    if (selectedVehicleId) {
        const v = vehicles.find(x => x.id === selectedVehicleId);
        if (v) {
            currentTripIdRef.current = v.tripId;
            const now = Date.now();
            
            // Hämta historik om det är en ny trip ELLER om det har gått mer än 5 sekunder
            if (activeTripIdRef.current !== v.tripId || now - lastHistoryFetchRef.current >= 5000) {
                activeTripIdRef.current = v.tripId;
                lastHistoryFetchRef.current = now;
                
                slService.getVehicleHistory(v.tripId).then(h => {
                    if (currentTripIdRef.current === v.tripId) {
                        setHistory(h);
                    }
                });
            }
            
            if (!selectedRoutes.some(r => r.id === v.line)) {
                slService.getLineRoute(v.line).then(r => {
                    if (currentTripIdRef.current === v.tripId && r) {
                        setSelectedRoutes(prev => prev.some(pr => pr.id === r.id) ? prev : [...prev, r]);
                    }
                });
            }
        }
    } else {
        currentTripIdRef.current = null;
        activeTripIdRef.current = null;
        lastHistoryFetchRef.current = 0;
        setHistory([]);
    }
  }, [selectedVehicleId, vehicles]); 

  const stopPassages = useMemo(() => {
    if (selectedRoutes.length === 0 || history.length === 0) return new Map();
    const passages = new Map<string, { time: string, stopped: boolean, duration?: string, departureTime?: string }>();
    
    selectedRoutes.forEach(route => {
        route.stops.forEach(stop => {
            const anyNearbyPoints = history.filter(p => getDistance(p.lat, p.lng, stop.lat, stop.lng) < 100);
            
            if (anyNearbyPoints.length > 0) {
                anyNearbyPoints.sort((a, b) => a.ts - b.ts);
                let arrivalTime = new Date(anyNearbyPoints[0].ts).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                
                const strictPoints = anyNearbyPoints.filter(p => getDistance(p.lat, p.lng, stop.lat, stop.lng) < 35);
                let isActuallyStopped = false;
                let durationStr = "";
                let departureTimeStr = "";

                if (strictPoints.length >= 2) {
                    const durationSec = Math.round((strictPoints[strictPoints.length - 1].ts - strictPoints[0].ts) / 1000);
                    if (durationSec > 10) {
                        isActuallyStopped = true;
                        
                        // Använd strictPoints för ankomsttid så att matematiken stämmer med stopptiden
                        arrivalTime = new Date(strictPoints[0].ts).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                        
                        const mins = Math.floor(durationSec / 60);
                        const secs = durationSec % 60;
                        durationStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
                        departureTimeStr = new Date(strictPoints[strictPoints.length - 1].ts).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                    }
                }

                passages.set(stop.id, {
                    time: arrivalTime,
                    stopped: isActuallyStopped,
                    duration: durationStr,
                    departureTime: departureTimeStr
                });
            }
        });
    });
    
    return passages;
  }, [selectedRoutes, history]);

  const handleClear = () => { 
    setSelectedRoutes([]); 
    setActiveStop(null); 
    setSelectedVehicleId(null); 
    setHistory([]);
    setMapConfig(agency === 'WAAB' ? WAAB_DEFAULT_VIEW : SL_DEFAULT_VIEW); 
    setSearchQuery(''); 
  };

  const handleRemoveRoute = (routeId: string) => {
      const newRoutes = selectedRoutes.filter(r => r.id !== routeId);
      setSelectedRoutes(newRoutes);
      
      if (newRoutes.length === 0) {
          handleClear();
      } else {
          const allPoints = newRoutes.flatMap(r => r.path);
          if (allPoints.length > 0) {
              const b = L.latLngBounds(allPoints);
              setMapConfig(prev => ({ ...prev, bounds: b }));
          }
      }
  };

  const handleSelect = async (res: SearchResult) => {
    if (res.type === 'line') {
        setSelectedVehicleId(null);
        setHistory([]);
        
        if (selectedRoutes.some(r => r.id === res.id)) {
            return;
        }

        const r = await slService.getLineRoute(res.id);
        if (r) { 
            const newRoutes = [...selectedRoutes, r];
            setSelectedRoutes(newRoutes); 
            setActiveStop(null); 
            
            const allPoints = newRoutes.flatMap(route => route.path);
            const b = L.latLngBounds(allPoints); 
            setMapConfig({ center: [b.getCenter().lat, b.getCenter().lng], zoom: 12, bounds: b }); 
        }
    } else {
        // Hållplats vald
        // Behåll valda linjer, men rensa vald fordonshistorik för att fokusera på platsen
        setSelectedVehicleId(null);
        setHistory([]);
        // Notera: Vi kör inte setSelectedRoutes([]) här längre

        const s = await slService.getStopInfo(res.id);
        if (s) { 
            setActiveStop(s); 
            // Zooma in närmare (16) istället för 14
            setMapConfig({ center: [s.lat, s.lng], zoom: 16 }); 
        }
    }
  };

  const handleAgencyChange = (newAgency: 'SL' | 'WAAB') => {
    setAgency(newAgency);
    const view = newAgency === 'WAAB' ? WAAB_DEFAULT_VIEW : SL_DEFAULT_VIEW;
    setSelectedRoutes([]); 
    setActiveStop(null); 
    setSelectedVehicleId(null); 
    setHistory([]);
    setMapConfig(view); 
    setSearchQuery(''); 
  };

  if (loading) return <div className="h-full flex flex-col items-center justify-center bg-slate-900 text-white"><RefreshCw className="w-12 h-12 animate-spin text-blue-500 mb-4" />Laddar trafikdata...</div>;

  return (
    <div className="relative w-full h-full flex flex-col">
      {/* Centrerat sökfält i toppen */}
      <div className="absolute top-4 left-0 right-0 z-[3000] px-4 pointer-events-none flex flex-col items-center gap-2">
        <div className="w-full max-w-lg pointer-events-auto">
          <SearchBar 
            onSelect={handleSelect} 
            onClear={handleClear} 
            activeRoute={null}
            selectedRoutes={selectedRoutes} // Skicka med valda rutter för filtrering
            searchQuery={searchQuery} 
            onSearchChange={setSearchQuery} 
            currentAgency={agency} 
            stopPassages={stopPassages}
          />
        </div>

        {/* Lista med valda linjer (Taggar/Chips) */}
        {selectedRoutes.length > 0 && (
            <div className="flex flex-wrap justify-center gap-2 pointer-events-auto max-w-3xl animate-in fade-in slide-in-from-top-2 duration-300 items-start">
                {selectedRoutes.map(route => {
                    const color = getLineColor(route.line, route.agency);
                    const operator = slService.getContractor(route.id) || (route.agency === 'WAAB' ? 'Blidösundsbolaget' : 'Okänd');
                    const TransportIcon = getTransportIcon(route.line, route.agency);
                    
                    return (
                        <div key={route.id} className="flex items-center gap-2 bg-slate-900/90 backdrop-blur-md text-white pl-3 pr-2 py-1.5 rounded-xl shadow-lg border border-white/10 group hover:bg-slate-800 transition-colors">
                            {/* Ersatt prick med Ikon */}
                            <TransportIcon className="w-4 h-4 shrink-0 mt-0.5" style={{ color: color }} />
                            
                            <div className="flex flex-col min-w-0">
                                <span className="text-xs font-bold whitespace-nowrap leading-none">
                                    Linje {route.line}
                                </span>
                                <span className="text-[9px] text-slate-500 font-bold uppercase tracking-wider leading-none truncate max-w-[60px]">
                                    {operator}
                                </span>
                            </div>

                            <div className="h-6 w-px bg-white/10 mx-1"></div>
                            
                            <div className="flex flex-col min-w-0 leading-tight">
                                <span className="text-[10px] text-slate-300 font-medium truncate max-w-[100px]">
                                    {route.stops[0].name}
                                </span>
                                <span className="text-[10px] text-slate-300 font-medium truncate max-w-[100px]">
                                    {route.stops[route.stops.length-1].name}
                                </span>
                            </div>
                            
                            <button 
                                onClick={(e) => { e.stopPropagation(); handleRemoveRoute(route.id); }}
                                className="p-1 hover:bg-white/10 rounded-full transition-colors ml-1"
                            >
                                <X className="w-3.5 h-3.5 text-slate-400 group-hover:text-white" />
                            </button>
                        </div>
                    );
                })}
                
                {/* Rensa alla knapp - Uppdaterad design */}
                <button 
                    onClick={handleClear}
                    className="flex items-center gap-2 bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white px-3 py-2.5 rounded-xl shadow-lg border border-white/10 backdrop-blur-md transition-all text-xs font-bold active:scale-95 group h-full self-stretch"
                >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Rensa alla</span>
                </button>
            </div>
        )}
      </div>

      {/* Status-paneler (Live status & Sök) */}
      <div className="absolute bottom-6 left-6 right-6 z-[1000] flex flex-col sm:flex-row justify-between items-end gap-4 pointer-events-none">
        {/* Live Status (Vänster) */}
        <div className="bg-slate-900/90 backdrop-blur-xl p-4 rounded-2xl shadow-2xl border border-white/10 pointer-events-auto w-full sm:w-auto sm:min-w-[280px]">
            <div className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-4 flex items-center justify-between border-b border-white/5 pb-2">
                <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" /> Live Status
                </div>
            </div>
            
            <div className="space-y-4">
                <div className="flex items-center justify-between gap-4 px-1">
                    <span className="text-xs text-slate-300 font-bold">
                        {selectedRoutes.length > 0 
                            ? `Fordon på valda linjer` 
                            : 'Fordon i trafik'}
                    </span>
                    <span className="text-xs text-white font-bold bg-slate-800/50 px-2.5 py-1.5 rounded-xl border border-white/5 shadow-inner">
                        {selectedRoutes.length > 0 
                            ? vehicles.filter(v => selectedRoutes.some(r => r.id === v.line)).length 
                            : vehicles.length}
                    </span>
                </div>
                
                <div className="flex items-center justify-between gap-8 pt-3 border-t border-white/5 px-1">
                    <span className="text-xs text-slate-300 font-bold">Visa all trafik</span>
                    <label className="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} className="sr-only peer" />
                        <div className="w-11 h-6 bg-slate-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600 border border-white/5 shadow-inner"></div>
                    </label>
                </div>
            </div>
        </div>
        
        {/* Fordonssökning + Agency Toggle (Höger) */}
        <div className="pointer-events-auto w-full sm:w-auto">
            <VehicleSearch 
              currentAgency={agency} 
              onAgencyChange={handleAgencyChange}
              onVehicleFound={async (v, routeId) => {
                setSelectedVehicleId(null);
                setHistory([]);
                
                if (!selectedRoutes.some(r => r.id === routeId)) {
                    const r = await slService.getLineRoute(routeId);
                    if (r) {
                        setSelectedRoutes(prev => [...prev, r]);
                        const b = L.latLngBounds(r.path);
                        setMapConfig({ 
                            center: [b.getCenter().lat, b.getCenter().lng], 
                            zoom: 12, 
                            bounds: b 
                        });
                    }
                }
                setTimeout(() => setSelectedVehicleId(v.id), 50);
              }} 
            />
        </div>
      </div>

      <MapContainer center={mapConfig.center} zoom={mapConfig.zoom} zoomControl={false} className="flex-1 w-full">
        <TileLayer url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png" />
        <MapController center={mapConfig.center} zoom={mapConfig.zoom} bounds={mapConfig.bounds} />
        
        {/* Rendera alla valda rutter - Använd standardfärger för linjer */}
        {selectedRoutes.map(route => {
            // Standardfärg för linjesträckning och hållplatser (Blå för SL, Cyan för WAAB)
            const standardColor = route.agency === 'WAAB' ? "#0891b2" : "#3b82f6";
            
            return (
            <React.Fragment key={route.id}>
                {route.path && route.path.length > 0 && (
                <Polyline 
                    positions={route.path.filter(p => p && typeof p[0] === 'number' && typeof p[1] === 'number') as [number, number][]} 
                    color={standardColor} 
                    weight={6} 
                    opacity={0.6} 
                />
                )}
                {route.stops.map(s => {
                    const passage = stopPassages.get(s.id);
                    let markerFill = "#ffffff";
                    if (passage) {
                        markerFill = passage.stopped ? "#10b981" : "#f59e0b";
                    }
                    
                    return (
                        <CircleMarker 
                            key={`${route.id}-${s.id}-${markerFill}`}
                            center={[s.lat, s.lng]} 
                            radius={passage ? 8 : 5}
                            fillColor={markerFill}
                            fillOpacity={1} 
                            color={standardColor} 
                            weight={2} 
                            eventHandlers={{ click: () => setActiveStop(s) }}
                        >
                            <Tooltip direction="top" offset={[0, -10]} opacity={0.9} className="custom-tooltip">
                                <div className="p-1 font-sans">
                                    <div className="text-xs font-bold text-slate-900">{s.name}</div>
                                    <div className="text-[10px] text-slate-500 font-semibold">Linje {route.line}</div>
                                    {passage && (
                                        <div className="mt-1 flex flex-col gap-0.5">
                                            {passage.stopped ? (
                                                <>
                                                    <div className="flex items-center gap-1.5 text-[10px] font-bold text-emerald-600">
                                                        <Clock className="w-3 h-3" />
                                                        Ankom: {passage.time} ({passage.duration})
                                                    </div>
                                                    {passage.departureTime && (
                                                        <div className="flex items-center gap-1.5 text-[10px] font-bold text-emerald-600">
                                                            <Clock className="w-3 h-3 opacity-0" />
                                                            Avgick: {passage.departureTime}
                                                        </div>
                                                    )}
                                                </>
                                            ) : (
                                                <div className="flex items-center gap-1.5 text-[10px] font-bold text-amber-600">
                                                    <Clock className="w-3 h-3" />
                                                    Passerade {passage.time}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </Tooltip>
                        </CircleMarker>
                    );
                })}
            </React.Fragment>
            );
        })}

        {activeStop && <Marker position={[activeStop.lat, activeStop.lng]}><Popup>{activeStop.name}</Popup></Marker>}
        
        {history.length > 1 && (
            <Polyline 
                positions={history.filter(p => p && typeof p.lat === 'number' && typeof p.lng === 'number').map(p => [p.lat, p.lng] as [number, number])} 
                color="#ef4444" 
                weight={3} 
                dashArray="5, 10" 
                opacity={0.8}
            />
        )}
        
        {/* Fordon renderas med unika färger via VehicleMarker */}
        {vehicles.filter(v => showAll || selectedRoutes.some(r => r.id === v.line) || selectedVehicleId === v.id).map(v => {
            return (
              <VehicleMarker 
                  key={v.id} 
                  vehicle={v} 
                  lineShortName={routeManifest.get(v.line)?.line || '?'} 
                  isSelected={selectedVehicleId === v.id} 
                  onSelect={setSelectedVehicleId} 
                  onDeselect={() => setSelectedVehicleId(null)} 
              />
            );
        })}
      </MapContainer>
    </div>
  );
};

export default App;
