import TrackMap from '../../maps/TrackMap';

interface MapModuleProps {
  points: { lat: number; lng: number; distance?: number }[];
  sections?: { name: string; start_distance: number; end_distance: number }[];
  /** Lap boundary distances along the track (same units as point distances). */
  lapSplits?: number[];
  /** Session-cumulative lap split distances (for cursor wrapping). */
  lapSplitDistances?: number[];
  /** Total track length for one lap (enables cursor wrapping across laps). */
  lapLength?: number;
}

export default function MapModule({ points, sections = [], lapSplits, lapSplitDistances, lapLength }: MapModuleProps) {
  const sectionOverlays = sections.map((s) => ({
    name: s.name,
    start: s.start_distance,
    end: s.end_distance,
  }));

  return (
    <TrackMap
      points={points}
      sections={sectionOverlays}
      lapSplits={lapSplits}
      lapSplitDistances={lapSplitDistances}
      lapLength={lapLength}
    />
  );
}
