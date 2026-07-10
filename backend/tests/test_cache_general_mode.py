"""Cache behavior for General mode.

General-mode answers are web-grounded and time-sensitive, so they must:
  1. live in their own key namespace (already true: mode component in the hash), and
  2. expire on a SHORT ttl, not the 8h default — otherwise "live" info goes stale.

`cachetools.TTLCache` cannot expire per-key, so short-lived entries use a second
L1 instance. These tests exercise the L1 routing without Redis or embeddings
(both degrade gracefully when absent, which is the local test condition).
"""
import cache
from cache import MultiTierCache, get_context_hash


def test_general_mode_has_its_own_context_namespace():
    assert get_context_hash(mode="general") != get_context_hash(mode="regular")
    assert get_context_hash(mode="general") != ""
    # regular is deliberately the unprefixed default
    assert get_context_hash(mode="regular") == ""


def test_short_ttl_entry_is_retrievable():
    c = MultiTierCache()
    q = "what cs internships are open this summer"
    assert c.set(q, "Several are open.", context_hash="genhash", allow_semantic=False, ttl=1200)
    assert c.get(q, context_hash="genhash", allow_semantic=False) == "Several are open."


def test_short_ttl_entry_goes_to_the_short_l1_not_the_default_l1():
    c = MultiTierCache()
    q = "latest python release"
    c.set(q, "3.14", context_hash="genhash", allow_semantic=False, ttl=1200)
    key = c._generate_key(q, "genhash")
    assert c.l1_short.get(key) == "3.14"
    assert c.l1.get(key) is None


def test_default_ttl_entry_goes_to_the_default_l1():
    c = MultiTierCache()
    q = "what are the cs graduation requirements"
    c.set(q, "See the KB.", context_hash="reghash")
    key = c._generate_key(q, "reghash")
    assert c.l1.get(key) == "See the KB."
    assert c.l1_short.get(key) is None


def test_get_reads_from_both_l1_tiers():
    """A reader must not need to know which TTL tier holds the entry."""
    c = MultiTierCache()
    c.set("a short ttl question here", "SHORT", context_hash="h1", allow_semantic=False, ttl=1200)
    c.set("a default ttl question here", "LONG", context_hash="h2")
    assert c.get("a short ttl question here", context_hash="h1", allow_semantic=False) == "SHORT"
    assert c.get("a default ttl question here", context_hash="h2") == "LONG"
