import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api-client';
import type { TeamSummary, CreateTeamBody } from '../types/api';

export default function TeamList() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [showNewForm, setShowNewForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newFormat, setNewFormat] = useState<'singles' | 'doubles'>('singles');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const { data: teams = [], isLoading, isError } = useQuery({
    queryKey: ['teams'],
    queryFn: () => api.get<TeamSummary[]>('/teams'),
  });

  const createTeam = useMutation({
    mutationFn: (body: CreateTeamBody) => api.post<{ id: string }>('/teams', body),
    onSuccess: (team) => {
      qc.invalidateQueries({ queryKey: ['teams'] });
      navigate(`/teams/${team.id}`);
    },
  });

  const deleteTeam = useMutation({
    mutationFn: (id: string) => api.delete(`/teams/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['teams'] });
      setConfirmDelete(null);
    },
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    createTeam.mutate({ name: newName.trim(), format: newFormat });
  };

  const formatBadge = (format: string) => (
    <span
      className={`text-xs px-2 py-0.5 rounded font-medium uppercase ${
        format === 'doubles'
          ? 'bg-purple-700 text-purple-200'
          : 'bg-blue-700 text-blue-200'
      }`}
    >
      {format}
    </span>
  );

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold">My Teams</h1>
          <button
            onClick={() => setShowNewForm((v) => !v)}
            className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            + New Team
          </button>
        </div>

        {showNewForm && (
          <form
            onSubmit={handleCreate}
            className="mb-6 bg-gray-800 rounded-xl p-4 flex flex-col gap-3 border border-gray-700"
          >
            <h2 className="font-semibold text-sm text-gray-200">New Team</h2>
            <div className="flex gap-3">
              <input
                autoFocus
                type="text"
                placeholder="Team name..."
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="flex-1 bg-gray-700 rounded px-3 py-2 text-sm text-white placeholder-gray-400 outline-none focus:ring-2 focus:ring-blue-500"
              />
              <select
                value={newFormat}
                onChange={(e) => setNewFormat(e.target.value as 'singles' | 'doubles')}
                className="bg-gray-700 rounded px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="singles">Singles</option>
                <option value="doubles">Doubles</option>
              </select>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => { setShowNewForm(false); setNewName(''); }}
                className="text-sm text-gray-400 hover:text-white px-3 py-1.5 rounded transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!newName.trim() || createTeam.isPending}
                className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-1.5 rounded-lg transition-colors"
              >
                {createTeam.isPending ? 'Creating…' : 'Create'}
              </button>
            </div>
            {createTeam.isError && (
              <p className="text-red-400 text-xs">{(createTeam.error as Error).message}</p>
            )}
          </form>
        )}

        {isLoading && (
          <div className="text-gray-400 text-center py-16">Loading teams…</div>
        )}

        {isError && (
          <div className="text-red-400 text-center py-16">Failed to load teams.</div>
        )}

        {!isLoading && !isError && teams.length === 0 && (
          <div className="text-gray-500 text-center py-16">
            <p className="text-lg mb-2">No teams yet</p>
            <p className="text-sm">Click "New Team" to get started.</p>
          </div>
        )}

        <div className="flex flex-col gap-3">
          {teams.map((team) => (
            <div
              key={team.id}
              className="bg-gray-800 rounded-xl border border-gray-700 hover:border-gray-500 transition-colors"
            >
              {confirmDelete === team.id ? (
                <div className="p-4 flex items-center justify-between">
                  <span className="text-sm text-gray-300">
                    Delete <span className="font-medium text-white">"{team.name}"</span>? This cannot be undone.
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setConfirmDelete(null)}
                      className="text-xs text-gray-400 hover:text-white px-3 py-1.5 rounded transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => deleteTeam.mutate(team.id)}
                      disabled={deleteTeam.isPending}
                      className="text-xs bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white px-3 py-1.5 rounded transition-colors"
                    >
                      {deleteTeam.isPending ? 'Deleting…' : 'Delete'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="p-4 flex items-center gap-3">
                  <button
                    onClick={() => navigate(`/teams/${team.id}`)}
                    className="flex-1 text-left flex items-center gap-3"
                  >
                    <div>
                      <div className="font-medium text-white">{team.name}</div>
                      <div className="flex items-center gap-2 mt-1">
                        {formatBadge(team.format)}
                        <span className="text-gray-500 text-xs">
                          {team.pokemon_count} / 6 Pokemon
                        </span>
                        <span className="text-gray-600 text-xs">
                          {new Date(team.updated_at).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  </button>
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => navigate(`/teams/${team.id}`)}
                      className="text-xs bg-gray-700 hover:bg-gray-600 text-white px-3 py-1.5 rounded transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => setConfirmDelete(team.id)}
                      className="text-xs text-gray-500 hover:text-red-400 px-2 py-1.5 rounded transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
