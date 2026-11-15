// Runs the heavy simulation work off the main thread.
import type { DropSource } from './lib/model';
import { simulate, simulateUntilComplete, unitsToComplete, valueSamples, type LootLine } from './lib/sim';

export type WorkerRequest =
  | { type: 'run'; id: number; src: DropSource; units: number; prices: Record<string, number>; budget: number }
  | { type: 'complete'; id: number; src: DropSource; items: string[]; trials: number; prices: Record<string, number>; budget: number };

export type WorkerResponse =
  | { type: 'run'; id: number; units: number; loot: LootLine[]; samples: number[] }
  | { type: 'complete'; id: number; units: number; complete: boolean; loot: LootLine[]; trialUnits: number[]; samples: number[] }
  | { type: 'error'; id: number; message: string };

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;
  try {
    const price = (n: string) => req.prices[n] ?? 0;
    if (req.type === 'run') {
      const res = simulate(req.src, req.units);
      const runs = Math.min(400, Math.floor(req.budget / Math.max(1, req.units)));
      const samples = runs >= 50 ? valueSamples(req.src, req.units, runs, price) : [];
      post({ type: 'run', id: req.id, units: res.units, loot: Array.from(res.loot.values()), samples });
    } else {
      const res = simulateUntilComplete(req.src, req.items);
      const trialUnits: number[] = [];
      let spent = res.units;
      for (let t = 0; t < req.trials && spent < req.budget; t++) {
        const n = unitsToComplete(req.src, req.items, Math.random, 5_000_000);
        if (n === null) break;
        trialUnits.push(n);
        spent += n;
      }
      trialUnits.sort((a, b) => a - b);
      const runs = Math.min(200, Math.floor(req.budget / 4 / Math.max(1, res.units)));
      const samples = runs >= 50 ? valueSamples(req.src, res.units, runs, price) : [];
      post({ type: 'complete', id: req.id, units: res.units, complete: res.complete, loot: Array.from(res.loot.values()), trialUnits, samples });
    }
  } catch (e) {
    post({ type: 'error', id: req.id, message: e instanceof Error ? e.message : String(e) });
  }
};

function post(msg: WorkerResponse) {
  (self as unknown as Worker).postMessage(msg);
}
