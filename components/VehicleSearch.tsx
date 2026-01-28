
import React, { useState } from 'react';
import { Search, Loader2, Bus } from 'lucide-react';
import { slService } from '../services/slService';
import { SLVehicle } from '../types';

interface VehicleSearchProps {
  onVehicleFound: (vehicle: SLVehicle, routeId: string) => void;
}

const VehicleSearch: React.FC<VehicleSearchProps> = ({ onVehicleFound }) => {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setError(null);

    try {
      if (typeof slService.findVehicle !== 'function') {
        throw new Error("Tjänsten är inte redo än (uppdatera sidan).");
      }

      const result = await slService.findVehicle(query.trim());
      
      if (result) {
        onVehicleFound(result.vehicle, result.routeId);
        setQuery(''); // Rensa sökfältet vid träff
      } else {
        setError('Vagn ej i trafik');
        // Rensa felmeddelandet efter 3 sekunder
        setTimeout(() => setError(null), 3000);
      }
    } catch (err: any) {
      console.error("Vehicle Search Error:", err);
      setError('Kunde inte söka');
      setTimeout(() => setError(null), 3000);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-slate-900/90 backdrop-blur-xl border border-white/10 p-2 rounded-2xl shadow-2xl flex flex-col gap-2 w-full md:w-auto md:min-w-[200px]">
      <form onSubmit={handleSearch} className="flex items-center gap-2">
        <div className="relative flex-1">
            <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Vagnsnr..."
            className="w-full bg-slate-800/50 text-white placeholder-slate-500 text-sm rounded-xl px-3 py-2 outline-none focus:bg-slate-800 transition-colors border border-transparent focus:border-blue-500/30"
            />
            <Bus className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
        </div>
        <button 
            type="submit"
            disabled={loading || !query.trim()}
            className="bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:cursor-not-allowed text-white p-2 rounded-xl transition-colors shadow-lg"
        >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
        </button>
      </form>
      {error && (
          <div className="text-[11px] font-bold text-red-400 text-center pb-1 animate-in fade-in slide-in-from-top-1">
              {error}
          </div>
      )}
    </div>
  );
};

export default VehicleSearch;
