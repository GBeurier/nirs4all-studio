# Compact dataset scores

`GET /api/workspaces/{workspace_id}/results/dataset-scores` is a native,
read-only route. It accepts no query parameters and requires no Python host.
Unknown workspaces return 404; an existing workspace without a Store returns
an empty list. Incompatible stores, live journals and changed snapshots remain
errors, not an empty success response.

The reader uses the unchanged `workspace_store_results_summary_v1` SQL and
500-row page primitive through one validated immutable connection. The compact
view retains only two candidate records per dataset, not all chain payloads.
All pages participate; the best candidate is not restricted to the first page
or the top five displayed chains. Numerical arrays are never read.

Only a stored finite `final_test_score` yields `score_kind: "final"`. Otherwise
a finite `cv_val_score` yields `score_kind: "cv"`. Training scores, CV test
scores and synthetic display substitutions never become final-test scores.
Missing values remain null, and train-only datasets without held-out scores
are not ranked. The final candidate retains its own CV score when available;
otherwise the best CV score of the same metric accompanies it, as in the
historical compact endpoint.

The first nonempty metric in the Store-owned source order selects the card's
metric, with the published metric direction. Other metrics' scalars are not
compared under that label, and an absent metric is not invented as R2. This
corrects the historical mixed-unit comparison without recomputing any score.
Dataset-link resolution is shared with the existing Results projection.
