import type {
  ModelCost,
  ModelCostRates,
  ModelCostTier,
} from "@earendil-works/pi-ai";

function scaleRates(rates: ModelCostRates, multiplier: number): ModelCostRates {
  return {
    input: rates.input * multiplier,
    output: rates.output * multiplier,
    cacheRead: rates.cacheRead * multiplier,
    cacheWrite: rates.cacheWrite * multiplier,
  };
}

function scaleTier(tier: ModelCostTier, multiplier: number): ModelCostTier {
  return {
    ...scaleRates(tier, multiplier),
    inputTokensAbove: tier.inputTokensAbove,
  };
}

/**
 * Returns a copy of the model cost with every rate scaled by the Priority
 * multiplier, including request-wide tiers. Pi stays the sole owner of cost
 * calculation; only the rates it reads are replaced.
 */
export function scalePriorityCost(
  cost: ModelCost,
  multiplier: number,
): ModelCost {
  return {
    ...scaleRates(cost, multiplier),
    ...(cost.tiers
      ? { tiers: cost.tiers.map((tier) => scaleTier(tier, multiplier)) }
      : {}),
  };
}
