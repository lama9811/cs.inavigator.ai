# Live Class Availability — Banner Seat Data for the Planner

**Date:** 2026-07-02
**Status:** Draft (awaiting review)

## Goal

The Next-Semester Planner and the conversational planner currently build schedules from
**static, hand-maintained snapshots** (`backend/kb_structured/schedule_*.json`) that carry
**no seat/waitlist data**. As a result the planner can recommend a section that has been
full for weeks. This feature adds a pipeline that pulls **live, real-time seat and waitlist
data** from Morgan State's Banner and feeds it to the planner, so recommended schedules
reflect what a student can actually register for.

Full sections are **flagged, not hidden** — students see the whole picture (open / full /
waitlist) and open sections are preferred when building schedules.

## Verified facts (from a browser-driven spike on 2026-07-02)

These are confirmed against Morgan's live Banner (`lbssb1nprod.morgan.edu`), not assumed:

- **Browse Classes is public** — no login/CAS required (only Register/Plan-Ahead require login).
- **Endpoint:**
  `GET /StudentRegistrationSsb/ssb/searchResults/searchResults?txt_subject=COSC&txt_term=202670&pageOffset=0&pageMaxSize=500`
- **Handshake required first** (Banner won't return results until the session has "selected a term"):
  1. `GET /StudentRegistrationSsb/ssb/classSearch/classSearch` — establishes the `JSESSIONID` cookie.
  2. `POST /StudentRegistrationSsb/ssb/term/search?mode=search` with `term=<code>` — arms the session.
  3. `GET .../searchResults/searchResults?...` — returns JSON.
- **Term codes must be resolved, not guessed.** Fall 2026 = **`202670`** (an earlier guess of
  `202608` was wrong). Banner exposes them via
  `GET /StudentRegistrationSsb/ssb/classSearch/getTerms?searchTerm=&offset=1&max=10` which returns
  `{code, description}` pairs (e.g. `{"code":"202670","description":"Fall 2026"}`).
- **Response shape:** `{ success, totalCount, data: [ ...sections ], pageOffset, pageMaxSize }`.
  For COSC Fall 2026, `totalCount = 77`. The UI defaults to `pageMaxSize=10`; we set `500`.
- **Per-section fields present and confirmed:**
  `courseReferenceNumber` (CRN), `sequenceNumber` (section), `subject`, `courseNumber`,
  `subjectCourse`, `courseTitle`, `creditHours`/`creditHourLow`, `scheduleTypeDescription`,
  `campusDescription`, `partOfTerm`, `seatsAvailable`, `maximumEnrollment`, `enrollment`,
  `openSection` (bool), `waitCount`, `waitCapacity`, `waitAvailable`,
  `faculty[]` (each `{displayName, ...}`), `meetingsFaculty[]` (each
  `{meetingTime: {monday..sunday bools, beginTime, endTime, room/building, ...}}`).
- A real captured fixture is saved at `.playwright-mcp/banner_cosc_fall2026.json` and is used
  as the parser test fixture.

## Subjects in scope

The CS planner covers exactly three subject prefixes (from `schedule_fall_2026.json`):
**`COSC`, `BIOI`, `CLCO`** — 3 fetches per term.

## Design decisions (locked with the user)

1. **Storage:** a new Cloud SQL table `live_sections` keyed by `(term, crn)`. (Not JSON-file
   regeneration — container files are ephemeral; not Redis-only — no history and dies with Redis.)
2. **Full sections:** flag as FULL / waitlist-open, do **not** hide; prefer open sections when
   composing schedules.
3. **Cadence & scope:** a Cloud Scheduler job every **6 hours**, for the **active registerable
   term only** (~12 requests/day to Banner).
4. **Fallback:** if live data for a term is missing or stale, fall back to the existing static
   `schedule_<term>.json` and label the response *"availability not live — verify in Banner."*
   The planner never breaks and never 500s.

## Current state (what exists today)

- **Per-student Banner client** `backend/banner_scraper/client.py` (`BannerClient`) +
  `cas_auth.py` — logs in *as a student* for DegreeWorks/grades. **Not reused here**: class
  search is public and needs no auth, so it gets its own module.
- **Static schedules** loaded once at startup in `backend/services/course_context.py` into
  `_SCHEDULES` as `{ sem_key: { "COSC 320": [ {section, instructor, time, room}, ... ] } }`.
  This is the exact shape the planner consumes — the live path mirrors it, plus seat fields.
- **Engine:** `services/schedule_planner.py` `generate_schedule_options(eligible, sem_key, prefs,
  schedules, classification)` builds conflict-free options; `_parse_semester_key` /
  `next_semester_key` / `eligible_courses` are the shared helpers (currently WIP in the working tree).
- **Front doors:** `GET /api/planning/next-semester` (`main.py:2791`) and the chat planner state machine.
- **Cron pattern to mirror:** `POST /api/internal/reminders/dispatch` (`main.py:6367`) — guarded by an
  `X-Research-Secret` header compared to the `RESEARCH_SECRET` env, triggered by Cloud Scheduler.
- **Model auto-migrate:** `init_db` in `main.py` reads `information_schema` once, then `CREATE`s/`ALTER`s
  missing tables/columns — adding a model + listing it there is the supported way to add a table.
- **Planner UI:** `frontend/src/components/PlannerPage.jsx` (WIP in the working tree).

## Components

Each unit has one job and a well-defined interface.

### 1. `backend/banner_scraper/class_search.py` (new module — public, no auth)

- `async resolve_term_code(sem_key: str) -> str | None`
  Calls `getTerms`, matches the human term description (e.g. `"Fall 2026"` derived from
  `fall_2026`) to its numeric `code`. Returns `None` if not found. **Never hardcodes term codes.**
- `async fetch_sections(subject: str, term_code: str) -> list[dict]`
  Performs the 3-step handshake in a fresh `httpx.AsyncClient`, then GETs `searchResults` with
  `pageMaxSize=500`; pages while `pageOffset + len(data) < totalCount`. Returns raw Banner rows.
  Raises on timeout / non-200 / `success=false`.
- `parse_section(raw: dict, sem_key: str) -> dict`
  Normalizes one raw row to the canonical shape (pure function, unit-tested against the fixture):
  ```
  {
    term, crn, subject, course_number, course_code ("COSC 320"),
    title, credits, section, instructor, campus, schedule_type,
    days ("MWF"), begin_time ("12:00PM"), end_time ("12:50PM"), room,
    seats_available, max_enrollment, enrollment, open_section (bool),
    wait_count, wait_capacity, wait_available
  }
  ```
  `begin_time`/`end_time`/`room` may be `None`/`"TBA"` (e.g. online sections) — carried through
  as TBA so downstream conflict-checking can skip them, matching current behavior.

### 2. `LiveSection` model → `live_sections` table

- Columns: all canonical fields above, plus `fetched_at` (UTC timestamp).
- Primary/unique key: `(term, crn)`.
- Registered in `init_db`'s auto-migrate list so it's created on deploy.
- Indexed on `(term, subject)` for the per-subject replace and the planner read.

### 3. Refresh endpoint — `POST /api/internal/schedule/refresh` (`backend/main.py`)

- Guarded exactly like the reminders cron: `X-Research-Secret` header must equal `RESEARCH_SECRET`.
- Steps:
  1. Determine the **active term**: from `getTerms`, the soonest term whose description is **not**
     marked `(View Only)`. (Fall 2026 today.)
  2. `resolve_term_code` for it.
  3. For each subject in `["COSC", "BIOI", "CLCO"]`: `fetch_sections` → `parse_section` →
     **per-subject transactional replace** (delete existing `(term, subject)` rows, insert fresh,
     stamp `fetched_at`).
  4. **Per-subject isolation:** a subject that raises is logged and skipped; its previous rows are
     left intact and the other subjects still run.
- Returns `{ status, term, subjects: { COSC: n, BIOI: n, CLCO: n }, errors: [...] }`.

### 4. Cloud Scheduler job (ops)

- New job `refresh-live-sections`, cron `0 */6 * * *`, POSTs the endpoint with the secret header.
- Documented in `CLAUDE.md` next to the reminders cron. During registration weeks, cadence can be
  temporarily raised to hourly by editing the job — no code change.

### 5. Planner integration

- New accessor (in `services/course_context.py` or a small `services/live_schedule.py`):
  `get_live_sections(term: str) -> tuple[dict | None, datetime | None]`
  Reads `live_sections` for `term`, returns the same `{course_code: [section...]}` shape the
  planner already consumes — **plus** `seats_available`, `open_section`, `wait_count` on each
  section — and the newest `fetched_at`. Returns `(None, None)` if empty.
- **Freshness rule:** data is "fresh" if `fetched_at` is within 24h. Fresh → use live. Empty or
  stale → fall back to static `_SCHEDULES`.
- `GET /api/planning/next-semester` (and the chat planner) choose the source, then:
  - `generate_schedule_options` **prefers `open_section == true`** when picking sections but still
    includes full ones tagged `open: false` so they render as FULL/waitlist.
  - Response gains `data_source: "live" | "static"`, `as_of` (ISO timestamp or null), and a
    human note (`"Live seats, updated Nh ago"` or `"Availability not live — verify in Banner."`).
- Any error reading live data → caught, silent fall back to static + label. Never 500.

### 6. Frontend — `PlannerPage.jsx`

- A freshness badge at the top of results: **"Live seats · updated 2h ago"** (green) when
  `data_source==="live"`, or **"Availability not live — verify in Banner"** (amber) when static.
- Per-course/section indicator: **Open** (green, "N seats"), **Waitlist** (amber, "waitlist N/M"),
  or **Full** (red). Full sections shown but visually de-emphasized.
- Purely additive to the WIP planner page; no restructure.

## Data flow / freshness

Each cron run writes one fresh snapshot per subject, stamped `fetched_at`. The planner reads the
newest rows for the requested term. `now - fetched_at > 24h` ⇒ treated as fallback-to-static and
labeled. The planner is always answerable — live when fresh, static otherwise — and the label always
tells the truth about which.

## Error handling

| Failure | Behavior |
|---|---|
| Banner timeout / non-200 / `success=false` for a subject | Cron logs it, skips that subject, keeps its prior rows; other subjects still refresh. |
| Term code cannot be resolved | Cron logs and no-ops that run; existing rows untouched. |
| `live_sections` read error at request time | Planner silently falls back to static + label. |
| Banner reachable only on campus/VPN | Cron (running in Cloud Run, on the public internet) either succeeds or logs timeouts; must be confirmed during build (see Open questions). |

## Testing

- **`parse_section`** against the real captured fixture `.playwright-mcp/banner_cosc_fall2026.json`:
  assert CRN, section, credits, seats, days/times parse correctly and `open_section == (seats_available > 0)`.
- **`resolve_term_code`** against a captured `getTerms` response fixture: `"Fall 2026"` → `"202670"`,
  and unknown term → `None`.
- **Seat-flagging / source-selection** with a fake `live_sections`: full section flagged `open:false`,
  open section preferred; stale (>24h) rows ⇒ static path chosen and response labeled `static`.
- **Fallback**: empty live table ⇒ static used and `data_source:"static"`.
- **Live network call** kept behind an opt-in env flag (`RUN_BANNER_LIVE_TESTS=1`) since it needs
  Banner reachability — excluded from normal CI.

## Suggested build order (one spec, two phases)

- **Phase A — data pipeline:** `class_search.py` + `LiveSection`/migrate + refresh endpoint +
  Cloud Scheduler job + parser/term tests. Independently shippable and verifiable via a manual
  endpoint call.
- **Phase B — consumption:** `get_live_sections` accessor + planner source-selection/seat-flagging +
  `PlannerPage.jsx` badges. Builds on Phase A and the WIP planner work.

## Out of scope (YAGNI)

- Reserved-seat / cross-list detail (`reservedSeatSummary`, `crossList*`) beyond storing raw counts.
- Auto-refreshing the static `classes.json` catalog or prerequisites — this feature is seats only.
- Terms beyond the single active registerable term.
- Real-time push / websockets — a 6-hour snapshot is the agreed freshness.

## Open questions (to confirm during build)

1. **Cloud Run → Banner reachability.** The spike proved a browser can reach Banner from the user's
   network; the cron runs from Cloud Run. Confirm Cloud Run's egress can reach
   `lbssb1nprod.morgan.edu` (should be fine for a public host) as the first Phase-A checkpoint.
2. **Other subjects' term-code seasons.** We confirmed Fall = `...70`. Spring/Summer codes are
   resolved dynamically via `getTerms`, so no hardcoding is needed — but worth eyeballing the first
   time a non-Fall term is active.
