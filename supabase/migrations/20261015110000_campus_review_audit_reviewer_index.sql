-- Support reviewer-scoped audit queries and the reviewer foreign key.
create index if not exists campus_review_audits_reviewer_outcome_audited_at
  on public.campus_review_audits (reviewer_id, outcome, audited_at desc);
