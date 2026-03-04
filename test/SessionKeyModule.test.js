const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SessionKeyModule", function () {
    let sessionKeyModule;
    let owner, sessionKey, target1, target2;

    beforeEach(async function () {
        [owner, sessionKey, target1, target2] = await ethers.getSigners();

        const SessionKeyModule = await ethers.getContractFactory("SessionKeyModule");
        sessionKeyModule = await SessionKeyModule.deploy();
    });

    describe("Registration", function () {
        it("should register a session key with allowed targets", async function () {
            const validAfter = 0;
            const validUntil = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now

            await sessionKeyModule.registerSessionKey(
                sessionKey.address,
                validAfter,
                validUntil,
                [target1.address, target2.address]
            );

            const sk = await sessionKeyModule.sessionKeys(owner.address, sessionKey.address);
            expect(sk.active).to.be.true;
            expect(sk.validAfter).to.equal(validAfter);
            expect(sk.validUntil).to.equal(validUntil);

            expect(await sessionKeyModule.allowedContracts(owner.address, sessionKey.address, target1.address)).to.be.true;
            expect(await sessionKeyModule.allowedContracts(owner.address, sessionKey.address, target2.address)).to.be.true;
        });

        it("should emit SessionKeyRegistered event", async function () {
            const validAfter = 0;
            const validUntil = 100;

            await expect(
                sessionKeyModule.registerSessionKey(sessionKey.address, validAfter, validUntil, [])
            )
                .to.emit(sessionKeyModule, "SessionKeyRegistered")
                .withArgs(owner.address, sessionKey.address, validAfter, validUntil);
        });
    });

    describe("Revocation", function () {
        it("should revoke a session key", async function () {
            await sessionKeyModule.registerSessionKey(sessionKey.address, 0, 100, []);
            await sessionKeyModule.revokeSessionKey(sessionKey.address);

            const sk = await sessionKeyModule.sessionKeys(owner.address, sessionKey.address);
            expect(sk.active).to.be.false;
        });

        it("should emit SessionKeyRevoked event", async function () {
            await sessionKeyModule.registerSessionKey(sessionKey.address, 0, 100, []);
            await expect(sessionKeyModule.revokeSessionKey(sessionKey.address))
                .to.emit(sessionKeyModule, "SessionKeyRevoked")
                .withArgs(owner.address, sessionKey.address);
        });
    });

    describe("Allowed Contracts", function () {
        it("should add and remove allowed contracts", async function () {
            await sessionKeyModule.registerSessionKey(sessionKey.address, 0, 100, [target1.address]);

            expect(await sessionKeyModule.allowedContracts(owner.address, sessionKey.address, target1.address)).to.be.true;
            expect(await sessionKeyModule.allowedContracts(owner.address, sessionKey.address, target2.address)).to.be.false;

            await sessionKeyModule.setAllowedContract(sessionKey.address, target2.address, true);
            expect(await sessionKeyModule.allowedContracts(owner.address, sessionKey.address, target2.address)).to.be.true;

            await sessionKeyModule.setAllowedContract(sessionKey.address, target1.address, false);
            expect(await sessionKeyModule.allowedContracts(owner.address, sessionKey.address, target1.address)).to.be.false;
        });
    });

    describe("isAllowed", function () {
        it("should return true for active key with allowed target", async function () {
            await sessionKeyModule.registerSessionKey(sessionKey.address, 0, 100, [target1.address]);
            expect(await sessionKeyModule.isAllowed(owner.address, sessionKey.address, target1.address)).to.be.true;
        });

        it("should return false for inactive key", async function () {
            await sessionKeyModule.registerSessionKey(sessionKey.address, 0, 100, [target1.address]);
            await sessionKeyModule.revokeSessionKey(sessionKey.address);
            expect(await sessionKeyModule.isAllowed(owner.address, sessionKey.address, target1.address)).to.be.false;
        });

        it("should return false for disallowed target", async function () {
            await sessionKeyModule.registerSessionKey(sessionKey.address, 0, 100, [target1.address]);
            expect(await sessionKeyModule.isAllowed(owner.address, sessionKey.address, target2.address)).to.be.false;
        });
    });

    describe("Signature Validation", function () {
        it("should validate a signature from an active session key", async function () {
            const validAfter = 0;
            const validUntil = Math.floor(Date.now() / 1000) + 3600;

            await sessionKeyModule.registerSessionKey(sessionKey.address, validAfter, validUntil, []);

            // Create a mock userOpHash
            const userOpHash = ethers.keccak256(ethers.toUtf8Bytes("test-user-op"));
            const signature = await sessionKey.signMessage(ethers.getBytes(userOpHash));

            // Validate — should return packed validation data (not SIG_VALIDATION_FAILED)
            const validationData = await sessionKeyModule.validateSignature(
                owner.address,
                userOpHash,
                signature
            );

            // Check that it doesn't indicate failure (bit 0 = 0 means success)
            const sigFailed = validationData & 1n;
            expect(sigFailed).to.equal(0n);
        });

        it("should reject a signature from a revoked session key", async function () {
            await sessionKeyModule.registerSessionKey(sessionKey.address, 0, 100, []);
            await sessionKeyModule.revokeSessionKey(sessionKey.address);

            const userOpHash = ethers.keccak256(ethers.toUtf8Bytes("test-user-op"));
            const signature = await sessionKey.signMessage(ethers.getBytes(userOpHash));

            const validationData = await sessionKeyModule.validateSignature(
                owner.address,
                userOpHash,
                signature
            );

            // SIG_VALIDATION_FAILED = 1
            expect(validationData).to.equal(1n);
        });
    });
});
