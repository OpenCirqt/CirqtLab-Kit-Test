// usePPGStream.ts  ← single hook that composes both, this is all you import
import { useCallback } from "react";
import { PPGSample, usePPGFilter } from "./usePPGFilter";
import { usePPGSampleRate } from "./usePPGSampleRate";

export type { PPGSample };

export function usePPGStream() {
  const { recordSample, reset: resetRate } = usePPGSampleRate();
  const { filter, updateSampleRate, reset: resetFilter } = usePPGFilter();

  const processSample = useCallback(
    (raw: number[]): PPGSample | null => {
      const hz = recordSample();
      if (hz) updateSampleRate(hz);
      return filter(raw);
    },
    [recordSample, updateSampleRate, filter],
  );

  const reset = useCallback(() => {
    resetRate();
    resetFilter();
  }, [resetRate, resetFilter]);

  return { processSample, reset };
}
