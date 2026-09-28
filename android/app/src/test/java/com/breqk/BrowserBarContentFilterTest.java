package com.Break;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

/**
 * Pure JVM tests for search-query blocking. No Android dependencies.
 */
public class BrowserBarContentFilterTest {

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
