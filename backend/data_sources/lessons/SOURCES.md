# Lesson & quiz content — curriculum sources and the licensing rule

## The rule (read this before authoring anything)

**We use these books as a curriculum reference. We do not copy from them.**

Every one of the texts below is **copyleft** — GFDL, CC BY-NC-SA, CC BY-NC, or "all rights
reserved". Copying prose, examples, or exercises from any of them would bind CS Navigator's
content to that license: public redistribution, and for the NonCommercial ones, **no
commercial use, ever**. That would follow the project permanently, including into anything
the department later funds or licenses.

**What we take** — the *curriculum*: which topics to teach, in what order, and which
mistakes trip students up. **A topic sequence is not copyrightable.** Neither is the fact
that `range(5)` stops at 4.

**What we never take** — the *expression*: their sentences, their examples, their
exercises, their analogies. Those are protected, and closely paraphrasing them is still a
derivative work.

Written correctly, every lesson and question in this app is **original and unencumbered**.

---

## Python

| Source | License | Notes |
|---|---|---|
| [Foundations of Python Programming](https://runestone.academy/ns/books/published/fopp/index.html) (Runestone) | **GFDL** | **Primary reference.** Ch.3 (Debugging → Syntax / Runtime / Semantic errors) maps 1:1 onto our telemetry's `error_class`. That alignment is why we follow this one's shape. |
| [Think Python, 3rd ed.](https://allendowney.github.io/ThinkPython/) (Downey) | CC BY-NC-SA | Excellent chapter ordering; strong on functions early. |
| [Introduction to Python Programming](https://openstax.org/details/books/introduction-python-programming) (OpenStax) | CC BY-NC-SA | Buries error handling in Ch.14; weaker fit for a debugging-first tutor. |

## Java

| Source | License | Notes |
|---|---|---|
| [Introduction to Programming Using Java](https://math.hws.edu/javanotes/) (David Eck) | CC BY-NC-SA | The standard free Java text. Also on [Open Textbook Library](https://open.umn.edu/opentextbooks/textbooks/introduction-to-programming-using-java-seventh-edition). |

## C++

| Source | License | Notes |
|---|---|---|
| [Think C++](https://github.com/AllenDowney/ThinkCPP) (Downey) | CC BY-NC-SA | Mirrors Think Python's structure, which keeps our cross-language categories aligned. |
| [Google C++ Class](https://developers.google.com/edu/c++/cpp-in-depth) | ⚠️ **Not openly licensed** | Google's *code samples* are Apache-2.0; the **prose is under Google's site terms**. Read for reference only — do not copy, not even with attribution. |

## JavaScript

| Source | License | Notes |
|---|---|---|
| [javascript.info](https://javascript.info/) | CC BY-NC-SA | Best explanations of the coercion traps (`"3" + 4`) that our Data Types quiz targets. |
| [Eloquent JavaScript](https://eloquentjavascript.net/) (Haverbeke) | CC BY-NC | Strong on functions and closures. |

---

## How to write a lesson (the voice)

The first draft of the Loops lesson read as machine-written, and the reason was measurable:
**7 em-dashes in 41 sentences**, `**bold**` used as emphasis-by-force, and words shouted in
caps (`NOT`, `BEFORE`). All of those are a writer reaching for punctuation instead of
writing a sentence that carries the weight on its own.

Rules, in order of how much they matter:

1. **Almost never use an em-dash.** Use a full stop, a comma, or a colon. If a thought
   needs an aside, it usually needs its own sentence.
2. **No shouted caps.** Not `range(5) does NOT include 5`. Write *"It stops before 5, never
   reaching it."* The sentence should do the emphasizing.
3. **No bold for emphasis** in lesson prose. (A `callout` block already *is* the emphasis;
   that's what it's for.)
4. **Second person, plain verbs.** "You pick what to call it," not "the identifier is
   user-specified."
5. **Name the mistake, then normalize it.** *"This catches almost everyone at least once."*
   A student who reads their error as a verdict on their ability stops practicing.
6. **Every code block says why, not just what.** A snippet with no caption is not a lesson.
7. **Every check block explains the wrong answer**, especially the tempting one. *"If you
   picked 'last number 4', you have just met the off-by-one error in person."*

---

## Where the content lives

- **Lessons:** `backend/data_sources/lessons/<language>/<category>.json`
- **Quizzes:** `backend/data_sources/concept_quiz/` (see its `_manifest.json`)

Both are keyed to the **same category ids**, so "Learn Loops" and "Practice Loops" are the
same topic by construction and cannot drift apart.

Each lesson also carries a `refresher` (2–4 sentences + one example) — that is what shows
in the **Learn tab inside a quiz question**. It comes from the same file as the full
lesson, deliberately: authored separately, the two would eventually contradict each other.
