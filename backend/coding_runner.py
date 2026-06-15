import json
import hashlib
import os
import subprocess
import sys
import tempfile
import time
from typing import Any
from threading import Lock


RUN_RESULT_CACHE_TTL_SECONDS = 600
RUN_RESULT_CACHE_MAX_SIZE = 200
_run_result_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_run_result_cache_lock = Lock()


def _runner_cache_key(question_id: str, language: str, code: str, function_name: str, tests: list[dict[str, Any]]) -> str:
    payload = {
        "question_id": question_id,
        "language": language,
        "code": code,
        "function_name": function_name,
        "tests": tests,
    }
    raw = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def get_cached_practice_run(
    question_id: str,
    language: str,
    code: str,
    function_name: str,
    tests: list[dict[str, Any]],
) -> dict[str, Any] | None:
    key = _runner_cache_key(question_id, language, code, function_name, tests)
    now = time.time()
    with _run_result_cache_lock:
        cached = _run_result_cache.get(key)
        if not cached:
            return None
        cached_at, result = cached
        if now - cached_at > RUN_RESULT_CACHE_TTL_SECONDS:
            _run_result_cache.pop(key, None)
            return None
        return {**result, "cached": True}


def set_cached_practice_run(
    question_id: str,
    language: str,
    code: str,
    function_name: str,
    tests: list[dict[str, Any]],
    result: dict[str, Any],
) -> None:
    key = _runner_cache_key(question_id, language, code, function_name, tests)
    cacheable = {
        key: value
        for key, value in result.items()
        if key not in {"progress", "progress_saved", "message", "cached"}
    }
    with _run_result_cache_lock:
        if len(_run_result_cache) >= RUN_RESULT_CACHE_MAX_SIZE:
            oldest_key = min(_run_result_cache, key=lambda item: _run_result_cache[item][0])
            _run_result_cache.pop(oldest_key, None)
        _run_result_cache[key] = (time.time(), cacheable)


def empty_practice_run_response(message: str, status_value: str = "error") -> dict[str, Any]:
    return {
        "status": status_value,
        "passed": 0,
        "total": 0,
        "tests": [],
        "stdout": "",
        "stderr": message,
        "duration_ms": 0,
        "progress_saved": False,
        "message": message,
    }


def run_python_practice_tests(code: str, function_name: str, tests: list[dict[str, Any]]) -> dict[str, Any]:
    runner_source = """
import ast
import contextlib
import io
import json
import sys
import time
import types

payload = json.loads(sys.stdin.read() or "{}")
tests = payload.get("tests", [])
function_name = payload.get("function_name")
started = time.perf_counter()
stdout_buffer = io.StringIO()
results = []

def execute_student_module(path):
    with open(path, "r", encoding="utf-8") as handle:
        source = handle.read()
    tree = ast.parse(source, filename=path)
    module = types.ModuleType("student_solution")
    module.__file__ = path
    module.__name__ = "student_solution"
    sys.modules[module.__name__] = module

    final_expr = tree.body[-1] if tree.body and isinstance(tree.body[-1], ast.Expr) else None
    if final_expr and isinstance(final_expr.value, ast.Constant) and isinstance(final_expr.value.value, str):
        final_expr = None

    setup_body = tree.body[:-1] if final_expr else tree.body
    setup_tree = ast.Module(body=setup_body, type_ignores=tree.type_ignores)
    ast.fix_missing_locations(setup_tree)
    exec(compile(setup_tree, path, "exec"), module.__dict__)

    if final_expr:
        expr_tree = ast.Expression(final_expr.value)
        ast.fix_missing_locations(expr_tree)
        result = eval(compile(expr_tree, path, "eval"), module.__dict__)
        if result is not None:
            stdout_buffer.write(repr(result))
            stdout_buffer.write("\\n")

    return module

try:
    with contextlib.redirect_stdout(stdout_buffer):
        module = execute_student_module("solution.py")
    warning = ""
    if hasattr(module, function_name):
        target = getattr(module, function_name)
    elif hasattr(module, "solve"):
        target = getattr(module, "solve")
        warning = f"Expected function '{function_name}' was not found, so the runner used 'solve' instead. Rename your function to '{function_name}' for this problem."
    else:
        student_functions = [
            value for name, value in vars(module).items()
            if callable(value) and getattr(value, "__module__", "") == module.__name__ and not name.startswith("_")
        ]
        if len(student_functions) == 1:
            target = student_functions[0]
            warning = f"Expected function '{function_name}' was not found, so the runner used your only defined function. Rename it to '{function_name}' for this problem."
        else:
            available = ", ".join(
                name for name, value in vars(module).items()
                if callable(value) and getattr(value, "__module__", "") == module.__name__ and not name.startswith("_")
            ) or "none"
            raise AttributeError(f"module 'student_solution' has no function named '{function_name}'. Available student functions: {available}")
except Exception as exc:
    print(json.dumps({
        "status": "error",
        "error": f"Could not load {function_name}: {exc}",
        "tests": [],
        "stdout": stdout_buffer.getvalue(),
        "duration_ms": round((time.perf_counter() - started) * 1000, 2),
    }))
    raise SystemExit(0)

for index, test in enumerate(tests, start=1):
    name = test.get("name") or f"Test {index}"
    args = test.get("args", [])
    expected = test.get("expected")
    try:
        with contextlib.redirect_stdout(stdout_buffer):
            actual = target(*args)
        passed = actual == expected
        results.append({
            "name": name,
            "passed": passed,
            "args": args,
            "expected": expected,
            "actual": actual,
        })
    except Exception as exc:
        results.append({
            "name": name,
            "passed": False,
            "args": args,
            "expected": expected,
            "actual": None,
            "error": str(exc),
        })

passed_count = sum(1 for item in results if item.get("passed"))
print(json.dumps({
    "status": "passed" if passed_count == len(results) else "failed",
    "tests": results,
    "stdout": stdout_buffer.getvalue(),
    "warning": warning,
    "duration_ms": round((time.perf_counter() - started) * 1000, 2),
}))
"""
    started = time.perf_counter()
    try:
        with tempfile.TemporaryDirectory(prefix="csnav_practice_") as temp_dir:
            solution_path = os.path.join(temp_dir, "solution.py")
            runner_path = os.path.join(temp_dir, "runner.py")
            with open(solution_path, "w", encoding="utf-8") as handle:
                handle.write(code)
            with open(runner_path, "w", encoding="utf-8") as handle:
                handle.write(runner_source)

            completed = subprocess.run(
                [sys.executable, "-I", runner_path],
                cwd=temp_dir,
                input=json.dumps({"function_name": function_name, "tests": tests}),
                text=True,
                capture_output=True,
                timeout=4,
                env={"PYTHONIOENCODING": "utf-8"},
            )
    except subprocess.TimeoutExpired:
        return {
            "status": "error",
            "tests": [],
            "stdout": "",
            "stderr": "The run timed out after 4 seconds. Check for infinite loops or very slow logic.",
            "duration_ms": round((time.perf_counter() - started) * 1000, 2),
        }
    except Exception as exc:
        return {
            "status": "error",
            "tests": [],
            "stdout": "",
            "stderr": f"Runner setup failed: {exc}",
            "duration_ms": round((time.perf_counter() - started) * 1000, 2),
        }

    stdout_text = completed.stdout.strip()
    stderr_text = completed.stderr.strip()
    if completed.returncode != 0 and not stdout_text:
        return {
            "status": "error",
            "tests": [],
            "stdout": "",
            "stderr": stderr_text or "Python returned an error before tests could run.",
            "duration_ms": round((time.perf_counter() - started) * 1000, 2),
        }

    try:
        payload = json.loads(stdout_text.splitlines()[-1])
    except Exception:
        return {
            "status": "error",
            "tests": [],
            "stdout": stdout_text,
            "stderr": stderr_text or "Runner output could not be parsed.",
            "duration_ms": round((time.perf_counter() - started) * 1000, 2),
        }

    result_tests = payload.get("tests", [])
    passed = sum(1 for item in result_tests if item.get("passed"))
    total = len(result_tests)
    return {
        "status": payload.get("status", "error"),
        "passed": passed,
        "total": total,
        "tests": result_tests,
        "stdout": payload.get("stdout", ""),
        "stderr": payload.get("error") or payload.get("warning") or stderr_text,
        "duration_ms": payload.get("duration_ms", round((time.perf_counter() - started) * 1000, 2)),
    }


def run_javascript_practice_tests(code: str, function_name: str, tests: list[dict[str, Any]]) -> dict[str, Any]:
    runner_source = r"""
const fs = require("fs");
const vm = require("vm");
const { performance } = require("perf_hooks");

const payload = JSON.parse(fs.readFileSync(0, "utf8") || "{}");
const tests = payload.tests || [];
const functionName = payload.function_name;
const started = performance.now();
const logs = [];
const sandbox = {
  console: {
    log: (...args) => logs.push(args.map((arg) => typeof arg === "string" ? arg : JSON.stringify(arg)).join(" ")),
    error: (...args) => logs.push(args.map(String).join(" ")),
  },
};

function cleanStudentCode(source) {
  return String(source)
    .replace(/^\s*export\s+\{\s*[\w\s,]+\s*\};?\s*$/gm, "")
    .replace(/^\s*export\s+default\s+/gm, "")
    .replace(/^\s*export\s+(function|const|let|var|class)\s+/gm, "$1 ");
}

function captureFinalExpression(source) {
  const lines = String(source).replace(/\s+$/g, "").split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const rawLine = lines[index];
    const line = rawLine.trim();
    if (!line || line.startsWith("//")) continue;
    if (/^(function|class|const|let|var|if|for|while|switch|return|throw|try|catch|finally)\b/.test(line)) {
      return { source: lines.join("\n"), capturesExpression: false };
    }
    if (/^[}\])]/.test(line)) {
      return { source: lines.join("\n"), capturesExpression: false };
    }
    const expression = line.replace(/;$/, "");
    lines[index] = `${rawLine.slice(0, rawLine.length - rawLine.trimStart().length)}__csnavLastValue = (${expression});`;
    return { source: lines.join("\n"), capturesExpression: true };
  }
  return { source: lines.join("\n"), capturesExpression: false };
}

try {
  vm.createContext(sandbox);
  sandbox.__csnavLastValue = undefined;
  const prepared = captureFinalExpression(cleanStudentCode(fs.readFileSync("solution.js", "utf8")));
  vm.runInContext(prepared.source, sandbox, { timeout: 1000 });
  if (prepared.capturesExpression && typeof sandbox.__csnavLastValue !== "undefined") {
    logs.push(typeof sandbox.__csnavLastValue === "string" ? sandbox.__csnavLastValue : JSON.stringify(sandbox.__csnavLastValue));
  }

  let target = sandbox[functionName];
  let warning = "";
  if (typeof target !== "function" && typeof sandbox.solve === "function") {
    target = sandbox.solve;
    warning = `Expected function '${functionName}' was not found, so the runner used 'solve' instead. Rename your function to '${functionName}' for this problem.`;
  }
  if (typeof target !== "function") {
    const available = Object.keys(sandbox).filter((key) => typeof sandbox[key] === "function");
    if (available.length === 1) {
      target = sandbox[available[0]];
      warning = `Expected function '${functionName}' was not found, so the runner used your only defined function. Rename it to '${functionName}' for this problem.`;
    } else {
      throw new Error(`Could not find function '${functionName}'. Available student functions: ${available.join(", ") || "none"}`);
    }
  }

  const results = tests.map((test, index) => {
    const name = test.name || `Test ${index + 1}`;
    const args = test.args || [];
    const expected = test.expected;
    try {
      const actual = target(...args);
      const passed = JSON.stringify(actual) === JSON.stringify(expected);
      return { name, passed, args, expected, actual };
    } catch (error) {
      return { name, passed: false, args, expected, actual: null, error: String(error.message || error) };
    }
  });

  const passedCount = results.filter((item) => item.passed).length;
  process.stdout.write(JSON.stringify({
    status: passedCount === results.length ? "passed" : "failed",
    tests: results,
    stdout: logs.join("\n"),
    warning,
    duration_ms: Math.round((performance.now() - started) * 100) / 100,
  }));
} catch (error) {
  process.stdout.write(JSON.stringify({
    status: "error",
    error: String(error.message || error),
    tests: [],
    stdout: logs.join("\n"),
    duration_ms: Math.round((performance.now() - started) * 100) / 100,
  }));
}
"""
    started = time.perf_counter()
    try:
        with tempfile.TemporaryDirectory(prefix="csnav_practice_js_") as temp_dir:
            solution_path = os.path.join(temp_dir, "solution.js")
            runner_path = os.path.join(temp_dir, "runner.js")
            with open(solution_path, "w", encoding="utf-8") as handle:
                handle.write(code)
            with open(runner_path, "w", encoding="utf-8") as handle:
                handle.write(runner_source)

            node_env = {
                key: value
                for key, value in os.environ.items()
                if key.upper() in {"PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "TEMP", "TMP"}
            }
            node_env["NODE_DISABLE_COLORS"] = "1"
            completed = subprocess.run(
                ["node", runner_path],
                cwd=temp_dir,
                input=json.dumps({"function_name": function_name, "tests": tests}),
                text=True,
                capture_output=True,
                timeout=4,
                env=node_env,
            )
    except FileNotFoundError:
        return {
            "status": "error",
            "tests": [],
            "stdout": "",
            "stderr": "Node.js was not found, so JavaScript tests cannot run locally yet.",
            "duration_ms": round((time.perf_counter() - started) * 1000, 2),
        }
    except subprocess.TimeoutExpired:
        return {
            "status": "error",
            "tests": [],
            "stdout": "",
            "stderr": "The JavaScript run timed out after 4 seconds. Check for infinite loops or very slow logic.",
            "duration_ms": round((time.perf_counter() - started) * 1000, 2),
        }
    except Exception as exc:
        return {
            "status": "error",
            "tests": [],
            "stdout": "",
            "stderr": f"JavaScript runner setup failed: {exc}",
            "duration_ms": round((time.perf_counter() - started) * 1000, 2),
        }

    stdout_text = completed.stdout.strip()
    stderr_text = completed.stderr.strip()
    if completed.returncode != 0 and not stdout_text:
        return {
            "status": "error",
            "tests": [],
            "stdout": "",
            "stderr": stderr_text or "Node returned an error before tests could run.",
            "duration_ms": round((time.perf_counter() - started) * 1000, 2),
        }

    try:
        payload = json.loads(stdout_text.splitlines()[-1])
    except Exception:
        return {
            "status": "error",
            "tests": [],
            "stdout": stdout_text,
            "stderr": stderr_text or "JavaScript runner output could not be parsed.",
            "duration_ms": round((time.perf_counter() - started) * 1000, 2),
        }

    result_tests = payload.get("tests", [])
    passed = sum(1 for item in result_tests if item.get("passed"))
    total = len(result_tests)
    return {
        "status": payload.get("status", "error"),
        "passed": passed,
        "total": total,
        "tests": result_tests,
        "stdout": payload.get("stdout", ""),
        "stderr": payload.get("error") or payload.get("warning") or stderr_text,
        "duration_ms": payload.get("duration_ms", round((time.perf_counter() - started) * 1000, 2)),
    }
