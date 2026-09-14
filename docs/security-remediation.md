# Security remediation coverage

This patch is based on main version 1.2.14 and accounts for the 42 reports reviewed on 2026-09-14: 40 open reports and two already closed reports. Several reports share a root cause; some describe compatibility or data-integrity bugs rather than exploitable vulnerabilities. The table keeps every report traceable without treating duplicate reports as independent vulnerabilities.

## User-visible changes

- Normal chat, model selection, local note links, supported images, and Apply remain available. Code blocks are highlighted, but previews do not execute Dataview, Tasks, custom Markdown processors, embedded HTML, or automatic images. Obsidian-specific formatting such as math and callouts may display as source text or ordinary quotes. Users can open the original note for its full Obsidian rendering.
- Individual previews read at most 1 MiB and display at most 200,000 Markdown characters. Image attachments accept PNG/JPEG/GIF/WebP, at most five images, 10 MiB each, and 25 MiB total per message. Unsupported or oversized input receives an explanation instead of being read without a limit.
- Automatic website reads accept public HTTP(S) addresses only. Localhost, private-network destinations, non-public DNS answers, and redirects to them are blocked. Desktop URL content is capped at 1 MiB with a 15-second deadline; citation titles at 64 KiB. A blocked citation retains its link. Mobile users can open links or paste content, but automatic URL attachment/transcript reads require desktop because the mobile transport cannot enforce DNS pinning and redirect/body controls.
- Preparing one request, including missing historical prompts, can fetch at most 10 URL attachments and collect at most 5 MiB of website text. Automatic citation-title lookup is limited to 10 new URLs per response-generation run and a 256-entry cache; remaining citations retain clickable links.
- YouTube page reads are capped at 2 MiB and transcript responses at 5 MiB/25,000 entries. Voyage responses are capped at 256 KiB with a 30-second deadline. Stop also cancels preparation and indexing; it cannot retract data already sent before cancellation.
- A first query may rebuild old index entries whose completeness cannot be established. Only the requested scope is rebuilt. Failed files remain eligible for retry, and excluded files cannot be retrieved from old vectors.
- Without usable Obsidian 1.11.5+ SecretStorage, credentials remain in memory for the current session. Settings show this status; restarting may require reconnecting. Existing secure-store readback and unresolved-reference safeguards are retained. If the settings file cannot be saved, its previous contents are preserved and the UI reports "Needs attention"; removing legacy plaintext then requires restoring write access and retrying.
- Previously configured tool limits and disabled states are enforced during execution. A request that reaches a limit requires the existing Continue action rather than gaining extra MCP rounds from CLI settings.

## Report-by-report disposition

The suffix in parentheses is the beginning of the original report ID.

| # | Report | Resolution in this patch |
| --- | --- | --- |
| 1 | Enabling CLI silently bypasses the MCP auto-request limit (153ff067) | MCP and CLI execution use independent budgets; enabling CLI cannot raise the MCP limit. |
| 2 | DeepSeek can execute MCP tools after tools are disabled (f8fe7d64) | Only tool names advertised for the current response can run, with a fresh availability check at execution. |
| 3 | Template editing enables arbitrary JSON file overwrite (01d99de6) | Record IDs, file paths, and body/filename identity are validated before reading or modifying templates. |
| 4 | Disabled MCP tools can still auto-execute model requests (315f842a) | Global, server, and per-tool enablement is rechecked for both automatic and manually approved execution. |
| 5 | Untrusted model output reaches Obsidian Markdown processors (e3502349) | Untrusted Markdown uses the restricted React renderer without Obsidian plugin processors or automatic image loads. |
| 6 | LLM Markdown preview can invoke privileged plugin processors (ececbd7d) | Proposed-block previews use the same restricted renderer as assistant text. |
| 7 | Groq selections are migrated to OpenAI without consent (8c151782) | Legacy Groq selections stay on Groq through the complete settings migration chain. |
| 8 | Include allowlist leaves old note vectors searchable (1ae885f3) | Index updates purge excluded/deleted paths; retrieval independently filters against current include/exclude settings. |
| 9 | All-files exclusion is lost across restart (e4e4987f) | Index mutations are persisted even when no files remain to embed. |
| 10 | URL mentions enable full-response SSRF from Obsidian (3e544904) | URL attachments resolve and pin a public IP, revalidate every redirect, and bound request time and body size. |
| 11 | Unbounded mention previews can freeze Obsidian (36596b46) | Preview reads reject files over 1 MiB; rendered Markdown is capped at 200,000 characters. |
| 12 | Scoped RAG silently uploads the entire vault to OpenAI (475a3306) | A scoped RAG query indexes only the selected files/folders and honors global exclusions. |
| 13 | Forged pasted mentions can attach arbitrary vault files (fb991658) | External HTML cannot deserialize privileged mention attributes into file, vault, or URL attachments. |
| 14 | Lockfile rewrite removes integrity checks from dependencies (e4ab8577) | All 1,006 lockfile packages have registry integrity hashes; 688 missing entries were restored without changing versions. |
| 15 | Unbounded Voyage responses can exhaust Obsidian memory (10607682) | Voyage response streaming stops at 256 KiB or 30 seconds and honors cancellation before JSON parsing. |
| 16 | Invalid callbacks terminate the Gemini OAuth listener (a12db80b) | Invalid/missing OAuth state returns HTTP 400 without terminating the legitimate pending login (Gemini and Codex). |
| 17 | Model migration can silently redirect prompts to another provider (841a6be5) | The shared migration helper preserves colliding custom model routing, including schema 10 to 11. |
| 18 | Markdown previews activate untrusted vault content (a878feae) | Vault previews use the restricted renderer without executing vault-defined/plugin Markdown processors. |
| 19 | Model-supplied citations trigger unrestricted SSRF (b4bec1b5) | Automatic citation-title requests use the public-IP, redirect, deadline, and size checks; failure leaves the link usable. |
| 20 | Migration silently reroutes colliding custom models to Gemini (5733fd85) | Schema 6 to 7 preserves the provider of a custom Gemini-name collision. |
| 21 | Migrated chat IDs permit path traversal on JSON creation (dbf1dfa4) | Legacy chat IDs and destination paths are validated; invalid legacy records are skipped individually. |
| 22 | Migration silently reroutes custom Claude 3.7 prompts (1575d059) | Schema 3 to 4 preserves the provider of a custom Claude-name collision. |
| 23 | Unbounded image attachments can exhaust memory and vault storage (075f2274) | Image input is checked before full reads, with per-image/count/total limits and supported raster signatures. |
| 24 | Stop button leaves prompt preparation and RAG uploads running (a8c12c6e) | The active request controller covers initial prompt preparation, URL/transcript requests, RAG, embeddings, and generation. |
| 25 | Synced template records are deserialized without validation (fa0d1fe9) | Stored templates are validated before Lexical deserialization; unsupported nodes/fields and oversized trees are rejected. |
| 26 | Unbounded YouTube transcripts can exhaust Obsidian resources (c097fcf5) | YouTube page/transcript responses and transcript expansion have explicit size limits and cancellation. |
| 27 | Serialized mention styles enable stored CSS injection (57cbb931) | Serialized text/mention styles are cleared; mention formatting is reconstructed from trusted code. |
| 28 | Voyage responses can exhaust memory or stall vault indexing (b87fe2eb) | Same Voyage transport fix as finding 15; vector shape and finite values remain validated. |
| 29 | V8 migration silently reroutes colliding custom models (6747ce56) | Schema 7 to 8 preserves custom model/provider routing instead of replacing collisions with OpenAI defaults. |
| 30 | Migration silently reroutes custom o3-mini prompts to OpenAI (617c3ad1) | The standalone schema 5 to 6 o3-mini insertion preserves colliding custom routing. |
| 31 | Failed chunks are silently omitted from future RAG searches (93ae8c19) | A file is committed atomically only after every chunk succeeds; completeness metadata also invalidates old partial rows within the requested scope. |
| 32 | Migration can redirect custom local models to cloud providers (fcb7e167) | Schema 2 to 3 preserves custom routing; existing provider API-key checks remain in place. |
| 33 | Rejected disable leaves active model looking disabled (0f2b92ec) | The native toggle reapplies its controlled value after every render, including a rejected true-to-true disable attempt. |
| 34 | Apply sends OpenAI-only prediction to incompatible endpoints (2797681e) | OpenAI prediction is sent only to supported model IDs at the official OpenAI endpoint; compatible endpoints use ordinary Apply. |
| 35 | Malformed similarity score can crash the chat view (a5a6b9ed) | Stored similarity data is validated and the renderer independently ignores non-finite scores. |
| 36 | Migration silently reroutes a Groq apply model to OpenAI (6f7c9e55) | The old llama3-8b-8192 Apply selection is retained as a Groq model through migration. |
| 37 | Teardown can discard an in-progress vector index update (a6857a45) | Index mutations, final persistence, and database shutdown are ordered; unload cancels indexing and prevents late initialization. |
| 38 | Debounced autosave can resurrect deleted sensitive chats (7f86c851) | Deletion cancels queued autosaves and waits for in-flight writes; tombstones prevent stale callbacks from recreating the chat. |
| 39 | Tag rename breaks Apply for stored chat suggestions (c72cf8b6) | The Apply parser accepts current and historical smtcmp_block, smtcmpBlock, and smtcmpblock tags. |
| 40 | Mutable GitHub Actions can compromise release artifacts (92309fd3) | Actions are pinned to verified commit SHAs, checkout credentials are not persisted, and workflow token permissions are explicit. |
| 41 | OAuth refresh tokens are persisted in plaintext settings (f2a7cd4c) | Previously closed finding: fallback credentials are now session-only; new plaintext API keys/OAuth tokens are never written to settings. |
| 42 | Unchecked fuzzy-search key scores can crash mention lookup (be7c81e2) | Previously closed false positive: regression tests exercise real fuzzysort for missing-name and path-only matches. No production workaround was added. |

## Verification and completion criteria

Regression coverage exercises disabled/unadvertised tools and separate budgets; bad OAuth callbacks followed by valid login; traversal and mismatched JSON IDs; deletion during pending/in-flight autosaves; custom model collisions through legacy migrations; secret-storage fallback and concurrency; public/private IPs, redirects, stalled/oversized responses and cancellation; serialized editor input and images; scoped/stale/partial indexing and shutdown; legacy Apply tags; prediction compatibility; and the reported fuzzy-search false positive.

The lockfile was installed in an isolated directory using npm ci, verifying registry downloads against the restored hashes without changing dependency versions. The release-version script was exercised in a separate directory to verify that manifest, package, and lockfile versions stay aligned. An additional smoke check used the actual bundled Markdown renderer with a simulated host context and fetched a public HTTPS page through the real HTTP transport; it preserved formatting, blocked active markup, and rejected loopback before connecting. Local checks and the PR's Linux/Windows CI provide code-level validation. No real vault credentials, user-configured MCP commands, or destructive payloads are used in the regression tests.

The security dashboard is external state. This PR does not dismiss reports or claim they are closed before analysis of the merged commit. Completion requires merging the reviewed patch, running the security scan against that exact merged commit, and checking every report above for zero unresolved findings. A report that persists must be investigated against the new code and its regression evidence rather than dismissed solely because a patch exists. Actual Obsidian desktop/mobile visual and network smoke checks remain a separate runtime check from unit tests.
