# Ruang Kerja v1.0.2 — Phase 4: Live Web, Registry and Time Research

**Status:** Implemented on a feature branch; GitHub Actions CI run #129 passed; awaiting user review  
**Base commit:** \`a590881539e4f5c9f87e2cf253dcd21e786488da\` (Phase 3 merge)  
**Application version:** \`1.0.1\` (not bumped; no public release)

## Goal

Allow the built-in agent to verify changing technical facts rather than depend on model training data alone. Phase 4 adds web discovery, bounded page reading, direct package registry lookups, and a local system-time tool. It does not add a project semantic index or persistent session database.

## Agent tools

### \`search_web\`
- Queries DuckDuckGo's HTML search interface.
- Returns a bounded list of titles, URLs and snippets with retrieval timestamp.
- Search results are discovery hints, not proof. The system prompt tells the model to open relevant official sources and verify important claims.

### \`read_web_page\`
- Reads public HTTPS web pages and extracts a title and readable text.
- Follows at most three redirects, checks DNS results against private/special address ranges before each request, rejects direct IP URLs, credentials, localhost/internal domains and nonstandard ports.
- Only text/HTML-like content is processed. Arbitrary files, PDFs, executable content and media are not downloaded for execution.
- Per-response byte limits, timeouts and output truncation reduce memory/context abuse. Page text is treated as untrusted data, never as an instruction source.

### \`check_package_version\`
Direct registry checks for:
- npm
- PyPI
- crates.io
- Packagist
- RubyGems

Returns the upstream-reported current/latest version field available in that registry, publication/update time when supplied, source URL, optional homepage/repository, and the retrieval timestamp. Results are cached in memory for at most two minutes and the cache is bounded to 100 entries. This data does not automatically prove compatibility with the active project; the agent must still check the official documentation and changelog before recommending an upgrade.

### \`get_current_time\`
- Uses the local system clock and IANA time-zone database.
- Supports an optional explicit zone such as \`Asia/Jakarta\`, \`Europe/London\` or \`UTC\`.
- Returns UTC ISO timestamp, localized display time, sortable local timestamp and UTC offset.
- Does not use web search for time.

## Safety / reliability rules

- All four capabilities are explicit typed tools. The renderer receives no general-purpose Node/network access.
- Web URLs must use HTTPS, pass host checks, and resolve to public addresses. Redirect targets are revalidated. This is a defense-in-depth measure, not a formal guarantee against every possible network-layer/DNS race.
- Model instructions explicitly label search snippets, page text and package descriptions as untrusted external content. The agent must not follow prompt-like instructions found in a webpage.
- User-facing results carry the source URL and retrieval time whenever applicable.
- On search/provider outage, malformed response, timeout, unsupported content or blocked URL, the tool returns an error or explicit no-results message; the model should not invent a current result.
- Web page reading is capped at about 1 MB fetched response and 18,000 extracted characters; search HTML is capped at about 1.5 MB; registry JSON at about 2 MB.

## Tests and CI

GitHub Actions run #129 passed on the initial implementation commit: dependency installation, the combined Agent Runtime test suite, TypeScript typecheck, and application build. Any later code changes will trigger another CI run.

\`npm run test:agent-research\` tests public/private IP classification, URL rejection, search result parsing, HTML text extraction, entity decoding, registry URL construction and timezone handling without relying on live external services.

\`npm run test:agent-runtime\` now includes Todo, terminal, attachments and live-research tests. CI runs this suite followed by TypeScript typecheck and application build.

A green CI run validates unit tests and build integration; it does not guarantee third-party search availability or the exact capabilities of every model/router. Packaged Windows end-to-end verification remains a manual follow-up.

## Not included

Project semantic/symbol indexing, automated docs crawling, OCR, PDF file reading through web URLs, plugin/MCP runtime, external skill installation, persistent chat history/checkpoints/rewind, slash-command picker, model capability discovery, application version bump or public release.
