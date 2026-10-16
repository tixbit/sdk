# Seller troubleshooting

| Result | Next action |
| --- | --- |
| `sell` missing | Obtain a seller-capable release and verify `sell --help`. |
| Capabilities `configured: false` / HTTP 503 | Stop seller work. Operator approval/configuration of account bridge, SQLite, keys and exact client allowlist is required. Public search can continue. |
| Client/scopes rejected | Verify operator-provided public client ID and exact HTTPS callback. Do not self-register to bypass approval. |
| Repeated browser sign-in | Operator checks canonical origins, matching Privy app and verified-session cookies. Never copy browser tokens. |
| Callback/state invalid | Restart login on the same machine. Paste the full URL through stdin in `sell login --complete`; never remove state or use a bare code. |
| HTTP 401 / expired session | Sign in again and review permissions. |
| HTTP 403 | Verify seller account, current consent, scope and eligibility. Other-owner IDs must remain inaccessible. |
| Listing/review unavailable | Use `sell list` and the owner's seller IDs. Reviews bind to owner, client and current consent grant. |
| HTTP 409 | Read `sell review` and `sell list`. Review may have expired, changed, been consumed or need reconciliation. Do not retry with a fresh UUID. |
| Timeout after confirmation | Check status, then retry the same review if appropriate. Completed results replay safely; `reconcile` requires provider/operator follow-up. |
| Preparation response lost | Preserve attempt UUID, inspect inventory and reconcile before a new preparation. No confirmation was submitted. |
| Local state unreadable | Use the same machine and OS user. Never loosen permissions or paste private state into chat. Check inventory before replacing reviews. |
| Quantity/seat edit rejected | Explain this interface supports initial quantity only. Do not disguise delist/recreate as an update. |
| Pending broadcast/review/failure | Report that status; use website/support for follow-up. API success does not prove a live listing. |

Structured errors provide a code and next action. `retryable` is a recovery hint,
never permission to create a new mutation. Share only safe seller listing,
review and attempt IDs in bug reports; omit tokens, callbacks, nonces, cookies
and personal ticket asset files.
