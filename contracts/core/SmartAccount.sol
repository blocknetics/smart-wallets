// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/* solhint-disable avoid-low-level-calls */
/* solhint-disable no-inline-assembly */
/* solhint-disable reason-string */

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import "@account-abstraction/contracts/core/BaseAccount.sol";
import "@account-abstraction/contracts/core/Helpers.sol";
import "@account-abstraction/contracts/interfaces/PackedUserOperation.sol";
import "../libraries/AccountErrors.sol";

/**
 * @title SmartAccount
 * @notice ERC-4337 compatible smart contract wallet with modular validation,
 *         single/batch execution, session key support, and UUPS upgradeability.
 * @dev Extends BaseAccount from eth-infinitism for EntryPoint integration.
 *      Supports delegated validation to external modules (e.g. SessionKeyModule).
 */
contract SmartAccount is BaseAccount, UUPSUpgradeable, Initializable {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // ─── Storage ────────────────────────────────────────────────────────
    address public owner;
    IEntryPoint private immutable _entryPoint;

    /// @notice Tracks registered validation modules (e.g. SessionKeyModule)
    mapping(address => bool) public modules;

    // ─── Events ─────────────────────────────────────────────────────────
    event SmartAccountInitialized(IEntryPoint indexed entryPoint, address indexed owner);
    event ModuleEnabled(address indexed module);
    event ModuleDisabled(address indexed module);
    event OwnerChanged(address indexed previousOwner, address indexed newOwner);

    // ─── Modifiers ──────────────────────────────────────────────────────
    modifier onlyOwner() {
        if (msg.sender != owner && msg.sender != address(this)) {
            revert AccountErrors.NotOwner();
        }
        _;
    }

    modifier onlyOwnerOrEntryPoint() {
        if (msg.sender != owner && msg.sender != address(entryPoint()) && msg.sender != address(this)) {
            revert AccountErrors.NotOwnerOrEntryPoint();
        }
        _;
    }

    // ─── Constructor ────────────────────────────────────────────────────
    constructor(IEntryPoint anEntryPoint) {
        _entryPoint = anEntryPoint;
        _disableInitializers();
    }

    // ─── Initializer ────────────────────────────────────────────────────
    /**
     * @notice Initialize the smart account with an owner.
     * @param anOwner The EOA owner of this account.
     */
    function initialize(address anOwner) public virtual initializer {
        if (anOwner == address(0)) revert AccountErrors.ZeroAddress();
        owner = anOwner;
        emit SmartAccountInitialized(_entryPoint, anOwner);
    }

    // ─── BaseAccount overrides ──────────────────────────────────────────
    /// @inheritdoc BaseAccount
    function entryPoint() public view virtual override returns (IEntryPoint) {
        return _entryPoint;
    }

    /// @inheritdoc BaseAccount
    function _requireForExecute() internal view override virtual {
        if (msg.sender != address(entryPoint()) && msg.sender != owner) {
            revert AccountErrors.NotOwnerOrEntryPoint();
        }
    }

    /**
     * @dev Validates the UserOperation signature.
     *      First tries ECDSA recovery against the owner.
     *      Falls back to checking registered modules.
     */
    function _validateSignature(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash
    ) internal virtual override returns (uint256 validationData) {
        bytes32 ethSignedHash = userOpHash.toEthSignedMessageHash();
        address recovered = ethSignedHash.recover(userOp.signature);

        if (recovered == owner) {
            return SIG_VALIDATION_SUCCESS;
        }

        // Check if any registered module can validate
        // Module validation is handled by including module address in signature prefix
        // Format: abi.encodePacked(moduleAddress, moduleSignature)
        if (userOp.signature.length > 20) {
            address module = address(bytes20(userOp.signature[:20]));
            if (modules[module]) {
                // Delegate to module — module can implement its own validateSignature
                (bool success, bytes memory result) = module.staticcall(
                    abi.encodeWithSignature(
                        "validateSignature(address,bytes32,bytes)",
                        userOp.sender,
                        userOpHash,
                        userOp.signature[20:]
                    )
                );
                if (success && result.length >= 32) {
                    return abi.decode(result, (uint256));
                }
            }
        }

        return SIG_VALIDATION_FAILED;
    }

    // ─── Module Management ──────────────────────────────────────────────
    /**
     * @notice Enable a validation module.
     * @param module Address of the module contract.
     */
    function enableModule(address module) external onlyOwner {
        if (module == address(0)) revert AccountErrors.ZeroAddress();
        if (module == address(this)) revert AccountErrors.InvalidModule();
        modules[module] = true;
        emit ModuleEnabled(module);
    }

    /**
     * @notice Disable a validation module.
     * @param module Address of the module contract.
     */
    function disableModule(address module) external onlyOwner {
        modules[module] = false;
        emit ModuleDisabled(module);
    }

    // ─── Owner Management ───────────────────────────────────────────────
    /**
     * @notice Transfer ownership of the account.
     * @param newOwner The new owner address.
     */
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert AccountErrors.ZeroAddress();
        address prev = owner;
        owner = newOwner;
        emit OwnerChanged(prev, newOwner);
    }

    // ─── Deposits ───────────────────────────────────────────────────────
    /**
     * @notice Check the account's deposit in the EntryPoint.
     */
    function getDeposit() public view returns (uint256) {
        return entryPoint().balanceOf(address(this));
    }

    /**
     * @notice Add deposit to the EntryPoint for this account.
     */
    function addDeposit() public payable {
        entryPoint().depositTo{value: msg.value}(address(this));
    }

    /**
     * @notice Withdraw deposit from the EntryPoint.
     * @param withdrawAddress Target to send withdrawn ETH.
     * @param amount Amount to withdraw.
     */
    function withdrawDepositTo(address payable withdrawAddress, uint256 amount) public onlyOwner {
        if (withdrawAddress == address(0)) revert AccountErrors.ZeroAddress();
        entryPoint().withdrawTo(withdrawAddress, amount);
    }

    // ─── Batch Override ─────────────────────────────────────────────────
    /**
     * @notice Override executeBatch to reject empty batches.
     */
    function executeBatch(Call[] calldata calls) external virtual override {
        _requireForExecute();
        if (calls.length == 0) revert AccountErrors.EmptyBatch();

        uint256 callsLength = calls.length;
        for (uint256 i = 0; i < callsLength; i++) {
            Call calldata call1 = calls[i];
            bool ok = _executeCall(call1.target, call1.value, call1.data);
            if (!ok) {
                if (callsLength == 1) {
                    _revertWithData();
                } else {
                    revert ExecuteError(i, _getReturnData());
                }
            }
        }
    }

    function _executeCall(address target, uint256 value, bytes calldata data) internal returns (bool) {
        (bool success, ) = target.call{value: value}(data);
        return success;
    }

    function _revertWithData() internal pure {
        assembly {
            let size := returndatasize()
            returndatacopy(0, 0, size)
            revert(0, size)
        }
    }

    function _getReturnData() internal pure returns (bytes memory) {
        bytes memory returnData;
        assembly {
            let size := returndatasize()
            returnData := mload(0x40)
            mstore(returnData, size)
            returndatacopy(add(returnData, 0x20), 0, size)
            mstore(0x40, add(returnData, add(0x20, size)))
        }
        return returnData;
    }

    // ─── UUPS ───────────────────────────────────────────────────────────
    function _authorizeUpgrade(address newImplementation) internal view override {
        (newImplementation);
        if (msg.sender != owner) revert AccountErrors.NotOwner();
    }

    // ─── Receive ETH ────────────────────────────────────────────────────
    receive() external payable {}
}
