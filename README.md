# Original WatchDog checkpoints

This archive preserves the exact original commit identities before publication through the GitHub API. Product and pilot trees were published without changing their bytes; publication generated different commit IDs.

Bundle: `watchdog-original-checkpoints.bundle` (5,825,189 bytes), SHA-256 `68aff226e96d5ab147718376bf10f4ec978b2a24eaced4ff69936851134056cf`.

Original product: `2c0e0135cb80105c400fe1ec1a9953aeb8eaf0a4`; published product: `a0e061f78dfd46fab3c13381e24f5aa5299ccfd1`; identical tree `8d0068c699cb6f7ea80d04c4af65975adf0da1e3`.

Original pilots: `7346f0a0d6d397e6e3e2efcc60d92dfd15dd81b6`; published pilots: `9c562d8d20ea2e129b44062080c138cb2adb1ceb`; identical tree `35e8a22ad71083f4a8500b98ed7f9d3d8b003f6e`.

The bundle requires prerequisite `61daefd82cc778e28d2d3868eaaf0689d856fc49`, already in repository history. Save the bundle outside the active worktree, verify its SHA-256, then restore into an existing clone:

```bash
git bundle verify /path/to/watchdog-original-checkpoints.bundle
git fetch /path/to/watchdog-original-checkpoints.bundle \
  refs/heads/codex/watchdog-resume-20261002:refs/heads/archive/source-product-20261002 \
  refs/heads/research/gpt-pilots-20261002:refs/heads/archive/source-pilots-20261002
```

Retain this branch and both earlier archive branches; do not move or delete them. This is a preservation convention, not technical branch protection. No new scientific approval or live deployment is claimed.
