import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useColyseus } from '../context/ColyseusContext';
import { createBabylonScene, disposeBabylonScene } from '../utils/babylonScene';
import { getMap } from '../utils/api';
import { connectToGameRoom } from '../utils/colyseus';
import GameDataPanel from './GameDataPanel';
import TurnOrderDisplay from './TurnOrderDisplay';
import '../styles/game.scss';

const MATCH_INFO_KEY = 'currentMatchInfo';

const Game = () => {
  const { user } = useAuth();
  const { matchFound, clearMatchFound } = useColyseus();
  const navigate = useNavigate();
  const location = useLocation();
  
  const [matchInfo, setMatchInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reconnecting, setReconnecting] = useState(false);
  const [mapData, setMapData] = useState(null);
  const [gameState, setGameState] = useState(null);
  const [gameRoom, setGameRoom] = useState(null);
  const [showGameDataPanel, setShowGameDataPanel] = useState(false);
  const canvasRef = useRef(null);
  const babylonResourcesRef = useRef(null);
  const gameRoomRef = useRef(null);

  // Check if user should be in game - redirect if not
  useEffect(() => {
    if (!user) {
      navigate('/dashboard');
      return;
    }
  }, [user, navigate]);

  // Load match info from location state, localStorage, or context
  useEffect(() => {
    // First, try to get match info from navigation state
    if (location.state?.matchInfo) {
      const info = location.state.matchInfo;
      // Verify user is in one of the teams
      const isInMatch = info.team1.some(m => m.id === user?.id) || 
                        info.team2.some(m => m.id === user?.id);
      if (!isInMatch) {
        // User is not in this match, redirect
        navigate('/dashboard');
        return;
      }
      setMatchInfo(info);
      // Store in localStorage for reconnection
      localStorage.setItem(MATCH_INFO_KEY, JSON.stringify(info));
      setLoading(false);
      return;
    }

    // If match found in context (just received)
    if (matchFound) {
      // Verify user is in one of the teams
      const isInMatch = matchFound.team1.some(m => m.id === user?.id) || 
                        matchFound.team2.some(m => m.id === user?.id);
      if (!isInMatch) {
        // User is not in this match, redirect
        clearMatchFound();
        navigate('/dashboard');
        return;
      }
      setMatchInfo(matchFound);
      localStorage.setItem(MATCH_INFO_KEY, JSON.stringify(matchFound));
      clearMatchFound();
      setLoading(false);
      return;
    }

    // Try to load from localStorage (for reconnection after reload)
    const storedMatchInfo = localStorage.getItem(MATCH_INFO_KEY);
    if (storedMatchInfo) {
      try {
        const info = JSON.parse(storedMatchInfo);
        // Verify user is in one of the teams
        const isInMatch = info.team1.some(m => m.id === user?.id) || 
                          info.team2.some(m => m.id === user?.id);
        if (!isInMatch) {
          // User is not in this match, clear and redirect
          localStorage.removeItem(MATCH_INFO_KEY);
          navigate('/dashboard');
          return;
        }
        setMatchInfo(info);
        setReconnecting(true);
        // TODO: Implement reconnection to game room
        // For now, we'll just show the match info
        setLoading(false);
      } catch (err) {
        console.error('Error parsing stored match info:', err);
        localStorage.removeItem(MATCH_INFO_KEY);
        navigate('/dashboard');
      }
    } else {
      // No match info found, redirect to dashboard immediately
      navigate('/dashboard');
    }
  }, [location.state, matchFound, clearMatchFound, navigate, user]);

  // Load map data when match info is available
  useEffect(() => {
    if (!matchInfo) return;

    // Load map (for now, use map_001 as default)
    // In the future, this could come from matchInfo
    const loadMap = async () => {
      try {
        const map = await getMap('map_001');
        setMapData(map);
      } catch (err) {
        console.error('Failed to load map:', err);
        setError('Failed to load map');
      }
    };

    loadMap();
  }, [matchInfo]);

  // Connect to game room when match info is available
  useEffect(() => {
    if (!matchInfo || !user) return;

    const connectToRoom = async () => {
      try {
        const room = await connectToGameRoom(matchInfo.matchId, user.id, matchInfo);
        gameRoomRef.current = room;
        setGameRoom(room);

        // Listen for game state updates
        room.onMessage('gameState', (state) => {
          setGameState(state);
        });

        // Listen for phase changes
        room.onMessage('phaseChanged', (message) => {
          console.log('Phase changed:', message.phase);
        });

        // Listen for room leave
        room.onLeave(() => {
          gameRoomRef.current = null;
          setGameRoom(null);
        });
      } catch (err) {
        console.error('Failed to connect to game room:', err);
        setError('Failed to connect to game room');
      }
    };

    connectToRoom();

    // Cleanup
    return () => {
      if (gameRoomRef.current) {
        gameRoomRef.current.leave();
        gameRoomRef.current = null;
      }
    };
  }, [matchInfo, user]);

  // Initialize Babylon.js 3D scene when canvas and map data are ready
  useEffect(() => {
    if (!canvasRef.current || !mapData || !matchInfo || !user) return;

    // Create Babylon.js 3D scene with map and initial game state
    const babylonResources = createBabylonScene(canvasRef.current, mapData, matchInfo, user.id, gameState);
    babylonResourcesRef.current = babylonResources;

    // Cleanup on unmount
    return () => {
      if (babylonResourcesRef.current) {
        disposeBabylonScene(babylonResourcesRef.current);
        babylonResourcesRef.current = null;
      }
    };
  }, [mapData, matchInfo, user]);

  // Update player positions when game state changes
  useEffect(() => {
    if (babylonResourcesRef.current && babylonResourcesRef.current.updatePlayers && gameState) {
      babylonResourcesRef.current.updatePlayers(gameState);
    }
  }, [gameState]);
  
  // Set up position change request handler
  useEffect(() => {
    if (babylonResourcesRef.current && babylonResourcesRef.current.setOnPositionChangeRequest && gameRoomRef.current) {
      babylonResourcesRef.current.setOnPositionChangeRequest((x, y) => {
        // Send position change request to server
        if (gameRoomRef.current && gameState?.phase === 'preparation') {
          gameRoomRef.current.send('requestPositionChange', { x, y });
        }
      });
    }
  }, [babylonResourcesRef.current, gameRoomRef.current, gameState]);
  
  // Set up movement request handler
  useEffect(() => {
    if (babylonResourcesRef.current && babylonResourcesRef.current.setOnMovementRequest && gameRoomRef.current) {
      babylonResourcesRef.current.setOnMovementRequest((x, y) => {
        // Send movement request to server
        if (gameRoomRef.current && gameState?.phase === 'game' && gameState?.currentPlayerId === user?.id) {
          gameRoomRef.current.send('requestMovement', { x, y });
        }
      });
    }
  }, [babylonResourcesRef.current, gameRoomRef.current, gameState, user]);

  const handleLeaveGame = () => {
    // Cleanup game room connection
    if (gameRoomRef.current) {
      gameRoomRef.current.leave();
      gameRoomRef.current = null;
    }
    // Cleanup Babylon.js resources
    if (babylonResourcesRef.current) {
      disposeBabylonScene(babylonResourcesRef.current);
      babylonResourcesRef.current = null;
    }
    // Clear match info from localStorage
    localStorage.removeItem(MATCH_INFO_KEY);
    // TODO: Notify server that we're leaving the game
    navigate('/dashboard');
  };

  const handleReady = () => {
    if (gameRoomRef.current && gameState?.phase === 'preparation') {
      // Toggle ready state - if already ready, unready
      const currentPlayer = gameState.myTeam && Object.values(gameState.myTeam.players).find(p => p.userId === user?.id);
      const isCurrentlyReady = currentPlayer?.ready || false;
      gameRoomRef.current.send('playerReady', { ready: !isCurrentlyReady });
    }
  };

  // Check if it's the current user's turn
  const isMyTurn = gameState?.phase === 'game' && gameState?.currentPlayerId === user?.id;
  
  // Handle end turn
  const handleEndTurn = () => {
    if (gameRoomRef.current && isMyTurn) {
      gameRoomRef.current.send('endTurn', {});
    }
  };


  // Show loading while checking - if we reach here without matchInfo, we're redirecting
  if (loading || !matchInfo) {
    return (
      <div className="game-container-full">
        <div className="loading">Loading match...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="game-container-full">
        <div className="error-message">{error}</div>
        <button className="leave-game-btn" onClick={handleLeaveGame}>
          Leave Game
        </button>
      </div>
    );
  }

  return (
    <div className="game-container-full">
      <canvas 
        ref={canvasRef} 
        className="game-canvas-3d"
      />
      <div className="game-ui-overlay">
        <button className="leave-game-btn" onClick={handleLeaveGame}>
          Leave Game
        </button>
        {reconnecting && (
          <div className="reconnect-notice">
            🔄 Reconnected to match
          </div>
        )}
        {gameState?.phase === 'preparation' && (
          <div className="preparation-ui">
            <div className="preparation-status">
              {gameState.myTeam && Object.values(gameState.myTeam.players).every(p => p.ready) ? (
                <div className="team-ready">✓ Your team is ready</div>
              ) : (
                <div className="team-waiting">Waiting for your team to be ready...</div>
              )}
            </div>
            {gameState.myTeam && Object.values(gameState.myTeam.players).find(p => p.userId === user?.id)?.ready ? (
              <button className="ready-btn ready" onClick={handleReady}>
                ✓ Ready (Click to Unready)
              </button>
            ) : (
              <button className="ready-btn" onClick={handleReady}>
                Ready
              </button>
            )}
          </div>
        )}
        {gameState?.phase === 'game' && (
          <>
            <TurnOrderDisplay gameState={gameState} currentUserId={user?.id} />
            {isMyTurn && (
              <div className="action-ui">
                <button className="end-turn-btn" onClick={handleEndTurn}>
                  End Turn
                </button>
                <div className="action-hint">It's your turn! You can move and cast spells.</div>
              </div>
            )}
            {!isMyTurn && gameState?.currentPlayerId && (
              <div className="waiting-ui">
                <div className="waiting-message">Waiting for your turn...</div>
              </div>
            )}
          </>
        )}
      </div>
      
      {!showGameDataPanel && (
        <button 
          className="game-data-toggle"
          onClick={() => setShowGameDataPanel(true)}
          title="Show Game Data"
        >
          📊
        </button>
      )}
      
      <GameDataPanel
        gameState={gameState}
        isOpen={showGameDataPanel}
        onClose={() => setShowGameDataPanel(false)}
      />
    </div>
  );
};

export default Game;