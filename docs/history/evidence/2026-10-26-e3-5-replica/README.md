# E3.5 option B' — restore drill (2026-10-26)

**Data source:** a copy of the audit instance's database and object store (`inst_e57b2`). This is real JH16 data from 25–26.10. It is not the owner's VM data, and the live database was not read. The "bucket" was a local directory (`file://`), because creating the bucket waits for the owner's approval.

**What `drill.sh` did:**
1. Started the app on the copy.
2. Sent 20 protocol freezes through the HTTP API (fictional names "drill N", on the copy only) while running 3 pushes.
3. Ran a final push.
4. Restored into a new directory.
5. Compared the restored database with the source.
6. Started a second app instance on the restored data. Its vault key came from a separate copy.
7. Compared the outputs of the two instances.

**Results:**
- Writes: 20 × HTTP 201 (`writes_status.txt`).
- Pushes: 4 snapshots (`push.log`).
- Restore: `restore.json`, with 408 raw blobs verified.
- Logical equality with the source: `compare.json`.
- Both instances showed the same run count, protocol count and p-values (`apps.txt`), and the same run export hash (`export_hashes.txt`).
- Each intermediate snapshot was restored separately and was consistent: 3, 5, 10 and 22 protocols.
