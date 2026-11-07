# Security policy

## Reporting privately

Please use [GitHub private vulnerability reporting](https://github.com/pythc/agent-hub/security/advisories/new) for vulnerabilities, credential exposure, or cross-assignment access issues. Do not open a public issue containing exploit details or real credentials. Reports may be written in English or Chinese.

Include the affected commit, operating system, deployment mode, reproduction steps using synthetic data, expected boundary, and observed impact. Do not attach your browser profile, cookie jar, password vault, recovery code, model keys, or complete state directory.

Maintainers will investigate and coordinate fixes and disclosure through the private report. There is currently no bug bounty or guaranteed response deadline.

## Supported scope

Roppo is under active development. Fixes target the current `main` branch; there is no separate long-term support branch or backport guarantee. Use a current checkout and review upgrade notes before changing an instance you rely on.

The default deployment is a single-user host bound to loopback. A local web account does not make it a multi-tenant service. Model providers, CLI authentication, external websites, and any remote access layer have their own trust boundaries. See [operations](docs/OPERATIONS.md) and the [browser guide](docs/BROWSER.md) for persistence and isolation limits.

## Known dependency advisory

The current Zod 3 dependency is covered by [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5), concerning memory exhaustion while validating oversized constrained collections. The advisory's patched version is Zod 4.6.6. Migrating the schema layer needs compatibility and regression work; this advisory is not resolved in the current dependency set.

The host limits HTTP JSON request bodies to 256 KB, but that is not a substitute for a patched dependency or a proof that every ingestion path is unaffected. Do not treat the current personal deployment as a public multi-tenant service. Recheck `npm audit` against the exact revision you deploy.
