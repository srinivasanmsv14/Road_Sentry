'use client';

import React, { useEffect, useState, useMemo, useRef } from 'react';
import { MapContainer, TileLayer, Polyline, Marker, Popup, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Road, CITIES, INDIA_DISTRICTS } from '../data/mockData';
import { RefreshCw, Compass, AlertTriangle, ChevronDown } from 'lucide-react';

// Fix default leaflet icons breaking in Next.js builds
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// Custom glowing HTML divIcons matching smart-city dashboard
const locationIcon = L.divIcon({
  className: 'custom-div-icon',
  html: `<div class="h-6 w-6 rounded-full bg-slate-500/20 border-2 border-slate-500 flex items-center justify-center" style="box-shadow: 0 0 15px #6b7280;"><div class="h-2 w-2 rounded-full bg-slate-500"></div></div>`,
  iconSize: [24, 24],
  iconAnchor: [12, 12]
});

const draggableIcon = L.divIcon({
  className: 'custom-div-icon',
  html: `<div class="h-8 w-8 rounded-full bg-amber-500/20 border-2 border-amber-500 flex items-center justify-center" style="box-shadow: 0 0 15px #f59e0b;"><div class="h-3 w-3 rounded-full bg-amber-500"></div></div>`,
  iconSize: [32, 32],
  iconAnchor: [16, 16]
});

interface RealMapProps {
  roads: Road[];
  selectedRoadId?: string;
  onSelectRoad?: (road: Road) => void;
  draggablePosition?: { lat: number; lng: number } | null;
  onCoordinatesChange?: (coords: { lat: number; lng: number }) => void;
  onMapBoundsChange?: (bounds: L.LatLngBounds) => void;
  isLoadingRoads?: boolean;
  showLocateButton?: boolean;
}

// Listener to fire map bound updates back to the parent
function MapBoundsListener({ onBoundsChange }: { onBoundsChange: (bounds: L.LatLngBounds) => void }) {
  const map = useMap();
  const onBoundsChangeRef = useRef(onBoundsChange);

  useEffect(() => {
    onBoundsChangeRef.current = onBoundsChange;
  }, [onBoundsChange]);

  useEffect(() => {
    // Fire on initial load/mount
    const timeout = setTimeout(() => {
      if (map.getBounds().isValid()) {
        onBoundsChangeRef.current(map.getBounds());
      }
    }, 100);
    return () => clearTimeout(timeout);
  }, [map]);

  useMapEvents({
    moveend() {
      if (map.getBounds().isValid()) {
        onBoundsChangeRef.current(map.getBounds());
      }
    },
    zoomend() {
      if (map.getBounds().isValid()) {
        onBoundsChangeRef.current(map.getBounds());
      }
    }
  });
  return null;
}

// Controller to center and zoom in on selected road when it changes
function SelectedRoadController({ selectedRoad }: { selectedRoad: Road | null }) {
  const map = useMap();

  useEffect(() => {
    if (selectedRoad && selectedRoad.coordinates && selectedRoad.coordinates.length > 0) {
      map.invalidateSize();
      const latLngs = selectedRoad.coordinates;
      const bounds = L.latLngBounds(latLngs);
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [50, 50], maxZoom: 14 });
      }
    }
  }, [selectedRoad?.id, map]);

  return null;
}

// Robust fetch with abort timeout to prevent hanging on local/offline networks
const fetchWithTimeout = async (url: string, options: RequestInit = {}, timeout = 2500): Promise<Response> => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
};

let cachedIPCoords: { lat: number; lng: number } | null = null;

const fetchIPGeolocation = async (): Promise<{ lat: number; lng: number } | null> => {
  if (cachedIPCoords) return cachedIPCoords;
  if (typeof window !== 'undefined') {
    try {
      const stored = sessionStorage.getItem('roadwatch_cached_ip_coords');
      if (stored) {
        cachedIPCoords = JSON.parse(stored);
        return cachedIPCoords;
      }
    } catch {}
  }

  // 1. Try freeipapi.com (Fast, free, reliable HTTPS)
  try {
    const res = await fetchWithTimeout('https://freeipapi.com/api/json/', {}, 2000);
    if (res.ok) {
      const data = await res.json();
      if (data && typeof data.latitude === 'number' && typeof data.longitude === 'number') {
        const coords = { lat: Number(data.latitude.toFixed(5)), lng: Number(data.longitude.toFixed(5)) };
        cachedIPCoords = coords;
        if (typeof window !== 'undefined') {
          try { sessionStorage.setItem('roadwatch_cached_ip_coords', JSON.stringify(coords)); } catch {}
        }
        return coords;
      }
    }
  } catch (err) {
    console.warn('freeipapi.com failed, trying fallback...', err);
  }

  // 2. Try ipapi.co/json
  try {
    const res = await fetchWithTimeout('https://ipapi.co/json/', {}, 2000);
    if (res.ok) {
      const data = await res.json();
      if (data && typeof data.latitude === 'number' && typeof data.longitude === 'number') {
        const coords = { lat: Number(data.latitude.toFixed(5)), lng: Number(data.longitude.toFixed(5)) };
        cachedIPCoords = coords;
        if (typeof window !== 'undefined') {
          try { sessionStorage.setItem('roadwatch_cached_ip_coords', JSON.stringify(coords)); } catch {}
        }
        return coords;
      }
    }
  } catch (err) {
    console.warn('ipapi.co failed, trying next fallback...', err);
  }

  // 3. Try ipinfo.io/json
  try {
    const res = await fetchWithTimeout('https://ipinfo.io/json', {}, 2000);
    if (res.ok) {
      const data = await res.json();
      if (data && data.loc) {
        const [latStr, lngStr] = data.loc.split(',');
        const lat = parseFloat(latStr);
        const lng = parseFloat(lngStr);
        if (!isNaN(lat) && !isNaN(lng)) {
          const coords = { lat: Number(lat.toFixed(5)), lng: Number(lng.toFixed(5)) };
          cachedIPCoords = coords;
          if (typeof window !== 'undefined') {
            try { sessionStorage.setItem('roadwatch_cached_ip_coords', JSON.stringify(coords)); } catch {}
          }
          return coords;
        }
      }
    }
  } catch (err) {
    console.warn('ipinfo.io fallback failed:', err);
  }
  return null;
};

function LocateMeButton({ onLocate, onError }: { onLocate: (coords: { lat: number; lng: number }) => void; onError: (msg: string) => void }) {
  const map = useMap();
  const [isLocating, setIsLocating] = useState(false);
  const onLocateRef = useRef(onLocate);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onLocateRef.current = onLocate;
    onErrorRef.current = onError;
  }, [onLocate, onError]);

  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsLocating(true);
    onErrorRef.current('');

    // Check if we're secure (HTTPS or localhost)
    const isSecureContext = typeof window !== 'undefined' && window.isSecureContext;

    // Helper: resolve via IP first, then stored preferred city
    const resolveFromFallback = async () => {
      // 1. Try IP Geolocation first to get actual physical coordinates
      try {
        const ipCoords = await fetchIPGeolocation();
        if (ipCoords) {
          map.setView([ipCoords.lat, ipCoords.lng], 15, { animate: true });
          onLocateRef.current(ipCoords);
          setIsLocating(false);
          return;
        }
      } catch (err) {
        console.warn('IP Geolocation failed in map fallback:', err);
      }

      // 2. Only if IP fails, fall back to preferred city from the region selector
      const preferred = typeof window !== 'undefined' ? localStorage.getItem('roadwatch_preferred_city') : null;
      if (preferred) {
        const city = CITIES.find(c => c.name === preferred);
        if (city) {
          map.setView(city.coords as [number, number], 15, { animate: true });
          onLocateRef.current({ lat: city.coords[0], lng: city.coords[1] });
          setIsLocating(false);
          return;
        }
      }
      setIsLocating(false);
      onErrorRef.current('Could not detect your location. Please select a city from the Region dropdown.');
    };

    // On HTTP (non-secure context), skip browser GPS and go directly to fallback
    if (!isSecureContext || !navigator.geolocation) {
      await resolveFromFallback();
      return;
    }

    // Try browser GPS with double-attempt (High Accuracy ➔ Standard Speed fallback)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        setIsLocating(false);
        map.setView([lat, lng], 15, { animate: true });
        onLocateRef.current({ lat, lng });
      },
      async () => {
        // High accuracy failed or timed out — try standard Wi-Fi/cellular triangulation
        if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              const lat = pos.coords.latitude;
              const lng = pos.coords.longitude;
              setIsLocating(false);
              map.setView([lat, lng], 15, { animate: true });
              onLocateRef.current({ lat, lng });
            },
            async () => {
              // Both browser methods failed — run IP-first fallback
              await resolveFromFallback();
            },
            { enableHighAccuracy: false, timeout: 3000 }
          );
        } else {
          await resolveFromFallback();
        }
      },
      { enableHighAccuracy: true, timeout: 3000 }
    );
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isLocating}
      className="absolute bottom-6 left-6 z-[1000] bg-white/95 dark:bg-slate-950/90 text-slate-700 dark:text-slate-100 hover:text-slate-600 dark:hover:text-slate-400 disabled:opacity-50 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xl flex items-center gap-1.5 backdrop-blur-md active:scale-95 transition-all text-xs font-bold"
      style={{ pointerEvents: 'auto' }}
    >
      <Compass className="h-4.5 w-4.5 text-emerald-400 animate-spin" style={{ animationDuration: isLocating ? '1s' : '8s' }} />
      <span>{isLocating ? 'Locating Live GPS...' : 'Locate My Area'}</span>
    </button>
  );
}

function ResizeListener() {
  const map = useMap();
  useEffect(() => {
    const container = map.getContainer();
    if (!container) return;

    // Force complete redraw: invalidate size and reset view to reload all tiles
    const forceRedraw = () => {
      map.invalidateSize();
      try {
        const center = map.getCenter();
        const zoom = map.getZoom();
        if (center && zoom) {
          map.setView(center, zoom, { animate: false });
        }
      } catch (e) {
        // ignore if map center is not set yet
      }
    };

    // Use ResizeObserver to detect layout shifts and dynamic height changes
    const resizeObserver = new ResizeObserver(() => {
      forceRedraw();
    });

    resizeObserver.observe(container);

    // Run progressive delayed checks to catch dynamic hydration settled frames
    const timers = [
      setTimeout(forceRedraw, 50),
      setTimeout(forceRedraw, 150),
      setTimeout(forceRedraw, 300),
      setTimeout(forceRedraw, 600),
      setTimeout(forceRedraw, 1200),
      setTimeout(forceRedraw, 2500),
      setTimeout(forceRedraw, 5000),
    ];

    const handleResize = () => {
      forceRedraw();
    };

    window.addEventListener('resize', handleResize);
    return () => {
      resizeObserver.disconnect();
      timers.forEach(clearTimeout);
      window.removeEventListener('resize', handleResize);
    };
  }, [map]);
  return null;
}

// Controller to handle center changes reactively
function MapController({ center }: { center: [number, number] }) {
  const map = useMap();
  const lastCenterRef = useRef<[number, number] | null>(null);

  useEffect(() => {
    const current = map.getCenter();
    const dist = Math.abs(current.lat - center[0]) + Math.abs(current.lng - center[1]);
    if (dist < 0.0001) {
      // Map is already positioned at these coordinates (e.g. from user drag)
      return;
    }

    lastCenterRef.current = center;
    map.invalidateSize();
    const targetZoom = map.getZoom() < 14 ? 15 : map.getZoom();
    map.setView(center, targetZoom, { animate: true });
  }, [center[0], center[1], map]);

  return null;
}

// Controller to sync map movement center back to form coordinates when user drags the map
function MapCenterSync({ onCoordinatesChange, enabled }: { onCoordinatesChange?: (coords: { lat: number; lng: number }) => void; enabled: boolean }) {
  const map = useMap();

  useMapEvents({
    drag() {
      if (enabled && onCoordinatesChange) {
        const center = map.getCenter();
        onCoordinatesChange({ lat: Number(center.lat.toFixed(5)), lng: Number(center.lng.toFixed(5)) });
      }
    },
    dragend() {
      if (enabled && onCoordinatesChange) {
        const center = map.getCenter();
        onCoordinatesChange({ lat: Number(center.lat.toFixed(5)), lng: Number(center.lng.toFixed(5)) });
      }
    }
  });

  return null;
}

// Controller to automatically zoom out and pan to fit all road coordinates on initial load only
function FitBoundsController({ bounds, shouldFit }: { bounds: L.LatLngBounds; shouldFit: boolean }) {
  const map = useMap();
  const [hasFit, setHasFit] = useState(false);

  useEffect(() => {
    if (shouldFit && bounds.isValid() && !hasFit) {
      map.fitBounds(bounds, { padding: [40, 40] });
      setHasFit(true);
    }
  }, [bounds, map, shouldFit, hasFit]);
  return null;
}

// Auto-locator on mount to dynamically center map to user's city
function AutoLocator({ onLocate, hasAutolocated, setHasAutolocated }: { onLocate: (coords: { lat: number; lng: number }) => void; hasAutolocated: boolean; setHasAutolocated: (val: boolean) => void }) {
  const map = useMap();
  const onLocateRef = useRef(onLocate);

  useEffect(() => {
    onLocateRef.current = onLocate;
  }, [onLocate]);

  useEffect(() => {
    if (hasAutolocated) return;
    let active = true;

    const performAutoLocate = async () => {
      // First try silent IP geolocation
      const ipCoords = await fetchIPGeolocation();
      if (!active) return;

      if (ipCoords) {
        map.setView([ipCoords.lat, ipCoords.lng], 12);
        onLocateRef.current(ipCoords);
        setHasAutolocated(true);
        return;
      }

      // Fallback to browser geolocation silently
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            if (!active) return;
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            map.setView([lat, lng], 12);
            onLocateRef.current({ lat, lng });
            setHasAutolocated(true);
          },
          () => {
            if (!active) return;
            setHasAutolocated(true);
          },
          { enableHighAccuracy: false, timeout: 2500 }
        );
      } else {
        if (!active) return;
        setHasAutolocated(true);
      }
    };

    performAutoLocate();

    return () => {
      active = false;
    };
  }, [map, hasAutolocated, setHasAutolocated]);

  return null;
}

// Map Click Listener to re-position pin on click
function MapClickHandler({ onClick }: { onClick: (coords: { lat: number; lng: number }) => void }) {
  useMapEvents({
    click(e) {
      onClick({ lat: e.latlng.lat, lng: e.latlng.lng });
    }
  });
  return null;
}

function MapTypeControl({ mapType, setMapType }: { mapType: 'roadmap' | 'satellite' | 'osm'; setMapType: (type: 'roadmap' | 'satellite' | 'osm') => void }) {
  return (
    <div className="absolute bottom-8 right-4 z-[1000] bg-white/95 dark:bg-slate-950/95 rounded-xl p-1 border border-slate-200 dark:border-slate-800 shadow-2xl flex gap-1 backdrop-blur-md">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setMapType('roadmap');
        }}
        className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase transition-all ${
          mapType === 'roadmap'
            ? 'text-white shadow-md animate-none'
            : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
        }`}
        style={
          mapType === 'roadmap'
            ? { backgroundColor: '#2563eb', color: '#ffffff' }
            : undefined
        }
      >
        GMaps Road
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setMapType('satellite');
        }}
        className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase transition-all ${
          mapType === 'satellite'
            ? 'text-white shadow-md animate-none'
            : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
        }`}
        style={
          mapType === 'satellite'
            ? { backgroundColor: '#2563eb', color: '#ffffff' }
            : undefined
        }
      >
        GMaps Satellite
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setMapType('osm');
        }}
        className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase transition-all ${
          mapType === 'osm'
            ? 'text-white shadow-md animate-none'
            : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
        }`}
        style={
          mapType === 'osm'
            ? { backgroundColor: '#2563eb', color: '#ffffff' }
            : undefined
        }
      >
        OSM Streets
      </button>
    </div>
  );
}


// CITIES list is imported from ../data/mockData

function CitySelectorControl({ selectedCity, onCitySelect }: { selectedCity: string; onCitySelect: (name: string, coords: [number, number]) => void }) {
  const map = useMap();
  const [selectedState, setSelectedState] = useState('');

  // Keep state selection in sync when selectedCity changes from outside
  useEffect(() => {
    if (selectedCity) {
      const stateObj = INDIA_DISTRICTS.find(s =>
        s.districts.some(d => d.name === selectedCity)
      );
      if (stateObj) {
        setSelectedState(stateObj.state);
      }
    }
  }, [selectedCity]);

  const handleStateChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const stateName = e.target.value;
    setSelectedState(stateName);
    onCitySelect('', [0, 0]);
  };

  const handleDistrictChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const districtName = e.target.value;
    if (!districtName) {
      onCitySelect('', [0, 0]);
      return;
    }
    const stateObj = INDIA_DISTRICTS.find(s => s.state === selectedState);
    if (stateObj) {
      const district = stateObj.districts.find(d => d.name === districtName);
      if (district) {
        map.setView(district.coords as [number, number], 13, { animate: true });
        onCitySelect(districtName, district.coords as [number, number]);
      }
    }
  };

  const availableDistricts = selectedState
    ? INDIA_DISTRICTS.find(s => s.state === selectedState)?.districts || []
    : [];

  return (
    <div className="absolute top-4 left-14 z-[1000] bg-white/95 dark:bg-slate-950/95 rounded-xl p-2 border border-slate-200 dark:border-slate-800 shadow-2xl flex gap-2 items-center backdrop-blur-md">
      {/* State Dropdown */}
      <div className="flex items-center gap-1">
        <span className="text-[9px] font-black uppercase text-slate-400 dark:text-slate-500 px-0.5">State:</span>
        <div className="relative flex items-center bg-slate-100 dark:bg-navy-900 border border-slate-200 dark:border-navy-800 rounded-lg px-2 py-1">
          <select
            value={selectedState}
            onChange={handleStateChange}
            className="bg-transparent text-slate-800 dark:text-slate-100 border-none focus:outline-none focus:ring-0 text-[10px] font-extrabold pr-4 cursor-pointer uppercase select-custom outline-none appearance-none"
            style={{ WebkitAppearance: 'none', MozAppearance: 'none', appearance: 'none' }}
          >
            <option value="" className="bg-white dark:bg-navy-950 text-slate-400 font-bold">Select State...</option>
            {INDIA_DISTRICTS.map((stateGroup) => (
              <option key={stateGroup.state} value={stateGroup.state} className="bg-white dark:bg-navy-950 text-slate-800 dark:text-white font-bold">
                {stateGroup.state}
              </option>
            ))}
          </select>
          <ChevronDown className="h-3 w-3 text-slate-450 dark:text-slate-400 absolute right-1.5 pointer-events-none" />
        </div>
      </div>

      {/* Divider and District Dropdown - dynamically rendered after selecting state */}
      {selectedState && (
        <>
          <div className="h-5 w-[1px] bg-slate-200 dark:bg-slate-800 mx-0.5" />
          <div className="flex items-center gap-1">
            <span className="text-[9px] font-black uppercase text-slate-400 dark:text-slate-500 px-0.5">District:</span>
            <div className="relative flex items-center bg-slate-100 dark:bg-navy-900 border border-slate-200 dark:border-navy-800 rounded-lg px-2 py-1">
              <select
                value={selectedCity}
                onChange={handleDistrictChange}
                className="bg-transparent text-slate-800 dark:text-slate-100 border-none focus:outline-none focus:ring-0 text-[10px] font-extrabold pr-4 cursor-pointer uppercase select-custom text-slate-600 dark:text-slate-400 outline-none appearance-none"
                style={{ WebkitAppearance: 'none', MozAppearance: 'none', appearance: 'none' }}
              >
                <option value="" className="bg-white dark:bg-navy-950 text-slate-400 font-bold">
                  Select District...
                </option>
                {availableDistricts.map((district) => (
                  <option key={district.name} value={district.name} className="bg-white dark:bg-navy-950 text-slate-800 dark:text-white font-bold">
                    {district.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="h-3 w-3 text-slate-450 dark:text-slate-400 absolute right-1.5 pointer-events-none" />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function RegionSyncController({ selectedCity, setSelectedCity }: { selectedCity: string; setSelectedCity: (name: string) => void }) {
  const map = useMap();

  useMapEvents({
    moveend() {
      const center = map.getCenter();
      const matched = CITIES.find(city => {
        const distLat = Math.abs(city.coords[0] - center.lat);
        const distLng = Math.abs(city.coords[1] - center.lng);
        return distLat < 0.08 && distLng < 0.08;
      });
      if (matched) {
        if (selectedCity !== matched.name) {
          setSelectedCity(matched.name);
          localStorage.setItem('roadwatch_preferred_city', matched.name);
        }
      } else {
        if (selectedCity !== '') {
          setSelectedCity('');
        }
      }
    }
  });

  return null;
}

export default function RealMap({
  roads,
  selectedRoadId,
  onSelectRoad,
  draggablePosition,
  onCoordinatesChange,
  onMapBoundsChange,
  isLoadingRoads = false,
  showLocateButton = true
}: RealMapProps) {
  const [mapType, setMapType] = useState<'roadmap' | 'satellite' | 'osm'>('roadmap');
  const [errorMessage, setErrorMessage] = useState('');
  
  const [selectedCity, setSelectedCity] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('roadwatch_preferred_city') || '';
    }
    return '';
  });

  const [hasAutolocated, setHasAutolocated] = useState(() => {
    if (typeof window !== 'undefined') {
      return !!localStorage.getItem('roadwatch_preferred_city');
    }
    return false;
  });
  
  const handleCitySelect = (name: string, coords: [number, number]) => {
    setSelectedCity(name);
    setHasAutolocated(true); // Stop auto-locating on mount since we loaded a preferred/selected region
    if (typeof window !== 'undefined') {
      if (name) {
        localStorage.setItem('roadwatch_preferred_city', name);
      } else {
        localStorage.removeItem('roadwatch_preferred_city');
      }
    }
    if (name && onCoordinatesChange) {
      onCoordinatesChange({ lat: coords[0], lng: coords[1] });
    }
  };
  
  // Center coordinates (uses selected preferred region, otherwise defaults to Chennai)
  const defaultCenter: [number, number] = useMemo(() => {
    if (selectedCity) {
      const city = CITIES.find(c => c.name === selectedCity);
      if (city) return city.coords as [number, number];
    }
    return [13.04, 80.24]; // Chennai
  }, [selectedCity]);

  // Auto-clear error messages after a short delay
  useEffect(() => {
    if (errorMessage) {
      const timer = setTimeout(() => {
        setErrorMessage('');
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [errorMessage]);

  // Helper to color code polylines by condition
  const getConditionColor = (condition: Road['condition']) => {
    switch (condition) {
      case 'Good': return '#10b981';      // Emerald Green
      case 'Moderate': return '#eab308';  // Yellow
      case 'Damaged': return '#f97316';   // Orange
      case 'Critical': return '#ef4444';  // Red
      default: return '#94a3b8';
    }
  };

  // Compile all coordinates to compute boundaries
  const roadBounds = useMemo(() => {
    const latLngs: L.LatLngExpression[] = [];
    roads.forEach(road => {
      if (road.coordinates && road.coordinates.length > 0) {
        road.coordinates.forEach(c => latLngs.push(c));
      }
    });
    return L.latLngBounds(latLngs);
  }, [roads]);

  // Determine active center coordinate based on selected road or marker position
  const activeCenter: [number, number] = useMemo(() => {
    if (draggablePosition) {
      return [draggablePosition.lat, draggablePosition.lng];
    }
    if (selectedRoadId) {
      const selected = roads.find(r => r.id === selectedRoadId);
      if (selected && selected.coordinates && selected.coordinates.length > 0) {
        const midIdx = Math.floor(selected.coordinates.length / 2);
        return selected.coordinates[midIdx];
      }
    }
    return defaultCenter;
  }, [selectedRoadId, draggablePosition, roads]);

  // Marker drag event
  const markerHandlers = useMemo(() => ({
    dragend(e: any) {
      const marker = e.target;
      if (marker && onCoordinatesChange) {
        const position = marker.getLatLng();
        onCoordinatesChange({ lat: Number(position.lat.toFixed(5)), lng: Number(position.lng.toFixed(5)) });
      }
    }
  }), [onCoordinatesChange]);

  const handleMapClick = (coords: { lat: number; lng: number }) => {
    if (onCoordinatesChange) {
      onCoordinatesChange({ lat: Number(coords.lat.toFixed(5)), lng: Number(coords.lng.toFixed(5)) });
    }
  };

  return (
    <div 
      className={`w-full h-full relative rounded-xl overflow-hidden border border-card-border ${!draggablePosition ? 'min-h-[400px]' : 'min-h-0'}`} 
      style={{ height: '100%' }}
    >
      
      {/* Static Centered Orange Pin Overlay for Geolocation */}
      {draggablePosition && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[1000] pointer-events-none flex flex-col items-center select-none">
          <div className="h-8 w-8 rounded-full bg-amber-500/20 border-2 border-amber-500 flex items-center justify-center shadow-[0_0_15px_#f59e0b] animate-pulse">
            <div className="h-3 w-3 rounded-full bg-amber-500"></div>
          </div>
          {/* Subtle anchor line pointing to center dot */}
          <div className="h-2 w-[2px] bg-amber-500 mt-[-1px]"></div>
        </div>
      )}
      
      {isLoadingRoads && (
        <div className="absolute top-4 right-4 z-[1000] bg-white/95 dark:bg-slate-950/90 text-slate-600 dark:text-slate-400 px-3 py-1.5 rounded-lg text-[10px] font-extrabold uppercase border border-slate-500/20 shadow-xl flex items-center gap-1.5 backdrop-blur-md">
          <RefreshCw className="h-3 w-3 animate-spin text-slate-500" />
          <span>Streaming local road grid...</span>
        </div>
      )}

      {errorMessage && (
        <div className="absolute top-16 right-4 z-[1000] bg-red-950/95 border border-red-500/30 text-red-200 px-4 py-2.5 rounded-xl text-xs font-bold shadow-2xl flex items-center gap-2 animate-in fade-in slide-in-from-top-2 duration-300 backdrop-blur-md">
          <AlertTriangle className="h-4 w-4 text-red-500 shrink-0 animate-bounce" />
          <span>{errorMessage}</span>
          <button 
            type="button"
            onClick={() => setErrorMessage('')} 
            className="ml-2 text-red-400 hover:text-red-200 font-black text-sm hover:scale-110 active:scale-95 transition-transform"
          >
            ✕
          </button>
        </div>
      )}

      <MapContainer
        center={defaultCenter}
        zoom={selectedCity ? 12 : 11}
        className="w-full h-full"
        style={{ 
          background: mapType === 'satellite' ? '#0b0f19' : '#f8fafc', 
          height: '100%', 
          minHeight: !draggablePosition ? '400px' : '100%' 
        }}
      >
        <ResizeListener />
        {onMapBoundsChange && <MapBoundsListener onBoundsChange={onMapBoundsChange} />}

         <RegionSyncController selectedCity={selectedCity} setSelectedCity={setSelectedCity} />
         <CitySelectorControl selectedCity={selectedCity} onCitySelect={handleCitySelect} />
         <MapCenterSync onCoordinatesChange={onCoordinatesChange} enabled={!!draggablePosition} />

        {/* Silently geolocate user on mount if no pre-defined coordinates are passed */}
        {!draggablePosition && (
          <AutoLocator 
            onLocate={(coords) => {
              if (onCoordinatesChange) {
                onCoordinatesChange(coords);
              }
            }}
            hasAutolocated={hasAutolocated}
            setHasAutolocated={setHasAutolocated}
          />
        )}

        {/* Google Maps / OSM Tile Provider with Switcher */}
        <MapTypeControl mapType={mapType} setMapType={setMapType} />

        <TileLayer
          key={mapType}
          attribution={
            mapType === 'osm'
              ? '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              : '&copy; Google Maps'
          }
          url={
            mapType === 'roadmap'
              ? 'https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}'
              : mapType === 'satellite'
              ? 'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}'
              : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
          }
          maxZoom={20}
        />

        {/* Selected Road center/bounds controller */}
        <SelectedRoadController selectedRoad={roads.find(r => r.id === selectedRoadId) || null} />

        {/* Map Center Controller */}
        {draggablePosition ? <MapController center={activeCenter} /> : null}

        {/* Bounds auto-adjuster (disabled when pinpointing coordinates or after autolocating) */}
        <FitBoundsController bounds={roadBounds} shouldFit={!draggablePosition && !hasAutolocated && roads.some(r => !r.id.startsWith('osm-'))} />

        {/* Click-to-locate handler */}
        {onCoordinatesChange && <MapClickHandler onClick={handleMapClick} />}

        {/* Live GPS locator button */}
        {showLocateButton && (
          <LocateMeButton 
            onLocate={(coords) => {
              if (onCoordinatesChange) {
                onCoordinatesChange(coords);
              }
            }} 
            onError={(msg) => setErrorMessage(msg)}
          />
        )}

        {/* Draw clickable Road Polylines */}
        {roads.map((road) => {
          if (!road.coordinates || road.coordinates.length === 0) return null;
          const color = getConditionColor(road.condition);
          const isSelected = selectedRoadId === road.id;

          return (
            <React.Fragment key={road.id}>
              {/* 1. High contrast Black drop-shadow/backing line */}
              <Polyline
                positions={road.coordinates}
                pathOptions={{
                  color: '#000000',
                  weight: isSelected ? 10 : 6,
                  opacity: 0.5,
                }}
                eventHandlers={{
                  click: () => {
                    if (onSelectRoad) onSelectRoad(road);
                  }
                }}
              />
              
              {/* 2. Inner Solid Core Line */}
              <Polyline
                positions={road.coordinates}
                pathOptions={{
                  color: isSelected ? '#ffffff' : color,
                  weight: isSelected ? 4 : 2.5,
                  opacity: 1.0,
                }}
                eventHandlers={{
                  click: () => {
                    if (onSelectRoad) onSelectRoad(road);
                  }
                }}
              >
                <Popup>
                  <div className="text-slate-900 p-1 font-sans">
                    <h4 className="font-extrabold text-xs">{road.name}</h4>
                    <p className="text-[10px] text-slate-500 font-semibold uppercase">{road.type} • {road.condition} Condition</p>
                    <p className="text-[10px] text-slate-600 mt-1">₹{road.spentAmount}L Spent / ₹{road.sanctionedAmount}L Budget</p>
                  </div>
                </Popup>
              </Polyline>
            </React.Fragment>
          );
        })}

        {/* Old standard draggable Marker removed - replaced by static centered overlay below */}
      </MapContainer>

    </div>
  );
}
