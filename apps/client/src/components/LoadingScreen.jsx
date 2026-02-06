import React from 'react';
import '../styles/loading.scss';

/**
 * Loading Screen Component
 * Displays a centered loading overlay with progress bar
 */
const LoadingScreen = ({ progress = 0, message = 'Loading game assets...' }) => {
  return (
    <div className="loading-screen">
      <div className="loading-content">
        <div className="loading-message">{message}</div>
        <div className="loading-progress-container">
          <div 
            className="loading-progress-bar" 
            style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
          />
        </div>
        <div className="loading-percentage">{Math.round(progress)}%</div>
      </div>
    </div>
  );
};

export default LoadingScreen;
