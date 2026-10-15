# ADR 0006: permit Vibe's pinned bundled skill catalogue

Status: owner-approved on 2026-10-15; implemented in local 2.0.0-rc.2.

The rc.1 target check found packaged plugin skills listed despite the setting
disabled_skills=["*"]. The owner explicitly requested: "Let vibe have own skills".
The previous empty-catalogue rule was a Supervisor policy choice, not evidence
that any skill executed or bypassed a tool permission.

Accept only these skill names shipped by pinned Vibe 2.26.1: vibe:create-plugin,
vibe:skill-creator, vibe:vibe, vibe:worktree. Every reported entry must have source
plugin, scope builtin, registry null and a unique name. Missing provenance,
unknown names and user/global/project/registry lookalikes remain failures. An
empty or filtered subset is also acceptable. The per-start installed-distribution
pin still covers the packaged plugin manifest, skill files and projection code.
This is installed-snapshot integrity, not provenance from a published wheel.

Keep disabled_skills=["*"] to suppress root SkillManager user/project skills.
The unified packaged plugin catalogue follows a separate path and is permitted
explicitly. config/read.skillsCount must remain zero because that response counts
non-builtin root skills; it is not the packaged plugin inventory.

Skill guidance does not grant execution authority. Do not add a skill, shell,
network or other tool to the profile as a side effect of accepting the catalogue.
Keep exact runtime tool read-back, per-call path/approval checks, isolated edit
worktrees and no automatic application. Bundled worktree or plugin guidance may
describe actions the Supervisor refuses; its instructions do not override the
user task or these controls. User and project skill directories remain untrusted.

Report the accepted skill names and provenance without copying prompt bodies.
Regression tests cover allowed catalogue entries, duplicate/unknown names,
project/global/registry spoofing, missing provenance and an unchanged tool list.
New installed conformance is required; do not relabel rc.1's failure as success.
