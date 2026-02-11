/**
 * AudioSettingsPanel - Simple audio volume controls
 */

import React, { useState, useEffect } from 'react';
import { audioSettings, AudioGroup } from '../audio';

const AudioSettingsPanel = ({ isOpen, onClose }) => {
  const [settings, setSettings] = useState(audioSettings.getAll());

  useEffect(() => {
    // Subscribe to settings changes
    const unsubscribe = audioSettings.subscribe((key, value) => {
      setSettings(audioSettings.getAll());
    });
    return () => unsubscribe();
  }, []);

  if (!isOpen) return null;

  const handleVolumeChange = (group, value) => {
    audioSettings.set(group, parseFloat(value));
  };

  const handleMuteToggle = () => {
    audioSettings.toggleMute();
  };

  return (
    <div className="audio-settings-panel">
      <div className="audio-settings-header">
        <h3>Audio Settings</h3>
        <button className="audio-settings-close" onClick={onClose}>✕</button>
      </div>
      
      <div className="audio-settings-content">
        {/* Master Mute */}
        <div className="audio-setting-row">
          <label>
            <input
              type="checkbox"
              checked={settings.muted}
              onChange={handleMuteToggle}
            />
            Mute All
          </label>
        </div>

        {/* Master Volume */}
        <div className="audio-setting-row">
          <label>Master</label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={settings[AudioGroup.MASTER]}
            onChange={(e) => handleVolumeChange(AudioGroup.MASTER, e.target.value)}
            disabled={settings.muted}
          />
          <span className="volume-value">{Math.round(settings[AudioGroup.MASTER] * 100)}%</span>
        </div>

        {/* SFX Volume */}
        <div className="audio-setting-row">
          <label>SFX</label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={settings[AudioGroup.SFX]}
            onChange={(e) => handleVolumeChange(AudioGroup.SFX, e.target.value)}
            disabled={settings.muted}
          />
          <span className="volume-value">{Math.round(settings[AudioGroup.SFX] * 100)}%</span>
        </div>

        {/* Music Volume */}
        <div className="audio-setting-row">
          <label>Music</label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={settings[AudioGroup.MUSIC]}
            onChange={(e) => handleVolumeChange(AudioGroup.MUSIC, e.target.value)}
            disabled={settings.muted}
          />
          <span className="volume-value">{Math.round(settings[AudioGroup.MUSIC] * 100)}%</span>
        </div>

        {/* Ambient Volume */}
        <div className="audio-setting-row">
          <label>Ambient</label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={settings[AudioGroup.AMBIENT]}
            onChange={(e) => handleVolumeChange(AudioGroup.AMBIENT, e.target.value)}
            disabled={settings.muted}
          />
          <span className="volume-value">{Math.round(settings[AudioGroup.AMBIENT] * 100)}%</span>
        </div>

        {/* Voice Volume */}
        <div className="audio-setting-row">
          <label>Voice</label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={settings[AudioGroup.VOICE]}
            onChange={(e) => handleVolumeChange(AudioGroup.VOICE, e.target.value)}
            disabled={settings.muted}
          />
          <span className="volume-value">{Math.round(settings[AudioGroup.VOICE] * 100)}%</span>
        </div>
      </div>
    </div>
  );
};

export default AudioSettingsPanel;
