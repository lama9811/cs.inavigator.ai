"""
KB Prefetch - Belt-and-Suspenders Grounding
============================================
Pre-fetches KB docs and searches them with TF-IDF scoring so we can
inject relevant context into the system instruction via before_model_callback.

Even if Gemini skips the VertexAiSearchTool, the KB docs are already
in the prompt. Typical latency: <5ms for 71 docs.
"""

import os
import re
import math
import time
import threading
import logging
from collections import Counter

from google.cloud import discoveryengine_v1 as discoveryengine
from google.api_core.client_options import ClientOptions

log = logging.getLogger(__name__)

# Config
GCP_PROJECT = os.getenv("GOOGLE_CLOUD_PROJECT", "csnavigator-vertex-ai")
DATASTORE_ID = "csnavigator-kb-v7"
LOCATION = "us"
API_ENDPOINT = f"{LOCATION}-discoveryengine.googleapis.com"
BRANCH = (
    f"projects/{GCP_PROJECT}/locations/{LOCATION}/collections/default_collection"
    f"/dataStores/{DATASTORE_ID}/branches/default_branch"
)

# In-memory cache (same pattern as datastore_manager.py)
_cache: dict[str, dict] = {}
_cache_lock = threading.Lock()
_cache_ts: float = 0
_CACHE_TTL = 300  # 5 min

# BM25 index, rebuilt with the doc cache. Held separately so scoring never has to
# re-tokenize all 70 docs on every query (the old scorer did, per request).
_doc_tf: dict[str, Counter] = {}   # doc_id -> term frequencies
_doc_len: dict[str, int] = {}      # doc_id -> token count
_doc_title_tokens: dict[str, set] = {}
_df: Counter = Counter()           # term -> number of docs containing it
_avg_doc_len: float = 1.0

# BM25 params. k1 controls term-frequency saturation, b the doc-length
# normalization. 1.5/0.75 are the standard defaults and were what the ranking
# was validated against.
_BM25_K1 = 1.5
_BM25_B = 0.75
# An exact course-code hit ("COSC 354") is a far stronger signal than any word
# overlap, so it stays a large additive bonus on top of the BM25 score.
_ENTITY_BONUS = 10.0

# Per-doc excerpt injected into the prompt. _EXCERPT_LEAD is how much context
# to keep before a matched course code so its section/instructor lines (which
# follow the code) are always inside the window.
_EXCERPT_CHARS = 1500
_EXCERPT_LEAD = 300

_STOPWORDS = {
    "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "can", "shall", "i", "me", "my", "we",
    "our", "you", "your", "he", "she", "it", "they", "them", "this",
    "that", "what", "which", "who", "whom", "how", "when", "where",
    "why", "at", "by", "for", "from", "in", "of", "on", "to", "with",
    "and", "or", "but", "not", "if", "about", "up", "out", "so",
    "no", "just", "also", "than", "very", "too", "any", "each",
    "need", "get", "take", "make", "know", "want", "tell",
}


def _tokenize(text: str) -> list[str]:
    words = re.findall(r"\b[a-z]{2,}\b", text.lower())
    return [w for w in words if w not in _STOPWORDS]


_bg_loading = False

def _load_cache_sync():
    """Fetch all docs from Discovery Engine into memory."""
    global _cache_ts, _bg_loading
    client = discoveryengine.DocumentServiceClient(
        client_options=ClientOptions(api_endpoint=API_ENDPOINT)
    )
    new_cache = {}
    try:
        req = discoveryengine.ListDocumentsRequest(parent=BRANCH, page_size=200)
        for doc in client.list_documents(request=req):
            doc_id = doc.name.split("/")[-1]
            data = dict(doc.struct_data) if doc.struct_data else {}
            if doc.content and doc.content.raw_bytes:
                data["content"] = doc.content.raw_bytes.decode("utf-8")
            new_cache[doc_id] = data
    except Exception as e:
        log.warning(f"[KB_PREFETCH] Failed to load docs: {e}")
        _bg_loading = False
        return

    # Build the BM25 index outside the lock — it is pure CPU over local data.
    tf, dlen, title_tokens, df = {}, {}, {}, Counter()
    for doc_id, data in new_cache.items():
        title = data.get("title", "")
        tokens = _tokenize(f"{title} {data.get('content', '')}")
        tf[doc_id] = Counter(tokens)
        dlen[doc_id] = len(tokens) or 1
        title_tokens[doc_id] = set(_tokenize(title))
        for term in tf[doc_id]:
            df[term] += 1
    avg_len = (sum(dlen.values()) / len(dlen)) if dlen else 1.0

    global _doc_tf, _doc_len, _doc_title_tokens, _df, _avg_doc_len
    with _cache_lock:
        _cache.clear()
        _cache.update(new_cache)
        _doc_tf, _doc_len, _doc_title_tokens = tf, dlen, title_tokens
        _df, _avg_doc_len = df, avg_len
        _cache_ts = time.time()
    _bg_loading = False
    log.info(f"[KB_PREFETCH] Cached {len(new_cache)} docs, indexed {len(df)} terms")


def _load_cache() -> dict[str, dict]:
    """Return cached docs. If cache is cold, trigger background load and return empty.
    This ensures the first request is never blocked by the cache warm-up."""
    global _bg_loading
    now = time.time()
    with _cache_lock:
        if _cache and now - _cache_ts < _CACHE_TTL:
            return dict(_cache)

    # Cache is cold. Don't block the request. Load in background.
    if not _bg_loading:
        _bg_loading = True
        t = threading.Thread(target=_load_cache_sync, daemon=True)
        t.start()
        log.info("[KB_PREFETCH] Cache cold, loading in background...")

    # Return whatever we have (empty on first call, stale data on refresh)
    with _cache_lock:
        return dict(_cache)


def _idf(term: str, n_docs: int) -> float:
    """BM25 inverse document frequency. A term in 1 of 70 docs ('amjad') scores far
    above one in 40 ('office') — the property the old TF-only scorer lacked, which
    let generic words decide the ranking."""
    df = _df.get(term, 0)
    return math.log(1 + (n_docs - df + 0.5) / (df + 0.5))


def prefetch_kb_context(query: str, top_k: int = 3) -> str:
    """Search cached KB docs with BM25 scoring, return formatted context.

    Scoring notes (this was rewritten after it caused false "not in my knowledge
    base" refusals on questions the KB answered):
    - BM25, not raw TF. The previous scorer divided term frequency by document
      length with no IDF, so a rare surname scored ~0.01 while a coincidental
      title match scored 3.0 — content relevance could not affect the ranking.
    - Title matching is on TOKENS, not substrings. `"dr" in "Academic Withdrawal
      Refunds"` used to be true (withDRawal), which is what buried the faculty doc
      at rank #28 for "Dr. Amjad Ali's office and email".
    """
    docs = _load_cache()
    if not docs:
        return ""

    query_tokens = _tokenize(query)
    # Entity extraction: course codes like COSC 470
    entities = [c.replace(" ", " ") for c in re.findall(r"[A-Z]{2,4}\s*\d{3}", query.upper())]

    if not query_tokens and not entities:
        return ""

    with _cache_lock:
        doc_tf, doc_len, title_tokens = _doc_tf, _doc_len, _doc_title_tokens
        avg_len = _avg_doc_len
    n_docs = len(doc_tf) or 1
    unique_query_tokens = set(query_tokens)
    scored = []

    for doc_id, data in docs.items():
        content = data.get("content", "")
        title = data.get("title", "")
        score = 0.0

        if entities:
            searchable = f"{title} {content}".lower()
            for ent in entities:
                if ent.lower() in searchable:
                    score += _ENTITY_BONUS

        tf = doc_tf.get(doc_id)
        if tf:
            dl = doc_len.get(doc_id, 1)
            norm = _BM25_K1 * (1 - _BM25_B + _BM25_B * dl / avg_len)
            for token in unique_query_tokens:
                f = tf.get(token, 0)
                if f:
                    score += _idf(token, n_docs) * (f * (_BM25_K1 + 1)) / (f + norm)

        # Title match: token-level, and weighted by how discriminating the term is
        # so a common word in a title cannot outrank a rare word in the body.
        for token in unique_query_tokens & title_tokens.get(doc_id, set()):
            score += _idf(token, n_docs)

        if score > 0:
            # Center the excerpt on the matched course code instead of always
            # taking the head. The schedule docs are ~10k chars listing courses
            # alphabetically, so content[:1500] only ever reaches ~COSC 110 --
            # "COSC 354" sits at char ~6000 and could never be injected, which
            # left the pre-injection useless exactly when Gemini skipped the
            # search tool (the case this backstop exists for).
            lower_content = content.lower()
            pos = -1
            for ent in entities:
                pos = lower_content.find(ent.lower())
                if pos >= 0:
                    break
            if pos > _EXCERPT_LEAD:
                start = pos - _EXCERPT_LEAD
                excerpt = "..." + content[start:start + _EXCERPT_CHARS]
            else:
                excerpt = content[:_EXCERPT_CHARS]
            preview = f"[{title}] {excerpt}" if title else excerpt
            scored.append((preview, score))

    scored.sort(key=lambda x: -x[1])
    top = scored[:top_k]

    if not top:
        return ""

    # The header must NOT claim to be the knowledge base. When it did ("use this to
    # ground your answer"), the model treated these excerpts as a complete KB lookup,
    # skipped VertexAiSearchTool entirely, and emitted the "not in my knowledge base"
    # refusal for facts the KB holds and Vertex ranks #1.
    parts = [
        "[KEYWORD PRE-SEARCH EXCERPTS - partial, possibly irrelevant, NOT the "
        "knowledge base itself. These come from a local keyword match over document "
        "excerpts and are frequently incomplete or off-topic. You MUST still call the "
        "knowledge base search tool for this question. NEVER conclude that a fact is "
        "absent from the knowledge base because it is missing here.]"
    ]
    for i, (text, _) in enumerate(top, 1):
        parts.append(f"--- Excerpt {i} ---\n{text}")
    parts.append("[END KEYWORD PRE-SEARCH EXCERPTS]")
    return "\n".join(parts)
