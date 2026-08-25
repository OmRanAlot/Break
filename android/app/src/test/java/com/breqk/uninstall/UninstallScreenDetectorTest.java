package com.Break.uninstall;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;

/**
 * Pure JVM tests for {@link UninstallScreenDetector#matchesScreen} and
 * {@link UninstallScreenDetector#buildIdentityTokens}.
 *
 * No Android dependencies — tests run on the local JVM without a device/emulator.
 *
 * Detection spec (two required signals in the same window):
 *   1. "uninstall" (case-insensitive — nodeTexts are pre-lowercased)
 *   2. App identity: launcher label on a word boundary OR package id as substring
 */
public class UninstallScreenDetectorTest {

    private static final String[] BREAK_TOKENS =
            UninstallScreenDetector.buildIdentityTokens("break", "com.break");

    // ── Hit cases ────────────────────────────────────────────────────────────

    @Test
    public void hit_labelAndUninstallOnSamePage() {
        List<String> nodes = Arrays.asList("break", "uninstall");
        assertTrue(UninstallScreenDetector.matchesScreen(nodes, BREAK_TOKENS));
    }

    @Test
    public void hit_packageIdAndUninstall_noAppInfoMarkers() {
        // packageinstaller dialog: shows package id + "Uninstall" but no Force stop etc.
        List<String> nodes = Arrays.asList("com.break", "uninstall this app?");
        assertTrue(UninstallScreenDetector.matchesScreen(nodes, BREAK_TOKENS));
    }

    @Test
    public void hit_labelInLargerString_wordBoundary() {
        // Label "break" appears as a whole word in a sentence
        List<String> nodes = Arrays.asList("app: break", "uninstall");
        assertTrue(UninstallScreenDetector.matchesScreen(nodes, BREAK_TOKENS));
    }

    @Test
    public void hit_singleNodeContainsBoth() {
        // Both signals in one node text
        List<String> nodes = Collections.singletonList("uninstall break?");
        assertTrue(UninstallScreenDetector.matchesScreen(nodes, BREAK_TOKENS));
    }

    @Test
    public void hit_caseInsensitiveUninstall() {
        // collectText lowercases, but matchesScreen works on pre-lowercased input
        List<String> nodes = Arrays.asList("break", "uninstall");
        assertTrue(UninstallScreenDetector.matchesScreen(nodes, BREAK_TOKENS));
    }

    // ── Miss cases ───────────────────────────────────────────────────────────

    @Test
    public void miss_labelPresentButNoUninstall() {
        List<String> nodes = Arrays.asList("break", "storage", "force stop");
        assertFalse(UninstallScreenDetector.matchesScreen(nodes, BREAK_TOKENS));
    }

    @Test
    public void miss_uninstallPresentButNoIdentity() {
        // Another app's uninstall page — no "break" anywhere
        List<String> nodes = Arrays.asList("chrome", "uninstall");
        assertFalse(UninstallScreenDetector.matchesScreen(nodes, BREAK_TOKENS));
    }

    @Test
    public void miss_partialLabelSubstringNotWordBoundary() {
        // "breakfast" contains "break" but not on a word boundary
        List<String> nodes = Arrays.asList("breakfast", "uninstall");
        assertFalse(UninstallScreenDetector.matchesScreen(nodes, BREAK_TOKENS));
    }

    @Test
    public void miss_emptyNodeList() {
        assertFalse(UninstallScreenDetector.matchesScreen(Collections.emptyList(), BREAK_TOKENS));
    }

    @Test
    public void miss_nullInNodeList_doesNotCrash() {
        List<String> nodes = Arrays.asList(null, "break", null);
        // No "uninstall" — should return false without NPE
        assertFalse(UninstallScreenDetector.matchesScreen(nodes, BREAK_TOKENS));
    }

    // ── isUninstallWatchPackage ───────────────────────────────────────────────

    @Test
    public void watchPackage_settings() {
        assertTrue(UninstallScreenDetector.isUninstallWatchPackage("com.android.settings"));
    }

    @Test
    public void watchPackage_aosp_packageinstaller() {
        assertTrue(UninstallScreenDetector.isUninstallWatchPackage("com.android.packageinstaller"));
    }

    @Test
    public void watchPackage_google_packageinstaller() {
        assertTrue(UninstallScreenDetector.isUninstallWatchPackage("com.google.android.packageinstaller"));
    }

    @Test
    public void watchPackage_samsung_packageinstaller() {
        assertTrue(UninstallScreenDetector.isUninstallWatchPackage("com.samsung.android.packageinstaller"));
    }

    @Test
    public void watchPackage_playStore() {
        assertTrue(UninstallScreenDetector.isUninstallWatchPackage("com.android.vending"));
    }

    @Test
    public void watchPackage_breakSelf_excluded() {
        // Break must not scan itself (Customize contains "uninstall" — would self-trigger)
        assertFalse(UninstallScreenDetector.isUninstallWatchPackage("com.Break"));
    }

    @Test
    public void watchPackage_instagram_excluded() {
        assertFalse(UninstallScreenDetector.isUninstallWatchPackage("com.instagram.android"));
    }

    @Test
    public void watchPackage_null_doesNotCrash() {
        assertFalse(UninstallScreenDetector.isUninstallWatchPackage(null));
    }

    // ── buildIdentityTokens ──────────────────────────────────────────────────

    @Test
    public void buildTokens_labelDiffersFromPackage_returnsBoth() {
        String[] tokens = UninstallScreenDetector.buildIdentityTokens("break", "com.break");
        assertTrue(tokens.length == 2);
    }

    @Test
    public void buildTokens_labelEqualsPackage_returnsOne() {
        String[] tokens = UninstallScreenDetector.buildIdentityTokens("com.break", "com.break");
        assertTrue(tokens.length == 1);
    }

    @Test
    public void buildTokens_nullLabel_returnsPackageOnly() {
        String[] tokens = UninstallScreenDetector.buildIdentityTokens(null, "com.break");
        assertTrue(tokens.length == 1);
        assertTrue(tokens[0].equals("com.break"));
    }
}
