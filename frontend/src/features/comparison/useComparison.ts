import { useMutation, useQuery } from '@tanstack/react-query';
import { createComparison, getComparison } from '@/api/comparisons';
import { AppError } from '@/api/client';

const POLL_MS = 1000;

export function useComparison(id: string | null) {
  return useQuery({
    queryKey: ['comparison', id],
    queryFn: ({ signal }) => getComparison(id ?? '', signal),
    enabled: id !== null,
    refetchInterval: (query) => (query.state.data?.status === 'processing' ? POLL_MS : false),
    retry: (count, error) => !(error instanceof AppError && error.status === 404) && count < 1,
  });
}

export function useStartComparison() {
  return useMutation({ mutationFn: ({ a, b }: { a: string; b: string }) => createComparison(a, b) });
}
