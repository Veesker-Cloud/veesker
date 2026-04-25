# Audit Log Shipper

Ship Veesker audit log entries to Splunk HEC, Datadog Logs, generic webhooks, or AWS S3 for compliance, observability, and forensics.

> 💼 **This is a paid add-on.** Free for personal/small-business Veesker users via in-app trial. Production use requires a Veesker Business or Enterprise subscription, or a standalone add-on license. See [pricing](https://veesker.dev/pricing).

## Why this exists

Veesker writes audit log entries locally to `audit/<date>.jsonl` for every SQL execution. This is enough for personal use and small teams. For compliance-driven organizations (banks, healthcare, government), local files are not enough:

- Logs need to be tamper-evident
- Logs need to be in the security team's central system (Splunk, Datadog, ELK, S3)
- Logs need to be retained according to regulatory policy (LGPD, BACEN, SOX)

This add-on solves that without requiring Veesker Cloud — it ships directly from each user's desktop to your existing observability stack.

## Supported destinations

| Destination | Status | Notes |
|---|---|---|
| Splunk HTTP Event Collector (HEC) | ✅ v0.1 | Tested with Splunk 9.x |
| Datadog Logs | ✅ v0.1 | All sites (US1/US3/US5/EU/AP1) |
| Generic webhook | ✅ v0.1 | POST JSON, custom headers |
| AWS S3 | 🚧 v0.2 | Requires AWS SDK integration |
| Azure Event Hubs | 🛣️ v0.3 | Roadmap |
| Google Cloud Logging | 🛣️ v0.3 | Roadmap |

## Filtering

Per-destination filters:
- `onlyDdl` — only ship `CREATE/ALTER/DROP/TRUNCATE/GRANT/REVOKE`
- `onlyDml` — only ship `INSERT/UPDATE/DELETE/MERGE`
- `onlyFailures` — only ship statements with errors
- `minElapsedMs` — only ship statements that took ≥N ms

## Buffering & retry

The shipper buffers entries in memory and flushes:
- When the batch reaches `maxBatchSize` (default 100)
- Or every `flushIntervalMs` (default 30s)

If a destination is down, entries are re-queued (up to `maxQueueSize`, default 10k). Oldest entries are dropped if the queue fills up.

## Permissions

The plugin requires:
- `audit-read` — to receive audit log entries from the Veesker core
- `network` — to send HTTP requests to your destinations
- `settings` — to store its own configuration

These are requested at first activation and shown in the Plugin Permissions Dialog.

## Installation

After purchasing a license:

1. Download `audit-shipper-<version>.veesker` from your Veesker account
2. Open Veesker → menu **Veesker → Plugins & License**
3. Drag the `.veesker` file into the dialog
4. Drag your `audit-shipper.veesker.license` file into the same dialog
5. Configure destinations in the plugin settings panel
6. Restart Veesker

## License

Commercial license — see [LICENSE](LICENSE). Not Apache 2.0.

## Support

Email: geefatec@gmail.com (use "[Audit Shipper]" in subject)

For Business/Enterprise customers, support is included via your tier's SLA.
