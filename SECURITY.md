# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 0.1.x   | ✅ |

## Reporting a Vulnerability

If you discover a security vulnerability in DeepJIT, please report it responsibly.

### How to Report

1. **Do NOT** open a public GitHub issue for security vulnerabilities
2. Email the maintainers directly or use GitHub's private vulnerability reporting
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if available)

### GitHub Private Vulnerability Reporting

Go to the repository's Security tab and click "Report a vulnerability" to submit a private report.

### What to Expect

- We will acknowledge your report within 48 hours
- We will investigate and provide an initial assessment within 7 days
- We will keep you informed of the fix timeline

## Security Notes

- **API keys**: DeepJIT never stores or reads provider credentials itself. Keys are
  resolved by the harness's credential service or the launching environment
  (`DEEPSEEK_API_KEY` etc.). Never commit keys to this repository or any config file.
- **Traces**: execution traces are stored locally in `~/.dsh/deepjit/deepjit.db`.
  Tool results may contain sensitive content; keep the database file permissions
  restricted (the plugin does not set world-readable modes).
- **Self-execution**: flow templates never run `deepjit_*` tools, and every flow step
  passes through the harness permission system (`tools/pre-execute`).
