const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api';

async function handleResponse(response) {
  let data;
  try {
    data = await response.json();
  } catch (error) {
    throw new Error('Invalid response from server');
  }

  if (!response.ok) {
    throw new Error(data.error || 'Request failed');
  }

  return data;
}

export async function register(username, email, password) {
  try {
    const response = await fetch(`${API_BASE_URL}/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username, email, password }),
    });

    return await handleResponse(response);
  } catch (error) {
    if (error.message === 'Failed to fetch' || error.message.includes('ERR_CONNECTION_REFUSED')) {
      const port = new URL(API_BASE_URL).port || '5000';
      throw new Error(`Cannot connect to server. Please make sure the backend server is running on port ${port}.`);
    }
    throw error;
  }
}

export async function login(identifier, password) {
  try {
    const response = await fetch(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ identifier, password }),
    });

    return await handleResponse(response);
  } catch (error) {
    if (error.message === 'Failed to fetch' || error.message.includes('ERR_CONNECTION_REFUSED')) {
      const port = new URL(API_BASE_URL).port || '5000';
      throw new Error(`Cannot connect to server. Please make sure the backend server is running on port ${port}.`);
    }
    throw error;
  }
}

// Friend API functions
const getBaseUrl = () => {
  const url = new URL(API_BASE_URL);
  return `${url.protocol}//${url.host}`;
};

export async function getFriends(username) {
  try {
    const baseUrl = getBaseUrl();
    const response = await fetch(`${baseUrl}/api/friends?username=${encodeURIComponent(username)}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    return await handleResponse(response);
  } catch (error) {
    if (error.message === 'Failed to fetch' || error.message.includes('ERR_CONNECTION_REFUSED')) {
      const port = new URL(API_BASE_URL).port || '5000';
      throw new Error(`Cannot connect to server. Please make sure the backend server is running on port ${port}.`);
    }
    throw error;
  }
}

export async function sendFriendRequest(username, friendUsername) {
  try {
    const baseUrl = getBaseUrl();
    const response = await fetch(`${baseUrl}/api/friends/request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username, friendUsername }),
    });

    return await handleResponse(response);
  } catch (error) {
    if (error.message === 'Failed to fetch' || error.message.includes('ERR_CONNECTION_REFUSED')) {
      const port = new URL(API_BASE_URL).port || '5000';
      throw new Error(`Cannot connect to server. Please make sure the backend server is running on port ${port}.`);
    }
    throw error;
  }
}

export async function acceptFriendRequest(username, friendUsername) {
  try {
    const baseUrl = getBaseUrl();
    const response = await fetch(`${baseUrl}/api/friends/accept`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username, friendUsername }),
    });

    return await handleResponse(response);
  } catch (error) {
    if (error.message === 'Failed to fetch' || error.message.includes('ERR_CONNECTION_REFUSED')) {
      const port = new URL(API_BASE_URL).port || '5000';
      throw new Error(`Cannot connect to server. Please make sure the backend server is running on port ${port}.`);
    }
    throw error;
  }
}

export async function declineFriendRequest(username, friendUsername) {
  try {
    const baseUrl = getBaseUrl();
    const response = await fetch(`${baseUrl}/api/friends/decline`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username, friendUsername }),
    });

    return await handleResponse(response);
  } catch (error) {
    if (error.message === 'Failed to fetch' || error.message.includes('ERR_CONNECTION_REFUSED')) {
      const port = new URL(API_BASE_URL).port || '5000';
      throw new Error(`Cannot connect to server. Please make sure the backend server is running on port ${port}.`);
    }
    throw error;
  }
}

export async function getPendingRequests(username) {
  try {
    const baseUrl = getBaseUrl();
    const response = await fetch(`${baseUrl}/api/friends/requests?username=${encodeURIComponent(username)}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    return await handleResponse(response);
  } catch (error) {
    if (error.message === 'Failed to fetch' || error.message.includes('ERR_CONNECTION_REFUSED')) {
      const port = new URL(API_BASE_URL).port || '5000';
      throw new Error(`Cannot connect to server. Please make sure the backend server is running on port ${port}.`);
    }
    throw error;
  }
}

export async function removeFriend(username, friendUsername) {
  try {
    const baseUrl = getBaseUrl();
    const response = await fetch(`${baseUrl}/api/friends/remove`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username, friendUsername }),
    });

    return await handleResponse(response);
  } catch (error) {
    if (error.message === 'Failed to fetch' || error.message.includes('ERR_CONNECTION_REFUSED')) {
      const port = new URL(API_BASE_URL).port || '5000';
      throw new Error(`Cannot connect to server. Please make sure the backend server is running on port ${port}.`);
    }
    throw error;
  }
}

export async function getFriendStatus(username, friendUsername) {
  try {
    const baseUrl = getBaseUrl();
    const response = await fetch(`${baseUrl}/api/friends/status/${encodeURIComponent(friendUsername)}?username=${encodeURIComponent(username)}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    return await handleResponse(response);
  } catch (error) {
    if (error.message === 'Failed to fetch' || error.message.includes('ERR_CONNECTION_REFUSED')) {
      const port = new URL(API_BASE_URL).port || '5000';
      throw new Error(`Cannot connect to server. Please make sure the backend server is running on port ${port}.`);
    }
    throw error;
  }
}

// Character API functions
export async function getCharacters(username) {
  try {
    const baseUrl = getBaseUrl();
    const response = await fetch(`${baseUrl}/api/characters?username=${encodeURIComponent(username)}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    return await handleResponse(response);
  } catch (error) {
    if (error.message === 'Failed to fetch' || error.message.includes('ERR_CONNECTION_REFUSED')) {
      const port = new URL(API_BASE_URL).port || '5000';
      throw new Error(`Cannot connect to server. Please make sure the backend server is running on port ${port}.`);
    }
    throw error;
  }
}

export async function getCharacter(username, characterId) {
  try {
    const baseUrl = getBaseUrl();
    const response = await fetch(`${baseUrl}/api/characters/${characterId}?username=${encodeURIComponent(username)}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    return await handleResponse(response);
  } catch (error) {
    if (error.message === 'Failed to fetch' || error.message.includes('ERR_CONNECTION_REFUSED')) {
      const port = new URL(API_BASE_URL).port || '5000';
      throw new Error(`Cannot connect to server. Please make sure the backend server is running on port ${port}.`);
    }
    throw error;
  }
}

export async function createCharacter(username, characterData) {
  try {
    const baseUrl = getBaseUrl();
    const response = await fetch(`${baseUrl}/api/characters`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username, ...characterData }),
    });

    return await handleResponse(response);
  } catch (error) {
    if (error.message === 'Failed to fetch' || error.message.includes('ERR_CONNECTION_REFUSED')) {
      const port = new URL(API_BASE_URL).port || '5000';
      throw new Error(`Cannot connect to server. Please make sure the backend server is running on port ${port}.`);
    }
    throw error;
  }
}

export async function updateCharacter(username, characterId, updates) {
  try {
    const baseUrl = getBaseUrl();
    const response = await fetch(`${baseUrl}/api/characters/${characterId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username, ...updates }),
    });

    return await handleResponse(response);
  } catch (error) {
    if (error.message === 'Failed to fetch' || error.message.includes('ERR_CONNECTION_REFUSED')) {
      const port = new URL(API_BASE_URL).port || '5000';
      throw new Error(`Cannot connect to server. Please make sure the backend server is running on port ${port}.`);
    }
    throw error;
  }
}

export async function deleteCharacter(username, characterId) {
  try {
    const baseUrl = getBaseUrl();
    const response = await fetch(`${baseUrl}/api/characters/${characterId}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username }),
    });

    return await handleResponse(response);
  } catch (error) {
    if (error.message === 'Failed to fetch' || error.message.includes('ERR_CONNECTION_REFUSED')) {
      const port = new URL(API_BASE_URL).port || '5000';
      throw new Error(`Cannot connect to server. Please make sure the backend server is running on port ${port}.`);
    }
    throw error;
  }
}

export async function getClasses() {
  try {
    const baseUrl = getBaseUrl();
    const response = await fetch(`${baseUrl}/api/characters/info/classes`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    return await handleResponse(response);
  } catch (error) {
    if (error.message === 'Failed to fetch' || error.message.includes('ERR_CONNECTION_REFUSED')) {
      const port = new URL(API_BASE_URL).port || '5000';
      throw new Error(`Cannot connect to server. Please make sure the backend server is running on port ${port}.`);
    }
    throw error;
  }
}

export async function getClassSpells(classId, level = null) {
  try {
    const baseUrl = getBaseUrl();
    let url = `${baseUrl}/api/characters/info/spells/${classId}`;
    if (level !== null) {
      url += `?level=${level}`;
    }
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    return await handleResponse(response);
  } catch (error) {
    if (error.message === 'Failed to fetch' || error.message.includes('ERR_CONNECTION_REFUSED')) {
      const port = new URL(API_BASE_URL).port || '5000';
      throw new Error(`Cannot connect to server. Please make sure the backend server is running on port ${port}.`);
    }
    throw error;
  }
}

export async function getSelectedCharacter(username) {
  try {
    const baseUrl = getBaseUrl();
    const response = await fetch(`${baseUrl}/api/characters/selected/${encodeURIComponent(username)}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    return await handleResponse(response);
  } catch (error) {
    if (error.message === 'Failed to fetch' || error.message.includes('ERR_CONNECTION_REFUSED')) {
      const port = new URL(API_BASE_URL).port || '5000';
      throw new Error(`Cannot connect to server. Please make sure the backend server is running on port ${port}.`);
    }
    throw error;
  }
}

export async function setSelectedCharacter(username, characterId) {
  try {
    const baseUrl = getBaseUrl();
    const response = await fetch(`${baseUrl}/api/characters/selected/${encodeURIComponent(username)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ characterId }),
    });

    return await handleResponse(response);
  } catch (error) {
    if (error.message === 'Failed to fetch' || error.message.includes('ERR_CONNECTION_REFUSED')) {
      const port = new URL(API_BASE_URL).port || '5000';
      throw new Error(`Cannot connect to server. Please make sure the backend server is running on port ${port}.`);
    }
    throw error;
  }
}

// Map API functions
export async function getMap(mapId) {
  try {
    const baseUrl = getBaseUrl();
    const response = await fetch(`${baseUrl}/api/maps/${encodeURIComponent(mapId)}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    return await handleResponse(response);
  } catch (error) {
    if (error.message === 'Failed to fetch' || error.message.includes('ERR_CONNECTION_REFUSED')) {
      const port = new URL(API_BASE_URL).port || '5000';
      throw new Error(`Cannot connect to server. Please make sure the backend server is running on port ${port}.`);
    }
    throw error;
  }
}

