# UX Specification

## Product tone

Technical, calm, evidence-first, and trustworthy. Avoid crypto casino imagery, excessive gradients, generic dashboard card walls, or claims that the blockchain “proves the code is correct.” It proves the integrity and lifecycle of commitments; the evidence explains what was checked.

## Navigation

```text
Overview
Projects
Tasks
Receipts
Docs
Wallet / Account
```

Keep the MVP navigation small. Public proof pages have a separate minimal header.

## Key screens

### Landing page

- Headline: “Agents can say it’s done. DoneBond shows the proof.”
- Three-step explanation: define checks, generate evidence, anchor/settle.
- A real sample receipt, not fake metrics.
- CLI installation snippet.
- Link to public repository and documentation.

### Dashboard

- Active tasks needing action
- Recent verification receipts
- Pending/recoverable chain transactions
- Withdrawable reward balance

Prioritize actions over vanity analytics.

### Project setup

- Repository details
- Policy path and policy validation status
- CLI token creation with copy-once warning
- Exact commands for initialization

### Create task

Use a focused step flow:

1. Problem and acceptance criteria
2. Assignee and deadline
3. Verification policy summary
4. Optional reward
5. Review commitments and create onchain

Explain network fees and show chain/address before wallet confirmation.

### Task detail

The page should answer, in order:

1. What was requested?
2. Who owns and who performed it?
3. What exact commit was checked?
4. Which checks passed or failed?
5. What evidence was anchored?
6. What is the current chain/reward state?
7. What action is available now?

### Verification result

Show a vertical list of checks with:

- required/optional badge;
- pass/fail/skipped/timeout status;
- command label, not necessarily unsafe raw command text on public pages;
- duration and exit code;
- expandable redacted output preview;
- output digest.

A failed deterministic check must be visually dominant and must disable receipt submission.

### Public proof page

- Human-readable receipt summary
- Integrity status from local/server hash comparison
- Task/policy/evidence/commit commitments
- Check result table
- Contract and transaction explorer links
- Downloadable safe evidence bundle
- Clear caveat: “This receipt proves the bound evidence and approval state; review the checks to understand coverage.”

### Transaction states

Design all states:

- waiting for wallet;
- user rejected;
- submitted/pending confirmation;
- confirmed;
- replaced;
- reverted;
- status unknown with retry/reconcile action.

Never show “failed” solely because an RPC request timed out.

## Mobile behavior

- Critical actions remain visible without horizontal scrolling.
- Hashes truncate in the middle with copy controls.
- Check output uses a horizontally scrollable code region.
- Tables become labeled stacked rows.

## Accessibility checklist

- Semantic headings in order
- Form labels and descriptions
- Error summary plus field-level messages
- Keyboard support for dialogs and expandable check output
- Visible focus ring
- Minimum touch target size
- Status icon plus text
- Motion respects reduced-motion settings
- Contrast tested in light and dark modes if both are shipped

## Content rules

Use precise language:

- “Check passed,” not “Code is safe.”
- “Evidence anchored,” not “Blockchain verified the implementation.”
- “Creator approved this receipt,” not “Network guaranteed quality.”
- “Reward credited for withdrawal,” not “Payment complete” until withdrawal confirms.
