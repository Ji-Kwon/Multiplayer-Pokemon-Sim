import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import TeamList from './pages/TeamList';
import TeamBuilder from './pages/TeamBuilder';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/teams" replace />} />
        <Route path="/teams" element={<TeamList />} />
        <Route path="/teams/new" element={<TeamBuilder />} />
        <Route path="/teams/:id" element={<TeamBuilder />} />
      </Routes>
    </BrowserRouter>
  );
}
