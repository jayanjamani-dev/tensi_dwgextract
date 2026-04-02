export type PatternType = "prefix" | "suffix" | "exact";

export interface PatternRule {
  type: PatternType;
  match?: string;  // For prefix: what the original string should start with (optional)
  value: string;  // The prefix/suffix string to add, or the exact replacement
}

/**
 * Detects a pattern between an original and corrected value.
 * Currently supports:
 * 1. Prefix addition: e.g., "03" -> "AD03" (prefix "AD")
 * 2. Suffix addition: e.g., "03" -> "03-A" (suffix "-A")
 * 3. Fallback to Exact substitution.
 */
export function detectPattern(original: string | null, corrected: string | null): PatternRule | null {
  if (!original || !corrected || original === corrected) return null;

  // 1. Prefix detection
  if (corrected.endsWith(original) && corrected.length > original.length) {
    const prefix = corrected.slice(0, corrected.length - original.length);
    return { type: "prefix", value: prefix };
  }

  // 2. Suffix detection
  if (corrected.startsWith(original) && corrected.length > original.length) {
    const suffix = corrected.slice(original.length);
    return { type: "suffix", value: suffix };
  }

  // 3. Exact substitution (fallback)
  return { type: "exact", value: corrected };
}

/**
 * Applies a pattern to a value.
 */
export function applyPattern(value: string | null, rule: PatternRule): string | null {
  if (!value) return null;

  switch (rule.type) {
    case "prefix":
      // Avoid double prefixing if it already has it
      if (value.startsWith(rule.value)) return value;
      return rule.value + value;
    case "suffix":
      if (value.endsWith(rule.value)) return value;
      return value + rule.value;
    case "exact":
      return rule.value;
    default:
      return value;
  }
}

/**
 * Checks if a value "matches" a pattern's potential application area.
 * For prefix/suffix, we look for strings that DON'T have the prefix/suffix but look "similar".
 * For now, we just suggest it for any non-null value if the type is prefix/suffix.
 */
export function matchesPattern(value: string | null, originalExample: string | null, rule: PatternRule): boolean {
  if (!value || value === originalExample) return false;

  switch (rule.type) {
    case "prefix":
      // If original was "03" and corrected "AD03", rule is prefix "AD".
      // We match other values that look like they are missing "AD".
      // Simple heuristic: if the value doesn't start with AD but ends with something similar?
      // For now, let's just use length and basic structure.
      return !value.startsWith(rule.value);
    case "suffix":
      return !value.endsWith(rule.value);
    case "exact":
      return value === originalExample;
    default:
      return false;
  }
}
