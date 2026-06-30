# Changelog

All notable changes to CS Navigator are documented here.

## [6.5] - 2026-06-29
### Changed
- Quiz Bank renamed to **Practice Library** across all user-facing copy (mini-nav label, page header, empty workspace states, editor placeholder, run-control tooltips, and chat/action messages). Internal route/component names (`quiz`, `QuizBank.jsx`) are unchanged
- Practice Library top area replaced the four large stat cards with a slim inline progress strip (streak · solved · attempted · % complete) so the problem grid rises into view. The Home dashboard has no stat tiles (replaced in the 6.4 lab redesign); the Progress page keeps the full stat cards
- Practice Library header strengthened: "Practice Library" title + subtitle "Choose a problem by topic, difficulty, or progress."
- Right-side insight panel reworked into a **Practice Guide** (navy heading, accent top rail so it reads as part of the library): Topics in view (chips), Topic progress with clear "Strings: 2/9 solved" labels (top 5 + "Show more" revealing 5 at a time), and contextual Common mistakes. Replaces the old vague "Done strings" copy
- Problem cards rebuilt: brighter/bolder title, smaller muted topic + difficulty tags, a status pill (Not Started / In Progress / Solved) replacing the tiny gray dot, language-availability pills (Py · JS · Java · C++), and a status-aware primary action (Start / Resume / Review) that fills orange on hover. Per-status left-rail accent (slate / orange / green) plus a stronger accent for the recommended problem so the grid is scannable. Tightened spacing and clear hover intent (navy/orange border, lift, action fill)

### Added
- Practice Library search (by problem title or topic) and filters for Difficulty, Topic, and Status (All / Not Started / In Progress / Solved) laid out as one even three-column row under the search bar. Problems group by topic when nothing is filtered and switch to a flat result list when searching or filtering, with section headings ("Arrays · 11 problems" + a "N solved" pill), an empty state when filters match nothing, and removable active-filter chips
- Client-side "Show more" pagination on the problem grid (renders 15 cards at a time, reveals 15 more per click, resets to the first page when filters change) so the grid stays fast as the question bank grows; group headings still show full per-topic totals while only a slice is rendered
- Per-language test-availability pills on cards (Py · JS · Java · C++) with "tests available" / "tests coming later" tooltips, driven by a per-language flag so a runner can be shown as not-ready (e.g. when `ALLOW_COMPILED_RUNNERS=false` gates Java/C++ server-side); all four ship available today
- "Focus next" weakest-topic callout in the Practice Guide: the lowest solved/total topic in view (shown only once the student has at least one solve, so brand-new users aren't shamed)
- Progress strip now sits beside the title on wide screens (filling the empty space) and drops to a full-width row below the title on narrow screens

### Removed
- The Language filter from the Practice Library (all problems support all four languages, so it never narrowed the list)
- Estimated-time on problem cards and the per-difficulty time estimate (no reliable signal; the same call was made for the LeetCode daily card in 6.4)
- "Recommended Next" strip from the Practice Library and "Recommended next" from the Practice Guide — the Home hero already owns "what to do right now," so these duplicated it

## [6.4] - 2026-06-29
### Changed
- Coding Tutor Home redesigned from a "dashboard" into an academic coding lab. The marketing-slogan hero + fake code-preview card were removed in favor of a state-first hero (Welcome back + streak / solved / % complete + one primary action that resumes in-progress work or starts the recommended problem). Removed the duplicate "Recommended" surfaces (it appeared up to three times) and the standalone progress strip (the hero already shows the same stats). Heavy navy panel borders softened to thinner warm accent rails with lighter shadows; the LeetCode daily challenge is now the full-width focal point. "Ask the Tutor" compacted from three tall passive rows into a tight 3-up command row (Generate Quiz · Review Code · Mock Interview). The progress-bar ticks were evened out and the topic-mastery pills got a clean full-width baseline. Re-checked responsive layout for split-screen laptop and mobile (single-column collapse, wrapping hero stats/actions)
- Today's challenge card now accurately reads as a LeetCode problem (kicker "LeetCode Daily Problem", problem number in the title, LeetCode badge) and dropped the misleading flat per-difficulty time estimate (the LeetCode API gives no signal to estimate solve time)

### Added
- "Today's plan" strip under the hero: one concrete, data-driven next step (finish your in-progress problem, solve today's LeetCode daily, or start the recommended problem) instead of generic copy
- Subtle Morgan State CS identity cue in the hero kicker
- Coding Tutor progress bar animated with a flowing blue-dominant gradient + sheen sweep and pulsing glow (gaming-HUD feel)
- Test-case explorer in the workspace terminal: failing cases sort first and are expandable, each with an "Ask the tutor about this case" action that sends just that input/expected/actual to the tutor

### Removed
- The "General" tutor toggle (CS Nav routes non-Morgan questions to general answers on its own; the manual override is gone)
- The new-user landing variant in the Coding Tutor (it caused a flash where the existing-user hero swapped out after progress loaded); one landing now serves everyone

### Fixed
- Coding Tutor scoped "Morgan Coding Lab" theme: the section now reads as a warm academic-lab sub-brand (warm-paper surfaces in light, layered warm-slate in dark) while keeping the Morgan navy / orange / green identity, without affecting Regular Tutor, Admin, Profile, advising, auth, or the app shell (all rules scoped under `.coding-app`). Replaced the Progress momentum tiles' emoji with real icons from the existing `react-icons/fa` set, and warmed the cool-slate shadows on stat tiles and badge cards
- Coding Tutor dark mode tuned: lifted the base canvas off near-black, spread the panel surfaces into distinct elevation steps so they no longer read as one flat slab, and brightened the navy/orange accents, borders, and muted text so they stop looking muddy on the dark slate
- Coding Tutor collapsed sub-nav: the active pill in light mode rendered as a blank filled navy disc (navy icon on navy fill); the active icon now shows white
- Main chat sidebar (navy rail): hovering a chat name, the Install app, Dark mode, and Contact support buttons turned the label navy-on-navy and made the text vanish — a leftover hover rule written for the old white sidebar. Re-asserted the rail's light-on-navy hover so labels stay readable; New Chat and the install/support orange hover are unchanged
- Theme toggle no longer "oozes": light↔dark now swaps instantly instead of cross-fading, so nested panels can't finish their color fade at staggered times (which read as a slow, delayed transition with light-mode remnants). Color transitions are suppressed for the single frame the theme flips; hover transitions are unaffected

## [6.3] - 2026-06-24
### Security
- Hardened the compiled-binary (Java/C++) coding runners for production. Cloud Run's sandbox forbids nsjail / privileged network namespaces, so we added app-level defenses that work there: a best-effort `unshare(CLONE_NEWNET)` network isolation that degrades gracefully when the kernel denies it (the run still proceeds under the other guards), `PR_SET_NO_NEW_PRIVS` to block privilege escalation on exec, a scrubbed child environment (PATH only — no secrets inherited) with blackholed DNS/proxy so a stray socket reaches nothing, and tighter source blocklists (raw `syscall`/`dlopen`/`getenv`/`ptrace`/`mmap`, low-level network/system headers for C++; `System.getenv`/classloaders/`Unsafe`/native methods for Java). Added an `ALLOW_COMPILED_RUNNERS` env flag (default on) to disable Java/C++ entirely in any environment where running native code is unacceptable. Verified 0 false positives across all 120 Java + C++ reference solutions; 24 runner tests pass (full backend suite: 27)

### Changed
- iNav / tutor-mode header is now visually transparent: the secondary bar (iNav model dropdown + CS Nav / General / Coding Tutor toggle) dropped its solid background, border, and shadow so only the controls float over the chat — like the floating chat input. The controls stay fixed in place; the empty parts of the bar no longer block the chat behind them (scroll/selection pass through). A soft backdrop blur is scoped to just the controls chip so the dropdown + pills stay legible when chat text scrolls behind them

### Added
- Daily-challenge streak: practicing the daily challenge now records the day and the Home "day streak" tile shows a real consecutive-day count (counting back from today, or yesterday so an unfinished today doesn't break the streak) instead of a derived guess. The daily card shows a "Done today ✓ · N-day streak 🔥" badge once today is logged. Per-device (localStorage), no backend needed
- Language personalization: the dashboard surfaces the student's most-used language and offers a one-click "Try a <other> problem" that opens the recommended next problem in a language they've used less. Reuses the existing per-language progress data
- Warm empty state for brand-new users: when there's no progress yet (nothing solved/attempted, no saved snippets, no streak), the dashboard shows a friendly "Let's solve your first problem" hero with a one-click start on a beginner-friendly problem, plus shortcuts to the Quiz Bank and a blank workspace — instead of empty zero-value stat tiles

## [6.2] - 2026-06-23
### Added
- Conjoined workspace layout: the problem guide, editor, and terminal now read as one unit. The terminal is docked inside the editor column (no longer a detached floating footer) with a draggable divider — drag to resize, height is remembered, and the editor always keeps priority so it can't be crushed
- Language selector moved into the editor title bar as plain orange text + chevron (LeetCode-style), replacing the standalone dropdown
- Editor action buttons converted to compact icons in the title bar (Run ▶, Mark Solved ✓, Copy, Clear ↺) with tooltips, freeing the full bottom row for the editor; Apply AI Code now lives only in the chat widget
- Conversational Coding Tutor chat: removed the "pick a mode before you talk" gate; just type and the tutor infers intent (hint/debug/review/etc.) and auto-attaches your workspace code. Two optional top shortcuts remain: Debug (sends immediately) and Rewrite (pick a target language first, then send)
- Terminal: estimated time-complexity of your code shown in the Tests pane, a Stop button to abort a stuck/looping run, and an "Ask for a review" action
- Real terminal dock styling: darker header, monospace typography, run-state status pill (READY/RUNNING/PASSED/FAILED), and distinct editor vs panel vs terminal surfaces

### Changed
- Tablet (768–1023px): opening the main sidebar now pushes/resizes the content instead of overlaying it, using a balanced narrower 220px sidebar so both the sidebar and workspace get reasonable room

### Fixed
- Dark-mode editor: code was invisible (only shown when highlighted) because a dark-theme rule painted an opaque background over the syntax-highlight overlay; the overlay is now fully self-contained and the textarea stays transparent
- Dark-mode Examples/code blocks were invisible (used an undefined `--text-primary` that fell back to near-black); now use the theme text color
- Workspace had an empty scroll gap above the editor and a shrunken editor when the terminal opened — fixed by making the workspace a fixed-height shell sized to the viewport minus the (responsive) navbar
- The Coding Tutor chat again sends your workspace code as context from any sub-page when code (or a loaded problem) is present
- Removed 97 unused/dead CSS classes across the coding-tutor and shared stylesheets

## [6.1] - 2026-06-23
### Added
- Java and C++ code runners for the Coding Tutor: compile-then-run in the same sandbox as Python/JS, with per-language security validation (blocking file/network/process/reflection/threads), CPU/memory/file/descriptor limits, and graceful "compiler not installed" fallbacks
- Autograding for all 60 quiz-bank problems across all four languages (easy + medium + hard): Python 60/60, JavaScript 60/60, Java 57/60, C++ 57/60 (the three Java/C++ gaps — Group Anagrams, Clone Graph, and Serialize Binary Tree — all use map/tree types the static harness can't represent, and stay covered in Python/JS)
- Free-run mode extended to Java and C++ (run a complete program, capture output, no grading)
- Editor: per-language syntax highlighting (keywords, strings, comments, numbers, calls, brackets), auto-closing brackets and quotes, and smart backspace that deletes a full indent at once
- Backend Docker image now bundles a JDK and g++ so Java/C++ autograding works on Cloud Run

### Fixed
- JVM startup under the sandbox: the strict virtual-address-space limit killed `javac`/`java` ("could not reserve enough space for object heap"); added a JVM-specific resource profile so Java compiles and runs while native binaries keep the tight limit
- Graded and free-run endpoints no longer reject Java/C++ (they previously returned a "Python/JavaScript only" message, making the new runners unreachable)
- Audit caught Serialize Binary Tree (hard-16) being silently mis-gradable in Java/C++ — its tree-as-map input can't round-trip through the static harness, so a correct answer would always fail; now excluded from those two languages (still graded in Python/JS)

## [6.0] - 2026-06-19
### Added
- Coding Tutor: in-browser practice workspace with a Monaco-style editor, Quiz Bank, Interview Prep packs, and a Progress view
- Sandboxed Python and JavaScript code runners (subprocess isolation, security validation, timeouts, rate limiting) with local test execution for the quiz bank
- Personal free-run mode: run arbitrary user code with no autograding
- VS Code-style docked terminal footer showing program output and test results
- Floating Coding Tutor chat with response-mode awareness (hint, debug, review, rewrite, generate) and an Apply AI Code flow
- Workspace snapshots (starter / current / AI rewrite / last passing) and a post-run code-quality checklist
- Progressive hint ladder and "Explain this error" / "Explain failed tests" handoff to the tutor
- Verified YouTube video resources: live YouTube Data API v3 search (safe-search, embeddable-only, quota cache) combined with a curated local catalog, played inline in chat with a click-to-play facade and an Open-on-YouTube fallback
- Explicit "General" tutor mode plus a third tutor toggle (CS Nav / General / Coding)

### Changed
- Question routing flipped to a deny-list: the knowledge base is prioritized for Morgan and student-record questions, and any other self-contained question goes to Gemini directly
- Conversation-aware routing with session tracks: ambiguous follow-ups inherit the prior track while self-contained questions reclassify on their own content; greetings stay track-neutral
- Three-tier caching (L1 / L2 / semantic) now covers non-Morgan answers, namespaced by context hash
- "Thinking" animation now reflects the real track (regular / general / coding) instead of always showing a knowledge-base step

### Fixed
- Cross-chat ADK memory blending: agent session keys now include both user id and chat session id so separate chats do not share hidden memory
- Inline video playback failures (iframe orphaned inside a paragraph, player resetting to the thumbnail on re-render)
- Chat flashing / black screen while typing a follow-up, and bot replies occasionally rendered as the user's message
- Gemini 429 / empty responses now surface a clean retryable error instead of garbled partial text
- Responsive chat on small screens (off-canvas sidebar drawer no longer hides the chat)

## [5.0] - 2026-04-04
### Added
- DatabaseSessionService for multi-instance session persistence
- Grounding gate that catches agent hallucinations via KB chunk count
- 3-layer follow-up resolver (regex override, entity focus, LLM fallback)
- Course context engine (prereqs, schedules, faculty pre-computed on backend)
- Canvas LMS REST API integration with lazy loading
- Self-healing research pipeline (detect, cluster, research, suggest KB fixes)
- Guest personal query interception (redirects to signup)
- Data source tracking (manual_entry vs pdf_parse vs banner_scrape)
- KB failure auto-retry with 2s delay
- 43-category Promptfoo red team security audit
- 9 agent security rules (jailbreak, role-play, calibration framing)
- Cloud Scheduler cron jobs for memory consolidation

### Changed
- Session TTL extended from 30 minutes to 24 hours
- min-instances bumped to 2 for ADK and backend
- Registration restricted to morgan.edu (test.com gated by env var)

### Fixed
- Guest chat fabricating random GPAs from hardcoded array
- Context bleed between unrelated follow-up questions
- Agent contradicting itself about DegreeWorks access mid-conversation
- ADK session 404 errors during multi-instance load balancing
- Profile picture CSS leaking to non-sidebar elements
- TTS button not showing stop state during playback
- Ticket attachment uploads failing on large screenshots

### Removed
- Manual DegreeWorks entry form (unverified data risk)
- Bookmarklet sync (replaced by Banner auto-sync + PDF upload)
- Hardcoded admin credentials in seed scripts

## [4.3] - 2026-04-01
### Added
- Email verification and forgot password flow
- Auto-research pipeline with failed query clustering
- Structured KB v7 with 51 documents

## [4.0] - 2026-03-12
### Fixed
- Agent accuracy improved from 39% to 100% via fresh session strategy
- Semantic caching for similar question matching

## [3.0] - 2026-03-09
### Added
- 8-specialist multi-agent architecture
- Promptfoo security test suite (23 tests)

### Changed
- Replaced single agent with specialist routing

## [2.2] - 2026-03-08
### Added
- Multi-tier caching (L1 in-memory + L2 Redis Cloud)
- SSE streaming for real-time chat

## [2.0] - 2026-03-05
### Changed
- Migrated from RAG pipeline to Google ADK Agent Engine
- Replaced Pinecone + OpenAI with Vertex AI Search + Gemini

## [1.0] - 2026-02-15
### Added
- Initial release with RAG pipeline
- Pinecone vector DB + OpenAI GPT-3.5-turbo
- Basic chat interface
- AWS EC2 deployment
