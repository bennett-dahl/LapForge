import { useEffect, useMemo, useRef } from 'react';
import { MapContainer, Polyline, CircleMarker, useMap } from 'react-leaflet';
import type { LatLngExpression } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useCursorSync } from '../../contexts/CursorSyncContext';

interface TrackMapProps {
  points: { lat: number; lng: number; distance?: number }[];
  sections?: { name: string; start: number; end: number; color?: string }[];
  lapSplits?: number[];
  height?: number;
  onMapClick?: (distance: number) => void;
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

function CursorMarker({ points }: { points: TrackMapProps['points'] }) {
  const { distance, setCursor } = useCursorSync();
  const map = useMap();
  const markerPos = useMemo(() => {
    if (distance == null) return null;
    return interpolatePosition(points, distance);
  }, [distance, points]);

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
    return () => { map.off('click', handleClick); };
  }, [map, points, setCursor]);

  if (!markerPos) return null;
  return <CircleMarker center={markerPos} radius={5} pathOptions={{ color: '#facc15', fillColor: '#facc15', fillOpacity: 1, weight: 2 }} />;
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
  height = 300,
}: TrackMapProps) {
  const positions = useMemo<LatLngExpression[]>(
    () => points.map((p) => [p.lat, p.lng] as [number, number]),
    [points],
  );

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
    return <div className="track-map-empty" style={{ height }}>No GPS data available</div>;
  }

  const center = positions[0] as [number, number];

  return (
    <div className="track-map" style={{ height }}>
      <MapContainer
        center={center}
        zoom={15}
        style={{ width: '100%', height: '100%' }}
        attributionControl={false}
        zoomControl={true}
      >
        <FitBounds points={positions} />
        <Polyline positions={positions} pathOptions={{ color: '#3b82f6', weight: 2, opacity: 0.7 }} />
        {sectionPolylines.map((sp) => (
          <Polyline key={sp.key} positions={sp.positions} pathOptions={{ color: sp.color, weight: 4, opacity: 0.6 }} />
        ))}
        <CursorMarker points={points} />
      </MapContainer>
    </div>
  );
}
