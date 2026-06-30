# Changelog

All notable changes to CS Navigator are documented here.

## [6.6.1] - 2026-06-30
### Added
- Workspace sub-routes: `/coding/workspace/personal` (My Snippets / scratch mode) and `/coding/workspace/problem/:id` (a specific practice or interview problem). Opening a problem now writes its `/problem/:id` URL, and refreshing or cold-loading that URL re-fetches the problem by id and reopens it (the set — practice vs interview — is inferred from the `iv-` id prefix; unknown ids fall back to the plain workspace with a toast). `/coding/workspace` with no suffix still shows the active problem / empty state. Mock-interview problems intentionally stay on the plain `/coding/workspace` URL (the session is in-memory, not addressable); restoring a problem URL never hijacks a running mock
- Coding Tutor sections are now real routes under `/coding` instead of local-state tabs: `/coding` (Home), `/coding/practice`, `/coding/interview-prep`, `/coding/workspace`, `/coding/progress` (plus `/coding/daily`). Each section has a shareable URL, browser back/forward moves between sections, and refreshing restores the current section. `CodingTutor` stays mounted as one component across these routes, so shared state (active problem, code, language, terminal output, progress, mock session) is never lost — only the rendered section changes. The active section is now derived from the URL; the nav buttons navigate (`goToPage` → `navigate`) instead of setting state. The App route became `/coding/*`, and `Chatbox`'s coding-route check now matches all `/coding/*` paths (so the workspace renders on every sub-route; `/chat/coding` stays separate). Old `/coding?page=<id>` links are redirected to their new path equivalents (back-compat shim). Deferred: `/coding/workspace/:problemId` deep-links and mid-session mock survival across refresh
### Fixed
- Admin Dashboard user Enable/Disable buttons were both solid red (with "Enable" rendering as unreadable green text on red). A generic `.admin-table button` rule forced a red fill + white text on every table button, overriding the status button's color-only styles. Scoped the status buttons under `.admin-table` to win: **Disable = solid red, Enable = solid green**, each with white text and a darker hover
- Personal workspace ("My Snippets") side panel header looked clipped/cramped: the "Your personal workspace" heading wrapped to 3 lines and the center-aligned "+ New" button floated into the middle of it. The header now top-aligns, the heading is size-capped so it doesn't balloon, the heading block can shrink so the button never crams it, and on narrow panels (≤720px) the button stacks full-width under the heading
- Personal workspace guide panel was clipped: it had no horizontal padding (unlike the quiz panel, whose content wrapper provides it), so the "No saved snippets" box ran flush to the panel edge and its border was cut off. Added side padding to the panel, and restyled the empty state as a soft filled card (accent tint + thin solid border, matching the Quiz Bank "Starter Guidance" panel) instead of a dashed outline — with `box-sizing`/`min-width:0`/`max-width` so it stays inside the panel and never clips
- Mock Interview timer leaked onto regular problems: opening a Practice Library (or personal/non-mock interview) problem while a mock session lingered left the timer bar running and the countdown ticking. Now (1) the mock bar only renders while actually on a mock problem (`mockSession && activeProblem?.mock`), and (2) opening any non-mock problem silently abandons the mock session, so the ticker tears down and "time's up" can't fire mid-practice
### Changed
- Hid the Practice Guide "Common mistakes" panel before deploy: its copy was identical for every user (curated by topic-in-view, not personalized), so it implied per-user insight it didn't have. The seed copy (`TOPIC_INSIGHTS` + `insightForTopic()`) is parked as comments in `QuizBank.jsx` for a future per-user version. Tracked in ROADMAP under "Practice Guide: per-user common mistakes" (deferred until after the Routing Cleanup, since a real per-user version needs new attempt-error capture in the backend)
- The language lock is now **scoped to an active Mock Interview** only. Practicing a single interview problem (outside a mock) keeps the language free to switch; the lock — and its "language is locked for this mock interview — clear your code back to the starter to switch" toast — applies just during a timed mock, matching the simulation intent
- The Mock Interview problem panel now states the rule up front: a "🔒 Your language locks once you start coding — like a real interview." line in the Mock Interview Mode card, so students aren't surprised when the dropdown disables
- During an active Mock Interview, the floating Coding Tutor chat is **hidden** so the round has no AI assist (bridged from `CodingTutor.jsx` to `Chatbox.jsx` via a `coding-mock-change` window event + `body.coding-mock-active` class, since the two components share no state); it returns when the round ends
### Fixed
- "Start Mock Interview" button had an unreadable hover (white label on a peach fill). The base fill also used `var(--ct-primary)`, which resolves to a medium blue (not deep navy) in light mode — switched to hard navy literals so the base button is deep navy with a white label. On hover the button now uses the shared coding-app hover treatment (soft peach fill + orange border, matching the "Solve" buttons) and the label/icon turn orange to match — so the hover text is readable. Added a matching `:focus-visible` state
- Mock Interview session bar looked muddy in light mode (a thin navy-over-paper tint read as flat grey-brown); it's now a clean raised paper surface with a crisp navy left rail, gold hairline border, and soft shadow, with matching dark-mode shadow
- Workspace editor clipped on the right at split-screen widths (the `JAVASCRIPT` label + closing brace were cut off and a horizontal scrollbar appeared). The editor window now carries `min-width: 0` / `max-width: 100%` so it can shrink within its column, and the titlebar filename truncates instead of forcing the window wider

## [6.6] - 2026-06-30
### Changed
- Interview Prep now supports all four languages without per-question seed files: switching language on an interview problem swaps the editor + re-seeds a generated starter stub (no `/solution` fetch, which 404'd before since interview problems have no solution files). Free-run already executes Python/JS/Java/C++
- Interview simulation: the language is **locked once the student edits past the starter stub** (committing to a language, like a real interview). The editor's language dropdown disables with a "locked once you start coding" tooltip; clearing back to the stub releases the lock
- Mock Interview — Skip is now genuinely one-way: it opens a confirm modal ("skipping is one-way — you won't be able to come back"), and skipped problems are excluded from Previous navigation (Next still lets you return via Previous). Skip works on the last problem too (previously disabled). Viewing the worked solution mid-round now opens a confirm ("this ends the interview") and ends the round on confirm — separate from the "I'm stuck — reveal solution" unlock
### Fixed
- Mock timer used a stale-closure check that could miss a last-second outcome change in the auto-end summary; the expiry check now reads the latest session via a functional state update
- Ending a mock (manually or on timeout) now clears the `mock` flag on the active problem, so opening a normal interview problem afterward isn't treated as still in-session
- Mock start is guarded when fewer than 2 interview questions are available (clear toast instead of a degraded 1-problem round)
### Changed
- Mock Interview turned into a real timed session instead of "workspace + timer". The bar is now a session header: mode label, a per-problem stepper (current/solved/attempted/skipped), a remaining-time clock with urgency tiers (navy → orange under 10 min → red under 2 min → "time's up"), a sub-row with per-problem elapsed time + suggested pace (~time/problem), and live session progress (N solved · N attempted · N remaining). Per-problem outcome controls — Mark solved / Skip / Next / Previous — feed the results. Running code marks the problem attempted; "End" now confirms before closing
- Mock mode keeps the simulation honest: the worked-solution link is locked behind an "I'm stuck — reveal solution" button until the student attempts the problem (runs code) or clicks stuck; the problem panel shows a "Mock Interview Mode — try first" rules label and collapses examples into a compact `<details>` (and hides constraints) so code space wins. The editor seeds a language-appropriate starter stub (function signature + "write your solution here") so it never looks blank
- Post-interview results overlay (`MockSummary.jsx`): solved/attempted out of total, time used, topics covered, and a per-problem list with outcome + a "Review" link to each walkthrough; "Back to Interview Prep" or "Run another"
- Interview Prep topic-card difficulty breakdown is now colored chips with full words ("3 Easy · 6 Med · 1 Hard") instead of plain "3E 6M 1H" text — removes the "1H = 1 hour" misread and makes the difficulty colors stand out
- Interview Prep polish pass: stats strip is now icon pill-cards (instead of table-like cells); Recommended Path items are clickable chips that jump straight to that topic's warmup (the next-up chip is accented); search shows a live result summary ("Showing 7 matches") with recognized facet chips (e.g. Medium, Arrays); added a difficulty legend (E/M/H) above the topic grid; the "How to use" doc-list became a compact numbered visual flow (Pick → Solve → Review → Mock); the open-topic card uses a soft navy/orange border + warm header tint instead of a harsh outline; and the page panel is a warmer off-white instead of sterile flat white. The Mock Interview bar is slimmer (smaller timer + controls), and its "Start Mock Interview" button has a clearer brighten-and-ring hover that reads in light mode
### Added
- Interview Prep redesigned from a static directory into a guided experience: a progress strip (reviewed count, topics started, strongest topic, practice-next), a Recommended Path strip (Arrays → Strings → Stacks → Recursion, adapts to the loaded topics) with a "Start <topic> warmup" CTA, and a search bar that matches title/topic/secondary-topics/patterns/difficulty (supports combos like "medium arrays"). Topic cards now carry topic-specific icons, a per-topic difficulty breakdown (e.g. "3E · 6M · 2H"), a review-progress bar, and hover lift/rail-brighten/chevron interactions. Expanding a topic shows an in-topic difficulty filter, the first 5 problems + "Show all", compact rows with a primary "Solve" + an icon-only "View solution", and a per-problem "mark reviewed" toggle. Added a "How to use Interview Prep" footer so the page fills its panel
- Interview-prep "reviewed" progress (`interviewProgress.js`): a localStorage-backed, student-driven review flag (no backend/autograder, since these are reference problems). Powers the progress strip and topic progress; opening "View solution" auto-marks reviewed. A custom window event keeps mounts in sync within a tab
- Mock Interview mode (`MockInterviewBar.jsx`): "Start Mock Interview" picks 3 mixed-difficulty problems (one each easy/medium/hard when available) and runs a 45-minute countdown in the workspace with Previous / Next-problem / End controls; the timer turns urgent in the last 5 minutes and auto-ends at zero. The bar sits above the workbench during a session. Timer is pure frontend state — no routing dependency; surviving a refresh mid-session is deferred to the Routing Cleanup
### Fixed
- "Start Mock Interview" button label disappeared on hover (the hover gradient lightened the fill under the white text); hover now darkens the fill (mix toward black) and keeps the orange accent ring as the hover signal, so the label stays readable
- Interview Prep "Start Mock Interview" button label was invisible (dark text forced by the global `.coding-app button` rule on the dark gradient button); scoped the text to white with the same `.coding-app` + `!important` pattern used for the practice pills
- Interview Prep problems can now be solved in the Coding Workspace. Each problem in the browse view has two actions: **Solve in workspace** (opens the editor) and **View solution** (external walkthrough link). `openInterviewProblem()` loads the problem as a synthetic `source: "interview"` workspace problem — modeled on the LeetCode daily: the prompt + examples show in the problem panel, the student writes and **runs** their own code in the terminal, but there is no autograder (these are reference problems, `has_tests: false`). "Run tests", "Mark solved", and problem-navigation auto-hide because they gate on `isQuizBankProblem` (false for interview problems, which aren't in the practice index). The problem panel shows a "View the worked solution ↗" link out (`answer_url`) as the escape hatch. Routing is unchanged for now; per-section workspace routes (`/coding/workspace/:source/:problemId`) are deferred to the Routing Cleanup
- Interview Prep is now its own browse view (`InterviewPrep.jsx` + `InterviewPrep.css`), replacing the old "Practice by topic" pack filter that just re-filtered the Practice Library. It loads the `interview` question set (set=interview, all difficulties) in a self-contained fetch and shows topic cards that expand into a list of problems. Reuses the Topic Practice Pack visual language (card shell, tone rails, icon) and `--ct-*` theme tokens with light + dark variants. Removed the now-unused `TopicPracticePacks` import and the `openTopicPack` / `findTopicVideo` handlers from `CodingTutor.jsx`
- Seeded the new `interview` question set: 51 questions from the "50 Coding Interview Questions" (Byte by Byte) guide, split into `data_sources/interview/questions/{easy,medium,hard}.json` (21 / 21 / 9). Each item is a reference/study problem (`has_tests: false`, `set: "interview"`, `source: "byte-by-byte"`) with the prompt + example locally and the worked answer as an external `answer_url` (`answer_kind: "article"`), tagged by `topic`/`topics` (arrays, graphs, recursion, trees, stacks, bit-manipulation, linked-lists, strings) and `pack` (the guide's section). Served via `GET /api/coding/practice/questions?set=interview`. No frontend wiring yet — that is the Interview Prep browse view

### Changed
- Generalized the Coding Tutor question store into a set-keyed content library (groundwork for the Interview Prep Library). Added a `QUESTION_LIBRARIES` registry mapping a set name to its questions folder (`practice` → existing `data_sources/quiz/questions`, `interview` → new `data_sources/interview/questions`), and parameterized the loaders (`_questions_for_difficulty` / `_all_questions` / `_find_question`) by set. The practice-specific function names are kept as default-`practice` aliases, so all existing callers are unchanged
- Added `_normalize_question()` as the single place the canonical question schema is applied. Required fields stay `id/title/difficulty/topic/prompt`; new optional fields are filled with defaults for every question: `topics` (→ `[topic]`), `patterns` (→ `[]`), `languages` (→ all four), `has_tests` (→ true), `source` (→ `cs-navigator`), `set`, `pack`/`answer_url`/`answer_kind` (→ null). The existing 60 practice question files are unchanged — defaults are supplied at load time, so back-compat is preserved
- `GET /api/coding/practice/questions` and `/{question_id}` accept an optional `set` selector (default `practice`); the existing `?difficulty=` contract is unchanged, and an unknown set returns a clear 400

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
