/**
 * @module sdk
 * @description ERC-4337 Account Abstraction SDK
 *
 * Provides utilities for building UserOperations, interacting with bundlers,
 * managing smart accounts, and handling paymaster signatures.
 */

const { buildUserOp, getUserOpHash, signUserOp, packUints } = require("./userOpBuilder");
const { BundlerClient } = require("./bundlerClient");
const { signPaymasterData, encodePaymasterData } = require("./paymasterClient");
const {
    getSmartAccountAddress,
    encodeExecute,
    encodeExecuteBatch,
    getInitCode,
    encodeEnableModule,
    encodeTransferOwnership,
} = require("./accountClient");

module.exports = {
    // UserOp Builder
    buildUserOp,
    getUserOpHash,
    signUserOp,
    packUints,

    // Bundler Client
    BundlerClient,

    // Paymaster Client
    signPaymasterData,
    encodePaymasterData,

    // Account Client
    getSmartAccountAddress,
    encodeExecute,
    encodeExecuteBatch,
    getInitCode,
    encodeEnableModule,
    encodeTransferOwnership,
};
