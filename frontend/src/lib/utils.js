// @language  JavaScript
// @updated   2026-09-03
// @changed   New file: the standard shadcn cn() class-merging helper (clsx + tailwind-merge), needed by
//            the ported ai-chat-input component. No @ path alias in this project, so it's imported by
//            relative path (../../lib/utils) rather than @/lib/utils.
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
