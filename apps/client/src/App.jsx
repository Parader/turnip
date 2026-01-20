import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ColyseusProvider, useColyseus } from './context/ColyseusContext';
import ProtectedRoute from './components/ProtectedRoute';
import Login from './components/Login';
import Register from './components/Register';
import Dashboard from './components/Dashboard';
import Lobby from './components/Lobby';
import Game from './components/Game';
import InvitationNotification from './components/InvitationNotification';
import './styles/main.scss';

// Global invitation handler component (must be inside Router)
function GlobalInvitationHandler() {
  const { user } = useAuth();
  const { lobbyInvitation, room, clearLobbyInvitation } = useColyseus();
  const navigate = useNavigate();
  const location = useLocation();

  // Only show if user is authenticated
  if (!user) return null;

  const handleAcceptInvitation = () => {
    if (!lobbyInvitation || !room) return;

    // Store invitation data before clearing (so Lobby can use it)
    const invitationData = { ...lobbyInvitation };
    console.log('Global handler: Accepting invitation', invitationData);
    
    // Clear invitation immediately to close the modal
    clearLobbyInvitation();
    
    // Navigate to lobby if not already there
    if (location.pathname !== '/lobby') {
      navigate('/lobby');
      // Wait for navigation to complete, then dispatch event
      // Use requestAnimationFrame to ensure DOM is ready
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const event = new CustomEvent('lobbyInvitationAccepted', {
            detail: { invitation: invitationData }
          });
          console.log('Global handler: Dispatching event after navigation', event);
          window.dispatchEvent(event);
        });
      });
    } else {
      // Already in lobby, dispatch immediately
      const event = new CustomEvent('lobbyInvitationAccepted', {
        detail: { invitation: invitationData }
      });
      console.log('Global handler: Dispatching event (already in lobby)', event);
      window.dispatchEvent(event);
    }
  };

  const handleDeclineInvitation = () => {
    if (!lobbyInvitation || !room) return;

    room.send('respondToInvitation', {
      inviterId: lobbyInvitation.inviterId,
      accepted: false,
      partyInfo: null
    });

    clearLobbyInvitation();
  };

  return (
    <InvitationNotification
      invitation={lobbyInvitation}
      onAccept={handleAcceptInvitation}
      onDecline={handleDeclineInvitation}
    />
  );
}

function AppContent() {
  return (
    <>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lobby"
          element={
            <ProtectedRoute>
              <Lobby />
            </ProtectedRoute>
          }
        />
        <Route
          path="/game"
          element={
            <ProtectedRoute>
              <Game />
            </ProtectedRoute>
          }
        />
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
      </Routes>
      <GlobalInvitationHandler />
    </>
  );
}

function App() {
  return (
    <AuthProvider>
      <ColyseusProvider>
        <BrowserRouter
          future={{
            v7_startTransition: true,
            v7_relativeSplatPath: true,
          }}
        >
          <AppContent />
        </BrowserRouter>
      </ColyseusProvider>
    </AuthProvider>
  );
}

export default App;

