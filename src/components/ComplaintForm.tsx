'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAppState } from '../context/StateContext';
import { Road, CITIES } from '../data/mockData';
import UploadBox from './UploadBox';
import { MapPin, Sparkles, Send, CheckCircle, Wifi, WifiOff, FileText, AlertTriangle, AlertCircle, RefreshCw } from 'lucide-react';
import dynamic from 'next/dynamic';

const RealMap = dynamic(() => import('./RealMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-48 bg-slate-900/30 rounded-xl border border-dashed border-slate-200 dark:border-navy-800 flex items-center justify-center text-slate-400 text-xs">
      <div className="flex items-center gap-2">
        <RefreshCw className="h-4 w-4 animate-spin text-blue-500" />
        <span>Loading Selector Map...</span>
      </div>
    </div>
  )
});

interface ComplaintFormProps {
  preselectedRoadId?: string;
  onSuccessRedirect?: (id: string) => void;
}

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
    const res = await fetch('https://freeipapi.com/api/json/');
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
    const res = await fetch('https://ipapi.co/json/');
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
    const res = await fetch('https://ipinfo.io/json');
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

export default function ComplaintForm({ preselectedRoadId = '', onSuccessRedirect }: ComplaintFormProps) {
  const { roads, addComplaint, authorities, draftComplaint, saveDraftComplaint, addRoad, currentUser } = useAppState();

  const hasLoadedDraft = useRef(false);

  // Form states
  const [roadId, setRoadId] = useState(preselectedRoadId);
  const [customRoadName, setCustomRoadName] = useState('');
  const [issueType, setIssueType] = useState<'pothole' | 'crack' | 'waterlogging' | 'street light' | 'drainage'>('pothole');
  const [description, setDescription] = useState('');
  const [reporterName, setReporterName] = useState('');
  const [reporterPhone, setReporterPhone] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [isLocating, setIsLocating] = useState(false);

  const handleSelectRoad = useCallback((r: Road) => {
    setRoadId(r.id);
  }, []);

  const handleCoordinatesChange = useCallback((coords: { lat: number; lng: number }) => {
    setLatitude(coords.lat);
    setLongitude(coords.lng);
  }, []);

  // AI & Submission states
  const [aiSeverity, setAiSeverity] = useState<'Low' | 'Medium' | 'Critical'>('Low');
  const [aiConfidence, setAiConfidence] = useState<number>(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [successComplaint, setSuccessComplaint] = useState<{ id: string; authorityName: string } | null>(null);

  // Validation
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Sync state from preselected road
  useEffect(() => {
    if (preselectedRoadId) {
      setRoadId(preselectedRoadId);
    }
  }, [preselectedRoadId]);

  // Snap coordinates to road midpoint when road is selected
  useEffect(() => {
    if (roadId && !latitude && !longitude) {
      const selected = roads.find(r => r.id === roadId);
      if (selected && selected.coordinates && selected.coordinates.length > 0) {
        const midIdx = Math.floor(selected.coordinates.length / 2);
        const [lat, lng] = selected.coordinates[midIdx];
        setLatitude(lat);
        setLongitude(lng);
      }
    }
  }, [roadId, roads, latitude, longitude]);

  // Silently geolocate user on initial page load if no draft or preselected road has set coordinates
  useEffect(() => {
    if (!latitude && !longitude && !preselectedRoadId) {
      // 1. Try preferred city from cache first
      const preferred = typeof window !== 'undefined' ? localStorage.getItem('roadwatch_preferred_city') : null;
      if (preferred) {
        const city = CITIES.find(c => c.name === preferred);
        if (city) {
          setLatitude(city.coords[0]);
          setLongitude(city.coords[1]);
          return;
        }
      }

      // 2. Fallback to IP Geolocation
      fetchIPGeolocation().then((ipCoords) => {
        if (ipCoords) {
          setLatitude(Number(ipCoords.lat.toFixed(5)));
          setLongitude(Number(ipCoords.lng.toFixed(5)));
        }
      });
    }
  }, []);

  // Pre-fill reporter name from logged in user if not already set
  useEffect(() => {
    if (currentUser && !draftComplaint) {
      if (!reporterName) setReporterName(currentUser.name);
    }
  }, [currentUser, draftComplaint, reporterName]);

  // Load draft if available
  useEffect(() => {
    if (draftComplaint) {
      if (!hasLoadedDraft.current) {
        if (draftComplaint.roadId) setRoadId(draftComplaint.roadId);
        if (draftComplaint.issueType) setIssueType(draftComplaint.issueType);
        if (draftComplaint.description) setDescription(draftComplaint.description);
        if (draftComplaint.reporterName) setReporterName(draftComplaint.reporterName);
        if (draftComplaint.reporterPhone) setReporterPhone(draftComplaint.reporterPhone);
        if (draftComplaint.imageUrl) setImageUrl(draftComplaint.imageUrl);
        if (draftComplaint.gpsLocation) {
          setLatitude(draftComplaint.gpsLocation.lat);
          setLongitude(draftComplaint.gpsLocation.lng);
        }
        hasLoadedDraft.current = true;
      }
    } else {
      hasLoadedDraft.current = false;
    }
  }, [draftComplaint]);

  // Save draft on form updates
  useEffect(() => {
    if (!successComplaint && (roadId || description || reporterName || reporterPhone || imageUrl || latitude)) {
      saveDraftComplaint({
        roadId,
        issueType,
        description,
        reporterName,
        reporterPhone,
        imageUrl,
        gpsLocation: latitude && longitude ? { lat: latitude, lng: longitude } : undefined
      });
    }
  }, [roadId, issueType, description, reporterName, reporterPhone, imageUrl, latitude, longitude]);

  // Run AI classification mockup based on issue type and text description keywords
  useEffect(() => {
    if (!description && !imageUrl) {
      setAiSeverity('Low');
      setAiConfidence(0);
      return;
    }

    const descLower = description.toLowerCase();
    let severity: 'Low' | 'Medium' | 'Critical' = 'Low';
    let confidence = 75;

    // Severity trigger keywords
    const criticalKeywords = ['dangerous', 'accident', 'crash', 'severe', 'hospital', 'injury', 'wrecked', 'overflowing', 'flooded', 'critical', 'deep', 'tire damage'];
    const mediumKeywords = ['annoyance', 'bump', 'slowdown', 'leak', 'large', 'cracked', 'dark', 'blocked'];

    const hasCriticalText = criticalKeywords.some(kw => descLower.includes(kw));
    const hasMediumText = mediumKeywords.some(kw => descLower.includes(kw));

    if (issueType === 'waterlogging' || issueType === 'drainage') {
      severity = hasCriticalText ? 'Critical' : 'Medium';
      confidence = hasCriticalText ? 94 : 85;
    } else if (issueType === 'pothole') {
      if (hasCriticalText) {
        severity = 'Critical';
        confidence = 92;
      } else if (hasMediumText) {
        severity = 'Medium';
        confidence = 88;
      } else {
        severity = 'Medium';
        confidence = 79;
      }
    } else if (issueType === 'street light') {
      severity = hasCriticalText ? 'Medium' : 'Low';
      confidence = 82;
    } else if (issueType === 'crack') {
      severity = hasCriticalText ? 'Medium' : 'Low';
      confidence = 84;
    }

    // Boost confidence if image is uploaded
    if (imageUrl) {
      confidence = Math.min(confidence + 5, 98);
    }

    setAiSeverity(severity);
    setAiConfidence(confidence);
  }, [issueType, description, imageUrl]);

  // GPS coordinates fetch with robust dual-try and IP-first geolocation fallback
  const handleFetchGPS = async () => {
    setIsLocating(true);
    setErrors(prev => ({ ...prev, gps: '' }));

    // Helper: resolve actual physical location from IP first, then stored preferred city
    const resolveFromFallback = async () => {
      // 1. Try IP Geolocation first to get actual physical coordinates
      try {
        const ipCoords = await fetchIPGeolocation();
        if (ipCoords) {
          setLatitude(Number(ipCoords.lat.toFixed(5)));
          setLongitude(Number(ipCoords.lng.toFixed(5)));
          setIsLocating(false);
          return;
        }
      } catch (err) {
        console.warn('IP Geolocation failed in fallback:', err);
      }

      // 2. Only if IP fails, fall back to preferred city from the region selector
      const preferred = typeof window !== 'undefined' ? localStorage.getItem('roadwatch_preferred_city') : null;
      if (preferred) {
        const city = CITIES.find(c => c.name === preferred);
        if (city) {
          setLatitude(city.coords[0]);
          setLongitude(city.coords[1]);
          setIsLocating(false);
          return;
        }
      }
      setIsLocating(false);
    };

    // If browser does not support geolocation, run fallback
    if (!navigator.geolocation) {
      await resolveFromFallback();
      return;
    }

    // Try real browser GPS with standard high accuracy and generous 10s timeout
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLatitude(Number(position.coords.latitude.toFixed(5)));
        setLongitude(Number(position.coords.longitude.toFixed(5)));
        setIsLocating(false);
      },
      (err) => {
        console.warn('High accuracy GPS error/timeout:', err);
        // Fallback to standard cellular / Wi-Fi accuracy
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            setLatitude(Number(pos.coords.latitude.toFixed(5)));
            setLongitude(Number(pos.coords.longitude.toFixed(5)));
            setIsLocating(false);
          },
          async (err2) => {
            console.warn('Standard geolocation failed, falling back to IP:', err2);
            await resolveFromFallback();
          },
          { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }
        );
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  };


  const handleDiscardDraft = () => {
    saveDraftComplaint(null);
    setRoadId('');
    setIssueType('pothole');
    setDescription('');
    setReporterName('');
    setReporterPhone('');
    setImageUrl('');
    setLatitude(null);
    setLongitude(null);
    setErrors({});
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: Record<string, string> = {};

    if (!roadId) newErrors.roadId = 'Please select the affected road segment.';
    if (roadId === 'custom-road' && !customRoadName.trim()) newErrors.customRoadName = 'Please enter the custom road name.';
    if (!description || description.length < 15) newErrors.description = 'Please provide a detailed description (min 15 chars).';
    if (!reporterName) newErrors.reporterName = 'Reporter name is required.';
    if (!reporterPhone) {
      newErrors.reporterPhone = 'Mobile number is required.';
    } else {
      const cleaned = reporterPhone.replace(/\D/g, '');
      if (cleaned.length !== 10) {
        newErrors.reporterPhone = 'Mobile number must be exactly 10 digits.';
      }
    }
    if (!latitude || !longitude) newErrors.gps = 'Please attach location GPS coordinates.';

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      // Scroll to top of form to see errors
      return;
    }

    setIsSubmitting(true);

    // Simulate submission delay
    setTimeout(() => {
      if (isOffline) {
        // If simulated offline, save to pending drafts state or tell the user we saved it offline!
        alert("Network disconnected! Saving your complaint draft locally. It will auto-sync when online.");
        setIsSubmitting(false);
        return;
      }

      let finalRoadId = roadId;
      if (roadId === 'custom-road') {
        const name = customRoadName.trim();
        const roadType: Road['type'] = name.toUpperCase().includes('NH') ? 'NH' : name.toUpperCase().includes('SH') ? 'SH' : name.toUpperCase().includes('MDR') ? 'MDR' : 'Local Road';
        
        const newR = addRoad({
          name: name.toUpperCase(),
          type: roadType,
          condition: aiSeverity === 'Critical' ? 'Critical' : aiSeverity === 'Medium' ? 'Damaged' : 'Moderate',
          contractorId: 'contractor-1',
          sanctionedAmount: 250,
          spentAmount: 240,
          lastRelayingDate: new Date().toISOString().split('T')[0],
          lengthKm: 1.2,
          coordinates: [
            [latitude! - 0.002, longitude! - 0.002],
            [latitude!, longitude!],
            [latitude! + 0.002, longitude! + 0.002]
          ]
        });
        finalRoadId = newR.id;
      }

      const newComp = addComplaint({
        roadId: finalRoadId,
        issueType,
        description,
        severity: aiSeverity,
        reporterName,
        reporterPhone,
        reporterEmail: currentUser?.email || undefined,
        imageUrl: imageUrl || 'https://images.unsplash.com/photo-1515162305285-0293e4767cc2?q=80&w=800&auto=format&fit=crop',
        gpsLocation: { lat: latitude!, lng: longitude! },
      });

      // Find authority routed
      const auth = authorities.find(a => a.id === newComp.assignedAuthorityId);

      setSuccessComplaint({
        id: newComp.id,
        authorityName: auth ? `${auth.name} (${auth.role})` : 'Executive Ward Engineer'
      });

      setIsSubmitting(false);
      saveDraftComplaint(null); // Clear draft
    }, 1800);
  };

  return (
    <div className="w-full">
      {successComplaint ? (
        // Success panel
        <div className="glass-panel p-8 text-center bg-opacity-70 dark:bg-opacity-35 border border-card-border glow-emerald max-w-lg mx-auto animate-in zoom-in-95 duration-200">
          <div className="h-16 w-16 bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 rounded-full flex items-center justify-center mx-auto mb-5 glow-emerald">
            <CheckCircle className="h-8 w-8" />
          </div>
          
          <h3 className="text-2xl font-black text-slate-800 dark:text-white">Complaint Logged Successfully!</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
            Your complaint has been parsed, geo-tagged, and dispatched directly to the responsible division head.
          </p>

          <div className="bg-slate-100 dark:bg-navy-950/60 p-4 rounded-xl border border-slate-200 dark:border-navy-900 my-6 text-left space-y-3 font-medium text-xs">
            <div className="flex justify-between">
              <span className="text-slate-500">Complaint Ticket ID:</span>
              <span className="font-extrabold text-blue-600 dark:text-blue-400 font-mono text-sm">{successComplaint.id}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">AI Severity Rating:</span>
              <span className={`font-bold uppercase ${
                aiSeverity === 'Critical' ? 'text-red-500' : aiSeverity === 'Medium' ? 'text-amber-500' : 'text-emerald-500'
              }`}>{aiSeverity} ({aiConfidence}% confidence)</span>
            </div>
            <div className="flex flex-col pt-2 border-t border-slate-200 dark:border-navy-800">
              <span className="text-slate-500 mb-1">Assigned Executive:</span>
              <span className="font-bold text-slate-800 dark:text-slate-200">{successComplaint.authorityName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Expected Resolution:</span>
              <span className="font-bold text-slate-700 dark:text-slate-300">
                {aiSeverity === 'Critical' ? '48 Hours' : aiSeverity === 'Medium' ? '5 Days' : '10 Days'}
              </span>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={() => {
                if (onSuccessRedirect) {
                  onSuccessRedirect(successComplaint.id);
                } else {
                  window.location.href = `/tracker?id=${successComplaint.id}`;
                }
              }}
              className="flex-1 px-5 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-bold shadow-md transition-all active:scale-98"
            >
              Track Progress
            </button>
            <button
              onClick={() => {
                setSuccessComplaint(null);
                handleDiscardDraft(); // Resets forms
              }}
              className="px-5 py-3 bg-slate-100 dark:bg-navy-800 hover:bg-slate-200 dark:hover:bg-navy-700 text-slate-700 dark:text-white rounded-lg text-sm font-semibold border border-slate-200 dark:border-navy-700 transition-all active:scale-98"
            >
              Report Another
            </button>
          </div>
        </div>
      ) : (
        // Complaint Form
        <form onSubmit={handleSubmit} className="glass-panel p-6 sm:p-8 bg-opacity-65 dark:bg-opacity-25 border border-card-border shadow-xl space-y-6">
          
          {/* Header & Connectivity Control */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between pb-4 border-b border-slate-200 dark:border-navy-800/80 gap-3">
            <div>
              <h2 className="text-xl font-extrabold text-slate-800 dark:text-white">File Municipal Complaint</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Fields are auto-saved locally in real-time. Draft persists offline.</p>
            </div>
            
            {/* Connectivity Switch */}
            <button
              type="button"
              onClick={() => setIsOffline(!isOffline)}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                isOffline 
                  ? 'bg-red-500/10 text-red-500 border-red-500/20 glow-rose' 
                  : 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20 glow-emerald'
              }`}
            >
              {isOffline ? (
                <>
                  <WifiOff className="h-3.5 w-3.5" />
                  <span>Offline Simulator</span>
                </>
              ) : (
                <>
                  <Wifi className="h-3.5 w-3.5" />
                  <span>Online System</span>
                </>
              )}
            </button>
          </div>

          {/* Draft Alert */}
          {draftComplaint && (
            <div className="bg-blue-600/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 px-4 py-3 rounded-lg text-xs flex justify-between items-center font-medium">
              <span className="flex items-center gap-1.5">
                <FileText className="h-4 w-4" />
                <span>Restored active draft from local cache.</span>
              </span>
              <button 
                type="button" 
                onClick={handleDiscardDraft}
                className="text-[10px] text-red-500 font-extrabold uppercase hover:underline"
              >
                Discard
              </button>
            </div>
          )}

          <div className="space-y-6 max-w-3xl mx-auto">
            
            {/* Form Details */}
            <div className="space-y-6">
              
              {/* Select Road */}
              <div className="space-y-2">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  Select Damaged Road Segment
                </label>
                <select
                  value={roadId}
                  onChange={(e) => setRoadId(e.target.value)}
                  className={`w-full px-3 py-2 border rounded-lg text-sm bg-white/70 dark:bg-navy-950/70 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-slate-100 ${
                    errors.roadId ? 'border-red-500 focus:ring-red-500' : 'border-slate-200 dark:border-navy-700'
                  }`}
                >
                  <option value="">-- Click to choose segment --</option>
                  {roads.map(road => (
                    <option key={road.id} value={road.id}>
                      {road.name} ({road.type} • {road.condition})
                    </option>
                  ))}
                  <option value="custom-road">➕ Register New / Other Road</option>
                </select>

                {roadId === 'custom-road' && (
                  <div className="mt-2 space-y-1 animate-in slide-in-from-top-1 duration-200">
                    <input
                      type="text"
                      placeholder="Enter road name (e.g. NH 44, GST Road)..."
                      value={customRoadName}
                      onChange={(e) => setCustomRoadName(e.target.value)}
                      className={`w-full px-3 py-2 border rounded-lg text-sm bg-white/70 dark:bg-navy-950/70 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-slate-100 ${
                        errors.customRoadName ? 'border-red-500 focus:ring-red-500' : 'border-slate-200 dark:border-navy-700'
                      }`}
                    />
                    {errors.customRoadName && (
                      <p className="text-red-500 text-[10px] font-bold flex items-center gap-1 mt-1">
                        <AlertCircle className="h-3 w-3" />
                        <span>{errors.customRoadName}</span>
                      </p>
                    )}
                  </div>
                )}

                {errors.roadId && (
                  <p className="text-red-500 text-[10px] font-bold flex items-center gap-1 mt-1">
                    <AlertCircle className="h-3 w-3" />
                    <span>{errors.roadId}</span>
                  </p>
                )}
              </div>

              {/* Issue Type */}
              <div className="space-y-2">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  Issue Type
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(['pothole', 'crack', 'waterlogging', 'street light', 'drainage'] as const).map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setIssueType(type)}
                      className={`py-2 rounded-lg text-xs font-bold uppercase transition-all capitalize border ${
                        issueType === type
                          ? 'bg-blue-600 text-white border-blue-600 shadow glow-blue'
                          : 'bg-white/40 dark:bg-navy-900/40 text-slate-650 hover:bg-white/70 dark:hover:bg-navy-850'
                      }`}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </div>

              {/* Description */}
              <div className="space-y-2">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  Damage Description
                </label>
                <textarea
                  rows={4}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe details (e.g. depth of pothole, caused accidents, dark stretch, blocked inlets, etc.)"
                  className={`w-full px-3 py-2 border rounded-lg text-sm bg-white/70 dark:bg-navy-950/70 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-slate-100 ${
                    errors.description ? 'border-red-500 focus:ring-red-500' : 'border-slate-200 dark:border-navy-700'
                  }`}
                />
                {errors.description && (
                  <p className="text-red-500 text-[10px] font-bold flex items-center gap-1 mt-1">
                    <AlertCircle className="h-3 w-3" />
                    <span>{errors.description}</span>
                  </p>
                )}
              </div>

              {/* GPS Coordinates */}
              <div className="space-y-2.5">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  Geo-Tag Coordinates (Automatic GPS & Map Pin)
                </label>
                
                <div className="flex gap-2">
                  <div className="flex-1 grid grid-cols-2 gap-2 text-xs font-medium font-mono">
                    <div className="bg-slate-100 dark:bg-navy-900/60 p-2.5 rounded-lg border border-slate-200 dark:border-navy-800 text-slate-600 dark:text-slate-350">
                      Lat: {latitude ? latitude : '---'}
                    </div>
                    <div className="bg-slate-100 dark:bg-navy-900/60 p-2.5 rounded-lg border border-slate-200 dark:border-navy-800 text-slate-600 dark:text-slate-350">
                      Lng: {longitude ? longitude : '---'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleFetchGPS}
                    disabled={isLocating}
                    className="px-4 bg-blue-600/10 hover:bg-blue-600/20 text-blue-500 dark:text-blue-400 font-bold border border-blue-500/20 rounded-lg text-xs flex items-center gap-1.5 active:scale-95 disabled:opacity-50 transition-transform"
                  >
                    {isLocating ? (
                      <>
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        <span>Locating...</span>
                      </>
                    ) : (
                      <>
                        <MapPin className="h-3.5 w-3.5 text-emerald-400" />
                        <span>Get GPS</span>
                      </>
                    )}
                  </button>
                </div>
                {errors.gps && (
                  <p className="text-red-500 text-[10px] font-bold flex items-center gap-1 mt-1">
                    <AlertCircle className="h-3 w-3" />
                    <span>{errors.gps}</span>
                  </p>
                )}

                {/* Leaflet Draggable Geolocation Selector Map */}
                <div className="w-full h-80 border border-slate-200 dark:border-navy-800 rounded-xl overflow-hidden mt-2 relative z-0">
                  <RealMap
                    roads={roads}
                    selectedRoadId={roadId}
                    onSelectRoad={handleSelectRoad}
                    draggablePosition={latitude && longitude ? { lat: latitude, lng: longitude } : { lat: 13.04, lng: 80.24 }}
                    onCoordinatesChange={handleCoordinatesChange}
                    showLocateButton={false}
                  />
                  <div className="absolute bottom-2 left-2 z-[400] bg-white/90 dark:bg-slate-900/90 text-slate-700 dark:text-white px-2.5 py-1 rounded text-[9px] font-semibold border border-slate-200 dark:border-slate-800 backdrop-blur-sm pointer-events-none">
                    Drag the orange pin or click map to choose location
                  </div>
                </div>
              </div>

            </div>

            {/* Files & Geo-tagging */}
            <div className="space-y-6">
              
              {/* Image Upload Box */}
              <UploadBox 
                onFileSelect={(url) => setImageUrl(url)}
                selectedFileUrl={imageUrl}
                onClear={() => setImageUrl('')}
              />

              {/* AI Severity Indicator Box */}
              {(description || imageUrl) && (
                <div className="p-4 bg-slate-100 dark:bg-navy-900/50 rounded-xl border border-slate-200 dark:border-navy-800 text-xs flex items-start gap-3 animate-in fade-in duration-200">
                  <div className="p-2 bg-blue-500/10 text-blue-500 rounded-lg border border-blue-500/20">
                    <Sparkles className="h-4.5 w-4.5 text-yellow-400 animate-pulse" />
                  </div>
                  <div className="flex-1">
                    <span className="font-extrabold uppercase text-[10px] text-blue-500">Road Sentry AI Assistant</span>
                    <p className="text-slate-700 dark:text-slate-200 font-semibold mt-1">
                      Predicted Severity: <span className={`font-black ${
                        aiSeverity === 'Critical' ? 'text-red-500' : aiSeverity === 'Medium' ? 'text-amber-500' : 'text-emerald-500'
                      }`}>{aiSeverity}</span>
                    </p>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                      Confidence score: {aiConfidence}%. Auto-routes to corresponding Area Executive Engineer.
                    </p>
                  </div>
                </div>
              )}

            </div>
          </div>

          {/* Reporter Details (Row) */}
          <div className="flex flex-col gap-4 pt-4 border-t border-slate-200 dark:border-navy-800/80 max-w-3xl mx-auto w-full">
            <div className="space-y-2">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                Citizen Reporter Name
              </label>
              <input
                type="text"
                value={reporterName}
                onChange={(e) => setReporterName(e.target.value)}
                placeholder="Enter full name"
                className={`w-full px-3 py-2 border rounded-lg text-sm bg-white/70 dark:bg-navy-950/70 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-slate-100 ${
                  errors.reporterName ? 'border-red-500 focus:ring-red-500' : 'border-slate-200 dark:border-navy-700'
                }`}
              />
              {errors.reporterName && (
                <p className="text-red-500 text-[10px] font-bold flex items-center gap-1 mt-1">
                  <AlertCircle className="h-3 w-3" />
                  <span>{errors.reporterName}</span>
                </p>
              )}
            </div>
            <div className="space-y-2">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                Mobile Number
              </label>
              <input
                type="tel"
                value={reporterPhone}
                onChange={(e) => {
                  const cleaned = e.target.value.replace(/\D/g, '');
                  if (cleaned.length <= 10) {
                    setReporterPhone(cleaned);
                  }
                }}
                maxLength={10}
                placeholder="10-digit mobile number"
                className={`w-full px-3 py-2 border rounded-lg text-sm bg-white/70 dark:bg-navy-950/70 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-slate-100 ${
                  errors.reporterPhone ? 'border-red-500 focus:ring-red-500' : 'border-slate-200 dark:border-navy-700'
                }`}
              />
              {errors.reporterPhone && (
                <p className="text-red-500 text-[10px] font-bold flex items-center gap-1 mt-1">
                  <AlertCircle className="h-3 w-3" />
                  <span>{errors.reporterPhone}</span>
                </p>
              )}
            </div>
          </div>

          {/* Submit Action */}
          <div className="pt-2 max-w-3xl mx-auto w-full">
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-4 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-700 hover:to-blue-600 disabled:from-blue-400 disabled:to-blue-300 text-white rounded-xl font-bold flex items-center justify-center gap-2 transition-all shadow-lg hover:shadow-blue-500/20 active:scale-98 disabled:scale-100 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <>
                  <RefreshCw className="h-5 w-5 animate-spin" />
                  <span>Dispatching to Engineer Database...</span>
                </>
              ) : (
                <>
                  <Send className="h-5 w-5" />
                  <span>{isOffline ? 'Save Offline Complaint Draft' : 'Submit and Route Complaint'}</span>
                </>
              )}
            </button>
          </div>

        </form>
      )}
    </div>
  );
}
