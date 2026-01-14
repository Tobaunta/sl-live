
import React from 'react';
import { SLVehicle } from '../types';

interface VehiclePopupProps {
  vehicle: SLVehicle;
  lineShortName: string;
}

const VehiclePopup: React.FC<VehiclePopupProps> = ({ vehicle, lineShortName }) => {
  const destinationText = (vehicle.destination && vehicle.destination !== "Okänd")
    ? `mot ${vehicle.destination}`
    : '';
  const lineText = `${lineShortName} ${destinationText}`.trim();

  // Extraherar operatörskod (de 3 siffrorna före de sista 4 i id:t)
  const match = /([0-9]{3})([0-9]{4})$/.exec(vehicle.id);
  const companyCode = match ? match[1] : null;
  
  let company = "Okänd";
  switch (companyCode) {
    case "050": company = "Blidösundsbolaget"; break;
    case "070": case "705": case "706": case "707": case "709": company = "AB Stockholms Spårvägar"; break;
    case "100": company = "Keolis"; break;
    case "150": company = "VR Sverige"; break;
    case "251": company = "Connecting Stockholm"; break;
    case "300": company = "Nobina"; break;
    case "450": case "456": case "459": company = "Transdev"; break;
    case "650": company = "SJ Stockholmståg"; break;
    case "750": company = "Djurgårdens färjetrafik"; break;
    case "800": company = "Ballerina"; break;
    default: company = companyCode ? `Entreprenör ${companyCode}` : "Okänd";
  }

  const vehicleNumber = vehicle.id.slice(-4);
  const roundedSpeed = Math.round(vehicle.speed);

  return (
    <div className="p-3 bg-white min-w-[220px] text-gray-800 font-sans shadow-sm">
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <div className="font-semibold text-gray-400 uppercase tracking-tighter">Linje</div>
        <div className="text-right font-bold text-blue-600 truncate pr-5">{lineText}</div>

        <div className="font-semibold text-gray-400 uppercase tracking-tighter">Entreprenör</div>
        <div className="text-right font-medium">{company}</div>
        
        <div className="font-semibold text-gray-400 uppercase tracking-tighter">Vagnsnummer</div>
        <div className="text-right font-medium">{vehicleNumber}</div>
        
        {roundedSpeed >= 0 && (
          <>
            <div className="font-semibold text-gray-400 uppercase tracking-tighter">Hastighet</div>
            <div className="text-right font-medium">{roundedSpeed} km/h</div>
          </>
        )}
      </div>
      
      <div className="mt-3 pt-2 border-t border-gray-100 flex justify-end items-center">
         <span className="inline-flex items-center gap-1.5 text-[10px] text-emerald-700 font-bold">
            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></span>
            Realtid
         </span>
      </div>
    </div>
  );
};

export default VehiclePopup;
