import os

os.environ.setdefault("JWT_SECRET", "test-only-jwt-secret-not-for-production")

from main import _is_cs_department_question, _dedupe_near_duplicates


class TestPersonLookupsAreRejected:
    """"Who is X" questions are answered better by the chat than by a homepage chip,
    and they are what filled the welcome screen with "who is dr mack at moragn?"."""

    def test_rejects_who_questions(self):
        assert _is_cs_department_question("who is dr wang?") is False
        assert _is_cs_department_question("who is dr mack at moragn?") is False
        assert _is_cs_department_question("Who is the chair of the CS department?") is False

    def test_rejects_who_even_with_a_topic_word(self):
        # "professor" is a topic keyword, but this is still a person lookup.
        assert _is_cs_department_question("who is the professor for COSC 112?") is False


class TestPersonalRecallIsRejected:
    def test_rejects_personal_recall(self):
        assert _is_cs_department_question("what is my name?") is False
        assert _is_cs_department_question("what's my gpa") is False
        assert _is_cs_department_question("who is my advisor?") is False

    def test_keeps_generic_advising_questions_that_contain_my(self):
        """"How do I contact my academic advisor?" is a real CS-advising question. The
        personal filter must key on the recall shape, not on the word "my"."""
        assert _is_cs_department_question("How do I contact my academic advisor?") is True
        assert _is_cs_department_question("What courses should I take next semester if I'm interested in AI/ML?") is True


class TestOffTopicIsRejected:
    def test_rejects_world_knowledge(self):
        assert _is_cs_department_question("who is president of Us") is False
        assert _is_cs_department_question("what is the weather today") is False

    def test_requires_a_cs_department_topic(self):
        assert _is_cs_department_question("tell me a joke about bears") is False


class TestCsDepartmentQuestionsAreKept:
    def test_keeps_course_and_curriculum_questions(self):
        assert _is_cs_department_question("What are the prerequisites for COSC 450 Operating Systems?") is True
        assert _is_cs_department_question("How many credits do I need to graduate with a CS degree?") is True
        assert _is_cs_department_question("How do I register for CS courses?") is True
        assert _is_cs_department_question("Name one AI course at Morgan State.") is True


class TestDedupe:
    def test_collapses_near_identical_phrasings(self):
        """These two both surfaced on the live welcome screen, differing only by "I am"
        vs "I'm". Exact-match frequency ranking treats them as separate questions."""
        out = _dedupe_near_duplicates([
            "What courses should I take next semester if I am interested in AI/ML?",
            "What courses should I take next semester if I'm interested in AI/ML?",
        ])
        assert len(out) == 1

    def test_keeps_genuinely_different_questions(self):
        out = _dedupe_near_duplicates([
            "What are the prerequisites for COSC 450?",
            "How do I register for CS courses?",
        ])
        assert len(out) == 2

    def test_preserves_order_of_first_occurrence(self):
        out = _dedupe_near_duplicates(["How do I register for CS courses?", "What electives count toward the CS degree?"])
        assert out[0] == "How do I register for CS courses?"
