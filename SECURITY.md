# Security policy

## Reporting a problem

Please report a security problem privately, not as a public issue: open the repository's **Security** tab and choose **Report a vulnerability** (GitHub's private reporting). If that is not available, open a public issue that says only that you have a security report, with no details, and we will arrange a private way to send it.

This is a one-person project, so replies can take a few days.

## What the app does and does not do

- It never sends information over the network by itself (see the privacy policy in the [README](README.md)).
- It deletes files and registry keys only after a preview and a confirmation, and backs up first. It never changes Windows' security settings.
- The only place it asks for administrator rights is a helper for a few kinds of leftover; Windows asks you first.

## Supported versions

Only the latest release gets fixes.
