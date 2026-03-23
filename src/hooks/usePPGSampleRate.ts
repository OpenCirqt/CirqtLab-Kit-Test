// usePPGSampleRate.ts
import { useCallback, useRef } from "react";

const ESTIMATION_WINDOW = 20;

export function usePPGSampleRate() {
  const timestamps = useRef<number[]>([]);

  const recordSample = useCallback((): number | null => {
    const now = Date.now();
    timestamps.current.push(now);
    if (timestamps.current.length > ESTIMATION_WINDOW) {
      timestamps.current.shift();
    }

    if (timestamps.current.length < 2) return null;

    const oldest = timestamps.current[0];
    const newest = timestamps.current[timestamps.current.length - 1];
    const elapsedSec = (newest - oldest) / 1000;
    const hz = (timestamps.current.length - 1) / elapsedSec;

    return hz;
  }, []);

  const reset = useCallback(() => {
    timestamps.current = [];
  }, []);

  return { recordSample, reset };
}
