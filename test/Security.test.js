const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * Security & Vulnerability Tests
 *
 * Comprehensive tests covering attack vectors across all contracts:
 * - SmartAccount: batch guards, module spoofing, upgrade auth, reentrancy
 * - SmartAccountFactory: zero-address, deterministic idempotency
 * - SessionKeyModule: zero-key, time bounds, duplicate, cross-account
 * - SocialRecoveryModule: self-guardian, max cap, re-initiate, time-lock
 * - TokenPaymaster: config validation, withdraw guard
 * - VerifyingPaymaster: signer impersonation, time bounds
 */
describe("Security & Vulnerability Tests", function () {
    let entryPoint, factory, account;
    let owner, addr1, addr2, addr3;

    beforeEach(async function () {
        [owner, addr1, addr2, addr3] = await ethers.getSigners();

        const EntryPointSimulator = await ethers.getContractFactory("EntryPointSimulator");
        entryPoint = await EntryPointSimulator.deploy();

        const SmartAccountFactory = await ethers.getContractFactory("SmartAccountFactory");
        factory = await SmartAccountFactory.deploy(await entryPoint.getAddress());

        const tx = await factory.createAccount(owner.address, 0);
        await tx.wait();
        const accountAddress = await factory.computeAddress(owner.address, 0);
        account = await ethers.getContractAt("SmartAccount", accountAddress);

        await owner.sendTransaction({ to: accountAddress, value: ethers.parseEther("5") });
    });

    // ═══════════════════════════════════════════════════════════
    //  SMART ACCOUNT — Security
    // ═══════════════════════════════════════════════════════════
    describe("SmartAccount — Security", function () {
        it("should reject empty batch execution", async function () {
            await expect(
                account.executeBatch([])
            ).to.be.revertedWithCustomError(account, "EmptyBatch");
        });

        it("should reject enabling self as a module", async function () {
            const accountAddr = await account.getAddress();
            await expect(
                account.enableModule(accountAddr)
            ).to.be.revertedWithCustomError(account, "InvalidModule");
        });

        it("should reject enabling zero-address module", async function () {
            await expect(
                account.enableModule(ethers.ZeroAddress)
            ).to.be.revertedWithCustomError(account, "ZeroAddress");
        });

        it("should reject withdrawDepositTo zero address", async function () {
            await account.addDeposit({ value: ethers.parseEther("0.1") });
            await expect(
                account.withdrawDepositTo(ethers.ZeroAddress, ethers.parseEther("0.05"))
            ).to.be.revertedWithCustomError(account, "ZeroAddress");
        });

        it("should reject unregistered module in signature validation", async function () {
            const accountAddr = await account.getAddress();
            const epAddr = await entryPoint.getAddress();

            const userOp = {
                sender: accountAddr,
                nonce: 0n,
                initCode: "0x",
                callData: "0x",
                accountGasLimits: ethers.zeroPadValue(ethers.toBeHex((200000n << 128n) | 100000n), 32),
                preVerificationGas: 50000n,
                gasFees: ethers.zeroPadValue(ethers.toBeHex((1000000000n << 128n) | 1000000000n), 32),
                paymasterAndData: "0x",
                signature: "0x",
            };

            // Use an unregistered module address as prefix
            const fakeModuleAddr = addr2.address;
            const userOpHash = await entryPoint.getUserOpHash(userOp);
            const signature = await addr2.signMessage(ethers.getBytes(userOpHash));

            // Combine: moduleAddress (20 bytes) + actual signature
            userOp.signature = ethers.concat([fakeModuleAddr, signature]);

            // Should fail validation (unregistered module)
            await expect(
                entryPoint.handleOps([userOp], owner.address)
            ).to.be.reverted;
        });

        it("should reject re-initialization (double init)", async function () {
            await expect(
                account.initialize(addr1.address)
            ).to.be.revertedWithCustomError(account, "InvalidInitialization");
        });

        it("should reject upgrade from non-owner", async function () {
            // Deploy a new implementation
            const SmartAccount = await ethers.getContractFactory("SmartAccount");
            const newImpl = await SmartAccount.deploy(await entryPoint.getAddress());

            await expect(
                account.connect(addr1).upgradeToAndCall(await newImpl.getAddress(), "0x")
            ).to.be.reverted;
        });

        it("should preserve balance after self-transfer via execute", async function () {
            const accountAddr = await account.getAddress();
            const balanceBefore = await ethers.provider.getBalance(accountAddr);

            await account.execute(accountAddr, ethers.parseEther("1"), "0x");

            const balanceAfter = await ethers.provider.getBalance(accountAddr);
            expect(balanceAfter).to.equal(balanceBefore);
        });

        it("should handle single-call batch that fails (revert propagation)", async function () {
            // Try to send more ETH than the account has
            const calls = [
                { target: addr1.address, value: ethers.parseEther("1000"), data: "0x" },
            ];

            await expect(
                account.executeBatch(calls)
            ).to.be.reverted;
        });

        it("should revert with ExecuteError for multi-call batch failure", async function () {
            const calls = [
                { target: addr1.address, value: ethers.parseEther("0.1"), data: "0x" },
                { target: addr1.address, value: ethers.parseEther("1000"), data: "0x" }, // fails
            ];

            await expect(
                account.executeBatch(calls)
            ).to.be.revertedWithCustomError(account, "ExecuteError");
        });

        it("should allow owner to withdraw ETH via execute", async function () {
            const balanceBefore = await ethers.provider.getBalance(addr1.address);
            await account.execute(addr1.address, ethers.parseEther("1"), "0x");
            const balanceAfter = await ethers.provider.getBalance(addr1.address);
            expect(balanceAfter - balanceBefore).to.equal(ethers.parseEther("1"));
        });
    });

    // ═══════════════════════════════════════════════════════════
    //  SMART ACCOUNT FACTORY — Security
    // ═══════════════════════════════════════════════════════════
    describe("SmartAccountFactory — Security", function () {
        it("should reject creating account with zero-address owner", async function () {
            await expect(
                factory.createAccount(ethers.ZeroAddress, 0)
            ).to.be.revertedWithCustomError(factory, "ZeroAddress");
        });

        it("should be idempotent for duplicate creates (no revert)", async function () {
            const addr = await factory.computeAddress(owner.address, 0);
            // Account already exists from beforeEach — should return same address
            const tx = await factory.createAccount(owner.address, 0);
            await tx.wait();
            const addr2 = await factory.computeAddress(owner.address, 0);
            expect(addr).to.equal(addr2);
        });
    });

    // ═══════════════════════════════════════════════════════════
    //  SESSION KEY MODULE — Security
    // ═══════════════════════════════════════════════════════════
    describe("SessionKeyModule — Security", function () {
        let sessionModule;

        beforeEach(async function () {
            const SessionKeyModule = await ethers.getContractFactory("SessionKeyModule");
            sessionModule = await SessionKeyModule.deploy();
        });

        it("should reject zero-address session key", async function () {
            const now = Math.floor(Date.now() / 1000);
            await expect(
                sessionModule.registerSessionKey(ethers.ZeroAddress, now, now + 3600, [])
            ).to.be.revertedWithCustomError(sessionModule, "ZeroAddress");
        });

        it("should reject invalid time window (validUntil <= validAfter)", async function () {
            const now = Math.floor(Date.now() / 1000);
            await expect(
                sessionModule.registerSessionKey(addr1.address, now + 3600, now, [])
            ).to.be.revertedWithCustomError(sessionModule, "InvalidSessionKeyTime");
        });

        it("should reject equal time window (validUntil == validAfter)", async function () {
            const now = Math.floor(Date.now() / 1000);
            await expect(
                sessionModule.registerSessionKey(addr1.address, now, now, [])
            ).to.be.revertedWithCustomError(sessionModule, "InvalidSessionKeyTime");
        });

        it("should reject duplicate active session key registration", async function () {
            const now = Math.floor(Date.now() / 1000);
            await sessionModule.registerSessionKey(addr1.address, now, now + 3600, []);

            await expect(
                sessionModule.registerSessionKey(addr1.address, now, now + 7200, [])
            ).to.be.revertedWithCustomError(sessionModule, "SessionKeyAlreadyActive");
        });

        it("should allow re-registration after revocation", async function () {
            const now = Math.floor(Date.now() / 1000);
            await sessionModule.registerSessionKey(addr1.address, now, now + 3600, []);
            await sessionModule.revokeSessionKey(addr1.address);

            // After revocation, re-registration should work
            await expect(
                sessionModule.registerSessionKey(addr1.address, now, now + 7200, [])
            ).to.not.be.reverted;
        });

        it("should not allow cross-account session key validation", async function () {
            const now = Math.floor(Date.now() / 1000);
            // Register session key on owner's account
            await sessionModule.registerSessionKey(addr1.address, now, now + 3600, [addr2.address]);

            // addr1 should not be allowed on addr2's account
            expect(
                await sessionModule.isAllowed(addr2.address, addr1.address, addr2.address)
            ).to.be.false;
        });
    });

    // ═══════════════════════════════════════════════════════════
    //  SOCIAL RECOVERY — Security
    // ═══════════════════════════════════════════════════════════
    describe("SocialRecoveryModule — Security", function () {
        let recovery;
        const accountAddr = "0x0000000000000000000000000000000000000001"; // placeholder

        beforeEach(async function () {
            const SocialRecoveryModule = await ethers.getContractFactory("SocialRecoveryModule");
            recovery = await SocialRecoveryModule.deploy();
        });

        it("should reject adding self as guardian", async function () {
            await expect(
                recovery.addGuardian(owner.address)
            ).to.be.revertedWithCustomError(recovery, "SelfGuardian");
        });

        it("should reject exceeding max guardian limit", async function () {
            // Add 10 guardians (the max)
            const signers = await ethers.getSigners();
            for (let i = 1; i <= 10; i++) {
                await recovery.addGuardian(signers[i].address);
            }

            // 11th should fail
            const extra = ethers.Wallet.createRandom();
            await expect(
                recovery.addGuardian(extra.address)
            ).to.be.revertedWithCustomError(recovery, "MaxGuardiansReached");
        });

        it("should clear confirmations when recovery is re-initiated", async function () {
            // Setup: owner adds guardians, sets threshold
            await recovery.addGuardian(addr1.address);
            await recovery.addGuardian(addr2.address);
            await recovery.setThreshold(2);

            // addr1 initiates recovery
            await recovery.connect(addr1).initiateRecovery(owner.address, addr3.address);

            // addr2 confirms
            await recovery.connect(addr2).confirmRecovery(owner.address);

            // Now addr1 re-initiates with a different newOwner — should clear confirmations
            await recovery.connect(addr1).initiateRecovery(owner.address, addr2.address);

            // addr2's previous confirmation should be cleared
            const req = await recovery.getRecoveryRequest(owner.address);
            expect(req.confirmations).to.equal(1n); // Only the initiator's
        });

        it("should clean state after cancellation", async function () {
            await recovery.addGuardian(addr1.address);
            await recovery.setThreshold(1);

            await recovery.connect(addr1).initiateRecovery(owner.address, addr2.address);

            // Owner cancels
            await recovery.cancelRecovery();

            const req = await recovery.getRecoveryRequest(owner.address);
            expect(req.active).to.be.false;
        });

        it("should adjust threshold when guardian removed below threshold", async function () {
            await recovery.addGuardian(addr1.address);
            await recovery.addGuardian(addr2.address);
            await recovery.setThreshold(2);

            // Remove a guardian — threshold should auto-adjust
            await recovery.removeGuardian(addr2.address);
            expect(await recovery.threshold(owner.address)).to.equal(1n);
        });

        it("should reject confirmation from non-guardian", async function () {
            await recovery.addGuardian(addr1.address);
            await recovery.setThreshold(1);

            await recovery.connect(addr1).initiateRecovery(owner.address, addr2.address);

            await expect(
                recovery.connect(addr3).confirmRecovery(owner.address)
            ).to.be.revertedWithCustomError(recovery, "GuardianNotFound");
        });
    });

    // ═══════════════════════════════════════════════════════════
    //  TOKEN PAYMASTER — Security
    // ═══════════════════════════════════════════════════════════
    describe("TokenPaymaster — Security", function () {
        let paymaster, mockToken, mockOracle;

        beforeEach(async function () {
            const MockERC20 = await ethers.getContractFactory("MockERC20");
            mockToken = await MockERC20.deploy("Test", "TST", 18);

            const MockOracle = await ethers.getContractFactory("MockOracle");
            mockOracle = await MockOracle.deploy(ethers.parseEther("2000"));

            const TokenPaymaster = await ethers.getContractFactory("TokenPaymaster");
            paymaster = await TokenPaymaster.deploy(
                await entryPoint.getAddress(),
                await mockToken.getAddress(),
                await mockOracle.getAddress(),
                11000 // 10% markup
            );
        });

        it("should reject config with zero-address token", async function () {
            await expect(
                paymaster.setConfig(ethers.ZeroAddress, await mockOracle.getAddress(), 11000)
            ).to.be.revertedWithCustomError(paymaster, "InvalidTokenOrOracle");
        });

        it("should reject config with zero-address oracle", async function () {
            await expect(
                paymaster.setConfig(await mockToken.getAddress(), ethers.ZeroAddress, 11000)
            ).to.be.revertedWithCustomError(paymaster, "InvalidTokenOrOracle");
        });

        it("should reject config with zero markup", async function () {
            await expect(
                paymaster.setConfig(await mockToken.getAddress(), await mockOracle.getAddress(), 0)
            ).to.be.revertedWithCustomError(paymaster, "InvalidMarkup");
        });

        it("should reject config with excessive markup (>200%)", async function () {
            await expect(
                paymaster.setConfig(await mockToken.getAddress(), await mockOracle.getAddress(), 20001)
            ).to.be.revertedWithCustomError(paymaster, "InvalidMarkup");
        });

        it("should accept config with valid markup at boundary (200%)", async function () {
            await expect(
                paymaster.setConfig(await mockToken.getAddress(), await mockOracle.getAddress(), 20000)
            ).to.not.be.reverted;
        });

        it("should reject withdrawTokens to zero address", async function () {
            await expect(
                paymaster.withdrawTokens(ethers.ZeroAddress, 100)
            ).to.be.revertedWithCustomError(paymaster, "ZeroAddress");
        });

        it("should reject config update from non-owner", async function () {
            await expect(
                paymaster.connect(addr1).setConfig(
                    await mockToken.getAddress(),
                    await mockOracle.getAddress(),
                    11000
                )
            ).to.be.revertedWithCustomError(paymaster, "OwnableUnauthorizedAccount");
        });
    });

    // ═══════════════════════════════════════════════════════════
    //  VERIFYING PAYMASTER — Security
    // ═══════════════════════════════════════════════════════════
    describe("VerifyingPaymaster — Security", function () {
        let paymaster;

        beforeEach(async function () {
            const VerifyingPaymaster = await ethers.getContractFactory("VerifyingPaymaster");
            paymaster = await VerifyingPaymaster.deploy(
                await entryPoint.getAddress(),
                owner.address
            );
            // Deposit ETH for the paymaster
            await paymaster.deposit({ value: ethers.parseEther("1") });
        });

        it("should reject zero-address signer on construction", async function () {
            const VerifyingPaymaster = await ethers.getContractFactory("VerifyingPaymaster");
            await expect(
                VerifyingPaymaster.deploy(await entryPoint.getAddress(), ethers.ZeroAddress)
            ).to.be.revertedWithCustomError(paymaster, "ZeroAddress");
        });

        it("should reject signer change to zero address", async function () {
            await expect(
                paymaster.setSigner(ethers.ZeroAddress)
            ).to.be.revertedWithCustomError(paymaster, "ZeroAddress");
        });

        it("should reject signer change from non-owner", async function () {
            await expect(
                paymaster.connect(addr1).setSigner(addr1.address)
            ).to.be.revertedWithCustomError(paymaster, "OwnableUnauthorizedAccount");
        });

        it("should produce consistent hashes for same inputs", async function () {
            const accountAddr = await account.getAddress();

            const userOp = {
                sender: accountAddr,
                nonce: 0n,
                initCode: "0x",
                callData: "0x",
                accountGasLimits: ethers.zeroPadValue(ethers.toBeHex((200000n << 128n) | 100000n), 32),
                preVerificationGas: 50000n,
                gasFees: ethers.zeroPadValue(ethers.toBeHex((1000000000n << 128n) | 1000000000n), 32),
                paymasterAndData: "0x",
                signature: "0x",
            };

            const hash1 = await paymaster.getHash(userOp, 1000, 0);
            const hash2 = await paymaster.getHash(userOp, 1000, 0);
            expect(hash1).to.equal(hash2);

            // Different time bounds should produce different hash
            const hash3 = await paymaster.getHash(userOp, 2000, 0);
            expect(hash1).to.not.equal(hash3);
        });
    });

    // ═══════════════════════════════════════════════════════════
    //  SIGNATURE REPLAY — ERC-4337
    // ═══════════════════════════════════════════════════════════
    describe("Signature Replay Prevention", function () {
        it("should produce different hashes for different nonces (replay protection)", async function () {
            const accountAddr = await account.getAddress();

            const baseOp = {
                sender: accountAddr,
                nonce: 0n,
                initCode: "0x",
                callData: "0x",
                accountGasLimits: ethers.zeroPadValue(ethers.toBeHex((200000n << 128n) | 100000n), 32),
                preVerificationGas: 50000n,
                gasFees: ethers.zeroPadValue(ethers.toBeHex((1000000000n << 128n) | 1000000000n), 32),
                paymasterAndData: "0x",
                signature: "0x",
            };

            const hash0 = await entryPoint.getUserOpHash(baseOp);

            // Same op with different nonce
            const op2 = { ...baseOp, nonce: 1n };
            const hash1 = await entryPoint.getUserOpHash(op2);

            // Hashes must differ — this is what prevents replay
            expect(hash0).to.not.equal(hash1);
        });

        it("should track nonces per account", async function () {
            const accountAddr = await account.getAddress();

            // Check initial nonce
            const nonce0 = await entryPoint.getNonce(accountAddr, 0);
            expect(nonce0).to.equal(0n);

            // Submit a UserOp
            const userOp = {
                sender: accountAddr,
                nonce: 0n,
                initCode: "0x",
                callData: "0x",
                accountGasLimits: ethers.zeroPadValue(ethers.toBeHex((200000n << 128n) | 100000n), 32),
                preVerificationGas: 50000n,
                gasFees: ethers.zeroPadValue(ethers.toBeHex((1000000000n << 128n) | 1000000000n), 32),
                paymasterAndData: "0x",
                signature: "0x",
            };

            const userOpHash = await entryPoint.getUserOpHash(userOp);
            userOp.signature = await owner.signMessage(ethers.getBytes(userOpHash));
            await entryPoint.handleOps([userOp], owner.address);

            // Nonce should have incremented
            const nonce1 = await entryPoint.getNonce(accountAddr, 0);
            expect(nonce1).to.equal(1n);
        });
    });
});
