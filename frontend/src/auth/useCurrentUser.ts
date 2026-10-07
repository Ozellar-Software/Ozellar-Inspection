import { useQuery } from '@tanstack/react-query';
import type { User } from '@ozellar/shared';
import { api } from '../api/client';
import { getCachedUser, setCachedUser } from './session';

/**
 * Universal hook for accessing the current signed-in user profile.
 * Loads synchronously on frame 0 from localStorage cache (getCachedUser) so role
 * and vessel filters work instantly without blank screens or delays both offline and online.
 */
export function useCurrentUser() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const user = await api<User>('/me');
      setCachedUser(user);
      return user;
    },
    initialData: getCachedUser() ?? undefined,
    staleTime: 5 * 60 * 1000,
  });
}
