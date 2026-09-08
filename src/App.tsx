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
import { Study } from './pages/Study';
import { MethodReview } from './pages/MethodReview';
import { Results } from './pages/Results';
import { Setup } from './pages/Setup';
import { AccessBoundary, AccessProvider } from './lib/access';

export default function App() {
  return (
    <AccessProvider><Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<AccessBoundary capability="run.view"><Dashboard /></AccessBoundary>} />
        <Route path="sources" element={<AccessBoundary capability="run.view"><Sources /></AccessBoundary>} />
        <Route path="runs" element={<AccessBoundary capability="run.view"><Runs /></AccessBoundary>} />
        <Route path="runs/:id" element={<AccessBoundary capability="run.view"><RunDetails /></AccessBoundary>} />
        <Route path="analyzers" element={<AccessBoundary capability="run.view"><Analyzers /></AccessBoundary>} />
        {/* E1.21-23, added into the existing shell per D11. */}
        <Route path="study" element={<AccessBoundary capability="run.create"><Study /></AccessBoundary>} />
        <Route path="method" element={<AccessBoundary capability="method.propose"><MethodReview /></AccessBoundary>} />
        <Route path="runs/:id/results" element={<AccessBoundary capability="run.view"><Results /></AccessBoundary>} />
        <Route path="setup" element={<Setup />} />
        <Route path="settings" element={<Setup />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes></AccessProvider>
  );
}
