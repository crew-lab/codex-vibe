# Installed integration — 2026-10-29

Candidate a535e3263de76a2fca01eb54329a8af7f8ecc41995cd0971d5578be27ce16423; Supervisor 2.2.1; connected Node24.21.0; preparation PASS. Disposable baseline 2da2bdce9cf7745710cc652d82ceb0b2a1a65c7d.

Review de978930-7ddd-468e-9fcf-02c0411545b1: accepted; read both context files, correctly identified exactly100 boundary defect, verified read-only integrity, completed/end_turn with no warnings.

Edit 723de6a2-7ab1-4e86-b5c0-cae07d23a9d4: REJECTED. Completed/end_turn with no warnings; exactly two permitted files changed, automated checks passed. Exported patch SHA256 4bd098d8110eeccdbebad74ba72a39ac93e78ccb1307435ae3f00306ce422b41; contract SHA256 46de1c12f7ab45e25f62f3c3658670cbc63c16382a902f0297f9960954351020. Requested named node:test cases are absent: the artifact contains top-level strictEqual assertions. Assertion import spelling was not constrained. Generated assertions and six independent boundaries pass; unchanged tests fail against original baseline at exactly100. Two shell attempts were denied by policy.

Ordinary0644 patch/request inputs accepted unchanged. Generic validation prepare --no-install passed before dispatch and with exact exported patch, without package metadata, manual chmod or reconstruction fallback. This confirms the narrow artifact repair, not prompt-independent implementation reliability or broad target qualification.

Both runs closed; dirty worker worktree retained under policy. Fixture source clean. Prior config restored byte-exactly after checking no concurrent changes; temporary fixture root removed. No patch integrated; no unchanged retry. Next open stage: contract-derived requirements and executable validation feedback with bounded correction attempts.
