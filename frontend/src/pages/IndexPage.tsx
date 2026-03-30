import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { apiGet } from '../api/client';
import type { CarDriver } from '../types/models';

export default function IndexPage() {
  useEffect(() => {
    document.title = 'LapForge - Home';
  }, []);

  const { data: carDrivers = [] } = useQuery({
    queryKey: ['car-drivers'],
    queryFn: () => apiGet<CarDriver[]>('/api/car-drivers'),
  });

  return (
    <div className="page-content">
      <h1>LapForge</h1>
      <p className="muted">Telemetry analysis for motorsport data.</p>

      {carDrivers.length > 0 && (
        <section className="home-section">
          <h2>Car / Driver</h2>
          <div className="card-grid">
            {carDrivers.map((cd) => (
              <Link key={cd.id} to={`/sessions?car_driver_id=${cd.id}`} className="card card-link">
                <div className="card-title">{cd.car_identifier}</div>
                <div className="card-subtitle">{cd.driver_name}</div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="home-section">
        <h2>Quick Actions</h2>
        <div className="card-grid">
          <Link to="/upload" className="card card-link">
            <div className="card-title">Upload Session</div>
            <div className="card-subtitle">Import Pi Toolbox export data</div>
          </Link>
          <Link to="/sessions" className="card card-link">
            <div className="card-title">View Sessions</div>
            <div className="card-subtitle">Browse and analyze telemetry</div>
          </Link>
          <Link to="/compare" className="card card-link">
            <div className="card-title">Compare</div>
            <div className="card-subtitle">Multi-session overlay analysis</div>
          </Link>
        </div>
      </section>
    </div>
  );
}
