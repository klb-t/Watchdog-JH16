# E3.22 — kernel contract follow-up

The first published checkpoint is `0f2ebdaf4147f7f38d4fef60668faa0ae777bed6`.
Its GitHub Actions run `37606982232` completed the product/typecheck/build,
JH16 demo and principles-guard job successfully. At the time of this follow-up,
its container job was still running; that is not a claimed container pass.

A direct read of the working Linux environment's TCP tables exposed a real
contract difference: IPv4 calls the peer column `rem_address`, IPv6 uses
`remote_address`. The new conservative reader originally recognized only the
former and would have refused idle shutdown on IPv6-enabled hosts. Both actual
headers are now accepted; unknown or malformed tables still fail closed.
Boolean timestamps are also rejected rather than treated as epoch 0/1.

There are now **52/52 passing local Python operational contracts**, including four
new kernel/time cases. The TypeScript bridge discovers both test modules. Python
compilation and the generated Bash launcher's syntax pass. Full CI must be read
again for this new commit; no live VM, GUI, OAuth or package-install acceptance is
inferred from these tests. The preceding recovery report remains the operational
handoff and records the first 48-test checkpoint.
