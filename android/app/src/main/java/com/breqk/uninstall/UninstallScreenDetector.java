package com.Break.uninstall;

import android.content.Context;
import android.content.pm.PackageManager;
import android.util.Log;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.accessibility.AccessibilityWindowInfo;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;

/**
 * Detects when the user is about to uninstall Break — covers the App Info screen
 * in Settings AND the system uninstall-confirm dialog shown by packageinstaller.
 *
 * Detection requires BOTH conditions in the same window:
 *   1. "uninstall" appears in the node tree (case-insensitive)
 *   2. This app's identity appears in the node tree — either its launcher label
 *      (word-boundary match) or its package id (substring). Both are resolved at
 *      runtime from Context and cached, so renaming the app cannot silently disable
 *      the feature.
 *
 * The former third requirement (App Info marker: force stop / storage / …) has been
 * removed because the uninstall-confirm dialog shown by packageinstaller never
 * contains those markers, causing 100% miss rate for that flow.
 *
 * Packages watched:
 *   com.android.settings               — App Info page
 *   com.android.packageinstaller       — AOSP uninstall confirm
 *   com.google.android.packageinstaller — Pixel / GMS uninstall confirm
 *   com.samsung.android.packageinstaller — Samsung uninstall confirm
 *   com.android.vending                — Play Store uninstall
 *
 * com.Break is explicitly excluded: Customize contains the word "uninstall" and
 * would otherwise self-trigger.
 *
 * BFS is bounded to MAX_NODES and recycles every child node to prevent leaks.
 *
 * Log filter: adb logcat -s REELS_WATCH | findstr "UNINSTALL_WATCH"
 */
public class UninstallScreenDetector {

    private static final String TAG = "REELS_WATCH";

    // BFS cap — prevents OOM on dense OEM Settings accessibility trees
    private static final int MAX_NODES = 800;

    /** Packages whose accessibility events trigger an uninstall-screen scan. */
    private static final String[] WATCH_PACKAGES = {
            "com.android.settings",
            "com.android.packageinstaller",
            "com.google.android.packageinstaller",
            "com.samsung.android.packageinstaller",
            "com.android.vending",
    };

    // App Info markers retained only for optional debug logging (no longer required).
    private static final String[] APP_INFO_MARKERS = {
            "force stop",
            "storage",
            "notifications",
            "app info",
            "open by default",
            "permissions",
    };

    // Lowercased identity tokens for this app (launcher label + package id), resolved
    // once from Context on first use. Volatile: written on the accessibility event
    // thread; a benign duplicate computation on a race is harmless.
    private static volatile String[] identityTokens;

    /**
     * Returns true if {@code packageName} is one of the packages we scan for the
     * uninstall screen. Call this before committing to a full tree scan.
     */
    public static boolean isUninstallWatchPackage(String packageName) {
        if (packageName == null) return false;
        for (String p : WATCH_PACKAGES) {
            if (p.equals(packageName)) return true;
        }
        return false;
    }

    /**
     * Scans ALL interactive windows visible in the given window list (from
     * {@code getWindows()}) for a Break uninstall screen.  Returns true as soon
     * as one window matches.
     *
     * @param ctx     used to resolve identity tokens
     * @param windows list from AccessibilityService.getWindows(); may be null/empty
     */
    public static boolean isOnBreakUninstallScreen(Context ctx,
            List<AccessibilityWindowInfo> windows) {
        if (ctx == null || windows == null || windows.isEmpty()) return false;
        String[] identity = resolveIdentityTokens(ctx);
        for (AccessibilityWindowInfo win : windows) {
            if (win == null) continue;
            AccessibilityNodeInfo root = win.getRoot();
            if (root == null) continue;
            boolean hit = scanRoot(root, identity);
            root.recycle();
            if (hit) return true;
        }
        return false;
    }

    /**
     * Scans a single accessibility tree root.  Kept package-private for unit tests;
     * production code should prefer the window-list overload above.
     *
     * @param root     root node (caller owns its lifecycle — this method does NOT recycle it)
     * @param identity lowercased identity tokens from {@link #resolveIdentityTokens}
     */
    static boolean scanRoot(AccessibilityNodeInfo root, String[] identity) {
        if (root == null || identity == null) return false;

        boolean hasIdentity = false;
        boolean hasUninstall = false;
        boolean hasAppInfoMarker = false;

        Deque<AccessibilityNodeInfo> queue = new ArrayDeque<>();
        queue.add(root);
        int visited = 0;

        while (!queue.isEmpty() && visited < MAX_NODES) {
            AccessibilityNodeInfo node = queue.poll();
            visited++;

            String text = collectText(node);
            if (!text.isEmpty()) {
                if (!hasIdentity) {
                    for (String token : identity) {
                        if (matchesIdentity(text, token)) {
                            hasIdentity = true;
                            Log.d(TAG, "[UNINSTALL_WATCH] Found app identity '" + token
                                    + "' in node text='" + text + "'");
                            break;
                        }
                    }
                }
                if (!hasUninstall && text.contains("uninstall")) {
                    hasUninstall = true;
                    Log.d(TAG, "[UNINSTALL_WATCH] Found 'uninstall' in node text='" + text + "'");
                }
                if (!hasAppInfoMarker) {
                    for (String marker : APP_INFO_MARKERS) {
                        if (text.contains(marker)) {
                            hasAppInfoMarker = true;
                            Log.d(TAG, "[UNINSTALL_WATCH] Found App Info marker '" + marker
                                    + "' in text='" + text + "'");
                            break;
                        }
                    }
                }
            }

            // Short-circuit once both required signals are found
            if (hasIdentity && hasUninstall) break;

            int childCount = node.getChildCount();
            for (int i = 0; i < childCount; i++) {
                AccessibilityNodeInfo child = node.getChild(i);
                if (child != null) queue.add(child);
            }

            // Recycle interior nodes (not the root — caller owns that).
            if (node != root) {
                node.recycle();
            }
        }

        boolean detected = hasIdentity && hasUninstall;
        Log.d(TAG, "[UNINSTALL_WATCH] scan complete visited=" + visited
                + " hasIdentity=" + hasIdentity
                + " hasUninstall=" + hasUninstall
                + " hasAppInfoMarker=" + hasAppInfoMarker
                + " -> detected=" + detected);
        return detected;
    }

    /**
     * Pure text-list overload for JVM unit tests — no Android dependencies.
     *
     * @param nodeTexts lowercased strings gathered from accessibility nodes
     * @param identity  tokens from {@link #buildIdentityTokens(String, String)}
     * @return true if the list contains both an identity token and "uninstall"
     */
    public static boolean matchesScreen(List<String> nodeTexts, String[] identity) {
        boolean hasIdentity = false;
        boolean hasUninstall = false;
        for (String text : nodeTexts) {
            if (text == null) continue;
            if (!hasIdentity) {
                for (String token : identity) {
                    if (matchesIdentity(text, token)) {
                        hasIdentity = true;
                        break;
                    }
                }
            }
            if (!hasUninstall && text.contains("uninstall")) {
                hasUninstall = true;
            }
            if (hasIdentity && hasUninstall) return true;
        }
        return false;
    }

    /**
     * Builds identity tokens from explicit strings — used by tests to avoid
     * needing a real Context/PackageManager.
     *
     * @param label  lowercased launcher label (may be null)
     * @param pkg    lowercased package id
     */
    public static String[] buildIdentityTokens(String label, String pkg) {
        if (label == null || label.isEmpty() || label.equals(pkg)) {
            return new String[] { pkg };
        }
        return new String[] { label, pkg };
    }

    // ─── Internal helpers ────────────────────────────────────────────────────

    /**
     * Resolves this app's lowercased identity tokens: launcher label and package
     * id.  Result is cached for the process lifetime.
     */
    public static String[] resolveIdentityTokens(Context ctx) {
        String[] cached = identityTokens;
        if (cached != null) return cached;

        String pkg = ctx.getPackageName().toLowerCase();
        String label = null;
        try {
            PackageManager pm = ctx.getPackageManager();
            CharSequence raw = ctx.getApplicationInfo().loadLabel(pm);
            if (raw != null && raw.length() > 0) label = raw.toString().trim().toLowerCase();
        } catch (Exception e) {
            Log.w(TAG, "[UNINSTALL_WATCH] loadLabel failed, falling back to package id", e);
        }

        String[] tokens = buildIdentityTokens(label, pkg);
        Log.d(TAG, "[UNINSTALL_WATCH] app identity tokens=" + java.util.Arrays.toString(tokens));
        identityTokens = tokens;
        return tokens;
    }

    /**
     * Returns true if {@code text} contains {@code token} as an identity match.
     *
     * For the launcher label we use a word-boundary check to avoid false positives
     * (e.g. "breakfast" should not match the label "break"). The package id is a
     * literal substring — package ids are unique and dotted, so partial matches
     * are harmless.
     *
     * Both {@code text} and {@code token} are expected to be lowercased already.
     */
    private static boolean matchesIdentity(String text, String token) {
        if (!text.contains(token)) return false;
        // Package ids contain dots — treat as literal substring (no boundary needed).
        if (token.contains(".")) return true;
        // Label: verify word boundary on both sides.
        int idx = text.indexOf(token);
        while (idx >= 0) {
            boolean leftOk = (idx == 0 || !Character.isLetterOrDigit(text.charAt(idx - 1)));
            boolean rightOk = (idx + token.length() >= text.length()
                    || !Character.isLetterOrDigit(text.charAt(idx + token.length())));
            if (leftOk && rightOk) return true;
            idx = text.indexOf(token, idx + 1);
        }
        return false;
    }

    /** Collects text and content description from a node into a single lowercased string. */
    private static String collectText(AccessibilityNodeInfo node) {
        StringBuilder sb = new StringBuilder();
        CharSequence text = node.getText();
        if (text != null) sb.append(text);
        CharSequence desc = node.getContentDescription();
        if (desc != null) {
            if (sb.length() > 0) sb.append(' ');
            sb.append(desc);
        }
        return sb.toString().toLowerCase();
    }
}
