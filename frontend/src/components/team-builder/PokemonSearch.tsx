import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api-client';
import { TYPE_COLORS } from '../../lib/constants';
import type { PokemonSummary } from '../../types/api';

interface Props {
  onSelect: (pokemonId: number) => void;
  onClose: () => void;
}

export default function PokemonSearch({ onSelect, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  const { data: results = [], isFetching } = useQuery({
    queryKey: ['pokemon-search', debouncedQuery],
    queryFn: () =>
      api.get<PokemonSummary[]>(`/pokemon?q=${encodeURIComponent(debouncedQuery)}`),
    enabled: debouncedQuery.length >= 2,
  });

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  };

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-gray-800 rounded-xl w-full max-w-md p-4 flex flex-col gap-3 max-h-[80vh]">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Add Pokemon</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-xl leading-none"
          >
            ✕
          </button>
        </div>

        <input
          ref={inputRef}
          type="text"
          placeholder="Search by name (min 2 characters)..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          className="bg-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-400 outline-none focus:ring-2 focus:ring-blue-500"
        />

        <div className="overflow-y-auto flex flex-col gap-0.5 min-h-[200px]">
          {isFetching && (
            <p className="text-gray-400 text-sm text-center py-8">Searching...</p>
          )}
          {!isFetching && debouncedQuery.length >= 2 && results.length === 0 && (
            <p className="text-gray-400 text-sm text-center py-8">No results found</p>
          )}
          {!isFetching && debouncedQuery.length < 2 && (
            <p className="text-gray-500 text-sm text-center py-8">Type to search</p>
          )}
          {results.map((p) => (
            <button
              key={p.id}
              onClick={() => onSelect(p.id)}
              className="flex items-center gap-3 px-3 py-2 hover:bg-gray-700 rounded-lg text-left transition-colors"
            >
              {p.sprite_url ? (
                <img
                  src={p.sprite_url}
                  alt={p.name}
                  className="w-12 h-12 object-contain flex-shrink-0"
                />
              ) : (
                <div className="w-12 h-12 bg-gray-600 rounded-full flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="font-medium capitalize text-white text-sm">
                  {p.name}
                  {p.form_name ? (
                    <span className="text-gray-400 ml-1 text-xs">({p.form_name})</span>
                  ) : null}
                </div>
                <div className="flex gap-1 mt-1">
                  <span
                    className={`text-xs px-1.5 py-0.5 rounded capitalize ${
                      TYPE_COLORS[p.type1] ?? 'bg-gray-500 text-white'
                    }`}
                  >
                    {p.type1}
                  </span>
                  {p.type2 && (
                    <span
                      className={`text-xs px-1.5 py-0.5 rounded capitalize ${
                        TYPE_COLORS[p.type2] ?? 'bg-gray-500 text-white'
                      }`}
                    >
                      {p.type2}
                    </span>
                  )}
                </div>
              </div>
              <span className="text-gray-500 text-xs">#{String(p.id).padStart(4, '0')}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
