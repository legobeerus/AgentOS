# Privacy Policy — AgentOS Discord Bot

Effective date: 2026-06-04

This Privacy Policy explains what personal data the AgentOS Discord bot ("AgentOS" or "the Bot") may collect, how it is used, stored, shared, and how you can request access or deletion. This policy applies to interactions with the Bot in Discord servers where it is installed.

## Data We Collect
- **Discord identifiers:** Discord user ID, username, discriminator, and avatar (used to identify and message users).
- **Interaction data:** Slash command inputs, button presses, modal submissions, message content sent to the bot, and timestamps.
- **Verification data:** Roblox username and Roblox user ID submitted to `/agentos-verify`. Temporary OAuth state tokens are created to support the Roblox OAuth flow.
- **Moderation & logs:** Reports, submission contents, blacklist entries, suspension/arrest records, moderator notes, and related metadata stored for moderation workflows.
- **Third-party data:** Data returned by integrated services (e.g., Roblox profile data from OAuth, Trello webhook payloads, or other API responses).
- **Technical & operational data:** Bot logs, error reports, and runtime metadata used for debugging and reliability. The bot does not collect Discord users' IP addresses.

## How We Use Data
- **Verification:** To confirm ownership of Roblox accounts and link them to Discord accounts when you use the verification command.
- **Moderation & safety:** To enforce server rules, process reports, and manage suspensions/blacklists.
- **Core features:** To operate submission workflows, background checks, follow-ups, schedulers, and other bot-provided features.
- **Notifications & replies:** To send ephemeral replies, follow-ups, or role pings as configured by server administrators.
- **Support & improvement:** To diagnose issues, investigate abuse, and improve Bot reliability.

## Storage & Retention
- **Storage locations:** Data is stored where the server operator configures it (local files, database, or third‑party services). This repository contains the Bot code and local storage implementation, but actual storage location depends on deployment.
- **Retention examples:** Verification challenges (state tokens) are short‑lived (example: 10 minutes). Moderation logs and records may be retained for operational and audit needs (typical ranges: 1–3 years). Specific retention periods should be published by the server operator.
- **Deletion requests:** You may request deletion of personal data. The Operator will remove linkages and, where feasible, delete stored personal data. Some records may be retained where required for legal, audit, or safety reasons.

## Third Parties & Sharing
- The Bot integrates with third parties (e.g., Roblox OAuth, Trello, webhooks). Data required to perform those integrations will be transmitted to those services and is subject to their terms and privacy practices.
- The Operator will not sell personal data. Data may be disclosed to comply with legal obligations or to protect rights and safety.

## Security
- Reasonable administrative and technical safeguards (access controls, secrets via environment variables, minimal privilege) are used by the Operator. However, no system is perfectly secure—avoid sending extremely sensitive personal information to the Bot.

## Your Rights
- **Access:** Request a copy of personal data the Bot holds about you.
- **Correction:** Request correction of inaccurate personal data.
- **Deletion:** Request deletion of your personal data (subject to legal/operational constraints).
- To make any request, contact the Bot owner with your Discord ID (see Contact below).

## Minors
- The Bot is not intended to collect data from children without parental consent. Do not provide personal data of minors through Bot commands.

## Changes
- This policy may be updated. Material changes should be posted in the repository and in server admin channels. Continued use after notice constitutes acceptance.

## Contact
- Bot owner / administrator: goofyahwalking@gmail.com (include your Discord ID in requests)

## Jurisdiction
- The Operator is located in Norway; this Privacy Policy is governed by the laws of Norway.

## Lawful Basis for Processing
- **Verification/OAuth (consent):** When you complete the Roblox OAuth verification, we rely on your explicit consent to process your Roblox identifiers and verify ownership. Consent is recorded when you start the OAuth flow.
- **Moderation, safety, and operational needs (legitimate interest):** Processing of reports, moderation logs, blacklist entries, and operational metadata is based on the Operator's legitimate interest in maintaining server safety and service functionality. Where required, we balance this interest against user rights and minimize data collected.
- **Legal obligations:** Where applicable, we may process or retain data to comply with legal obligations.

## Data Subject Rights (DSRs)
- You have rights under applicable data protection law, including access, rectification, erasure (right to be forgotten), restriction of processing, objection, and data portability.
- To exercise these rights, email goofyahwalking@gmail.com with your Discord ID and request details. We will acknowledge receipt and respond within 30 days, or with extension if needed for complex requests, consistent with GDPR/Norwegian law.
- You also have the right to lodge a complaint with the Norwegian Data Protection Authority (Datatilsynet): https://www.datatilsynet.no

## Data Transfers
- If data is transferred outside the European Economic Area (EEA), we will rely on an adequate transfer mechanism such as Standard Contractual Clauses (SCCs) or ensure the processor provides appropriate safeguards. Host or storage location options inside the EEA/Norway are recommended to reduce cross‑border requirements.

## Processors & Third Parties
- We may use processors to operate the Bot and its features (e.g., hosting providers, Trello, Roblox for OAuth). Where required by law, we will have written Data Processing Agreements (DPAs) in place with processors and ensure they act only on our instructions.

## Security & Breach Notification
- We implement reasonable technical and organizational measures to protect personal data (access controls, secrets management via environment variables, least privilege). However, no system is perfectly secure.
- In the event of a personal data breach that is likely to result in a risk to individuals' rights and freedoms, we will notify the Norwegian Data Protection Authority (Datatilsynet) without undue delay and, where required, within 72 hours. If the breach is likely to result in a high risk to individuals, we will also inform affected users.

## Retention Details
- **Verification challenges (state tokens):** 10 minutes.
- **Moderation logs, reports, and suspension records:** retained for operational and audit needs (typical range: 1–3 years) unless a deletion request or legal requirement applies.
- **Other operational logs and diagnostics:** retained for a limited period for troubleshooting and reliability; retention periods depend on deployment and configuration.

---
Note: This file is intended as a local/private reference for server operators. Update contact details and retention periods before publishing.
---
Note: This file is intended as a local/private reference for server operators. Update contact details and retention periods before publishing.
