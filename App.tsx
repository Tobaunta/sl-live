
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, CircleMarker, useMap, useMapEvents, Tooltip } from 'react-leaflet';
import L from 'leaflet';
import SearchBar from './components/SearchBar';
import VehiclePopup from './components/VehiclePopup';
import VehicleSearch from './components/VehicleSearch';
import { slService, LineManifestEntry } from './services/slService';
import { SLVehicle, SLLineRoute, SearchResult, SLStop, HistoryPoint } from './types';
import { RefreshCw, Map as MapIcon, AlertTriangle, MapPin, X } from 'lucide-react';

// Fix för Leaflet ikoner
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

const DEFAULT_VIEW: { center: [number, number]; zoom: number; bounds?: L.LatLngBoundsExpression } = {
  center: [59.3293, 18.0686],
  zoom: 12,
  bounds: undefined
};

interface AutoOpenMarkerProps {
  position: [number, number];
  stopId: string;
  children?: React.ReactNode;
  eventHandlers?: L.LeafletEventHandlerFnMap;
}

// Komponent för att automatiskt öppna popup när markören visas eller byts ut
const AutoOpenMarker: React.FC<AutoOpenMarkerProps> = ({ position, stopId, children, ...props }) => {
  const markerRef = useRef<L.Marker>(null);
  
  useEffect(() => {
    if (markerRef.current && stopId) {
      markerRef.current.openPopup();
    }
  }, [stopId]);

  return (
    <Marker ref={markerRef} position={position} {...props}>
      {children}
    </Marker>
  );
};

interface VehicleMarkerProps {
  vehicle: SLVehicle;
  lineShortName: string;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onDeselect: () => void;
}

// Komponent för fordon som ser till att popupen stannar öppen om fordonet är valt
const VehicleMarker: React.FC<VehicleMarkerProps> = ({ vehicle, lineShortName, isSelected, onSelect, onDeselect }) => {
  const markerRef = useRef<L.Marker>(null);
  const icon = useMemo(() => createVehicleIcon(vehicle.bearing, lineShortName), [vehicle.bearing, lineShortName]);

  useEffect(() => {
    // Om fordonet är valt, se till att popupen är öppen även när positionen uppdateras
    if (isSelected && markerRef.current) {
      if (!markerRef.current.isPopupOpen()) {
        markerRef.current.openPopup();
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
        popupclose: () => {
          // Om popupen stängs (t.ex. av användaren), avmarkera fordonet
          // så att det inte tvingas öppet igen vid nästa positionsuppdatering.
          if (isSelected) {
            onDeselect();
          }
        }
      }}
    >
      <Popup className="custom-popup">
        <VehiclePopup vehicle={vehicle} lineShortName={lineShortName} />
      </Popup>
    </Marker>
  );
};

const createVehicleIcon = (bearing: number, lineShortName: string) => {
  const displayName = lineShortName || '?';
  return L.divIcon({
    className: 'custom-vehicle-icon',
    html: `
      <div style="transform: rotate(${bearing}deg); width: 34px; height: 34px; display: flex; align-items: center; justify-content: center; position: relative;">
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="width: 100%; height: 100%; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.4));">
          <path d="M12 2L4 21L12 17L20 21L12 2Z" fill="#3B82F6" stroke="white" stroke-width="2" stroke-linejoin="round"/>
        </svg>
        <div style="position: absolute; top: -15px; left: 50%; transform: translateX(-50%) rotate(${-bearing}deg); background: #2563eb; color: white; padding: 1px 5px; border-radius: 3px; font-size: 9px; font-weight: 800; white-space: nowrap; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">
          ${displayName}
        </div>
      </div>
    `,
    iconSize: [34, 34],
    iconAnchor: [17, 17]
  });
};

const MapController = ({ center, zoom, bounds }: { center: [number, number]; zoom: number; bounds?: L.LatLngBoundsExpression }) => {
  const map = useMap();
  useEffect(() => {
    if (bounds) {
      map.fitBounds(bounds, { padding: [50, 50], animate: true, duration: 1 });
    } else {
      map.setView(center, zoom, { animate: true, duration: 1.5 });
    }
  }, [center, zoom, bounds, map]);
  return null;
};

// Hjälpkomponent för att lyssna på kartrörelser och uppdatera bounds
const MapBoundsReporter = ({ onBoundsChange }: { onBoundsChange: (bounds: L.LatLngBounds) => void }) => {
  const map = useMap();
  
  // Sätt bounds vid start
  useEffect(() => {
    onBoundsChange(map.getBounds());
  }, []);

  useMapEvents({
    moveend: () => onBoundsChange(map.getBounds()),
    zoomend: () => onBoundsChange(map.getBounds())
  });

  return null;
};

const ApiKeyWarning = () => (
  <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[2000] w-full max-w-2xl px-4 pointer-events-none">
    <div className="bg-red-600/90 backdrop-blur-md text-white p-4 rounded-xl shadow-lg flex items-start gap-3 border border-red-400">
      <AlertTriangle className="w-8 h-8 flex-shrink-0 mt-0.5" />
      <div>
        <h3 className="font-bold">Serverkonfigurationsfel</h3>
        <p className="text-sm text-red-100 mt-1">
          Applikationen kan inte hämta realtidsdata. Kontrollera att <code>RT_API_KEY</code> är korrekt inställd.
        </p>
      </div>
    </div>
  </div>
);

const App: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [loadingMessage, setLoadingMessage] = useState('Startar applikationen...');
  const [isApiConfigured, setIsApiConfigured] = useState<boolean | null>(null);
  const [vehicles, setVehicles] = useState<SLVehicle[]>([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [activeRoute, setActiveRoute] = useState<SLLineRoute | null>(null);
  const [activeStop, setActiveStop] = useState<SLStop | null>(null);
  const [mapConfig, setMapConfig] = useState(DEFAULT_VIEW);
  const [routeManifest, setRouteManifest] = useState<Map<string, LineManifestEntry>>(new Map());
  const [liveStatus, setLiveStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Toggle state: default false för att spara prestanda
  const [showAllVehicles, setShowAllVehicles] = useState(false);
  // Toggle state: default true för att visa historik
  const [showHistory, setShowHistory] = useState(true);
  
  // Ny state för att hålla reda på vad som syns på kartan
  const [visibleBounds, setVisibleBounds] = useState<L.LatLngBounds | null>(null);

  // Ny state för fordonshistorik
  const [historyPath, setHistoryPath] = useState<HistoryPoint[]>([]);

  useEffect(() => {
    const init = async () => {
      setIsApiConfigured(slService.areKeysConfigured());
      setLoadingMessage('Laddar statisk trafikdata...');
      await slService.initialize();
      const manifestData = await slService.getManifest();
      const manifestMap = new Map(manifestData.map(item => [item.id, item]));
      setRouteManifest(manifestMap);
      setLoading(false);
    };
    init();
  }, []);

  // Live Update Loop (Display only)
  useEffect(() => {
    if (loading || !isApiConfigured) {
      setVehicles([]);
      return;
    }

    const fetchLive = async () => {
      try {
        const data = await slService.getLiveVehicles(null);
        setVehicles(data);
        if (liveStatus !== 'ok') setLiveStatus('ok');
      } catch(e) {
        setLiveStatus('error');
      }
    };

    fetchLive();
    const interval = setInterval(fetchLive, 2500); 
    return () => clearInterval(interval);
  }, [loading, isApiConfigured]);

  // Hämta historik när ett fordon väljs
  useEffect(() => {
      if (!selectedVehicleId) {
          setHistoryPath([]);
          return;
      }
      
      const vehicle = vehicles.find(v => v.id === selectedVehicleId);
      if (vehicle) {
          slService.getVehicleHistory(vehicle.tripId).then(path => {
              setHistoryPath(path);
          });
      }
  }, [selectedVehicleId, vehicles]);

  const handleClear = () => {
    setActiveRoute(null);
    setActiveStop(null);
    setSelectedVehicleId(null);
    setHistoryPath([]);
    setMapConfig(DEFAULT_VIEW);
    setSearchQuery(''); 
  };

  const handleSearchSelect = async (result: SearchResult) => {
    setSelectedVehicleId(null);
    setHistoryPath([]);
    
    if (result.type === 'line') {
      setSearchQuery('');
    } else {
      setSearchQuery(result.title);
    }
    
    if (result.type === 'line') {
      const route = await slService.getLineRoute(result.id);
      if (route && route.path.length > 0) {
        setActiveRoute(route);
        setActiveStop(null);
        const bounds = L.latLngBounds(route.path);
        setMapConfig({ 
          center: [bounds.getCenter().lat, bounds.getCenter().lng],
          zoom: 12,
          bounds: bounds 
        });
      }
    } else {
      let stop = null;
      if (activeRoute) {
        stop = activeRoute.stops.find(s => s.name.toLowerCase() === result.title.toLowerCase());
      }
      if (!stop) {
        stop = await slService.getStopInfo(result.id);
      }
      if (stop) {
        setActiveStop(stop);
        setMapConfig({ 
          center: [stop.lat, stop.lng], 
          zoom: 14, 
          bounds: undefined 
        });
      }
    }
  };

  const handleVehicleFound = async (vehicle: SLVehicle, routeId: string) => {
    const route = await slService.getLineRoute(routeId);
    if (route && route.path.length > 0) {
      setActiveRoute(route);
      setActiveStop(null);
      setSelectedVehicleId(vehicle.id);
      setMapConfig({
        center: [vehicle.lat, vehicle.lng],
        zoom: 15,
        bounds: undefined
      });
    }
  };

  const getStatusText = () => {
    if (!isApiConfigured) return "API ej konfigurerad";
    
    if (liveStatus === 'loading') return "Startar sökning...";
    if (liveStatus === 'error') return "Anslutningsfel";

    if (activeRoute && !showAllVehicles) {
       const routeVehicles = vehicles.filter(v => v.line === activeRoute.id);
       return `${routeVehicles.length} fordon på linje ${activeRoute.line}`;
    }
    
    if (activeRoute && showAllVehicles) {
        return `Linje ${activeRoute.line} + Övrig trafik`;
    }

    if (showAllVehicles) {
        return `${vehicles.length} fordon i trafik`;
    }
    
    // Default fallback utan "Server-läge" texten
    return `${vehicles.length} fordon i realtid`;
  };

  const getLineDisplayName = () => {
    if (!activeRoute) return "";
    const manifestEntry = routeManifest.get(activeRoute.id);
    if (manifestEntry) {
      return `Linje ${activeRoute.line} ${manifestEntry.from} – ${manifestEntry.to}`;
    }
    return `Linje ${activeRoute.line}`;
  };

  const visibleVehicles = useMemo(() => {
    let filtered = vehicles;

    if (activeRoute && !showAllVehicles) {
        filtered = vehicles.filter(v => v.line === activeRoute.id || activeRoute.trip_ids.includes(v.tripId));
    } else if (!showAllVehicles) {
        return [];
    }

    if (!visibleBounds) return [];
    const paddedBounds = visibleBounds.pad(0.5);
    return filtered.filter(v => paddedBounds.contains({ lat: v.lat, lng: v.lng }));
  }, [vehicles, visibleBounds, activeRoute, showAllVehicles]);


  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-slate-950 text-white p-8 text-center">
        <RefreshCw className="w-16 h-16 text-blue-500 animate-spin mb-8" />
        <h1 className="text-2xl font-bold mb-2 tracking-tight">SL Live Tracker</h1>
        <p className="text-slate-400 text-sm">{loadingMessage}</p>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full bg-slate-100">
      {isApiConfigured === false && <ApiKeyWarning />}
      <SearchBar 
        onSelect={handleSearchSelect} 
        onClear={handleClear} 
        activeRoute={activeRoute}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        placeholder={activeRoute ? "Sök hållplats på linjen..." : "Sök linje eller hållplats..."}
      />

      {activeRoute && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-[900] flex items-center justify-center pointer-events-auto">
          <div className="flex items-center gap-2">
            <div className="bg-blue-600 px-5 py-3 rounded-2xl text-white shadow-xl flex items-center gap-3 border border-blue-400/30">
              <MapIcon className="w-5 h-5 flex-shrink-0" />
              <span className="font-bold text-sm tracking-wide whitespace-nowrap">
                {getLineDisplayName()}
              </span>
            </div>
            <button 
              onClick={handleClear}
              className="bg-white/90 hover:bg-white backdrop-blur-md p-3 rounded-2xl shadow-lg border border-black/5 text-slate-700 transition-all active:scale-95"
              title="Rensa sökning"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

      <div className="absolute bottom-6 left-6 z-[1000] flex flex-col gap-3 pointer-events-auto">
        <div className="bg-slate-900/90 backdrop-blur-xl border border-white/10 p-4 rounded-2xl shadow-2xl flex flex-col gap-3 min-w-[240px]">
          <div className="flex items-center gap-4">
             <div className={`w-3 h-3 rounded-full flex-shrink-0 ${liveStatus === 'ok' ? 'bg-emerald-500 animate-pulse' : (liveStatus === 'error' ? 'bg-red-500' : 'bg-yellow-500')}`}></div>
             <div>
               <div className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-0.5">Live Status</div>
               <div className="text-sm font-semibold text-white">{getStatusText()}</div>
             </div>
          </div>
          
          <div className="h-px w-full bg-white/10"></div>
          
          {/* Toggle for Visa alla bussar */}
          <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-300">Visa alla bussar</span>
              <label className="relative inline-flex items-center cursor-pointer">
                  <input 
                      type="checkbox" 
                      checked={showAllVehicles} 
                      onChange={(e) => setShowAllVehicles(e.target.checked)} 
                      className="sr-only peer" 
                  />
                  <div className="w-9 h-5 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
          </div>

          {/* Toggle for Visa historik */}
          <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-300">Visa historik</span>
              <label className="relative inline-flex items-center cursor-pointer">
                  <input 
                      type="checkbox" 
                      checked={showHistory} 
                      onChange={(e) => setShowHistory(e.target.checked)} 
                      className="sr-only peer" 
                  />
                  <div className="w-9 h-5 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
          </div>

        </div>
      </div>

      <div className="absolute bottom-6 right-6 z-[1000] pointer-events-auto flex flex-col items-end gap-2">
         <VehicleSearch onVehicleFound={handleVehicleFound} />
      </div>

      <MapContainer center={mapConfig.center} zoom={mapConfig.zoom} zoomControl={false} className="w-full h-full">
        <TileLayer url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png" />
        <MapController center={mapConfig.center} zoom={mapConfig.zoom} bounds={mapConfig.bounds} />
        
        <MapBoundsReporter onBoundsChange={setVisibleBounds} />

        {activeRoute && (
          <>
            <Polyline positions={activeRoute.path} color="#3b82f6" weight={8} opacity={0.6} lineCap="round" />
            {activeRoute.stops.map(stop => (
              <CircleMarker 
                key={stop.id} 
                center={[stop.lat, stop.lng]} 
                radius={6} 
                fillColor="white" 
                fillOpacity={1} 
                color="#3b82f6" 
                weight={2}
                eventHandlers={{
                  click: () => {
                    setSelectedVehicleId(null);
                    setActiveStop(stop);
                    setHistoryPath([]);
                  }
                }}
              />
            ))}
          </>
        )}

        {/* History Trail - visas bara om showHistory är true */}
        {showHistory && historyPath.length > 0 && (
          <>
            <Polyline 
                positions={historyPath} 
                color="#dc2626" 
                weight={4} 
                opacity={0.8} 
                lineCap="round" 
            />
            {historyPath.map((point, i) => (
                <CircleMarker
                    key={i}
                    center={[point.lat, point.lng]}
                    radius={6}
                    fillColor="transparent"
                    color="transparent"
                    weight={0}
                    opacity={0}
                    fillOpacity={0}
                    eventHandlers={{
                        mouseover: (e) => e.target.openTooltip(),
                        mouseout: (e) => e.target.closeTooltip()
                    }}
                >
                    <Tooltip direction="top" offset={[0, -5]} opacity={1}>
                        <span className="font-bold text-xs">
                             {new Date(point.ts).toLocaleTimeString('sv-SE')}
                        </span>
                    </Tooltip>
                </CircleMarker>
            ))}
          </>
        )}

        {activeStop && (
           <AutoOpenMarker 
             key={`stop-${activeStop.id}`} 
             stopId={activeStop.id} 
             position={[activeStop.lat, activeStop.lng]}
             eventHandlers={{
               popupclose: () => {
                 setActiveStop(null);
                 setSearchQuery(''); 
               },
             }}
           >
             <Popup className="custom-popup stop-popup">
               <div className="py-3 pl-3 pr-8 bg-white">
                 <div className="flex items-center gap-2 text-slate-800">
                    <div className="p-1.5 bg-emerald-50 rounded-lg flex-shrink-0">
                      <MapPin className="w-4 h-4 text-emerald-600"/>
                    </div>
                    <h3 className="text-sm font-bold tracking-tight truncate" title={activeStop.name}>
                      {activeStop.name}
                    </h3>
                 </div>
               </div>
             </Popup>
           </AutoOpenMarker>
        )}

        {visibleVehicles.map((v) => {
          const lineInfo = routeManifest.get(v.line);
          const shortName = lineInfo ? lineInfo.line : '?';
          return (
            <VehicleMarker 
              key={v.id} 
              vehicle={v} 
              lineShortName={shortName} 
              isSelected={selectedVehicleId === v.id}
              onSelect={(id) => {
                setSelectedVehicleId(id);
                setActiveStop(null);
              }}
              onDeselect={() => {
                  setSelectedVehicleId(null);
                  setHistoryPath([]);
              }}
            />
          );
        })}
      </MapContainer>
    </div>
  );
};

export default App;
