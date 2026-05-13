import { useEffect, useState, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api-client';
import { TYPE_COLORS } from '../../lib/constants';
import type { PokemonDetail, Ability, Move, Item, Nature } from '../../types/api';
import type { DraftPokemon } from '../../types/draft';
import MoveSelector from './MoveSelector';
import StatEditor from './StatEditor';

interface Props {
  slotIndex: number;
  draft: DraftPokemon | null;
  items: Item[];
  natures: Nature[];
  onChange: (draft: DraftPokemon | null) => void;
  onSearch: () => void;
}

export default function PokemonSlot({ slotIndex, draft, items, natures, onChange, onSearch }: Props) {
  const pokemonId = draft?.pokemon_id;

  const { data: pokemon } = useQuery({
    queryKey: ['pokemon', pokemonId],
    queryFn: () => api.get<PokemonDetail>(`/pokemon/${pokemonId}`),
    enabled: pokemonId != null,
  });

  const { data: abilities = [] } = useQuery({
    queryKey: ['pokemon-abilities', pokemonId],
    queryFn: () => api.get<Ability[]>(`/pokemon/${pokemonId}/abilities`),
    enabled: pokemonId != null,
  });

  const { data: moves = [] } = useQuery({
    queryKey: ['pokemon-moves', pokemonId],
    queryFn: () => api.get<Move[]>(`/pokemon/${pokemonId}/moves`),
    enabled: pokemonId != null,
  });

  // Auto-select first ability when a new pokemon is added (ability_id === 0)
  useEffect(() => {
    if (draft && draft.ability_id === 0 && abilities.length > 0) {
      onChange({ ...draft, ability_id: abilities[0].id });
    }
  }, [abilities, draft?.pokemon_id]);

  const [itemFilter, setItemFilter] = useState('');
  const [itemOpen, setItemOpen] = useState(false);
  const itemRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (itemRef.current && !itemRef.current.contains(e.target as Node)) {
        setItemOpen(false);
        setItemFilter('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const patch = (p: Partial<DraftPokemon>) => {
    if (!draft) return;
    onChange({ ...draft, ...p });
  };

  const filteredItems = itemFilter
    ? items.filter((i) => i.name.toLowerCase().includes(itemFilter.toLowerCase()))
    : items;

  const selectedItem = items.find((i) => i.id === draft?.item_id) ?? null;

  if (!draft) {
    return (
      <button
        onClick={onSearch}
        className="flex flex-col items-center justify-center bg-gray-800 border-2 border-dashed border-gray-600 hover:border-gray-400 rounded-xl p-6 gap-2 transition-colors min-h-[120px] w-full"
      >
        <span className="text-4xl text-gray-600">+</span>
        <span className="text-gray-500 text-sm">Slot {slotIndex + 1} — Empty</span>
      </button>
    );
  }

  return (
    <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
      {/* Slot header: sprite + name + types + controls */}
      <div className="flex items-center gap-3 p-3 border-b border-gray-700 bg-gray-750">
        <button
          onClick={onSearch}
          title="Change Pokemon"
          className="flex items-center gap-2 flex-1 hover:opacity-80 transition-opacity text-left"
        >
          {pokemon?.sprite_url ? (
            <img
              src={pokemon.sprite_url}
              alt={pokemon.name}
              className="w-14 h-14 object-contain"
            />
          ) : (
            <div className="w-14 h-14 bg-gray-600 rounded-full" />
          )}
          <div>
            <div className="font-semibold capitalize text-white text-sm">
              {pokemon?.name ?? '…'}
              {pokemon?.form_name ? (
                <span className="text-gray-400 ml-1 text-xs">({pokemon.form_name})</span>
              ) : null}
            </div>
            {pokemon && (
              <div className="flex gap-1 mt-0.5">
                <span
                  className={`text-xs px-1.5 py-0.5 rounded capitalize ${
                    TYPE_COLORS[pokemon.type1] ?? 'bg-gray-500 text-white'
                  }`}
                >
                  {pokemon.type1}
                </span>
                {pokemon.type2 && (
                  <span
                    className={`text-xs px-1.5 py-0.5 rounded capitalize ${
                      TYPE_COLORS[pokemon.type2] ?? 'bg-gray-500 text-white'
                    }`}
                  >
                    {pokemon.type2}
                  </span>
                )}
              </div>
            )}
          </div>
        </button>

        <div className="flex flex-col gap-1 items-end">
          <button
            onClick={() => onChange(null)}
            title="Remove from slot"
            className="text-gray-500 hover:text-red-400 text-xs px-2 py-1 rounded hover:bg-gray-700 transition-colors"
          >
            Remove
          </button>
          <span className="text-gray-500 text-xs">Slot {slotIndex + 1}</span>
        </div>
      </div>

      <div className="p-3 flex flex-col gap-3">
        {/* Nickname */}
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-400 w-16 shrink-0">Nickname</label>
          <input
            type="text"
            maxLength={12}
            placeholder={pokemon?.name ?? 'Nickname'}
            value={draft.nickname}
            onChange={(e) => patch({ nickname: e.target.value })}
            className="flex-1 bg-gray-700 rounded px-2 py-1 text-xs text-white placeholder-gray-500 outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        {/* Ability */}
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-400 w-16 shrink-0">Ability</label>
          <select
            value={draft.ability_id}
            onChange={(e) => patch({ ability_id: +e.target.value })}
            className="flex-1 bg-gray-700 rounded px-2 py-1.5 text-xs text-white outline-none focus:ring-1 focus:ring-blue-500"
          >
            {abilities.length === 0 && (
              <option value={0}>Loading…</option>
            )}
            {abilities.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}{a.is_hidden ? ' (Hidden)' : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Item (searchable dropdown) */}
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-400 w-16 shrink-0">Item</label>
          <div ref={itemRef} className="relative flex-1">
            <button
              type="button"
              onClick={() => setItemOpen((o) => !o)}
              className="w-full text-left bg-gray-700 hover:bg-gray-600 rounded px-2 py-1.5 text-xs flex items-center justify-between transition-colors"
            >
              <span className={selectedItem ? 'text-white capitalize' : 'text-gray-400'}>
                {selectedItem ? selectedItem.name : '-- No Item --'}
              </span>
              <span className="text-gray-400">▾</span>
            </button>
            {itemOpen && (
              <div className="absolute z-20 top-full mt-0.5 left-0 right-0 bg-gray-800 border border-gray-600 rounded-lg shadow-2xl flex flex-col max-h-48">
                <div className="p-1.5 border-b border-gray-700">
                  <input
                    autoFocus
                    type="text"
                    placeholder="Filter items..."
                    value={itemFilter}
                    onChange={(e) => setItemFilter(e.target.value)}
                    className="w-full bg-gray-700 rounded px-2 py-1 text-xs text-white placeholder-gray-400 outline-none"
                  />
                </div>
                <div className="overflow-y-auto">
                  <button
                    type="button"
                    onClick={() => { patch({ item_id: null }); setItemOpen(false); setItemFilter(''); }}
                    className="w-full text-left px-2 py-1.5 text-xs text-gray-400 hover:bg-gray-700"
                  >
                    -- No Item --
                  </button>
                  {filteredItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => { patch({ item_id: item.id }); setItemOpen(false); setItemFilter(''); }}
                      className={`w-full text-left px-2 py-1.5 text-xs text-white capitalize hover:bg-gray-700 ${
                        item.id === draft.item_id ? 'bg-gray-700/60' : ''
                      }`}
                    >
                      {item.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Nature */}
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-400 w-16 shrink-0">Nature</label>
          <select
            value={draft.nature_id}
            onChange={(e) => patch({ nature_id: +e.target.value })}
            className="flex-1 bg-gray-700 rounded px-2 py-1.5 text-xs text-white outline-none focus:ring-1 focus:ring-blue-500"
          >
            {draft.nature_id === 0 && <option value={0}>-- Select --</option>}
            {natures.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
                {n.boosted_stat && n.reduced_stat
                  ? ` (+${n.boosted_stat} / -${n.reduced_stat})`
                  : ' (Neutral)'}
              </option>
            ))}
          </select>
        </div>

        {/* Moves */}
        <div className="flex flex-col gap-1">
          <div className="text-xs text-gray-400 font-medium mb-0.5">Moves</div>
          <MoveSelector moves={moves} value={draft.move1_id} onChange={(id) => patch({ move1_id: id })} placeholder="Move 1" />
          <MoveSelector moves={moves} value={draft.move2_id} onChange={(id) => patch({ move2_id: id })} placeholder="Move 2" />
          <MoveSelector moves={moves} value={draft.move3_id} onChange={(id) => patch({ move3_id: id })} placeholder="Move 3" />
          <MoveSelector moves={moves} value={draft.move4_id} onChange={(id) => patch({ move4_id: id })} placeholder="Move 4" />
        </div>

        {/* EVs / IVs */}
        <div>
          <div className="text-xs text-gray-400 font-medium mb-1">EVs / IVs</div>
          <StatEditor draft={draft} onChange={patch} />
        </div>
      </div>
    </div>
  );
}
