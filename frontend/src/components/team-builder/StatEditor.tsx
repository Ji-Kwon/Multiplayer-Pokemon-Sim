import { STAT_LABELS, EV_STATS, type StatKey } from '../../lib/constants';
import type { DraftPokemon } from '../../types/draft';

interface Props {
  draft: DraftPokemon;
  onChange: (patch: Partial<DraftPokemon>) => void;
}

export default function StatEditor({ draft, onChange }: Props) {
  const evTotal = EV_STATS.reduce(
    (sum, s) => sum + (draft[`ev_${s}` as keyof DraftPokemon] as number),
    0
  );
  const overCap = evTotal > 510;

  const clamp = (val: number, min: number, max: number) =>
    Math.min(max, Math.max(min, isNaN(val) ? min : val));

  return (
    <div className="text-xs">
      <div className="grid grid-cols-[3rem_1fr_1fr] gap-x-2 gap-y-1 items-center mb-2">
        <div />
        <div className="text-center text-gray-400 font-medium">EV</div>
        <div className="text-center text-gray-400 font-medium">IV</div>

        {(EV_STATS as readonly StatKey[]).map((stat) => {
          const evKey = `ev_${stat}` as keyof DraftPokemon;
          const ivKey = `iv_${stat}` as keyof DraftPokemon;
          return (
            <>
              <div key={`${stat}-label`} className="text-gray-400 font-medium">
                {STAT_LABELS[stat]}
              </div>
              <input
                key={`${stat}-ev`}
                type="number"
                min={0}
                max={252}
                value={draft[evKey] as number}
                onChange={(e) =>
                  onChange({ [evKey]: clamp(parseInt(e.target.value, 10), 0, 252) })
                }
                className="bg-gray-700 rounded px-1 py-0.5 w-full text-center text-white outline-none focus:ring-1 focus:ring-blue-500"
              />
              <input
                key={`${stat}-iv`}
                type="number"
                min={0}
                max={31}
                value={draft[ivKey] as number}
                onChange={(e) =>
                  onChange({ [ivKey]: clamp(parseInt(e.target.value, 10), 0, 31) })
                }
                className="bg-gray-700 rounded px-1 py-0.5 w-full text-center text-white outline-none focus:ring-1 focus:ring-blue-500"
              />
            </>
          );
        })}
      </div>

      <div className={`text-right font-medium ${overCap ? 'text-red-400' : 'text-gray-400'}`}>
        EV Total: {evTotal} / 510{overCap ? ' — over cap!' : ''}
      </div>
    </div>
  );
}
