const { ethers } = require("ethers");

/**
 * @module bundlerClient
 * @description Client for interacting with an ERC-4337 Bundler via JSON-RPC.
 */

class BundlerClient {
    /**
     * @param {string} bundlerUrl - The bundler's JSON-RPC endpoint URL.
     */
    constructor(bundlerUrl) {
        this.provider = new ethers.JsonRpcProvider(bundlerUrl);
    }

    /**
     * Send a UserOperation to the bundler.
     * @param {Object} userOp - Packed UserOperation.
     * @param {string} entryPointAddress - The EntryPoint address.
     * @returns {Promise<string>} The UserOperation hash.
     */
    async sendUserOperation(userOp, entryPointAddress) {
        const formattedOp = this._formatUserOp(userOp);
        return this.provider.send("eth_sendUserOperation", [
            formattedOp,
            entryPointAddress,
        ]);
    }

    /**
     * Estimate gas for a UserOperation.
     * @param {Object} userOp - Packed UserOperation.
     * @param {string} entryPointAddress - The EntryPoint address.
     * @returns {Promise<Object>} Gas estimates with preVerificationGas, verificationGasLimit, callGasLimit.
     */
    async estimateUserOperationGas(userOp, entryPointAddress) {
        const formattedOp = this._formatUserOp(userOp);
        return this.provider.send("eth_estimateUserOperationGas", [
            formattedOp,
            entryPointAddress,
        ]);
    }

    /**
     * Get the receipt for a UserOperation.
     * @param {string} userOpHash - The UserOp hash returned by sendUserOperation.
     * @returns {Promise<Object|null>} The receipt, or null if not yet mined.
     */
    async getUserOperationReceipt(userOpHash) {
        return this.provider.send("eth_getUserOperationReceipt", [userOpHash]);
    }

    /**
     * Get a UserOperation by its hash.
     * @param {string} userOpHash - The UserOp hash.
     * @returns {Promise<Object|null>} The UserOperation object.
     */
    async getUserOperationByHash(userOpHash) {
        return this.provider.send("eth_getUserOperationByHash", [userOpHash]);
    }

    /**
     * Get the list of supported EntryPoint addresses.
     * @returns {Promise<string[]>} Array of EntryPoint addresses.
     */
    async supportedEntryPoints() {
        return this.provider.send("eth_supportedEntryPoints", []);
    }

    /**
     * Wait for a UserOperation receipt by polling.
     * @param {string} userOpHash - The UserOp hash.
     * @param {number} [timeout=60000] - Timeout in milliseconds.
     * @param {number} [interval=3000] - Polling interval in milliseconds.
     * @returns {Promise<Object>} The receipt.
     */
    async waitForUserOperationReceipt(
        userOpHash,
        timeout = 60000,
        interval = 3000
    ) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            const receipt = await this.getUserOperationReceipt(userOpHash);
            if (receipt) return receipt;
            await new Promise((resolve) => setTimeout(resolve, interval));
        }
        throw new Error(
            `Timed out waiting for UserOperation receipt: ${userOpHash}`
        );
    }

    /**
     * Format a UserOp for JSON-RPC (convert BigInts to hex strings).
     * @private
     */
    _formatUserOp(userOp) {
        return {
            sender: userOp.sender,
            nonce: ethers.toBeHex(userOp.nonce),
            initCode: userOp.initCode,
            callData: userOp.callData,
            accountGasLimits: userOp.accountGasLimits,
            preVerificationGas: ethers.toBeHex(userOp.preVerificationGas),
            gasFees: userOp.gasFees,
            paymasterAndData: userOp.paymasterAndData,
            signature: userOp.signature,
        };
    }
}

module.exports = { BundlerClient };
