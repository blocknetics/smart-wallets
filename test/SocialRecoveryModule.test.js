const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

describe("SocialRecoveryModule", function () {
    let recovery;
    let owner, guardian1, guardian2, guardian3, newOwner;

    beforeEach(async function () {
        [owner, guardian1, guardian2, guardian3, newOwner] = await ethers.getSigners();

        const SocialRecoveryModule = await ethers.getContractFactory("SocialRecoveryModule");
        recovery = await SocialRecoveryModule.deploy();
    });

    describe("Guardian Management", function () {
        it("should add a guardian", async function () {
            await recovery.addGuardian(guardian1.address);
            expect(await recovery.isGuardian(owner.address, guardian1.address)).to.be.true;
            expect(await recovery.guardianCount(owner.address)).to.equal(1);
        });

        it("should reject duplicate guardian", async function () {
            await recovery.addGuardian(guardian1.address);
            await expect(recovery.addGuardian(guardian1.address)).to.be.reverted;
        });

        it("should remove a guardian", async function () {
            await recovery.addGuardian(guardian1.address);
            await recovery.removeGuardian(guardian1.address);
            expect(await recovery.isGuardian(owner.address, guardian1.address)).to.be.false;
            expect(await recovery.guardianCount(owner.address)).to.equal(0);
        });

        it("should reject removing non-existent guardian", async function () {
            await expect(recovery.removeGuardian(guardian1.address)).to.be.reverted;
        });

        it("should get list of guardians", async function () {
            await recovery.addGuardian(guardian1.address);
            await recovery.addGuardian(guardian2.address);

            const guardians = await recovery.getGuardians(owner.address);
            expect(guardians.length).to.equal(2);
            expect(guardians).to.include(guardian1.address);
            expect(guardians).to.include(guardian2.address);
        });
    });

    describe("Threshold", function () {
        it("should set threshold", async function () {
            await recovery.addGuardian(guardian1.address);
            await recovery.addGuardian(guardian2.address);
            await recovery.setThreshold(2);

            expect(await recovery.threshold(owner.address)).to.equal(2);
        });

        it("should reject invalid threshold (0)", async function () {
            await recovery.addGuardian(guardian1.address);
            await expect(recovery.setThreshold(0)).to.be.reverted;
        });

        it("should reject threshold greater than guardian count", async function () {
            await recovery.addGuardian(guardian1.address);
            await expect(recovery.setThreshold(2)).to.be.reverted;
        });

        it("should adjust threshold when guards removed", async function () {
            await recovery.addGuardian(guardian1.address);
            await recovery.addGuardian(guardian2.address);
            await recovery.setThreshold(2);

            await recovery.removeGuardian(guardian2.address);
            expect(await recovery.threshold(owner.address)).to.equal(1);
        });
    });

    describe("Recovery Flow", function () {
        beforeEach(async function () {
            // Setup: add 3 guardians, set threshold to 2
            await recovery.addGuardian(guardian1.address);
            await recovery.addGuardian(guardian2.address);
            await recovery.addGuardian(guardian3.address);
            await recovery.setThreshold(2);
        });

        it("should initiate recovery", async function () {
            await recovery.connect(guardian1).initiateRecovery(owner.address, newOwner.address);

            const req = await recovery.getRecoveryRequest(owner.address);
            expect(req.newOwner).to.equal(newOwner.address);
            expect(req.confirmations).to.equal(1n);
            expect(req.active).to.be.true;
        });

        it("should reject initiation from non-guardian", async function () {
            await expect(
                recovery.connect(newOwner).initiateRecovery(owner.address, newOwner.address)
            ).to.be.reverted;
        });

        it("should allow another guardian to confirm", async function () {
            await recovery.connect(guardian1).initiateRecovery(owner.address, newOwner.address);
            await recovery.connect(guardian2).confirmRecovery(owner.address);

            const req = await recovery.getRecoveryRequest(owner.address);
            expect(req.confirmations).to.equal(2n);
            // Threshold met, so executionTime should be set
            expect(req.executionTime).to.be.greaterThan(0n);
        });

        it("should reject duplicate confirmation", async function () {
            await recovery.connect(guardian1).initiateRecovery(owner.address, newOwner.address);
            await expect(
                recovery.connect(guardian1).confirmRecovery(owner.address)
            ).to.be.reverted;
        });

        it("should execute recovery after time-lock", async function () {
            await recovery.connect(guardian1).initiateRecovery(owner.address, newOwner.address);
            await recovery.connect(guardian2).confirmRecovery(owner.address);

            // Fast-forward past RECOVERY_DELAY (2 days)
            await time.increase(2 * 24 * 60 * 60 + 1);

            const tx = await recovery.executeRecovery(owner.address);
            const receipt = await tx.wait();

            // Should emit RecoveryExecuted
            const event = receipt.logs.find(
                (log) => log.fragment && log.fragment.name === "RecoveryExecuted"
            );
            expect(event).to.not.be.undefined;
        });

        it("should reject execution before time-lock expires", async function () {
            await recovery.connect(guardian1).initiateRecovery(owner.address, newOwner.address);
            await recovery.connect(guardian2).confirmRecovery(owner.address);

            // Don't advance time
            await expect(
                recovery.executeRecovery(owner.address)
            ).to.be.reverted;
        });

        it("should allow owner to cancel recovery", async function () {
            await recovery.connect(guardian1).initiateRecovery(owner.address, newOwner.address);

            await recovery.cancelRecovery();

            const req = await recovery.getRecoveryRequest(owner.address);
            expect(req.active).to.be.false;
        });

        it("should reject execution when no active recovery", async function () {
            await expect(
                recovery.executeRecovery(owner.address)
            ).to.be.reverted;
        });
    });

    describe("Single Guardian Threshold", function () {
        it("should allow immediate threshold when threshold = 1", async function () {
            await recovery.addGuardian(guardian1.address);
            await recovery.setThreshold(1);

            await recovery.connect(guardian1).initiateRecovery(owner.address, newOwner.address);

            const req = await recovery.getRecoveryRequest(owner.address);
            // Threshold is already met with 1 confirmation
            expect(req.executionTime).to.be.greaterThan(0n);
        });
    });
});
