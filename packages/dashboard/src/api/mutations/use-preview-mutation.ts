import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import { ApiError, apiFetch } from '../client.js';
import type { PreviewRequestBody, PreviewResponse } from '../types.js';

/**
 * `POST /evaluate/preview` is declared non-mutating at the BFF (design §10.1,
 * ladder row 44) — a pure read despite its HTTP method — so unlike every
 * screen in D4a/D5 this is NOT `useVersionedMutation`: there is no `If-Match`,
 * no cached `version`, and no query invalidation. It is a plain TanStack
 * `useMutation` used only for its request-lifecycle ergonomics (`isPending`,
 * `isError`, `mutate`), not because this call changes server state.
 */
export function usePreviewMutation(): UseMutationResult<
  PreviewResponse,
  ApiError,
  PreviewRequestBody
> {
  return useMutation<PreviewResponse, ApiError, PreviewRequestBody>({
    mutationFn: (body) =>
      apiFetch<PreviewResponse>('/api/evaluate/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
  });
}
