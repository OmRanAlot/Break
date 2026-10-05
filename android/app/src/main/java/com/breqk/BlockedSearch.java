package com.Break;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/**
 * Detects a browser search for porn, sex, or a porn-adjacent term.
 *
 * <p>The returned label is the matched term only ({@code Google search: porn}), so a reflection
 * does not store the full query. Ordinary lookalikes stay allowed: {@code essex}, {@code analysis},
 * {@code document}, {@code cocktail}, {@code sextant}, {@code sexual health}.
 */
public final class BlockedSearch {

    /**
     * Substrings distinctive enough to match inside a query
     * ({@code pornhub}, {@code pornography}, {@code onlyfans}).
     */
    private static final String[] STEMS = {
            "porn", "hentai", "onlyfans", "xvideos", "xhamster", "xnxx", "rule34",
            "chaturbate", "brazzers", "redtube", "spankbang", "literotica", "faphouse",
            "fansly", "fanvue", "redgifs", "erome", "hanime", "blowjob", "handjob",
            "creampie", "cumshot", "deepthroat", "gangbang", "threesome", "ahegao",
            "stripchat", "bongacams", "livejasmin", "manyvids", "fapello", "imagefap",
            "gelbooru", "danbooru", "sxyprn", "noodlemagazine", "camgirl", "furaffinity",
            "eporner", "pornpics", "youporn", "nhentai", "doujin"
    };

    /** Whole words only. */
    private static final Set<String> WORDS = new HashSet<>(Arrays.asList(
            "sex", "sexy", "sext", "sexting", "nude", "nudes", "nudity", "naked",
            "erotic", "erotica", "lewd", "smut", "milf", "dilf", "gilf", "bdsm",
            "fetish", "orgy", "anal", "boob", "boobs", "tits", "titties", "dick",
            "cock", "pussy", "cum", "penis", "vagina", "clit", "dildo", "vibrator",
            "escort", "hooker", "hookup", "stripper", "jav", "ecchi",
            "fap", "fapping", "softcore", "nsfw", "xxx", "gooning", "r34",
            "loli", "shota", "lolita", "jailbait", "camming", "stepmom", "stepsis",
            "stepbro", "bukkake", "coomer"));

    /** Multi-word queries, matched after punctuation is turned into spaces. */
    private static final String[] PHRASES = {
            "only fans", "rule 34", "strip club", "sex cam", "cam girl", "cam sex",
            "adult video", "adult film", "adult site", "adult content"
    };

    private BlockedSearch() {
    }

    // ── Reddit conditional matching ───────────────────────────────────────────

    /**
     * Returns true if {@code hostLower} is reddit.com or any subdomain of reddit.com
     * (e.g. {@code www.reddit.com}, {@code old.reddit.com}, {@code np.reddit.com}).
     * Also matches the {@code redd.it} short-link host so redirects are covered.
     */
    public static boolean isRedditHost(String hostLower) {
        if (hostLower == null) return false;
        return "reddit.com".equals(hostLower)
                || hostLower.endsWith(".reddit.com")
                || "redd.it".equals(hostLower)
                || hostLower.endsWith(".redd.it");
    }

    /**
     * Checks whether a Reddit URL path/query contains a term from the STEMS, WORDS,
     * or PHRASES lists.
     *
     * <p>Inspects three URL-derived text sources:
     * <ol>
     *   <li>The {@code q} query parameter (Reddit site search).</li>
     *   <li>The first path segment after {@code /r/} (subreddit name).</li>
     *   <li>The first path segment after {@code /comments/{id}/} (post-title slug).</li>
     * </ol>
     *
     * <p>Each source is passed through {@link #matchTerm} with the same STEMS/WORDS/PHRASES.
     * Note: substring STEMS can match inside subreddit names (e.g. {@code unixporn} matches
     * the stem {@code porn}) — this is intentional.
     *
     * @param urlOrHost Raw omnibar text (full URL or bare host).
     * @return A short label like {@code "Reddit: porn"} or {@code "Reddit search: sex"},
     *         or {@code null} if no restricted term is found or the host is not Reddit.
     */
    public static String matchRedditUrl(String urlOrHost) {
        if (urlOrHost == null || urlOrHost.trim().isEmpty()) return null;

        String s = urlOrHost.trim();
        // Normalise to a parseable URL
        if (!s.contains("://")) s = "http://" + s;

        // Parse without android.net.Uri (pure-JVM compatibility for unit tests)
        int schemeEnd = s.indexOf("://");
        String rest = schemeEnd >= 0 ? s.substring(schemeEnd + 3) : s;

        // Strip userinfo
        int at = rest.lastIndexOf('@');
        if (at >= 0) rest = rest.substring(at + 1);

        // Separate host from path?query#fragment
        int slashIdx = rest.indexOf('/');
        int queryIdx = rest.indexOf('?');
        String hostPort;
        String pathAndQuery;
        if (slashIdx >= 0) {
            hostPort = rest.substring(0, slashIdx);
            pathAndQuery = rest.substring(slashIdx);
        } else if (queryIdx >= 0) {
            hostPort = rest.substring(0, queryIdx);
            pathAndQuery = "?" + rest.substring(queryIdx + 1);
        } else {
            hostPort = rest;
            pathAndQuery = "";
        }

        // Strip port
        int bracketEnd = hostPort.indexOf(']');
        String host;
        if (hostPort.startsWith("[") && bracketEnd >= 0) {
            host = hostPort.substring(1, bracketEnd).toLowerCase(Locale.US);
        } else {
            int colon = hostPort.lastIndexOf(':');
            host = (colon > 0 ? hostPort.substring(0, colon) : hostPort).toLowerCase(Locale.US);
        }
        if (!isRedditHost(host)) return null;

        // Strip fragment
        int hashIdx = pathAndQuery.indexOf('#');
        if (hashIdx >= 0) pathAndQuery = pathAndQuery.substring(0, hashIdx);

        // Separate path and query string
        int qMark = pathAndQuery.indexOf('?');
        String path = qMark >= 0 ? pathAndQuery.substring(0, qMark) : pathAndQuery;
        String queryString = qMark >= 0 ? pathAndQuery.substring(qMark + 1) : "";

        // 1. Reddit search: ?q=...
        if (!queryString.isEmpty()) {
            String encoded = firstQueryParam(queryString, "q");
            if (encoded != null && !encoded.isEmpty()) {
                String query = urlDecode(encoded).trim();
                String term = matchTerm(query);
                if (term != null) return "Reddit search: " + term;
            }
        }

        // 2. Subreddit name: /r/<name>
        String subreddit = extractSegmentAfter(path, "/r/");
        if (subreddit != null) {
            String term = matchTerm(subreddit);
            if (term != null) return "Reddit: " + term;
        }

        // 3. Post-title slug: /comments/<id>/<slug>
        String postSlug = extractPostTitleSlug(path);
        if (postSlug != null) {
            // Slugs use hyphens; convert to spaces before matching
            String term = matchTerm(postSlug.replace('-', ' '));
            if (term != null) return "Reddit post: " + term;
        }

        return null;
    }

    /**
     * Returns the path segment immediately after {@code prefix} (stopping at the next
     * {@code /} if present), or {@code null} if the prefix is not in the path.
     */
    private static String extractSegmentAfter(String path, String prefix) {
        if (path == null) return null;
        String lower = path.toLowerCase(Locale.US);
        int idx = lower.indexOf(prefix.toLowerCase(Locale.US));
        if (idx < 0) return null;
        int start = idx + prefix.length();
        if (start >= path.length()) return null;
        int end = path.indexOf('/', start);
        String seg = end >= 0 ? path.substring(start, end) : path.substring(start);
        return seg.isEmpty() ? null : seg;
    }

    /**
     * Extracts the post-title slug (4th path segment) from a Reddit post URL of the form
     * {@code /r/<sub>/comments/<id>/<slug>}.
     * Returns {@code null} if the path does not match that structure.
     */
    private static String extractPostTitleSlug(String path) {
        if (path == null) return null;
        // Normalise lower-case for prefix check
        String lp = path.toLowerCase(Locale.US);
        // Path segments: /r/<sub>/comments/<id>/<slug>[/...]
        int commentsIdx = lp.indexOf("/comments/");
        if (commentsIdx < 0) return null;
        int afterComments = commentsIdx + "/comments/".length();
        // skip <id>
        int nextSlash = path.indexOf('/', afterComments);
        if (nextSlash < 0 || nextSlash + 1 >= path.length()) return null;
        int slugStart = nextSlash + 1;
        int slugEnd = path.indexOf('/', slugStart);
        String slug = slugEnd >= 0 ? path.substring(slugStart, slugEnd) : path.substring(slugStart);
        return slug.isEmpty() ? null : slug;
    }

    /**
     * @return a short rule label, or null when the text is not a restricted search
     */
    public static String match(String urlOrHost) {
        if (urlOrHost == null)
            return null;
        String trimmed = urlOrHost.trim();
        if (trimmed.isEmpty())
            return null;

        ParsedSearch parsed = parseSearchUrl(trimmed);
        if (parsed != null) {
            String term = matchTerm(parsed.query);
            if (term == null)
                return null;
            return parsed.label + " search: " + term;
        }

        if (looksLikeNavigatedUrl(trimmed))
            return null;
        String bare = matchTerm(trimmed);
        if (bare == null)
            return null;
        return "Search: " + bare;
    }

    /** Omnibox text that is a committed query rather than a URL. */
    static boolean isBareBlockedQuery(String text) {
        if (text == null)
            return false;
        String trimmed = text.trim();
        if (trimmed.isEmpty() || trimmed.length() > 180)
            return false;
        if (trimmed.indexOf('\n') >= 0 || trimmed.indexOf('\r') >= 0)
            return false;
        if (looksLikeNavigatedUrl(trimmed))
            return false;
        return matchTerm(trimmed) != null;
    }

    private static boolean looksLikeNavigatedUrl(String text) {
        if (text.contains("://"))
            return true;
        if (text.indexOf('\n') >= 0 || text.indexOf('\r') >= 0 || text.indexOf(' ') >= 0)
            return false;
        int slash = text.indexOf('/');
        String hostPart = slash >= 0 ? text.substring(0, slash) : text;
        int question = hostPart.indexOf('?');
        if (question >= 0)
            hostPart = hostPart.substring(0, question);
        return hostPart.indexOf('.') > 0;
    }

    private static final class ParsedSearch {
        final String label;
        final String query;

        ParsedSearch(String label, String query) {
            this.label = label;
            this.query = query;
        }
    }

    private static ParsedSearch parseSearchUrl(String raw) {
        String s = raw.trim();
        int scheme = s.indexOf("://");
        if (scheme >= 0)
            s = s.substring(scheme + 3);
        if (s.isEmpty())
            return null;

        int pathStart = s.indexOf('/');
        int queryStart = s.indexOf('?');
        String hostPort;
        String pathAndQuery;
        if (pathStart >= 0) {
            hostPort = s.substring(0, pathStart);
            pathAndQuery = s.substring(pathStart);
        } else if (queryStart >= 0) {
            hostPort = s.substring(0, queryStart);
            pathAndQuery = "/" + s.substring(queryStart);
        } else {
            return null;
        }

        int at = hostPort.lastIndexOf('@');
        if (at >= 0)
            hostPort = hostPort.substring(at + 1);
        String host = stripPort(hostPort).toLowerCase(Locale.US);
        if (host.startsWith("www."))
            host = host.substring(4);
        if (host.isEmpty())
            return null;

        int hash = pathAndQuery.indexOf('#');
        if (hash >= 0)
            pathAndQuery = pathAndQuery.substring(0, hash);
        int qMark = pathAndQuery.indexOf('?');
        String path = qMark >= 0 ? pathAndQuery.substring(0, qMark) : pathAndQuery;
        String queryString = qMark >= 0 ? pathAndQuery.substring(qMark + 1) : "";
        if (path.isEmpty())
            path = "/";

        String[] params = searchParamsFor(host, path);
        String label = searchEngineLabel(host);
        if (params == null || label == null || queryString.isEmpty())
            return null;

        String encoded = null;
        for (String param : params) {
            encoded = firstQueryParam(queryString, param);
            if (encoded != null && !encoded.isEmpty())
                break;
            encoded = null;
        }
        if (encoded == null)
            return null;
        String query = urlDecode(encoded).trim();
        if (query.isEmpty())
            return null;
        return new ParsedSearch(label, query);
    }

    private static String stripPort(String hostPort) {
        if (hostPort.startsWith("[")) {
            int end = hostPort.indexOf(']');
            if (end >= 0)
                return hostPort.substring(1, end);
        }
        int colon = hostPort.lastIndexOf(':');
        if (colon > 0)
            return hostPort.substring(0, colon);
        return hostPort;
    }

    private static String[] searchParamsFor(String host, String path) {
        if (isGoogleSearchHost(host)) {
            if ("/search".equals(path) || path.startsWith("/search/") || "/webhp".equals(path))
                return new String[] { "q" };
            return null;
        }
        if ("bing.com".equals(host) || host.endsWith(".bing.com")) {
            if (path.contains("/search"))
                return new String[] { "q" };
            return null;
        }
        if ("duckduckgo.com".equals(host) || host.endsWith(".duckduckgo.com")) {
            if ("/".equals(path) || path.startsWith("/html") || path.contains("search"))
                return new String[] { "q" };
            return null;
        }
        if ("search.yahoo.com".equals(host))
            return new String[] { "p", "q" };
        if ("search.brave.com".equals(host)) {
            if (path.contains("/search"))
                return new String[] { "q" };
            return null;
        }
        if ("ecosia.org".equals(host) || host.endsWith(".ecosia.org")) {
            if (path.contains("/search"))
                return new String[] { "q" };
            return null;
        }
        if (host.startsWith("yandex.") || "ya.ru".equals(host)) {
            if (path.contains("/search"))
                return new String[] { "text" };
            return null;
        }
        if ("startpage.com".equals(host) || host.endsWith(".startpage.com")) {
            if (path.contains("search"))
                return new String[] { "query", "q" };
            return null;
        }
        if ("qwant.com".equals(host) || host.endsWith(".qwant.com")) {
            if ("/".equals(path) || path.contains("search"))
                return new String[] { "q" };
            return null;
        }
        return null;
    }

    private static String searchEngineLabel(String host) {
        if (isGoogleSearchHost(host))
            return "Google";
        if ("bing.com".equals(host) || host.endsWith(".bing.com"))
            return "Bing";
        if ("duckduckgo.com".equals(host) || host.endsWith(".duckduckgo.com"))
            return "DuckDuckGo";
        if ("search.yahoo.com".equals(host))
            return "Yahoo";
        if ("search.brave.com".equals(host))
            return "Brave";
        if ("ecosia.org".equals(host) || host.endsWith(".ecosia.org"))
            return "Ecosia";
        if (host.startsWith("yandex.") || "ya.ru".equals(host))
            return "Yandex";
        if ("startpage.com".equals(host) || host.endsWith(".startpage.com"))
            return "Startpage";
        if ("qwant.com".equals(host) || host.endsWith(".qwant.com"))
            return "Qwant";
        return null;
    }

    private static boolean isGoogleSearchHost(String host) {
        if (!host.startsWith("google."))
            return false;
        String rest = host.substring("google.".length());
        if ("com".equals(rest))
            return true;
        if (rest.startsWith("co.") && rest.length() == 5 && isTwoLetterCountry(rest.substring(3)))
            return true;
        if (rest.startsWith("com.") && rest.length() == 6 && isTwoLetterCountry(rest.substring(4)))
            return true;
        return isTwoLetterCountry(rest);
    }

    private static boolean isTwoLetterCountry(String value) {
        return value.length() == 2
                && isAsciiLetter(value.charAt(0))
                && isAsciiLetter(value.charAt(1));
    }

    private static boolean isAsciiLetter(char c) {
        return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
    }

    private static String firstQueryParam(String queryString, String name) {
        int start = 0;
        while (start <= queryString.length()) {
            int amp = queryString.indexOf('&', start);
            int end = amp >= 0 ? amp : queryString.length();
            String part = queryString.substring(start, end);
            int eq = part.indexOf('=');
            if (eq > 0 && name.equals(part.substring(0, eq)))
                return part.substring(eq + 1);
            if (amp < 0)
                break;
            start = amp + 1;
        }
        return null;
    }

    private static String urlDecode(String value) {
        StringBuilder out = new StringBuilder(value.length());
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (c == '+') {
                out.append(' ');
                continue;
            }
            if (c == '%' && i + 2 < value.length()) {
                int hi = hexDigit(value.charAt(i + 1));
                int lo = hexDigit(value.charAt(i + 2));
                if (hi >= 0 && lo >= 0) {
                    out.append((char) ((hi << 4) | lo));
                    i += 2;
                    continue;
                }
            }
            out.append(c);
        }
        return out.toString();
    }

    private static int hexDigit(char c) {
        if (c >= '0' && c <= '9')
            return c - '0';
        if (c >= 'a' && c <= 'f')
            return c - 'a' + 10;
        if (c >= 'A' && c <= 'F')
            return c - 'A' + 10;
        return -1;
    }

    private static String matchTerm(String query) {
        if (query == null)
            return null;
        String normalized = query.toLowerCase(Locale.US).replaceAll("[^a-z0-9]+", " ").trim();
        if (normalized.isEmpty())
            return null;
        for (String stem : STEMS) {
            if (normalized.contains(stem))
                return stem;
        }
        for (String phrase : PHRASES) {
            if (containsPhrase(normalized, phrase))
                return phrase;
        }
        int start = 0;
        while (start < normalized.length()) {
            int space = normalized.indexOf(' ', start);
            int end = space >= 0 ? space : normalized.length();
            if (end > start) {
                String token = normalized.substring(start, end);
                if (WORDS.contains(token))
                    return token;
            }
            if (space < 0)
                break;
            start = space + 1;
        }
        return null;
    }

    /** Phrase match on word boundaries so {@code sex cam} does not hide inside a longer token. */
    private static boolean containsPhrase(String normalized, String phrase) {
        int from = 0;
        while (from <= normalized.length() - phrase.length()) {
            int i = normalized.indexOf(phrase, from);
            if (i < 0)
                return false;
            boolean startOk = i == 0 || normalized.charAt(i - 1) == ' ';
            int end = i + phrase.length();
            boolean endOk = end == normalized.length() || normalized.charAt(end) == ' ';
            if (startOk && endOk)
                return true;
            from = i + 1;
        }
        return false;
    }
}
