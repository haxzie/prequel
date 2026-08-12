/**
 * Joins class names, dropping anything falsy.
 *
 * Utilities all carry the same specificity, so which of two conflicting classes
 * wins is decided by their order in the generated stylesheet rather than in the
 * string here. Conditional states are therefore built by emitting only the
 * classes that apply — never by appending an override and hoping it lands last.
 */
export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}
