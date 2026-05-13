import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api-client';
import type { Team, Item, Nature, CreateTeamBody, UpdateTeamBody, TeamPokemonSlot } from '../types/api';
import type { DraftPokemon } from '../types/draft';
import PokemonSlot from '../components/team-builder/PokemonSlot';
import PokemonSearch from '../components/team-builder/PokemonSearch';

// ── Draft helpers ────────────────────────────────────────────────────────────

function apiSlotToDraft(s: NonNullable<Team['slots'][number]>): DraftPokemon {
  return {
    pokemon_id: s.pokemon_id,
    nickname: s.nickname ?? '',
    ability_id: s.ability_id,
    item_id: s.item_id,
    nature_id: s.nature_id,
    move1_id: s.move1_id,
    move2_id: s.move2_id,
    move3_id: s.move3_id,
    move4_id: s.move4_id,
    ev_hp: s.ev_hp,
    ev_atk: s.ev_atk,
    ev_def: s.ev_def,
    ev_spa: s.ev_spa,
    ev_spd: s.ev_spd,
    ev_spe: s.ev_spe,
    iv_hp: s.iv_hp,
    iv_atk: s.iv_atk,
    iv_def: s.iv_def,
    iv_spa: s.iv_spa,
    iv_spd: s.iv_spd,
    iv_spe: s.iv_spe,
  };
}

function draftToApiSlots(slots: (DraftPokemon | null)[]): TeamPokemonSlot[] {
  return slots.flatMap((d, i) => {
    if (!d) return [];
    return [
      {
        slot: i + 1,
        pokemon_id: d.pokemon_id,
        nickname: d.nickname || null,
        ability_id: d.ability_id,
        item_id: d.item_id,
        nature_id: d.nature_id,
        move1_id: d.move1_id,
        move2_id: d.move2_id,
        move3_id: d.move3_id,
        move4_id: d.move4_id,
        ev_hp: d.ev_hp,
        ev_atk: d.ev_atk,
        ev_def: d.ev_def,
        ev_spa: d.ev_spa,
        ev_spd: d.ev_spd,
        ev_spe: d.ev_spe,
        iv_hp: d.iv_hp,
        iv_atk: d.iv_atk,
        iv_def: d.iv_def,
        iv_spa: d.iv_spa,
        iv_spd: d.iv_spd,
        iv_spe: d.iv_spe,
      } satisfies TeamPokemonSlot,
    ];
  });
}

// ── Component ────────────────────────────────────────────────────────────────

export default function TeamBuilder() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isNew = !id;

  // Draft state
  const [teamName, setTeamName] = useState('');
  const [format, setFormat] = useState<'singles' | 'doubles'>('singles');
  const [slots, setSlots] = useState<(DraftPokemon | null)[]>(Array(6).fill(null));
  const [searchSlot, setSearchSlot] = useState<number | null>(null);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Load existing team
  const { data: team, isLoading: teamLoading } = useQuery({
    queryKey: ['team', id],
    queryFn: () => api.get<Team>(`/teams/${id}`),
    enabled: !isNew,
  });

  useEffect(() => {
    if (!team) return;
    setTeamName(team.name);
    setFormat(team.format);
    const mapped: (DraftPokemon | null)[] = Array(6).fill(null);
    team.slots.forEach((s) => {
      if (s) mapped[s.slot - 1] = apiSlotToDraft(s);
    });
    setSlots(mapped);
  }, [team]);

  // Global data
  const { data: items = [] } = useQuery({
    queryKey: ['items'],
    queryFn: () => api.get<Item[]>('/items'),
  });

  const { data: natures = [] } = useQuery({
    queryKey: ['natures'],
    queryFn: () => api.get<Nature[]>('/natures'),
  });

  // Mutations
  const createTeam = useMutation({
    mutationFn: (body: CreateTeamBody) => api.post<Team>('/teams', body),
  });

  const updateTeam = useMutation({
    mutationFn: ({ teamId, body }: { teamId: string; body: UpdateTeamBody }) =>
      api.put<Team>(`/teams/${teamId}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['teams'] });
      qc.invalidateQueries({ queryKey: ['team', id] });
    },
  });

  const deleteTeam = useMutation({
    mutationFn: () => api.delete(`/teams/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['teams'] });
      navigate('/teams');
    },
  });

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  };

  const handleSave = async () => {
    if (!teamName.trim()) {
      showToast('Please enter a team name.', false);
      return;
    }

    const apiSlots = draftToApiSlots(slots);

    try {
      if (isNew) {
        const created = await createTeam.mutateAsync({ name: teamName.trim(), format });
        await updateTeam.mutateAsync({
          teamId: created.id,
          body: { name: teamName.trim(), format, slots: apiSlots },
        });
        qc.invalidateQueries({ queryKey: ['teams'] });
        navigate(`/teams/${created.id}`, { replace: true });
        showToast('Team saved!');
      } else {
        await updateTeam.mutateAsync({
          teamId: id!,
          body: { name: teamName.trim(), format, slots: apiSlots },
        });
        showToast('Team saved!');
      }
    } catch (err) {
      showToast((err as Error).message ?? 'Save failed.', false);
    }
  };

  const handlePokemonSelect = (slotIndex: number, pokemonId: number) => {
    const defaultNatureId = natures[0]?.id ?? 0;
    setSlots((prev) => {
      const next = [...prev];
      next[slotIndex] = {
        pokemon_id: pokemonId,
        nickname: '',
        ability_id: 0,
        item_id: null,
        nature_id: defaultNatureId,
        move1_id: null,
        move2_id: null,
        move3_id: null,
        move4_id: null,
        ev_hp: 0, ev_atk: 0, ev_def: 0, ev_spa: 0, ev_spd: 0, ev_spe: 0,
        iv_hp: 31, iv_atk: 31, iv_def: 31, iv_spa: 31, iv_spd: 31, iv_spe: 31,
      };
      return next;
    });
    setSearchSlot(null);
  };

  const handleSlotChange = (slotIndex: number, draft: DraftPokemon | null) => {
    setSlots((prev) => {
      const next = [...prev];
      next[slotIndex] = draft;
      return next;
    });
  };

  const isSaving = createTeam.isPending || updateTeam.isPending;

  if (!isNew && teamLoading) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
        <p className="text-gray-400">Loading team…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <div className="max-w-6xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <Link to="/teams" className="text-gray-400 hover:text-white text-sm transition-colors">
            ← My Teams
          </Link>
          <div className="flex-1 flex items-center gap-3">
            <input
              type="text"
              placeholder="Team name..."
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              className="bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm font-medium placeholder-gray-500 outline-none focus:ring-2 focus:ring-blue-500 w-56"
            />
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as 'singles' | 'doubles')}
              className="bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="singles">Singles</option>
              <option value="doubles">Doubles</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            {!isNew && (
              <>
                {confirmDelete ? (
                  <>
                    <span className="text-sm text-gray-400">Sure?</span>
                    <button
                      onClick={() => setConfirmDelete(false)}
                      className="text-sm text-gray-400 hover:text-white px-3 py-2 rounded-lg transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => deleteTeam.mutate()}
                      disabled={deleteTeam.isPending}
                      className="text-sm bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white px-3 py-2 rounded-lg transition-colors"
                    >
                      {deleteTeam.isPending ? 'Deleting…' : 'Delete Team'}
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setConfirmDelete(true)}
                    className="text-sm text-gray-500 hover:text-red-400 px-3 py-2 rounded-lg transition-colors"
                  >
                    Delete
                  </button>
                )}
              </>
            )}
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors"
            >
              {isSaving ? 'Saving…' : 'Save Team'}
            </button>
          </div>
        </div>

        {/* 6 Slots grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {slots.map((draft, i) => (
            <PokemonSlot
              key={i}
              slotIndex={i}
              draft={draft}
              items={items}
              natures={natures}
              onChange={(d) => handleSlotChange(i, d)}
              onSearch={() => setSearchSlot(i)}
            />
          ))}
        </div>
      </div>

      {/* Pokemon search modal */}
      {searchSlot !== null && (
        <PokemonSearch
          onSelect={(pokemonId) => handlePokemonSelect(searchSlot, pokemonId)}
          onClose={() => setSearchSlot(null)}
        />
      )}

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-5 right-5 px-4 py-3 rounded-lg shadow-lg text-sm font-medium transition-all ${
            toast.ok ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
          }`}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}
