import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import HomePage from './pages/HomePage.js';
import { ExistingSessionRedirect, RequireSession } from './pages/session.js';

// Route-level code splitting keeps the landing page light (NFR-06).
const AuthPage = lazy(() => import('./pages/AuthPage.js'));
const CasesPage = lazy(() => import('./pages/CasesPage.js'));
const GeneratingPage = lazy(() => import('./pages/GeneratingPage.js'));
const CaseBoardPage = lazy(() => import('./pages/CaseBoardPage.js'));
const VerdictPage = lazy(() => import('./pages/VerdictPage.js'));
const SharePage = lazy(() => import('./pages/SharePage.js'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage.js'));

function PageFallback() {
  return (
    <main className="auth-shell" aria-busy="true">
      <p className="loading-line">Opening the case file…</p>
    </main>
  );
}

export default function App() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route
          path="/login"
          element={
            <ExistingSessionRedirect>
              <AuthPage mode="login" />
            </ExistingSessionRedirect>
          }
        />
        <Route
          path="/register"
          element={
            <ExistingSessionRedirect>
              <AuthPage mode="register" />
            </ExistingSessionRedirect>
          }
        />
        <Route path="/cases" element={<CasesPage />} />
        <Route
          path="/cases/:caseId/generating"
          element={
            <RequireSession>
              <GeneratingPage />
            </RequireSession>
          }
        />
        <Route
          path="/cases/:caseId"
          element={
            <RequireSession>
              <CaseBoardPage />
            </RequireSession>
          }
        />
        <Route
          path="/cases/:caseId/verdict"
          element={
            <RequireSession>
              <VerdictPage />
            </RequireSession>
          }
        />
        <Route path="/s/:shareToken" element={<SharePage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
