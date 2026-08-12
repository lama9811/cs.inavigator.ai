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

# Compiled-language guards. Java/C++ are compiled then run, so we block source
# patterns that touch the filesystem, network, processes, or reflection before
# they ever reach the compiler.
JAVA_BLOCKED_PATTERNS = (
    (re.compile(r"\bimport\s+(?!java\.(?:util|lang|math|text)\b)"), "Only java.util, java.lang, java.math, and java.text imports are available in the practice runner."),
    (re.compile(r"\b(?:Runtime|ProcessBuilder|System\s*\.\s*exit)\b"), "Process and runtime access is not available in the practice runner."),
    (re.compile(r"\b(?:java\s*\.\s*io|FileReader|FileWriter|FileInputStream|FileOutputStream|RandomAccessFile|Files)\b"), "File access is not available in the practice runner."),
    (re.compile(r"\b(?:java\s*\.\s*net|Socket|ServerSocket|URL|URLConnection|HttpClient)\b"), "Network access is not available in the practice runner."),
    (re.compile(r"\b(?:java\s*\.\s*lang\s*\.\s*reflect|getClass\s*\(|Class\s*\.\s*forName)\b"), "Reflection is not available in the practice runner."),
    (re.compile(r"\bThread\b|\bRuntime\.getRuntime\b"), "Threads and runtime access are not available in the practice runner."),
    # Environment snooping, classloading, native methods, and internal JDK access
    # are routes around the guards above; block them at the source.
    (re.compile(r"\bSystem\s*\.\s*(?:getenv|getProperties|getProperty|load|loadLibrary)\b"), "System environment and library access is not available in the practice runner."),
    (re.compile(r"\b(?:ClassLoader|URLClassLoader|MethodHandles|VarHandle)\b"), "Classloading and method-handle access is not available in the practice runner."),
    (re.compile(r"\b(?:sun\s*\.|jdk\s*\.\s*internal|Unsafe)\b"), "Internal JDK access is not available in the practice runner."),
    (re.compile(r"\bnative\s+\w"), "Native methods are not available in the practice runner."),
)
CPP_BLOCKED_PATTERNS = (
    (re.compile(r"#\s*include\s*<\s*(?:fstream|filesystem)\s*>"), "File stream access is not available in the practice runner."),
    (re.compile(r"\b(?:system|popen|fork|exec[lv][pe]?|remove|rename)\s*\("), "Process and filesystem calls are not available in the practice runner."),
    (re.compile(r"#\s*include\s*<\s*(?:cstdio|stdio\.h)\s*>.*\b(?:fopen|fread|fwrite|freopen)\b", re.DOTALL), "File access is not available in the practice runner."),
    (re.compile(r"\b(?:socket|connect|bind|listen|accept|getaddrinfo|gethostbyname|inet_addr|inet_pton)\s*\("), "Network access is not available in the practice runner."),
    (re.compile(r"\b(?:asm|__asm__|__asm)\b"), "Inline assembly is not available in the practice runner."),
    (re.compile(r"#\s*include\s*<\s*thread\s*>|\bstd\s*::\s*thread\b"), "Threads are not available in the practice runner."),
    # Raw syscalls + dynamic loading + environment snooping let native code bypass
    # the higher-level guards above, so block them at the source.
    (re.compile(r"\bsyscall\s*\("), "Raw system calls are not available in the practice runner."),
    (re.compile(r"\b(?:dlopen|dlsym|dlmopen)\s*\("), "Dynamic library loading is not available in the practice runner."),
    (re.compile(r"\b(?:getenv|secure_getenv|setenv|putenv|environ)\b"), "Environment access is not available in the practice runner."),
    (re.compile(r"#\s*include\s*<\s*(?:sys/socket\.h|netinet/|arpa/inet\.h|netdb\.h|dlfcn\.h|sys/ptrace\.h|sys/syscall\.h|unistd\.h)\s*>?"), "Low-level system headers are not available in the practice runner."),
    (re.compile(r"\b(?:ptrace|mmap|mprotect)\s*\("), "Low-level memory and process calls are not available in the practice runner."),
)

# Compile step gets its own (longer) timeout than execution.
COMPILE_TIMEOUT_SECONDS = 10

# Compiled-binary runners (Java/C++) execute native machine code, so they get an
# extra layer of OS-level hardening beyond the source blocklists. This gate lets
# an operator turn them OFF entirely in an environment where running native code
# is unacceptable (set ALLOW_COMPILED_RUNNERS=false). Default ON — the hardening
# below makes them safe for Cloud Run.
def compiled_runners_enabled() -> bool:
    raw = os.getenv("ALLOW_COMPILED_RUNNERS", "true").strip().lower()
    return raw not in {"false", "0", "no", "off"}


COMPILED_RUNNERS_DISABLED_MESSAGE = (
    "Compiled-language runners (Java and C++) are disabled in this environment. "
    "Use Python or JavaScript, which run in a stricter in-process sandbox."
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


def validate_java_code(code: str) -> None:
    for pattern, message in JAVA_BLOCKED_PATTERNS:
        if pattern.search(code):
            raise RunnerSecurityError(message)


def validate_cpp_code(code: str) -> None:
    for pattern, message in CPP_BLOCKED_PATTERNS:
        if pattern.search(code):
            raise RunnerSecurityError(message)


def _find_executable(*names: str) -> str | None:
    """Return the first available executable from `names`, or None."""
    import shutil
    for name in names:
        path = shutil.which(name)
        if path:
            return path
    return None


def _security_error_response(exc: RunnerSecurityError) -> dict[str, Any]:
    message = f"Runner security check blocked this code: {exc}"
    return {
        "status": "error",
        "tests": [],
        "stdout": "",
        "stderr": message,
        "duration_ms": 0,
    }


def _empty_trace_v2_payload() -> dict[str, Any]:
    return {
        "schema_version": "trace_v2",
        "steps": [],
        "limits": {},
    }


def _trace_scalar_binding(value: Any, *, value_type: str | None = None) -> dict[str, Any]:
    return {
        "kind": "scalar",
        "type": value_type or type(value).__name__,
        "value": value,
        "display": _truncate_text(value, RUN_MAX_VALUE_CHARS),
    }


def _trace_bindings_from_pairs(pairs: list[dict[str, Any]] | tuple[dict[str, Any], ...] | None) -> dict[str, dict[str, Any]]:
    bindings: dict[str, dict[str, Any]] = {}
    for item in pairs or []:
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        bindings[name] = _trace_scalar_binding(item.get("value", ""), value_type="argument")
    return bindings


def _compiled_trace_bindings(
    arg_bindings: list[dict[str, Any]],
    runtime_vars: list[dict[str, Any]] | None,
) -> dict[str, dict[str, Any]]:
    bindings = _trace_bindings_from_pairs(arg_bindings)
    for item in runtime_vars or []:
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        value = _truncate_text(str(item.get("value", "")), RUN_MAX_VALUE_CHARS)
        bindings[name] = _trace_scalar_binding(value, value_type="runtime")
    return bindings


def _compiled_trace_binding_changes(
    frame_name: str,
    bindings: dict[str, dict[str, Any]],
    previous_bindings: dict[str, dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    changes: list[dict[str, Any]] = []
    previous_bindings = previous_bindings or {}
    for name, binding in bindings.items():
        previous = previous_bindings.get(name)
        if previous is None or previous.get("display") != binding.get("display"):
            changes.append({
                "frame": frame_name,
                "name": name,
                "change": "bound" if previous is None else "updated",
            })
    return changes


def _normalize_trace_v2_frames(trace_v2: dict[str, Any] | None) -> dict[str, Any]:
    payload = dict(trace_v2 or _empty_trace_v2_payload())
    payload["schema_version"] = "trace_v2"
    payload["steps"] = list(payload.get("steps") or [])
    payload["limits"] = dict(payload.get("limits") or {})
    for step in payload["steps"]:
        frames = []
        for index, frame in enumerate(step.get("frames") or []):
            normalized = dict(frame or {})
            function_name = normalized.get("function") or normalized.get("name") or step.get("function") or "trace"
            normalized["function"] = function_name
            normalized.setdefault("frame_id", f"frame_{index + 1}")
            raw_bindings = normalized.get("bindings") or {}
            if isinstance(raw_bindings, list):
                normalized["bindings"] = _trace_bindings_from_pairs(raw_bindings)
            elif isinstance(raw_bindings, dict):
                normalized["bindings"] = raw_bindings
            else:
                normalized["bindings"] = {}
            frames.append(normalized)
        step["frames"] = frames
        if not isinstance(step.get("objects"), dict):
            step["objects"] = {}
        if not isinstance(step.get("references"), list):
            step["references"] = []
    return payload


def _with_trace_v2_metadata(
    trace_v2: dict[str, Any] | None,
    *,
    language: str,
    requested_language: str | None = None,
    capability: str = "practice_and_freeform",
    trace_mode: str = "practice",
) -> dict[str, Any]:
    payload = _normalize_trace_v2_frames(trace_v2)
    payload["language"] = language
    payload["requested_language"] = requested_language or language
    payload["capability"] = capability
    payload["trace_mode"] = trace_mode
    return payload


def _trace_capability_error_response(
    message: str,
    *,
    language: str,
    requested_language: str | None = None,
    capability: str = "unsupported",
    trace_mode: str = "unavailable",
) -> dict[str, Any]:
    return {
        "status": "error",
        "trace": [],
        "trace_v2": _with_trace_v2_metadata(
            _empty_trace_v2_payload(),
            language=language,
            requested_language=requested_language,
            capability=capability,
            trace_mode=trace_mode,
        ),
        "stdout": "",
        "stderr": message,
        "message": message,
        "duration_ms": 0,
    }


def _truncate_text(value: Any, limit: int = RUN_MAX_OUTPUT_CHARS) -> str:
    text = "" if value is None else str(value)
    if len(text) <= limit:
        return text
    return f"{text[:limit]}\n... output truncated by CS Navigator ..."


# Best-effort kernel-level network isolation for the child process. On Linux,
# unshare(CLONE_NEWNET) drops the child into a fresh, empty network namespace
# (loopback only, no route out) — so even if native code opens a socket, packets
# go nowhere. It needs an unprivileged-user-namespace kernel (CLONE_NEWUSER) on
# locked-down hosts; where that's unavailable (e.g. some Cloud Run kernels) the
# call raises and we continue WITHOUT it — the source blocklists, scrubbed env,
# and blackholed DNS still apply, so we never weaken on failure, we just can't add
# this extra layer. Returns True if the namespace was created.
_CLONE_NEWNET = 0x40000000
_CLONE_NEWUSER = 0x10000000


def _try_unshare_network() -> bool:
    if os.name != "posix":
        return False
    try:
        import ctypes
        libc = ctypes.CDLL("libc.so.6", use_errno=True)
        # Try a user namespace first (lets an unprivileged process get NEWNET on
        # many hardened kernels); ignore failure and still attempt NEWNET alone.
        libc.unshare(_CLONE_NEWUSER)
        if libc.unshare(_CLONE_NEWNET) == 0:
            return True
    except Exception:
        pass
    return False


# Process-hardening flags applied in the child before exec, regardless of net.
def _apply_no_new_privs() -> None:
    # PR_SET_NO_NEW_PRIVS=1: the child (and anything it execs) can never gain
    # privileges via setuid/setgid binaries — closes a privilege-escalation path.
    if os.name != "posix":
        return
    try:
        import ctypes
        libc = ctypes.CDLL("libc.so.6", use_errno=True)
        PR_SET_NO_NEW_PRIVS = 38
        libc.prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0)
    except Exception:
        pass


# The JVM reserves a very large VIRTUAL address space at startup (code cache,
# metaspace, thread stacks, mapped libs) — far more than its physical heap — so a
# tight RLIMIT_AS kills javac/java before they run. JVM memory is bounded instead
# by -Xmx on the java command. C++ binaries are fine with the strict AS cap.
#
# harden=True adds the no-new-privs flag and a best-effort network-namespace
# unshare — used for compiled (native-code) runs, which warrant the extra OS-level
# defense beyond the source blocklists.
def _make_resource_limiter(*, as_bytes: int | None, nofile: int = 16, harden: bool = False):
    def _apply() -> None:
        if os.name != "posix":
            return
        import resource
        if harden:
            # Drop privileges-on-exec and isolate the network before limits, so
            # the rest still applies even if these are no-ops on this kernel.
            _apply_no_new_privs()
            _try_unshare_network()
        resource.setrlimit(resource.RLIMIT_CPU, (5, 6))
        if as_bytes is not None:
            resource.setrlimit(resource.RLIMIT_AS, (as_bytes, as_bytes))
        resource.setrlimit(resource.RLIMIT_FSIZE, (RUN_FILE_SIZE_LIMIT_BYTES, RUN_FILE_SIZE_LIMIT_BYTES))
        resource.setrlimit(resource.RLIMIT_NOFILE, (nofile, nofile))
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    return _apply


# Default profile: strict address-space cap (Python/JS/native binaries).
_limit_subprocess_resources = _make_resource_limiter(as_bytes=RUN_MEMORY_LIMIT_BYTES, nofile=16)
# JVM profile: no RLIMIT_AS (JVM self-limits via -Xmx), more file descriptors.
_limit_jvm_resources = _make_resource_limiter(as_bytes=None, nofile=256)
# Hardened profiles for COMPILED runs (native code): same limits + no-new-privs
# + best-effort network unshare. C++ keeps the strict AS cap; Java/JVM does not.
_limit_cpp_hardened = _make_resource_limiter(as_bytes=RUN_MEMORY_LIMIT_BYTES, nofile=16, harden=True)
_limit_jvm_hardened = _make_resource_limiter(as_bytes=None, nofile=256, harden=True)


def _subprocess_security_kwargs(limiter=None) -> dict[str, Any]:
    kwargs: dict[str, Any] = {"start_new_session": True}
    if os.name == "posix":
        kwargs["preexec_fn"] = limiter or _limit_subprocess_resources
    return kwargs


def _hardened_compiled_env(base: dict[str, str]) -> dict[str, str]:
    """Minimal env for compiled (native) runs: PATH only, plus DNS/proxy values
    pointed at dead addresses so a resolver or HTTP client reaches nothing even
    if the network namespace unshare wasn't available on this kernel. We never
    inherit the parent's full environment, so no secrets/tokens leak to the child.
    """
    env = {"PATH": base.get("PATH", os.environ.get("PATH", ""))}
    # Blackhole common egress paths. These are belt-and-suspenders on top of the
    # network unshare + source blocklists.
    env["http_proxy"] = "http://127.0.0.1:9"
    env["https_proxy"] = "http://127.0.0.1:9"
    env["HTTP_PROXY"] = "http://127.0.0.1:9"
    env["HTTPS_PROXY"] = "http://127.0.0.1:9"
    env["no_proxy"] = ""
    # Keep locale sane for compilers; nothing security-relevant.
    env["LC_ALL"] = base.get("LC_ALL", "C")
    return env


def _run_isolated_process(
    command: list[str],
    *,
    cwd: str,
    input_text: str,
    env: dict[str, str],
    limiter=None,
) -> subprocess.CompletedProcess[str]:
    process = subprocess.Popen(
        command,
        cwd=cwd,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env=env,
        **_subprocess_security_kwargs(limiter),
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


def _compile_source(
    command: list[str],
    *,
    cwd: str,
    env: dict[str, str] | None = None,
    limiter=None,
) -> subprocess.CompletedProcess[str]:
    """Compile step for Java/C++. Longer timeout than execution; no stdin."""
    # The hardened env scrubs TEMP/TMP, but compilers (g++/MinGW especially) need a
    # writable temp dir for intermediate files. Point them at the isolated compile
    # dir itself — writable, sandboxed, and cleaned up with it. No secrets leak.
    if env is not None:
        env = {**env, "TMPDIR": cwd, "TMP": cwd, "TEMP": cwd}
    process = subprocess.Popen(
        command,
        cwd=cwd,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env=env,
        **_subprocess_security_kwargs(limiter),
    )
    try:
        stdout, stderr = process.communicate(timeout=COMPILE_TIMEOUT_SECONDS)
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
    "abs": abs, "all": all, "any": any, "bin": bin, "bool": bool, "callable": callable,
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

def _canon(value, order_insensitive=False, case_insensitive=False):
    # Recursively normalize values for comparison. Order-insensitive tests
    # compare by content, and authored message-style tests may opt into
    # case-insensitive string matching.
    if isinstance(value, str):
        lowered = value.casefold()
        if case_insensitive or lowered in {"none", "null"}:
            return lowered
        return value
    if isinstance(value, list):
        items = [_canon(v, order_insensitive, case_insensitive) for v in value]
        if order_insensitive:
            return sorted(items, key=lambda x: json.dumps(x, sort_keys=True, default=str))
        return items
    if isinstance(value, dict):
        return {k: _canon(v, order_insensitive, case_insensitive) for k, v in value.items()}
    return value

for index, test in enumerate(tests, start=1):
    name = test.get("name") or f"Test {index}"
    args = test.get("args", [])
    expected = test.get("expected")
    order_insensitive = bool(test.get("order_insensitive"))
    case_insensitive = bool(test.get("case_insensitive"))
    try:
        with contextlib.redirect_stdout(stdout_buffer):
            actual = target(*args)
        passed = _canon(actual, order_insensitive, case_insensitive) == _canon(expected, order_insensitive, case_insensitive)
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


def run_python_practice_trace(code: str, function_name: str, test: dict[str, Any]) -> dict[str, Any]:
    """Return a capped line trace for one Python practice test.

    This is intentionally Python-only V1. It reuses the same validation and isolated
    subprocess boundary as the grader, but it traces only the student's function call
    for one authored test case and writes no progress.
    """
    try:
        validate_python_code(code)
    except RunnerSecurityError as exc:
        response = _security_error_response(exc)
        response["trace"] = []
        response["trace_v2"] = _with_trace_v2_metadata(
            _empty_trace_v2_payload(),
            language="python",
            capability="practice_and_freeform",
            trace_mode="practice",
        )
        return response

    runner_source = """
import ast
import builtins
import contextlib
import io
import json
import linecache
import sys
import time
import types

payload = json.loads(sys.stdin.read() or "{}")
test = payload.get("test") or {}
function_name = payload.get("function_name")
started = time.perf_counter()
MAX_OUTPUT_CHARS = 12000
MAX_TRACE_STEPS = 80
MAX_LOCAL_CHARS = 120
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
    "abs": abs, "all": all, "any": any, "bin": bin, "bool": bool, "callable": callable,
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

def safe_display(value):
    try:
        raw = json.dumps(value, default=repr)
    except Exception:
        raw = repr(value)
    if len(raw) > MAX_LOCAL_CHARS:
        raw = raw[:MAX_LOCAL_CHARS] + "... truncated"
    return raw

def snapshot_locals(frame):
    out = {}
    for key, value in frame.f_locals.items():
        if key.startswith("__") or key in {"self"}:
            continue
        out[key] = safe_display(value)
        if len(out) >= 10:
            out["..."] = "locals truncated"
            break
    return out

def call_stack_for_frame(frame):
    stack = []
    current = frame
    while current is not None:
        if current.f_code.co_filename == "solution.py" and current.f_code.co_name != "<module>":
            stack.append(current.f_code.co_name)
        current = current.f_back
    return list(reversed(stack))

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
    return module

def values_equal(actual, expected, order_insensitive=False):
    def canon(value):
        if isinstance(value, list):
            items = [canon(item) for item in value]
            if order_insensitive:
                return sorted(items, key=lambda item: json.dumps(item, sort_keys=True, default=str))
            return items
        if isinstance(value, dict):
            return {key: canon(value[key]) for key in sorted(value)}
        return value
    return canon(actual) == canon(expected)

try:
    with contextlib.redirect_stdout(stdout_buffer):
        module = execute_student_module("solution.py")
    if hasattr(module, function_name):
        target = getattr(module, function_name)
        resolved_name = function_name
    elif hasattr(module, "solve"):
        target = getattr(module, "solve")
        resolved_name = "solve"
    else:
        student_functions = [
            value for name, value in vars(module).items()
            if callable(value) and getattr(value, "__module__", "") == module.__name__ and not name.startswith("_")
        ]
        if len(student_functions) == 1:
            target = student_functions[0]
            resolved_name = target.__name__
        else:
            raise AttributeError(f"module 'student_solution' has no function named '{function_name}'")
except Exception as exc:
    print(json.dumps({
        "status": "error",
        "error": f"Could not load {function_name}: {exc}",
        "trace": [],
        "stdout": stdout_buffer.getvalue(),
        "duration_ms": round((time.perf_counter() - started) * 1000, 2),
    }))
    raise SystemExit(0)

source_lines = linecache.getlines("solution.py")
TRACE_OPERATION_BY_LINE = {}

def build_operation_metadata():
    try:
        tree = ast.parse("".join(source_lines), filename="solution.py")
    except Exception:
        return {}
    operations = {}
    mutating_methods = {
        "append",
        "extend",
        "insert",
        "pop",
        "remove",
        "clear",
        "sort",
        "reverse",
        "update",
        "setdefault",
        "add",
        "discard",
    }
    transform_methods = {"lower", "upper", "strip", "split", "join", "replace"}

    def source_for(node):
        try:
            return ast.unparse(node)
        except Exception:
            return ""

    def target_name(node):
        if isinstance(node, ast.Name):
            return node.id
        if isinstance(node, ast.Attribute):
            owner = source_for(node.value)
            return f"{owner}.{node.attr}" if owner else node.attr
        if isinstance(node, ast.Subscript):
            owner = source_for(node.value) or "collection"
            index = source_for(node.slice) or "index"
            return f"{owner}[{index}]"
        if isinstance(node, (ast.Tuple, ast.List)):
            return ", ".join(target_name(item) for item in node.elts)
        return ""
    def call_name(node):
        if isinstance(node, ast.Call):
            if isinstance(node.func, ast.Attribute):
                return node.func.attr
            if isinstance(node.func, ast.Name):
                return node.func.id
        return ""
    def call_owner(node):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
            return source_for(node.func.value)
        return ""
    def has_subscript(node):
        return any(isinstance(child, ast.Subscript) for child in ast.walk(node))

    for node in ast.walk(tree):
        line_no = getattr(node, "lineno", None)
        if not line_no:
            continue
        if isinstance(node, ast.Assign):
            target = target_name(node.targets[0]) if node.targets else ""
            value_call = call_name(node.value)
            if node.targets and isinstance(node.targets[0], ast.Subscript):
                operations[line_no] = {
                    "kind": "index_write",
                    "target": target,
                    "detail": f"updates the stored value at {target}" if target else "updates one stored item",
                    "method": value_call,
                }
                continue
            if value_call in transform_methods:
                kind = "method_call"
                detail = f"runs {value_call}() and stores the result in {target}" if target else f"runs {value_call}() and stores the result"
            elif has_subscript(node.value):
                kind = "index_access"
                detail = f"reads from a collection and stores the value in {target}" if target else "reads from a collection"
            else:
                kind = "assignment"
                detail = f"stores a value in {target}" if target else "stores a value"
            operations[line_no] = {
                "kind": kind,
                "target": target,
                "detail": detail,
                "method": value_call,
            }
        elif isinstance(node, ast.AnnAssign):
            target = target_name(node.target)
            value_call = call_name(node.value) if node.value else ""
            operations[line_no] = {
                "kind": "assignment",
                "target": target,
                "detail": f"stores a value in {target}" if target else "stores a value",
                "method": value_call,
            }
        elif isinstance(node, ast.AugAssign):
            target = target_name(node.target)
            kind = "index_write" if isinstance(node.target, ast.Subscript) else "update"
            operations[line_no] = {
                "kind": kind,
                "target": target,
                "detail": f"updates {target} using its old value" if target else "updates a value",
            }
        elif isinstance(node, ast.Return):
            operations[line_no] = {"kind": "return", "target": "return value", "detail": "sends a value back to the caller"}
        elif isinstance(node, ast.For):
            operations[line_no] = {
                "kind": "loop_iteration",
                "target": target_name(node.target),
                "detail": "gets the next item for the loop variable",
                "method": call_name(node.iter),
            }
        elif isinstance(node, ast.While):
            operations[line_no] = {"kind": "condition", "target": "while condition", "detail": "checks whether the loop should keep running"}
        elif isinstance(node, ast.If):
            operations[line_no] = {"kind": "condition", "target": "if condition", "detail": "checks which branch should run"}
        elif isinstance(node, ast.Expr) and isinstance(node.value, ast.Call):
            method = call_name(node.value)
            owner = call_owner(node.value)
            kind = "output" if method == "print" else "mutation" if method in mutating_methods else "method_call"
            if kind == "mutation":
                detail = f"changes the existing object stored in {owner}" if owner else f"runs {method}() on an existing object"
            elif kind == "output":
                detail = "prints a value into the output bucket"
            else:
                detail = f"runs {method}()" if method else "runs a function call"
            operations[line_no] = {"kind": kind, "target": owner or method, "detail": detail, "method": method}
        elif isinstance(node, ast.Subscript):
            operations.setdefault(line_no, {"kind": "index_access", "target": "indexed value", "detail": "reads one item from a collection"})
    return operations

TRACE_OPERATION_BY_LINE = build_operation_metadata()
trace = []
trace_v2_object_ids = {}
trace_v2_next_object_id = 1
trace_v2_previous_step = None

def empty_trace_v2():
    return {
        "schema_version": "trace_v2",
        "steps": [],
        "limits": {
            "max_steps": MAX_TRACE_STEPS,
            "max_output_chars": MAX_OUTPUT_CHARS,
            "max_display_chars": MAX_LOCAL_CHARS,
        },
    }

def is_scalar_value(value):
    return value is None or isinstance(value, (bool, int, float, str))

def safe_type_name(value):
    try:
        return type(value).__name__
    except Exception:
        return "unknown"

def stable_trace_object_id(value):
    global trace_v2_next_object_id
    source_id = id(value)
    if source_id not in trace_v2_object_ids:
        trace_v2_object_ids[source_id] = f"obj_{trace_v2_next_object_id}"
        trace_v2_next_object_id += 1
    return trace_v2_object_ids[source_id]

def truncate_display(text):
    raw = str(text)
    if len(raw) > MAX_LOCAL_CHARS:
        return raw[:MAX_LOCAL_CHARS] + "... truncated"
    return raw

def serialize_scalar(value):
    return {
        "kind": "scalar",
        "type": safe_type_name(value),
        "value": value,
        "display": safe_display(value),
    }

def serialize_value(value, objects, depth=0):
    if is_scalar_value(value) or depth >= 2:
        return serialize_scalar(value)
    object_id = stable_trace_object_id(value)
    if object_id not in objects:
        objects[object_id] = serialize_object(value, object_id, objects, depth)
    return {
        "kind": "reference",
        "object_id": object_id,
        "type": safe_type_name(value),
        "display": safe_display(value),
    }

def serialize_object(value, object_id, objects, depth=0):
    obj_type = safe_type_name(value)
    snapshot = {
        "object_id": object_id,
        "type": obj_type,
        "repr": truncate_display(repr(value)),
    }
    try:
        if isinstance(value, list):
            snapshot["length"] = len(value)
            snapshot["items"] = [serialize_value(item, objects, depth + 1) for item in value[:20]]
            snapshot["truncated"] = len(value) > 20
        elif isinstance(value, tuple):
            snapshot["length"] = len(value)
            snapshot["items"] = [serialize_value(item, objects, depth + 1) for item in value[:20]]
            snapshot["truncated"] = len(value) > 20
        elif isinstance(value, set):
            items = sorted(list(value), key=lambda item: truncate_display(repr(item)))[:20]
            snapshot["length"] = len(value)
            snapshot["items"] = [serialize_value(item, objects, depth + 1) for item in items]
            snapshot["truncated"] = len(value) > 20
        elif isinstance(value, dict):
            entries = []
            for key in list(value.keys())[:20]:
                entries.append({
                    "key": serialize_value(key, objects, depth + 1),
                    "value": serialize_value(value[key], objects, depth + 1),
                })
            snapshot["length"] = len(value)
            snapshot["entries"] = entries
            snapshot["truncated"] = len(value) > 20
        else:
            attrs = {}
            try:
                source_attrs = vars(value)
            except Exception:
                source_attrs = {}
            for key, attr_value in list(source_attrs.items())[:20]:
                if not str(key).startswith("_"):
                    attrs[key] = serialize_value(attr_value, objects, depth + 1)
            snapshot["class_name"] = obj_type
            snapshot["attributes"] = attrs
    except Exception as exc:
        snapshot["error"] = f"Could not inspect object: {exc}"
    return snapshot

def trace_v2_should_capture(frame, name, value):
    if str(name).startswith("__") or name in {"self"}:
        return False
    if callable(value) and frame.f_code.co_name == "<module>":
        return False
    return True

def frame_label(frame):
    return "script" if frame.f_code.co_name == "<module>" else frame.f_code.co_name

def collect_solution_frames(frame, objects):
    frames = []
    current = frame
    while current is not None:
        if current.f_code.co_filename == "solution.py":
            bindings = {}
            references = []
            for key, value in current.f_locals.items():
                if not trace_v2_should_capture(current, key, value):
                    continue
                binding = serialize_value(value, objects)
                bindings[key] = binding
                if binding.get("kind") == "reference":
                    references.append({
                        "frame_id": f"frame_{len(frames) + 1}",
                        "name": key,
                        "object_id": binding.get("object_id"),
                    })
                if len(bindings) >= 16:
                    break
            frames.append({
                "frame_id": f"frame_{len(frames) + 1}",
                "function": frame_label(current),
                "line_no": current.f_lineno,
                "bindings": bindings,
                "references": references,
            })
        current = current.f_back
    return list(reversed(frames))

def fingerprint(value):
    try:
        return json.dumps(value, sort_keys=True, default=str)
    except Exception:
        return repr(value)

def summarize_operation(line, event, arg, *, phase="before_line", previous_line_text="", binding_changes=None, object_changes=None, stdout_changed=False, operation=None):
    clean = (line or "").strip()
    previous_clean = (previous_line_text or "").strip()
    binding_changes = binding_changes or []
    object_changes = object_changes or []
    operation = operation or {}
    if event == "exception":
        exc_type, exc, _tb = arg
        return f"Python stopped here because {exc_type.__name__} was raised: {exc}"
    if event == "return":
        return "This line just returned a value to the caller."
    if phase == "after_previous_line":
        changed_names = [change.get("name") for change in binding_changes if change.get("name")]
        mutated_objects = [change for change in object_changes if change.get("change") == "mutated"]
        method = operation.get("method")
        target = operation.get("target")
        kind = operation.get("kind")
        if mutated_objects:
            if method in {"append", "extend", "insert", "add", "update", "setdefault"}:
                return f"Line just ran: {previous_clean}. It added or updated data inside the existing {target or 'object'}."
            if method in {"pop", "remove", "discard", "clear"}:
                return f"Line just ran: {previous_clean}. It removed data from the existing {target or 'object'}."
            if method in {"sort", "reverse"}:
                return f"Line just ran: {previous_clean}. It reordered the existing {target or 'object'}."
            return f"Line just ran: {previous_clean}. It changed an existing object."
        if changed_names:
            if kind == "index_access":
                return f"Line just ran: {previous_clean}. It read one stored item and put it in {', '.join(changed_names[:3])}."
            if kind == "method_call" and method in {"lower", "upper", "strip", "split", "replace"}:
                return f"Line just ran: {previous_clean}. It stored the {method}() result in {', '.join(changed_names[:3])}."
            if kind == "loop_iteration":
                return f"Line just ran: {previous_clean}. The loop variable is now {', '.join(changed_names[:3])}."
            return f"Line just ran: {previous_clean}. It updated {', '.join(changed_names[:3])}."
        if stdout_changed:
            return f"Line just ran: {previous_clean}. It printed output."
        if previous_clean:
            return f"Line just ran: {previous_clean}. Python is ready for the next line."
    if not clean:
        return "Python is ready for the next executable line."
    kind = operation.get("kind")
    target = operation.get("target")
    method = operation.get("method")
    if kind == "assignment":
        if method == "lower":
            return f"Python is about to store a lowercase copy in {target}; the original string object is not changed."
        if target:
            return f"Python is about to store the right-side value in {target}."
    if kind == "method_call":
        if method in {"lower", "upper", "strip", "replace"}:
            return f"Python is about to run {method}(); it creates a new string value and leaves the original string unchanged."
        if method == "split":
            return "Python is about to run split(); it creates a new list of string pieces."
        if method == "join":
            return "Python is about to run join(); it creates one string from the stored pieces."
        if method:
            return f"Python is about to run {method}()."
    if kind == "mutation":
        if method == "append":
            return f"Python is about to append a value to the existing {target or 'list'}."
        if method == "pop":
            return f"Python is about to pop one value from the existing {target or 'collection'}."
        if method in {"remove", "discard"}:
            return f"Python is about to remove a value from the existing {target or 'collection'}."
        if method in {"sort", "reverse"}:
            return f"Python is about to reorder the existing {target or 'list'}."
        if method in {"add", "update", "setdefault"}:
            return f"Python is about to update the existing {target or 'collection'}."
        return "Python is about to change an existing object."
    if kind == "update" and target:
        return f"Python is about to update {target} using its current value."
    if kind == "index_write":
        return f"Python is about to update one stored item at {target or 'an index/key'}."
    if kind == "loop_iteration":
        if method == "lower":
            return f"Python is about to take the next lowercase character and store it in {target}."
        return f"Python is about to take the next item and store it in {target}."
    if kind == "condition":
        return "Python is about to check this condition to decide the next path."
    if kind == "output":
        return "Python is about to print a value into the output bucket."
    if kind == "index_access":
        return "Python is about to use an index or key to read one item from a collection."
    if ".append(" in clean:
        return "Python is about to run append(); it will change the existing list object instead of making a new variable."
    if ".pop(" in clean:
        return "Python is about to run pop(); it will remove an item from the existing collection."
    if clean.startswith("for ") and (".lower(" in clean or ".lower()" in clean):
        return "Python is about to pick the next item from a lower() copy; the original string stays unchanged."
    if ".lower(" in clean or ".lower()" in clean:
        return "Python is about to run lower(); it creates lowercase characters for this operation while the original string stays unchanged."
    if clean.startswith("for "):
        return "Python is about to pick the next item and store it in the loop variable."
    if clean.startswith("while "):
        return "Python is about to check the while condition before deciding whether to run the body."
    if clean.startswith("if ") or clean.startswith("elif "):
        return "Python is about to check this condition to choose the next path."
    if "=" in clean and "==" not in clean and not clean.startswith(("return ", "if ", "elif ", "while ")):
        return "Python is about to run this assignment and store a value in a variable name."
    if "[" in clean and "]" in clean:
        return "Python is about to use an index or key to read from a collection."
    return "Python is ready to run this line. Check the variables before and after it runs."

def build_trace_v2_step(frame, event, arg, line_no, line, stdout_text):
    global trace_v2_previous_step
    objects = {}
    frames = collect_solution_frames(frame, objects)
    previous_stdout = trace_v2_previous_step.get("stdout", "") if trace_v2_previous_step else ""
    previous_line_no = trace_v2_previous_step.get("current_line") if trace_v2_previous_step else None
    previous_line_text = source_lines[previous_line_no - 1].rstrip() if previous_line_no and 0 < previous_line_no <= len(source_lines) else ""
    previous_frames = trace_v2_previous_step.get("frames", []) if trace_v2_previous_step else []
    previous_bindings = {}
    for previous_frame in previous_frames:
        for name, binding in previous_frame.get("bindings", {}).items():
            previous_bindings[(previous_frame.get("function"), name)] = binding
    binding_changes = []
    for current_frame in frames:
        for name, binding in current_frame.get("bindings", {}).items():
            key = (current_frame.get("function"), name)
            old_binding = previous_bindings.get(key)
            if old_binding is None:
                binding_changes.append({"frame": key[0], "name": name, "change": "new"})
            elif fingerprint(old_binding) != fingerprint(binding):
                binding_changes.append({"frame": key[0], "name": name, "change": "changed"})

    previous_objects = trace_v2_previous_step.get("objects", {}) if trace_v2_previous_step else {}
    object_changes = []
    for object_id, snapshot in objects.items():
        old_snapshot = previous_objects.get(object_id)
        if old_snapshot is None:
            object_changes.append({"object_id": object_id, "change": "new"})
        elif fingerprint(old_snapshot) != fingerprint(snapshot):
            object_changes.append({"object_id": object_id, "change": "mutated"})

    references = []
    for current_frame in frames:
        references.extend(current_frame.get("references", []))
    stdout_changed = stdout_text != previous_stdout
    operation = TRACE_OPERATION_BY_LINE.get(line_no, {})
    previous_operation = TRACE_OPERATION_BY_LINE.get(previous_line_no, {}) if previous_line_no else {}
    phase = "line_returned" if event == "return" else "line_errored" if event == "exception" else "before_line"
    if event == "line" and trace_v2_previous_step and (binding_changes or object_changes or stdout_changed):
        phase = "after_previous_line"
    summary_operation = previous_operation if phase == "after_previous_line" else operation
    changes = [
        *[{"kind": "binding", **change} for change in binding_changes],
        *[{"kind": "object", **change} for change in object_changes],
    ]
    if stdout_changed:
        changes.append({"kind": "stdout", "change": "changed"})
    step = {
        "step_index": len(trace),
        "event": event,
        "phase": phase,
        "current_line": line_no,
        "previous_line": previous_line_no,
        "line_about_to_run": line_no if event == "line" else None,
        "line_just_ran": previous_line_no if phase == "after_previous_line" else line_no if event in {"return", "exception"} else None,
        "line_just_ran_text": previous_line_text if phase == "after_previous_line" else line if event in {"return", "exception"} else "",
        "line": line,
        "function": frame_label(frame),
        "frames": frames,
        "objects": objects,
        "references": references,
        "changes": changes,
        "binding_changes": binding_changes,
        "object_changes": object_changes,
        "stdout": stdout_text,
        "stdout_changed": stdout_changed,
        "operation_kind": operation.get("kind") or "",
        "operation_target": operation.get("target") or "",
        "operation_detail": operation.get("detail") or "",
        "line_just_ran_operation_kind": previous_operation.get("kind") if phase == "after_previous_line" else operation.get("kind") if event in {"return", "exception"} else "",
        "line_just_ran_operation_target": previous_operation.get("target") if phase == "after_previous_line" else operation.get("target") if event in {"return", "exception"} else "",
        "operation_summary": summarize_operation(
            line,
            event,
            arg,
            phase=phase,
            previous_line_text=previous_line_text,
            binding_changes=binding_changes,
            object_changes=object_changes,
            stdout_changed=stdout_changed,
            operation=summary_operation,
        ),
    }
    step["student_message"] = step["operation_summary"]
    if event == "return":
        step["return_value"] = serialize_value(arg, objects)
    elif event == "exception":
        exc_type, exc, _tb = arg
        step["exception"] = {"type": exc_type.__name__, "message": str(exc)}
    trace_v2_previous_step = step
    return step
trace_v2 = empty_trace_v2()

def tracer(frame, event, arg):
    if len(trace) >= MAX_TRACE_STEPS:
        return None
    if frame.f_code.co_filename != "solution.py":
        return tracer
    if frame.f_code.co_name == "<module>":
        return tracer
    if event not in {"line", "return", "exception"}:
        return tracer
    line_no = frame.f_lineno
    call_stack = call_stack_for_frame(frame)
    entry = {
        "event": event,
        "function": frame.f_code.co_name,
        "call_depth": len(call_stack),
        "call_stack": call_stack,
        "line_no": line_no,
        "line": source_lines[line_no - 1].rstrip() if 0 < line_no <= len(source_lines) else "",
        "locals": snapshot_locals(frame),
        "stdout": stdout_buffer.getvalue(),
    }
    if event == "return":
        entry["return_value"] = safe_display(arg)
    elif event == "exception":
        exc_type, exc, _tb = arg
        entry["exception"] = f"{exc_type.__name__}: {exc}"
    trace.append(entry)
    trace_v2["steps"].append(build_trace_v2_step(frame, event, arg, line_no, entry["line"], entry["stdout"]))
    return tracer

args = test.get("args", [])
expected = test.get("expected")
actual = None
error = ""
try:
    with contextlib.redirect_stdout(stdout_buffer):
        sys.settrace(tracer)
        actual = target(*args)
        sys.settrace(None)
except Exception as exc:
    sys.settrace(None)
    error = str(exc)

passed = False if error else values_equal(actual, expected, bool(test.get("order_insensitive")))
print(json.dumps({
    "status": "error" if error else "passed" if passed else "failed",
    "function_name": resolved_name,
    "test": {
        "name": test.get("name") or "Trace test",
        "args": args,
        "expected": expected,
        "actual": actual,
        "passed": passed,
        "error": error,
    },
    "trace": trace,
    "trace_v2": trace_v2,
    "stdout": stdout_buffer.getvalue(),
    "duration_ms": round((time.perf_counter() - started) * 1000, 2),
    "truncated": len(trace) >= MAX_TRACE_STEPS,
}))
"""
    started = time.perf_counter()
    try:
        with tempfile.TemporaryDirectory(prefix="csnav_trace_") as temp_dir:
            solution_path = os.path.join(temp_dir, "solution.py")
            runner_path = os.path.join(temp_dir, "trace_runner.py")
            with open(solution_path, "w", encoding="utf-8") as handle:
                handle.write(code)
            with open(runner_path, "w", encoding="utf-8") as handle:
                handle.write(runner_source)

            completed = _run_isolated_process(
                [sys.executable, "-I", "-S", runner_path],
                cwd=temp_dir,
                input_text=json.dumps({"function_name": function_name, "test": test}),
                env={"PYTHONIOENCODING": "utf-8"},
            )
    except subprocess.TimeoutExpired:
        return {
            "status": "error",
            "trace": [],
            "trace_v2": _with_trace_v2_metadata(
                _empty_trace_v2_payload(),
                language="python",
                capability="practice_and_freeform",
                trace_mode="practice",
            ),
            "stdout": "",
            "stderr": f"The trace timed out after {RUN_TIMEOUT_SECONDS} seconds. Check for infinite loops or very slow logic.",
            "duration_ms": round((time.perf_counter() - started) * 1000, 2),
        }
    except Exception as exc:
        return {
            "status": "error",
            "trace": [],
            "trace_v2": _with_trace_v2_metadata(
                _empty_trace_v2_payload(),
                language="python",
                capability="practice_and_freeform",
                trace_mode="practice",
            ),
            "stdout": "",
            "stderr": f"Trace setup failed: {exc}",
            "duration_ms": round((time.perf_counter() - started) * 1000, 2),
        }

    stdout_text = completed.stdout.strip()
    stderr_text = _truncate_text(completed.stderr.strip())
    if completed.returncode != 0 and not stdout_text:
        return {
            "status": "error",
            "trace": [],
            "trace_v2": _with_trace_v2_metadata(
                _empty_trace_v2_payload(),
                language="python",
                capability="practice_and_freeform",
                trace_mode="practice",
            ),
            "stdout": "",
            "stderr": stderr_text or "Python returned an error before tracing could run.",
            "duration_ms": round((time.perf_counter() - started) * 1000, 2),
        }

    try:
        payload = json.loads(stdout_text.splitlines()[-1])
    except Exception:
        return {
            "status": "error",
            "trace": [],
            "trace_v2": _with_trace_v2_metadata(
                _empty_trace_v2_payload(),
                language="python",
                capability="practice_and_freeform",
                trace_mode="practice",
            ),
            "stdout": _truncate_text(stdout_text),
            "stderr": stderr_text or "Trace output could not be parsed.",
            "duration_ms": round((time.perf_counter() - started) * 1000, 2),
        }

    return {
        "status": payload.get("status", "error"),
        "function_name": payload.get("function_name", function_name),
        "test": payload.get("test", {}),
        "trace": payload.get("trace", []),
        "trace_v2": _with_trace_v2_metadata(
            payload.get("trace_v2", _empty_trace_v2_payload()),
            language="python",
            capability="practice_and_freeform",
            trace_mode="practice",
        ),
        "stdout": _truncate_text(payload.get("stdout", "")),
        "stderr": _truncate_text(payload.get("error") or stderr_text),
        "duration_ms": payload.get("duration_ms", round((time.perf_counter() - started) * 1000, 2)),
        "truncated": bool(payload.get("truncated")),
    }


def run_python_freeform_trace(code: str) -> dict[str, Any]:
    """Return a capped line trace for a standalone Python snippet.

    Unlike practice tracing, this runs the student's own top-level code, so a
    saved snippet with a call at the bottom can be stepped through without an
    authored Practice Library test.
    """
    try:
        validate_python_code(code)
    except RunnerSecurityError as exc:
        response = _security_error_response(exc)
        response["trace"] = []
        response["trace_v2"] = _with_trace_v2_metadata(
            _empty_trace_v2_payload(),
            language="python",
            capability="practice_and_freeform",
            trace_mode="freeform",
        )
        return response

    runner_source = """
import ast
import builtins
import contextlib
import io
import json
import linecache
import sys
import time
import types

started = time.perf_counter()
MAX_OUTPUT_CHARS = 12000
MAX_TRACE_STEPS = 80
MAX_LOCAL_CHARS = 120
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
    "abs": abs, "all": all, "any": any, "bin": bin, "bool": bool, "callable": callable,
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

def safe_display(value):
    try:
        raw = json.dumps(value, default=repr)
    except Exception:
        raw = repr(value)
    if len(raw) > MAX_LOCAL_CHARS:
        raw = raw[:MAX_LOCAL_CHARS] + "... truncated"
    return raw

def snapshot_locals(frame):
    out = {}
    for key, value in frame.f_locals.items():
        if key.startswith("__"):
            continue
        if key in {"SAFE_BUILTINS", "SAFE_MODULE_CACHE", "stdout_buffer"}:
            continue
        if callable(value) and frame.f_code.co_name == "<module>":
            continue
        out[key] = safe_display(value)
        if len(out) >= 10:
            out["..."] = "locals truncated"
            break
    return out

def call_stack_for_frame(frame):
    stack = []
    current = frame
    while current is not None:
        if current.f_code.co_filename == "solution.py":
            stack.append("script" if current.f_code.co_name == "<module>" else current.f_code.co_name)
        current = current.f_back
    return list(reversed(stack))

source_lines = linecache.getlines("solution.py")
TRACE_OPERATION_BY_LINE = {}

def build_operation_metadata():
    try:
        tree = ast.parse("".join(source_lines), filename="solution.py")
    except Exception:
        return {}
    operations = {}
    mutating_methods = {
        "append",
        "extend",
        "insert",
        "pop",
        "remove",
        "clear",
        "sort",
        "reverse",
        "update",
        "setdefault",
        "add",
        "discard",
    }
    transform_methods = {"lower", "upper", "strip", "split", "join", "replace"}

    def source_for(node):
        try:
            return ast.unparse(node)
        except Exception:
            return ""

    def target_name(node):
        if isinstance(node, ast.Name):
            return node.id
        if isinstance(node, ast.Attribute):
            owner = source_for(node.value)
            return f"{owner}.{node.attr}" if owner else node.attr
        if isinstance(node, ast.Subscript):
            owner = source_for(node.value) or "collection"
            index = source_for(node.slice) or "index"
            return f"{owner}[{index}]"
        if isinstance(node, (ast.Tuple, ast.List)):
            return ", ".join(target_name(item) for item in node.elts)
        return ""
    def call_name(node):
        if isinstance(node, ast.Call):
            if isinstance(node.func, ast.Attribute):
                return node.func.attr
            if isinstance(node.func, ast.Name):
                return node.func.id
        return ""
    def call_owner(node):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
            return source_for(node.func.value)
        return ""
    def has_subscript(node):
        return any(isinstance(child, ast.Subscript) for child in ast.walk(node))

    for node in ast.walk(tree):
        line_no = getattr(node, "lineno", None)
        if not line_no:
            continue
        if isinstance(node, ast.Assign):
            target = target_name(node.targets[0]) if node.targets else ""
            value_call = call_name(node.value)
            if node.targets and isinstance(node.targets[0], ast.Subscript):
                operations[line_no] = {
                    "kind": "index_write",
                    "target": target,
                    "detail": f"updates the stored value at {target}" if target else "updates one stored item",
                    "method": value_call,
                }
                continue
            if value_call in transform_methods:
                kind = "method_call"
                detail = f"runs {value_call}() and stores the result in {target}" if target else f"runs {value_call}() and stores the result"
            elif has_subscript(node.value):
                kind = "index_access"
                detail = f"reads from a collection and stores the value in {target}" if target else "reads from a collection"
            else:
                kind = "assignment"
                detail = f"stores a value in {target}" if target else "stores a value"
            operations[line_no] = {
                "kind": kind,
                "target": target,
                "detail": detail,
                "method": value_call,
            }
        elif isinstance(node, ast.AnnAssign):
            target = target_name(node.target)
            value_call = call_name(node.value) if node.value else ""
            operations[line_no] = {
                "kind": "assignment",
                "target": target,
                "detail": f"stores a value in {target}" if target else "stores a value",
                "method": value_call,
            }
        elif isinstance(node, ast.AugAssign):
            target = target_name(node.target)
            kind = "index_write" if isinstance(node.target, ast.Subscript) else "update"
            operations[line_no] = {
                "kind": kind,
                "target": target,
                "detail": f"updates {target} using its old value" if target else "updates a value",
            }
        elif isinstance(node, ast.Return):
            operations[line_no] = {"kind": "return", "target": "return value", "detail": "sends a value back to the caller"}
        elif isinstance(node, ast.For):
            operations[line_no] = {
                "kind": "loop_iteration",
                "target": target_name(node.target),
                "detail": "gets the next item for the loop variable",
                "method": call_name(node.iter),
            }
        elif isinstance(node, ast.While):
            operations[line_no] = {"kind": "condition", "target": "while condition", "detail": "checks whether the loop should keep running"}
        elif isinstance(node, ast.If):
            operations[line_no] = {"kind": "condition", "target": "if condition", "detail": "checks which branch should run"}
        elif isinstance(node, ast.Expr) and isinstance(node.value, ast.Call):
            method = call_name(node.value)
            owner = call_owner(node.value)
            kind = "output" if method == "print" else "mutation" if method in mutating_methods else "method_call"
            if kind == "mutation":
                detail = f"changes the existing object stored in {owner}" if owner else f"runs {method}() on an existing object"
            elif kind == "output":
                detail = "prints a value into the output bucket"
            else:
                detail = f"runs {method}()" if method else "runs a function call"
            operations[line_no] = {"kind": kind, "target": owner or method, "detail": detail, "method": method}
        elif isinstance(node, ast.Subscript):
            operations.setdefault(line_no, {"kind": "index_access", "target": "indexed value", "detail": "reads one item from a collection"})
    return operations

TRACE_OPERATION_BY_LINE = build_operation_metadata()
trace = []
trace_v2_object_ids = {}
trace_v2_next_object_id = 1
trace_v2_previous_step = None

def empty_trace_v2():
    return {
        "schema_version": "trace_v2",
        "steps": [],
        "limits": {
            "max_steps": MAX_TRACE_STEPS,
            "max_output_chars": MAX_OUTPUT_CHARS,
            "max_display_chars": MAX_LOCAL_CHARS,
        },
    }

def is_scalar_value(value):
    return value is None or isinstance(value, (bool, int, float, str))

def safe_type_name(value):
    try:
        return type(value).__name__
    except Exception:
        return "unknown"

def stable_trace_object_id(value):
    global trace_v2_next_object_id
    source_id = id(value)
    if source_id not in trace_v2_object_ids:
        trace_v2_object_ids[source_id] = f"obj_{trace_v2_next_object_id}"
        trace_v2_next_object_id += 1
    return trace_v2_object_ids[source_id]

def truncate_display(text):
    raw = str(text)
    if len(raw) > MAX_LOCAL_CHARS:
        return raw[:MAX_LOCAL_CHARS] + "... truncated"
    return raw

def serialize_scalar(value):
    return {
        "kind": "scalar",
        "type": safe_type_name(value),
        "value": value,
        "display": safe_display(value),
    }

def serialize_value(value, objects, depth=0):
    if is_scalar_value(value) or depth >= 2:
        return serialize_scalar(value)
    object_id = stable_trace_object_id(value)
    if object_id not in objects:
        objects[object_id] = serialize_object(value, object_id, objects, depth)
    return {
        "kind": "reference",
        "object_id": object_id,
        "type": safe_type_name(value),
        "display": safe_display(value),
    }

def serialize_object(value, object_id, objects, depth=0):
    obj_type = safe_type_name(value)
    snapshot = {
        "object_id": object_id,
        "type": obj_type,
        "repr": truncate_display(repr(value)),
    }
    try:
        if isinstance(value, list):
            snapshot["length"] = len(value)
            snapshot["items"] = [serialize_value(item, objects, depth + 1) for item in value[:20]]
            snapshot["truncated"] = len(value) > 20
        elif isinstance(value, tuple):
            snapshot["length"] = len(value)
            snapshot["items"] = [serialize_value(item, objects, depth + 1) for item in value[:20]]
            snapshot["truncated"] = len(value) > 20
        elif isinstance(value, set):
            items = sorted(list(value), key=lambda item: truncate_display(repr(item)))[:20]
            snapshot["length"] = len(value)
            snapshot["items"] = [serialize_value(item, objects, depth + 1) for item in items]
            snapshot["truncated"] = len(value) > 20
        elif isinstance(value, dict):
            entries = []
            for key in list(value.keys())[:20]:
                entries.append({
                    "key": serialize_value(key, objects, depth + 1),
                    "value": serialize_value(value[key], objects, depth + 1),
                })
            snapshot["length"] = len(value)
            snapshot["entries"] = entries
            snapshot["truncated"] = len(value) > 20
        else:
            attrs = {}
            try:
                source_attrs = vars(value)
            except Exception:
                source_attrs = {}
            for key, attr_value in list(source_attrs.items())[:20]:
                if not str(key).startswith("_"):
                    attrs[key] = serialize_value(attr_value, objects, depth + 1)
            snapshot["class_name"] = obj_type
            snapshot["attributes"] = attrs
    except Exception as exc:
        snapshot["error"] = f"Could not inspect object: {exc}"
    return snapshot

def trace_v2_should_capture(frame, name, value):
    if str(name).startswith("__"):
        return False
    if name in {"SAFE_BUILTINS", "SAFE_MODULE_CACHE", "stdout_buffer"}:
        return False
    if callable(value) and frame.f_code.co_name == "<module>":
        return False
    return True

def frame_label(frame):
    return "script" if frame.f_code.co_name == "<module>" else frame.f_code.co_name

def collect_solution_frames(frame, objects):
    frames = []
    current = frame
    while current is not None:
        if current.f_code.co_filename == "solution.py":
            bindings = {}
            references = []
            for key, value in current.f_locals.items():
                if not trace_v2_should_capture(current, key, value):
                    continue
                binding = serialize_value(value, objects)
                bindings[key] = binding
                if binding.get("kind") == "reference":
                    references.append({
                        "frame_id": f"frame_{len(frames) + 1}",
                        "name": key,
                        "object_id": binding.get("object_id"),
                    })
                if len(bindings) >= 16:
                    break
            frames.append({
                "frame_id": f"frame_{len(frames) + 1}",
                "function": frame_label(current),
                "line_no": current.f_lineno,
                "bindings": bindings,
                "references": references,
            })
        current = current.f_back
    return list(reversed(frames))

def fingerprint(value):
    try:
        return json.dumps(value, sort_keys=True, default=str)
    except Exception:
        return repr(value)

def summarize_operation(line, event, arg, *, phase="before_line", previous_line_text="", binding_changes=None, object_changes=None, stdout_changed=False, operation=None):
    clean = (line or "").strip()
    previous_clean = (previous_line_text or "").strip()
    binding_changes = binding_changes or []
    object_changes = object_changes or []
    operation = operation or {}
    if event == "exception":
        exc_type, exc, _tb = arg
        return f"Python stopped here because {exc_type.__name__} was raised: {exc}"
    if event == "return":
        return "This line just returned a value to the caller."
    if phase == "after_previous_line":
        changed_names = [change.get("name") for change in binding_changes if change.get("name")]
        mutated_objects = [change for change in object_changes if change.get("change") == "mutated"]
        method = operation.get("method")
        target = operation.get("target")
        kind = operation.get("kind")
        if mutated_objects:
            if method in {"append", "extend", "insert", "add", "update", "setdefault"}:
                return f"Line just ran: {previous_clean}. It added or updated data inside the existing {target or 'object'}."
            if method in {"pop", "remove", "discard", "clear"}:
                return f"Line just ran: {previous_clean}. It removed data from the existing {target or 'object'}."
            if method in {"sort", "reverse"}:
                return f"Line just ran: {previous_clean}. It reordered the existing {target or 'object'}."
            return f"Line just ran: {previous_clean}. It changed an existing object."
        if changed_names:
            if kind == "index_access":
                return f"Line just ran: {previous_clean}. It read one stored item and put it in {', '.join(changed_names[:3])}."
            if kind == "method_call" and method in {"lower", "upper", "strip", "split", "replace"}:
                return f"Line just ran: {previous_clean}. It stored the {method}() result in {', '.join(changed_names[:3])}."
            if kind == "loop_iteration":
                return f"Line just ran: {previous_clean}. The loop variable is now {', '.join(changed_names[:3])}."
            return f"Line just ran: {previous_clean}. It updated {', '.join(changed_names[:3])}."
        if stdout_changed:
            return f"Line just ran: {previous_clean}. It printed output."
        if previous_clean:
            return f"Line just ran: {previous_clean}. Python is ready for the next line."
    if not clean:
        return "Python is ready for the next executable line."
    kind = operation.get("kind")
    target = operation.get("target")
    method = operation.get("method")
    if kind == "assignment":
        if method == "lower":
            return f"Python is about to store a lowercase copy in {target}; the original string object is not changed."
        if target:
            return f"Python is about to store the right-side value in {target}."
    if kind == "method_call":
        if method in {"lower", "upper", "strip", "replace"}:
            return f"Python is about to run {method}(); it creates a new string value and leaves the original string unchanged."
        if method == "split":
            return "Python is about to run split(); it creates a new list of string pieces."
        if method == "join":
            return "Python is about to run join(); it creates one string from the stored pieces."
        if method:
            return f"Python is about to run {method}()."
    if kind == "mutation":
        if method == "append":
            return f"Python is about to append a value to the existing {target or 'list'}."
        if method == "pop":
            return f"Python is about to pop one value from the existing {target or 'collection'}."
        if method in {"remove", "discard"}:
            return f"Python is about to remove a value from the existing {target or 'collection'}."
        if method in {"sort", "reverse"}:
            return f"Python is about to reorder the existing {target or 'list'}."
        if method in {"add", "update", "setdefault"}:
            return f"Python is about to update the existing {target or 'collection'}."
        return "Python is about to change an existing object."
    if kind == "update" and target:
        return f"Python is about to update {target} using its current value."
    if kind == "index_write":
        return f"Python is about to update one stored item at {target or 'an index/key'}."
    if kind == "loop_iteration":
        if method == "lower":
            return f"Python is about to take the next lowercase character and store it in {target}."
        return f"Python is about to take the next item and store it in {target}."
    if kind == "condition":
        return "Python is about to check this condition to decide the next path."
    if kind == "output":
        return "Python is about to print a value into the output bucket."
    if kind == "index_access":
        return "Python is about to use an index or key to read one item from a collection."
    if ".append(" in clean:
        return "Python is about to run append(); it will change the existing list object instead of making a new variable."
    if ".pop(" in clean:
        return "Python is about to run pop(); it will remove an item from the existing collection."
    if clean.startswith("for ") and (".lower(" in clean or ".lower()" in clean):
        return "Python is about to pick the next item from a lower() copy; the original string stays unchanged."
    if ".lower(" in clean or ".lower()" in clean:
        return "Python is about to run lower(); it creates lowercase characters for this operation while the original string stays unchanged."
    if clean.startswith("for "):
        return "Python is about to pick the next item and store it in the loop variable."
    if clean.startswith("while "):
        return "Python is about to check the while condition before deciding whether to run the body."
    if clean.startswith("if ") or clean.startswith("elif "):
        return "Python is about to check this condition to choose the next path."
    if "=" in clean and "==" not in clean and not clean.startswith(("return ", "if ", "elif ", "while ")):
        return "Python is about to run this assignment and store a value in a variable name."
    if "[" in clean and "]" in clean:
        return "Python is about to use an index or key to read from a collection."
    return "Python is ready to run this line. Check the variables before and after it runs."

def build_trace_v2_step(frame, event, arg, line_no, line, stdout_text):
    global trace_v2_previous_step
    objects = {}
    frames = collect_solution_frames(frame, objects)
    previous_stdout = trace_v2_previous_step.get("stdout", "") if trace_v2_previous_step else ""
    previous_line_no = trace_v2_previous_step.get("current_line") if trace_v2_previous_step else None
    previous_line_text = source_lines[previous_line_no - 1].rstrip() if previous_line_no and 0 < previous_line_no <= len(source_lines) else ""
    previous_frames = trace_v2_previous_step.get("frames", []) if trace_v2_previous_step else []
    previous_bindings = {}
    for previous_frame in previous_frames:
        for name, binding in previous_frame.get("bindings", {}).items():
            previous_bindings[(previous_frame.get("function"), name)] = binding
    binding_changes = []
    for current_frame in frames:
        for name, binding in current_frame.get("bindings", {}).items():
            key = (current_frame.get("function"), name)
            old_binding = previous_bindings.get(key)
            if old_binding is None:
                binding_changes.append({"frame": key[0], "name": name, "change": "new"})
            elif fingerprint(old_binding) != fingerprint(binding):
                binding_changes.append({"frame": key[0], "name": name, "change": "changed"})

    previous_objects = trace_v2_previous_step.get("objects", {}) if trace_v2_previous_step else {}
    object_changes = []
    for object_id, snapshot in objects.items():
        old_snapshot = previous_objects.get(object_id)
        if old_snapshot is None:
            object_changes.append({"object_id": object_id, "change": "new"})
        elif fingerprint(old_snapshot) != fingerprint(snapshot):
            object_changes.append({"object_id": object_id, "change": "mutated"})

    references = []
    for current_frame in frames:
        references.extend(current_frame.get("references", []))
    stdout_changed = stdout_text != previous_stdout
    operation = TRACE_OPERATION_BY_LINE.get(line_no, {})
    previous_operation = TRACE_OPERATION_BY_LINE.get(previous_line_no, {}) if previous_line_no else {}
    phase = "line_returned" if event == "return" else "line_errored" if event == "exception" else "before_line"
    if event == "line" and trace_v2_previous_step and (binding_changes or object_changes or stdout_changed):
        phase = "after_previous_line"
    summary_operation = previous_operation if phase == "after_previous_line" else operation
    changes = [
        *[{"kind": "binding", **change} for change in binding_changes],
        *[{"kind": "object", **change} for change in object_changes],
    ]
    if stdout_changed:
        changes.append({"kind": "stdout", "change": "changed"})
    step = {
        "step_index": len(trace),
        "event": event,
        "phase": phase,
        "current_line": line_no,
        "previous_line": previous_line_no,
        "line_about_to_run": line_no if event == "line" else None,
        "line_just_ran": previous_line_no if phase == "after_previous_line" else line_no if event in {"return", "exception"} else None,
        "line_just_ran_text": previous_line_text if phase == "after_previous_line" else line if event in {"return", "exception"} else "",
        "line": line,
        "function": frame_label(frame),
        "frames": frames,
        "objects": objects,
        "references": references,
        "changes": changes,
        "binding_changes": binding_changes,
        "object_changes": object_changes,
        "stdout": stdout_text,
        "stdout_changed": stdout_changed,
        "operation_kind": operation.get("kind") or "",
        "operation_target": operation.get("target") or "",
        "operation_detail": operation.get("detail") or "",
        "line_just_ran_operation_kind": previous_operation.get("kind") if phase == "after_previous_line" else operation.get("kind") if event in {"return", "exception"} else "",
        "line_just_ran_operation_target": previous_operation.get("target") if phase == "after_previous_line" else operation.get("target") if event in {"return", "exception"} else "",
        "operation_summary": summarize_operation(
            line,
            event,
            arg,
            phase=phase,
            previous_line_text=previous_line_text,
            binding_changes=binding_changes,
            object_changes=object_changes,
            stdout_changed=stdout_changed,
            operation=summary_operation,
        ),
    }
    step["student_message"] = step["operation_summary"]
    if event == "return":
        step["return_value"] = serialize_value(arg, objects)
    elif event == "exception":
        exc_type, exc, _tb = arg
        step["exception"] = {"type": exc_type.__name__, "message": str(exc)}
    trace_v2_previous_step = step
    return step
trace_v2 = empty_trace_v2()

def tracer(frame, event, arg):
    if len(trace) >= MAX_TRACE_STEPS:
        return None
    if frame.f_code.co_filename != "solution.py":
        return tracer
    if event not in {"line", "return", "exception"}:
        return tracer
    line_no = frame.f_lineno
    call_stack = call_stack_for_frame(frame)
    entry = {
        "event": event,
        "function": "script" if frame.f_code.co_name == "<module>" else frame.f_code.co_name,
        "call_depth": len(call_stack),
        "call_stack": call_stack,
        "line_no": line_no,
        "line": source_lines[line_no - 1].rstrip() if 0 < line_no <= len(source_lines) else "",
        "locals": snapshot_locals(frame),
        "stdout": stdout_buffer.getvalue(),
    }
    if event == "return":
        entry["return_value"] = safe_display(arg)
    elif event == "exception":
        exc_type, exc, _tb = arg
        entry["exception"] = f"{exc_type.__name__}: {exc}"
    trace.append(entry)
    trace_v2["steps"].append(build_trace_v2_step(frame, event, arg, line_no, entry["line"], entry["stdout"]))
    return tracer

module = types.ModuleType("student_solution")
module.__file__ = "solution.py"
module.__name__ = "student_solution"
module.__dict__["__builtins__"] = SAFE_BUILTINS
sys.modules[module.__name__] = module
error = ""
try:
    with open("solution.py", "r", encoding="utf-8") as handle:
        source = handle.read()
    ast.parse(source, filename="solution.py")
    with contextlib.redirect_stdout(stdout_buffer):
        sys.settrace(tracer)
        exec(compile(source, "solution.py", "exec"), module.__dict__)
        sys.settrace(None)
except Exception as exc:
    sys.settrace(None)
    error = f"{type(exc).__name__}: {exc}"

print(json.dumps({
    "status": "error" if error else "passed",
    "function_name": "script",
    "test": {"name": "Snippet trace", "args": [], "expected": None, "actual": None, "passed": not bool(error), "error": error},
    "trace": trace,
    "trace_v2": trace_v2,
    "stdout": stdout_buffer.getvalue(),
    "duration_ms": round((time.perf_counter() - started) * 1000, 2),
    "truncated": len(trace) >= MAX_TRACE_STEPS,
    "error": error,
}))
"""
    started = time.perf_counter()
    try:
        with tempfile.TemporaryDirectory(prefix="csnav_trace_free_") as temp_dir:
            solution_path = os.path.join(temp_dir, "solution.py")
            runner_path = os.path.join(temp_dir, "trace_runner.py")
            with open(solution_path, "w", encoding="utf-8") as handle:
                handle.write(code)
            with open(runner_path, "w", encoding="utf-8") as handle:
                handle.write(runner_source)

            completed = _run_isolated_process(
                [sys.executable, "-I", "-S", runner_path],
                cwd=temp_dir,
                input_text="",
                env={"PYTHONIOENCODING": "utf-8"},
            )
    except subprocess.TimeoutExpired:
        return {
            "status": "error",
            "trace": [],
            "trace_v2": _with_trace_v2_metadata(
                _empty_trace_v2_payload(),
                language="python",
                capability="practice_and_freeform",
                trace_mode="freeform",
            ),
            "stdout": "",
            "stderr": f"The trace timed out after {RUN_TIMEOUT_SECONDS} seconds. Check for infinite loops or very slow logic.",
            "duration_ms": round((time.perf_counter() - started) * 1000, 2),
        }
    except Exception as exc:
        return {
            "status": "error",
            "trace": [],
            "trace_v2": _with_trace_v2_metadata(
                _empty_trace_v2_payload(),
                language="python",
                capability="practice_and_freeform",
                trace_mode="freeform",
            ),
            "stdout": "",
            "stderr": f"Trace setup failed: {exc}",
            "duration_ms": round((time.perf_counter() - started) * 1000, 2),
        }

    stdout_text = completed.stdout.strip()
    stderr_text = _truncate_text(completed.stderr.strip())
    if completed.returncode != 0 and not stdout_text:
        return {
            "status": "error",
            "trace": [],
            "trace_v2": _with_trace_v2_metadata(
                _empty_trace_v2_payload(),
                language="python",
                capability="practice_and_freeform",
                trace_mode="freeform",
            ),
            "stdout": "",
            "stderr": stderr_text or "Python returned an error before tracing could run.",
            "duration_ms": round((time.perf_counter() - started) * 1000, 2),
        }

    try:
        payload = json.loads(stdout_text.splitlines()[-1])
    except Exception:
        return {
            "status": "error",
            "trace": [],
            "trace_v2": _with_trace_v2_metadata(
                _empty_trace_v2_payload(),
                language="python",
                capability="practice_and_freeform",
                trace_mode="freeform",
            ),
            "stdout": _truncate_text(stdout_text),
            "stderr": stderr_text or "Trace output could not be parsed.",
            "duration_ms": round((time.perf_counter() - started) * 1000, 2),
        }

    return {
        "status": payload.get("status", "error"),
        "function_name": payload.get("function_name", "script"),
        "test": payload.get("test", {}),
        "trace": payload.get("trace", []),
        "trace_v2": _with_trace_v2_metadata(
            payload.get("trace_v2", _empty_trace_v2_payload()),
            language="python",
            capability="practice_and_freeform",
            trace_mode="freeform",
        ),
        "stdout": _truncate_text(payload.get("stdout", "")),
        "stderr": _truncate_text(payload.get("error") or stderr_text),
        "duration_ms": payload.get("duration_ms", round((time.perf_counter() - started) * 1000, 2)),
        "truncated": bool(payload.get("truncated")),
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

function canonicalValue(value, orderInsensitive = false, caseInsensitive = false) {
  if (typeof value === "string") {
    const lowered = value.toLocaleLowerCase();
    if (caseInsensitive || lowered === "none" || lowered === "null") return lowered;
    return value;
  }
  if (Array.isArray(value)) {
    const items = value.map((item) => canonicalValue(item, orderInsensitive, caseInsensitive));
    if (orderInsensitive) {
      return items.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    }
    return items;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalValue(value[key], orderInsensitive, caseInsensitive)])
    );
  }
  return value;
}

function valuesEqual(actual, expected, orderInsensitive = false, caseInsensitive = false) {
  return JSON.stringify(canonicalValue(actual, orderInsensitive, caseInsensitive)) ===
    JSON.stringify(canonicalValue(expected, orderInsensitive, caseInsensitive));
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

function safeIdentifier(name) {
  return /^[A-Za-z_$][\w$]*$/.test(String(name || ""));
}

function getNamedFunction(name) {
  if (!safeIdentifier(name)) return undefined;
  if (typeof sandbox[name] === "function") return sandbox[name];
  try {
    const value = vm.runInContext(`typeof ${name} !== "undefined" ? ${name} : undefined`, sandbox, { timeout: 100 });
    return typeof value === "function" ? value : undefined;
  } catch {
    return undefined;
  }
}

function findDeclaredFunctionNames(source) {
  const names = new Set();
  const text = String(source || "");
  for (const match of text.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
    names.add(match[1]);
  }
  for (const match of text.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/g)) {
    names.add(match[1]);
  }
  return Array.from(names);
}

try {
  vm.createContext(sandbox, {
    codeGeneration: { strings: false, wasm: false },
  });
  sandbox.__csnavLastValue = undefined;
  const studentSource = cleanStudentCode(fs.readFileSync("solution.js", "utf8"));
  const prepared = captureFinalExpression(studentSource);
  vm.runInContext(prepared.source, sandbox, { timeout: 1000 });
  if (prepared.capturesExpression && typeof sandbox.__csnavLastValue !== "undefined") {
    appendLog(typeof sandbox.__csnavLastValue === "string" ? sandbox.__csnavLastValue : JSON.stringify(sandbox.__csnavLastValue));
  }

  let target = getNamedFunction(functionName);
  let warning = "";
  if (typeof target !== "function" && typeof getNamedFunction("solve") === "function") {
    target = getNamedFunction("solve");
    warning = `Expected function '${functionName}' was not found, so the runner used 'solve' instead. Rename your function to '${functionName}' for this problem.`;
  }
  if (typeof target !== "function") {
    const available = findDeclaredFunctionNames(studentSource);
    if (available.length === 1) {
      target = getNamedFunction(available[0]);
      warning = `Expected function '${functionName}' was not found, so the runner used your only defined function. Rename it to '${functionName}' for this problem.`;
    } else {
      throw new Error(`Could not find function '${functionName}'. Available student functions: ${available.join(", ") || "none"}`);
    }
  }

  const results = tests.map((test, index) => {
    const name = test.name || `Test ${index + 1}`;
    const args = test.args || [];
    const expected = test.expected;
    const orderInsensitive = Boolean(test.order_insensitive);
    const caseInsensitive = Boolean(test.case_insensitive);
    try {
      const actual = target(...args);
      const passed = valuesEqual(actual, expected, orderInsensitive, caseInsensitive);
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


def _empty_javascript_trace_response(message: str) -> dict[str, Any]:
    return _trace_capability_error_response(
        message,
        language="javascript",
        capability="practice_and_freeform",
        trace_mode="unavailable",
    )


def _run_javascript_trace(code: str, function_name: str | None, test: dict[str, Any] | None) -> dict[str, Any]:
    try:
        validate_javascript_code(code)
    except RunnerSecurityError as exc:
        return _empty_javascript_trace_response(f"Runner security check blocked this code: {exc}")

    runner_source = r"""
const fs = require("fs");
const vm = require("vm");
const { performance } = require("perf_hooks");

const payload = JSON.parse(fs.readFileSync(0, "utf8") || "{}");
const functionName = payload.function_name || "";
const test = payload.test || null;
const started = performance.now();
const MAX_TRACE_STEPS = 80;
const MAX_OUTPUT_CHARS = 12000;
const MAX_VALUE_CHARS = 4000;
let trace = [];
let objectIds = new WeakMap();
let nextObjectId = 1;
let previousStep = null;
let logs = [];
let logLength = 0;
let logsTruncated = false;
let lastReturnValue;

function appendLog(value) {
  const text = String(value);
  const remaining = MAX_OUTPUT_CHARS - logLength;
  if (remaining > 0) {
    logs.push(text.slice(0, remaining));
    logLength += Math.min(text.length, remaining);
  }
  if (text.length > Math.max(remaining, 0)) logsTruncated = true;
}

function stdoutText() {
  return logs.join("\n") + (logsTruncated ? "\n... output truncated by CS Navigator ..." : "");
}

function cleanStudentCode(source) {
  return String(source)
    .replace(/^\s*export\s+\{\s*[\w\s,]+\s*\};?\s*$/gm, "")
    .replace(/^\s*export\s+default\s+/gm, "")
    .replace(/^\s*export\s+(function|const|let|var|class)\s+/gm, "$1 ");
}

function safeIdentifier(name) {
  return /^[A-Za-z_$][\w$]*$/.test(String(name || ""));
}

function safeDisplay(value) {
  if (typeof value === "undefined") return "undefined";
  try {
    const raw = JSON.stringify(value);
    if (typeof raw === "undefined") return String(value);
    return raw.length <= MAX_VALUE_CHARS ? raw : `${raw.slice(0, MAX_VALUE_CHARS)}... value truncated ...`;
  } catch {
    const raw = String(value);
    return raw.length <= MAX_VALUE_CHARS ? raw : `${raw.slice(0, MAX_VALUE_CHARS)}... value truncated ...`;
  }
}

function stableObjectId(value) {
  if (!objectIds.has(value)) {
    objectIds.set(value, `obj_${nextObjectId}`);
    nextObjectId += 1;
  }
  return objectIds.get(value);
}

function serializeScalar(value) {
  return {
    kind: "scalar",
    type: value === null ? "null" : typeof value,
    value: value,
    display: safeDisplay(value),
  };
}

function serializeValue(value, objects, depth = 0) {
  if (value === null || typeof value !== "object" || depth >= 2) return serializeScalar(value);
  const objectId = stableObjectId(value);
  if (!objects[objectId]) objects[objectId] = serializeObject(value, objectId, objects, depth);
  return {
    kind: "reference",
    object_id: objectId,
    type: Array.isArray(value) ? "Array" : "Object",
    display: safeDisplay(value),
  };
}

function serializeObject(value, objectId, objects, depth = 0) {
  if (Array.isArray(value)) {
    return {
      object_id: objectId,
      type: "list",
      repr: safeDisplay(value),
      length: value.length,
      items: value.slice(0, 20).map((item) => serializeValue(item, objects, depth + 1)),
      truncated: value.length > 20,
    };
  }
  const entries = Object.keys(value).slice(0, 20).map((key) => ({
    key: serializeScalar(key),
    value: serializeValue(value[key], objects, depth + 1),
  }));
  return {
    object_id: objectId,
    type: "dict",
    repr: safeDisplay(value),
    length: Object.keys(value).length,
    entries,
    truncated: Object.keys(value).length > 20,
  };
}

function fingerprint(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function operationForLine(line) {
  const clean = String(line || "").trim();
  if (/^return\b/.test(clean)) return { kind: "return", target: "return value", detail: "sends a value back to the caller" };
  if (/^throw\b/.test(clean)) return { kind: "exception", target: "thrown error", detail: "raises an error" };
  if (/^for\b/.test(clean)) return { kind: "loop_iteration", target: "loop variable", detail: "checks or advances a loop" };
  if (/^while\b/.test(clean)) return { kind: "condition", target: "while condition", detail: "checks whether the loop should keep running" };
  if (/^(if|else if)\b/.test(clean)) return { kind: "condition", target: "if condition", detail: "checks which branch should run" };
  if (/console\s*\.\s*log\s*\(/.test(clean)) return { kind: "output", target: "console.log", detail: "prints a value into the output bucket" };
  const methodCall = clean.match(/([A-Za-z_$][\w$]*)\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/);
  const mutatingMethods = new Set(["push", "pop", "shift", "unshift", "splice", "sort", "reverse", "set", "delete", "add", "clear"]);
  const transformMethods = new Set(["toLowerCase", "toUpperCase", "trim", "split", "join", "slice", "map", "filter"]);
  const declaration = clean.match(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/);
  if (declaration && methodCall && transformMethods.has(methodCall[2])) {
    return { kind: "method_call", target: declaration[1], detail: `runs ${methodCall[2]}() and stores the result in ${declaration[1]}`, method: methodCall[2], owner: methodCall[1] };
  }
  if (declaration && /\[[^\]]+\]/.test(clean)) return { kind: "index_access", target: declaration[1], detail: `reads from a collection and stores the value in ${declaration[1]}` };
  if (declaration) return { kind: "assignment", target: declaration[1], detail: `stores a value in ${declaration[1]}` };
  const indexAssignment = clean.match(/^([A-Za-z_$][\w$]*)\s*\[[^\]]+\]\s*(?:=|\+=|-=|\*=|\/=)/);
  if (indexAssignment) return { kind: "index_write", target: indexAssignment[1], detail: `updates one item stored in ${indexAssignment[1]}` };
  const propertyAssignment = clean.match(/^([A-Za-z_$][\w$]*)\s*\.\s*([A-Za-z_$][\w$]*)\s*(?:=|\+=|-=|\*=|\/=)/);
  if (propertyAssignment) return { kind: "mutation", target: propertyAssignment[1], detail: `updates ${propertyAssignment[2]} inside ${propertyAssignment[1]}` };
  const assignment = clean.match(/^([A-Za-z_$][\w$]*)\s*(?:=|\+=|-=|\*=|\/=)/);
  if (assignment) return { kind: clean.includes("+=") || clean.includes("-=") || clean.includes("*=") || clean.includes("/=") ? "update" : "assignment", target: assignment[1], detail: `updates ${assignment[1]}` };
  if (methodCall) {
    const method = methodCall[2];
    const owner = methodCall[1];
    if (mutatingMethods.has(method)) return { kind: "mutation", target: owner, detail: `changes the existing object stored in ${owner}`, method, owner };
    return { kind: "method_call", target: owner, detail: `runs ${method}()`, method, owner };
  }
  if (/\[[^\]]+\]/.test(clean)) return { kind: "index_access", target: "indexed value", detail: "reads one item from a collection" };
  return { kind: "statement", target: "", detail: "runs this line" };
}

function summarizeStep(event, line, operation, changes, stdoutChanged, exception) {
  const clean = String(line || "").trim();
  if (event === "exception") return `JavaScript stopped here because ${exception?.type || "an error"} was raised: ${exception?.message || ""}`;
  if (event === "return") return "This line just returned a value to the caller.";
  const changedNames = changes.filter((change) => change.kind === "binding").map((change) => change.name);
  const mutated = changes.some((change) => change.kind === "object" && change.change === "mutated");
  if (mutated) {
    if (operation.method === "push" || operation.method === "unshift" || operation.method === "add") {
      return `Line just ran: ${clean}. It added data inside the existing ${operation.target || "array or object"}.`;
    }
    if (operation.method === "pop" || operation.method === "shift" || operation.method === "delete" || operation.method === "clear") {
      return `Line just ran: ${clean}. It removed data from the existing ${operation.target || "array or object"}.`;
    }
    if (operation.method === "sort" || operation.method === "reverse") {
      return `Line just ran: ${clean}. It reordered the existing ${operation.target || "array"}.`;
    }
    return `Line just ran: ${clean}. It changed the existing ${operation.target || "array or object"}.`;
  }
  if (changedNames.length) {
    if (operation.kind === "index_access") return `Line just ran: ${clean}. It read one stored item and put it in ${changedNames.slice(0, 3).join(", ")}.`;
    if (operation.kind === "method_call" && operation.method) return `Line just ran: ${clean}. It stored the ${operation.method}() result in ${changedNames.slice(0, 3).join(", ")}.`;
    if (operation.kind === "loop_iteration") return `Line just ran: ${clean}. The loop variable is now ${changedNames.slice(0, 3).join(", ")}.`;
    return `Line just ran: ${clean}. It updated ${changedNames.slice(0, 3).join(", ")}.`;
  }
  if (stdoutChanged) return `Line just ran: ${clean}. It printed output.`;
  if (operation.kind === "assignment") return `JavaScript is about to store the right-side value in ${operation.target}.`;
  if (operation.kind === "update") return `JavaScript is about to update ${operation.target} using its current value.`;
  if (operation.kind === "mutation") {
    if (operation.method === "push") return `JavaScript is about to push a value into the existing ${operation.target}.`;
    if (operation.method === "pop") return `JavaScript is about to pop one value from the existing ${operation.target}.`;
    if (operation.method === "set") return `JavaScript is about to set a key/value pair inside the existing ${operation.target}.`;
    return `JavaScript is about to update ${operation.target} or one of its stored values.`;
  }
  if (operation.kind === "index_write") return `JavaScript is about to update one stored item in ${operation.target}.`;
  if (operation.kind === "loop_iteration") return "JavaScript is about to run the next loop check or loop pass.";
  if (operation.kind === "condition") return "JavaScript is about to check this condition to choose the next path.";
  if (operation.kind === "method_call") {
    if (operation.method === "toLowerCase") return "JavaScript is about to make a lowercase string value; the original string stays unchanged.";
    if (operation.method === "split") return "JavaScript is about to split the string into a new array.";
    if (operation.method === "join") return "JavaScript is about to join stored pieces into one string.";
    return `JavaScript is about to run ${operation.method || operation.target}().`;
  }
  if (operation.kind === "output") return "JavaScript is about to print a value into the output bucket.";
  if (operation.kind === "index_access") return "JavaScript is about to use an index or key to read one item from a collection.";
  return "JavaScript is ready to run this line. Check the variables before and after it runs.";
}

function buildStep(event, lineNo, line, snapshotFactory, returnValue, exception) {
  if (trace.length >= MAX_TRACE_STEPS) return returnValue;
  let locals = {};
  try {
    locals = typeof snapshotFactory === "function" ? snapshotFactory() || {} : {};
  } catch {
    locals = {};
  }
  const objects = {};
  const bindings = {};
  const references = [];
  for (const [name, value] of Object.entries(locals)) {
    const binding = serializeValue(value, objects);
    bindings[name] = binding;
    if (binding.kind === "reference") {
      references.push({ frame_id: "frame_1", name, object_id: binding.object_id });
    }
  }
  const frameName = functionName || "script";
  const frames = [{ frame_id: "frame_1", function: frameName, line_no: lineNo, bindings, references }];
  const previousBindings = previousStep?.frames?.[0]?.bindings || {};
  const previousObjects = previousStep?.objects || {};
  const bindingChanges = [];
  for (const [name, binding] of Object.entries(bindings)) {
    if (!previousBindings[name]) bindingChanges.push({ frame: frameName, name, change: "new" });
    else if (fingerprint(previousBindings[name]) !== fingerprint(binding)) bindingChanges.push({ frame: frameName, name, change: "changed" });
  }
  const objectChanges = [];
  for (const [objectId, object] of Object.entries(objects)) {
    if (!previousObjects[objectId]) objectChanges.push({ object_id: objectId, change: "new" });
    else if (fingerprint(previousObjects[objectId]) !== fingerprint(object)) objectChanges.push({ object_id: objectId, change: "mutated" });
  }
  const previousStdout = previousStep?.stdout || "";
  const currentStdout = stdoutText();
  const stdoutChanged = currentStdout !== previousStdout;
  const changes = [
    ...bindingChanges.map((change) => ({ kind: "binding", ...change })),
    ...objectChanges.map((change) => ({ kind: "object", ...change })),
  ];
  if (stdoutChanged) changes.push({ kind: "stdout", change: "changed" });
  const operation = operationForLine(line);
  const previousOperation = previousStep ? operationForLine(previousStep.line) : {};
  const phase = event === "line" && previousStep && changes.length
    ? "after_previous_line"
    : event === "line" ? "before_line" : event === "return" ? "line_returned" : "line_errored";
  const summaryOperation = phase === "after_previous_line" ? previousOperation : operation;
  const summaryLine = phase === "after_previous_line" ? previousStep.line : line;
  const step = {
    step_index: trace.length,
    event,
    phase,
    current_line: lineNo,
    previous_line: previousStep?.current_line || null,
    line_about_to_run: event === "line" ? lineNo : null,
    line_just_ran: phase === "after_previous_line" ? previousStep?.current_line || null : event === "line" ? null : lineNo,
    line_just_ran_text: phase === "after_previous_line" ? previousStep?.line || "" : event === "line" ? "" : line,
    line,
    function: frameName,
    frames,
    objects,
    references,
    changes,
    binding_changes: bindingChanges,
    object_changes: objectChanges,
    stdout: currentStdout,
    stdout_changed: stdoutChanged,
    operation_kind: operation.kind,
    operation_target: operation.target,
    operation_detail: operation.detail,
    line_just_ran_operation_kind: phase === "after_previous_line" ? previousOperation.kind || "" : event !== "line" ? operation.kind || "" : "",
    line_just_ran_operation_target: phase === "after_previous_line" ? previousOperation.target || "" : event !== "line" ? operation.target || "" : "",
  };
  if (event === "return") step.return_value = serializeValue(returnValue, objects);
  if (event === "exception") step.exception = exception;
  step.operation_summary = summarizeStep(event, summaryLine, summaryOperation, changes, stdoutChanged, exception);
  step.student_message = step.operation_summary;
  trace.push(step);
  previousStep = step;
  return returnValue;
}

function traceErrorLine(error) {
  const stack = String(error?.stack || "");
  const match = stack.match(/solution\.js:(\d+):\d+/);
  if (match) return Number(match[1]);
  return previousStep?.current_line || 0;
}

function traceErrorSource(lineNo, sourceLines) {
  if (lineNo && sourceLines[lineNo - 1]) return sourceLines[lineNo - 1];
  return previousStep?.line || "";
}

function inferSyntaxLine(sourceLines) {
  for (let index = 0; index < sourceLines.length; index += 1) {
    const trimmed = String(sourceLines[index] || "").trim();
    if (trimmed && !trimmed.startsWith("//") && !trimmed.startsWith("/*") && trimmed !== "*/" && !trimmed.startsWith("*")) {
      return index + 1;
    }
  }
  return 0;
}

function __csnavRead(reader) {
  try {
    return reader();
  } catch {
    return undefined;
  }
}

function __csnavTrace(lineNo, line, snapshotFactory) {
  buildStep("line", lineNo, line, snapshotFactory);
}

function __csnavReturn(lineNo, line, snapshotFactory, value) {
  lastReturnValue = value;
  return buildStep("return", lineNo, line, snapshotFactory, value);
}

function __csnavThrow(lineNo, line, snapshotFactory, error) {
  const exception = { type: error?.name || "Error", message: String(error?.message || error), line: lineNo };
  buildStep("exception", lineNo, line, snapshotFactory, null, exception);
  throw error;
}

function collectNames(source) {
  const names = new Set();
  for (const match of source.matchAll(/\bfunction\s+[A-Za-z_$][\w$]*\s*\(([^)]*)\)/g)) {
    match[1].split(",").map((item) => item.trim()).filter(safeIdentifier).forEach((name) => names.add(name));
  }
  for (const match of source.matchAll(/\b(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/g)) {
    match[1].split(",").map((item) => item.trim()).filter(safeIdentifier).forEach((name) => names.add(name));
  }
  for (const match of source.matchAll(/\b(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*(?:async\s*)?([A-Za-z_$][\w$]*)\s*=>/g)) {
    names.add(match[1]);
  }
  for (const match of source.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) names.add(match[1]);
  for (const match of source.matchAll(/\bfor\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\b/g)) names.add(match[1]);
  return Array.from(names).slice(0, 16);
}

function snapshotSource(names) {
  return `() => ({${names.map((name) => `${JSON.stringify(name)}: __csnavRead(() => ${name})`).join(",")}})`;
}

function instrumentSource(source) {
  const lines = String(source).split(/\r?\n/);
  const names = collectNames(source);
  const snapshot = snapshotSource(names);
  let inBlockComment = false;
  return lines.map((rawLine, index) => {
    const lineNo = index + 1;
    const trimmed = rawLine.trim();
    const encodedLine = JSON.stringify(rawLine);
    const indent = rawLine.match(/^\s*/)?.[0] || "";
    if (inBlockComment) {
      if (trimmed.includes("*/")) inBlockComment = false;
      return rawLine;
    }
    if (trimmed.startsWith("/*")) {
      if (!trimmed.includes("*/")) inBlockComment = true;
      return rawLine;
    }
    if (!trimmed || trimmed.startsWith("//") || trimmed === "{" || trimmed === "}" || /^[}\])]/.test(trimmed) || /^(else|catch|finally)\b/.test(trimmed)) return rawLine;
    if (/^(function|class)\b/.test(trimmed)) return rawLine;
    if (/^(const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/.test(trimmed)) return rawLine;
    if (/console\s*\.\s*log\s*\(/.test(trimmed)) {
      return `${indent}__csnavTrace(${lineNo}, ${encodedLine}, ${snapshot});\n${rawLine}\n${indent}__csnavTrace(${lineNo}, ${encodedLine}, ${snapshot});`;
    }
    const returnMatch = trimmed.match(/^return\s+(.+);?$/);
    if (returnMatch) {
      const expression = returnMatch[1].replace(/;$/, "");
      return `${indent}__csnavTrace(${lineNo}, ${encodedLine}, ${snapshot});\n${indent}return __csnavReturn(${lineNo}, ${encodedLine}, ${snapshot}, (${expression}));`;
    }
    const throwMatch = trimmed.match(/^throw\s+(.+);?$/);
    if (throwMatch) {
      const expression = throwMatch[1].replace(/;$/, "");
      return `${indent}throw __csnavThrow(${lineNo}, ${encodedLine}, ${snapshot}, (${expression}));`;
    }
    return `${indent}__csnavTrace(${lineNo}, ${encodedLine}, ${snapshot});\n${rawLine}`;
  }).join("\n");
}

function canonicalValue(value, orderInsensitive = false, caseInsensitive = false) {
  if (typeof value === "string") {
    const lowered = value.toLocaleLowerCase();
    if (caseInsensitive || lowered === "none" || lowered === "null") return lowered;
    return value;
  }
  if (Array.isArray(value)) {
    const items = value.map((item) => canonicalValue(item, orderInsensitive, caseInsensitive));
    return orderInsensitive ? items.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))) : items;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key], orderInsensitive, caseInsensitive)]));
  }
  return value;
}

function valuesEqual(actual, expected, orderInsensitive = false, caseInsensitive = false) {
  return JSON.stringify(canonicalValue(actual, orderInsensitive, caseInsensitive)) === JSON.stringify(canonicalValue(expected, orderInsensitive, caseInsensitive));
}

function safeIdentifierName(name) {
  return /^[A-Za-z_$][\w$]*$/.test(String(name || ""));
}

function getNamedFunction(sandbox, name) {
  if (!safeIdentifierName(name)) return undefined;
  try {
    const value = vm.runInContext(`typeof ${name} !== "undefined" ? ${name} : undefined`, sandbox, { timeout: 100 });
    return typeof value === "function" ? value : undefined;
  } catch {
    return undefined;
  }
}

try {
  const source = cleanStudentCode(fs.readFileSync("solution.js", "utf8"));
  const sourceLines = source.split(/\r?\n/);
  new vm.Script(source, { filename: "solution.js" });
  const sandbox = {
    console: {
      log: (...args) => appendLog(args.map((arg) => typeof arg === "string" ? arg : JSON.stringify(arg)).join(" ")),
      error: (...args) => appendLog(args.map(String).join(" ")),
    },
    __csnavTrace,
    __csnavReturn,
    __csnavThrow,
    __csnavRead,
  };
  vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false } });
  vm.runInContext(instrumentSource(source), sandbox, { timeout: 1000 });
  let actual = null;
  let passed = true;
  let error = "";
  if (test && functionName) {
    const target = getNamedFunction(sandbox, functionName) || getNamedFunction(sandbox, "solve");
    if (typeof target !== "function") throw new Error(`Could not find function '${functionName}'.`);
    const args = test.args || [];
    try {
      actual = target(...args);
      passed = valuesEqual(actual, test.expected, Boolean(test.order_insensitive), Boolean(test.case_insensitive));
    } catch (caught) {
      error = String(caught?.message || caught);
      passed = false;
      if (!trace.some((step) => step.event === "exception")) {
        const errorLine = traceErrorLine(caught);
        buildStep("exception", errorLine, traceErrorSource(errorLine, sourceLines), () => ({}), null, { type: caught?.name || "Error", message: error, line: errorLine });
      }
    }
  }
  process.stdout.write(JSON.stringify({
    status: error ? "error" : passed ? "passed" : "failed",
    function_name: functionName || "script",
    test: test ? { name: test.name || "Trace test", args: test.args || [], expected: test.expected, actual, passed, error } : { name: "Snippet trace", args: [], expected: null, actual: lastReturnValue ?? null, passed: !error, error },
    trace: trace.map((step) => ({
      event: step.event,
      function: step.function,
      call_depth: 1,
      call_stack: [step.function],
      line_no: step.current_line,
      line: step.line,
      locals: Object.fromEntries(Object.entries(step.frames?.[0]?.bindings || {}).map(([name, binding]) => [name, binding.display])),
      stdout: step.stdout,
      return_value: step.return_value?.display,
      exception: step.exception ? `${step.exception.type}: ${step.exception.message}` : undefined,
    })),
    trace_v2: { schema_version: "trace_v2", steps: trace, limits: { max_steps: MAX_TRACE_STEPS, max_output_chars: MAX_OUTPUT_CHARS, max_display_chars: MAX_VALUE_CHARS } },
    stdout: stdoutText(),
    duration_ms: Math.round((performance.now() - started) * 100) / 100,
    truncated: trace.length >= MAX_TRACE_STEPS,
    error,
  }));
} catch (caught) {
  const message = String(caught?.message || caught);
  let errorLine = traceErrorLine(caught);
  const source = (() => {
    try { return cleanStudentCode(fs.readFileSync("solution.js", "utf8")); } catch { return ""; }
  })();
  const sourceLines = source.split(/\r?\n/);
  if (!errorLine && caught?.name === "SyntaxError") errorLine = inferSyntaxLine(sourceLines);
  if (!trace.length || !trace.some((step) => step.event === "exception")) {
    buildStep("exception", errorLine, traceErrorSource(errorLine, sourceLines), () => ({}), null, { type: caught?.name || "Error", message, line: errorLine });
  }
  process.stdout.write(JSON.stringify({
    status: "error",
    function_name: functionName || "script",
    test: test ? { name: test.name || "Trace test", args: test.args || [], expected: test.expected, actual: null, passed: false, error: message } : { name: "Snippet trace", args: [], expected: null, actual: null, passed: false, error: message },
    trace: trace.map((step) => ({
      event: step.event,
      function: step.function,
      call_depth: 1,
      call_stack: [step.function],
      line_no: step.current_line,
      line: step.line,
      locals: Object.fromEntries(Object.entries(step.frames?.[0]?.bindings || {}).map(([name, binding]) => [name, binding.display])),
      stdout: step.stdout,
      return_value: step.return_value?.display,
      exception: step.exception ? `${step.exception.type}: ${step.exception.message}` : undefined,
    })),
    trace_v2: { schema_version: "trace_v2", steps: trace, limits: { max_steps: MAX_TRACE_STEPS, max_output_chars: MAX_OUTPUT_CHARS, max_display_chars: MAX_VALUE_CHARS } },
    stdout: stdoutText(),
    duration_ms: Math.round((performance.now() - started) * 100) / 100,
    truncated: false,
    error: message,
  }));
}
"""
    started = time.perf_counter()
    try:
        with tempfile.TemporaryDirectory(prefix="csnav_trace_js_") as temp_dir:
            solution_path = os.path.join(temp_dir, "solution.js")
            runner_path = os.path.join(temp_dir, "trace_runner.js")
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
                input_text=json.dumps({"function_name": function_name or "", "test": test}),
                env=node_env,
            )
    except FileNotFoundError:
        return _empty_javascript_trace_response("Node.js was not found, so JavaScript tracing cannot run locally yet.")
    except subprocess.TimeoutExpired:
        return _empty_javascript_trace_response(
            f"The JavaScript trace timed out after {RUN_TIMEOUT_SECONDS} seconds. Check for infinite loops or very slow logic."
        )
    except Exception as exc:
        return _empty_javascript_trace_response(f"JavaScript trace setup failed: {exc}")

    stdout_text = completed.stdout.strip()
    stderr_text = _truncate_text(completed.stderr.strip())
    if completed.returncode != 0 and not stdout_text:
        return _empty_javascript_trace_response(stderr_text or "Node returned an error before tracing could run.")
    try:
        payload = json.loads(stdout_text.splitlines()[-1])
    except Exception:
        return {
            **_empty_javascript_trace_response(stderr_text or "JavaScript trace output could not be parsed."),
            "stdout": _truncate_text(stdout_text),
            "duration_ms": round((time.perf_counter() - started) * 1000, 2),
        }
    trace_mode = "practice" if test else "freeform"
    return {
        "status": payload.get("status", "error"),
        "function_name": payload.get("function_name") or function_name or "script",
        "test": payload.get("test", {}),
        "trace": payload.get("trace", []),
        "trace_v2": _with_trace_v2_metadata(
            payload.get("trace_v2", _empty_trace_v2_payload()),
            language="javascript",
            capability="practice_and_freeform",
            trace_mode=trace_mode,
        ),
        "stdout": _truncate_text(payload.get("stdout", "")),
        "stderr": _truncate_text(payload.get("error") or stderr_text),
        "duration_ms": payload.get("duration_ms", round((time.perf_counter() - started) * 1000, 2)),
        "truncated": bool(payload.get("truncated")),
    }


def run_javascript_practice_trace(code: str, function_name: str, test: dict[str, Any]) -> dict[str, Any]:
    return _run_javascript_trace(code, function_name, test)


def run_javascript_freeform_trace(code: str) -> dict[str, Any]:
    return _run_javascript_trace(code, None, None)


# =============================================================================
# JAVA / C++ PRACTICE RUNNERS (compiled languages)
# =============================================================================
# These compile the student's code with a generated test harness, then run it.
# The harness compares the student's function output to each expected value and
# prints ONE JSON line per test plus a final summary line, matching the same
# result contract as the Python/JS runners (status / passed / total / tests).

def _java_literal(value: Any) -> str:
    """Render a Python value as a Java expression (Object-typed)."""
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return f"{value}L"  # long, widest integer the harness compares loosely
    if isinstance(value, float):
        return repr(value)
    if isinstance(value, str):
        return json.dumps(value)  # valid Java string literal (same escaping as JSON)
    if isinstance(value, (list, tuple)):
        inner = ", ".join(_java_literal(item) for item in value)
        return f"new Object[]{{{inner}}}"
    # Fallback: stringify
    return json.dumps(str(value))


def _java_json_string_expr(value: str) -> str:
    return json.dumps(value or "")


def _java_trace_empty_response(message: str) -> dict[str, Any]:
    return _trace_capability_error_response(
        message,
        language="java",
        capability="practice_only",
        trace_mode="unavailable",
    )


def _java_trace_compile_line(stderr_text: str) -> int | None:
    match = re.search(r"Solution\.java:(\d+):", stderr_text or "")
    if not match:
        return None
    try:
        return int(match.group(1))
    except ValueError:
        return None


def _java_trace_is_executable_line(stripped: str) -> bool:
    if not stripped:
        return False
    if stripped.startswith(("//", "/*", "*", "@")):
        return False
    if stripped in {"{", "}"}:
        return False
    if stripped.startswith(("import ", "package ")):
        return False
    if re.match(r"^(?:public\s+)?class\s+\w+", stripped):
        return False
    if re.match(r"^(?:public|private|protected)?\s*static\s+[\w<>\[\]]+\s+\w+\s*\([^)]*\)\s*\{?$", stripped):
        return False
    if re.match(r"^(?:public|private|protected)?\s*[\w<>\[\]]+\s+\w+\s*\([^)]*\)\s*\{?$", stripped):
        return False
    return True


def _java_trace_operation(line: str) -> tuple[str, str]:
    stripped = line.strip()
    if stripped.startswith("return"):
        return "return", "Java is about to return a value from this method."
    if stripped.startswith("throw"):
        return "exception", "Java is about to throw an exception."
    if stripped.startswith(("if ", "if(")):
        return "condition", "Java is checking this condition to choose a branch."
    if stripped.startswith(("for ", "for(")):
        return "loop", "Java is starting or continuing this loop."
    if stripped.startswith(("while ", "while(")):
        return "loop", "Java is checking this while-loop condition."
    if "System.out.print" in stripped:
        return "stdout", "This line prints output."
    if re.search(r"\.(?:add|remove|put|push|pop|set)\s*\(", stripped) or re.search(r"\[[^\]]+\]\s*=", stripped):
        return "mutation", "This line changes an existing collection or stored value."
    if "=" in stripped and "==" not in stripped and "!=" not in stripped and "<=" not in stripped and ">=" not in stripped:
        return "assignment", "This line stores or updates a value."
    return "line", "Java is about to run this line."


_JAVA_TRACE_DECL_RE = re.compile(
    r"(?:^|[(;]\s*)(?:final\s+)?(?:int|long|double|float|boolean|String|char|var|"
    r"int\[\]|long\[\]|double\[\]|String\[\]|boolean\[\]|List<[^>]+>|ArrayList<[^>]+>|"
    r"Map<[^>]+>|HashMap<[^>]+>|Set<[^>]+>|HashSet<[^>]+>)\s+([A-Za-z_]\w*)\b"
)


def _trace_param_names(params: str) -> list[str]:
    names: list[str] = []
    for raw in params.split(","):
        piece = raw.strip()
        if not piece:
            continue
        piece = piece.split("=")[0].strip()
        matches = re.findall(r"[A-Za-z_]\w*", piece)
        if matches:
            names.append(matches[-1])
    return names


def _trace_declared_names(line: str, decl_re: re.Pattern[str]) -> list[str]:
    names: list[str] = []
    for match in decl_re.finditer(line):
        name = match.group(1)
        if name and name not in names:
            names.append(name)
    return names


def _instrument_java_trace_source(code: str) -> str:
    lines = code.splitlines()
    output: list[str] = []
    in_block_comment = False
    brace_depth = 0
    function_depth = 0
    visible_vars: list[tuple[str, int]] = []
    for index, line in enumerate(lines, start=1):
        stripped = line.strip()
        leading_closes = len(re.match(r"^\s*}*", line).group(0).replace(" ", "").replace("\t", ""))
        if leading_closes:
            next_depth = max(0, brace_depth - leading_closes)
            visible_vars = [(name, depth) for name, depth in visible_vars if depth <= next_depth]
            if function_depth and next_depth < function_depth:
                function_depth = 0
                visible_vars = []
            brace_depth = next_depth
        if "/*" in stripped:
            in_block_comment = True
        method_match = re.match(
            r"^(?:public|private|protected)?\s*(?:static\s+)?[\w<>\[\]]+\s+\w+\s*\(([^)]*)\)\s*\{?\s*$",
            stripped,
        )
        is_method_definition = bool(method_match and " class " not in f" {stripped} ")
        if not in_block_comment and is_method_definition:
            function_depth = brace_depth + 1
            visible_vars = [(name, function_depth) for name in _trace_param_names(method_match.group(1))]
        if not in_block_comment and _java_trace_is_executable_line(stripped):
            indent = line[: len(line) - len(line.lstrip())]
            operation, message = _java_trace_operation(stripped)
            visible_expr = ", ".join(
                f"{_java_json_string_expr(name)}, {name}" for name, _ in visible_vars
            )
            line_call = "__Trace.lineVars" if visible_expr else "__Trace.line"
            vars_suffix = f", {visible_expr}" if visible_expr else ""
            output.append(
                f"{indent}{line_call}({index}, {_java_json_string_expr(stripped)}, "
                f"{_java_json_string_expr(operation)}, {_java_json_string_expr(message)}{vars_suffix}); {stripped}"
            )
        else:
            output.append(line)
        if not in_block_comment and function_depth and not is_method_definition:
            declaration_depth = brace_depth + stripped.count("{") - stripped.count("}")
            if stripped.startswith(("for ", "for(")) and "{" in stripped:
                declaration_depth = max(declaration_depth, brace_depth + 1)
            for name in _trace_declared_names(stripped, _JAVA_TRACE_DECL_RE):
                if all(existing != name for existing, _ in visible_vars):
                    visible_vars.append((name, max(function_depth, declaration_depth)))
        if in_block_comment:
            if "*/" in stripped:
                in_block_comment = False
            continue
        opens = stripped.count("{")
        closes = max(0, stripped.count("}") - leading_closes)
        brace_depth = max(0, brace_depth + opens - closes)
        visible_vars = [(name, depth) for name, depth in visible_vars if depth <= brace_depth or depth == function_depth]
        if function_depth and brace_depth < function_depth:
            function_depth = 0
            visible_vars = []
    return "\n".join(output)


def _cpp_literal(value: Any) -> str:
    """Render a Python value as a C++ Value() expression (see Value variant below)."""
    if value is None:
        return "Value()"
    if isinstance(value, bool):
        return f"Value({'true' if value else 'false'})"
    if isinstance(value, int):
        return f"Value((long long){value})"
    if isinstance(value, float):
        return f"Value((double){value!r})"
    if isinstance(value, str):
        return f"Value(std::string({json.dumps(value)}))"
    if isinstance(value, (list, tuple)):
        inner = ", ".join(_cpp_literal(item) for item in value)
        return f"Value(std::vector<Value>{{{inner}}})"
    return f"Value(std::string({json.dumps(str(value))}))"


def _cpp_trace_empty_response(message: str) -> dict[str, Any]:
    return _trace_capability_error_response(
        message,
        language="cpp",
        capability="practice_only",
        trace_mode="unavailable",
    )


def _cpp_trace_compile_line(stderr_text: str) -> int | None:
    match = re.search(r"(?:main\.cpp|student\.cpp):(\d+):", stderr_text or "")
    if not match:
        return None
    try:
        return int(match.group(1))
    except ValueError:
        return None


def _cpp_trace_is_executable_line(stripped: str) -> bool:
    if not stripped:
        return False
    if stripped.startswith(("//", "/*", "*", "#", "using ", "namespace ")):
        return False
    if stripped in {"{", "}", "};"}:
        return False
    if stripped.endswith(":") and stripped in {"public:", "private:", "protected:"}:
        return False
    if stripped.startswith(("class ", "struct ", "else", "catch")):
        return False
    if re.match(r"^[\w:<>,\s*&]+\s+\w+\s*\([^;]*\)\s*\{?$", stripped):
        return False
    return True


def _cpp_trace_operation(line: str) -> tuple[str, str]:
    stripped = line.strip()
    if stripped.startswith("return"):
        return "return", "C++ is about to return a value from this function."
    if stripped.startswith("throw"):
        return "exception", "C++ is about to throw an exception."
    if stripped.startswith(("if ", "if(")):
        return "condition", "C++ is checking this condition to choose a branch."
    if stripped.startswith(("for ", "for(")):
        return "loop", "C++ is starting or continuing this loop."
    if stripped.startswith(("while ", "while(")):
        return "loop", "C++ is checking this while-loop condition."
    if "cout" in stripped or "std::cout" in stripped:
        return "stdout", "This line prints output."
    if re.search(r"\.(?:push_back|pop_back|insert|erase|clear)\s*\(", stripped) or re.search(r"\[[^\]]+\]\s*=", stripped):
        return "mutation", "This line changes an existing collection or stored value."
    if "=" in stripped and "==" not in stripped and "!=" not in stripped and "<=" not in stripped and ">=" not in stripped:
        return "assignment", "This line stores or updates a value."
    return "line", "C++ is about to run this line."


_CPP_TRACE_DECL_RE = re.compile(
    r"(?:^|[(;]\s*)(?:const\s+)?(?:long\s+long|int|double|float|bool|string|std::string|char|auto|size_t|"
    r"vector\s*<[^>]+>|std::vector\s*<[^>]+>)\s*[&*]*\s*([A-Za-z_]\w*)\b"
)


def _instrument_cpp_trace_source(code: str) -> str:
    lines = code.splitlines()
    output: list[str] = []
    in_block_comment = False
    brace_depth = 0
    function_depth = 0
    visible_vars: list[tuple[str, int]] = []
    for index, line in enumerate(lines, start=1):
        stripped = line.strip()
        leading_closes = len(re.match(r"^\s*}*", line).group(0).replace(" ", "").replace("\t", ""))
        if leading_closes:
            next_depth = max(0, brace_depth - leading_closes)
            visible_vars = [(name, depth) for name, depth in visible_vars if depth <= next_depth]
            if function_depth and next_depth < function_depth:
                function_depth = 0
                visible_vars = []
            brace_depth = next_depth
        if "/*" in stripped:
            in_block_comment = True
        function_match = re.match(r"^[\w:<>,\s*&]+\s+\w+\s*\(([^;]*)\)\s*\{?\s*$", stripped)
        is_function_definition = bool(
            function_match and not stripped.startswith(("if", "for", "while", "switch"))
        )
        if not in_block_comment and is_function_definition:
            function_depth = brace_depth + 1
            visible_vars = [(name, function_depth) for name in _trace_param_names(function_match.group(1))]
        if not in_block_comment and _cpp_trace_is_executable_line(stripped):
            indent = line[: len(line) - len(line.lstrip())]
            operation, message = _cpp_trace_operation(stripped)
            visible_expr = ", ".join(
                f"{{{json.dumps(name)}, __Trace::showValue({name})}}" for name, _ in visible_vars
            )
            line_call = "lineVars" if visible_expr else "line"
            vars_suffix = f", {{{visible_expr}}}" if visible_expr else ""
            output.append(
                f"{indent}__Trace::{line_call}({index}, {json.dumps(stripped)}, "
                f"{json.dumps(operation)}, {json.dumps(message)}{vars_suffix}); {stripped}"
            )
        else:
            output.append(line)
        if not in_block_comment and function_depth and not is_function_definition:
            declaration_depth = brace_depth + stripped.count("{") - stripped.count("}")
            if stripped.startswith(("for ", "for(")) and "{" in stripped:
                declaration_depth = max(declaration_depth, brace_depth + 1)
            for name in _trace_declared_names(stripped, _CPP_TRACE_DECL_RE):
                if all(existing != name for existing, _ in visible_vars):
                    visible_vars.append((name, max(function_depth, declaration_depth)))
        if in_block_comment and "*/" in stripped:
            in_block_comment = False
            continue
        opens = stripped.count("{")
        closes = max(0, stripped.count("}") - leading_closes)
        brace_depth = max(0, brace_depth + opens - closes)
        visible_vars = [(name, depth) for name, depth in visible_vars if depth <= brace_depth or depth == function_depth]
        if function_depth and brace_depth < function_depth:
            function_depth = 0
            visible_vars = []
    return "\n".join(output)


def _cpp_param_prefers_int(code: str, function_name: str, param_name: str, kind: str) -> bool:
    """Best-effort compatibility check for beginner/AI C++ signatures.

    The official C++ runner contract uses `long long` and `vector<long long>` so
    integer tests do not overflow easily. Beginners and AI tools often write
    `int` / `vector<int>` instead. When the visible signature clearly does that,
    the runner can adapt the hidden test values before calling the student's
    code instead of showing a linker error.
    """
    escaped_name = re.escape(function_name)
    escaped_param = re.escape(param_name)
    signature_match = re.search(rf"\b{escaped_name}\s*\(([^)]*)\)", code)
    signature_text = signature_match.group(1) if signature_match else code
    if kind == "intlist":
        return bool(re.search(rf"(?:const\s+)?(?:std::)?vector\s*<\s*int\s*>\s*(?:const\s*)?&?\s*{escaped_param}\b", signature_text))
    if kind == "grid":
        return bool(re.search(rf"(?:const\s+)?(?:std::)?vector\s*<\s*(?:std::)?vector\s*<\s*int\s*>\s*>\s*(?:const\s*)?&?\s*{escaped_param}\b", signature_text))
    if kind == "int":
        return bool(re.search(rf"\bint\s*&?\s*{escaped_param}\b", signature_text))
    return False


def _camel_to_snake_name(name: str) -> str:
    return re.sub(r"(?<!^)(?=[A-Z])", "_", name or "").lower()


def _cpp_detect_student_function_name(code: str, function_name: str) -> str:
    """Return the function name the student actually defined.

    C++ grading uses camelCase function names, while beginners and AI examples
    often produce snake_case. If the expected name is missing but the snake_case
    equivalent is present, adapt to that instead of surfacing a confusing compile
    error.
    """
    if re.search(rf"\b{re.escape(function_name)}\s*\(", code):
        return function_name
    snake_name = _camel_to_snake_name(function_name)
    if snake_name != function_name and re.search(rf"\b{re.escape(snake_name)}\s*\(", code):
        return snake_name
    return function_name


def _cpp_compat_return_expr(return_kind: str) -> str:
    if return_kind == "int":
        return "return (long long)__student_result;"
    if return_kind == "bool":
        return "return (bool)__student_result;"
    if return_kind == "string":
        return "return std::string(__student_result);"
    if return_kind in {"intlist", "list"}:
        return "return std::vector<long long>(__student_result.begin(), __student_result.end());"
    if return_kind == "strlist":
        return "return std::vector<std::string>(__student_result.begin(), __student_result.end());"
    if return_kind == "grid":
        return (
            "std::vector<std::vector<long long>> __out;\n"
            "    for (auto& __row : __student_result) __out.push_back(std::vector<long long>(__row.begin(), __row.end()));\n"
            "    return __out;"
        )
    return "return __student_result;"


def _cpp_beginner_compat_adapter(code: str, function_name: str, arg_spec, expected_signature: str) -> str:
    """Return a top-level wrapper for common C++ beginner shapes.

    Official starter:
        long long fn(vector<long long> nums, long long k)

    Common beginner/AI shapes:
        class Solution { public: int fn(vector<int>& nums, int k) { ... } };
        int fn(vector<int> nums, int k) { ... }

    The wrapper lets those run while the UI still teaches the cleaner expected
    shape. It intentionally only covers obvious safe numeric conversions.
    """
    if not arg_spec:
        return ""
    student_function_name = _cpp_detect_student_function_name(code, function_name)
    has_solution_class = bool(re.search(r"\bclass\s+Solution\b", code))
    has_function = bool(re.search(rf"\b{re.escape(student_function_name)}\s*\(", code))
    args, return_kind = arg_spec
    beginner_return = bool(
        re.search(rf"\bint\s+{re.escape(student_function_name)}\s*\(", code)
        or re.search(rf"(?:std::)?vector\s*<\s*int\s*>\s+{re.escape(student_function_name)}\s*\(", code)
        or re.search(
            rf"(?:std::)?vector\s*<\s*(?:std::)?vector\s*<\s*int\s*>\s*>\s+{re.escape(student_function_name)}\s*\(",
            code,
        )
    )
    uses_beginner_ints = beginner_return or any(
        _cpp_param_prefers_int(code, student_function_name, name, kind) for name, kind in args
    )
    if not has_solution_class and not (has_function and uses_beginner_ints):
        return ""
    if expected_signature in code:
        return ""

    locals_src: list[str] = []
    call_args: list[str] = []
    for name, kind in args:
        if kind == "intlist" and _cpp_param_prefers_int(code, student_function_name, name, kind):
            local_name = f"__{name}_int"
            locals_src.append(f"    std::vector<int> {local_name}({name}.begin(), {name}.end());")
            call_args.append(local_name)
        elif kind == "grid" and _cpp_param_prefers_int(code, student_function_name, name, kind):
            local_name = f"__{name}_int"
            locals_src.append(f"    std::vector<std::vector<int>> {local_name};")
            locals_src.append(f"    for (auto& __row : {name}) {local_name}.push_back(std::vector<int>(__row.begin(), __row.end()));")
            call_args.append(local_name)
        elif kind == "int" and _cpp_param_prefers_int(code, student_function_name, name, kind):
            local_name = f"__{name}_int"
            locals_src.append(f"    int {local_name} = (int){name};")
            call_args.append(local_name)
        else:
            call_args.append(name)

    local_block = "\n".join(locals_src)
    call_prefix = "Solution __student;\n    " if has_solution_class else ""
    call_target = f"__student.{student_function_name}" if has_solution_class else student_function_name
    return_expr = _cpp_compat_return_expr(return_kind)
    return (
        "\n// Compatibility wrapper: lets common class Solution / int-based C++ answers run in this learning workspace.\n"
        f"{expected_signature} {{\n"
        f"    {call_prefix}"
        f"{local_block}\n"
        f"    auto __student_result = {call_target}({', '.join(call_args)});\n"
        f"    {return_expr}\n"
        "}\n"
    )


def _finalize_compiled_result(
    payload_lines: list[str],
    *,
    started: float,
    stderr_text: str,
) -> dict[str, Any]:
    """Parse the per-test JSON lines + summary line from a compiled harness."""
    tests: list[dict[str, Any]] = []
    status = "error"
    for line in payload_lines:
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            obj = json.loads(line)
        except Exception:
            continue
        if obj.get("__summary__"):
            status = obj.get("status", "error")
            continue
        tests.append(obj)
    passed = sum(1 for item in tests if item.get("passed"))
    total = len(tests)
    if total and status == "error":
        status = "passed" if passed == total else "failed"
    return {
        "status": status,
        "passed": passed,
        "total": total,
        "tests": tests,
        "stdout": "",
        "stderr": _truncate_text(stderr_text),
        "duration_ms": round((time.perf_counter() - started) * 1000, 2),
    }


def run_java_practice_tests(code: str, function_name: str, tests: list[dict[str, Any]], arg_spec=None) -> dict[str, Any]:
    if not compiled_runners_enabled():
        return empty_practice_run_response(COMPILED_RUNNERS_DISABLED_MESSAGE)
    try:
        validate_java_code(code)
    except RunnerSecurityError as exc:
        return _security_error_response(exc)

    javac = _find_executable("javac")
    java = _find_executable("java")
    if not javac or not java:
        return empty_practice_run_response(
            "Java is not installed on this machine, so Java tests cannot run locally yet. "
            "Install a JDK (javac + java on PATH), or use Python/JavaScript for now."
        )

    # Build the test invocations as inlined Java literals.
    invocations = []
    for index, test in enumerate(tests, start=1):
        name = test.get("name") or f"Test {index}"
        args = test.get("args", []) or []
        expected = test.get("expected")
        case_insensitive = bool(test.get("case_insensitive"))
        arg_list = ", ".join(_java_literal(a) for a in args)
        invocations.append(
            f'        runTest({json.dumps(name)}, new Object[]{{{arg_list}}}, '
            f'{_java_literal(expected)}, {str(case_insensitive).lower()});'
        )
    invocations_src = "\n".join(invocations)

    # Native-type bridge: with an arg spec, the student writes a clean native-typed
    # method (int f(String, String)) and the Runner-side bridge unpacks the Object[]
    # args + boxes any array result, so the compare harness stays identical. Without
    # a spec, fall back to the legacy `Object f(Object[])` contract.
    if arg_spec:
        from practice_starters import java_native_bridge
        bridge_src = java_native_bridge(function_name, arg_spec)
        call_expr = "__call(args)"
    else:
        bridge_src = ""
        call_expr = f"Solution.{function_name}(args)"

    harness = f"""
import java.util.*;

public class Runner {{
    static int passed = 0, total = 0;

{bridge_src}

    static String esc(String s) {{
        StringBuilder b = new StringBuilder();
        for (char c : s.toCharArray()) {{
            if (c == '"' || c == '\\\\') b.append('\\\\').append(c);
            else if (c == '\\n') b.append("\\\\n");
            else b.append(c);
        }}
        return b.toString();
    }}
    static String show(Object o) {{
        if (o == null) return "null";
        if (o instanceof Object[]) return Arrays.deepToString((Object[]) o);
        return o.toString();
    }}
    static String comparableString(Object o, boolean caseInsensitive) {{
        String s = o.toString();
        String lowered = s.toLowerCase(Locale.ROOT);
        if (caseInsensitive || lowered.equals("none") || lowered.equals("null")) return lowered;
        return s;
    }}
    static boolean eq(Object a, Object b, boolean caseInsensitive) {{
        if (a == null || b == null) return a == b;
        if (a instanceof Object[] && b instanceof Object[])
            return eqArray((Object[]) a, (Object[]) b, caseInsensitive);
        if (a instanceof Number && b instanceof Number)
            return ((Number) a).doubleValue() == ((Number) b).doubleValue();
        return comparableString(a, caseInsensitive).equals(comparableString(b, caseInsensitive));
    }}
    static boolean eqArray(Object[] a, Object[] b, boolean caseInsensitive) {{
        if (a.length != b.length) return false;
        for (int i = 0; i < a.length; i++) {{
            if (!eq(a[i], b[i], caseInsensitive)) return false;
        }}
        return true;
    }}

    static void runTest(String name, Object[] args, Object expected, boolean caseInsensitive) {{
        total++;
        try {{
            Object actual = {call_expr};
            boolean ok = eq(actual, expected, caseInsensitive);
            if (ok) passed++;
            System.out.println("{{\\"name\\":\\"" + esc(name) + "\\",\\"passed\\":" + ok
                + ",\\"expected\\":\\"" + esc(show(expected)) + "\\",\\"actual\\":\\"" + esc(show(actual)) + "\\"}}");
        }} catch (Throwable t) {{
            System.out.println("{{\\"name\\":\\"" + esc(name) + "\\",\\"passed\\":false,\\"expected\\":\\""
                + esc(show(expected)) + "\\",\\"actual\\":null,\\"error\\":\\"" + esc(String.valueOf(t)) + "\\"}}");
        }}
    }}

    public static void main(String[] argv) {{
{invocations_src}
        String status = (passed == total) ? "passed" : "failed";
        System.out.println("{{\\"__summary__\\":true,\\"status\\":\\"" + status + "\\"}}");
    }}
}}
""".lstrip()

    # The student writes their function inside a Solution class. To keep the
    # harness simple, the function receives an Object[] of args (the harness
    # passes them packed). Students writing `static Object {function_name}(Object[] a)`.
    started = time.perf_counter()
    try:
        with tempfile.TemporaryDirectory(prefix="csnav_java_") as temp_dir:
            with open(os.path.join(temp_dir, "Solution.java"), "w", encoding="utf-8") as h:
                h.write(code)
            with open(os.path.join(temp_dir, "Runner.java"), "w", encoding="utf-8") as h:
                h.write(harness)

            # javac IS a JVM, so it also needs the relaxed (no RLIMIT_AS) profile.
            compiled = _compile_source(
                [javac, "-J-Xmx256m", "-d", temp_dir, "Solution.java", "Runner.java"],
                cwd=temp_dir,
                env={"PATH": os.environ.get("PATH", "")},
                limiter=_limit_jvm_resources,
            )
            if compiled.returncode != 0:
                return {
                    "status": "error",
                    "passed": 0,
                    "total": 0,
                    "tests": [],
                    "stdout": "",
                    "stderr": _truncate_text(compiled.stderr.strip() or "Java compilation failed."),
                    "duration_ms": round((time.perf_counter() - started) * 1000, 2),
                }

            run = _run_isolated_process(
                [java, "-cp", temp_dir, "-Xss8m", "-Xmx128m", "Runner"],
                cwd=temp_dir,
                input_text="",
                env=_hardened_compiled_env({"PATH": os.environ.get("PATH", "")}),
                limiter=_limit_jvm_hardened,
            )
    except subprocess.TimeoutExpired:
        return {
            "status": "error", "passed": 0, "total": 0, "tests": [],
            "stdout": "",
            "stderr": f"The Java run timed out after {RUN_TIMEOUT_SECONDS} seconds. Check for infinite loops or very slow logic.",
            "duration_ms": round((time.perf_counter() - started) * 1000, 2),
        }
    except Exception as exc:
        return empty_practice_run_response(f"Java runner setup failed: {exc}")

    result = _finalize_compiled_result(
        run.stdout.splitlines(),
        started=started,
        stderr_text=run.stderr.strip(),
    )
    for index, item in enumerate(result.get("tests", [])):
        if index < len(tests) and "args" not in item:
            item["args"] = tests[index].get("args", [])
    return result


def run_java_practice_trace(code: str, function_name: str, test: dict[str, Any], arg_spec=None) -> dict[str, Any]:
    if not compiled_runners_enabled():
        return _java_trace_empty_response(
            "Java tracing is disabled in this environment. Use Run if it is enabled here, or switch to another trace-capable language."
        )
    try:
        validate_java_code(code)
    except RunnerSecurityError as exc:
        return _java_trace_empty_response(f"Runner security check blocked this code: {exc}")

    javac = _find_executable("javac")
    java = _find_executable("java")
    if not javac or not java:
        return _java_trace_empty_response(
            "Java is not installed on this machine, so Java tracing cannot run locally yet. "
            "Install a JDK with javac and java on PATH to trace Java locally."
        )

    args = test.get("args", []) or []
    expected = test.get("expected")
    case_insensitive = bool(test.get("case_insensitive"))
    arg_list = ", ".join(_java_literal(a) for a in args)

    if arg_spec:
        from practice_starters import java_native_bridge
        bridge_src = java_native_bridge(function_name, arg_spec)
        call_expr = "__call(args)"
        spec_args = arg_spec[0]
        arg_names = [name for name, _ in spec_args]
    else:
        bridge_src = ""
        call_expr = f"Solution.{function_name}(args)"
        arg_names = [f"arg{index + 1}" for index in range(len(args))]

    traced_code = _instrument_java_trace_source(code)
    arg_bindings = [
        {"name": name, "value": _truncate_text(json.dumps(value), RUN_MAX_VALUE_CHARS)}
        for name, value in zip(arg_names, args)
    ]

    harness = f"""
import java.util.*;
import java.io.*;

class __Trace {{
    static List<String> steps = new ArrayList<>();
    static String esc(String s) {{
        if (s == null) return "";
        StringBuilder b = new StringBuilder();
        for (char c : s.toCharArray()) {{
            if (c == '"' || c == '\\\\') b.append('\\\\').append(c);
            else if (c == '\\n') b.append("\\\\n");
            else if (c == '\\r') b.append("\\\\r");
            else b.append(c);
        }}
        return b.toString();
    }}
    static void line(int line, String source, String kind, String message) {{
        steps.add("{{\\"line\\":" + line
            + ",\\"source\\":\\"" + esc(source)
            + "\\",\\"operation_kind\\":\\"" + esc(kind)
            + "\\",\\"student_message\\":\\"" + esc(message) + "\\"}}");
    }}
    static void lineVars(int line, String source, String kind, String message, Object... vars) {{
        steps.add("{{\\"line\\":" + line
            + ",\\"source\\":\\"" + esc(source)
            + "\\",\\"operation_kind\\":\\"" + esc(kind)
            + "\\",\\"student_message\\":\\"" + esc(message)
            + "\\",\\"vars\\":" + varsJson(vars) + "}}");
    }}
    static String showValue(Object value) {{
        if (value == null) return "null";
        Class<?> cls = value.getClass();
        if (!cls.isArray()) return String.valueOf(value);
        if (value instanceof int[]) return Arrays.toString((int[]) value);
        if (value instanceof long[]) return Arrays.toString((long[]) value);
        if (value instanceof double[]) return Arrays.toString((double[]) value);
        if (value instanceof float[]) return Arrays.toString((float[]) value);
        if (value instanceof boolean[]) return Arrays.toString((boolean[]) value);
        if (value instanceof char[]) return Arrays.toString((char[]) value);
        if (value instanceof Object[]) return Arrays.deepToString((Object[]) value);
        return String.valueOf(value);
    }}
    static String varsJson(Object... vars) {{
        StringBuilder b = new StringBuilder("[");
        for (int i = 0; i + 1 < vars.length; i += 2) {{
            if (i > 0) b.append(",");
            b.append("{{\\"name\\":\\"").append(esc(String.valueOf(vars[i]))).append("\\",\\"value\\":\\"")
                .append(esc(showValue(vars[i + 1]))).append("\\"}}");
        }}
        return b.append("]").toString();
    }}
    static String stepsJson() {{
        StringBuilder b = new StringBuilder("[");
        for (int i = 0; i < steps.size(); i++) {{
            if (i > 0) b.append(",");
            b.append(steps.get(i));
        }}
        return b.append("]").toString();
    }}
}}

public class Runner {{
    static String esc(String s) {{
        if (s == null) return "";
        StringBuilder b = new StringBuilder();
        for (char c : s.toCharArray()) {{
            if (c == '"' || c == '\\\\') b.append('\\\\').append(c);
            else if (c == '\\n') b.append("\\\\n");
            else if (c == '\\r') b.append("\\\\r");
            else b.append(c);
        }}
        return b.toString();
    }}
    static String show(Object o) {{
        if (o == null) return "null";
        if (o instanceof Object[]) return Arrays.deepToString((Object[]) o);
        return o.toString();
    }}
    static String comparableString(Object o, boolean caseInsensitive) {{
        String s = o.toString();
        String lowered = s.toLowerCase(Locale.ROOT);
        if (caseInsensitive || lowered.equals("none") || lowered.equals("null")) return lowered;
        return s;
    }}
    static boolean eq(Object a, Object b, boolean caseInsensitive) {{
        if (a == null || b == null) return a == b;
        if (a instanceof Object[] && b instanceof Object[])
            return eqArray((Object[]) a, (Object[]) b, caseInsensitive);
        if (a instanceof Number && b instanceof Number)
            return ((Number) a).doubleValue() == ((Number) b).doubleValue();
        return comparableString(a, caseInsensitive).equals(comparableString(b, caseInsensitive));
    }}
    static boolean eqArray(Object[] a, Object[] b, boolean caseInsensitive) {{
        if (a.length != b.length) return false;
        for (int i = 0; i < a.length; i++) {{
            if (!eq(a[i], b[i], caseInsensitive)) return false;
        }}
        return true;
    }}

{bridge_src}

    public static void main(String[] argv) {{
        Object[] args = new Object[]{{{arg_list}}};
        Object expected = {_java_literal(expected)};
        boolean caseInsensitive = {str(case_insensitive).lower()};
        PrintStream realOut = System.out;
        ByteArrayOutputStream captured = new ByteArrayOutputStream();
        System.setOut(new PrintStream(captured));
        Object actual = null;
        Throwable thrown = null;
        try {{
            actual = {call_expr};
        }} catch (Throwable t) {{
            thrown = t;
        }} finally {{
            System.out.flush();
            System.setOut(realOut);
        }}
        boolean ok = thrown == null && eq(actual, expected, caseInsensitive);
        String stdout = captured.toString();
        String error = thrown == null ? "" : String.valueOf(thrown);
        int errorLine = 0;
        if (thrown != null) {{
            for (StackTraceElement frame : thrown.getStackTrace()) {{
                if ("Solution".equals(frame.getClassName())) {{
                    errorLine = frame.getLineNumber();
                    break;
                }}
            }}
        }}
        realOut.println("{{\\"__java_trace__\\":true"
            + ",\\"passed\\":" + ok
            + ",\\"expected\\":\\"" + esc(show(expected))
            + "\\",\\"actual\\":\\"" + esc(show(actual))
            + "\\",\\"stdout\\":\\"" + esc(stdout)
            + "\\",\\"error\\":\\"" + esc(error)
            + "\\",\\"error_line\\":" + errorLine
            + ",\\"steps\\":" + __Trace.stepsJson()
            + "}}");
    }}
}}
""".lstrip()

    started = time.perf_counter()
    try:
        with tempfile.TemporaryDirectory(prefix="csnav_javatrace_") as temp_dir:
            with open(os.path.join(temp_dir, "Solution.java"), "w", encoding="utf-8") as h:
                h.write(code)
            original_compiled = _compile_source(
                [javac, "-J-Xmx256m", "-d", temp_dir, "Solution.java"],
                cwd=temp_dir,
                env={"PATH": os.environ.get("PATH", "")},
                limiter=_limit_jvm_resources,
            )
            if original_compiled.returncode != 0:
                stderr = _truncate_text(original_compiled.stderr.strip() or "Java compilation failed.")
                line_no = _java_trace_compile_line(stderr) or 0
                exception = {
                    "type": "CompileError",
                    "message": stderr,
                    "line": line_no,
                }
                step = {
                    "step": 1,
                    "current_line": line_no,
                    "previous_line": None,
                    "line": "",
                    "function": function_name,
                    "event": "exception",
                    "stdout": "",
                    "exception": exception,
                    "operation_kind": "compile_error",
                    "student_message": f"Java could not compile this code{f' on line {line_no}' if line_no else ''}.",
                    "frames": [{"name": function_name, "bindings": arg_bindings, "is_current": True}],
                    "objects": {},
                    "references": [],
                    "return_value": None,
                }
                return {
                    "status": "error",
                    "passed": 0,
                    "total": 1,
                    "tests": [],
                    "trace": [],
                    "trace_v2": _with_trace_v2_metadata(
                        {"schema_version": "trace_v2", "steps": [step], "limits": {"max_steps": RUN_RATE_LIMIT}},
                        language="java",
                        capability="practice_only",
                        trace_mode="practice",
                    ),
                    "stdout": "",
                    "stderr": stderr,
                    "duration_ms": round((time.perf_counter() - started) * 1000, 2),
                }

            with open(os.path.join(temp_dir, "Solution.java"), "w", encoding="utf-8") as h:
                h.write(traced_code)
            with open(os.path.join(temp_dir, "Runner.java"), "w", encoding="utf-8") as h:
                h.write(harness)

            compiled = _compile_source(
                [javac, "-J-Xmx256m", "-d", temp_dir, "Solution.java", "Runner.java"],
                cwd=temp_dir,
                env={"PATH": os.environ.get("PATH", "")},
                limiter=_limit_jvm_resources,
            )
            if compiled.returncode != 0:
                stderr = _truncate_text(compiled.stderr.strip() or "Java compilation failed.")
                line_no = _java_trace_compile_line(stderr) or 0
                setup_message = (
                    "Java tracing could not safely instrument this code. Your original code compiled, "
                    "but the trace helper could not be inserted without changing the program shape."
                )
                exception = {
                    "type": "TraceInstrumentationError",
                    "message": stderr,
                    "line": line_no,
                }
                step = {
                    "step": 1,
                    "current_line": line_no,
                    "previous_line": None,
                    "line": "",
                    "function": function_name,
                    "event": "exception",
                    "stdout": "",
                    "exception": exception,
                    "operation_kind": "trace_setup_error",
                    "student_message": setup_message,
                    "frames": [{"name": function_name, "bindings": arg_bindings, "is_current": True}],
                    "objects": {},
                    "references": [],
                    "return_value": None,
                }
                return {
                    "status": "error",
                    "passed": 0,
                    "total": 1,
                    "tests": [],
                    "trace": [],
                    "trace_v2": _with_trace_v2_metadata(
                        {"schema_version": "trace_v2", "steps": [step], "limits": {"max_steps": RUN_RATE_LIMIT}},
                        language="java",
                        capability="practice_only",
                        trace_mode="practice",
                    ),
                    "stdout": "",
                    "stderr": f"{setup_message}\n\n{stderr}",
                    "duration_ms": round((time.perf_counter() - started) * 1000, 2),
                }

            run = _run_isolated_process(
                [java, "-cp", temp_dir, "-Xss8m", "-Xmx128m", "Runner"],
                cwd=temp_dir,
                input_text="",
                env=_hardened_compiled_env({"PATH": os.environ.get("PATH", "")}),
                limiter=_limit_jvm_hardened,
            )
    except subprocess.TimeoutExpired:
        return _java_trace_empty_response(
            f"The Java trace timed out after {RUN_TIMEOUT_SECONDS} seconds. Check for infinite loops or very slow logic."
        )
    except Exception as exc:
        return _java_trace_empty_response(f"Java trace setup failed: {exc}")

    payload = None
    for line in run.stdout.splitlines():
        if not line.strip().startswith("{"):
            continue
        try:
            parsed = json.loads(line)
        except Exception:
            continue
        if parsed.get("__java_trace__"):
            payload = parsed
            break
    if not payload:
        return _java_trace_empty_response(run.stderr.strip() or "Java trace output could not be parsed.")

    stdout_text = payload.get("stdout", "")
    raw_steps = payload.get("steps") or []
    trace_steps: list[dict[str, Any]] = []
    previous_line = None
    previous_bindings: dict[str, dict[str, Any]] = {}
    for index, item in enumerate(raw_steps, start=1):
        line_no = item.get("line") or 0
        bindings = _compiled_trace_bindings(arg_bindings, item.get("vars"))
        binding_changes = _compiled_trace_binding_changes(function_name, bindings, previous_bindings)
        step = {
            "step": index,
            "current_line": line_no,
            "previous_line": previous_line,
            "line": item.get("source", ""),
            "function": function_name,
            "event": "line",
            "stdout": stdout_text if index == len(raw_steps) else "",
            "exception": None,
            "return_value": None,
            "operation_kind": item.get("operation_kind") or "line",
            "operation_summary": item.get("student_message") or "Java is about to run this line.",
            "student_message": item.get("student_message") or "Java is about to run this line.",
            "frames": [{"name": function_name, "bindings": bindings, "is_current": True}],
            "binding_changes": binding_changes,
            "object_changes": [],
            "objects": {},
            "references": [],
        }
        previous_line = line_no
        previous_bindings = bindings
        trace_steps.append(step)

    if payload.get("error"):
        error_line = payload.get("error_line") or previous_line or 0
        trace_steps.append({
            "step": len(trace_steps) + 1,
            "current_line": error_line,
            "previous_line": previous_line,
            "line": "",
            "function": function_name,
            "event": "exception",
            "stdout": stdout_text,
            "exception": {
                "type": "RuntimeError",
                "message": payload.get("error", ""),
                "line": error_line,
            },
            "return_value": None,
            "operation_kind": "exception",
            "operation_summary": f"Java stopped on line {error_line} because an exception was raised.",
            "student_message": f"Java stopped on line {error_line} because an exception was raised.",
            "frames": [{"name": function_name, "bindings": previous_bindings or _compiled_trace_bindings(arg_bindings, []), "is_current": True}],
            "binding_changes": [],
            "object_changes": [],
            "objects": {},
            "references": [],
        })
    elif trace_steps:
        trace_steps[-1]["return_value"] = payload.get("actual")
        trace_steps[-1]["event"] = "return"
        trace_steps[-1]["operation_kind"] = "return"
        trace_steps[-1]["student_message"] = f"Java returned {payload.get('actual')}."
        trace_steps[-1]["operation_summary"] = trace_steps[-1]["student_message"]

    test_result = {
        "name": test.get("name") or "Trace test",
        "passed": bool(payload.get("passed")),
        "expected": payload.get("expected"),
        "actual": payload.get("actual"),
        "args": args,
    }
    if payload.get("error"):
        test_result["error"] = payload.get("error")
    return {
        "status": "passed" if test_result["passed"] else "failed",
        "passed": 1 if test_result["passed"] else 0,
        "total": 1,
        "tests": [test_result],
        "trace": [],
        "trace_v2": _with_trace_v2_metadata(
            {
                "schema_version": "trace_v2",
                "steps": trace_steps,
                "limits": {"max_steps": RUN_RATE_LIMIT, "max_output_chars": RUN_MAX_OUTPUT_CHARS},
            },
            language="java",
            capability="practice_only",
            trace_mode="practice",
        ),
        "stdout": stdout_text,
        "stderr": _truncate_text(run.stderr.strip()),
        "duration_ms": round((time.perf_counter() - started) * 1000, 2),
    }


def run_cpp_practice_tests(code: str, function_name: str, tests: list[dict[str, Any]], arg_spec=None) -> dict[str, Any]:
    if not compiled_runners_enabled():
        return empty_practice_run_response(COMPILED_RUNNERS_DISABLED_MESSAGE)
    try:
        validate_cpp_code(code)
    except RunnerSecurityError as exc:
        return _security_error_response(exc)

    compiler = _find_executable("g++", "clang++")
    if not compiler:
        return empty_practice_run_response(
            "A C++ compiler (g++ or clang++) is not installed on this machine, so C++ tests "
            "cannot run locally yet. Install one, or use Python/JavaScript for now."
        )

    invocations = []
    for index, test in enumerate(tests, start=1):
        name = test.get("name") or f"Test {index}"
        args = test.get("args", []) or []
        expected = test.get("expected")
        case_insensitive = bool(test.get("case_insensitive"))
        arg_list = ", ".join(_cpp_literal(a) for a in args)
        invocations.append(
            f'    runTest({json.dumps(name)}, {{{arg_list}}}, {_cpp_literal(expected)}, {str(case_insensitive).lower()});'
        )
    invocations_src = "\n".join(invocations)

    # Native-type bridge: when we have an arg spec, the student writes a clean
    # native-typed function (int f(string, string)) and this bridge unpacks the
    # Value args + wraps the result, so the compare harness stays identical. When
    # there's no spec, fall back to the legacy `Value f(vector<Value>)` contract.
    if arg_spec:
        from practice_starters import cpp_native_bridge, cpp_native_signature
        expected_signature = cpp_native_signature(function_name, arg_spec)
        student_decl = cpp_native_bridge(function_name, arg_spec)
        call_target = f"__call_{function_name}"
        compat_adapter = _cpp_beginner_compat_adapter(code, function_name, arg_spec, expected_signature)
        student_section = f"{code}\n\n{compat_adapter}\n\n{student_decl}"
    else:
        expected_signature = f"Value {function_name}(std::vector<Value> args)"
        student_decl = (
            f"// Student provides: Value {function_name}(vector<Value> args)\n"
            f"Value {function_name}(vector<Value> args);"
        )
        call_target = function_name
        compat_adapter = ""
        student_section = f"{student_decl}\n\n{code}"

    # A tiny tagged-union Value type so student code can accept a vector<Value>.
    harness = f"""
#include <bits/stdc++.h>
using namespace std;

struct Value {{
    enum Kind {{ NUL, BOOL, INT, DBL, STR, ARR }} kind = NUL;
    bool b=false; long long i=0; double d=0; string s; vector<Value> a;
    Value() {{}}
    Value(bool x): kind(BOOL), b(x) {{}}
    Value(long long x): kind(INT), i(x) {{}}
    Value(double x): kind(DBL), d(x) {{}}
    Value(const string& x): kind(STR), s(x) {{}}
    Value(const vector<Value>& x): kind(ARR), a(x) {{}}
    string show() const {{
        switch (kind) {{
            case NUL: return "null";
            case BOOL: return b ? "true" : "false";
            case INT: return to_string(i);
            case DBL: {{ ostringstream o; o<<d; return o.str(); }}
            case STR: return s;
            case ARR: {{ string r="["; for(size_t k=0;k<a.size();k++){{ if(k) r+=", "; r+=a[k].show(); }} return r+"]"; }}
        }}
        return "";
    }}
    static string lowerCopy(string value) {{
        transform(value.begin(), value.end(), value.begin(), [](unsigned char c){{ return (char)tolower(c); }});
        return value;
    }}
    static string comparableString(const string& value, bool caseInsensitive) {{
        string lowered = lowerCopy(value);
        if (caseInsensitive || lowered == "none" || lowered == "null") return lowered;
        return value;
    }}
    bool eq(const Value& o, bool caseInsensitive=false) const {{
        if ((kind==INT||kind==DBL) && (o.kind==INT||o.kind==DBL)) {{
            double x = kind==INT? (double)i : d, y = o.kind==INT? (double)o.i : o.d; return x==y;
        }}
        if (kind != o.kind) return show()==o.show();
        switch (kind) {{
            case NUL: return true;
            case BOOL: return b==o.b;
            case STR: return comparableString(s, caseInsensitive)==comparableString(o.s, caseInsensitive);
            case ARR: {{ if(a.size()!=o.a.size()) return false; for(size_t k=0;k<a.size();k++) if(!a[k].eq(o.a[k], caseInsensitive)) return false; return true; }}
            default: return show()==o.show();
        }}
    }}
}};

{student_section}

static int passed_=0, total_=0;
static string esc(const string& s){{ string r; for(char c:s){{ if(c=='"'||c=='\\\\') r+='\\\\'; if(c=='\\n'){{ r+="\\\\n"; continue; }} r+=c; }} return r; }}

static void runTest(const string& name, vector<Value> args, Value expected, bool caseInsensitive){{
    total_++;
    try {{
        Value actual = {call_target}(args);
        bool ok = actual.eq(expected, caseInsensitive);
        if (ok) passed_++;
        cout << "{{\\"name\\":\\"" << esc(name) << "\\",\\"passed\\":" << (ok?"true":"false")
             << ",\\"expected\\":\\"" << esc(expected.show()) << "\\",\\"actual\\":\\"" << esc(actual.show()) << "\\"}}" << "\\n";
    }} catch (const exception& e) {{
        cout << "{{\\"name\\":\\"" << esc(name) << "\\",\\"passed\\":false,\\"expected\\":\\""
             << esc(expected.show()) << "\\",\\"actual\\":null,\\"error\\":\\"" << esc(e.what()) << "\\"}}" << "\\n";
    }}
}}

int main(){{
{invocations_src}
    cout << "{{\\"__summary__\\":true,\\"status\\":\\"" << (passed_==total_?"passed":"failed") << "\\"}}" << "\\n";
    return 0;
}}
""".lstrip()

    started = time.perf_counter()
    try:
        with tempfile.TemporaryDirectory(prefix="csnav_cpp_") as temp_dir:
            src_path = os.path.join(temp_dir, "main.cpp")
            bin_path = os.path.join(temp_dir, "a.out")
            with open(src_path, "w", encoding="utf-8") as h:
                h.write(harness)

            compiled = _compile_source(
                [compiler, "-std=c++17", "-O1", "-w", "-o", bin_path, src_path],
                cwd=temp_dir,
                env=_hardened_compiled_env({"PATH": os.environ.get("PATH", "")}),
            )
            if compiled.returncode != 0:
                stderr = compiled.stderr.strip() or "C++ compilation failed."
                if "undefined reference" in stderr and function_name in stderr:
                    stderr = (
                        "The C++ runner could not find the function it needs to test.\n\n"
                        f"Expected shape:\n{expected_signature} {{\n"
                        "    // your code here\n"
                        "}\n\n"
                        "Check that the function name, parameter types, return type, and top-level placement match the starter."
                    )
                return {
                    "status": "error", "passed": 0, "total": 0, "tests": [],
                    "stdout": "",
                    "stderr": _truncate_text(stderr),
                    "duration_ms": round((time.perf_counter() - started) * 1000, 2),
                }

            run = _run_isolated_process(
                [bin_path],
                cwd=temp_dir,
                input_text="",
                env=_hardened_compiled_env({"PATH": os.environ.get("PATH", "")}),
                limiter=_limit_cpp_hardened,
            )
    except subprocess.TimeoutExpired:
        return {
            "status": "error", "passed": 0, "total": 0, "tests": [],
            "stdout": "",
            "stderr": f"The C++ run timed out after {RUN_TIMEOUT_SECONDS} seconds. Check for infinite loops or very slow logic.",
            "duration_ms": round((time.perf_counter() - started) * 1000, 2),
        }
    except Exception as exc:
        return empty_practice_run_response(f"C++ runner setup failed: {exc}")

    result = _finalize_compiled_result(
        run.stdout.splitlines(),
        started=started,
        stderr_text=run.stderr.strip(),
    )
    for index, item in enumerate(result.get("tests", [])):
        if index < len(tests) and "args" not in item:
            item["args"] = tests[index].get("args", [])
    return result


def run_cpp_practice_trace(code: str, function_name: str, test: dict[str, Any], arg_spec=None) -> dict[str, Any]:
    if not compiled_runners_enabled():
        return _cpp_trace_empty_response(
            "C++ tracing is disabled in this environment. Use Run if it is enabled here, or switch to another trace-capable language."
        )
    try:
        validate_cpp_code(code)
    except RunnerSecurityError as exc:
        return _cpp_trace_empty_response(f"Runner security check blocked this code: {exc}")

    compiler = _find_executable("g++", "clang++")
    if not compiler:
        return _cpp_trace_empty_response(
            "A C++ compiler (g++ or clang++) is not installed on this machine, so C++ tracing cannot run locally yet. "
            "Install g++ or clang++ on PATH to trace C++ locally."
        )

    args = test.get("args", []) or []
    expected = test.get("expected")
    case_insensitive = bool(test.get("case_insensitive"))
    arg_list = ", ".join(_cpp_literal(a) for a in args)
    if arg_spec:
        from practice_starters import cpp_native_bridge, cpp_native_signature
        expected_signature = cpp_native_signature(function_name, arg_spec)
        student_decl = cpp_native_bridge(function_name, arg_spec)
        call_target = f"__call_{function_name}"
        compat_adapter = _cpp_beginner_compat_adapter(code, function_name, arg_spec, expected_signature)
        student_section = f"{_instrument_cpp_trace_source(code)}\n\n{compat_adapter}\n\n{student_decl}"
        arg_names = [name for name, _ in arg_spec[0]]
    else:
        expected_signature = f"Value {function_name}(std::vector<Value> args)"
        student_decl = (
            f"// Student provides: Value {function_name}(vector<Value> args)\n"
            f"Value {function_name}(vector<Value> args);"
        )
        call_target = function_name
        compat_adapter = ""
        student_section = f"{student_decl}\n\n{_instrument_cpp_trace_source(code)}"
        arg_names = [f"arg{index + 1}" for index in range(len(args))]

    arg_bindings = [
        {"name": name, "value": _truncate_text(json.dumps(value), RUN_MAX_VALUE_CHARS)}
        for name, value in zip(arg_names, args)
    ]

    harness = f"""
#include <bits/stdc++.h>
using namespace std;

struct __Trace {{
    static vector<string> steps;
    static string esc(const string& s) {{
        string r;
        for (char c : s) {{
            if (c == '"' || c == '\\\\') r += '\\\\';
            if (c == '\\n') {{ r += "\\\\n"; continue; }}
            if (c == '\\r') {{ r += "\\\\r"; continue; }}
            r += c;
        }}
        return r;
    }}
    static void line(int line, const string& source, const string& kind, const string& message) {{
        steps.push_back("{{\\"line\\":" + to_string(line)
            + ",\\"source\\":\\"" + esc(source)
            + "\\",\\"operation_kind\\":\\"" + esc(kind)
            + "\\",\\"student_message\\":\\"" + esc(message) + "\\"}}");
    }}
    template <typename T>
    static string showValue(const T& value) {{
        ostringstream out;
        out << value;
        return out.str();
    }}
    static string showValue(const string& value) {{ return value; }}
    static string showValue(const char* value) {{ return string(value); }}
    static string showValue(bool value) {{ return value ? "true" : "false"; }}
    template <typename T>
    static string showValue(const vector<T>& values) {{
        string r = "[";
        for (size_t i = 0; i < values.size(); i++) {{
            if (i) r += ", ";
            r += showValue(values[i]);
        }}
        return r + "]";
    }}
    static string varsJson(initializer_list<pair<string,string>> vars) {{
        string r = "[";
        size_t i = 0;
        for (const auto& item : vars) {{
            if (i++) r += ",";
            r += "{{\\"name\\":\\"" + esc(item.first) + "\\",\\"value\\":\\"" + esc(item.second) + "\\"}}";
        }}
        return r + "]";
    }}
    static void lineVars(int line, const string& source, const string& kind, const string& message, initializer_list<pair<string,string>> vars) {{
        steps.push_back("{{\\"line\\":" + to_string(line)
            + ",\\"source\\":\\"" + esc(source)
            + "\\",\\"operation_kind\\":\\"" + esc(kind)
            + "\\",\\"student_message\\":\\"" + esc(message)
            + "\\",\\"vars\\":" + varsJson(vars) + "}}");
    }}
    static string stepsJson() {{
        string r = "[";
        for (size_t i = 0; i < steps.size(); i++) {{
            if (i) r += ",";
            r += steps[i];
        }}
        return r + "]";
    }}
}};
vector<string> __Trace::steps;

struct Value {{
    enum Kind {{ NUL, BOOL, INT, DBL, STR, ARR }} kind = NUL;
    bool b=false; long long i=0; double d=0; string s; vector<Value> a;
    Value() {{}}
    Value(bool x): kind(BOOL), b(x) {{}}
    Value(long long x): kind(INT), i(x) {{}}
    Value(double x): kind(DBL), d(x) {{}}
    Value(const string& x): kind(STR), s(x) {{}}
    Value(const vector<Value>& x): kind(ARR), a(x) {{}}
    string show() const {{
        switch (kind) {{
            case NUL: return "null";
            case BOOL: return b ? "true" : "false";
            case INT: return to_string(i);
            case DBL: {{ ostringstream o; o<<d; return o.str(); }}
            case STR: return s;
            case ARR: {{ string r="["; for(size_t k=0;k<a.size();k++){{ if(k) r+=", "; r+=a[k].show(); }} return r+"]"; }}
        }}
        return "";
    }}
    static string lowerCopy(string value) {{
        transform(value.begin(), value.end(), value.begin(), [](unsigned char c){{ return (char)tolower(c); }});
        return value;
    }}
    static string comparableString(const string& value, bool caseInsensitive) {{
        string lowered = lowerCopy(value);
        if (caseInsensitive || lowered == "none" || lowered == "null") return lowered;
        return value;
    }}
    bool eq(const Value& o, bool caseInsensitive=false) const {{
        if ((kind==INT||kind==DBL) && (o.kind==INT||o.kind==DBL)) {{
            double x = kind==INT? (double)i : d, y = o.kind==INT? (double)o.i : o.d; return x==y;
        }}
        if (kind != o.kind) return show()==o.show();
        switch (kind) {{
            case NUL: return true;
            case BOOL: return b==o.b;
            case STR: return comparableString(s, caseInsensitive)==comparableString(o.s, caseInsensitive);
            case ARR: {{ if(a.size()!=o.a.size()) return false; for(size_t k=0;k<a.size();k++) if(!a[k].eq(o.a[k], caseInsensitive)) return false; return true; }}
            default: return show()==o.show();
        }}
    }}
}};

{student_section}

static string esc(const string& s){{ string r; for(char c:s){{ if(c=='"'||c=='\\\\') r+='\\\\'; if(c=='\\n'){{ r+="\\\\n"; continue; }} if(c=='\\r'){{ r+="\\\\r"; continue; }} r+=c; }} return r; }}

int main(){{
    vector<Value> args = {{{arg_list}}};
    Value expected = {_cpp_literal(expected)};
    bool caseInsensitive = {str(case_insensitive).lower()};
    streambuf* realBuf = cout.rdbuf();
    ostringstream captured;
    cout.rdbuf(captured.rdbuf());
    Value actual;
    string error;
    try {{
        actual = {call_target}(args);
    }} catch (const exception& e) {{
        error = e.what();
    }} catch (...) {{
        error = "Unknown C++ exception";
    }}
    cout.rdbuf(realBuf);
    string stdoutText = captured.str();
    bool ok = error.empty() && actual.eq(expected, caseInsensitive);
    cout << "{{\\"__cpp_trace__\\":true"
         << ",\\"passed\\":" << (ok ? "true" : "false")
         << ",\\"expected\\":\\"" << esc(expected.show())
         << "\\",\\"actual\\":\\"" << esc(actual.show())
         << "\\",\\"stdout\\":\\"" << esc(stdoutText)
         << "\\",\\"error\\":\\"" << esc(error)
         << "\\",\\"steps\\":" << __Trace::stepsJson()
         << "}}" << "\\n";
    return 0;
}}
""".lstrip()

    started = time.perf_counter()
    try:
        with tempfile.TemporaryDirectory(prefix="csnav_cpptrace_") as temp_dir:
            src_path = os.path.join(temp_dir, "main.cpp")
            bin_path = os.path.join(temp_dir, "a.out")
            with open(src_path, "w", encoding="utf-8") as h:
                h.write(harness)

            compiled = _compile_source(
                [compiler, "-std=c++17", "-O1", "-w", "-o", bin_path, src_path],
                cwd=temp_dir,
                env=_hardened_compiled_env({"PATH": os.environ.get("PATH", "")}),
            )
            if compiled.returncode != 0:
                stderr = compiled.stderr.strip() or "C++ compilation failed."
                if "undefined reference" in stderr and function_name in stderr:
                    stderr = (
                        "The C++ runner could not find the function it needs to test.\n\n"
                        f"Expected shape:\n{expected_signature} {{\n"
                        "    // your code here\n"
                        "}\n\n"
                        "Check that the function name, parameter types, return type, and top-level placement match the starter."
                    )
                stderr = _truncate_text(stderr)
                line_no = _cpp_trace_compile_line(stderr) or 0
                step = {
                    "step": 1,
                    "current_line": line_no,
                    "previous_line": None,
                    "line": "",
                    "function": function_name,
                    "event": "exception",
                    "stdout": "",
                    "exception": {"type": "CompileError", "message": stderr, "line": line_no},
                    "operation_kind": "compile_error",
                    "student_message": f"C++ could not compile this code{f' on line {line_no}' if line_no else ''}.",
                    "frames": [{"name": function_name, "bindings": arg_bindings, "is_current": True}],
                    "objects": {},
                    "references": [],
                    "return_value": None,
                }
                return {
                    "status": "error",
                    "passed": 0,
                    "total": 1,
                    "tests": [],
                    "trace": [],
                    "trace_v2": _with_trace_v2_metadata(
                        {"schema_version": "trace_v2", "steps": [step], "limits": {"max_steps": RUN_RATE_LIMIT}},
                        language="cpp",
                        requested_language="cpp",
                        capability="practice_only",
                        trace_mode="practice",
                    ),
                    "stdout": "",
                    "stderr": stderr,
                    "duration_ms": round((time.perf_counter() - started) * 1000, 2),
                }

            run = _run_isolated_process(
                [bin_path],
                cwd=temp_dir,
                input_text="",
                env=_hardened_compiled_env({"PATH": os.environ.get("PATH", "")}),
                limiter=_limit_cpp_hardened,
            )
    except subprocess.TimeoutExpired:
        return _cpp_trace_empty_response(
            f"The C++ trace timed out after {RUN_TIMEOUT_SECONDS} seconds. Check for infinite loops or very slow logic."
        )
    except Exception as exc:
        return _cpp_trace_empty_response(f"C++ trace setup failed: {exc}")

    payload = None
    for line in run.stdout.splitlines():
        if not line.strip().startswith("{"):
            continue
        try:
            parsed = json.loads(line)
        except Exception:
            continue
        if parsed.get("__cpp_trace__"):
            payload = parsed
            break
    if not payload:
        return _cpp_trace_empty_response(run.stderr.strip() or "C++ trace output could not be parsed.")

    stdout_text = payload.get("stdout", "")
    raw_steps = payload.get("steps") or []
    trace_steps: list[dict[str, Any]] = []
    previous_line = None
    previous_bindings: dict[str, dict[str, Any]] = {}
    for index, item in enumerate(raw_steps, start=1):
        line_no = item.get("line") or 0
        bindings = _compiled_trace_bindings(arg_bindings, item.get("vars"))
        binding_changes = _compiled_trace_binding_changes(function_name, bindings, previous_bindings)
        step = {
            "step": index,
            "current_line": line_no,
            "previous_line": previous_line,
            "line": item.get("source", ""),
            "function": function_name,
            "event": "line",
            "stdout": stdout_text if index == len(raw_steps) else "",
            "exception": None,
            "return_value": None,
            "operation_kind": item.get("operation_kind") or "line",
            "operation_summary": item.get("student_message") or "C++ is about to run this line.",
            "student_message": item.get("student_message") or "C++ is about to run this line.",
            "frames": [{"name": function_name, "bindings": bindings, "is_current": True}],
            "binding_changes": binding_changes,
            "object_changes": [],
            "objects": {},
            "references": [],
        }
        previous_line = line_no
        previous_bindings = bindings
        trace_steps.append(step)

    if payload.get("error"):
        trace_steps.append({
            "step": len(trace_steps) + 1,
            "current_line": previous_line or 0,
            "previous_line": previous_line,
            "line": "",
            "function": function_name,
            "event": "exception",
            "stdout": stdout_text,
            "exception": {
                "type": "RuntimeError",
                "message": payload.get("error", ""),
                "line": previous_line or 0,
            },
            "return_value": None,
            "operation_kind": "exception",
            "operation_summary": "C++ stopped because an exception was raised.",
            "student_message": "C++ stopped because an exception was raised.",
            "frames": [{"name": function_name, "bindings": previous_bindings or _compiled_trace_bindings(arg_bindings, []), "is_current": True}],
            "binding_changes": [],
            "object_changes": [],
            "objects": {},
            "references": [],
        })
    elif trace_steps:
        trace_steps[-1]["return_value"] = payload.get("actual")
        trace_steps[-1]["event"] = "return"
        trace_steps[-1]["operation_kind"] = "return"
        trace_steps[-1]["student_message"] = f"C++ returned {payload.get('actual')}."
        trace_steps[-1]["operation_summary"] = trace_steps[-1]["student_message"]

    test_result = {
        "name": test.get("name") or "Trace test",
        "passed": bool(payload.get("passed")),
        "expected": payload.get("expected"),
        "actual": payload.get("actual"),
        "args": args,
    }
    if payload.get("error"):
        test_result["error"] = payload.get("error")
    return {
        "status": "passed" if test_result["passed"] else "failed",
        "passed": 1 if test_result["passed"] else 0,
        "total": 1,
        "tests": [test_result],
        "trace": [],
        "trace_v2": _with_trace_v2_metadata(
            {
                "schema_version": "trace_v2",
                "steps": trace_steps,
                "limits": {"max_steps": RUN_RATE_LIMIT, "max_output_chars": RUN_MAX_OUTPUT_CHARS},
            },
            language="cpp",
            requested_language="cpp",
            capability="practice_only",
            trace_mode="practice",
        ),
        "stdout": stdout_text,
        "stderr": _truncate_text(run.stderr.strip()),
        "duration_ms": round((time.perf_counter() - started) * 1000, 2),
    }


def run_java_freeform(code: str) -> dict[str, Any]:
    """Compile and run a complete Java program (with a main method); capture stdout.
    The student's code must declare a public class `Main` with a `main` method.
    """
    if not compiled_runners_enabled():
        return _empty_free_run_response(COMPILED_RUNNERS_DISABLED_MESSAGE)
    try:
        validate_java_code(code)
    except RunnerSecurityError as exc:
        response = _security_error_response(exc)
        response["free_run"] = True
        return response

    javac = _find_executable("javac")
    java = _find_executable("java")
    if not javac or not java:
        return _empty_free_run_response(
            "Java is not installed on this machine, so Java code cannot run locally yet. "
            "Install a JDK, or use Python/JavaScript."
        )

    started = time.perf_counter()
    try:
        with tempfile.TemporaryDirectory(prefix="csnav_javafree_") as temp_dir:
            with open(os.path.join(temp_dir, "Main.java"), "w", encoding="utf-8") as h:
                h.write(code)
            compiled = _compile_source(
                [javac, "-J-Xmx256m", "-d", temp_dir, "Main.java"],
                cwd=temp_dir,
                env={"PATH": os.environ.get("PATH", "")},
                limiter=_limit_jvm_resources,
            )
            if compiled.returncode != 0:
                return _empty_free_run_response(
                    _truncate_text(compiled.stderr.strip() or "Java compilation failed.")
                )
            run = _run_isolated_process(
                [java, "-cp", temp_dir, "-Xss8m", "-Xmx128m", "Main"],
                cwd=temp_dir,
                input_text="",
                env=_hardened_compiled_env({"PATH": os.environ.get("PATH", "")}),
                limiter=_limit_jvm_hardened,
            )
    except subprocess.TimeoutExpired:
        return _empty_free_run_response(
            f"The Java run timed out after {RUN_TIMEOUT_SECONDS} seconds. Check for infinite loops or very slow logic."
        )
    except Exception as exc:
        return _empty_free_run_response(f"Java runner setup failed: {exc}")

    stdout_text = _truncate_text(run.stdout)
    stderr_text = _truncate_text(run.stderr.strip())
    status = "ran" if run.returncode == 0 else "error"
    return {
        "status": status,
        "free_run": True,
        "tests": [],
        "stdout": stdout_text,
        "stderr": stderr_text if status == "error" else "",
        "duration_ms": round((time.perf_counter() - started) * 1000, 2),
    }


def run_cpp_freeform(code: str) -> dict[str, Any]:
    """Compile and run a complete C++ program (with a main function); capture stdout."""
    if not compiled_runners_enabled():
        return _empty_free_run_response(COMPILED_RUNNERS_DISABLED_MESSAGE)
    try:
        validate_cpp_code(code)
    except RunnerSecurityError as exc:
        response = _security_error_response(exc)
        response["free_run"] = True
        return response

    compiler = _find_executable("g++", "clang++")
    if not compiler:
        return _empty_free_run_response(
            "A C++ compiler (g++ or clang++) is not installed on this machine, so C++ code "
            "cannot run locally yet. Install one, or use Python/JavaScript."
        )

    started = time.perf_counter()
    try:
        with tempfile.TemporaryDirectory(prefix="csnav_cppfree_") as temp_dir:
            src_path = os.path.join(temp_dir, "main.cpp")
            bin_path = os.path.join(temp_dir, "a.out")
            with open(src_path, "w", encoding="utf-8") as h:
                h.write(code)
            compiled = _compile_source(
                [compiler, "-std=c++17", "-O1", "-w", "-o", bin_path, src_path],
                cwd=temp_dir,
                env=_hardened_compiled_env({"PATH": os.environ.get("PATH", "")}),
            )
            if compiled.returncode != 0:
                return _empty_free_run_response(
                    _truncate_text(compiled.stderr.strip() or "C++ compilation failed.")
                )
            run = _run_isolated_process(
                [bin_path],
                cwd=temp_dir,
                input_text="",
                env=_hardened_compiled_env({"PATH": os.environ.get("PATH", "")}),
                limiter=_limit_cpp_hardened,
            )
    except subprocess.TimeoutExpired:
        return _empty_free_run_response(
            f"The C++ run timed out after {RUN_TIMEOUT_SECONDS} seconds. Check for infinite loops or very slow logic."
        )
    except Exception as exc:
        return _empty_free_run_response(f"C++ runner setup failed: {exc}")

    stdout_text = _truncate_text(run.stdout)
    stderr_text = _truncate_text(run.stderr.strip())
    status = "ran" if run.returncode == 0 else "error"
    return {
        "status": status,
        "free_run": True,
        "tests": [],
        "stdout": stdout_text,
        "stderr": stderr_text if status == "error" else "",
        "duration_ms": round((time.perf_counter() - started) * 1000, 2),
    }


def _empty_free_run_response(message: str, status_value: str = "error") -> dict[str, Any]:
    """Free-run response with no test cases, used for personal workspace code."""
    return {
        "status": status_value,
        "free_run": True,
        "tests": [],
        "stdout": "",
        "stderr": message,
        "duration_ms": 0,
    }


def _parse_free_run_output(
    completed: subprocess.CompletedProcess[str],
    started: float,
    fallback_error: str,
) -> dict[str, Any]:
    """Shared parser for free-run subprocess output (Python and JavaScript)."""
    stdout_text = completed.stdout.strip()
    stderr_text = _truncate_text(completed.stderr.strip())
    if completed.returncode != 0 and not stdout_text:
        return _empty_free_run_response(stderr_text or fallback_error)

    try:
        payload = json.loads(stdout_text.splitlines()[-1])
    except Exception:
        return {
            "status": "error",
            "free_run": True,
            "tests": [],
            "stdout": _truncate_text(stdout_text),
            "stderr": stderr_text or "Runner output could not be parsed.",
            "duration_ms": round((time.perf_counter() - started) * 1000, 2),
        }

    return {
        "status": payload.get("status", "error"),
        "free_run": True,
        "tests": [],
        "stdout": _truncate_text(payload.get("stdout", "")),
        "stderr": _truncate_text(payload.get("error") or stderr_text),
        "duration_ms": payload.get("duration_ms", round((time.perf_counter() - started) * 1000, 2)),
    }


def run_python_freeform(code: str) -> dict[str, Any]:
    """Execute student Python without tests or grading and capture stdout."""
    try:
        validate_python_code(code)
    except RunnerSecurityError as exc:
        response = _security_error_response(exc)
        response["free_run"] = True
        return response

    runner_source = """
import ast
import builtins
import contextlib
import io
import json
import sys
import time
import types

started = time.perf_counter()
MAX_OUTPUT_CHARS = 12000
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
    "abs": abs, "all": all, "any": any, "bin": bin, "bool": bool, "callable": callable,
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

try:
    with contextlib.redirect_stdout(stdout_buffer):
        execute_student_module("solution.py")
    print(json.dumps({
        "status": "ran",
        "stdout": stdout_buffer.getvalue(),
        "duration_ms": round((time.perf_counter() - started) * 1000, 2),
    }))
except Exception as exc:
    print(json.dumps({
        "status": "error",
        "error": f"{type(exc).__name__}: {exc}",
        "stdout": stdout_buffer.getvalue(),
        "duration_ms": round((time.perf_counter() - started) * 1000, 2),
    }))
"""
    started = time.perf_counter()
    try:
        with tempfile.TemporaryDirectory(prefix="csnav_freerun_") as temp_dir:
            solution_path = os.path.join(temp_dir, "solution.py")
            runner_path = os.path.join(temp_dir, "runner.py")
            with open(solution_path, "w", encoding="utf-8") as handle:
                handle.write(code)
            with open(runner_path, "w", encoding="utf-8") as handle:
                handle.write(runner_source)

            completed = _run_isolated_process(
                [sys.executable, "-I", "-S", runner_path],
                cwd=temp_dir,
                input_text="",
                env={"PYTHONIOENCODING": "utf-8"},
            )
    except subprocess.TimeoutExpired:
        return _empty_free_run_response(
            f"The run timed out after {RUN_TIMEOUT_SECONDS} seconds. Check for infinite loops or very slow logic."
        )
    except Exception as exc:
        return _empty_free_run_response(f"Runner setup failed: {exc}")

    return _parse_free_run_output(completed, started, "Python returned an error before it could run.")


def run_javascript_freeform(code: str) -> dict[str, Any]:
    """Execute student JavaScript without tests or grading and capture console output."""
    try:
        validate_javascript_code(code)
    except RunnerSecurityError as exc:
        response = _security_error_response(exc)
        response["free_run"] = True
        return response

    runner_source = r"""
const fs = require("fs");
const vm = require("vm");
const { performance } = require("perf_hooks");

const started = performance.now();
const logs = [];
const MAX_OUTPUT_CHARS = 12000;
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
  const studentSource = cleanStudentCode(fs.readFileSync("solution.js", "utf8"));
  const prepared = captureFinalExpression(studentSource);
  vm.runInContext(prepared.source, sandbox, { timeout: 2000 });
  if (prepared.capturesExpression && typeof sandbox.__csnavLastValue !== "undefined") {
    appendLog(typeof sandbox.__csnavLastValue === "string" ? sandbox.__csnavLastValue : JSON.stringify(sandbox.__csnavLastValue));
  }
  process.stdout.write(JSON.stringify({
    status: "ran",
    stdout: logs.join("\n") + (logsTruncated ? "\n... output truncated by CS Navigator ..." : ""),
    duration_ms: Math.round((performance.now() - started) * 100) / 100,
  }));
} catch (error) {
  process.stdout.write(JSON.stringify({
    status: "error",
    error: String(error.message || error),
    stdout: logs.join("\n") + (logsTruncated ? "\n... output truncated by CS Navigator ..." : ""),
    duration_ms: Math.round((performance.now() - started) * 100) / 100,
  }));
}
"""
    started = time.perf_counter()
    try:
        with tempfile.TemporaryDirectory(prefix="csnav_freerun_js_") as temp_dir:
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
                input_text="",
                env=node_env,
            )
    except FileNotFoundError:
        return _empty_free_run_response("Node.js was not found, so JavaScript code cannot run locally yet.")
    except subprocess.TimeoutExpired:
        return _empty_free_run_response(
            f"The JavaScript run timed out after {RUN_TIMEOUT_SECONDS} seconds. Check for infinite loops or very slow logic."
        )
    except Exception as exc:
        return _empty_free_run_response(f"JavaScript runner setup failed: {exc}")

    return _parse_free_run_output(completed, started, "Node returned an error before it could run.")
