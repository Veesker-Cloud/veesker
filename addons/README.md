# Veesker Add-ons (Enterprise)

> ⚠️ **This folder will be moved to a private repository** (`github.com/veesker/veesker-addons`) before the open-source repository goes public.
>
> Add-ons are **paid plugins** distributed via the Veesker Marketplace under a separate commercial license. They are not part of the open-source Apache 2.0 build.

## Why these are kept separate

Following the Docker / Kubernetes model:
- The open-source IDE (this repository) is fully open under Apache 2.0
- Add-ons are **proprietary plugins** that load via the open Plugin API
- The open-source IDE **never depends** on add-on code; users without add-ons get the full free experience

When the open-source repo goes public:
1. This `addons/` folder will be moved to a private repo
2. The `.gitignore` of the public repo will exclude `addons/`
3. A separate CI pipeline will build, sign, and publish add-ons to the marketplace

## Add-ons in this repository

### `audit-shipper/` — Audit Log Shipper (Phase E1, in development)

Ships Veesker audit log entries to external destinations (Splunk HEC, Datadog Logs, generic webhook, S3).

- **Customer:** Compliance-driven organizations (banks, healthcare, government)
- **Pricing:** R$ 1.500/year/seat
- **Status:** Initial scaffold

### Planned add-ons

See `docs/ENTERPRISE.md` for the full roadmap. Next priorities:
- `ebs-pack/` — Oracle E-Business Suite wizards and templates
- `awr-analyzer/` — AWR/Statspack visualization
- `compliance-br/` — LGPD/BACEN audit reports
- `azure-openai/` — Azure OpenAI connector for Sheep
- `aws-bedrock/` — AWS Bedrock connector for Sheep
- `onprem-llm/` — On-prem LLM gateway (Llama/Mistral)
- `forms-converter/` — Oracle Forms 6i to APEX converter

## Add-on structure (template)

```
addons/<addon-name>/
├── manifest.json           Plugin metadata, signed by publisher
├── package.json            Bun/npm package
├── plugin.ts               Entry point — exports register(api)
├── README.md               User-facing documentation
├── LICENSE                 Commercial license (not Apache)
├── CHANGELOG.md
├── tests/
└── dist/                   Build output (.veesker bundle)
```

## Building an add-on (process)

(Process matures with first real add-on — initial state is scaffold.)

```bash
cd addons/audit-shipper
bun install
bun run build              # produces dist/audit-shipper.veesker

# Sign (requires plugin signing key)
veesker-cli sign-plugin dist/audit-shipper.veesker \
  --key ~/.veesker/plugin-signing-key

# Publish to marketplace (when marketplace exists)
veesker-cli publish dist/audit-shipper.veesker \
  --version 1.0.0
```

## License

Each add-on under this folder has its own commercial license. Customers receive a license JWT issued by Veesker's license server, valid for the term of their subscription.

The Apache 2.0 license of the parent open-source repository **does not apply** to add-on code in this folder.
