/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { Sources } from './pages/Sources';
import { Runs } from './pages/Runs';
import { RunDetails } from './pages/RunDetails';
import { Analyzers } from './pages/Analyzers';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="sources" element={<Sources />} />
        <Route path="runs" element={<Runs />} />
        <Route path="runs/:id" element={<RunDetails />} />
        <Route path="analyzers" element={<Analyzers />} />
        <Route path="settings" element={<div className="p-8">Settings coming soon</div>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
