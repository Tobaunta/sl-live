
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, CircleMarker, useMap } from 'react-leaflet';
import L from 'leaflet';
import SearchBar from './components/SearchBar';
import VehiclePopup from './components/VehiclePopup';
import { slService, LineManifestEntry } from './services/slService';
import { SLVehicle, SLLineRoute, SearchResult, SLStop } from './types';
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

// Fix: Added interface for AutoOpenMarker props to resolve typing issues and avoid 'any'
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

// Fix: Defined interface for VehicleMarker props to resolve "key" property error in App.tsx line 325
interface VehicleMarkerProps {
  vehicle: SLVehicle;
  lineShortName: string;
  isSelected: boolean;
  onSelect: (id: string) => void;
}

// Komponent för fordon som ser till att popupen stannar öppen om fordonet är valt
const VehicleMarker: React.FC<VehicleMarkerProps> = ({ vehicle, lineShortName, isSelected, onSelect }) => {
  const markerRef = useRef<L.Marker>(null);
  const icon = useMemo(() => createVehicleIcon(vehicle.bearing, lineShortName), [vehicle.bearing, lineShortName]);

  useEffect(() => {
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

  useEffect(() => {
    if (loading || !isApiConfigured || !activeRoute) {
      setVehicles([]);
      return;
    }

    const fetchLive = async () => {
      try {
        const data = await slService.getLiveVehicles(activeRoute);
        setVehicles(data);
        if (liveStatus !== 'ok') setLiveStatus('ok');
      } catch(e) {
        setLiveStatus('error');
      }
    };

    fetchLive();
    const interval = setInterval(fetchLive, 5000);
    return () => clearInterval(interval);
  }, [loading, activeRoute, isApiConfigured]);

  const handleClear = () => {
    setActiveRoute(null);
    setActiveStop(null);
    setVehicles([]);
    setSelectedVehicleId(null);
    setLiveStatus('loading');
    setMapConfig(DEFAULT_VIEW);
  };

  const handleSearchSelect = async (result: SearchResult) => {
    setSelectedVehicleId(null);
    if (result.type === 'line') {
      setLoading(true);
      setLiveStatus('loading');
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
      setLoading(false);
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

  const getStatusText = () => {
    if (!isApiConfigured) return "API ej konfigurerad";
    if (!activeRoute) return "Väntar på sökning...";
    if (liveStatus === 'loading') return "Söker fordon...";
    if (liveStatus === 'error') return "Anslutningsfel";
    return `${vehicles.length} fordon kör just nu på linje ${activeRoute.line}`;
  };

  const getLineDisplayName = () => {
    if (!activeRoute) return "";
    const manifestEntry = routeManifest.get(activeRoute.id);
    if (manifestEntry) {
      return `Linje ${activeRoute.line} ${manifestEntry.from} – ${manifestEntry.to}`;
    }
    return `Linje ${activeRoute.line}`;
  };

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
      <SearchBar onSelect={handleSearchSelect} onClear={handleClear} activeRoute={activeRoute} />

      <div className="absolute bottom-6 left-6 z-[1000] flex flex-col gap-3 pointer-events-none">
        <div className="bg-slate-900/90 backdrop-blur-xl border border-white/10 p-4 rounded-2xl shadow-2xl flex items-center gap-4 min-w-[240px]">
          <div className={`w-3 h-3 rounded-full ${activeRoute ? (liveStatus === 'ok' ? 'bg-emerald-500 animate-pulse' : 'bg-red-500') : 'bg-slate-600'}`}></div>
          <div>
            <div className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-0.5">Live Status</div>
            <div className="text-sm font-semibold text-white">{getStatusText()}</div>
          </div>
        </div>
        
        {activeRoute && (
          <div className="flex items-center gap-2 pointer-events-auto">
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
        )}
      </div>

      <MapContainer center={mapConfig.center} zoom={mapConfig.zoom} zoomControl={false} className="w-full h-full">
        <TileLayer url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png" />
        <MapController center={mapConfig.center} zoom={mapConfig.zoom} bounds={mapConfig.bounds} />

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
                  }
                }}
              />
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

        {vehicles.map((v) => {
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
            />
          );
        })}
      </MapContainer>
    </div>
  );
};

export default App;
