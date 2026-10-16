package com.Break.uninstall;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * Pure JVM tests for {@link UninstallPhrase}, the matching contract enforced by
 * {@link UninstallLockOverlay} before it lets the uninstall continue.
 */
public class UninstallLockOverlayTest {

    private static final String PHRASE = "DELETE BREAK NOW";

    @Test
    public void exactMatch_passes() {
        assertTrue(UninstallPhrase.matches(PHRASE, "DELETE BREAK NOW"));
    }

    @Test
    public void outerWhitespace_isIgnoredOnBothSides() {
        assertTrue(UninstallPhrase.matches("  " + PHRASE + " ", "\t" + PHRASE + "\n"));
    }

    @Test
    public void innerWhitespace_isSignificant() {
        assertFalse(UninstallPhrase.matches(PHRASE, "DELETE  BREAK NOW"));
    }

    @Test
    public void caseMismatch_fails() {
        assertFalse(UninstallPhrase.matches(PHRASE, "delete break now"));
    }

    @Test
    public void extraOrMissingCharacters_fail() {
        assertFalse(UninstallPhrase.matches(PHRASE, "DELETE BREAK NOW!"));
        assertFalse(UninstallPhrase.matches(PHRASE, "DELETE BREAK NO"));
    }

    @Test
    public void emptyOrNullInput_fails() {
        assertFalse(UninstallPhrase.matches(PHRASE, ""));
        assertFalse(UninstallPhrase.matches(PHRASE, "   "));
        assertFalse(UninstallPhrase.matches(PHRASE, null));
    }

    @Test
    public void blankOrNullConfiguredPhrase_neverMatches() {
        assertFalse(UninstallPhrase.matches("", ""));
        assertFalse(UninstallPhrase.matches(null, null));
        assertFalse(UninstallPhrase.matches("   ", "   "));
    }

    @Test
    public void normalizeAndValidity() {
        assertEquals("", UninstallPhrase.normalize(null));
        assertEquals("abc", UninstallPhrase.normalize("  abc "));
        assertFalse(UninstallPhrase.isValid(null));
        assertFalse(UninstallPhrase.isValid("  "));
        assertTrue(UninstallPhrase.isValid(" x "));
    }
}
