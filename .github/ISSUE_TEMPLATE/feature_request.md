name: Feature Request
description: Suggest a new feature or enhancement
title: "[Feature] "
labels: ["enhancement"]
body:
  - type: markdown
    attributes:
      value: |
        Thanks for taking the time to suggest a new feature!
  - type: textarea
    id: problem
    attributes:
      label: Problem Statement
      description: What problem does this feature solve?
      placeholder: Describe the problem you want to solve...
    validations:
      required: true
  - type: textarea
    id: solution
    attributes:
      label: Proposed Solution
      description: How should this problem be solved?
      placeholder: Describe your proposed solution...
    validations:
      required: true
  - type: textarea
    id: alternatives
    attributes:
      label: Alternatives Considered
      description: Any alternative solutions you considered?
  - type: textarea
    id: context
    attributes:
      label: Additional Context
      description: Any other context about the feature request?
