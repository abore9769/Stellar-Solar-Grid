# Contributing to Stellar SolarGrid

Thanks for your interest in contributing! This guide covers everything you need to get up and running.

## Table of Contents

- [Getting Started](#getting-started)
- [Project Structure](#project-structure)
- [Development Setup](#development-setup)
- [Running Tests](#running-tests)
- [Coding Standards](#coding-standards)
- [Security Considerations](#security-considerations)
- [Troubleshooting](#troubleshooting)
- [Submitting a Pull Request](#submitting-a-pull-request)

---

## Getting Started

1. Fork the repository and clone your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/Stellar-Solar-Grid.git
   cd Stellar-Solar-Grid
   ```

2. Add the upstream remote:
   ```bash
   git remote add upstream https://github.com/ORIGINAL_OWNER/Stellar-Solar-Grid.git
   ```

3. Create a feature branch off `main`:
   ```bash
   git checkout -b feat/your-feature-name
   ```

---

## Project Structure

```
Stellar-Solar-Grid/
├── contracts/     # Soroban smart contracts (Rust)
├── frontend/      # React + TypeScript dashboards (Vite)
└── backend/       # Node.js API + IoT MQTT bridge (Express + tsx)
```

---

## Development Setup

### Prerequisites

| Tool | Version |
|------|---------|
| Node.js | >= 18 |
| Rust | stable (via [rustup](https://rustup.rs/)) |
| Stellar CLI | latest |
| Freighter Wallet | browser extension |

Add the WASM target once after installing Rust:
```bash
rustup target add wasm32-unknown-unknown
```

### Smart Contracts

```bash
cd contracts
cargo build --target wasm32-unknown-unknown --release
```

Deploy to testnet:
```bash
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/solar_grid.wasm \
  --network testnet
```

### Frontend

```bash
cd frontend
cp .env.example .env        # fill in your contract ID and network
npm install
npm run dev
```

### Backend

```bash
cd backend
cp .env.example .env        # fill in your Stellar keys and MQTT config
npm install
npm run dev
```

---

## Running Tests

### Smart Contract Tests

Run the complete test suite:
```bash
cd contracts
cargo test
```

Run specific test modules:
```bash
cargo test test_register_and_payment
cargo test --test integration_tests
```

### Frontend Tests

```bash
cd frontend
npm run test          # Run Jest tests
npm run test:watch    # Run tests in watch mode
npm run test:coverage # Generate coverage report
```

### Backend Tests

```bash
cd backend
npm run test          # Run test suite
npm run test:watch    # Run tests in watch mode
```

### End-to-End Testing

1. Start all services:
   ```bash
   docker-compose up -d
   ```

2. Deploy contract to testnet:
   ```bash
   cd contracts
   stellar contract deploy \
     --wasm target/wasm32-unknown-unknown/release/solar_grid.wasm \
     --network testnet
   ```

3. Update environment files with deployed contract ID
4. Test the complete flow through the frontend dashboard

---

## Coding Standards

### TypeScript (frontend & backend)

- Use TypeScript strict mode — no `any` unless absolutely necessary.
- Prefer `const` over `let`; avoid `var`.
- Name files in `kebab-case`, components in `PascalCase`.
- Keep functions small and single-purpose.
- Run `tsc --noEmit` before committing to catch type errors.

### Rust (contracts)

- Follow standard Rust formatting: `cargo fmt` before every commit.
- Run `cargo clippy -- -D warnings` and fix all warnings.
- Document public functions with `///` doc comments.
- Avoid `unwrap()` in contract code — handle errors explicitly.

### General

- No commented-out dead code in PRs.
- Keep commits atomic and write meaningful commit messages using [Conventional Commits](https://www.conventionalcommits.org/):
  ```
  feat: add weekly payment plan support
  fix: correct meter access check logic
  docs: update contract deployment steps
  ```

---

## Security Considerations

### Environment Variables

- Never commit `.env` files or expose secret keys
- Use `.env.example` as a template with placeholder values
- Rotate keys regularly in production environments
- Use different keys for testnet and mainnet

### Smart Contract Security

- All contract functions validate inputs and handle errors explicitly
- Payment amounts are checked for overflow/underflow
- Access control is enforced through allowlists and ownership checks
- Test edge cases thoroughly, especially around balance calculations

### API Security

- All endpoints validate request schemas using Zod
- Rate limiting is implemented for payment endpoints
- Webhook signatures are verified before processing
- CORS is configured appropriately for the frontend domain

---

## Troubleshooting

### Common Issues

**Contract deployment fails:**
- Ensure you have testnet XLM in your account
- Check that the WASM file was built successfully
- Verify network configuration in Stellar CLI

**Backend fails to start:**
- Check that all required environment variables are set
- Ensure MQTT broker is running (via Docker Compose)
- Verify Stellar RPC endpoint is accessible

**Frontend build errors:**
- Clear node_modules and reinstall: `rm -rf node_modules package-lock.json && npm install`
- Check that environment variables match the deployed contract
- Ensure Freighter wallet is installed and connected to testnet

**Tests failing:**
- For contract tests: ensure `wasm32-unknown-unknown` target is installed
- For frontend tests: check that test environment variables are set
- For integration tests: ensure all services are running

### Getting Help

- Check existing [Issues](../../issues) for similar problems
- Open a [Discussion](../../discussions) for questions
- Review the [API documentation](backend/API.md) for endpoint details

---

## Submitting a Pull Request

1. Sync with upstream before opening a PR:
   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

2. Make sure the project builds cleanly:
   ```bash
   # Contracts
   cargo build --target wasm32-unknown-unknown --release

   # Frontend
   cd frontend && npm run build

   # Backend
   cd backend && npm run build
   ```

3. Push your branch and open a PR against `main`.

4. Fill out the pull request template completely.

5. A maintainer will review your PR. Please respond to feedback promptly and keep the branch up to date.

### PR Checklist

- [ ] Code builds without errors or warnings
- [ ] Existing functionality is not broken
- [ ] New logic is reasonably self-documenting or commented
- [ ] PR description explains the *why*, not just the *what*

---

For questions, open a [Discussion](../../discussions) or drop a comment on the relevant issue.
