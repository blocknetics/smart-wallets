// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@account-abstraction/contracts/core/Helpers.sol";
import "../libraries/AccountErrors.sol";

/**
 * @title SessionKeyModule
 * @notice Allows SmartAccount owners to register temporary session keys
 *         that can authorize UserOperations within specific time bounds
 *         and restricted to specific target contracts.
 * @dev This module is registered with a SmartAccount via `enableModule()`.
 *      When a session key signs a UserOp, the SmartAccount delegates
 *      validation here via `validateSignature()`.
 */
contract SessionKeyModule {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    struct SessionKey {
        uint48 validAfter;
        uint48 validUntil;
        bool active;
    }

    /// @notice account => sessionKey => SessionKey data
    mapping(address => mapping(address => SessionKey)) public sessionKeys;

    /// @notice account => sessionKey => target contract => allowed
    mapping(address => mapping(address => mapping(address => bool))) public allowedContracts;

    // ─── Events ─────────────────────────────────────────────────────────
    event SessionKeyRegistered(
        address indexed account,
        address indexed sessionKey,
        uint48 validAfter,
        uint48 validUntil
    );
    event SessionKeyRevoked(address indexed account, address indexed sessionKey);
    event AllowedContractSet(
        address indexed account,
        address indexed sessionKey,
        address indexed target,
        bool allowed
    );

    // ─── Registration ───────────────────────────────────────────────────
    /**
     * @notice Register a session key for the calling account.
     * @param key The session key address.
     * @param validAfter Start of valid time window.
     * @param validUntil End of valid time window.
     * @param targets Array of allowed target contracts.
     */
    function registerSessionKey(
        address key,
        uint48 validAfter,
        uint48 validUntil,
        address[] calldata targets
    ) external {
        if (key == address(0)) revert AccountErrors.ZeroAddress();
        if (validUntil <= validAfter) revert AccountErrors.InvalidSessionKeyTime();
        if (sessionKeys[msg.sender][key].active) revert AccountErrors.SessionKeyAlreadyActive();

        sessionKeys[msg.sender][key] = SessionKey({
            validAfter: validAfter,
            validUntil: validUntil,
            active: true
        });

        for (uint256 i = 0; i < targets.length; i++) {
            allowedContracts[msg.sender][key][targets[i]] = true;
            emit AllowedContractSet(msg.sender, key, targets[i], true);
        }

        emit SessionKeyRegistered(msg.sender, key, validAfter, validUntil);
    }

    /**
     * @notice Revoke a session key.
     * @param key The session key to revoke.
     */
    function revokeSessionKey(address key) external {
        sessionKeys[msg.sender][key].active = false;
        emit SessionKeyRevoked(msg.sender, key);
    }

    /**
     * @notice Set whether a target contract is allowed for a session key.
     * @param key The session key.
     * @param target The target contract address.
     * @param allowed Whether to allow or disallow.
     */
    function setAllowedContract(
        address key,
        address target,
        bool allowed
    ) external {
        allowedContracts[msg.sender][key][target] = allowed;
        emit AllowedContractSet(msg.sender, key, target, allowed);
    }

    // ─── Validation ─────────────────────────────────────────────────────
    /**
     * @notice Validate a session key signature.
     * @dev Called by SmartAccount._validateSignature via static call.
     *      Signature format from SmartAccount: moduleAddress + actual signature
     * @param account The smart account address.
     * @param userOpHash The UserOperation hash.
     * @param signature The session key signature (without the module prefix).
     * @return validationData Packed validation data with time bounds.
     */
    function validateSignature(
        address account,
        bytes32 userOpHash,
        bytes calldata signature
    ) external view returns (uint256 validationData) {
        // Recover the session key from the signature
        bytes32 ethSignedHash = userOpHash.toEthSignedMessageHash();
        address recovered = ethSignedHash.recover(signature);

        SessionKey storage sk = sessionKeys[account][recovered];

        // Check session key is active
        if (!sk.active) {
            return SIG_VALIDATION_FAILED;
        }

        // Return packed validation data with time bounds
        // The EntryPoint will check the time bounds
        return _packValidationData(false, sk.validUntil, sk.validAfter);
    }

    /**
     * @notice Check if a session key is allowed to call a specific target.
     * @param account The smart account.
     * @param key The session key.
     * @param target The target contract.
     * @return True if allowed.
     */
    function isAllowed(
        address account,
        address key,
        address target
    ) external view returns (bool) {
        SessionKey storage sk = sessionKeys[account][key];
        if (!sk.active) return false;
        return allowedContracts[account][key][target];
    }
}
