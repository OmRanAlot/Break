package com.Break.prefs;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.content.Context;

import com.Break.uninstall.PhraseDisableGate;

import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;

/**
 * Robolectric tests for the phrase-change gate in {@link BreakPrefs}.
 *
 * Covers:
 * - {@link BreakPrefs#setUninstallPhrase} is refused while the requirement is on.
 * - {@link BreakPrefs#setUninstallPhrase} is allowed while the requirement is off.
 * - {@link BreakPrefs#changeUninstallPhrase} returns NOT_READY outside the window.
 * - {@link BreakPrefs#changeUninstallPhrase} returns WRONG_CURRENT with a bad current phrase.
 * - {@link BreakPrefs#changeUninstallPhrase} returns OK in the window with correct current.
 * - The request timestamp is cleared after a successful change.
 * - {@link BreakPrefs#changeUninstallPhrase} returns BLANK for an empty new phrase.
 * - {@link BreakPrefs#changeUninstallPhrase} returns SAME when the new phrase matches the old one.
 */
@RunWith(RobolectricTestRunner.class)
public class BreakPrefsPhraseChangeTest {

    private static final String PHRASE = "DELETE BREAK NOW";
    private static final String NEW_PHRASE = "STILL NOT DELETING";

    private Context context;

    @Before
    public void setUp() {
        context = RuntimeEnvironment.getApplication();
        // Start with a clean slate.
        BreakPrefs.get(context).edit().clear().apply();
    }

    // ── setUninstallPhrase gate ───────────────────────────────────────────────

    @Test
    public void setUninstallPhrase_allowedWhileRequirementIsOff() {
        // Requirement off by default.
        assertTrue(BreakPrefs.setUninstallPhrase(context, PHRASE));
        assertEquals(PHRASE, BreakPrefs.getUninstallPhrase(context));
    }

    @Test
    public void setUninstallPhrase_refusedWhileRequirementIsOn() {
        // Set up: store phrase and enable the requirement.
        BreakPrefs.get(context).edit()
                .putString(BreakPrefs.KEY_UNINSTALL_PHRASE, PHRASE)
                .putBoolean(BreakPrefs.KEY_UNINSTALL_PHRASE_ENABLED, true)
                .apply();

        assertFalse(BreakPrefs.setUninstallPhrase(context, NEW_PHRASE));
        // Stored phrase must not have changed.
        assertEquals(PHRASE, BreakPrefs.getUninstallPhrase(context));
    }

    // ── changeUninstallPhrase: NOT_READY ─────────────────────────────────────

    @Test
    public void changeUninstallPhrase_notReady_whenNoRequestExists() {
        enablePhraseRequirement();
        assertEquals(
                BreakPrefs.ChangeResult.NOT_READY,
                BreakPrefs.changeUninstallPhrase(context, PHRASE, NEW_PHRASE));
    }

    @Test
    public void changeUninstallPhrase_notReady_duringWait() {
        enablePhraseRequirement();
        // Plant a request that is still in the 1-hour wait.
        long requestAt = System.currentTimeMillis();
        BreakPrefs.get(context).edit()
                .putLong(BreakPrefs.KEY_UNINSTALL_PHRASE_CHANGE_REQUEST_AT, requestAt)
                .apply();

        assertEquals(
                BreakPrefs.ChangeResult.NOT_READY,
                BreakPrefs.changeUninstallPhrase(context, PHRASE, NEW_PHRASE));
    }

    // ── changeUninstallPhrase: WRONG_CURRENT ─────────────────────────────────

    @Test
    public void changeUninstallPhrase_wrongCurrent_inReadyWindow() {
        enablePhraseRequirementWithReadyWindow();
        assertEquals(
                BreakPrefs.ChangeResult.WRONG_CURRENT,
                BreakPrefs.changeUninstallPhrase(context, "wrong phrase", NEW_PHRASE));
        // Phrase must not have changed.
        assertEquals(PHRASE, BreakPrefs.getUninstallPhrase(context));
    }

    // ── changeUninstallPhrase: BLANK ─────────────────────────────────────────

    @Test
    public void changeUninstallPhrase_blank_inReadyWindow() {
        enablePhraseRequirementWithReadyWindow();
        assertEquals(
                BreakPrefs.ChangeResult.BLANK,
                BreakPrefs.changeUninstallPhrase(context, PHRASE, "   "));
    }

    // ── changeUninstallPhrase: SAME ──────────────────────────────────────────

    @Test
    public void changeUninstallPhrase_same_inReadyWindow() {
        enablePhraseRequirementWithReadyWindow();
        assertEquals(
                BreakPrefs.ChangeResult.SAME,
                BreakPrefs.changeUninstallPhrase(context, PHRASE, PHRASE));
    }

    // ── changeUninstallPhrase: OK ────────────────────────────────────────────

    @Test
    public void changeUninstallPhrase_ok_inReadyWindow() {
        enablePhraseRequirementWithReadyWindow();
        assertEquals(
                BreakPrefs.ChangeResult.OK,
                BreakPrefs.changeUninstallPhrase(context, PHRASE, NEW_PHRASE));
        assertEquals(NEW_PHRASE, BreakPrefs.getUninstallPhrase(context));
    }

    @Test
    public void changeUninstallPhrase_clearsRequestAfterSuccess() {
        enablePhraseRequirementWithReadyWindow();
        BreakPrefs.changeUninstallPhrase(context, PHRASE, NEW_PHRASE);
        // The request key must now be gone (returns 0).
        assertEquals(0L, BreakPrefs.getUninstallPhraseChangeRequestAt(context));
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private void enablePhraseRequirement() {
        BreakPrefs.get(context).edit()
                .putString(BreakPrefs.KEY_UNINSTALL_PHRASE, PHRASE)
                .putBoolean(BreakPrefs.KEY_UNINSTALL_PHRASE_ENABLED, true)
                .apply();
    }

    /**
     * Enables the requirement AND plants a change request timestamp that puts
     * the gate in the READY window (wait elapsed, window not yet expired).
     */
    private void enablePhraseRequirementWithReadyWindow() {
        enablePhraseRequirement();
        long readyAt = System.currentTimeMillis() - PhraseDisableGate.WAIT_MS - 1;
        BreakPrefs.get(context).edit()
                .putLong(BreakPrefs.KEY_UNINSTALL_PHRASE_CHANGE_REQUEST_AT, readyAt)
                .apply();
    }
}
