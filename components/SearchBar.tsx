
import React, { useState, useEffect, useRef } from 'react';
import { Search, Bus, MapPin, X, Train, Ship, TramFront, TrainFront } from 'lucide-react';
import { slService } from '../services/slService';
import { SearchResult, SLLineRoute, HistoryPoint } from '../types';

interface SearchBarProps {
  onSelect: (result: SearchResult) => void;
  onClear: () => void;
  activeRoute: SLLineRoute | null;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  placeholder?: string;
  historyPath?: HistoryPoint[];
}

const getTransportIcon = (lineString: string) => {
  // Extrahera linjenummer från titeln "Linje X"
  const lineName = lineString.replace('Linje ', '').trim();

  // Om linjen innehåller bokstäver (t.ex. 25M), visa alltid buss
  if (/[a-zA-Z]/.test(lineName)) {
    return <Bus className="w-5 h-5 text-blue-400" />;
  }

  const num = parseInt(lineName);
  if (isNaN(num)) return <Bus className="w-5 h-5 text-blue-400" />;

  // Tunnelbana (10, 11, 13, 14, 17, 18, 19)
  if ([10, 11, 13, 14, 17, 18, 19].includes(num)) {
    return <TrainFront className="w-5 h-5 text-blue-400" />;
  }

  // Spårvagn (7, 30, 31) + Nockebybanan (12)
  if ([7, 12, 30, 31].includes(num)) {
    return <TramFront className="w-5 h-5 text-blue-400" />;
  }

  // Lokalbana (21, 25, 26, 27, 28, 29)
  if ([21, 25, 26, 27, 28, 29].includes(num)) {
    return <TramFront className="w-5 h-5 text-blue-400" />;
  }

  // Pendeltåg (40, 41, 42, 43, 44, 48)
  if ([40, 41, 42, 43, 44, 48].includes(num)) {
    return <Train className="w-5 h-5 text-blue-400" />;
  }

  // Pendelbåt (80, 82, 83, 84, 89)
  if ([80, 82, 83, 84, 89].includes(num)) {
    return <Ship className="w-5 h-5 text-blue-400" />;
  }

  // Standard: Buss
  return <Bus className="w-5 h-5 text-blue-400" />;
};

const SearchBar: React.FC<SearchBarProps> = ({ 
  onSelect, 
  onClear, 
  activeRoute, 
  searchQuery, 
  onSearchChange,
  placeholder = "Sök linje eller hållplats...",
  historyPath
}) => {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Ref för att spåra om vi precis har gjort ett val.
  // Detta förhindrar att dropdown-menyn öppnas igen när input-värdet uppdateras efter ett klick.
  const isSelectingRef = useRef(false);

  useEffect(() => {
    const fetchResults = async () => {
      if (searchQuery.trim().length > 0) {
        // Skicka med historyPath för att kunna visa passerade tider
        const res = await slService.search(searchQuery, activeRoute, historyPath);
        setResults(res);
        
        // Öppna bara dropdown om vi inte precis har valt något
        if (!isSelectingRef.current) {
          setShowDropdown(true);
        }
        
        // Återställ flaggan efter att effekten kört klart
        isSelectingRef.current = false;
      } else {
        setResults([]);
        setShowDropdown(false);
      }
    };
    fetchResults();
  }, [searchQuery, activeRoute, historyPath]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="absolute top-4 left-1/2 -translate-x-1/2 z-[2000] w-full max-w-md px-4">
      <div className="relative bg-zinc-900/90 backdrop-blur-md rounded-2xl shadow-2xl border border-white/10 overflow-hidden">
        <div className="flex items-center px-4 py-3 gap-3">
          <Search className="w-5 h-5 text-zinc-400" />
          <input
            type="text"
            className="flex-1 bg-transparent text-white outline-none placeholder:text-zinc-500 text-sm"
            placeholder={placeholder}
            value={searchQuery}
            onChange={(e) => {
              // Om användaren skriver manuellt, se till att vi tillåter dropdown att öppnas
              isSelectingRef.current = false;
              onSearchChange(e.target.value);
            }}
            onFocus={() => {
                // Öppna dropdown vid fokus om det finns text och vi inte precis valt något
                if (searchQuery.length > 0) setShowDropdown(true);
            }}
          />
          {searchQuery && (
            <button 
              onClick={() => { onSearchChange(''); onClear(); }}
              className="p-1 hover:bg-zinc-800 rounded-full transition-colors"
            >
              <X className="w-4 h-4 text-zinc-400" />
            </button>
          )}
        </div>

        {showDropdown && results.length > 0 && (
          <div className="border-t border-white/5 max-h-80 overflow-y-auto">
            {results.map((result) => (
              <button
                key={`${result.type}-${result.id}`}
                onClick={() => {
                  isSelectingRef.current = true; // Flagga att vi gör ett val
                  onSelect(result);
                  setShowDropdown(false);
                }}
                className="w-full flex items-center gap-4 px-4 py-3 hover:bg-white/5 transition-colors text-left"
              >
                <div className={`p-2 rounded-lg ${result.type === 'line' ? 'bg-blue-500/20' : 'bg-emerald-500/20'}`}>
                  {result.type === 'line' ? (
                    getTransportIcon(result.title)
                  ) : (
                    <MapPin className="w-5 h-5 text-emerald-400" />
                  )}
                </div>
                <div>
                  <div className="text-sm font-medium text-white">{result.title}</div>
                  {result.subtitle && <div className="text-xs text-zinc-400">{result.subtitle}</div>}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default SearchBar;
