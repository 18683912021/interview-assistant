"""Small history rows: no resume, job body, transcript, or answer payloads."""
import json


def summary_values(data):
    summary = {key: value for key, value in data.items() if key not in {
        "conversation", "answers", "resume_snapshot", "job_description", "review", "expected_revision"}}
    summary.update(message_count=len(data.get("conversation", [])), answer_count=len(data.get("answers", [])),
                   resume_snapshot=None, job_description="")
    return {"summary_json": json.dumps(summary, ensure_ascii=False),
            "search_text": " ".join(str(data.get(key, "")) for key in ("title", "company", "role")).lower(),
            "status": data.get("status", "interrupted")}
