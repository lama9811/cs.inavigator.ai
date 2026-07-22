# Memory crons — ops runbook

**Prereq:** Cloud Scheduler API is DISABLED on `cs-navigator-498115` (verified 2026-07-20).
`gcloud` lives at `~/google-cloud-sdk/bin/gcloud` (not on PATH). Substitute the real
`RESEARCH_SECRET` value (from Secret Manager) where noted.

## 1. Enable the API
```
~/google-cloud-sdk/bin/gcloud services enable cloudscheduler.googleapis.com --project=cs-navigator-498115
```

## 2. Nightly consolidate job (3am ET) — safety net
```
~/google-cloud-sdk/bin/gcloud scheduler jobs create http memory-consolidate \
  --location=us-central1 --schedule="0 3 * * *" --time-zone="America/New_York" \
  --uri="https://csnavigator-backend-900141432581.us-central1.run.app/api/internal/memory/consolidate" \
  --http-method=POST --headers="X-Research-Secret=<RESEARCH_SECRET value>" \
  --project=cs-navigator-498115
```

## 3. Idle-sweep job (every 5 min)
```
~/google-cloud-sdk/bin/gcloud scheduler jobs create http memory-idle-sweep \
  --location=us-central1 --schedule="*/5 * * * *" \
  --uri="https://csnavigator-backend-900141432581.us-central1.run.app/api/internal/memory/idle-sweep" \
  --http-method=POST --headers="X-Research-Secret=<RESEARCH_SECRET value>" \
  --project=cs-navigator-498115
```

## 4. Force-run to verify (expect HTTP 200 + JSON status)
```
~/google-cloud-sdk/bin/gcloud scheduler jobs run memory-consolidate --location=us-central1 --project=cs-navigator-498115
```

## 5. Confirm facts populate
```
~/google-cloud-sdk/bin/gcloud logging read 'resource.labels.service_name="csnavigator-backend" AND textPayload:"[MEMORY]"' --project=cs-navigator-498115
```
Want `[MEMORY] realtime extract ...` / `[MEMORY] session summary ...` lines.

## ⚠️ SEPARATE ISSUE — do NOT fold into this work
The **reminders** cron (`/api/internal/reminders/dispatch`) and **live-seats** cron
(`/api/internal/schedule/refresh`) documented in CLAUDE.md ALSO depend on this
previously-disabled Scheduler API. They are almost certainly NOT firing — deadline
reminder emails aren't sending and planner seat data isn't refreshing. Verify with
`gcloud scheduler jobs list --location=us-central1` after enabling the API, and
recreate them per their CLAUDE.md commands. Track as its own task.
```
~/google-cloud-sdk/bin/gcloud scheduler jobs list --location=us-central1 --project=cs-navigator-498115
```
