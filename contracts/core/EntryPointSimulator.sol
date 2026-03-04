// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/* solhint-disable avoid-low-level-calls */
/* solhint-disable no-inline-assembly */

import "@account-abstraction/contracts/interfaces/PackedUserOperation.sol";
import "@account-abstraction/contracts/interfaces/IAccount.sol";
import "@account-abstraction/contracts/interfaces/IPaymaster.sol";
import "@account-abstraction/contracts/interfaces/IEntryPoint.sol";
import "@account-abstraction/contracts/interfaces/ISenderCreator.sol";
import "@account-abstraction/contracts/core/UserOperationLib.sol";
import "@account-abstraction/contracts/core/Helpers.sol";
import "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/**
 * @title EntryPointSimulator
 * @notice A simplified local EntryPoint mock for testing ERC-4337 flows.
 * @dev This is NOT a full EntryPoint implementation. It handles basic
 *      UserOp validation/execution, hash generation, nonce management,
 *      and deposit tracking. Use the real EntryPoint for production.
 */
contract EntryPointSimulator is IERC165 {
    using UserOperationLib for PackedUserOperation;

    /// @notice Deposits per address
    mapping(address => uint256) public deposits;

    /// @notice Nonces: account => key => nonce
    mapping(address => mapping(uint192 => uint256)) public nonceMap;

    // ─── Events ─────────────────────────────────────────────────────────
    event UserOperationEvent(
        bytes32 indexed userOpHash,
        address indexed sender,
        address indexed paymaster,
        uint256 nonce,
        bool success,
        uint256 actualGasCost,
        uint256 actualGasUsed
    );

    event Deposited(address indexed account, uint256 amount);
    event Withdrawn(address indexed account, address target, uint256 amount);

    // ─── Core Functions ─────────────────────────────────────────────────

    /**
     * @notice Handle a batch of UserOperations.
     * @param ops Array of packed UserOperations.
     * @param beneficiary Address to receive gas compensation.
     */
    function handleOps(
        PackedUserOperation[] calldata ops,
        address payable beneficiary
    ) external {
        for (uint256 i = 0; i < ops.length; i++) {
            _handleOp(ops[i], beneficiary);
        }
    }

    /**
     * @notice Get the hash of a UserOperation.
     * @param userOp The packed UserOperation.
     * @return The UserOp hash (includes entrypoint address and chain ID).
     */
    function getUserOpHash(
        PackedUserOperation calldata userOp
    ) public view returns (bytes32) {
        bytes32 opHash = userOp.hash(bytes32(0));
        return keccak256(abi.encode(opHash, address(this), block.chainid));
    }

    /**
     * @notice Get the next nonce for an account.
     * @param sender The account address.
     * @param key The nonce key.
     * @return nonce The next valid nonce.
     */
    function getNonce(
        address sender,
        uint192 key
    ) external view returns (uint256 nonce) {
        return nonceMap[sender][key] | (uint256(key) << 64);
    }

    // ─── Deposit Management ─────────────────────────────────────────────

    function depositTo(address account) external payable {
        deposits[account] += msg.value;
        emit Deposited(account, msg.value);
    }

    function balanceOf(address account) external view returns (uint256) {
        return deposits[account];
    }

    function withdrawTo(
        address payable withdrawAddress,
        uint256 amount
    ) external {
        require(deposits[msg.sender] >= amount, "insufficient deposit");
        deposits[msg.sender] -= amount;
        (bool success, ) = withdrawAddress.call{value: amount}("");
        require(success, "withdraw failed");
        emit Withdrawn(msg.sender, withdrawAddress, amount);
    }

    // ─── Staking stubs (required for BasePaymaster compatibility) ───────
    function addStake(uint32 /*unstakeDelaySec*/) external payable {
        deposits[msg.sender] += msg.value;
    }

    function unlockStake() external {}

    function withdrawStake(address payable withdrawAddress) external {
        uint256 amount = deposits[msg.sender];
        deposits[msg.sender] = 0;
        (bool success, ) = withdrawAddress.call{value: amount}("");
        require(success, "withdraw failed");
    }

    // ─── Internal ───────────────────────────────────────────────────────

    function _handleOp(
        PackedUserOperation calldata userOp,
        address payable /*beneficiary*/
    ) internal {
        bytes32 userOpHash = getUserOpHash(userOp);
        uint256 gasStart = gasleft();

        // 1. Validate UserOp
        uint256 validationData = IAccount(userOp.sender).validateUserOp(
            userOp,
            userOpHash,
            0 // missingAccountFunds — simplified
        );

        // Check validation result
        ValidationData memory vd = _parseValidationData(validationData);
        require(
            vd.aggregator == address(0),
            "signature validation failed"
        );

        // 2. Increment nonce
        uint192 key = uint192(userOp.nonce >> 64);
        nonceMap[userOp.sender][key]++;

        // 3. Execute callData
        bool success;
        if (userOp.callData.length > 0) {
            (success, ) = userOp.sender.call(userOp.callData);
        } else {
            success = true;
        }

        uint256 gasUsed = gasStart - gasleft();

        // Determine paymaster address (first 20 bytes of paymasterAndData)
        address paymaster = address(0);
        if (userOp.paymasterAndData.length >= 20) {
            paymaster = address(bytes20(userOp.paymasterAndData[:20]));
        }

        emit UserOperationEvent(
            userOpHash,
            userOp.sender,
            paymaster,
            userOp.nonce,
            success,
            gasUsed * tx.gasprice,
            gasUsed
        );
    }

    // ─── ERC-165 Support (required by BasePaymaster) ────────────────────
    function supportsInterface(bytes4 interfaceId) external pure override returns (bool) {
        return interfaceId == type(IEntryPoint).interfaceId
            || interfaceId == type(IERC165).interfaceId;
    }

    // ─── SenderCreator stub (required by SimpleAccountFactory) ─────────
    function senderCreator() external view returns (ISenderCreator) {
        return ISenderCreator(address(this));
    }

    // Allow deposits
    receive() external payable {
        deposits[msg.sender] += msg.value;
    }
}
