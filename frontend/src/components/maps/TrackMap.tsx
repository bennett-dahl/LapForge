import { useEffect, useMemo, useRef } from 'react';
import {
  MapContainer,
  TileLayer,
  LayersControl,
  Polyline,
  CircleMarker,
  useMap,
} from 'react-leaflet';
import type { LatLngExpression } from 'leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useCursorSync } from '../../contexts/CursorSyncContext';

interface TrackMapProps {
  points: { lat: number; lng: number; distance?: number }[];
  sections?: { name: string; start: number; end: number; color?: string }[];
  lapSplits?: number[];
  /** Lap split distances in session-cumulative space (for converting cursor distance to local). */
  lapSplitDistances?: number[];
  /** Total track length for one lap (enables cursor wrapping across laps). */
  lapLength?: number;
  height?: number;
  onMapClick?: (distance: number) => void;
}

/** Chaikin corner-cutting smoothing on a 2D polyline (iterations of subdivision). */
function chaikinSmooth(points: [number, number][], iterations = 2): [number, number][] {
  if (points.length < 2) return points;
  let cur = points;
  for (let iter = 0; iter < iterations; iter++) {
    const next: [number, number][] = [];
    for (let i = 0; i < cur.length - 1; i++) {
      const p0 = cur[i];
      const p1 = cur[i + 1];
      next.push(
        [0.75 * p0[0] + 0.25 * p1[0], 0.75 * p0[1] + 0.25 * p1[1]],
        [0.25 * p0[0] + 0.75 * p1[0], 0.25 * p0[1] + 0.75 * p1[1]],
      );
    }
    cur = next;
  }
  return cur;
}

function interpolatePosition(
  points: { lat: number; lng: number; distance?: number }[],
  targetDist: number,
): [number, number] | null {
  if (!points.length) return null;
  for (let i = 0; i < points.length - 1; i++) {
    const d0 = points[i].distance ?? 0;
    const d1 = points[i + 1].distance ?? 0;
    if (targetDist >= d0 && targetDist <= d1) {
      const frac = d1 > d0 ? (targetDist - d0) / (d1 - d0) : 0;
      return [
        points[i].lat + frac * (points[i + 1].lat - points[i].lat),
        points[i].lng + frac * (points[i + 1].lng - points[i].lng),
      ];
    }
  }
  const last = points[points.length - 1];
  return [last.lat, last.lng];
}

/** Initial bearing from (lat1,lng1) to (lat2,lng2) in degrees, 0 = north, clockwise. */
function bearingDegrees(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function headingAtDistance(
  points: TrackMapProps['points'],
  targetDist: number,
): number {
  if (points.length < 2) return 0;
  const firstD = points[0].distance ?? 0;
  if (targetDist <= firstD) {
    return bearingDegrees(
      points[0].lat,
      points[0].lng,
      points[1].lat,
      points[1].lng,
    );
  }
  for (let i = 0; i < points.length - 1; i++) {
    const d0 = points[i].distance ?? 0;
    const d1 = points[i + 1].distance ?? 0;
    if (targetDist >= d0 && targetDist <= d1) {
      return bearingDegrees(
        points[i].lat,
        points[i].lng,
        points[i + 1].lat,
        points[i + 1].lng,
      );
    }
  }
  const n = points.length;
  return bearingDegrees(
    points[n - 2].lat,
    points[n - 2].lng,
    points[n - 1].lat,
    points[n - 1].lng,
  );
}

function LapSplitMarkers({
  points,
  lapSplits,
}: {
  points: TrackMapProps['points'];
  lapSplits: number[];
}) {
  const markers = useMemo(() => {
    const out: [number, number][] = [];
    for (const d of lapSplits) {
      const p = interpolatePosition(points, d);
      if (p) out.push(p);
    }
    return out;
  }, [points, lapSplits]);

  return (
    <>
      {markers.map((center, i) => (
        <CircleMarker
          key={`split-${i}-${center[0]}-${center[1]}`}
          center={center}
          radius={4}
          pathOptions={{
            color: '#94a3b8',
            fillColor: '#64748b',
            fillOpacity: 0.9,
            weight: 1,
          }}
        />
      ))}
    </>
  );
}

/**
 * Convert a session-cumulative distance to a local-within-lap distance
 * so it maps onto the reference lap track (whose points use 0→lapLength).
 */
function sessionDistToLocal(
  d: number,
  lapSplitDistances: number[] | undefined,
  lapLength: number | undefined,
): number {
  if (!lapLength || lapLength <= 0) return d;
  if (lapSplitDistances && lapSplitDistances.length >= 2) {
    for (let i = lapSplitDistances.length - 1; i >= 0; i--) {
      if (d >= lapSplitDistances[i]) {
        return (d - lapSplitDistances[i]) % lapLength;
      }
    }
  }
  return ((d % lapLength) + lapLength) % lapLength;
}

function CursorMarker({
  points,
  lapSplitDistances,
  lapLength,
}: {
  points: TrackMapProps['points'];
  lapSplitDistances?: number[];
  lapLength?: number;
}) {
  const { distance, mapDistance, setCursor } = useCursorSync();
  const map = useMap();
  const markerRef = useRef<L.Marker | null>(null);
  const iconRef = useRef<L.DivIcon | null>(null);

  const rawDist = mapDistance ?? distance;

  const firstAlong = points[0]?.distance ?? 0;
  const lastAlong =
    points.length > 1 ? (points[points.length - 1]?.distance ?? 0) : firstAlong;

  const needsWrap = lapLength != null && lapLength > 0;

  useEffect(() => {
    if (rawDist == null) {
      if (markerRef.current) {
        markerRef.current.remove();
        markerRef.current = null;
      }
      return;
    }

    let trackDist: number;
    if (needsWrap) {
      trackDist = sessionDistToLocal(rawDist, lapSplitDistances, lapLength);
      trackDist = Math.min(Math.max(trackDist, firstAlong), lastAlong);
    } else {
      trackDist = rawDist;
      if (points.length >= 2 && lastAlong > firstAlong) {
        trackDist = Math.min(Math.max(rawDist, firstAlong), lastAlong);
      }
    }

    const pos = interpolatePosition(points, trackDist);
    if (!pos) {
      if (markerRef.current) {
        markerRef.current.remove();
        markerRef.current = null;
      }
      return;
    }

    const heading = headingAtDistance(points, trackDist);

    if (!markerRef.current) {
      iconRef.current = L.divIcon({
        className: 'cursor-track-marker',
        html: `<div class="cursor-track-marker-inner" style="transform: rotate(${heading}deg)"></div>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      });
      markerRef.current = L.marker(pos, {
        icon: iconRef.current,
        zIndexOffset: 500,
      }).addTo(map);
    } else {
      markerRef.current.setLatLng(pos);
      const inner = markerRef.current.getElement()?.querySelector('.cursor-track-marker-inner') as HTMLElement | null;
      if (inner) {
        inner.style.transform = `rotate(${heading}deg)`;
      }
    }
  }, [rawDist, firstAlong, lastAlong, points, map, needsWrap, lapSplitDistances, lapLength]);

  useEffect(() => {
    return () => {
      if (markerRef.current) {
        markerRef.current.remove();
        markerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    function handleClick(e: L.LeafletMouseEvent) {
      const latlng = e.latlng;
      let bestDist = Infinity;
      let bestDistAlong = 0;
      for (let i = 0; i < points.length; i++) {
        const dx = latlng.lat - points[i].lat;
        const dy = latlng.lng - points[i].lng;
        const d = dx * dx + dy * dy;
        if (d < bestDist) {
          bestDist = d;
          bestDistAlong = points[i].distance ?? 0;
        }
      }
      setCursor({ distance: bestDistAlong, mapDistance: bestDistAlong });
    }
    map.on('click', handleClick);
    return () => {
      map.off('click', handleClick);
    };
  }, [map, points, setCursor]);

  return null;
}

function FitBounds({ points }: { points: LatLngExpression[] }) {
  const map = useMap();
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current || points.length < 2) return;
    map.fitBounds(points as [number, number][], { padding: [20, 20] });
    fitted.current = true;
  }, [map, points]);
  return null;
}

export default function TrackMap({
  points,
  sections = [],
  lapSplits,
  lapSplitDistances,
  lapLength,
  height,
}: TrackMapProps) {
  const positions = useMemo<LatLngExpression[]>(
    () => points.map((p) => [p.lat, p.lng] as [number, number]),
    [points],
  );

  const smoothedPositions = useMemo(() => {
    const asTuples = points.map((p) => [p.lat, p.lng] as [number, number]);
    return chaikinSmooth(asTuples, 2) as LatLngExpression[];
  }, [points]);

  const sectionPolylines = useMemo(() => {
    return sections.map((sec, i) => {
      const pts = points.filter((p) => {
        const d = p.distance ?? 0;
        return d >= sec.start && d <= sec.end;
      });
      const pos: LatLngExpression[] = pts.map((p) => [p.lat, p.lng] as [number, number]);
      return { key: `sec-${i}`, positions: pos, color: sec.color || `hsl(${(i * 47) % 360},60%,50%)` };
    });
  }, [sections, points]);

  if (positions.length < 2) {
    return <div className="track-map-empty" style={{ width: '100%', height: height ?? '100%' }}>No GPS data available</div>;
  }

  const center = positions[0] as [number, number];

  return (
    <div className="track-map" style={{ width: '100%', height: height ?? '100%' }}>
      <MapContainer
        center={center}
        zoom={15}
        style={{ width: '100%', height: '100%' }}
        zoomControl={true}
      >
        <LayersControl position="topright">
          <LayersControl.BaseLayer checked name="Street">
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="Satellite">
            <TileLayer
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              attribution='&copy; Esri'
            />
          </LayersControl.BaseLayer>
        </LayersControl>
        <FitBounds points={smoothedPositions} />
        <Polyline
          positions={smoothedPositions}
          pathOptions={{ color: '#3b82f6', weight: 2, opacity: 0.7 }}
        />
        {sectionPolylines.map((sp) => (
          <Polyline key={sp.key} positions={sp.positions} pathOptions={{ color: sp.color, weight: 4, opacity: 0.6 }} />
        ))}
        {lapSplits != null && lapSplits.length > 0 && (
          <LapSplitMarkers points={points} lapSplits={lapSplits} />
        )}
        <CursorMarker points={points} lapSplitDistances={lapSplitDistances} lapLength={lapLength} />
      </MapContainer>
    </div>
  );
}
