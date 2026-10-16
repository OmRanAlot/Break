package com.Break.uninstall;

/**
 * PhraseDisableGate
 * -----------------
 * Pure (Android-free) timing rules for turning OFF the typed-phrase deletion
 * safeguard. The user cannot simply flip it off:
 *
 * 1. First attempt records a request at time T.
 * 2. Until T + {@link #WAIT_MS} (1 hour) the state is WAITING — off is refused.
 * 3. From T + 1h for {@link #WINDOW_MS} (15 min) the state is READY — the user
 * may confirm turning it off.
 * 4. If the window passes without confirming, the request EXPIRES: the safeguard
 * stays on and the next off-attempt starts a fresh 1-hour wait.
 *
 * Uses wall-clock millis supplied by the caller (testable, no Android deps).
 * Logging: none.
 */
public final class PhraseDisableGate {

    public static final long WAIT_MS = 60L * 60 * 1000;
    public static final long WINDOW_MS = 15L * 60 * 1000;

    public enum State { NONE, WAITING, READY }

    private PhraseDisableGate() {
    }

    /**
     * @param requestAtMs epoch ms of the first off-attempt, or 0 if none
     * @param nowMs       current epoch ms
     * @return NONE (no live request, includes expired/invalid), WAITING, or READY
     */
    public static State stateOf(long requestAtMs, long nowMs) {
        if (requestAtMs <= 0 || nowMs < requestAtMs) {
            // Clock moved backwards before the request: treat as no valid request.
            return State.NONE;
        }
        long readyAt = requestAtMs + WAIT_MS;
        if (nowMs < readyAt) {
            return State.WAITING;
        }
        if (nowMs < readyAt + WINDOW_MS) {
            return State.READY;
        }
        return State.NONE;
    }

    public static long readyAt(long requestAtMs) {
        return requestAtMs + WAIT_MS;
    }

    public static long expiresAt(long requestAtMs) {
        return requestAtMs + WAIT_MS + WINDOW_MS;
    }
}
