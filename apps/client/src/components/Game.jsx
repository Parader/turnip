import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useColyseus } from '../context/ColyseusContext';
import { createBabylonScene, disposeBabylonScene } from '../utils/babylonScene';
import { onServerTeleportConfirmed } from '../utils/babylon/babylonTeleport';
import { babylonToServerOrientation } from '../utils/babylon/babylonPlayers';
import { Vector3 } from '@babylonjs/core';
import { getMap, getClassSpells } from '../utils/api';
import { connectToGameRoom } from '../utils/colyseus';
import GameDataPanel from './GameDataPanel';
import TurnOrderDisplay from './TurnOrderDisplay';
import SpellActionBar from './SpellActionBar';
import '../styles/game.scss';

const MATCH_INFO_KEY = 'currentMatchInfo';

const Game = () => {
  const { user } = useAuth();
  const { matchFound, clearMatchFound, room: friendRoom } = useColyseus();
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
  const [selectedSpell, setSelectedSpell] = useState(null);
  const [spellDefs, setSpellDefs] = useState({});
  const canvasRef = useRef(null);
  const babylonResourcesRef = useRef(null);
  const gameRoomRef = useRef(null);
  const spellMessageListenersRegisteredRef = useRef(false);
  const latestGameStateRef = useRef(null);
  const pendingHitCountsRef = useRef(new Map());

  // Check if user should be in game - redirect if not
  useEffect(() => {
    if (!user) {
      navigate('/dashboard');
      return;
    }
  }, [user, navigate]);

  useEffect(() => {
    latestGameStateRef.current = gameState;
  }, [gameState]);

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

        // Listen for spell cast events to trigger animations for all clients
        // Note: This will be set up in a separate useEffect that has access to spellDefs

        // Listen for room leave
        room.onLeave(() => {
          gameRoomRef.current = null;
          setGameRoom(null);
          // Reset listener registration flag when room leaves
          spellMessageListenersRegisteredRef.current = false;
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

  // Notify server when entering/leaving game
  useEffect(() => {
    if (friendRoom && friendRoom.sessionId && user && matchInfo) {
      // Notify server that we're in game
      try {
        friendRoom.send('updateGameStatus', { inGame: true });
      } catch (error) {
        console.error('Error notifying game status:', error);
      }

      // Cleanup: notify server when leaving game
      return () => {
        if (friendRoom && friendRoom.sessionId) {
          try {
            friendRoom.send('updateGameStatus', { inGame: false });
          } catch (error) {
            console.error('Error notifying game status on leave:', error);
          }
        }
      };
    }
  }, [friendRoom, user, matchInfo]);

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
      babylonResourcesRef.current.setOnMovementRequest((x, y, path) => {
        // Send movement request to server with the previsualized path
        if (gameRoomRef.current && gameState?.phase === 'game' && gameState?.currentPlayerId === user?.id) {
          gameRoomRef.current.send('requestMovement', { x, y, path });
        }
      });
    }
  }, [babylonResourcesRef.current, gameRoomRef.current, gameState, user]);
  
  // Set up orientation change handler (syncs facing direction after movement animation)
  useEffect(() => {
    if (babylonResourcesRef.current && babylonResourcesRef.current.setOnOrientationChange && gameRoomRef.current) {
      babylonResourcesRef.current.setOnOrientationChange((userId, babylonRotation) => {
        // Only send orientation updates for the current user
        if (gameRoomRef.current && userId === user?.id) {
          // Convert Babylon rotation to server orientation format
          const serverOrientation = babylonToServerOrientation(babylonRotation);
          gameRoomRef.current.send('updateOrientation', { orientation: serverOrientation });
        }
      });
    }
  }, [babylonResourcesRef.current, gameRoomRef.current, user]);
  
  // Load spell definitions when game state is available
  useEffect(() => {
    if (!gameState || !user) return;
    
    const currentPlayer = gameState.myTeam && 
      Object.values(gameState.myTeam.players || {}).find(p => p.userId === user.id);
    
    if (!currentPlayer || !currentPlayer.characterClass) return;
    
    const loadSpellDefs = async () => {
      try {
        const response = await getClassSpells(currentPlayer.characterClass);
        if (response.spells) {
          // Convert array to object keyed by spellId
          const defsMap = {};
          response.spells.forEach(spell => {
            defsMap[spell.id || spell.spellId] = spell;
          });
          setSpellDefs(defsMap);
        }
      } catch (err) {
        console.error('Failed to load spell definitions:', err);
      }
    };
    
    loadSpellDefs();
  }, [gameState, user]);
  
  // Handle spell selection
  const handleSpellClick = (spellId, spell) => {
    if (!spellId) {
      setSelectedSpell(null);
      // Cancel spell casting mode in Babylon scene
      if (babylonResourcesRef.current && babylonResourcesRef.current.setSelectedSpell) {
        babylonResourcesRef.current.setSelectedSpell(null, null);
      }
      // Notify server that spell preparation is cancelled
      if (gameRoomRef.current && gameState?.phase === 'game' && gameState?.currentPlayerId === user?.id) {
        gameRoomRef.current.send('requestSpellPrepCancel', {});
      }
      return;
    }
    
    setSelectedSpell(spellId);
    // Set spell casting mode in Babylon scene
    if (babylonResourcesRef.current && babylonResourcesRef.current.setSelectedSpell) {
      babylonResourcesRef.current.setSelectedSpell(spellId, spell);
    }
    // Notify server that player is preparing a spell
    if (gameRoomRef.current && gameState?.phase === 'game' && gameState?.currentPlayerId === user?.id) {
      gameRoomRef.current.send('requestSpellPrep', { spellId });
    }
  };
  
  // Set up spell cast handler
  useEffect(() => {
    if (babylonResourcesRef.current && babylonResourcesRef.current.setOnSpellCast && gameRoomRef.current) {
      babylonResourcesRef.current.setOnSpellCast((spellId, targetXOrTargets, targetY) => {
        // Send spell cast request to server
        // The server will broadcast to all clients (including this one) to play the animation
        if (gameRoomRef.current && gameState?.phase === 'game' && gameState?.currentPlayerId === user?.id) {
          // Check if this is a multi-target spell (targetXOrTargets is an array)
          if (Array.isArray(targetXOrTargets)) {
            // Multi-target spell: send array of targets
            gameRoomRef.current.send('requestSpellCast', { spellId, targets: targetXOrTargets });
          } else {
            // Single-target spell: send targetX and targetY
            gameRoomRef.current.send('requestSpellCast', { spellId, targetX: targetXOrTargets, targetY });
          }
          // Clear spell selection after casting (this will also clear from spell bar)
          setSelectedSpell(null);
          if (babylonResourcesRef.current && babylonResourcesRef.current.setSelectedSpell) {
            babylonResourcesRef.current.setSelectedSpell(null, null);
          }
        }
      });
    }
  }, [babylonResourcesRef.current, gameRoomRef.current, gameState, user]);
  
  // Clear spell selection when it changes to null (syncs with spell bar)
  useEffect(() => {
    if (selectedSpell === null && babylonResourcesRef.current && babylonResourcesRef.current.setSelectedSpell) {
      babylonResourcesRef.current.setSelectedSpell(null, null);
    }
  }, [selectedSpell]);
  
  // Set up spell cast event listener (needs access to spellDefs)
  useEffect(() => {
    const room = gameRoomRef.current;
    if (!room || !babylonResourcesRef.current || Object.keys(spellDefs).length === 0) return;
    
    // Prevent duplicate listener registration
    if (spellMessageListenersRegisteredRef.current) {
      return;
    }
    
    const handleSpellCast = (message) => {
      // Use cast animation definition from server message (preferred)
      // Fallback to local spellDefs if not provided
      let castAnimDef = message.castAnimDef;
      let spellDef = spellDefs[message.spellId];
      
      if (!castAnimDef && spellDef) {
        castAnimDef = spellDef?.animations?.cast;
      }
      
      // Merge server VFX definitions with local spell definition if available
      if (spellDef && message.presentation) {
        // Merge presentation data from server (VFX definitions)
        // Ensure spellId is preserved
        spellDef = {
          ...spellDef,
          spellId: spellDef.spellId || message.spellId, // Ensure spellId is set
          presentation: {
            ...spellDef.presentation,
            ...message.presentation
          }
        };
      } else if (!spellDef) {
        // If no local spellDef, create one from server data
        spellDef = {
          spellId: message.spellId,
          presentation: message.presentation || {}
        };
      }
      
      if (message.targets && Array.isArray(message.targets) && message.targets.length > 1) {
        const positionCounts = new Map();
        message.targets.forEach(target => {
          const posKey = `${target.x}_${target.y}`;
          positionCounts.set(posKey, (positionCounts.get(posKey) || 0) + 1);
        });
        const castKey = `${message.userId}:${message.spellId}`;
        pendingHitCountsRef.current.set(castKey, {
          positionCounts,
          expiresAt: Date.now() + 5000
        });
      }

      if (babylonResourcesRef.current && babylonResourcesRef.current.playSpellCastAnimation) {
        if (castAnimDef) {
          
          // Check if this is a multi-target spell
          if (message.targets && Array.isArray(message.targets)) {
            // Multi-target spell: pass targets array
            babylonResourcesRef.current.playSpellCastAnimation(
              message.userId, 
              message.spellId, 
              castAnimDef,
              spellDef, // Pass full spell definition for VFX
              null, // targetX (not used for multi-target)
              null, // targetY (not used for multi-target)
              message.targets // Pass targets array
            );
          } else {
            // Single-target spell: pass targetX and targetY
            babylonResourcesRef.current.playSpellCastAnimation(
              message.userId, 
              message.spellId, 
              castAnimDef,
              spellDef, // Pass full spell definition for VFX
              message.targetX, // Target X coordinate
              message.targetY  // Target Y coordinate
            );
          }
        } else {
          console.warn(`Cast animation not found for spell "${message.spellId}". castAnimDef from server:`, message.castAnimDef);
        }
      } else {
        console.warn('handleSpellCast: babylonResourcesRef.current or playSpellCastAnimation not available');
      }
    };
    
    const handleSpellPrep = (message) => {
      // Only play stance animation for other players (not yourself)
      if (message.userId !== user?.id && babylonResourcesRef.current && babylonResourcesRef.current.playSpellPrepAnimation) {
        // Use prep animation definition from server message (preferred)
        // Fallback to local spellDefs if not provided
        let prepAnimDef = message.prepAnimDef;
        if (!prepAnimDef) {
          const spellDef = spellDefs[message.spellId];
          prepAnimDef = spellDef?.animations?.prep;
        }
        
        if (prepAnimDef) {
          babylonResourcesRef.current.playSpellPrepAnimation(message.userId, message.spellId, prepAnimDef);
        } else {
          console.warn(`Prep animation not found for spell "${message.spellId}". prepAnimDef from server:`, message.prepAnimDef);
        }
      }
    };
    
    const handleSpellPrepCancel = (message) => {
      
      // If it's for the current user, also clear spell selection state
      if (message.userId === user?.id) {
        setSelectedSpell(null);
        // Clear spell casting mode in Babylon scene
        if (babylonResourcesRef.current && babylonResourcesRef.current.setSelectedSpell) {
          babylonResourcesRef.current.setSelectedSpell(null, null);
        }
      }
      
      // Stop stance animation for the player (works for both self and others)
      if (babylonResourcesRef.current && babylonResourcesRef.current.stopSpellPrepAnimation) {
        babylonResourcesRef.current.stopSpellPrepAnimation(message.userId);
      }
    };
    
    const handleSpellHit = (message) => {
      // Play hit animation for the target player (can be yourself or others)
      // Note: Server already delays spellHit broadcast by impactDelayMs, so we don't add that delay here
      const pendingKey = `${message.casterUserId}:${message.spellId}`;
      const pendingEntry = pendingHitCountsRef.current.get(pendingKey);
      let multiHitCount = 1;
      if (pendingEntry && pendingEntry.expiresAt > Date.now() && pendingEntry.positionCounts) {
        const latestState = latestGameStateRef.current;
        if (latestState) {
          const findPlayerPosition = (state, targetUserId) => {
            const findInTeam = (team) => {
              if (!team?.players) return null;
              const player = Object.values(team.players).find(p => p.userId === targetUserId);
              return player?.position || null;
            };
            return findInTeam(state.myTeam) || findInTeam(state.enemyTeam);
          };
          const targetPos = findPlayerPosition(latestState, message.targetUserId);
          if (targetPos) {
            const posKey = `${targetPos.x}_${targetPos.y}`;
            const count = pendingEntry.positionCounts.get(posKey);
            if (count) {
              multiHitCount = count;
              pendingEntry.positionCounts.delete(posKey);
              if (pendingEntry.positionCounts.size === 0) {
                pendingHitCountsRef.current.delete(pendingKey);
              }
            }
          }
        }
      } else if (pendingEntry) {
        pendingHitCountsRef.current.delete(pendingKey);
      }
      
      // Record hit for combat text - no additional delay since server already timed it
      if (babylonResourcesRef.current?.recordSpellHit) {
        babylonResourcesRef.current.recordSpellHit(message.targetUserId, 0, multiHitCount);
      }

      // Play hit animation immediately - server already delayed the spellHit message
      if (babylonResourcesRef.current && babylonResourcesRef.current.playHitAnimation) {
        babylonResourcesRef.current.playHitAnimation(message.targetUserId);
      }
    };
    
    const handleTeleportConfirm = (message) => {
      // Server confirms teleport destination
      // Convert grid coordinates to world coordinates
      if (message.userId && message.destinationX !== undefined && message.destinationY !== undefined) {
        const tileSize = 1;
        
        // Get character's current Y position from their mesh (for proper ground level)
        let characterY = 0.5; // Default fallback
        if (babylonResourcesRef.current && babylonResourcesRef.current.scene) {
          const scene = babylonResourcesRef.current.scene;
          if (scene.metadata && scene.metadata.playerMeshes) {
            const characterMesh = scene.metadata.playerMeshes.get(message.userId);
            if (characterMesh && characterMesh.position) {
              characterY = characterMesh.position.y;
            }
          }
        }
        
        const destination = new Vector3(
          message.destinationX * tileSize,
          characterY, // Use character's actual Y position (ground level)
          message.destinationY * tileSize
        );
        onServerTeleportConfirmed(message.userId, destination);
      }
    };
    
    // Store removal functions to properly clean up listeners
    const removeSpellCast = room.onMessage('spellCast', handleSpellCast);
    const removeSpellPrep = room.onMessage('spellPrep', handleSpellPrep);
    const removeSpellPrepCancel = room.onMessage('spellPrepCancel', handleSpellPrepCancel);
    const removeSpellHit = room.onMessage('spellHit', handleSpellHit);
    const removeTeleportConfirm = room.onMessage('teleportConfirm', handleTeleportConfirm);
    
    // Mark listeners as registered
    spellMessageListenersRegisteredRef.current = true;
    
    // Cleanup: remove listeners when dependencies change to prevent duplicates
    return () => {
      // Remove all listeners to prevent duplicate message handling
      if (typeof removeSpellCast === 'function') removeSpellCast();
      if (typeof removeSpellPrep === 'function') removeSpellPrep();
      if (typeof removeSpellPrepCancel === 'function') removeSpellPrepCancel();
      if (typeof removeSpellHit === 'function') removeSpellHit();
      if (typeof removeTeleportConfirm === 'function') removeTeleportConfirm();
      
      // Reset registration flag
      spellMessageListenersRegisteredRef.current = false;
    };
  }, [gameRoom, spellDefs, user]);

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
      
      {/* Spell Action Bar - WoW style */}
      {gameState?.phase === 'game' && (
        <SpellActionBar
          gameState={gameState}
          currentUserId={user?.id}
          onSpellClick={handleSpellClick}
          spellDefs={spellDefs}
          selectedSpell={selectedSpell}
          onSelectedSpellChange={(spellId) => {
            // Update local state when spell bar selection changes
            setSelectedSpell(spellId);
          }}
          clearMovementVisualization={babylonResourcesRef.current?.clearMovementVisualization}
        />
      )}
      
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