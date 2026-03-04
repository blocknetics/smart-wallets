const { ethers } = require("ethers");

/**
 * @module paymasterClient
 * @description Utilities for generating VerifyingPaymaster signatures and encoding paymaster data.
 */

/**
 * Sign paymaster data for a VerifyingPaymaster.
 * The signer authorizes gas sponsorship for a specific UserOp within a time window.
 *
 * @param {Object} params - Parameters.
 * @param {Object} params.userOp - The PackedUserOperation.
 * @param {ethers.Signer} params.signer - The paymaster's authorized signer.
 * @param {string} params.paymasterAddress - The paymaster contract address.
 * @param {number} params.validUntil - Last timestamp this sponsorship is valid.
 * @param {number} params.validAfter - First timestamp this sponsorship is valid.
 * @param {number|bigint} params.chainId - The chain ID.
 * @returns {Promise<string>} The 65-byte ECDSA signature.
 */
async function signPaymasterData({
    userOp,
    signer,
    paymasterAddress,
    validUntil,
    validAfter,
    chainId,
}) {
    // This hash must match VerifyingPaymaster.getHash()
    const hash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
            [
                "address",   // sender
                "uint256",   // nonce
                "bytes32",   // keccak256(initCode)
                "bytes32",   // keccak256(callData)
                "bytes32",   // accountGasLimits
                "uint256",   // preVerificationGas
                "bytes32",   // gasFees
                "uint256",   // chainId
                "address",   // paymasterAddress
                "uint48",    // validUntil
                "uint48",    // validAfter
            ],
            [
                userOp.sender,
                userOp.nonce,
                ethers.keccak256(userOp.initCode),
                ethers.keccak256(userOp.callData),
                userOp.accountGasLimits,
                userOp.preVerificationGas,
                userOp.gasFees,
                chainId,
                paymasterAddress,
                validUntil,
                validAfter,
            ]
        )
    );

    return signer.signMessage(ethers.getBytes(hash));
}

/**
 * Encode paymaster data for the paymasterAndData field.
 * Layout: paymasterAddress(20) + verificationGasLimit(16) + postOpGasLimit(16) + validUntil(6) + validAfter(6) + signature(65)
 *
 * @param {Object} params - Parameters.
 * @param {string} params.paymasterAddress - The paymaster contract address.
 * @param {bigint} params.paymasterVerificationGasLimit - Gas limit for paymaster verification.
 * @param {bigint} params.paymasterPostOpGasLimit - Gas limit for postOp.
 * @param {number} params.validUntil - Expiry timestamp.
 * @param {number} params.validAfter - Start timestamp.
 * @param {string} params.signature - The 65-byte signature hex string.
 * @returns {string} The encoded paymasterAndData hex string.
 */
function encodePaymasterData({
    paymasterAddress,
    paymasterVerificationGasLimit = 100000n,
    paymasterPostOpGasLimit = 50000n,
    validUntil,
    validAfter,
    signature,
}) {
    // Pack paymaster static fields
    const pmAddress = paymasterAddress.toLowerCase();
    const verGas = ethers.zeroPadValue(ethers.toBeHex(paymasterVerificationGasLimit), 16);
    const postGas = ethers.zeroPadValue(ethers.toBeHex(paymasterPostOpGasLimit), 16);

    // Pack time bounds (6 bytes each)
    const validUntilHex = ethers.zeroPadValue(ethers.toBeHex(validUntil), 6);
    const validAfterHex = ethers.zeroPadValue(ethers.toBeHex(validAfter), 6);

    return ethers.concat([
        pmAddress,
        verGas,
        postGas,
        validUntilHex,
        validAfterHex,
        signature,
    ]);
}

module.exports = {
    signPaymasterData,
    encodePaymasterData,
};
