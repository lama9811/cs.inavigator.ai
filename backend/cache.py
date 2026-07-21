# -*- coding: utf-8 -*-
"""
Multi-Tier Cache Module for CS Navigator Chatbot
=================================================
Provides L1 (in-memory) + L2 (Redis) + Semantic (embedding similarity) caching.

Architecture:
    Request → L1 (In-Memory) → L2 (Redis) → Semantic (Embedding) → AI
               ~0.001ms         ~1-2ms        ~25-50ms              ~2-5s

L1: Fast, local to each server instance (cachetools TTLCache)
L2: Shared across servers, persistent (Redis Cloud)
Semantic: Matches similar queries via Google text-embedding-004 vectors.
          "prerequisites for data structures" matches "what do I need before COSC 220"
"""

import hashlib
import json
import os
import re
import time
import logging
from typing import Optional
from cachetools import TTLCache
import threading
from threading import Lock

import numpy as np

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ============================================================================
# CACHE CONFIGURATION
# ============================================================================

# L1 (In-Memory) Settings
L1_CACHE_MAX_SIZE = 500  # Smaller since Redis is L2
L1_CACHE_TTL_SECONDS = 3600  # 1 hour for L1 (hot cache)

# L2 (Redis) Settings
L2_CACHE_TTL_SECONDS = 28800  # 8 hours for Redis

# Short TTL for time-sensitive modes (General mode: web-grounded, "live" answers).
# cachetools.TTLCache has ONE global TTL and can't expire per-key, so short-lived
# L1 entries live in a separate instance; Redis expires per-key via setex.
SHORT_CACHE_TTL_SECONDS = 1200  # 20 minutes

# Semantic Cache Settings
SEMANTIC_SIMILARITY_THRESHOLD = 0.95  # Cosine sim threshold (0.95 = near-exact match only, prevents cross-topic false positives)
SEMANTIC_MAX_ENTRIES = 100  # Max cached embeddings in memory
SEMANTIC_EMBEDDING_MODEL = 'text-embedding-004'
SEMANTIC_EMBEDDING_DIMS = 256  # Matryoshka truncation, 256 is fast + accurate enough

# Minimum query length to cache (avoid caching "hi", "hello", etc.)
MIN_QUERY_LENGTH = 15

# Queries containing these words should NOT be cached (personalized or
# time-sensitive responses). The cache key does not include user_id for general
# answers, so anything that recalls a user's own facts — or goes stale fast —
# must be blocked here so it is never shared with another student.
NO_CACHE_KEYWORDS = [
    # personalized — recalls the asking student's own record
    "my advisor",
    "my gpa",
    "my credits",
    "my courses",
    "my classes",
    "my schedule",
    "my degree",
    "my major",
    "my minor",
    "my audit",
    "my transcript",
    "my professor",
    "my grade",
    "my graduation",
    "my enrollment",
    "my name",
    "my student",
    "i have",
    "i need",
    "i am",
    "i'm",
    "remind me",
    "remember",
    "about me",
    "about myself",
    "recommend me",
    "for me",
    # time-sensitive — answers go stale fast, don't share them
    "right now",
    "today",
    "currently open",
    "is registration open",
]

# Recall questions like "what's MY advisor" / "who am I" / "did I pass" are
# answered from the student's own history and are never safe to share, even if
# they dodge the substring list above. Mirrors the app-layer personalization
# guard so the two stay in sync.
_PERSONAL_RECALL_RE = re.compile(
    r"\b(?:am\s+i\b|did\s+i\b|remind\s+me\b|about\s+(?:me|myself)\b"
    r"|(?:what|who|where|when)(?:'s|s|\s+is|\s+was|\s+are)?\s+my\b"
    r"|who\s+am\s+i\b)",
    re.IGNORECASE,
)

# A personalized opening greeting ("Hi Alex!", "Hello Alex Chen,") must be
# scrubbed before an answer enters the SHARED cache, or one student's name leaks
# to every other student who asks the same question. Strips ONLY a leading
# salutation + 1-3 capitalized name tokens + a punctuation terminator; the
# generic body of the answer is left untouched and stays cacheable.
_PERSONAL_GREETING_RE = re.compile(
    r"^\s*(?i:hi|hello|hey|greetings|dear|good\s+(?:morning|afternoon|evening))"
    r"[ \t]*[,]?[ \t]+"
    r"[A-Z][\w'’.\-]*(?:[ \t]+[A-Z][\w'’.\-]*){0,2}"
    r"[ \t]*[-!,.:;…—–]+[ \t]*",
)


def _strip_personal_greeting(text: Optional[str]) -> Optional[str]:
    """Remove a leading 'Hi <Name>,' salutation so a cached answer never carries
    one student's name to the next. No-op when there is no such greeting."""
    if not text or not isinstance(text, str):
        return text
    return _PERSONAL_GREETING_RE.sub("", text, count=1)

# Redis Configuration (from environment variables)
REDIS_URL = os.getenv("REDIS_URL", "")
REDIS_HOST = os.getenv("REDIS_HOST", "")
REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))
REDIS_PASSWORD = os.getenv("REDIS_PASSWORD", "")
REDIS_USERNAME = os.getenv("REDIS_USERNAME", "default")


# ============================================================================
# L1 CACHE (IN-MEMORY)
# ============================================================================

class L1Cache:
    """
    Level 1 Cache: In-memory LRU + TTL cache.
    Fastest access, local to each server instance.
    """

    def __init__(self, max_size: int = L1_CACHE_MAX_SIZE, ttl: int = L1_CACHE_TTL_SECONDS):
        self._cache = TTLCache(maxsize=max_size, ttl=ttl)
        self._lock = Lock()
        self._stats = {"hits": 0, "misses": 0}

    def get(self, key: str) -> Optional[str]:
        with self._lock:
            value = self._cache.get(key)
            if value is not None:
                self._stats["hits"] += 1
                return value
            self._stats["misses"] += 1
            return None

    def set(self, key: str, value: str) -> None:
        with self._lock:
            self._cache[key] = value

    def delete(self, key: str) -> bool:
        with self._lock:
            if key in self._cache:
                del self._cache[key]
                return True
            return False

    def clear(self) -> int:
        with self._lock:
            count = len(self._cache)
            self._cache.clear()
            self._stats = {"hits": 0, "misses": 0}
            return count

    def get_stats(self) -> dict:
        with self._lock:
            total = self._stats["hits"] + self._stats["misses"]
            hit_rate = (self._stats["hits"] / total * 100) if total > 0 else 0
            return {
                "hits": self._stats["hits"],
                "misses": self._stats["misses"],
                "hit_rate": f"{hit_rate:.1f}%",
                "size": len(self._cache),
                "max_size": self._cache.maxsize,
            }


# ============================================================================
# L2 CACHE (REDIS)
# ============================================================================

class L2Cache:
    """
    Level 2 Cache: Redis distributed cache.
    Shared across all server instances, persistent.
    """

    def __init__(self, ttl: int = L2_CACHE_TTL_SECONDS):
        self.ttl = ttl
        self._client = None
        self._connected = False
        self._stats = {"hits": 0, "misses": 0, "errors": 0}
        # Connect off the import path: this is a network round trip to Redis
        # Cloud that measured ~3.5s on Cloud Run, and it ran before the app
        # could serve traffic. Until it lands, _connected stays False and we
        # serve L1-only -- the same graceful degradation as an unreachable Redis.
        threading.Thread(target=self._connect, name="l2-cache-connect", daemon=True).start()

    def _connect(self):
        """Initialize Redis connection."""
        try:
            import redis

            if REDIS_URL:
                self._client = redis.from_url(REDIS_URL, decode_responses=True)
            else:
                self._client = redis.Redis(
                    host=REDIS_HOST,
                    port=REDIS_PORT,
                    password=REDIS_PASSWORD,
                    username=REDIS_USERNAME,
                    decode_responses=True,
                    socket_timeout=5,
                    socket_connect_timeout=5,
                    retry_on_timeout=True,
                )

            # Test connection
            self._client.ping()
            self._connected = True
            logger.info(f"[REDIS] Connected to {REDIS_HOST}:{REDIS_PORT}")

        except Exception as e:
            self._connected = False
            logger.warning(f"[REDIS] Connection failed: {e}. Running without L2 cache.")

    def is_connected(self) -> bool:
        return self._connected

    def get(self, key: str) -> Optional[str]:
        if not self._connected:
            return None

        try:
            value = self._client.get(f"csnavigator:{key}")
            if value is not None:
                self._stats["hits"] += 1
                return value
            self._stats["misses"] += 1
            return None
        except Exception as e:
            self._stats["errors"] += 1
            logger.warning(f"[REDIS] Get error: {e}")
            return None

    def set(self, key: str, value: str, ttl: Optional[int] = None) -> bool:
        if not self._connected:
            return False

        try:
            self._client.setex(f"csnavigator:{key}", ttl or self.ttl, value)
            return True
        except Exception as e:
            self._stats["errors"] += 1
            logger.warning(f"[REDIS] Set error: {e}")
            return False

    def delete(self, key: str) -> bool:
        if not self._connected:
            return False

        try:
            return self._client.delete(f"csnavigator:{key}") > 0
        except Exception as e:
            self._stats["errors"] += 1
            logger.warning(f"[REDIS] Delete error: {e}")
            return False

    def clear(self) -> int:
        """Clear all csnavigator keys from Redis."""
        if not self._connected:
            return 0

        try:
            keys = self._client.keys("csnavigator:*")
            if keys:
                count = self._client.delete(*keys)
                self._stats = {"hits": 0, "misses": 0, "errors": 0}
                return count
            return 0
        except Exception as e:
            self._stats["errors"] += 1
            logger.warning(f"[REDIS] Clear error: {e}")
            return 0

    def get_stats(self) -> dict:
        total = self._stats["hits"] + self._stats["misses"]
        hit_rate = (self._stats["hits"] / total * 100) if total > 0 else 0

        info = {"connected": self._connected}
        if self._connected:
            try:
                db_size = len(self._client.keys("csnavigator:*"))
                info["size"] = db_size
            except:
                info["size"] = "unknown"

        return {
            **info,
            "hits": self._stats["hits"],
            "misses": self._stats["misses"],
            "errors": self._stats["errors"],
            "hit_rate": f"{hit_rate:.1f}%",
        }


# ============================================================================
# SEMANTIC CACHE (EMBEDDING SIMILARITY)
# ============================================================================

class SemanticCache:
    """
    Semantic similarity cache using Google text-embedding-004.
    Matches queries with similar meaning even when worded differently.

    Example matches (above 0.92 cosine similarity):
      "prerequisites for data structures" ~ "what do I need before taking COSC 220"
      "AI courses at Morgan State" ~ "what classes cover artificial intelligence"

    Entries are stored in-memory for fast search and persisted to Redis
    for durability across server restarts.
    """

    def __init__(self, l2_cache: L2Cache):
        # Each entry: (embedding_ndarray, query_text, response_text, context_hash)
        # context_hash namespaces entries so a general-tutor answer is never
        # matched against a Morgan/personalized answer (and vice versa).
        self._entries: list[tuple[np.ndarray, str, str, str]] = []
        self._lock = Lock()
        self._l2 = l2_cache
        self._genai_client = None
        self._available = False
        self._stats = {"hits": 0, "misses": 0, "errors": 0, "embed_time_ms": 0}
        # Off the import path for the same reason as L2Cache._connect: building
        # the genai client resolves ADC via the metadata server and then reads
        # persisted entries out of Redis (~2.5s on Cloud Run). Until it lands,
        # _available stays False and semantic lookups are simply skipped.
        threading.Thread(target=self._init_client, name="semantic-cache-init", daemon=True).start()

    def _init_client(self):
        """Initialize Google embedding client."""
        try:
            from google import genai
            project = os.getenv("GOOGLE_CLOUD_PROJECT", "").strip()
            location = (
                os.getenv("GOOGLE_CLOUD_LOCATION", "")
                or os.getenv("VERTEX_AI_LOCATION", "")
            ).strip()
            client_options = {"vertexai": True}
            if project:
                client_options["project"] = project
            if location:
                client_options["location"] = location
            self._genai_client = genai.Client(**client_options)
            self._available = True
            logger.info(f"[SEMANTIC] Embedding client ready (model={SEMANTIC_EMBEDDING_MODEL}, dims={SEMANTIC_EMBEDDING_DIMS})")
        except Exception as e:
            logger.warning(f"[SEMANTIC] Embedding client unavailable: {e}. Semantic caching disabled.")
            return

        # Load persisted entries from Redis
        self._load_from_redis()

    def _embed(self, text: str) -> Optional[np.ndarray]:
        """Embed text into a 256-dim vector via Google's embedding API."""
        if not self._available:
            return None
        try:
            from google import genai
            start = time.time()
            result = self._genai_client.models.embed_content(
                model=SEMANTIC_EMBEDDING_MODEL,
                contents=text,
                config=genai.types.EmbedContentConfig(
                    output_dimensionality=SEMANTIC_EMBEDDING_DIMS,
                ),
            )
            elapsed = (time.time() - start) * 1000
            self._stats["embed_time_ms"] += elapsed
            return np.array(result.embeddings[0].values, dtype=np.float32)
        except Exception as e:
            self._stats["errors"] += 1
            logger.warning(f"[SEMANTIC] Embedding error: {e}")
            return None

    @staticmethod
    def _cosine_sim(a: np.ndarray, b: np.ndarray) -> float:
        """Fast cosine similarity between two vectors."""
        dot = np.dot(a, b)
        norm = np.linalg.norm(a) * np.linalg.norm(b)
        return float(dot / norm) if norm > 0 else 0.0

    def get(self, query: str, context_hash: str = "") -> Optional[str]:
        """Find a semantically similar cached response within the same context."""
        if not self._available:
            self._stats["misses"] += 1
            return None

        with self._lock:
            if not self._entries:
                self._stats["misses"] += 1
                return None

        q_emb = self._embed(query)
        if q_emb is None:
            self._stats["misses"] += 1
            return None

        best_sim, best_idx = 0.0, -1
        with self._lock:
            for i, (emb, _, _, ctx) in enumerate(self._entries):
                if ctx != context_hash:
                    continue
                sim = self._cosine_sim(q_emb, emb)
                if sim > best_sim:
                    best_sim, best_idx = sim, i

            if best_sim >= SEMANTIC_SIMILARITY_THRESHOLD and best_idx >= 0:
                _, matched_q, response, _ = self._entries[best_idx]
                self._stats["hits"] += 1
                logger.info(
                    f"[SEMANTIC] HIT ({best_sim:.3f}): "
                    f"'{query[:40]}' ~ '{matched_q[:40]}'"
                )
                return response

        self._stats["misses"] += 1
        return None

    def set(self, query: str, response: str, context_hash: str = "") -> bool:
        """Store a query-response pair with its embedding, scoped to a context."""
        if not self._available:
            return False

        q_emb = self._embed(query)
        if q_emb is None:
            return False

        with self._lock:
            # Deduplicate within the same context: if a near-identical query
            # exists, update it. Entries from other contexts are left alone.
            for i, (emb, _, _, ctx) in enumerate(self._entries):
                if ctx == context_hash and self._cosine_sim(q_emb, emb) > 0.98:
                    self._entries[i] = (q_emb, query, response, context_hash)
                    self._persist_entry(query, q_emb, response, context_hash)
                    return True

            # Evict oldest if at capacity
            if len(self._entries) >= SEMANTIC_MAX_ENTRIES:
                self._entries.pop(0)

            self._entries.append((q_emb, query, response, context_hash))

        self._persist_entry(query, q_emb, response, context_hash)
        logger.info(f"[SEMANTIC] Stored: '{query[:50]}' ({len(self._entries)} entries)")
        return True

    def _persist_entry(self, query: str, embedding: np.ndarray, response: str, context_hash: str = ""):
        """Persist entry to Redis for durability across restarts."""
        if not self._l2 or not self._l2.is_connected():
            return
        # Key includes context_hash so the same question under different contexts
        # (e.g. general vs personalized) does not overwrite the other.
        key = hashlib.md5(f"{context_hash}:{query.lower().strip()}".encode()).hexdigest()
        try:
            data = json.dumps({
                "q": query,
                "e": embedding.tolist(),
                "r": response,
                "c": context_hash,
            })
            self._l2._client.setex(
                f"csnavigator:sem:{key}",
                L2_CACHE_TTL_SECONDS,
                data,
            )
        except Exception as e:
            logger.warning(f"[SEMANTIC] Redis persist error: {e}")

    def _load_from_redis(self):
        """Load persisted semantic entries from Redis on startup."""
        if not self._l2 or not self._l2.is_connected():
            return
        try:
            keys = self._l2._client.keys("csnavigator:sem:*")
            loaded = 0
            for key in keys[:SEMANTIC_MAX_ENTRIES]:
                raw = self._l2._client.get(key)
                if raw:
                    data = json.loads(raw)
                    emb = np.array(data["e"], dtype=np.float32)
                    self._entries.append((emb, data["q"], data["r"], data.get("c", "")))
                    loaded += 1
            if loaded:
                logger.info(f"[SEMANTIC] Loaded {loaded} entries from Redis")
        except Exception as e:
            logger.warning(f"[SEMANTIC] Failed to load from Redis: {e}")

    def clear(self) -> int:
        """Clear all semantic cache entries."""
        with self._lock:
            count = len(self._entries)
            self._entries.clear()
        if self._l2 and self._l2.is_connected():
            try:
                keys = self._l2._client.keys("csnavigator:sem:*")
                if keys:
                    self._l2._client.delete(*keys)
            except:
                pass
        self._stats = {"hits": 0, "misses": 0, "errors": 0, "embed_time_ms": 0}
        return count

    def get_stats(self) -> dict:
        total = self._stats["hits"] + self._stats["misses"]
        hit_rate = (self._stats["hits"] / total * 100) if total > 0 else 0
        return {
            "available": self._available,
            "hits": self._stats["hits"],
            "misses": self._stats["misses"],
            "errors": self._stats["errors"],
            "hit_rate": f"{hit_rate:.1f}%",
            "index_size": len(self._entries),
            "max_entries": SEMANTIC_MAX_ENTRIES,
            "threshold": SEMANTIC_SIMILARITY_THRESHOLD,
            "total_embed_time_ms": round(self._stats["embed_time_ms"], 1),
        }


# ============================================================================
# MULTI-TIER CACHE (L1 + L2 + SEMANTIC)
# ============================================================================

class MultiTierCache:
    """
    Multi-tier cache combining L1 (in-memory), L2 (Redis), and Semantic (embedding).

    Flow:
    GET: L1 (exact) → L2 (exact) → Semantic (similar) → Miss
    SET: L1 + L2 (exact) + Semantic (embedding)

    Benefits:
    - L1 provides ultra-fast access for hot data
    - L2 provides persistence and cross-server sharing
    - Semantic catches differently-worded versions of the same question
    - Graceful degradation if Redis or embedding API is down
    """

    def __init__(self):
        self.l1 = L1Cache()
        # Separate short-TTL L1 for time-sensitive modes (see SHORT_CACHE_TTL_SECONDS).
        self.l1_short = L1Cache(ttl=SHORT_CACHE_TTL_SECONDS)
        self.l2 = L2Cache()
        self.semantic = SemanticCache(self.l2)
        self._skipped = 0

    def _normalize_query(self, query: str) -> str:
        """Normalize query for consistent cache keys."""
        return " ".join(query.lower().strip().split())

    def _generate_key(self, query: str, context_hash: str = "") -> str:
        """Generate cache key from query."""
        normalized = self._normalize_query(query)
        key_source = f"{normalized}:{context_hash}"
        return hashlib.md5(key_source.encode()).hexdigest()

    def _should_cache(self, query: str) -> bool:
        """Determine if query should be cached."""
        if len(query) < MIN_QUERY_LENGTH:
            return False

        query_lower = query.lower()
        for keyword in NO_CACHE_KEYWORDS:
            if keyword in query_lower:
                return False

        # Catch personal-recall phrasings that dodge the substring list above.
        if _PERSONAL_RECALL_RE.search(query):
            return False

        return True

    def get(self, query: str, context_hash: str = "", allow_semantic: bool = True) -> Optional[str]:
        """
        Get cached response using multi-tier lookup.
        L1 (exact) → L2 (exact) → Semantic (similar, same context) → None

        allow_semantic: enable the embedding tier. Pass False for personalized
        (student-data) queries where similarity matching is undesirable.
        """
        if not self._should_cache(query):
            self._skipped += 1
            return None

        key = self._generate_key(query, context_hash)

        # Try L1 first (fastest) — check both the default and short-TTL tiers so a
        # reader never needs to know which TTL bucket an entry landed in.
        response = self.l1.get(key)
        if response is None:
            response = self.l1_short.get(key)
        if response is not None:
            logger.info(f"[CACHE] L1 HIT for: {query[:50]}...")
            return _strip_personal_greeting(response)

        # Try L2 (Redis)
        response = self.l2.get(key)
        if response is not None:
            logger.info(f"[CACHE] L2 HIT for: {query[:50]}...")
            # Promote to L1 for faster future access
            self.l1.set(key, response)
            return _strip_personal_greeting(response)

        # L3: Semantic similarity (catches rephrased versions of the same question)
        # 0.95 threshold = safe, only near-identical matches. Saves a full Gemini call (~4s).
        # Namespaced by context_hash so general/Morgan/model contexts never cross-match.
        if allow_semantic:
            response = self.semantic.get(query, context_hash)
            if response is not None:
                self.l1.set(key, response)
                return _strip_personal_greeting(response)

        logger.info(f"[CACHE] MISS for: {query[:50]}...")
        return None

    def set(self, query: str, response: str, context_hash: str = "", allow_semantic: bool = True, ttl: Optional[int] = None) -> bool:
        """Store response in all cache tiers.

        ttl: when set (e.g. General mode's 20-min window), the L1 entry goes to the
        short-TTL tier and Redis expires it per-key. When None, uses the defaults.
        """
        if not self._should_cache(query):
            return False

        # Scrub a leading "Hi <Name>," greeting before the answer enters the
        # shared cache, so one student's name never leaks to the next.
        response = _strip_personal_greeting(response)
        response_lower = response.lower()

        # Don't cache error responses or outage messages
        if "error" in response_lower[:50] or "unavailable" in response_lower[:50]:
            return False
        if "trouble connecting" in response_lower or "system issue" in response_lower:
            return False
        if any(p in response_lower for p in ("busy right now", "try again in a moment", "try again in a minute")):
            return False

        # Don't cache refusals / "I don't have that" answers — they're not real
        # content and would poison the cache for everyone.
        if any(p in response_lower for p in (
            "i do not have", "i don't have", "i cannot provide", "i can't provide",
            "i cannot access", "i can't access", "i do not retain", "i don't retain",
        )):
            return False

        # Don't cache responses with grounding disclaimers (they indicate low confidence)
        if "I may not have complete information" in response or "Please verify with the CS department" in response:
            return False

        key = self._generate_key(query, context_hash)

        # Write to exact-match tiers. Short-TTL entries use the short L1 instance;
        # Redis gets the per-key expiry via ttl.
        if ttl:
            self.l1_short.set(key, response)
        else:
            self.l1.set(key, response)
        self.l2.set(key, response, ttl=ttl)

        # L3: Store embedding for semantic similarity matching (scoped to context)
        if allow_semantic:
            self.semantic.set(query, response, context_hash)

        logger.info(f"[CACHE] Stored in L1+L2+SEM: {query[:50]}...")
        return True

    def invalidate(self, query: str, context_hash: str = "") -> bool:
        """Remove query from all cache tiers."""
        key = self._generate_key(query, context_hash)
        l1_deleted = self.l1.delete(key)
        l2_deleted = self.l2.delete(key)
        return l1_deleted or l2_deleted

    def clear(self) -> dict:
        """Clear all caches."""
        l1_count = self.l1.clear()
        l2_count = self.l2.clear()
        sem_count = self.semantic.clear()
        return {"l1_cleared": l1_count, "l2_cleared": l2_count, "semantic_cleared": sem_count}

    def get_stats(self) -> dict:
        """Get combined cache statistics."""
        l1_stats = self.l1.get_stats()
        l2_stats = self.l2.get_stats()
        sem_stats = self.semantic.get_stats()

        total_hits = l1_stats["hits"] + l2_stats["hits"] + sem_stats["hits"]
        total_misses = l1_stats["misses"]  # L1 misses = total queries that missed all tiers
        total = total_hits + total_misses
        overall_hit_rate = (total_hits / total * 100) if total > 0 else 0

        return {
            "overall": {
                "total_hits": total_hits,
                "total_misses": total_misses,
                "hit_rate": f"{overall_hit_rate:.1f}%",
                "skipped": self._skipped,
            },
            "l1_inmemory": l1_stats,
            "l2_redis": l2_stats,
            "semantic": sem_stats,
        }


# ============================================================================
# GLOBAL CACHE INSTANCE
# ============================================================================

# Single global multi-tier cache instance
query_cache = MultiTierCache()


# ============================================================================
# HELPER FUNCTIONS (Backwards Compatible)
# ============================================================================

def get_context_hash(user_id: int = None, has_degreeworks: bool = False, model: str = "", has_canvas: bool = False, dw_hash: str = "", mode: str = "") -> str:
    """
    Generate a context hash for cache key differentiation.
    Includes model and data sources so different contexts get separate cache entries.
    """
    parts = []
    if (has_degreeworks or has_canvas) and user_id:
        parts.append(f"user:{user_id}")
    if has_degreeworks:
        parts.append("dw")
    if dw_hash:
        parts.append(f"dwh:{dw_hash}")
    if has_canvas:
        parts.append("canvas")
    if model:
        parts.append(f"m:{model}")
    if mode and mode != "regular":
        parts.append(f"mode:{mode}")
    if parts:
        return hashlib.md5(":".join(parts).encode()).hexdigest()[:8]
    return ""


def log_cache_stats():
    """Print cache statistics to console."""
    stats = query_cache.get_stats()
    print(f"\n{'='*60}")
    print("CACHE STATISTICS")
    print(f"{'='*60}")
    print(f"Overall Hit Rate: {stats['overall']['hit_rate']}")
    print(f"Total Hits: {stats['overall']['total_hits']}")
    print(f"Total Misses: {stats['overall']['total_misses']}")
    print(f"Skipped (personalized): {stats['overall']['skipped']}")
    print(f"\nL1 (In-Memory): {stats['l1_inmemory']['size']}/{stats['l1_inmemory']['max_size']} items")
    print(f"L2 (Redis): Connected={stats['l2_redis']['connected']}, Items={stats['l2_redis'].get('size', 'N/A')}")
    sem = stats['semantic']
    print(f"Semantic: Available={sem['available']}, Index={sem['index_size']}/{sem['max_entries']}, Hits={sem['hits']}")
    print(f"{'='*60}\n")
