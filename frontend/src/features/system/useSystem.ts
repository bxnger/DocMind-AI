import { useQuery } from '@tanstack/react-query';
import { getCapabilities, getHealth } from '@/api/system';

const HEALTH_INTERVAL_MS = 15_000;

export function useBackendHealth() {
  const query = useQuery({
    queryKey: ['health'],
    queryFn: async ({ signal }) => {
      await getHealth(signal);
      return true;
    },
    refetchInterval: HEALTH_INTERVAL_MS,
    retry: false,
  });
  return {
    status: query.isPending ? 'checking' : query.isError ? 'offline' : 'online',
    retry: () => void query.refetch(),
    isRetrying: query.isFetching,
  } as const;
}

export function useCapabilities() {
  return useQuery({
    queryKey: ['capabilities'],
    queryFn: ({ signal }) => getCapabilities(signal),
    staleTime: 5 * 60_000,
  });
}
