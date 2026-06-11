# Password Recovery Automation

> **Disclaimer:** Built for authorized use only — on accounts you own or have explicit written permission to manage.

Automates end-to-end password recovery flow for a VPN service using Playwright browser automation.

## How it works

1. Opens the service portal and submits email to trigger OTP
2. Polls email API to retrieve OTP as soon as it arrives
3. Submits OTP and navigates to the password reset flow
4. Polls email API again to retrieve the reset link
5. Opens reset link and sets a new password
6. Logs pass/fail result per step with response time
7. Saves test summary to `output/` folder

Multiple accounts are processed in parallel using Node.js Worker Threads, with a file lock mechanism to prevent race conditions when writing results.

## Stack
Node.js · Playwright · Worker Threads · dotenv