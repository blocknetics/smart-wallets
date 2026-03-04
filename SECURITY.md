# Security Considerations

## Overview

This document outlines security considerations for the ERC-4337 Account Abstraction implementation.

## Smart Account Security

### Signature Validation

- **ECDSA Recovery**: `SmartAccount._validateSignature()` uses OpenZeppelin's `ECDSA.recover()` with `toEthSignedMessageHash()` to prevent raw hash signing attacks.
- **EntryPoint Enforcement**: `validateUserOp()` is restricted to calls from the EntryPoint via `_requireFromEntryPoint()`.
- **Module Delegation**: When a signature doesn't match the owner, the account attempts module-based validation. Modules are explicitly registered by the owner.

### Access Control

- `execute()` and `executeBatch()` are gated to either the owner or EntryPoint.
- Module enable/disable requires owner authorization.
- UUPS upgrade authorization requires the owner.

### Upgrade Safety

- Uses OpenZeppelin's `UUPSUpgradeable` with `Initializable`.
- Implementation constructor calls `_disableInitializers()` to prevent takeover.
- `_authorizeUpgrade()` is owner-only.

## Paymaster Security

### VerifyingPaymaster

- **Time-Bounded Signatures**: All paymaster signatures include `validUntil` and `validAfter` timestamps.
- **Chain-Scoped Hashing**: The hash includes `block.chainid` and the paymaster address to prevent cross-chain and cross-paymaster replay.
- **Signer Rotation**: Owner can rotate the verifying signer without redeployment.

### TokenPaymaster

- **Pre-Charge Model**: Tokens are transferred from the user during validation, then excess is refunded in `postOp`.
- **Balance Check**: `_validatePaymasterUserOp` verifies the user has sufficient token balance before proceeding.
- **Oracle Dependency**: The price oracle is a critical trust assumption — a compromised oracle could drain the paymaster.

## Session Keys

- **Time Bounds**: Each session key has `validAfter` and `validUntil` timestamps enforced by the EntryPoint.
- **Contract Restrictions**: Session keys can be scoped to specific target contracts.
- **Revocation**: Session keys can be revoked immediately by the account owner.

## Social Recovery

- **Threshold-Based**: Recovery requires a configurable number of guardian approvals (e.g., 3-of-5).
- **Time-Lock**: After threshold is met, a 2-day delay before execution allows the owner to cancel.
- **Cancellation**: The account owner can cancel any active recovery during the time-lock period.

## Known Limitations

1. **EntryPointSimulator**: The `EntryPointSimulator` contract is a simplified mock for testing only. It does NOT implement full ERC-4337 validation rules. Use the canonical `EntryPoint` contract for production.

2. **TokenPaymaster Oracle**: The mock oracle is for testing. Production deployments should use Chainlink or equivalent price feeds with staleness checks.

3. **Session Key Target Validation**: The current implementation validates target contract permissions at the module level. The actual call data is not decoded or validated — any function on an allowed contract can be called.

4. **Social Recovery Module**: The module requires the SmartAccount to explicitly integrate with it to update the `owner` storage variable after recovery execution.

## Recommendations

- Audit all contracts before mainnet deployment
- Use multi-sig for paymaster signer key management
- Monitor guardian key security for social recovery
- Set appropriate thresholds (never threshold = 1 in production)
- Use time-locked upgrades for critical parameter changes
