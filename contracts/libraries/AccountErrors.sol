// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title Errors — Custom error definitions for the ERC-4337 project
library AccountErrors {
    /// @notice Caller is not the EntryPoint
    error NotFromEntryPoint();

    /// @notice Caller is not the account owner
    error NotOwner();

    /// @notice Caller is not the account owner or EntryPoint
    error NotOwnerOrEntryPoint();

    /// @notice Signature validation failed
    error InvalidSignature();

    /// @notice Insufficient token balance for gas payment
    error InsufficientTokenBalance();

    /// @notice Session key has expired or is not yet valid
    error SessionExpired();

    /// @notice Session key is not registered
    error SessionKeyNotRegistered();

    /// @notice Target contract not allowed for this session key
    error TargetNotAllowed();

    /// @notice Guardian is already registered
    error GuardianAlreadyExists();

    /// @notice Guardian is not registered
    error GuardianNotFound();

    /// @notice Recovery is still in time-lock period
    error RecoveryTimeLocked();

    /// @notice Recovery has already been confirmed by this guardian
    error AlreadyConfirmed();

    /// @notice No active recovery request
    error NoActiveRecovery();

    /// @notice Recovery threshold not met
    error ThresholdNotMet();

    /// @notice Invalid threshold value
    error InvalidThreshold();

    /// @notice Arrays length mismatch
    error LengthMismatch();

    /// @notice Zero address provided
    error ZeroAddress();

    /// @notice Paymaster signature expired
    error PaymasterSignatureExpired();
}
