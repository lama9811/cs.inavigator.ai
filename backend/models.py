# backend/models.py
from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text, Float, ForeignKey, UniqueConstraint, Index, func, LargeBinary
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
from db import Base


class ChatHistory(Base):
    """Stores chat history in AWS RDS (or local DB).
    Linked to the User table via user_id."""
    __tablename__ = "chat_history"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    session_id = Column(String(255), default="default")
    user_query = Column(Text)
    bot_response = Column(Text)
    mode = Column(String(20), default="regular")  # regular | general | coding_tutor
    timestamp = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class Feedback(Base):
    """Stores user feedback on bot responses for improving the chatbot."""
    __tablename__ = "feedback"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    session_id = Column(String(255), default="default")
    message_text = Column(Text)
    feedback_type = Column(String(50))  # 'helpful', 'not_helpful', 'report'
    report_details = Column(Text, nullable=True)
    timestamp = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    role = Column(String(50), nullable=False, default="student")  # "admin" or "student"

    #  Profile fields
    name = Column(String(255), nullable=True)
    student_id = Column(String(50), nullable=True)
    major = Column(String(100), nullable=True, default="Computer Science")
    profile_picture = Column(String(500), nullable=True, default="/user_icon.jpg")
    profile_picture_data = Column(Text, nullable=True)  # Store base64 image data
    morgan_connected = Column(Boolean, nullable=False, default=False)
    morgan_connected_at = Column(DateTime, nullable=True)  # When DegreeWorks was synced
    email_verified = Column(Boolean, nullable=False, default=False)
    verification_token = Column(String(255), nullable=True)
    verification_token_expires = Column(DateTime, nullable=True)
    reset_token = Column(String(255), nullable=True)
    reset_token_expires = Column(DateTime, nullable=True)
    is_disabled = Column(Boolean, nullable=False, default=False)
    disabled_at = Column(DateTime, nullable=True)
    disabled_reason = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    # Relationship to DegreeWorks data
    degreeworks = relationship("DegreeWorksData", back_populates="user", uselist=False)


class DegreeWorksData(Base):
    """Stores parsed DegreeWorks academic data for personalized chatbot responses"""
    __tablename__ = "degreeworks_data"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True, nullable=False)

    # Student Info
    student_name = Column(String(255), nullable=True)
    student_id = Column(String(50), nullable=True)
    degree_program = Column(String(255), nullable=True)  # e.g., "Bachelor of Science in Computer Science"
    minor = Column(String(255), nullable=True)  # e.g., "Mathematics" (from DegreeWorks goalArray MINOR)
    catalog_year = Column(String(20), nullable=True)  # e.g., "2022-2023"
    classification = Column(String(50), nullable=True)  # e.g., "Senior", "Junior"
    advisor = Column(String(255), nullable=True)

    # Academic Progress
    overall_gpa = Column(Float, nullable=True)
    major_gpa = Column(Float, nullable=True)
    total_credits_earned = Column(Float, nullable=True)      # passed credits (excludes in-progress)
    total_credits_applied = Column(Float, nullable=True)     # credits applied to the degree (incl. in-progress + transfer)
    total_credits_in_progress = Column(Float, nullable=True) # credits currently in progress (not yet earned)
    credits_required = Column(Float, nullable=True)
    credits_remaining = Column(Float, nullable=True)

    # Course Data (stored as JSON strings)
    courses_completed = Column(Text, nullable=True)  # JSON: [{code, name, credits, grade, semester}]
    courses_in_progress = Column(Text, nullable=True)  # JSON: [{code, name, credits, semester}]
    courses_remaining = Column(Text, nullable=True)  # JSON: [{code, name, credits, category}]
    requirements_status = Column(Text, nullable=True)  # JSON: [{category, status, details}]
    gened_areas = Column(Text, nullable=True)  # JSON: {area_code: percent} e.g. {"IM":100,"AH":50} (DegreeWorks-computed)

    # Raw data backup
    raw_data = Column(Text, nullable=True)  # Full JSON dump for reference

    # Data source tracking
    data_source = Column(String(50), nullable=True, default="manual_entry")  # "pdf_parse", "banner_scrape", "html_scrape", "manual_entry"

    # Metadata
    synced_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationship
    user = relationship("User", back_populates="degreeworks")


class BannerStudentData(Base):
    """All Banner-synced data beyond DegreeWorks, stored as JSON fields.
    One row per student. Populated by Banner SSB REST API sync."""
    __tablename__ = "banner_student_data"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True, nullable=False)

    # Student Profile (from Banner, supplements DegreeWorks)
    student_phone = Column(String(20), nullable=True)
    student_address = Column(Text, nullable=True)       # JSON

    # Current Registration
    current_term = Column(String(50), nullable=True)
    registered_courses = Column(Text, nullable=True)     # JSON: [{crn, subject, number, title, credits, instructor, times, location}]
    total_registered_credits = Column(Float, nullable=True)

    # Registration History
    registration_history = Column(Text, nullable=True)   # JSON: [{term, courses, term_gpa, credits_attempted, credits_earned}]

    # Grade History
    grade_history = Column(Text, nullable=True)          # JSON: [{term, courses: [{code, title, grade, credits}], term_gpa}]
    cumulative_gpa = Column(Float, nullable=True)
    total_credits_earned = Column(Float, nullable=True)
    total_credits_attempted = Column(Float, nullable=True)
    deans_list_terms = Column(Text, nullable=True)       # JSON: ["Fall 2025", "Spring 2026"]

    # Metadata
    synced_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationship
    user = relationship("User", backref="banner_data")


class CanvasStudentData(Base):
    """Stores Canvas LMS data: courses, assignments, grades, deadlines.
    Synced via Canvas REST API using Morgan State LDAP credentials."""
    __tablename__ = "canvas_student_data"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True, nullable=False)

    # Canvas Profile
    canvas_user_id = Column(Integer, nullable=True)
    canvas_login_id = Column(String(100), nullable=True)

    # Courses (JSON array)
    courses = Column(Text, nullable=True)  # [{id, name, code, grade, score}]

    # Assignments (JSON array)
    upcoming_assignments = Column(Text, nullable=True)  # [{title, type, due_at, points, course_name, submitted}]

    # Missing/overdue (JSON array)
    missing_assignments = Column(Text, nullable=True)  # [{title, course_id, due_at, points}]

    # Grades per course (JSON dict)
    grades = Column(Text, nullable=True)  # {course_id: {current_score, current_grade}}

    # Full gradebook (JSON dict keyed by course_id)
    gradebook = Column(Text, nullable=True)  # {course_id: {grading_type, assignment_groups, assignments}}

    # Metadata
    synced_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationship
    user = relationship("User", backref="canvas_data")


class SupportTicket(Base):
    """Support tickets submitted by users for bug reports and feedback"""
    __tablename__ = "support_tickets"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    # Ticket Details
    subject = Column(String(255), nullable=False)
    category = Column(String(50), nullable=False)  # "bug", "feature", "question", "other"
    description = Column(Text, nullable=False)
    attachment_data = Column(Text(16777215), nullable=True)  # MEDIUMTEXT: Base64 encoded file (up to ~12MB)
    attachment_name = Column(String(255), nullable=True)

    # Status tracking
    status = Column(String(50), nullable=False, default="open")  # "open", "in_progress", "resolved", "closed"
    priority = Column(String(20), nullable=False, default="normal")  # "low", "normal", "high", "urgent"

    # Admin response
    admin_notes = Column(Text, nullable=True)
    resolved_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    resolved_at = Column(DateTime, nullable=True)

    # Metadata
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    user = relationship("User", foreign_keys=[user_id], backref="tickets")


class UserMemory(Base):
    """Long-term user memory for chatbot personalization.
    Consolidated from daily conversations via cron job.
    Stored on our RDS (FERPA-safe), not Vertex AI."""
    __tablename__ = "user_memories"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    memory_type = Column(String(50), nullable=False)  # interest, preference, goal, context
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User", backref="memories")


class CodingPracticeProgress(Base):
    """Per-user progress for the local CS Navigator coding practice bank."""
    __tablename__ = "coding_practice_progress"
    __table_args__ = (
        UniqueConstraint("user_id", "question_id", "language", name="uq_coding_practice_user_question_language"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    question_id = Column(String(80), nullable=False, index=True)
    language = Column(String(30), nullable=False, default="python")
    status = Column(String(30), nullable=False, default="in_progress")
    code = Column(Text, nullable=True)
    attempt_count = Column(Integer, nullable=False, default=0)
    last_attempt_at = Column(DateTime, nullable=True)
    solved_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User", backref="coding_practice_progress")


class CodingUserProgress(Base):
    """Per-user Coding Tutor aggregate progress for badge/streak signals that are
    NOT derivable from CodingPracticeProgress (mock-interview completions, the
    daily-challenge day list, and the best-ever streak). Makes those signals sync
    across devices instead of living only in the browser's localStorage. One row
    per user."""
    __tablename__ = "coding_user_progress"
    __table_args__ = (
        UniqueConstraint("user_id", name="uq_coding_user_progress_user"),
    )

    id = Column(Integer, primary_key=True, index=True)
    # Uniqueness is enforced by the named table constraint above (no column-level
    # unique=True — that would create a second, redundant unique index).
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    mock_completed = Column(Integer, nullable=False, default=0)
    best_streak = Column(Integer, nullable=False, default=0)
    # JSON-encoded array of "YYYY-MM-DD" strings — kept as Text so it works on both
    # local SQLite and Cloud SQL MySQL without a JSON column-type dependency.
    daily_days = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User", backref="coding_user_progress")


class CodingSnippet(Base):
    """Per-user personal code snippets ("My Snippets") — the student's own code,
    not tied to a graded quiz problem. Synced from the browser localStorage."""
    __tablename__ = "coding_snippets"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    # Client-generated id (e.g. "snip-...") used to match the local copy. Unique
    # per user so the same client id can't collide across accounts.
    client_id = Column(String(80), nullable=False, index=True)
    name = Column(String(120), nullable=False, default="Untitled snippet")
    language = Column(String(30), nullable=False, default="Python")
    code = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("user_id", "client_id", name="uq_coding_snippet_user_client"),
    )

    user = relationship("User", backref="coding_snippets")


class CodingAttemptEvent(Base):
    """Append-only log of coding attempts — one row per Run / Submit / free run.

    CodingPracticeProgress only records *that* a student solved a question. This
    records *how they got there*: which attempt failed, what kind of failure it was,
    which tests broke, how many hints they had open, and how long they'd been on the
    problem. That difference is what per-topic mastery, the adaptive ladder, and a
    real "common mistakes" panel are built from — none of which can be derived from
    the current progress row.

    Append-only on purpose. Rows are never updated or deleted by the app, so the
    history stays a faithful record of what actually happened.

    Privacy: we store the *shape* of a failure (error class, which test names broke),
    never the student's source code. `code_len` is a size, not the code.
    """
    __tablename__ = "coding_attempt_events"
    __table_args__ = (
        # The two queries this table exists to serve: "how is this student doing on
        # this topic" and "what do students get wrong on this question".
        Index("ix_coding_attempt_user_question", "user_id", "question_id"),
        Index("ix_coding_attempt_question_created", "question_id", "created_at"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    # Where the attempt came from: "practice" | "freerun" | "interview".
    # Free runs have no question, so question_id is nullable.
    source = Column(String(20), nullable=False, default="practice")
    question_id = Column(String(80), nullable=True, index=True)
    # Denormalized from the question bank at write time so mastery queries don't have
    # to re-load the JSON bank, and so the row still means something if a question is
    # later retitled or recategorized.
    topic = Column(String(80), nullable=True, index=True)
    difficulty = Column(String(20), nullable=True)
    language = Column(String(30), nullable=False, default="python")

    # "pass" | "fail" | "error" | "timeout"  — what happened overall.
    outcome = Column(String(20), nullable=False)
    # "syntax" | "runtime" | "wrong_answer" | "timeout" | None (on a pass).
    # The single most valuable field here: "didn't know the language" and "didn't know
    # the algorithm" are different problems and need different teaching.
    error_class = Column(String(30), nullable=True, index=True)

    tests_passed = Column(Integer, nullable=False, default=0)
    tests_total = Column(Integer, nullable=False, default=0)
    # JSON-encoded array of failing test names. Text (not a JSON column) so it works on
    # both local SQLite and Cloud SQL MySQL, matching CodingUserProgress.daily_days.
    failed_tests = Column(Text, nullable=True)

    # Client-reported effort signals. Best-effort: a student can reload the page and
    # reset the timer, so treat these as a trend, not a measurement.
    hints_used = Column(Integer, nullable=False, default=0)
    seconds_since_open = Column(Integer, nullable=True)

    code_len = Column(Integer, nullable=False, default=0)
    duration_ms = Column(Integer, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)

    user = relationship("User", backref="coding_attempt_events")


class CodingConceptQuizAttempt(Base):
    """Append-only concept-quiz result used for cross-device progress and review.

    ``results_json`` stores only question ids, kinds, and correct/incorrect flags.
    Student-entered text or code is deliberately excluded: the review screen can
    rebuild the prompt, correct answer, and explanation from the authored bank
    without turning the progress table into a source-code store.
    """
    __tablename__ = "coding_concept_quiz_attempts"
    __table_args__ = (
        Index(
            "ix_concept_quiz_user_language_category",
            "user_id",
            "language",
            "category",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    language = Column(String(30), nullable=False, index=True)
    category = Column(String(80), nullable=False, index=True)
    correct = Column(Integer, nullable=False, default=0)
    total = Column(Integer, nullable=False, default=0)
    score = Column(Float, nullable=False, default=0.0)
    results_json = Column(Text, nullable=False, default="[]")
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)

    user = relationship("User", backref="coding_concept_quiz_attempts")


class FailedQuery(Base):
    """Tracks questions the chatbot couldn't answer (KB misses).
    Used by the auto-research agent to find and fill knowledge gaps."""
    __tablename__ = "failed_queries"

    id = Column(Integer, primary_key=True, index=True)
    user_query = Column(Text, nullable=False)
    bot_response = Column(Text, nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    cluster_id = Column(Integer, nullable=True, index=True)
    status = Column(String(50), default="new")  # new, clustered, researched, dismissed
    created_at = Column(DateTime, nullable=False, server_default=func.now())


class ReminderSubscription(Base):
    """Per-class opt-in for Canvas assignment deadline reminders.
    A row exists only for classes the student has toggled; `enabled` lets
    them turn it back off without losing the row. One row per (user, course)."""
    __tablename__ = "reminder_subscriptions"
    __table_args__ = (
        UniqueConstraint("user_id", "course_id", name="uq_reminder_sub_user_course"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    course_id = Column(String(64), nullable=False)   # Canvas course id (stored as string)
    course_code = Column(String(100), nullable=True)
    enabled = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User", backref="reminder_subscriptions")


class SentReminder(Base):
    """Dedup ledger for deadline reminder emails already sent.
    `reminder_key` is a stable per-assignment key so the hourly dispatch job
    never emails the same assignment twice. One row per (user, reminder_key)."""
    __tablename__ = "sent_reminders"
    __table_args__ = (
        UniqueConstraint("user_id", "reminder_key", name="uq_sent_reminder_user_key"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    reminder_key = Column(String(255), nullable=False)
    sent_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    user = relationship("User", backref="sent_reminders")


class KBSuggestion(Base):
    """KB update suggestions generated by the auto-research agent.
    Admin reviews and approves before pushing to the live datastore."""
    __tablename__ = "kb_suggestions"

    id = Column(Integer, primary_key=True, index=True)
    cluster_id = Column(Integer, nullable=True)
    topic = Column(String(500), nullable=False)
    representative_query = Column(Text, nullable=False)
    query_count = Column(Integer, default=1)
    researched_answer = Column(Text, nullable=False)
    sources = Column(Text, nullable=True)  # JSON array of URLs
    confidence = Column(String(20), default="medium")  # high, medium, low
    suggested_doc_id = Column(String(255), nullable=True)
    suggested_content = Column(Text, nullable=True)
    status = Column(String(50), default="pending")  # pending, approved, rejected, pushed
    admin_notes = Column(Text, nullable=True)
    reviewed_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    reviewed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())


class LiveSection(Base):
    """Live class-availability snapshot pulled from Banner "Browse Classes".
    Refreshed by the /api/internal/schedule/refresh cron (every ~6h) for the
    active registerable term. Carries the same fields as a static schedule
    section PLUS real-time seats/waitlist. The planner reads the newest rows for
    a term; if this table is empty/stale it falls back to the static snapshots.
    One row per (term, crn)."""
    __tablename__ = "live_sections"
    __table_args__ = (
        UniqueConstraint("term", "crn", name="uq_live_section_term_crn"),
    )

    id = Column(Integer, primary_key=True, index=True)
    term = Column(String(32), nullable=False, index=True)   # sem_key, e.g. 'fall_2026'
    crn = Column(String(16), nullable=False)                # Banner courseReferenceNumber
    subject = Column(String(16), nullable=False, index=True)  # 'COSC'
    course_number = Column(String(16), nullable=True)       # '320'
    course_code = Column(String(32), nullable=False, index=True)  # 'COSC 320'
    title = Column(String(255), nullable=True)
    credits = Column(Integer, nullable=False, default=0)
    section = Column(String(16), nullable=True)             # sequenceNumber
    instructor = Column(String(255), nullable=True)
    campus = Column(String(64), nullable=True)
    schedule_type = Column(String(64), nullable=True)
    meeting_time = Column(String(255), nullable=True)       # 'MWF 12:00PM-12:50PM' or 'TBA'
    room = Column(String(64), nullable=True)
    seats_available = Column(Integer, nullable=False, default=0)
    max_enrollment = Column(Integer, nullable=False, default=0)
    enrollment = Column(Integer, nullable=False, default=0)
    open_section = Column(Boolean, nullable=False, default=False)
    wait_count = Column(Integer, nullable=False, default=0)
    wait_capacity = Column(Integer, nullable=False, default=0)
    wait_available = Column(Integer, nullable=False, default=0)
    fetched_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc), index=True)


class AdvisingFormDraft(Base):
    """Per-user saved draft of the advising section forms (Internship + Advising).
    One row per user; `forms_json` holds a JSON object of { form_id: {field: value} }.
    Text (not JSON column) so it works on both SQLite and Cloud SQL MySQL."""
    __tablename__ = "advising_form_drafts"
    __table_args__ = (
        UniqueConstraint("user_id", name="uq_advising_form_draft_user"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    forms_json = Column(Text, nullable=True)
    submitted = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User", backref="advising_form_drafts")


class AdvisingUpload(Base):
    """A file the student attached to their advising form (Course Sequence /
    DegreeWorks PDF or a scan). Stored as bytes IN THE DATABASE, not on local disk,
    so uploads survive a Cloud Run restart (the container filesystem is ephemeral).
    Small files only (a few MB, capped at the upload limit). LargeBinary maps to
    BLOB on SQLite and LONGBLOB/BLOB on MySQL, so it works on both."""
    __tablename__ = "advising_uploads"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    filename = Column(String(255), nullable=False)          # original name the student uploaded
    content_type = Column(String(100), nullable=True)       # MIME type, for serving back
    size_bytes = Column(Integer, nullable=True)
    data = Column(LargeBinary, nullable=False)              # the file bytes
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    user = relationship("User", backref="advising_uploads")


class SavedScholarship(Base):
    """A scholarship or internship a student saved from a search.

    Search is ephemeral; applying is not. A student finds an award, means to
    apply, and loses it. This table is what lets them come back to it — the whole
    reason Scholarships is a feature and not just a search box.

    `kind` splits the two objects that were previously mashed together: a
    scholarship has an `award` and `eligibility`; an internship has pay, a term,
    a location and a role. Both share this row, but the frontend renders and
    filters them separately.

    We snapshot the details at save time (`snapshot_json`). The source page
    changes or 404s, and a saved award that silently becomes a dead link is worse
    than no feature — so we keep what we knew and can re-check it later."""
    __tablename__ = "saved_scholarships"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    # Stable dedupe key (a hash of name+url), so re-saving the same award from a
    # later search updates the existing row instead of creating a duplicate.
    client_key = Column(String(80), nullable=False, index=True)

    kind = Column(String(20), nullable=False, default="scholarship")  # scholarship | internship
    name = Column(String(300), nullable=False)

    # Scholarship-shaped fields.
    award = Column(String(200), nullable=True)          # "$5,000" / "(not listed)"
    eligibility = Column(Text, nullable=True)

    # Internship-shaped fields. Null on scholarships.
    pay = Column(String(120), nullable=True)            # "$45/hr" / "Paid"
    term = Column(String(120), nullable=True)           # "Summer 2026"
    location = Column(String(200), nullable=True)
    role = Column(String(200), nullable=True)

    deadline = Column(String(40), nullable=True)        # "YYYY-MM-DD" / "(not listed)"
    # How to read the deadline when there's no single date:
    # fixed | rolling | recurring | unknown. Lets the UI show "Rolling — apply
    # anytime" instead of a bare "(not listed)".
    deadline_type = Column(String(20), nullable=True)
    url = Column(String(1000), nullable=True)           # apply link
    source_url = Column(String(1000), nullable=True)    # where we found it
    why = Column(Text, nullable=True)                   # why it fits this student

    # Where the student is in the process.
    # interested | applying | submitted | awarded | rejected | expired
    status = Column(String(20), nullable=False, default="interested")

    # Full snapshot of the item as it was at save time, so a later source change
    # can't silently rot the saved copy. JSON string.
    snapshot_json = Column(Text, nullable=True)

    # The application checklist, as a JSON list of
    # {id, label, done, note} items. Generated from the award's own requirements
    # (via the AI) the first time the student opens the detail view, then editable.
    # Null until generated; an empty list means "generated, but nothing found".
    checklist_json = Column(Text, nullable=True)

    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("user_id", "client_key", name="uq_saved_scholarship_user_key"),
    )

    user = relationship("User", backref="saved_scholarships")


class DismissedScholarship(Base):
    """An opportunity a student has permanently hidden from their search results.

    Lightweight on purpose: dismissing something you never saved shouldn't create
    a full SavedScholarship row (with its checklist machinery). We only store the
    dedupe key (a hash of name+url, the same client_key SavedScholarship uses) so
    the same award is filtered out of future searches. Keeping the name is purely
    so an admin/debugging view is readable."""
    __tablename__ = "dismissed_scholarships"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    client_key = Column(String(80), nullable=False, index=True)
    name = Column(String(300), nullable=True)   # for readability only
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("user_id", "client_key", name="uq_dismissed_scholarship_user_key"),
    )

    user = relationship("User", backref="dismissed_scholarships")
