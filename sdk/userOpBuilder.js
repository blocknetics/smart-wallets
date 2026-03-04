const { ethers } = require("ethers");

/**
 * @module userOpBuilder
 * @description Utilities for building, hashing, and signing ERC-4337 UserOperations.
 */

/**
 * Pack two uint128 values into a bytes32.
 * Used for accountGasLimits and gasFees fields.
 * @param {bigint} high - Upper 128-bit value.
 * @param {bigint} low  - Lower 128-bit value.
 * @returns {string} bytes32 hex string.
 */
function packUints(high, low) {
    return ethers.zeroPadValue(
        ethers.toBeHex((BigInt(high) << 128n) | BigInt(low)),
        32
    );
}

/**
 * Build a PackedUserOperation with sensible defaults.
 * @param {Object} params - UserOp fields.
 * @param {string} params.sender - Smart account address.
 * @param {bigint|number} [params.nonce=0] - Account nonce.
 * @param {string} [params.initCode="0x"] - Account init code (for first-time deployment).
 * @param {string} [params.callData="0x"] - Encoded execution call data.
 * @param {bigint} [params.verificationGasLimit=200000n] - Gas for validation.
 * @param {bigint} [params.callGasLimit=100000n] - Gas for execution.
 * @param {bigint} [params.preVerificationGas=50000n] - Gas for pre-verification overhead.
 * @param {bigint} [params.maxFeePerGas=1000000000n] - Max fee per gas (1 gwei default).
 * @param {bigint} [params.maxPriorityFeePerGas=1000000000n] - Max priority fee.
 * @param {string} [params.paymasterAndData="0x"] - Paymaster data.
 * @param {string} [params.signature="0x"] - Placeholder signature.
 * @returns {Object} A PackedUserOperation object.
 */
function buildUserOp({
    sender,
    nonce = 0n,
    initCode = "0x",
    callData = "0x",
    verificationGasLimit = 200000n,
    callGasLimit = 100000n,
    preVerificationGas = 50000n,
    maxFeePerGas = 1000000000n,
    maxPriorityFeePerGas = 1000000000n,
    paymasterAndData = "0x",
    signature = "0x",
}) {
    return {
        sender,
        nonce: BigInt(nonce),
        initCode,
        callData,
        accountGasLimits: packUints(verificationGasLimit, callGasLimit),
        preVerificationGas: BigInt(preVerificationGas),
        gasFees: packUints(maxPriorityFeePerGas, maxFeePerGas),
        paymasterAndData,
        signature,
    };
}

/**
 * Compute the UserOperation hash (matching EntryPoint's getUserOpHash).
 * @param {Object} userOp - The PackedUserOperation.
 * @param {string} entryPointAddress - The EntryPoint contract address.
 * @param {number|bigint} chainId - The chain ID.
 * @returns {string} The UserOp hash (bytes32).
 */
function getUserOpHash(userOp, entryPointAddress, chainId) {
    // Encode the UserOp fields (matching UserOperationLib.encode)
    const packedOpHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
            [
                "bytes32",  // PACKED_USEROP_TYPEHASH
                "address",  // sender
                "uint256",  // nonce
                "bytes32",  // keccak256(initCode)
                "bytes32",  // keccak256(callData)
                "bytes32",  // accountGasLimits
                "uint256",  // preVerificationGas
                "bytes32",  // gasFees
                "bytes32",  // keccak256(paymasterAndData)
            ],
            [
                ethers.keccak256(
                    ethers.toUtf8Bytes(
                        "PackedUserOperation(address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData)"
                    )
                ),
                userOp.sender,
                userOp.nonce,
                ethers.keccak256(userOp.initCode),
                ethers.keccak256(userOp.callData),
                userOp.accountGasLimits,
                userOp.preVerificationGas,
                userOp.gasFees,
                ethers.keccak256(userOp.paymasterAndData),
            ]
        )
    );

    return ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
            ["bytes32", "address", "uint256"],
            [packedOpHash, entryPointAddress, chainId]
        )
    );
}

/**
 * Sign a UserOperation with an EOA signer.
 * @param {Object} userOp - The PackedUserOperation to sign.
 * @param {ethers.Signer} signer - An ethers.js Signer.
 * @param {string} entryPointAddress - The EntryPoint address.
 * @param {number|bigint} chainId - The chain ID.
 * @returns {Promise<Object>} The UserOp with signature field populated.
 */
async function signUserOp(userOp, signer, entryPointAddress, chainId) {
    const hash = getUserOpHash(userOp, entryPointAddress, chainId);
    const signature = await signer.signMessage(ethers.getBytes(hash));
    return { ...userOp, signature };
}

module.exports = {
    buildUserOp,
    getUserOpHash,
    signUserOp,
    packUints,
};
