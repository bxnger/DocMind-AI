import { useCallback, useState } from 'react';
import { readStored, writeStored } from '@/lib/storage';

export function usePersistentState<T>(key: string, initial: T): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => readStored('local', key, initial));
  const update = useCallback(
    (next: T) => {
      setValue(next);
      writeStored('local', key, next);
    },
    [key],
  );
  return [value, update];
}
