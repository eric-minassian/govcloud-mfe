/**
 * Contracts the compiler can't check on its own: between the web build, the release tooling, the
 * Rust frontend API and the infrastructure. Human-readable version: docs/contracts.md.
 * Rust mirror of the API types: services/frontend-api/src/model.rs.
 */

export * from './api';
export * from './module-descriptor';
export * from './release';
