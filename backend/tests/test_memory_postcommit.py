"""The post-commit scheduler is safe without a running event loop, and the
6-turn extraction gate behaves."""
import main


def test_schedule_no_event_loop_is_safe():
    # No asyncio loop running here -> must not raise (RuntimeError swallowed).
    main._schedule_post_commit_memory_tasks(user_id=1, session_id="s1", chat_id=123)


def test_turn_count_gate():
    assert main._is_extraction_turn(6) is True
    assert main._is_extraction_turn(12) is True
    assert main._is_extraction_turn(5) is False
    assert main._is_extraction_turn(0) is False
    assert main._is_extraction_turn(1) is False


def test_per_user_lock_is_reused():
    a = main._get_user_realtime_lock(42)
    b = main._get_user_realtime_lock(42)
    assert a is b
