import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { createCharacter, getClasses } from '../utils/api';
import '../styles/character.scss';

function CreateCharacter({ onCharacterCreated, compact = false }) {
  const { user } = useAuth();
  const [name, setName] = useState('');
  const [selectedClass, setSelectedClass] = useState('');
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingData, setLoadingData] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadClasses();
  }, []);

  const loadClasses = async () => {
    try {
      setLoadingData(true);
      const response = await getClasses();
      setClasses(response.classes || []);
    } catch (err) {
      setError(err.message || 'Failed to load classes');
    } finally {
      setLoadingData(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!name.trim()) {
      setError('Character name is required');
      return;
    }

    if (!selectedClass) {
      setError('Please select a class');
      return;
    }

    setLoading(true);

    try {
      const response = await createCharacter(user.username, {
        name: name.trim(),
        classId: selectedClass
      });
      
      // Reset form
      setName('');
      setSelectedClass('');
      
      // Pass the created character to the callback
      if (onCharacterCreated) {
        onCharacterCreated(response.character || null);
      }
    } catch (err) {
      setError(err.message || 'Failed to create character');
    } finally {
      setLoading(false);
    }
  };

  if (loadingData) {
    return <div className="character-loading">Loading character creation data...</div>;
  }

  const selectedClassData = classes.find(c => c.id === selectedClass);

  return (
    <div className="create-character">
      <h2>Create Character</h2>
      {error && <div className="error-message">{error}</div>}

      <form onSubmit={handleSubmit} className="character-form">
        <div className="form-group">
          <label htmlFor="characterName">Character Name</label>
          <input
            type="text"
            id="characterName"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter character name (1-30 characters)"
            maxLength={30}
            disabled={loading}
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="characterClass">Class</label>
          <select
            id="characterClass"
            value={selectedClass}
            onChange={(e) => setSelectedClass(e.target.value)}
            disabled={loading}
            required
          >
            <option value="">Select a class</option>
            {classes.map(cls => (
              <option key={cls.id} value={cls.id}>
                {cls.name}
              </option>
            ))}
          </select>
        </div>

        {selectedClassData && (
          <div className="class-info">
            <h3>Class: {selectedClassData.name}</h3>
            <div className="base-stats">
              <h4>Base Stats</h4>
              <div className="stats-grid">
                <div className="stat-item">
                  <span className="stat-label">HP:</span>
                  <span className="stat-value">{selectedClassData.baseStats.hp}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">Movement:</span>
                  <span className="stat-value">{selectedClassData.baseStats.movement}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">Energy:</span>
                  <span className="stat-value">{selectedClassData.baseStats.energy}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">Offense:</span>
                  <span className="stat-value">{selectedClassData.baseStats.offense}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">Melee Defense:</span>
                  <span className="stat-value">{selectedClassData.baseStats.meleeDefense}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">Magic Defense:</span>
                  <span className="stat-value">{selectedClassData.baseStats.magicDefense}</span>
                </div>
              </div>
            </div>
            <div className="starter-spells-info">
              <h4>Starter Spells</h4>
              <p className="info-text">Your character will be created with the default starter spells. You can customize your spell loadout after creation.</p>
              <div className="spell-list">
                {selectedClassData.starterSpells.slice(0, 5).map((spellId, index) => (
                  <span key={index} className="spell-tag">{spellId}</span>
                ))}
              </div>
            </div>
          </div>
        )}

        <button type="submit" className="create-character-btn" disabled={loading}>
          {loading ? 'Creating...' : 'Create Character'}
        </button>
      </form>
    </div>
  );
}

export default CreateCharacter;

