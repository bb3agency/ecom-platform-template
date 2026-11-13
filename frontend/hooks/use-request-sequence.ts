"use client";

import { useState } from "react";
import { createRequestSequence, type RequestSequence } from "@/lib/request-sequence";

/** Stable per-component {@link RequestSequence}; see lib/request-sequence.ts. */
export function useRequestSequence(): RequestSequence {
  const [sequence] = useState(createRequestSequence);
  return sequence;
}
