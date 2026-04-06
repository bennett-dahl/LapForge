import { Routes, Route } from 'react-router-dom';
import { UploadProgressProvider } from './contexts/UploadProgressContext';
import GlobalUploadBar from './components/ui/GlobalUploadBar';
import AppLayout from './layouts/AppLayout';
import IndexPage from './pages/IndexPage';
import CarDriversPage from './pages/CarDriversPage';
import TireSetsPage from './pages/TireSetsPage';
import TrackLayoutsPage from './pages/TrackLayoutsPage';
import SessionsPage from './pages/SessionsPage';
import SessionDetailPage from './pages/SessionDetailPage';
import UploadPage from './pages/UploadPage';
import SettingsPage from './pages/SettingsPage';
import ComparePage from './pages/ComparePage';
import CompareDashboardPage from './pages/CompareDashboardPage';
import PlanListPage from './pages/PlanListPage';
import PlanRedirect from './pages/PlanRedirect';
import PlanPage from './pages/PlanPage';
import ElectronUpdateToast from './components/ui/ElectronUpdateToast';

export default function App() {
  return (
    <UploadProgressProvider>
      <GlobalUploadBar />
      <ElectronUpdateToast />
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<IndexPage />} />
          <Route path="car-drivers" element={<CarDriversPage />} />
          <Route path="tire-sets" element={<TireSetsPage />} />
          <Route path="track-layouts" element={<TrackLayoutsPage />} />
          <Route path="sessions" element={<SessionsPage />} />
          <Route path="sessions/:id" element={<SessionDetailPage />} />
          <Route path="upload" element={<UploadPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="plan" element={<PlanListPage />} />
          <Route path="plan/:weekendId" element={<PlanRedirect />} />
          <Route path="plan/:weekendId/:carDriverId" element={<PlanPage />} />
          <Route path="compare" element={<ComparePage />} />
          <Route path="compare/:id" element={<CompareDashboardPage />} />
        </Route>
      </Routes>
    </UploadProgressProvider>
  );
}
