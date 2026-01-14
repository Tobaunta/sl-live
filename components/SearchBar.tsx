
import React, { useState, useEffect, useRef } from 'react';
import { Search, Bus, MapPin, X } from 'lucide-react';
import { slService } from '../services/slService';
import { SearchResult, SLLineRoute } from '../types';

interface SearchBarProps {
  onSelect: (result: SearchResult) => void;
  onClear: () => void;
  activeRoute: SLLineRoute | null;
}

const SearchBar: React.FC<SearchBarProps> = ({ onSelect, onClear, activeRoute }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchResults = async () => {
      if (query.trim().length > 0) {
        const res = await slService.search(query, activeRoute);
        setResults(res);
        setShowDropdown(true);
      } else {
        setResults([]);
        setShowDropdown(false);
      }
    };
    fetchResults();
  }, [query, activeRoute]);

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
    <div ref={containerRef} className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] w-full max-w-md px-4">
      <div className="relative bg-zinc-900/90 backdrop-blur-md rounded-2xl shadow-2xl border border-white/10 overflow-hidden">
        <div className="flex items-center px-4 py-3 gap-3">
          <Search className="w-5 h-5 text-zinc-400" />
          <input
            type="text"
            className="flex-1 bg-transparent text-white outline-none placeholder:text-zinc-500 text-sm"
            placeholder="Sök linje eller hållplats..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => query.length > 0 && setShowDropdown(true)}
          />
          {query && (
            <button 
              onClick={() => { setQuery(''); onClear(); }}
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
                  onSelect(result);
                  setQuery(result.title);
                  setShowDropdown(false);
                }}
                className="w-full flex items-center gap-4 px-4 py-3 hover:bg-white/5 transition-colors text-left"
              >
                <div className={`p-2 rounded-lg ${result.type === 'line' ? 'bg-blue-500/20' : 'bg-emerald-500/20'}`}>
                  {result.type === 'line' ? (
                    <Bus className="w-5 h-5 text-blue-400" />
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
