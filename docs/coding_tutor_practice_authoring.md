# Coding Tutor Practice Authoring

This is the working pipeline for adding code-writing Practice Library problems.
Use small, reviewed batches. Do not import external problem banks unless the
license clearly allows redistribution.

## Authoring Order

1. Pick one topic and add a small batch, usually 2 to 4 problems.
2. Add the student-facing question in `backend/data_sources/quiz/questions/`.
3. Add matching answer metadata for every language in
   `backend/data_sources/quiz/answers/`.
4. Add at least 3 deterministic `runner_tests` per supported language.
5. Add or update the canonical function signature in
   `backend/practice_starters.py` when the problem can use the native starter
   bridge.
6. Run the validation gate before committing.

## Quality Bar

- Prompts should describe a real task, not a placeholder pattern.
- Each question needs a clear title, topic, difficulty, examples, constraints,
  and at least 3 progressive hints.
- Tests should include the provided example, an edge case, and a behavior case
  that catches a common wrong solution.
- Function names must match the starter style for that language:
  Python uses `snake_case`; JavaScript, Java, and C++ use `camelCase`.
- C++ starters should stay beginner-facing where possible: explicit standard
  headers, `int`, `std::vector<int>`, and no `bits/stdc++.h`.
- Java/C++ gaps are allowed only when the static bridge cannot honestly express
  the data shape; document those in `ALLOWED_NO_TESTS`.

## Validation Gate

Run from `backend/`:

```powershell
..\.venv\Scripts\python.exe -m pytest tests\test_practice_library_content.py tests\test_native_bridge.py
```

Run from the repo root when touching the frontend workspace around Practice:

```powershell
cd frontend
npm run build
npm run lint
```

The backend gate checks:

- question IDs, titles, prompts, examples, hints, and difficulty values;
- answer banks match the question catalog for every language;
- runner tests are present and well shaped, except documented bridge gaps;
- priority topics and Advanced V1 topics have code-problem coverage;
- answer defaults include starter, guided steps, reference text, and complexity;
- generated starters include the expected function name and avoid legacy
  Java/C++ union starter shapes for native-bridge problems.
