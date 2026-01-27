import React from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import ProjectsPage from './pages/ProjectsPage';
import ProjectDetailPage from './pages/ProjectDetailPage';
import FileBrowserPage from './pages/FileBrowserPage';
import FileViewerPage from './pages/FileViewerPage';
import ConversationsPage from './pages/ConversationsPage';
import ChatDetailPage from './pages/ChatDetailPage';
import SettingsPage from './pages/SettingsPage';

function ProtectedRoute({ children }) {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();
  
  // Wait for auth to finish loading before redirecting
  if (isLoading) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '100vh',
        background: '#0f0f1a',
        color: '#fff'
      }}>
        Loading...
      </div>
    );
  }
  
  if (!isAuthenticated) {
    // Preserve query params (like ?token=xxx) when redirecting to login
    return <Navigate to={`/login${location.search}`} replace />;
  }
  
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/*"
        element={
          <ProtectedRoute>
            <Layout>
              <Routes>
                <Route path="/" element={<ProjectsPage />} />
                <Route path="/projects" element={<ProjectsPage />} />
                <Route path="/projects/:projectId" element={<ProjectDetailPage />} />
                <Route path="/files" element={<FileBrowserPage />} />
                <Route path="/file" element={<FileViewerPage />} />
                <Route path="/conversations" element={<ConversationsPage />} />
                <Route path="/chat/:chatId" element={<ChatDetailPage />} />
                <Route path="/settings" element={<SettingsPage />} />
              </Routes>
            </Layout>
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}
