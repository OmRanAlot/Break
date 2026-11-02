package com.Break.uninstall;

/**
 * UninstallPhrase
 * ---------------
 * Pure (Android-free) helper for the optional "type a phrase to delete" safeguard.
 *
 * Contract (shared by BreakPrefs storage and UninstallLockOverlay validation):
 * - Outer whitespace is trimmed on both the stored phrase and the typed input.
 * - Matching is otherwise EXACT and case-sensitive.
 * - A blank/null phrase can never be matched, so a misconfigured feature can
 * never be "satisfied" by typing nothing.
 *
 * Logging: none, by design — neither the phrase nor typed input may ever be
 * logged (see docs/LOGGING.md privacy rule for this feature).
 */
public final class UninstallPhrase {

    private UninstallPhrase() {
    }

    /** Trims outer whitespace; null becomes the empty string. */
    public static String normalize(String raw) {
        return raw == null ? "" : raw.trim();
    }

    /** True when the phrase is usable (non-blank after normalization). */
    public static boolean isValid(String phrase) {
        return !normalize(phrase).isEmpty();
    }

    /**
     * True only when {@code typed} equals {@code configured} after trimming outer
     * whitespace (case-sensitive) AND the configured phrase is non-blank.
     */
    public static boolean matches(String configured, String typed) {
        String expected = normalize(configured);
        if (expected.isEmpty()) {
            return false;
        }
        return expected.equals(normalize(typed));
    }
}
