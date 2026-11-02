package com.Break;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.assertFalse;

import org.junit.Test;

/**
 * Pure JVM tests for search-query blocking and Reddit conditional matching.
 * No Android dependencies.
 */
public class BrowserBarContentFilterTest {

    // ── Reddit: host predicate ────────────────────────────────────────────────

    @Test
    public void redditHost_standardSubdomains() {
        assertTrue(BlockedSearch.isRedditHost("reddit.com"));
        assertTrue(BlockedSearch.isRedditHost("www.reddit.com"));
        assertTrue(BlockedSearch.isRedditHost("old.reddit.com"));
        assertTrue(BlockedSearch.isRedditHost("np.reddit.com"));
        assertTrue(BlockedSearch.isRedditHost("redd.it"));
    }

    @Test
    public void redditHost_nonReddit() {
        assertNull(BlockedSearch.matchRedditUrl("https://www.google.com/search?q=porn"));
        assertNull(BlockedSearch.matchRedditUrl("https://pornhub.com/"));
    }

    // ── Reddit: allow benign URLs ─────────────────────────────────────────────

    @Test
    public void reddit_allowHomePage() {
        assertNull(BlockedSearch.matchRedditUrl("https://www.reddit.com/"));
        assertNull(BlockedSearch.matchRedditUrl("reddit.com"));
        assertNull(BlockedSearch.matchRedditUrl("https://old.reddit.com/"));
    }

    @Test
    public void reddit_allowBenignSubreddits() {
        assertNull(BlockedSearch.matchRedditUrl("https://www.reddit.com/r/technology"));
        assertNull(BlockedSearch.matchRedditUrl("https://old.reddit.com/r/programming"));
        assertNull(BlockedSearch.matchRedditUrl("https://reddit.com/r/androiddev/"));
        assertNull(BlockedSearch.matchRedditUrl("https://reddit.com/r/AskReddit"));
    }

    @Test
    public void reddit_allowBenignSearchQueries() {
        assertNull(BlockedSearch.matchRedditUrl("https://www.reddit.com/search/?q=best+pizza+recipe"));
        assertNull(BlockedSearch.matchRedditUrl("https://reddit.com/search/?q=javascript+tutorial"));
    }

    // ── Reddit: block restricted subreddits ───────────────────────────────────

    @Test
    public void reddit_blockNsfwSubreddit() {
        assertEquals("Reddit: nsfw", BlockedSearch.matchRedditUrl("https://reddit.com/r/nsfw"));
        assertEquals("Reddit: nsfw", BlockedSearch.matchRedditUrl("https://www.reddit.com/r/nsfw/"));
        assertEquals("Reddit: nsfw", BlockedSearch.matchRedditUrl("https://old.reddit.com/r/nsfw/"));
    }

    @Test
    public void reddit_blockPornSubreddit() {
        assertEquals("Reddit: porn", BlockedSearch.matchRedditUrl("https://reddit.com/r/porn"));
        assertEquals("Reddit: porn", BlockedSearch.matchRedditUrl("https://reddit.com/r/gonewild+porn"));
    }

    @Test
    public void reddit_blockHentaiSubreddit() {
        assertEquals("Reddit: hentai", BlockedSearch.matchRedditUrl("https://reddit.com/r/hentai"));
    }

    // ── Reddit: block restricted search queries ───────────────────────────────

    @Test
    public void reddit_blockSiteSearchPorn() {
        assertEquals("Reddit search: porn",
                BlockedSearch.matchRedditUrl("https://reddit.com/search/?q=porn"));
        assertEquals("Reddit search: porn",
                BlockedSearch.matchRedditUrl("https://www.reddit.com/search/?q=free+porn"));
    }

    @Test
    public void reddit_blockSiteSearchSex() {
        assertEquals("Reddit search: sex",
                BlockedSearch.matchRedditUrl("https://reddit.com/search/?q=sex"));
        assertEquals("Reddit search: nude",
                BlockedSearch.matchRedditUrl("https://old.reddit.com/search/?q=nude+pics"));
    }

    @Test
    public void reddit_blockSiteSearchEncodedQuery() {
        assertEquals("Reddit search: porn",
                BlockedSearch.matchRedditUrl("https://reddit.com/search/?q=free%20porn%20videos"));
    }

    // ── Reddit: block post-title slugs ────────────────────────────────────────

    @Test
    public void reddit_blockPostTitleSlug() {
        // /r/<sub>/comments/<id>/<slug>
        assertEquals("Reddit post: porn",
                BlockedSearch.matchRedditUrl(
                        "https://reddit.com/r/videos/comments/abc123/some_porn_video_title/"));
        assertEquals("Reddit post: nsfw",
                BlockedSearch.matchRedditUrl(
                        "https://reddit.com/r/all/comments/xyz789/nsfw_content_here/"));
    }

    @Test
    public void reddit_allowBenignPostTitleSlug() {
        assertNull(BlockedSearch.matchRedditUrl(
                "https://reddit.com/r/technology/comments/abc123/cool_new_gadget_review/"));
    }

    // ── Regression: existing Google/engine search tests still pass ────────────

    @Test
    public void regression_googleSearchPorn() {
        assertEquals("Google search: porn",
                BlockedSearch.match("https://www.google.com/search?q=porn"));
    }

    @Test
    public void regression_googleAllowBenign() {
        assertNull(BlockedSearch.match("https://www.google.com/search?q=best+pizza+recipe"));
    }

    @Test
    public void regression_reddit_notInBlockedDomainsBlanket() {
        // matchRedditUrl for a benign URL must return null (no blanket block)
        assertNull(BlockedSearch.matchRedditUrl("https://reddit.com/r/technology"));
        // match() should NOT flag reddit.com home as a blocked domain (it was removed)
        assertNull(BlockedSearch.match("https://reddit.com/"));
    }

    @Test
    public void googleSearch_porn() {
        assertEquals("Google search: porn",
                BlockedSearch.match(
                        "https://www.google.com/search?q=porn"));
    }

    @Test
    public void googleSearch_sexPhraseAndEncoding() {
        assertEquals("Google search: sex",
                BlockedSearch.match(
                        "https://www.google.com/search?q=how+to+have+sex"));
        assertEquals("Google search: porn",
                BlockedSearch.match(
                        "https://www.google.co.uk/search?q=free%20porn"));
        assertEquals("Google search: hentai",
                BlockedSearch.match(
                        "google.de/search?q=Hentai"));
    }

    @Test
    public void googleSearch_siteNameAndOnlyFans() {
        assertEquals("Google search: porn",
                BlockedSearch.match(
                        "https://www.google.com/search?q=pornhub"));
        assertEquals("Google search: only fans",
                BlockedSearch.match(
                        "https://www.google.com/search?hl=en&q=only+fans"));
    }

    @Test
    public void googleSearch_adjacentWords() {
        assertEquals("Google search: nude",
                BlockedSearch.match(
                        "https://www.google.com/search?q=nude+pics"));
        assertEquals("Google search: nsfw",
                BlockedSearch.match(
                        "https://www.google.com/search?q=nsfw"));
        assertEquals("Google search: xxx",
                BlockedSearch.match(
                        "https://www.google.com/search?q=xxx"));
        assertEquals("Google search: xvideos",
                BlockedSearch.match(
                        "https://www.google.co.jp/search?q=xvideos"));
    }

    @Test
    public void googleSearch_allowsOrdinaryAndLookalikeWords() {
        assertNull(BlockedSearch.match(
                "https://www.google.com/search?q=best+pizza+recipe"));
        assertNull(BlockedSearch.match(
                "https://www.google.com/search?q=Essex+weather"));
        assertNull(BlockedSearch.match(
                "https://www.google.com/search?q=unisex+watch"));
        assertNull(BlockedSearch.match(
                "https://www.google.com/search?q=sexual+health"));
        assertNull(BlockedSearch.match(
                "https://www.google.com/search?q=analysis+of+poems"));
        assertNull(BlockedSearch.match(
                "https://www.google.com/search?q=document+camera"));
        assertNull(BlockedSearch.match(
                "https://www.google.com/search?q=cocktail+recipes"));
        assertNull(BlockedSearch.match(
                "https://www.google.com/search?q=dictionary"));
        assertNull(BlockedSearch.match(
                "https://www.google.com/search?q=javascript+tutorial"));
        assertNull(BlockedSearch.match(
                "https://www.google.com/search?q=sextant+navigation"));
    }

    @Test
    public void googleSearch_ignoresNonSearchGoogleUrls() {
        assertNull(BlockedSearch.match(
                "https://www.google.com/maps?q=porn"));
        assertNull(BlockedSearch.match(
                "https://mail.google.com/mail/u/0/"));
        assertNull(BlockedSearch.match(
                "https://docs.google.com/document/d/abc"));
        assertNull(BlockedSearch.match(
                "https://en.wikipedia.org/wiki/Sex"));
    }

    @Test
    public void otherEngines_blockedQueries() {
        assertEquals("Bing search: nude",
                BlockedSearch.match(
                        "https://www.bing.com/search?q=nude"));
        assertEquals("DuckDuckGo search: porn",
                BlockedSearch.match(
                        "https://duckduckgo.com/?q=porn"));
        assertEquals("Yahoo search: xxx",
                BlockedSearch.match(
                        "https://search.yahoo.com/search?p=xxx"));
        assertEquals("Brave search: sex",
                BlockedSearch.match(
                        "https://search.brave.com/search?q=sex"));
    }

    @Test
    public void omniboxQueryWithoutUrl() {
        assertEquals("Search: porn",
                BlockedSearch.match("porn videos"));
        assertEquals("Search: sex",
                BlockedSearch.match("Sex"));
        assertNull(BlockedSearch.match("how to bake bread"));
        assertNull(BlockedSearch.match("essex weather"));
    }

    @Test
    public void emptyInputs() {
        assertNull(BlockedSearch.match(null));
        assertNull(BlockedSearch.match(""));
        assertNull(BlockedSearch.match("   "));
        assertNull(BlockedSearch.match(
                "https://www.google.com/search?q="));
    }
}
