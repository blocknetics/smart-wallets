const { ethers } = require("ethers");

/**
 * @module accountClient
 * @description Utilities for interacting with SmartAccount contracts.
 */

/**
 * Predict the counterfactual address of a SmartAccount before deployment.
 * @param {ethers.Contract} factory - The SmartAccountFactory contract instance.
 * @param {string} owner - The account owner address.
 * @param {bigint|number} salt - The CREATE2 salt.
 * @returns {Promise<string>} The predicted account address.
 */
async function getSmartAccountAddress(factory, owner, salt) {
    return factory.computeAddress(owner, salt);
}

/**
 * Encode a single `execute(target, value, data)` call for a SmartAccount.
 * @param {string} target - Target contract address.
 * @param {bigint|number} value - ETH value to send.
 * @param {string} data - Encoded function call data.
 * @returns {string} ABI-encoded calldata for SmartAccount.execute().
 */
function encodeExecute(target, value, data) {
    const iface = new ethers.Interface([
        "function execute(address target, uint256 value, bytes data)",
    ]);
    return iface.encodeFunctionData("execute", [target, value, data]);
}

/**
 * Encode a batch `executeBatch(calls)` call for a SmartAccount.
 * @param {Array<{target: string, value: bigint|number, data: string}>} calls - Array of calls.
 * @returns {string} ABI-encoded calldata for SmartAccount.executeBatch().
 */
function encodeExecuteBatch(calls) {
    const iface = new ethers.Interface([
        "function executeBatch((address target, uint256 value, bytes data)[] calls)",
    ]);
    return iface.encodeFunctionData("executeBatch", [calls]);
}

/**
 * Generate the initCode for first-time account deployment via a factory.
 * The initCode is: factory address + encoded createAccount(owner, salt) call.
 *
 * @param {string} factoryAddress - The SmartAccountFactory address.
 * @param {string} owner - The account owner address.
 * @param {bigint|number} salt - The CREATE2 salt.
 * @returns {string} The initCode hex string.
 */
function getInitCode(factoryAddress, owner, salt) {
    const iface = new ethers.Interface([
        "function createAccount(address owner, uint256 salt)",
    ]);
    const callData = iface.encodeFunctionData("createAccount", [owner, salt]);
    return ethers.concat([factoryAddress, callData]);
}

/**
 * Encode a module enable call.
 * @param {string} moduleAddress - The module to enable.
 * @returns {string} ABI-encoded calldata for SmartAccount.enableModule().
 */
function encodeEnableModule(moduleAddress) {
    const iface = new ethers.Interface([
        "function enableModule(address module)",
    ]);
    return iface.encodeFunctionData("enableModule", [moduleAddress]);
}

/**
 * Encode a transfer ownership call.
 * @param {string} newOwner - New owner address.
 * @returns {string} ABI-encoded calldata for SmartAccount.transferOwnership().
 */
function encodeTransferOwnership(newOwner) {
    const iface = new ethers.Interface([
        "function transferOwnership(address newOwner)",
    ]);
    return iface.encodeFunctionData("transferOwnership", [newOwner]);
}

module.exports = {
    getSmartAccountAddress,
    encodeExecute,
    encodeExecuteBatch,
    getInitCode,
    encodeEnableModule,
    encodeTransferOwnership,
};
