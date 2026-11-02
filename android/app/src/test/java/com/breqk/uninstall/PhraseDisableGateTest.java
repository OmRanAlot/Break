package com.Break.uninstall;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

/** Pure JVM tests for {@link PhraseDisableGate}. */
public class PhraseDisableGateTest {

    private static final long T = 1_000_000L;

    @Test
    public void noRequest_isNone() {
        assertEquals(PhraseDisableGate.State.NONE, PhraseDisableGate.stateOf(0, T));
    }

    @Test
    public void duringWait_isWaiting() {
        assertEquals(PhraseDisableGate.State.WAITING, PhraseDisableGate.stateOf(T, T));
        assertEquals(PhraseDisableGate.State.WAITING,
                PhraseDisableGate.stateOf(T, T + PhraseDisableGate.WAIT_MS - 1));
    }

    @Test
    public void afterWait_isReadyForWindow() {
        assertEquals(PhraseDisableGate.State.READY,
                PhraseDisableGate.stateOf(T, T + PhraseDisableGate.WAIT_MS));
        assertEquals(PhraseDisableGate.State.READY,
                PhraseDisableGate.stateOf(T, T + PhraseDisableGate.WAIT_MS
                        + PhraseDisableGate.WINDOW_MS - 1));
    }

    @Test
    public void afterWindow_expiresToNone() {
        assertEquals(PhraseDisableGate.State.NONE,
                PhraseDisableGate.stateOf(T, T + PhraseDisableGate.WAIT_MS
                        + PhraseDisableGate.WINDOW_MS));
    }

    @Test
    public void clockBeforeRequest_isNone() {
        assertEquals(PhraseDisableGate.State.NONE, PhraseDisableGate.stateOf(T, T - 1));
    }
}
