# Security Policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Report vulnerabilities privately through GitHub:
**Security → Advisories → [Report a vulnerability](https://github.com/CalibraFacil/calibrafacil/security/advisories/new)**.

Include what you found, how to reproduce it and the impact you expect. You will get an
acknowledgement when a maintainer is able to look at it; this is a volunteer project, so
there is no guaranteed response time and no bug bounty.

## Supported versions

Only the latest code on the `main` branch receives security fixes. There are no long-term
support releases.

## Scope

Of particular interest:

- authentication, session handling and the passwordless flows;
- tenant isolation (organizations, units, client-portal scoping) and the RBAC layer;
- certificate signing, verification and the immutability of approved records;
- the public, unauthenticated endpoints (verification, quote approval, portal access).

Calibra Fácil is self-hosted software: the security of each deployment (infrastructure,
secrets, backups, updates) is the responsibility of whoever operates it.
