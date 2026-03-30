import TrackMap from '../../maps/TrackMap';

interface MapModuleProps {
  points: { lat: number; lng: number; distance?: number }[];
  sections?: { name: string; start_distance: number; end_distance: number }[];
  height: number;
}

export default function MapModule({ points, sections = [], height }: MapModuleProps) {
  const sectionOverlays = sections.map((s) => ({
    name: s.name,
    start: s.start_distance,
    end: s.end_distance,
  }));

  return <TrackMap points={points} sections={sectionOverlays} height={height} />;
}
