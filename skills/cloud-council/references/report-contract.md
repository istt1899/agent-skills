# Report contract

Read when briefing a panel or reconciling several reviews. Use short Markdown
or an equivalent structured format; no particular serializer is required.

## Frozen brief

Record the question, user constraints, options, success criteria, exact subject
revision/data cutoff, primary source locations, and authorized resource bounds.
Separate supplied facts, assumptions, proposals and known unknowns. Every member
gets the same factual brief; specialization changes the method, not the facts.

## Member report

Give findings stable IDs such as M2-F1. Each contains:

| Field | Meaning |
|---|---|
| Claim | Specific observation, defect, hypothesis or recommendation |
| Source | File and lines, document section, data ID or primary URL |
| Subject | Revision or snapshot actually inspected |
| Method | Reading, execution, independent calculation, history trace, experiment |
| Check | Action performed and observed result; otherwise "not run" |
| Status | Supported, refuted, hypothesis, or unverified |
| Impact | Why it affects the user's decision |
| Uncertainty | Missing evidence, alternative explanation, condition that reverses the claim |

At report level include lens, actual model/provider or unverified identity,
recommendation, confidence with basis, strongest counterargument and omissions.
Do not convert confidence labels into numerical probabilities without calibration.

## Coordinator ledger

For every material finding record its ID(s), evidence, one synthesis bucket,
and disposition. Rejected findings keep the reason. Supporting members remain
attributed internally even when their prose was anonymized for critique.

Two findings are the same only if they concern the same behavior and failure mode
or recommend the same change. Preserve conflicting recommendations separately.
A minor stylistic issue cannot outweigh a verified correctness defect through votes.

Record model-family diversity and methodological diversity separately. Repeated
analysis of one summary by one method is correlated support, even with multiple
participants. Peer-informed revisions do not add independent confirmations.

The final result reports the snapshot reviewed, actual checks and relevant
limitations. If scope changed, identify which findings still apply and which
need rechecking; do not silently recycle a verdict.
