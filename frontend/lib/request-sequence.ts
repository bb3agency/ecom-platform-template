/**
 * Last-request-wins guard for list loaders.
 *
 * Changing a filter while on page 3 fires two overlapping fetches (page 3 with
 * the new filter, then page 1 once the page resets). Whichever resolved last used
 * to win. Each load takes a ticket with `begin()` and only writes state while
 * `isLatest(ticket)` is still true, so an older response is dropped.
 */
export interface RequestSequence {
  begin: () => number;
  isLatest: (ticket: number) => boolean;
}

export function createRequestSequence(): RequestSequence {
  let current = 0;
  return {
    begin: () => {
      current += 1;
      return current;
    },
    isLatest: (ticket) => ticket === current,
  };
}
