import React, { useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import {
  createNote,
  deleteNote,
  getBackendBaseUrl,
  listNotes,
  updateNote,
} from './api/notesApi';

/**
 * Normalize a note from backend into a UI shape we can rely on.
 * Backend commonly uses {id, title, content, created_at, updated_at}.
 */
function normalizeNote(note) {
  const id = note.id ?? note.note_id ?? note.uuid ?? note._id;
  return {
    ...note,
    id,
    title: note.title ?? '',
    content: note.content ?? '',
  };
}

/**
 * Create a lightweight local id for optimistic UI (before server responds).
 */
function makeTempId() {
  return `tmp_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

// PUBLIC_INTERFACE
function App() {
  /** Notes app root component: lists notes, allows create/edit/delete, integrates with backend REST API. */
  const backendBaseUrl = useMemo(() => getBackendBaseUrl(), []);

  const [notes, setNotes] = useState([]);
  const [selectedId, setSelectedId] = useState(null);

  const [isLoadingList, setIsLoadingList] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const [error, setError] = useState('');

  // Editor is controlled separately so we can support "new note" drafts cleanly.
  const [draft, setDraft] = useState({
    id: null,
    title: '',
    content: '',
    isNew: false,
  });

  const titleInputRef = useRef(null);

  const selectedNote = useMemo(() => {
    if (!selectedId) return null;
    return notes.find((n) => String(n.id) === String(selectedId)) || null;
  }, [notes, selectedId]);

  const hasUnsavedChanges = useMemo(() => {
    if (!draft.id) return draft.title.trim() !== '' || draft.content.trim() !== '';
    const base = selectedNote;
    if (!base) return false;
    return draft.title !== (base.title || '') || draft.content !== (base.content || '');
  }, [draft, selectedNote]);

  async function refreshNotes({ keepSelection = true } = {}) {
    setError('');
    setIsLoadingList(true);
    try {
      const data = await listNotes();
      const normalized = Array.isArray(data) ? data.map(normalizeNote) : [];
      setNotes(normalized);

      if (!keepSelection) return;

      // Preserve selection if it still exists; otherwise select first.
      setSelectedId((prev) => {
        if (prev && normalized.some((n) => String(n.id) === String(prev))) return prev;
        return normalized.length ? normalized[0].id : null;
      });
    } catch (e) {
      setError(e?.message || 'Failed to load notes.');
    } finally {
      setIsLoadingList(false);
    }
  }

  useEffect(() => {
    refreshNotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync draft when selection changes (unless the user is currently creating a new note draft).
  useEffect(() => {
    if (draft.isNew) return;
    if (!selectedNote) {
      setDraft({ id: null, title: '', content: '', isNew: false });
      return;
    }
    setDraft({
      id: selectedNote.id,
      title: selectedNote.title || '',
      content: selectedNote.content || '',
      isNew: false,
    });
  }, [selectedNote]); // intentionally not depending on draft

  async function handleSelectNote(noteId) {
    if (isSaving || isDeleting) return;

    if (draft.isNew && hasUnsavedChanges) {
      const ok = window.confirm('Discard your new note draft?');
      if (!ok) return;
    } else if (!draft.isNew && hasUnsavedChanges) {
      const ok = window.confirm('You have unsaved changes. Discard them and switch notes?');
      if (!ok) return;
    }

    setSelectedId(noteId);
    setError('');
  }

  async function handleNewNote() {
    if (isSaving || isDeleting) return;

    if (draft.isNew && hasUnsavedChanges) {
      const ok = window.confirm('Discard your current new note draft and start a new one?');
      if (!ok) return;
    } else if (!draft.isNew && hasUnsavedChanges) {
      const ok = window.confirm('You have unsaved changes. Discard them and create a new note?');
      if (!ok) return;
    }

    setSelectedId(null);
    setDraft({ id: makeTempId(), title: '', content: '', isNew: true });
    setError('');

    // Focus title for quick entry
    requestAnimationFrame(() => titleInputRef.current?.focus?.());
  }

  async function handleSave() {
    if (isSaving || isDeleting) return;

    const title = (draft.title || '').trim();
    const content = draft.content || '';

    if (!title) {
      setError('Title is required.');
      titleInputRef.current?.focus?.();
      return;
    }

    setError('');
    setIsSaving(true);

    try {
      if (draft.isNew) {
        const created = await createNote({ title, content });
        const createdNorm = normalizeNote(created);

        // Update list optimistically
        setNotes((prev) => {
          // Place at top; backend may sort but this feels snappy.
          const withoutTmp = prev.filter((n) => String(n.id) !== String(draft.id));
          return [createdNorm, ...withoutTmp];
        });
        setSelectedId(createdNorm.id);
        setDraft({ id: createdNorm.id, title: createdNorm.title, content: createdNorm.content, isNew: false });
      } else if (draft.id) {
        const updated = await updateNote(draft.id, { title, content });
        const updatedNorm = normalizeNote(updated);

        setNotes((prev) => prev.map((n) => (String(n.id) === String(updatedNorm.id) ? updatedNorm : n)));
        setDraft({ id: updatedNorm.id, title: updatedNorm.title, content: updatedNorm.content, isNew: false });
      }

      // Refresh list to reflect canonical backend ordering/timestamps, but keep selection.
      await refreshNotes({ keepSelection: true });
    } catch (e) {
      setError(e?.message || 'Failed to save note.');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDeleteSelected() {
    if (isSaving || isDeleting) return;

    const idToDelete = draft.isNew ? null : selectedId;
    if (!idToDelete) {
      // If user is on a new draft, just clear it.
      if (draft.isNew) {
        const ok = window.confirm('Discard this new note draft?');
        if (!ok) return;
        setDraft({ id: null, title: '', content: '', isNew: false });
      }
      return;
    }

    const toDelete = selectedNote;
    const ok = window.confirm(`Delete "${toDelete?.title || 'this note'}"? This cannot be undone.`);
    if (!ok) return;

    setError('');
    setIsDeleting(true);

    try {
      await deleteNote(idToDelete);

      // Remove locally and select next
      setNotes((prev) => prev.filter((n) => String(n.id) !== String(idToDelete)));

      setSelectedId((prevSelected) => {
        if (String(prevSelected) !== String(idToDelete)) return prevSelected;
        const remaining = notes.filter((n) => String(n.id) !== String(idToDelete));
        return remaining.length ? remaining[0].id : null;
      });

      await refreshNotes({ keepSelection: false });
    } catch (e) {
      setError(e?.message || 'Failed to delete note.');
    } finally {
      setIsDeleting(false);
    }
  }

  const statusText = useMemo(() => {
    if (isLoadingList) return 'Loading notes…';
    if (isSaving) return 'Saving…';
    if (isDeleting) return 'Deleting…';
    return '';
  }, [isLoadingList, isSaving, isDeleting]);

  const canSave = !isLoadingList && !isSaving && !isDeleting && (draft.isNew ? true : !!selectedId);
  const canDelete = !isLoadingList && !isSaving && !isDeleting && (!!selectedId || draft.isNew);

  return (
    <div className="App">
      <header className="appHeader">
        <div className="appHeaderLeft">
          <div className="brandMark" aria-hidden="true" />
          <div className="appTitleWrap">
            <h1 className="appTitle">Notes</h1>
            <p className="appSubtitle">Simple, fast note-taking</p>
          </div>
        </div>

        <div className="appHeaderRight">
          <button className="btn btnSecondary" type="button" onClick={handleNewNote} disabled={isLoadingList || isSaving || isDeleting}>
            New note
          </button>
          <button className="btn btnPrimary" type="button" onClick={handleSave} disabled={!canSave || !hasUnsavedChanges}>
            {draft.isNew ? 'Create' : 'Save'}
          </button>
          <button className="btn btnDanger" type="button" onClick={handleDeleteSelected} disabled={!canDelete}>
            Delete
          </button>
        </div>
      </header>

      <main className="appMain" aria-busy={isLoadingList ? 'true' : 'false'}>
        <aside className="sidebar" aria-label="Notes list">
          <div className="sidebarTop">
            <div className="sidebarTitleRow">
              <h2 className="sidebarTitle">Your notes</h2>
              <span className="badge" title={`Backend: ${backendBaseUrl}`}>
                API: {backendBaseUrl.replace(/^https?:\/\//, '')}
              </span>
            </div>

            <div className="sidebarMeta">
              <span className="muted">{notes.length} note{notes.length === 1 ? '' : 's'}</span>
              {statusText ? <span className="muted">{statusText}</span> : null}
            </div>
          </div>

          {error ? (
            <div className="alert" role="alert">
              <div className="alertTitle">Something went wrong</div>
              <div className="alertBody">{error}</div>
              <button className="btn btnGhost" type="button" onClick={() => refreshNotes()} disabled={isLoadingList}>
                Retry
              </button>
            </div>
          ) : null}

          <div className="noteList" role="list">
            {isLoadingList ? (
              <div className="skeletonList" aria-hidden="true">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div className="skeletonItem" key={i}>
                    <div className="skeletonLine skeletonLineShort" />
                    <div className="skeletonLine" />
                  </div>
                ))}
              </div>
            ) : notes.length === 0 ? (
              <div className="emptyState">
                <div className="emptyTitle">No notes yet</div>
                <div className="emptyBody">Create your first note to get started.</div>
                <button className="btn btnPrimary" type="button" onClick={handleNewNote}>
                  New note
                </button>
              </div>
            ) : (
              notes.map((n) => {
                const isSelected = !draft.isNew && selectedId && String(n.id) === String(selectedId);
                const preview = (n.content || '').trim().slice(0, 60);
                return (
                  <button
                    key={n.id}
                    type="button"
                    className={`noteListItem ${isSelected ? 'selected' : ''}`}
                    role="listitem"
                    onClick={() => handleSelectNote(n.id)}
                    title={n.title}
                  >
                    <div className="noteListItemTitle">{n.title || 'Untitled'}</div>
                    <div className="noteListItemPreview">{preview || '—'}</div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        <section className="editorPane" aria-label="Note editor">
          <div className="editorTop">
            <div className="editorHeading">
              <h2 className="editorTitle">{draft.isNew ? 'New note' : selectedNote ? 'Edit note' : 'Select a note'}</h2>
              {!draft.isNew && selectedNote ? (
                <p className="editorMeta">ID: <span className="mono">{String(selectedNote.id)}</span></p>
              ) : (
                <p className="editorMeta"> </p>
              )}
            </div>

            <div className="editorActionsInline">
              <button className="btn btnGhost" type="button" onClick={() => refreshNotes()} disabled={isLoadingList || isSaving || isDeleting}>
                Refresh
              </button>
            </div>
          </div>

          <div className="editorForm">
            <label className="field">
              <span className="labelText">Title</span>
              <input
                ref={titleInputRef}
                className="input"
                type="text"
                value={draft.title}
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                placeholder="e.g. Meeting notes"
                disabled={isLoadingList || (!draft.isNew && !selectedNote)}
              />
            </label>

            <label className="field fieldGrow">
              <span className="labelText">Content</span>
              <textarea
                className="textarea"
                value={draft.content}
                onChange={(e) => setDraft((d) => ({ ...d, content: e.target.value }))}
                placeholder="Write your note here…"
                disabled={isLoadingList || (!draft.isNew && !selectedNote)}
              />
            </label>

            <div className="editorFooter">
              <div className="muted">
                {hasUnsavedChanges ? 'Unsaved changes' : 'All changes saved'}
              </div>
              <div className="footerButtons">
                <button
                  className="btn btnSecondary"
                  type="button"
                  onClick={() => {
                    if (draft.isNew) {
                      setDraft({ id: null, title: '', content: '', isNew: false });
                      return;
                    }
                    // revert to selected note
                    if (selectedNote) {
                      setDraft({
                        id: selectedNote.id,
                        title: selectedNote.title || '',
                        content: selectedNote.content || '',
                        isNew: false,
                      });
                    }
                  }}
                  disabled={isLoadingList || isSaving || isDeleting || !hasUnsavedChanges}
                >
                  Revert
                </button>
                <button className="btn btnPrimary" type="button" onClick={handleSave} disabled={!canSave || !hasUnsavedChanges}>
                  {draft.isNew ? 'Create note' : 'Save changes'}
                </button>
              </div>
            </div>

            {!draft.isNew && !selectedNote && !isLoadingList ? (
              <div className="emptyEditor">
                <div className="emptyTitle">Choose a note</div>
                <div className="emptyBody">Select a note from the left, or create a new one.</div>
              </div>
            ) : null}
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
