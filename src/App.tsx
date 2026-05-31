import { useState } from 'react';
import TitleBar from './components/TitleBar';
import Sidebar, { type Page } from './components/Sidebar';
import Dashboard from './pages/Dashboard';
import CreateVideo from './pages/CreateVideo';
import MediaLibrary from './pages/MediaLibrary';
import AudioUpload from './pages/AudioUpload';
import SettingsPage from './pages/Settings';
import LicensePage from './pages/License';

export default function App() {
  const [page, setPage] = useState<Page>('dashboard');

  const renderPage = () => {
    switch (page) {
      case 'dashboard': return <Dashboard />;
      case 'create': return <CreateVideo />;
      case 'media': return <MediaLibrary />;
      case 'audio': return <AudioUpload />;
      case 'settings': return <SettingsPage />;
      case 'license': return <LicensePage />;
    }
  };

  return (
    <div className="h-screen flex flex-col bg-[#0f1117] text-white overflow-hidden select-none">
      <TitleBar />
      <div className="flex flex-1 min-h-0">
        <Sidebar activePage={page} onNavigate={setPage} />
        {renderPage()}
      </div>
    </div>
  );
}
