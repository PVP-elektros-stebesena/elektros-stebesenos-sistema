import { useState, useCallback } from 'react';
import {
  useQuery,
  type UseQueryResult,
  type UseQueryOptions,
} from '@tanstack/react-query';
import { apiFetch } from '../services/apiClient';

export interface UsePollingOptions<TData, TError = Error>
  extends Omit<
    UseQueryOptions<TData, TError>,
    'queryKey' | 'queryFn' | 'refetchInterval' | 'refetchIntervalInBackground'
  > {

  //interval in seconds between polls, defaults to 5s
  intervalSeconds?: number;

  // true by default, makes react query refetch even when the page is in the background (should probably always be true)
  refetchInBackground?: boolean;
}

export type UsePollingResult<TData, TError = Error> = UseQueryResult<TData, TError> & {
  isPolling: boolean;
  
  // pause polling
  pausePolling: () => void;

  // resume polling
  resumePolling: () => void;
};

/**
 * Polls "endpoint" every "intervalSeconds" seconds and returns the latest data
 *
 * example usage:
 * const { data, isLoading, isPolling, pausePolling } = usePolling<VoltageReading[]>(
 *   ['voltageReadings'],
 *   `/api/voltage/latest`,
 *   { intervalSeconds: 1 },
 * );
 */
export function usePolling<TData = unknown, TError = Error>(
  queryKey: UseQueryOptions<TData, TError>['queryKey'],
  endpoint: string,
  options?: UsePollingOptions<TData, TError>,
): UsePollingResult<TData, TError> {
  const {
    intervalSeconds = 5,
    refetchInBackground = true,
    enabled = true,
    ...restOptions
  } = options ?? {};

  const [isPolling, setIsPolling] = useState(enabled !== false);

  const pausePolling = useCallback(() => setIsPolling(false), []);
  const resumePolling = useCallback(() => setIsPolling(true), []);

  const query = useQuery<TData, TError>({
    queryKey,
    queryFn: () => apiFetch<TData>(endpoint),
    refetchInterval: isPolling ? intervalSeconds * 1000 : false,
    refetchIntervalInBackground: refetchInBackground,
    enabled: enabled !== false,
    ...restOptions,
  });

  return { ...query, isPolling, pausePolling, resumePolling };
}
