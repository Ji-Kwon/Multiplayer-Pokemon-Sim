import { useState, useRef, useEffect } from 'react';
import { TYPE_COLORS } from '../../lib/constants';
import type { Move } from '../../types/api';

interface Props {
  moves: Move[];
  value: number | null;
  onChange: (moveId: number | null) => void;
  placeholder?: string;
}

const CAT_ICON: Record<Move['category'], string> = {
  physical: '⚔',
  special: '✦',
  status: '◎',
};

export default function MoveSelector({
  moves,
  value,
  onChange,
  placeholder = '-- None --',
}: Props) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);

  const selected = moves.find((m) => m.id === value) ?? null;
  const filtered = filter
    ? moves.filter((m) => m.name.toLowerCase().includes(filter.toLowerCase()))
    : moves;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setFilter('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (open) filterRef.current?.focus();
  }, [open]);

  const select = (moveId: number | null) => {
    onChange(moveId);
    setOpen(false);
    setFilter('');
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full text-left bg-gray-700 hover:bg-gray-600 rounded px-2 py-1.5 text-xs flex items-center justify-between gap-1.5 transition-colors"
      >
        {selected ? (
          <span className="flex items-center gap-1.5 min-w-0">
            <span
              className={`shrink-0 px-1 py-0.5 rounded capitalize ${
                TYPE_COLORS[selected.type] ?? 'bg-gray-500 text-white'
              }`}
            >
              {selected.type}
            </span>
            <span className="capitalize truncate text-white">{selected.name}</span>
            <span className="shrink-0 text-gray-400">
              {CAT_ICON[selected.category]} {selected.power ?? '—'}
            </span>
          </span>
        ) : (
          <span className="text-gray-400">{placeholder}</span>
        )}
        <span className="text-gray-400 shrink-0">▾</span>
      </button>

      {open && (
        <div className="absolute z-30 top-full mt-0.5 left-0 right-0 bg-gray-800 border border-gray-600 rounded-lg shadow-2xl flex flex-col max-h-56">
          <div className="p-1.5 border-b border-gray-700">
            <input
              ref={filterRef}
              type="text"
              placeholder="Filter moves..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="w-full bg-gray-700 rounded px-2 py-1 text-xs text-white placeholder-gray-400 outline-none"
            />
          </div>
          <div className="overflow-y-auto">
            <button
              type="button"
              onClick={() => select(null)}
              className="w-full text-left px-2 py-1.5 text-xs text-gray-400 hover:bg-gray-700"
            >
              -- None --
            </button>
            {filtered.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => select(m.id)}
                className={`w-full text-left px-2 py-1.5 text-xs flex items-center gap-1.5 hover:bg-gray-700 ${
                  m.id === value ? 'bg-gray-700/60' : ''
                }`}
              >
                <span
                  className={`shrink-0 px-1 py-0.5 rounded capitalize ${
                    TYPE_COLORS[m.type] ?? 'bg-gray-500 text-white'
                  }`}
                >
                  {m.type}
                </span>
                <span className="capitalize flex-1 text-white">{m.name}</span>
                <span className="shrink-0 text-gray-400">
                  {CAT_ICON[m.category]} {m.power ?? '—'}
                </span>
                <span className="shrink-0 text-gray-500">{m.pp}pp</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
