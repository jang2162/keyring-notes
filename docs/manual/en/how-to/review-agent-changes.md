# Review agent changes

This guide makes agent writes in chosen folders wait for your approval before they reach the vault.

It is for people who want to check what an agent changes before it lands.

## Choose the folders to review

Click **Review** on the rail (✔) and list folders under **Review targets**. Use `/` for the whole vault.

From then on, changes that **agents** write under those folders are not applied right away. They queue up as proposals. Writes by people always apply immediately.

## Approve or reject a proposal

1. Open **Review** and pick a proposal.
2. Read the diff.
3. Click **Approve** to commit the change under the agent's name, with you as approver in the commit body. Or reject it with a reason.

Permission and conflict checks run when the agent submits. If the note changed in the meantime, the proposal is marked as changed since, and approval is rejected as a conflict.

The status bar shows how many reviews are waiting.

## What the agent sees

- The write returns `pending`, and the vault stays unchanged until approval.
- The agent reads the results, including rejection reasons, with MCP `my_proposals`.
- When an agent moves a note and that touches a review-target path, the link updates are part of the proposal preview.

## Next steps

- [Connect agents](connect-agents.md)
- [Automate with webhooks](automate-with-webhooks.md): get a `proposal.created` event for each new proposal.
