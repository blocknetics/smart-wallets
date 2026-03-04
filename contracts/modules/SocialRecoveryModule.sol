// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../libraries/AccountErrors.sol";

/**
 * @title SocialRecoveryModule
 * @notice Guardian-based wallet recovery for SmartAccounts.
 * @dev Guardians can vote to replace the account owner when the owner
 *      loses access. Recovery requires a threshold of guardian approvals
 *      and a time-lock delay before execution.
 *
 * Flow:
 * 1. Owner adds guardians via `addGuardian()`
 * 2. If owner loses access, a guardian initiates recovery via `initiateRecovery(newOwner)`
 * 3. Other guardians confirm via `confirmRecovery()`
 * 4. After threshold is met AND time-lock expires, anyone calls `executeRecovery()`
 * 5. Owner can cancel during time-lock with `cancelRecovery()`
 */
contract SocialRecoveryModule {
    struct RecoveryRequest {
        address newOwner;
        uint256 confirmations;
        uint256 executionTime; // Earliest time recovery can be executed
        bool active;
    }

    /// @notice Time-lock delay after threshold is met (default 2 days)
    uint256 public constant RECOVERY_DELAY = 2 days;

    /// @notice account => list of guardians
    mapping(address => address[]) public guardians;

    /// @notice account => guardian => isGuardian
    mapping(address => mapping(address => bool)) public isGuardian;

    /// @notice account => guardian count
    mapping(address => uint256) public guardianCount;

    /// @notice account => recovery threshold
    mapping(address => uint256) public threshold;

    /// @notice account => active recovery request
    mapping(address => RecoveryRequest) public recoveryRequests;

    /// @notice account => recovery => guardian => has confirmed
    mapping(address => mapping(address => bool)) public hasConfirmed;

    // ─── Events ─────────────────────────────────────────────────────────
    event GuardianAdded(address indexed account, address indexed guardian);
    event GuardianRemoved(address indexed account, address indexed guardian);
    event ThresholdChanged(address indexed account, uint256 threshold);
    event RecoveryInitiated(
        address indexed account,
        address indexed newOwner,
        address indexed initiator
    );
    event RecoveryConfirmed(address indexed account, address indexed guardian);
    event RecoveryExecuted(address indexed account, address indexed newOwner);
    event RecoveryCancelled(address indexed account);

    // ─── Guardian Management (called by account) ────────────────────────
    /**
     * @notice Add a guardian for the calling account.
     * @param guardian The guardian address.
     */
    function addGuardian(address guardian) external {
        if (guardian == address(0)) revert AccountErrors.ZeroAddress();
        if (isGuardian[msg.sender][guardian]) revert AccountErrors.GuardianAlreadyExists();

        isGuardian[msg.sender][guardian] = true;
        guardians[msg.sender].push(guardian);
        guardianCount[msg.sender]++;

        emit GuardianAdded(msg.sender, guardian);
    }

    /**
     * @notice Remove a guardian from the calling account.
     * @param guardian The guardian to remove.
     */
    function removeGuardian(address guardian) external {
        if (!isGuardian[msg.sender][guardian]) revert AccountErrors.GuardianNotFound();

        isGuardian[msg.sender][guardian] = false;
        guardianCount[msg.sender]--;

        // Remove from array
        address[] storage guars = guardians[msg.sender];
        for (uint256 i = 0; i < guars.length; i++) {
            if (guars[i] == guardian) {
                guars[i] = guars[guars.length - 1];
                guars.pop();
                break;
            }
        }

        // Adjust threshold if needed
        if (threshold[msg.sender] > guardianCount[msg.sender]) {
            threshold[msg.sender] = guardianCount[msg.sender];
        }

        emit GuardianRemoved(msg.sender, guardian);
    }

    /**
     * @notice Set the recovery threshold.
     * @param _threshold Number of guardian confirmations needed.
     */
    function setThreshold(uint256 _threshold) external {
        if (_threshold == 0 || _threshold > guardianCount[msg.sender]) {
            revert AccountErrors.InvalidThreshold();
        }
        threshold[msg.sender] = _threshold;
        emit ThresholdChanged(msg.sender, _threshold);
    }

    // ─── Recovery Flow ──────────────────────────────────────────────────
    /**
     * @notice Initiate a recovery request (called by a guardian).
     * @param account The account to recover.
     * @param newOwner The proposed new owner.
     */
    function initiateRecovery(address account, address newOwner) external {
        if (!isGuardian[account][msg.sender]) revert AccountErrors.GuardianNotFound();
        if (newOwner == address(0)) revert AccountErrors.ZeroAddress();

        // Clear any previous confirmation state
        _clearConfirmations(account);

        recoveryRequests[account] = RecoveryRequest({
            newOwner: newOwner,
            confirmations: 1,
            executionTime: 0,
            active: true
        });

        hasConfirmed[account][msg.sender] = true;

        emit RecoveryInitiated(account, newOwner, msg.sender);

        // Check if threshold is met immediately (e.g. threshold = 1)
        _checkThreshold(account);
    }

    /**
     * @notice Confirm an active recovery request (called by a guardian).
     * @param account The account being recovered.
     */
    function confirmRecovery(address account) external {
        if (!isGuardian[account][msg.sender]) revert AccountErrors.GuardianNotFound();

        RecoveryRequest storage req = recoveryRequests[account];
        if (!req.active) revert AccountErrors.NoActiveRecovery();
        if (hasConfirmed[account][msg.sender]) revert AccountErrors.AlreadyConfirmed();

        hasConfirmed[account][msg.sender] = true;
        req.confirmations++;

        emit RecoveryConfirmed(account, msg.sender);

        _checkThreshold(account);
    }

    /**
     * @notice Execute a recovery after threshold is met and time-lock expired.
     * @param account The account to recover.
     * @return newOwner The new owner address.
     */
    function executeRecovery(address account) external returns (address newOwner) {
        RecoveryRequest storage req = recoveryRequests[account];
        if (!req.active) revert AccountErrors.NoActiveRecovery();
        if (req.executionTime == 0) revert AccountErrors.ThresholdNotMet();
        if (block.timestamp < req.executionTime) revert AccountErrors.RecoveryTimeLocked();

        newOwner = req.newOwner;

        // Clear recovery state
        req.active = false;
        _clearConfirmations(account);

        emit RecoveryExecuted(account, newOwner);

        // The calling account should use this return value to update owner
        // SmartAccount calls: socialRecovery.executeRecovery() and then updates owner
        return newOwner;
    }

    /**
     * @notice Cancel an active recovery (called by the account/owner).
     */
    function cancelRecovery() external {
        RecoveryRequest storage req = recoveryRequests[msg.sender];
        if (!req.active) revert AccountErrors.NoActiveRecovery();

        req.active = false;
        _clearConfirmations(msg.sender);

        emit RecoveryCancelled(msg.sender);
    }

    // ─── View Functions ─────────────────────────────────────────────────
    /**
     * @notice Get guardians for an account.
     * @param account The account address.
     * @return The list of guardian addresses.
     */
    function getGuardians(address account) external view returns (address[] memory) {
        return guardians[account];
    }

    /**
     * @notice Get active recovery request details.
     * @param account The account address.
     */
    function getRecoveryRequest(
        address account
    )
        external
        view
        returns (
            address newOwner,
            uint256 confirmations,
            uint256 executionTime,
            bool active
        )
    {
        RecoveryRequest storage req = recoveryRequests[account];
        return (req.newOwner, req.confirmations, req.executionTime, req.active);
    }

    // ─── Internal ───────────────────────────────────────────────────────
    function _checkThreshold(address account) internal {
        RecoveryRequest storage req = recoveryRequests[account];
        if (req.confirmations >= threshold[account] && req.executionTime == 0) {
            req.executionTime = block.timestamp + RECOVERY_DELAY;
        }
    }

    function _clearConfirmations(address account) internal {
        address[] storage guars = guardians[account];
        for (uint256 i = 0; i < guars.length; i++) {
            hasConfirmed[account][guars[i]] = false;
        }
    }
}
