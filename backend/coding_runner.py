import ast
import json
import hashlib
import math
import os
import re
import signal
import subprocess
import sys
import tempfile
import time
from collections import defaultdict, deque
from typing import Any
from threading import Lock


RUN_RESULT_CACHE_TTL_SECONDS = 600
RUN_RESULT_CACHE_MAX_SIZE = 200
RUN_TIMEOUT_SECONDS = 4
RUN_MAX_OUTPUT_CHARS = 12000
RUN_MAX_VALUE_CHARS = 4000
RUN_RATE_LIMIT = 12
RUN_RATE_WINDOW_SECONDS = 60
RUN_MEMORY_LIMIT_BYTES = 512 * 1024 * 1024
RUN_FILE_SIZE_LIMIT_BYTES = 1024 * 1024

PYTHON_ALLOWED_IMPORTS = {
    "bisect",
    "collections",
    "functools",
    "heapq",
    "itertools",
    "math",
    "operator",
    "re",
    "statistics",
    "string",
    "typing",
}
PYTHON_BLOCKED_NAMES = {
    "__builtins__",
    "__import__",
    "breakpoint",
    "compile",
    "delattr",
    "dir",
    "eval",
    "exec",
    "getattr",
    "globals",
    "help",
    "input",
    "locals",
    "open",
    "setattr",
    "vars",
}
PYTHON_BLOCKED_ATTRIBUTES = {
    "connect",
    "fork",
    "kill",
    "popen",
    "remove",
    "rmdir",
    "spawn",
    "system",
    "unlink",
}
JAVASCRIPT_BLOCKED_PATTERNS = (
    (re.compile(r"\brequire\s*\("), "Module loading is not available in the practice runner."),
    (re.compile(r"\bimport\s*(?:\(|[\s{*])"), "Module loading is not available in the practice runner."),
    (re.compile(r"\b(?:process|Deno|Bun)\b"), "Runtime process access is not available in the practice runner."),
    (re.compile(r"\b(?:fetch|WebSocket|XMLHttpRequest)\b"), "Network access is not available in the practice runner."),
    (re.compile(r"(?:__proto__|\bprototype\b|\bconstructor\b)"), "Prototype and constructor access is not available in the practice runner."),
    (re.compile(r"\b(?:eval|Function)\s*\("), "Dynamic code generation is not available in the practice runner."),
)

_run_result_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_run_result_cache_lock = Lock()
_run_rate_limits: dict[str, deque[float]] = defaultdict(deque)
_run_rate_limit_lock = Lock()


class RunnerSecurityError(ValueError):
    pass


def check_practice_run_rate_limit(
    user_key: str,
    *,
    limit: int = RUN_RATE_LIMIT,
    window_seconds: int = RUN_RATE_WINDOW_SECONDS,
) -> int | None:
    """Return retry-after seconds when a user exceeds the runner limit."""
    now = time.monotonic()
    with _run_rate_limit_lock:
        timestamps = _run_rate_limits[str(user_key)]
        while timestamps and now - timestamps[0] >= window_seconds:
            timestamps.popleft()
        if len(timestamps) >= limit:
            return max(1, math.ceil(window_seconds - (now - timestamps[0])))
        timestamps.append(now)

        if len(_run_rate_limits) > 10000:
            stale_keys = [
                key
                for key, values in _run_rate_limits.items()
                if not values or now - values[-1] >= window_seconds
            ]
            for key in stale_keys:
                _run_rate_limits.pop(key, None)
    return None


def validate_python_code(code: str) -> None:
    try:
        tree = ast.parse(code)
    except SyntaxError as exc:
        raise RunnerSecurityError(f"Python syntax error: {exc.msg} (line {exc.lineno}).") from exc

    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            modules = []
            if isinstance(node, ast.Import):
                modules = [alias.name for alias in node.names]
            elif node.module:
                modules = [node.module]
            for module_name in modules:
                root_module = module_name.split(".", 1)[0]
                if root_module not in PYTHON_ALLOWED_IMPORTS:
                    raise RunnerSecurityError(
                        f"Importing '{root_module}' is not available in the practice runner."
                    )
        elif isinstance(node, ast.Name) and node.id in PYTHON_BLOCKED_NAMES:
            raise RunnerSecurityError(
                f"'{node.id}' is not available in the practice runner."
            )
        elif isinstance(node, ast.Attribute):
            if node.attr.startswith("__") or node.attr in PYTHON_BLOCKED_ATTRIBUTES:
                raise RunnerSecurityError(
                    f"Attribute access '{node.attr}' is not available in the practice runner."
                )


def validate_javascript_code(code: str) -> None:
    for pattern, message in JAVASCRIPT_BLOCKED_PATTERNS:
        if pattern.search(code):
            raise RunnerSecurityError(message)


def _security_error_response(exc: RunnerSecurityError) -> dict[str, Any]:
    message = f"Runner security check blocked this code: {exc}"
    return {
        "status": "error",
        "tests": [],
        "stdout": "",
        "stderr": message,
        "duration_ms": 0,
    }


def _truncate_text(value: Any, limit: int = RUN_MAX_OUTPUT_CHARS) -> str:
    text = "" if value is None else str(value)
    if len(text) <= limit:
        return text
    return f"{text[:limit]}\n... output truncated by CS Navigator ..."


def _limit_subprocess_resources() -> None:
    """Apply Linux resource limits in the child before student code starts."""
    if os.name != "posix":
        return
    import resource

    resource.setrlimit(resource.RLIMIT_CPU, (2, 3))
    resource.setrlimit(resource.RLIMIT_AS, (RUN_MEMORY_LIMIT_BYTES, RUN_MEMORY_LIMIT_BYTES))
    resource.setrlimit(resource.RLIMIT_FSIZE, (RUN_FILE_SIZE_LIMIT_BYTES, RUN_FILE_SIZE_LIMIT_BYTES))
    resource.setrlimit(resource.RLIMIT_NOFILE, (16, 16))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))


def _subprocess_security_kwargs() -> dict[str, Any]:
    kwargs: dict[str, Any] = {"start_new_session": True}
    if os.name == "posix":
        kwargs["preexec_fn"] = _limit_subprocess_resources
    return kwargs


def _run_isolated_process(
    command: list[str],
    *,
    cwd: str,
    input_text: str,
    env: dict[str, str],
) -> subprocess.CompletedProcess[str]:
    process = subprocess.Popen(
        command,
        cwd=cwd,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env=env,
        **_subprocess_security_kwargs(),
    )
    try:
        stdout, stderr = process.communicate(
            input=input_text,
            timeout=RUN_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired:
        if os.name == "posix":
            os.killpg(process.pid, signal.SIGKILL)
        else:
            process.kill()
        process.communicate()
        raise
    return subprocess.CompletedProcess(command, process.returncode, stdout, stderr)


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
    try:
        validate_python_code(code)
    except RunnerSecurityError as exc:
        return _security_error_response(exc)

    runner_source = """
import ast
import builtins
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
MAX_OUTPUT_CHARS = 12000
MAX_VALUE_CHARS = 4000
ALLOWED_IMPORTS = {
    "bisect", "collections", "functools", "heapq", "itertools", "math",
    "operator", "re", "statistics", "string", "typing",
}
SAFE_MODULE_CACHE = {}

class CappedTextIO(io.TextIOBase):
    def __init__(self, limit):
        self.limit = limit
        self.parts = []
        self.length = 0
        self.truncated = False

    def write(self, value):
        text = str(value)
        remaining = self.limit - self.length
        if remaining > 0:
            chunk = text[:remaining]
            self.parts.append(chunk)
            self.length += len(chunk)
        if len(text) > max(remaining, 0):
            self.truncated = True
        return len(text)

    def getvalue(self):
        text = "".join(self.parts)
        if self.truncated:
            text += "\\n... output truncated by CS Navigator ..."
        return text

stdout_buffer = CappedTextIO(MAX_OUTPUT_CHARS)

def safe_import(name, globals=None, locals=None, fromlist=(), level=0):
    root = str(name).split(".", 1)[0]
    if root not in ALLOWED_IMPORTS:
        raise ImportError(f"Importing '{root}' is not available in the practice runner.")
    if root not in SAFE_MODULE_CACHE:
        source_module = builtins.__import__(root)
        safe_exports = {
            export_name: getattr(source_module, export_name)
            for export_name in dir(source_module)
            if not export_name.startswith("_")
            and not isinstance(getattr(source_module, export_name), types.ModuleType)
            and export_name not in {"attrgetter", "methodcaller"}
        }
        SAFE_MODULE_CACHE[root] = types.SimpleNamespace(**safe_exports)
    return SAFE_MODULE_CACHE[root]

SAFE_BUILTINS = {
    "__build_class__": builtins.__build_class__,
    "__import__": safe_import,
    "abs": abs, "all": all, "any": any, "bool": bool, "callable": callable,
    "chr": chr, "complex": complex, "dict": dict, "divmod": divmod,
    "enumerate": enumerate, "filter": filter, "float": float, "format": format,
    "frozenset": frozenset, "hash": hash, "hex": hex, "int": int, "isinstance": isinstance,
    "issubclass": issubclass, "iter": iter, "len": len, "list": list, "map": map,
    "max": max, "min": min, "next": next, "object": object, "oct": oct,
    "ord": ord, "pow": pow, "print": print, "range": range, "repr": repr,
    "reversed": reversed, "round": round, "set": set, "slice": slice,
    "sorted": sorted, "str": str, "sum": sum, "super": super, "tuple": tuple,
    "zip": zip,
    "ArithmeticError": ArithmeticError, "AssertionError": AssertionError,
    "Exception": Exception, "IndexError": IndexError, "KeyError": KeyError,
    "LookupError": LookupError, "RuntimeError": RuntimeError, "StopIteration": StopIteration,
    "TypeError": TypeError, "ValueError": ValueError, "ZeroDivisionError": ZeroDivisionError,
}

def display_value(value):
    try:
        raw = json.dumps(value, default=repr)
    except Exception:
        raw = repr(value)
    if len(raw) <= MAX_VALUE_CHARS:
        return value
    return raw[:MAX_VALUE_CHARS] + "... value truncated ..."

def execute_student_module(path):
    with open(path, "r", encoding="utf-8") as handle:
        source = handle.read()
    tree = ast.parse(source, filename=path)
    module = types.ModuleType("student_solution")
    module.__file__ = path
    module.__name__ = "student_solution"
    module.__dict__["__builtins__"] = SAFE_BUILTINS
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
            "actual": display_value(actual),
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

            completed = _run_isolated_process(
                [sys.executable, "-I", "-S", runner_path],
                cwd=temp_dir,
                input_text=json.dumps({"function_name": function_name, "tests": tests}),
                env={"PYTHONIOENCODING": "utf-8"},
            )
    except subprocess.TimeoutExpired:
        return {
            "status": "error",
            "tests": [],
            "stdout": "",
            "stderr": f"The run timed out after {RUN_TIMEOUT_SECONDS} seconds. Check for infinite loops or very slow logic.",
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
    stderr_text = _truncate_text(completed.stderr.strip())
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
            "stdout": _truncate_text(stdout_text),
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
        "stdout": _truncate_text(payload.get("stdout", "")),
        "stderr": _truncate_text(payload.get("error") or payload.get("warning") or stderr_text),
        "duration_ms": payload.get("duration_ms", round((time.perf_counter() - started) * 1000, 2)),
    }


def run_javascript_practice_tests(code: str, function_name: str, tests: list[dict[str, Any]]) -> dict[str, Any]:
    try:
        validate_javascript_code(code)
    except RunnerSecurityError as exc:
        return _security_error_response(exc)

    runner_source = r"""
const fs = require("fs");
const vm = require("vm");
const { performance } = require("perf_hooks");

const payload = JSON.parse(fs.readFileSync(0, "utf8") || "{}");
const tests = payload.tests || [];
const functionName = payload.function_name;
const started = performance.now();
const logs = [];
const MAX_OUTPUT_CHARS = 12000;
const MAX_VALUE_CHARS = 4000;
let logLength = 0;
let logsTruncated = false;

function appendLog(value) {
  const text = String(value);
  const remaining = MAX_OUTPUT_CHARS - logLength;
  if (remaining > 0) {
    logs.push(text.slice(0, remaining));
    logLength += Math.min(text.length, remaining);
  }
  if (text.length > Math.max(remaining, 0)) logsTruncated = true;
}

function displayValue(value) {
  let raw;
  try {
    raw = JSON.stringify(value);
  } catch {
    raw = String(value);
  }
  if (typeof raw === "undefined") raw = "undefined";
  return raw.length <= MAX_VALUE_CHARS ? value : `${raw.slice(0, MAX_VALUE_CHARS)}... value truncated ...`;
}

const sandbox = {
  console: {
    log: (...args) => appendLog(args.map((arg) => typeof arg === "string" ? arg : JSON.stringify(arg)).join(" ")),
    error: (...args) => appendLog(args.map(String).join(" ")),
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
  vm.createContext(sandbox, {
    codeGeneration: { strings: false, wasm: false },
  });
  sandbox.__csnavLastValue = undefined;
  const prepared = captureFinalExpression(cleanStudentCode(fs.readFileSync("solution.js", "utf8")));
  vm.runInContext(prepared.source, sandbox, { timeout: 1000 });
  if (prepared.capturesExpression && typeof sandbox.__csnavLastValue !== "undefined") {
    appendLog(typeof sandbox.__csnavLastValue === "string" ? sandbox.__csnavLastValue : JSON.stringify(sandbox.__csnavLastValue));
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
      return { name, passed, args, expected, actual: displayValue(actual) };
    } catch (error) {
      return { name, passed: false, args, expected, actual: null, error: String(error.message || error) };
    }
  });

  const passedCount = results.filter((item) => item.passed).length;
  process.stdout.write(JSON.stringify({
    status: passedCount === results.length ? "passed" : "failed",
    tests: results,
    stdout: logs.join("\n") + (logsTruncated ? "\n... output truncated by CS Navigator ..." : ""),
    warning,
    duration_ms: Math.round((performance.now() - started) * 100) / 100,
  }));
} catch (error) {
  process.stdout.write(JSON.stringify({
    status: "error",
    error: String(error.message || error),
    tests: [],
    stdout: logs.join("\n") + (logsTruncated ? "\n... output truncated by CS Navigator ..." : ""),
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
            completed = _run_isolated_process(
                [
                    "node",
                    "--max-old-space-size=128",
                    "--disable-proto=delete",
                    "--disallow-code-generation-from-strings",
                    runner_path,
                ],
                cwd=temp_dir,
                input_text=json.dumps({"function_name": function_name, "tests": tests}),
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
            "stderr": f"The JavaScript run timed out after {RUN_TIMEOUT_SECONDS} seconds. Check for infinite loops or very slow logic.",
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
    stderr_text = _truncate_text(completed.stderr.strip())
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
            "stdout": _truncate_text(stdout_text),
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
        "stdout": _truncate_text(payload.get("stdout", "")),
        "stderr": _truncate_text(payload.get("error") or payload.get("warning") or stderr_text),
        "duration_ms": payload.get("duration_ms", round((time.perf_counter() - started) * 1000, 2)),
    }
