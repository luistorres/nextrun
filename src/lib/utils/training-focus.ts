// ---------------------------------------------------------------------------
// Training Load Focus Classification
//
// Classifies activities into load focus categories based on Garmin's
// aerobic and anaerobic training effect scores (0–5 scale).
// ---------------------------------------------------------------------------

export type LoadFocusCategory = "low_aerobic" | "high_aerobic" | "anaerobic";

interface LoadFocusMeta {
  label: string;
  shortLabel: string;
  color: string;
  description: string;
}

export const LOAD_FOCUS_CONFIG: Record<LoadFocusCategory, LoadFocusMeta> = {
  low_aerobic: {
    label: "Low Aerobic",
    shortLabel: "Base",
    color: "#545A62",
    description: "Easy effort — builds aerobic base",
  },
  high_aerobic: {
    label: "High Aerobic",
    shortLabel: "Tempo",
    color: "#2F6B45",
    description: "Moderate-hard effort — improves lactate threshold",
  },
  anaerobic: {
    label: "Anaerobic",
    shortLabel: "Anaerobic",
    color: "#96691D",
    description: "High intensity — develops power and VO2max",
  },
};

export function classifyLoadFocus(
  aerobicTE: number | null,
  anaerobicTE: number | null
): LoadFocusCategory {
  if (anaerobicTE !== null && anaerobicTE >= 3.0) return "anaerobic";
  if (aerobicTE !== null && aerobicTE >= 3.0) return "high_aerobic";
  return "low_aerobic";
}

interface LoadFocusDistribution {
  category: LoadFocusCategory;
  count: number;
  percentage: number;
}

export function computeLoadFocusDistribution(
  activities: { trainingEffectAerobic: number | null; trainingEffectAnaerobic: number | null }[]
): LoadFocusDistribution[] {
  const counts: Record<LoadFocusCategory, number> = {
    low_aerobic: 0,
    high_aerobic: 0,
    anaerobic: 0,
  };

  for (const a of activities) {
    counts[classifyLoadFocus(a.trainingEffectAerobic, a.trainingEffectAnaerobic)]++;
  }

  const total = activities.length || 1;

  return (["low_aerobic", "high_aerobic", "anaerobic"] as const).map((cat) => ({
    category: cat,
    count: counts[cat],
    percentage: (counts[cat] / total) * 100,
  }));
}
