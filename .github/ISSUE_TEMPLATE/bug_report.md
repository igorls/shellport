name: Bug Report
description: Report a bug in ShellPort
title: "[Bug] "
labels: ["bug"]
body:
  - type: markdown
    attributes:
      value: |
        Thanks for taking the time to fill out this bug report!
  - type: textarea
    id: description
    attributes:
      label: Bug Description
      description: A clear and concise description of what the bug is
      placeholder: Describe the bug here...
    validations:
      required: true
  - type: textarea
    id: steps
    attributes:
      label: Steps to Reproduce
      description: Steps to reproduce the bug
      placeholder: |
        1. Go to '...'
        2. Click on '...'
        3. See error
    validations:
      required: true
  - type: textarea
    id: expected
    attributes:
      label: Expected Behavior
      description: What you expected to happen
    validations:
      required: true
  - type: textarea
    id: actual
    attributes:
      label: Actual Behavior
      description: What actually happened
    validations:
      required: true
  - type: textarea
    id: environment
    attributes:
      label: Environment
      description: |
        - OS: [e.g., macOS 14.0, Ubuntu 22.04]
        - ShellPort version: [e.g., v0.2.0]
        - Bun version: [e.g., 1.3.0]
      placeholder: |
        - OS:
        - ShellPort version:
        - Bun version:
  - type: textarea
    id: logs
    attributes:
      label: Relevant Logs
      description: Any relevant error messages or logs
      placeholder: Paste error messages here...
