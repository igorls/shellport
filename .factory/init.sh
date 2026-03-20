#!/bin/bash
# Shellport Docs Mission - Environment Setup
# This script runs at the start of each worker session

set -e

# Install dependencies if not already installed
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  bun install
fi

# Ensure VitePress is installed (worker will install if needed)
echo "Environment ready."
