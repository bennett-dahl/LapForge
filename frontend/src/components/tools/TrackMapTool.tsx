import TrackMap from '../maps/TrackMap';

interface TrackMapToolProps {
  points: { lat: number; lng: number; distance?: number }[];
  sections?: { name: string; start: number; end: number; color?: string }[];
  lapSplits?: number[];
  height?: number;
}

export default function TrackMapTool(props: TrackMapToolProps) {
  return <TrackMap {...props} />;
}
