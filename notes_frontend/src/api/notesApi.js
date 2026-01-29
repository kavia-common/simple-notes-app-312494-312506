const DEFAULT_BASE_URL = 'http://localhost:3001';

/**
 * Attempt to read a backend base URL from environment variables.
 * CRA only exposes variables prefixed with REACT_APP_.
 */
function getBaseUrl() {
  // Create React App exposes only variables prefixed with REACT_APP_.
  // Support a few common names to reduce integration friction.
  const envUrl =
    (typeof process !== 'undefined' &&
      process.env &&
      (process.env.REACT_APP_API_BASE ||
        process.env.REACT_APP_API_BASE_URL ||
        process.env.REACT_APP_BACKEND_BASE_URL)) ||
    '';

  return (envUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
}

/**
 * Read an error body safely (json/text) for better UI messages.
 */
async function readErrorBody(response) {
  const contentType = response.headers.get('content-type') || '';
  try {
    if (contentType.includes('application/json')) {
      const data = await response.json();
      return typeof data === 'string' ? data : JSON.stringify(data);
    }
    return await response.text();
  } catch {
    return '';
  }
}

/**
 * Wrapper around fetch that raises a consistent Error with status info.
 */
async function apiFetch(path, options = {}) {
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}${path}`;

  const res = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    const body = await readErrorBody(res);
    const message = body || `Request failed (${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }

  // 204 no content
  if (res.status === 204) return null;

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return res.json();
  }
  return res.text();
}

// PUBLIC_INTERFACE
export async function listNotes() {
  /** Fetch all notes (expected newest-first sorting handled by backend). */
  return apiFetch('/notes', { method: 'GET' });
}

// PUBLIC_INTERFACE
export async function createNote(payload) {
  /** Create a note. payload: { title: string, content: string } */
  return apiFetch('/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

// PUBLIC_INTERFACE
export async function updateNote(id, payload) {
  /** Update a note. payload: { title: string, content: string } */
  return apiFetch(`/notes/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

// PUBLIC_INTERFACE
export async function deleteNote(id) {
  /** Delete a note by id. */
  return apiFetch(`/notes/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// PUBLIC_INTERFACE
export function getBackendBaseUrl() {
  /** Return the resolved backend base URL used by the client. */
  return getBaseUrl();
}
