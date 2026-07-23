"""
Practice-problem starter code generation
=========================================

Generates the per-language starter code a student sees when they open a Practice
Library problem. Extracted from main.py to keep that file smaller and to keep all
four languages driven by ONE source of truth so their signatures never drift.

The single source of truth is PRACTICE_ARG_SPECS: for each problem's canonical
(camelCase) function name it records the ordered arguments (name + type) and the
return kind, derived from the authored test cases. Every language's starter is
generated from this same spec, so Java/C++ get the same detailed, correctly-typed,
compiling scaffolding that Python/JavaScript already had via their signature maps.

When new questions are added, add their function here too (see the memory note
"coding-starter-cross-language-check") or they fall back to the generic hint.
"""

from __future__ import annotations

import re
from typing import Any

# ── Canonical argument spec (source of truth for ALL languages) ──────────────
# fn (camelCase) -> ([(argName, kind), ...], returnKind)
# kinds: "int" | "double" | "bool" | "string" | "intlist" | "strlist" | "grid" | "strgrid"
# returnKind: "int" | "bool" | "string" | "intlist" | "strlist" | "grid" | "list"
#
# Deliberately EXCLUDED — these fall back to the legacy Value/Object[] union path,
# which a clean native signature cannot express (verified by tests/test_native_bridge):
#   * Polymorphic (tests mix arg types): findIndex, everyOtherItem, nestedListDepthSum
#   * No dedicated tests: groupAnagrams, cloneGraph, serializeBinaryTree
#   * Nullable return (expect null on empty/none): maximumScore, smallestPositive,
#     firstRepeatedCharacter, mostRecentUnique
#   * Null embedded in the result list: kthLargestStream, lruCacheSimulation
#   * Float return (native int would truncate): medianOfTwoSortedLists, windowAverage
#   * Bool where a plain int is wrong: truthyAttendance (bool inputs), rateLimiter (bool outputs)
PRACTICE_ARG_SPECS: dict[str, tuple[list[tuple[str, str]], str]] = {
    "alienDictionaryOrder": ([("words", "strlist")], "string"),
    "balancedBrackets": ([("text", "string")], "bool"),
    "binarySearchExact": ([("nums", "intlist"), ("target", "int")], "int"),
    "binarySearchInsertPosition": ([("nums", "intlist"), ("target", "int")], "int"),
    "canVote": ([("age", "int")], "bool"),
    "clampScore": ([("score", "int")], "int"),
    "compressRuns": ([("text", "string")], "string"),
    "countDigits": ([("n", "int")], "int"),
    "countIslands": ([("grid", "grid")], "int"),
    "countVowels": ([("text", "string")], "int"),
    "countWords": ([("sentence", "string")], "int"),
    "coursePlanTopologicalOrder": ([("courses", "strlist"), ("prereqs", "strgrid")], "strlist"),
    "coursePrerequisiteChain": ([("pairs", "strgrid"), ("course", "string"), ("prereq", "string")], "bool"),
    "decodeWays": ([("digits", "string")], "int"),
    "editDistance": ([("source", "string"), ("target", "string")], "int"),
    "earliestConnectedTime": ([("n", "int"), ("events", "grid")], "int"),
    "expressionEvaluator": ([("expression", "string")], "int"),
    "firstMissingPositiveSmall": ([("nums", "intlist")], "int"),
    "gradeBucket": ([("score", "int")], "string"),
    "helpDeskQueue": ([("commands", "strlist")], "strlist"),
    "initials": ([("fullName", "string")], "string"),
    "isPalindrome": ([("text", "string")], "bool"),
    "lastDigit": ([("number", "int")], "int"),
    "longestIncreasingSubsequenceLength": ([("nums", "intlist")], "int"),
    "longestUniqueWindow": ([("text", "string")], "int"),
    "matrixRowSums": ([("matrix", "grid")], "intlist"),
    "matrixColumnSums": ([("matrix", "grid")], "intlist"),
    "maximalSquare": ([("matrix", "grid")], "int"),
    "maximumSubarrayWithOneDeletion": ([("nums", "intlist")], "int"),
    "maximumWindowSum": ([("nums", "intlist"), ("k", "int")], "int"),
    "mergeNames": ([("firstNames", "strlist"), ("secondNames", "strlist")], "strlist"),
    "mergeOverlappingIntervals": ([("intervals", "grid")], "grid"),
    "mergeSortedLists": ([("left", "intlist"), ("right", "intlist")], "intlist"),
    "minStackOperations": ([("commands", "strlist")], "intlist"),
    "minimumMeetingRooms": ([("intervals", "grid")], "int"),
    "normalizeEmailList": ([("emails", "strlist")], "strlist"),
    "pairSumSorted": ([("nums", "intlist"), ("target", "int")], "bool"),
    "prefixSearch": ([("words", "strlist"), ("prefix", "string")], "strlist"),
    "rangeSumQueries": ([("nums", "intlist"), ("queries", "grid")], "intlist"),
    "removeDuplicatesKeepOrder": ([("nums", "intlist")], "intlist"),
    "recursiveDigitSum": ([("n", "int")], "int"),
    "reverseWords": ([("sentence", "string")], "string"),
    "rotateListRight": ([("items", "intlist"), ("k", "int")], "intlist"),
    "runningTotal": ([("nums", "intlist")], "intlist"),
    "shortestPathInCampusGrid": ([("grid", "strgrid")], "int"),
    "subarraySumEqualsK": ([("nums", "intlist"), ("k", "int")], "int"),
    "sumEvenNumbers": ([("nums", "intlist")], "int"),
    "temperatureAboveThreshold": ([("readings", "intlist"), ("threshold", "int")], "int"),
    "topKScores": ([("scores", "intlist"), ("k", "int")], "intlist"),
    "topKFrequent": ([("items", "intlist"), ("k", "int")], "intlist"),
    "treeLevelSums": ([("tree", "intlist")], "intlist"),
    "triePrefixCounts": ([("commands", "strlist")], "intlist"),
    "twoSumIndexes": ([("nums", "intlist"), ("target", "int")], "intlist"),
    "unionFindComponents": ([("n", "int"), ("pairs", "grid")], "int"),
    "uniqueCount": ([("nums", "intlist")], "int"),
    "validCourseCodeShape": ([("code", "string")], "bool"),
    "validStudySchedule": ([("intervals", "grid")], "bool"),
    "wordLadderSteps": ([("start", "string"), ("end", "string"), ("dictionary", "strlist")], "int"),
    "anyWordHasPrefix": ([("words", "strlist"), ("prefix", "string")], "bool"),
}


def _camel_to_snake(name: str) -> str:
    """editDistance -> edit_distance, so a Python function_name resolves the spec."""
    return re.sub(r"(?<!^)(?=[A-Z])", "_", name or "").lower()


def _spec_for(function_name: str) -> tuple[list[tuple[str, str]], str] | None:
    """Look up the arg spec by camelCase or snake_case function name."""
    if not function_name:
        return None
    if function_name in PRACTICE_ARG_SPECS:
        return PRACTICE_ARG_SPECS[function_name]
    # Python uses snake_case; find the camelCase key that normalizes to it.
    target = _camel_to_snake(function_name)
    for camel, spec in PRACTICE_ARG_SPECS.items():
        if _camel_to_snake(camel) == target:
            return spec
    return None


# ── Per-language type/idiom tables ───────────────────────────────────────────
_PY_TYPES = {
    "int": "int", "double": "float", "bool": "bool", "string": "str",
    "intlist": "list[int]", "strlist": "list[str]", "grid": "list[list[int]]",
    "list": "list", "object": "object",
}
_PY_RETURNS = {
    "int": "int", "bool": "bool", "string": "str",
    "intlist": "list[int]", "strlist": "list[str]", "grid": "list[list[int]]", "list": "list",
}

_JS_TYPES = {
    "int": "number", "double": "number", "bool": "boolean", "string": "string",
    "intlist": "number[]", "strlist": "string[]", "grid": "number[][]",
    "list": "unknown[]", "object": "unknown",
}
_JS_RETURNS = {
    "int": "number", "bool": "boolean", "string": "string",
    "intlist": "number[]", "strlist": "string[]", "grid": "number[][]", "list": "unknown[]",
}


def _build_python(function_name: str, spec: tuple[list[tuple[str, str]], str]) -> str:
    args, ret = spec
    params = ", ".join(f"{name}: {_PY_TYPES.get(kind, 'Any')}" for name, kind in args) or "data"
    return_type = _PY_RETURNS.get(ret, "object")
    return (
        "from typing import Any\n\n"
        f"def {function_name}({params}) -> {return_type}:\n"
        '    raise NotImplementedError("Finish this guided starter.")'
    )


def _build_javascript(function_name: str, spec: tuple[list[tuple[str, str]], str]) -> str:
    args, ret = spec
    param_names = ", ".join(name for name, _ in args) or "data"
    doc = "".join(
        f" * @param {{{_JS_TYPES.get(kind, 'unknown')}}} {name}\n" for name, kind in args
    )
    return (
        "/**\n"
        f"{doc}"
        f" * @returns {{{_JS_RETURNS.get(ret, 'unknown')}}}\n"
        " */\n"
        f"function {function_name}({param_names}) {{\n"
        "  // Replace this with your approach and return the answer.\n"
        "  return null;\n"
        "}\n\n"
        f"export {{ {function_name} }};"
    )


# Java: the student writes a clean, native-typed method inside a Solution class,
# just like a normal editor (no Object[] union). A hidden harness bridge unpacks
# the test args and calls it. Default-return per kind so the scaffold compiles.
_JAVA_DEFAULT_RETURN = {
    "int": "return 0;", "bool": "return false;", "string": 'return "";',
    "intlist": "return new int[0];", "strlist": "return new String[0];",
    "grid": "return new int[0][0];",
    "list": "return new int[0];",
}


def _build_java(function_name: str, spec: tuple[list[tuple[str, str]], str]) -> str:
    _, ret = spec
    default_return = _JAVA_DEFAULT_RETURN.get(ret, "return null;")
    return (
        "import java.util.*;\n\n"
        "class Solution {\n"
        f"    {java_native_signature(function_name, spec)} {{\n"
        "        // Write your solution here.\n"
        f"        {default_return}\n"
        "    }\n"
        "}"
    )


# C++: the student writes a clean, native-typed function (string/int/vector),
# like a normal file. A hidden harness bridge unpacks the inputs and calls it.
_CPP_DEFAULT_RETURN = {
    "int": "return 0;", "bool": "return false;", "string": 'return "";',
    "intlist": "return {};", "strlist": "return {};", "grid": "return {};",
    "list": "return {};",
}


def _build_cpp(function_name: str, spec: tuple[list[tuple[str, str]], str]) -> str:
    _, ret = spec
    default_return = _CPP_DEFAULT_RETURN.get(ret, "return {};")
    return (
        "#include <bits/stdc++.h>\n"
        "using namespace std;\n\n"
        f"{cpp_native_signature(function_name, spec)} {{\n"
        "    // Write your solution here.\n"
        f"    {default_return}\n"
        "}"
    )


_BUILDERS = {
    "python": _build_python,
    "javascript": _build_javascript,
    "java": _build_java,
    "cpp": _build_cpp,
}


def build_starter_from_spec(language_key: str, function_name: str) -> str | None:
    """Return detailed starter code for a function that has an arg spec, or None
    if it isn't in PRACTICE_ARG_SPECS (caller falls back to the generic hint)."""
    spec = _spec_for(function_name)
    if not spec:
        return None
    builder = _BUILDERS.get(language_key)
    if not builder:
        return None
    return builder(function_name, spec)


def get_arg_spec(function_name: str) -> tuple[list[tuple[str, str]], str] | None:
    """Public spec lookup for the runner's native-type bridge (returns None when
    the function has no spec, so the runner uses its legacy union signature)."""
    return _spec_for(function_name)


# ── C++ native bridge ────────────────────────────────────────────────────────
# Lets the STUDENT write a clean native-typed function (e.g.
# `int editDistance(string source, string target)`) while the harness keeps its
# Value union. The bridge unpacks each Value arg into a native local, calls the
# student's function, and wraps the native result back into a Value.
_CPP_NATIVE_TYPE = {
    "int": "long long", "double": "double", "bool": "bool", "string": "std::string",
    "intlist": "std::vector<long long>", "strlist": "std::vector<std::string>",
    "grid": "std::vector<std::vector<long long>>",
    "strgrid": "std::vector<std::vector<std::string>>",
}
_CPP_RET_TYPE = {
    "int": "long long", "bool": "bool", "string": "std::string",
    "intlist": "std::vector<long long>", "strlist": "std::vector<std::string>",
    "grid": "std::vector<std::vector<long long>>",
    "list": "std::vector<long long>",
}


def _cpp_unpack_expr(kind: str, src: str) -> str:
    """C++ expression converting a Value `src` into its native type."""
    if kind == "int":
        return f"{src}.i"
    if kind == "double":
        return f"{src}.d"
    if kind == "bool":
        return f"{src}.b"
    if kind == "string":
        return f"{src}.s"
    if kind == "intlist":
        return f"__toIntVec({src})"
    if kind == "strlist":
        return f"__toStrVec({src})"
    if kind == "grid":
        return f"__toGrid({src})"
    if kind == "strgrid":
        return f"__toStrGrid({src})"
    return src


def cpp_native_signature(function_name: str, spec) -> str:
    """The native C++ signature the student implements (used in the starter)."""
    args, ret = spec
    params = ", ".join(f"{_CPP_NATIVE_TYPE.get(k, 'Value')} {n}" for n, k in args)
    return f"{_CPP_RET_TYPE.get(ret, 'Value')} {function_name}({params})"


def cpp_native_bridge(function_name: str, spec) -> str:
    """Helper conversions + the forward decl + a `__call(args)` bridge returning a
    Value, so the existing runTest harness can stay unchanged."""
    args, ret = spec
    unpacks = ", ".join(_cpp_unpack_expr(k, f"args[{i}]") for i, (_, k) in enumerate(args))
    # Wrap the native return value back into a Value the harness can compare.
    if ret == "int":
        wrap = "return Value((long long)__r);"
    elif ret == "bool":
        wrap = "return Value((bool)__r);"
    elif ret == "string":
        wrap = "return Value(std::string(__r));"
    elif ret in ("intlist", "list"):
        wrap = "std::vector<Value> __v; for (auto& __x : __r) __v.push_back(Value((long long)__x)); return Value(__v);"
    elif ret == "strlist":
        wrap = "std::vector<Value> __v; for (auto& __x : __r) __v.push_back(Value(std::string(__x))); return Value(__v);"
    elif ret == "grid":
        wrap = "std::vector<Value> __rows; for (auto& __row : __r) { std::vector<Value> __v; for (auto& __x : __row) __v.push_back(Value((long long)__x)); __rows.push_back(Value(__v)); } return Value(__rows);"
    else:
        wrap = "return Value();"
    return f"""// Native-type conversion helpers (harness-provided).
static std::vector<long long> __toIntVec(const Value& v) {{
    std::vector<long long> r; for (auto& e : v.a) r.push_back(e.i); return r;
}}
static std::vector<std::string> __toStrVec(const Value& v) {{
    std::vector<std::string> r; for (auto& e : v.a) r.push_back(e.s); return r;
}}
static std::vector<std::vector<long long>> __toGrid(const Value& v) {{
    std::vector<std::vector<long long>> r;
    for (auto& row : v.a) {{ std::vector<long long> rr; for (auto& e : row.a) rr.push_back(e.i); r.push_back(rr); }}
    return r;
}}
static std::vector<std::vector<std::string>> __toStrGrid(const Value& v) {{
    std::vector<std::vector<std::string>> r;
    for (auto& row : v.a) {{ std::vector<std::string> rr; for (auto& e : row.a) rr.push_back(e.s); r.push_back(rr); }}
    return r;
}}

// Student's native-typed function:
{cpp_native_signature(function_name, spec)};

// Bridge the harness calls (unpacks Value args -> native, wraps result -> Value):
static Value __call_{function_name}(std::vector<Value> args) {{
    auto __r = {function_name}({unpacks});
    {wrap}
}}"""


# ── Java native bridge ───────────────────────────────────────────────────────
_JAVA_NATIVE_TYPE = {
    "int": "int", "double": "double", "bool": "boolean", "string": "String",
    "intlist": "int[]", "strlist": "String[]", "grid": "int[][]",
    "strgrid": "String[][]",
}
_JAVA_RET_TYPE = {
    "int": "int", "bool": "boolean", "string": "String",
    "intlist": "int[]", "strlist": "String[]", "grid": "int[][]", "list": "int[]",
}


def _java_unpack_expr(kind: str, src: str) -> str:
    if kind == "int":
        return f"((Number) {src}).intValue()"
    if kind == "double":
        return f"((Number) {src}).doubleValue()"
    if kind == "bool":
        return f"(Boolean) {src}"
    if kind == "string":
        return f"(String) {src}"
    if kind == "intlist":
        return f"__toIntArr({src})"
    if kind == "strlist":
        return f"__toStrArr({src})"
    if kind == "grid":
        return f"__toGrid({src})"
    if kind == "strgrid":
        return f"__toStrGrid({src})"
    return src


def java_native_signature(function_name: str, spec) -> str:
    args, ret = spec
    params = ", ".join(f"{_JAVA_NATIVE_TYPE.get(k, 'Object')} {n}" for n, k in args)
    return f"static {_JAVA_RET_TYPE.get(ret, 'Object')} {function_name}({params})"


def java_native_bridge(function_name: str, spec) -> str:
    """Bridge method + helpers the Runner harness uses to call the student's
    native-typed Solution.<fn>. Returns Object so the compare logic is unchanged.
    An int[] result is boxed to Object[] so the harness's deepEquals compare works."""
    args, ret = spec
    unpacks = ", ".join(_java_unpack_expr(k, f"args[{i}]") for i, (_, k) in enumerate(args))
    if ret in ("intlist", "list"):
        # Box as Long to match the harness's expected literals (rendered as `1L`),
        # since Arrays.deepEquals compares elements with .equals() (Integer!=Long).
        wrap = ("int[] __r = Solution." + function_name + f"({unpacks});\n"
                "        Object[] __o = new Object[__r.length];\n"
                "        for (int __i = 0; __i < __r.length; __i++) __o[__i] = (long) __r[__i];\n"
                "        return __o;")
    elif ret == "strlist":
        wrap = ("String[] __r = Solution." + function_name + f"({unpacks});\n"
                "        Object[] __o = new Object[__r.length];\n"
                "        for (int __i = 0; __i < __r.length; __i++) __o[__i] = __r[__i];\n"
                "        return __o;")
    elif ret == "grid":
        wrap = ("int[][] __r = Solution." + function_name + f"({unpacks});\n"
                "        Object[] __rows = new Object[__r.length];\n"
                "        for (int __i = 0; __i < __r.length; __i++) {\n"
                "            Object[] __row = new Object[__r[__i].length];\n"
                "            for (int __j = 0; __j < __r[__i].length; __j++) __row[__j] = (long) __r[__i][__j];\n"
                "            __rows[__i] = __row;\n"
                "        }\n"
                "        return __rows;")
    else:
        wrap = f"return Solution.{function_name}({unpacks});"
    return f"""    static int[] __toIntArr(Object o) {{
        Object[] a = (Object[]) o; int[] r = new int[a.length];
        for (int i = 0; i < a.length; i++) r[i] = ((Number) a[i]).intValue();
        return r;
    }}
    static String[] __toStrArr(Object o) {{
        Object[] a = (Object[]) o; String[] r = new String[a.length];
        for (int i = 0; i < a.length; i++) r[i] = (String) a[i];
        return r;
    }}
    static int[][] __toGrid(Object o) {{
        Object[] a = (Object[]) o; int[][] r = new int[a.length][];
        for (int i = 0; i < a.length; i++) r[i] = __toIntArr(a[i]);
        return r;
    }}
    static String[][] __toStrGrid(Object o) {{
        Object[] a = (Object[]) o; String[][] r = new String[a.length][];
        for (int i = 0; i < a.length; i++) r[i] = __toStrArr(a[i]);
        return r;
    }}
    static Object __call(Object[] args) {{
        {wrap}
    }}"""
