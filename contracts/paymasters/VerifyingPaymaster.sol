// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/* solhint-disable reason-string */

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@account-abstraction/contracts/core/BasePaymaster.sol";
import "@account-abstraction/contracts/core/UserOperationLib.sol";
import "@account-abstraction/contracts/core/Helpers.sol";
import "../libraries/AccountErrors.sol";

/**
 * @title VerifyingPaymaster
 * @notice A paymaster that sponsors gas using off-chain signer authorization.
 * @dev A trusted off-chain signer signs a hash containing the UserOp details
 *      and a validity time window. The paymaster validates this signature
 *      on-chain before agreeing to pay.
 *
 *      paymasterAndData layout:
 *      ┌──────────┬────────────────────┬──────────────────┬──────────────┬───────────┐
 *      │ paymaster│ verificationGasLmt │ postOpGasLimit   │ paymasterData            │
 *      │ (20 B)   │ (16 B)             │ (16 B)           │ (variable)               │
 *      └──────────┴────────────────────┴──────────────────┴──────────────┴───────────┘
 *
 *      paymasterData layout:
 *      ┌──────────────┬──────────────┬─────────────────────────────────────┐
 *      │ validUntil   │ validAfter   │ signature (65 bytes)               │
 *      │ (6 bytes)    │ (6 bytes)    │                                     │
 *      └──────────────┴──────────────┴─────────────────────────────────────┘
 */
contract VerifyingPaymaster is BasePaymaster {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;
    using UserOperationLib for PackedUserOperation;

    /// @notice The trusted off-chain signer
    address public verifyingSigner;

    event SignerChanged(address indexed previousSigner, address indexed newSigner);

    constructor(
        IEntryPoint _entryPoint,
        address _verifyingSigner
    ) BasePaymaster(_entryPoint) {
        if (_verifyingSigner == address(0)) revert AccountErrors.ZeroAddress();
        verifyingSigner = _verifyingSigner;
    }

    /**
     * @notice Update the verifying signer.
     * @param _newSigner The new signer address.
     */
    function setSigner(address _newSigner) external onlyOwner {
        if (_newSigner == address(0)) revert AccountErrors.ZeroAddress();
        address prev = verifyingSigner;
        verifyingSigner = _newSigner;
        emit SignerChanged(prev, _newSigner);
    }

    /**
     * @notice Compute the hash that the signer must sign off-chain.
     * @param userOp The PackedUserOperation (paymasterAndData only includes paymaster + gas limits, no signature).
     * @param validUntil Last timestamp this signature is valid.
     * @param validAfter First timestamp this signature is valid.
     * @return The hash to be signed.
     */
    function getHash(
        PackedUserOperation calldata userOp,
        uint48 validUntil,
        uint48 validAfter
    ) public view returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    userOp.sender,
                    userOp.nonce,
                    keccak256(userOp.initCode),
                    keccak256(userOp.callData),
                    userOp.accountGasLimits,
                    userOp.preVerificationGas,
                    userOp.gasFees,
                    block.chainid,
                    address(this),
                    validUntil,
                    validAfter
                )
            );
    }

    /**
     * @dev Validates the paymaster signature.
     *      Extracts validUntil, validAfter, and signature from paymasterData.
     */
    function _validatePaymasterUserOp(
        PackedUserOperation calldata userOp,
        bytes32 /*userOpHash*/,
        uint256 /*maxCost*/
    ) internal view override returns (bytes memory context, uint256 validationData) {
        bytes calldata paymasterData = userOp.paymasterAndData[PAYMASTER_DATA_OFFSET:];

        // Extract time bounds and signature
        uint48 validUntil = uint48(bytes6(paymasterData[:6]));
        uint48 validAfter = uint48(bytes6(paymasterData[6:12]));
        bytes calldata signature = paymasterData[12:];

        // Compute and verify the hash
        bytes32 hash = getHash(userOp, validUntil, validAfter);
        bytes32 ethSignedHash = hash.toEthSignedMessageHash();

        if (verifyingSigner != ethSignedHash.recover(signature)) {
            return ("", _packValidationData(true, validUntil, validAfter));
        }

        return ("", _packValidationData(false, validUntil, validAfter));
    }
}
