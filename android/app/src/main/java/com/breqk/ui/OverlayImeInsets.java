package com.Break.ui;

import android.view.View;
import android.widget.EditText;
import android.widget.ScrollView;

import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

/**
 * OverlayImeInsets
 * ----------------
 * Keeps content in a WindowManager overlay visible above the soft keyboard.
 *
 * Call {@link #attach(View, ScrollView)} once after the overlay root has been
 * added to the WindowManager. From that point:
 *  - The {@code scrollView}'s bottom padding tracks the IME height so the
 *    overlay content is never hidden behind the keyboard.
 *  - Each {@link EditText} inside {@code scrollView} scrolls into view when it
 *    receives focus.
 *
 * Requirements: the root view must have been added to the window (so inset
 * callbacks fire) before calling this, which means call it after
 * {@code windowManager.addView(root, params)}.
 *
 * Usage:
 * <pre>
 *   windowManager.addView(root, params);
 *   OverlayImeInsets.attach(root, scrollView);
 * </pre>
 */
public final class OverlayImeInsets {

    /** Extra padding below the focused field (dp equivalent, kept in px here). */
    private static final int SCROLL_EXTRA_PX = 64;

    private OverlayImeInsets() {}

    /**
     * Wires IME-aware padding on {@code scrollView} and auto-scroll for every
     * {@link EditText} that is a descendant of it.
     *
     * @param root       the root view that was added to the WindowManager
     * @param scrollView the scrollable container inside {@code root}
     */
    public static void attach(View root, ScrollView scrollView) {
        if (root == null || scrollView == null) return;

        scrollView.setClipToPadding(false);

        // Apply bottom padding equal to the visible IME + navigation-bar insets
        // whenever the inset state changes (keyboard open/close/resize).
        ViewCompat.setOnApplyWindowInsetsListener(root, (v, insets) -> {
            int imeHeight = insets
                    .getInsets(WindowInsetsCompat.Type.ime()
                            | WindowInsetsCompat.Type.systemBars())
                    .bottom;
            scrollView.setPadding(
                    scrollView.getPaddingLeft(),
                    scrollView.getPaddingTop(),
                    scrollView.getPaddingRight(),
                    imeHeight);
            return insets;
        });

        // For each direct and indirect EditText child, scroll so it is visible
        // above the keyboard when it gains focus.
        attachEditTextScrollListeners(scrollView, scrollView);
    }

    private static void attachEditTextScrollListeners(
            ScrollView scrollView, android.view.ViewGroup group) {
        for (int i = 0; i < group.getChildCount(); i++) {
            View child = group.getChildAt(i);
            if (child instanceof EditText) {
                child.setOnFocusChangeListener((v, hasFocus) -> {
                    if (hasFocus) {
                        scrollView.post(() -> scrollView.smoothScrollTo(
                                0, v.getBottom() + SCROLL_EXTRA_PX));
                    }
                });
            } else if (child instanceof android.view.ViewGroup) {
                attachEditTextScrollListeners(scrollView, (android.view.ViewGroup) child);
            }
        }
    }
}
