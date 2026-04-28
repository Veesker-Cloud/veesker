# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] — 2026-04-28 — Community Edition

### Added
- **Community Edition identity** — Veesker is now officially branded as Community Edition (CE), free forever under Apache 2.0
- CE logo and branding throughout README and app
- Clear CE vs Cloud feature table in README
- Terminal panel (xterm.js + PTY backend) with minimize, right-dock, and resize
- Execute button (▶) for SQL queries in the dock toolbar
- Commit/Rollback transaction log entries with elapsed time
- ORDS bootstrap modal redesigned as subtle corner toast

### Fixed
- `oracledb.autoCommit` now explicitly set to `false` — prevents accidental DML commits regardless of driver version
- Terminal fills to bottom of container correctly
- Terminal PTY session preserved when docking position changes

### Changed
- AI assistant (BYOK) limited to text-only in CE — explain SQL and generate SQL without database tool access
- `CommercialUseModal` updated with clear CE free-forever messaging

## [Unreleased]
