const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("VerifyingPaymaster", function () {
    let entryPoint, paymaster;
    let owner, signer, user;

    beforeEach(async function () {
        [owner, signer, user] = await ethers.getSigners();

        // Deploy EntryPointSimulator
        const EntryPointSimulator = await ethers.getContractFactory("EntryPointSimulator");
        entryPoint = await EntryPointSimulator.deploy();

        // Deploy VerifyingPaymaster
        const VerifyingPaymaster = await ethers.getContractFactory("VerifyingPaymaster");
        paymaster = await VerifyingPaymaster.deploy(
            await entryPoint.getAddress(),
            signer.address
        );

        // Fund the paymaster
        await paymaster.deposit({ value: ethers.parseEther("1") });
    });

    describe("Initialization", function () {
        it("should set the correct signer", async function () {
            expect(await paymaster.verifyingSigner()).to.equal(signer.address);
        });

        it("should set the correct EntryPoint", async function () {
            expect(await paymaster.entryPoint()).to.equal(await entryPoint.getAddress());
        });

        it("should have deposit in EntryPoint", async function () {
            const deposit = await paymaster.getDeposit();
            expect(deposit).to.equal(ethers.parseEther("1"));
        });
    });

    describe("Signer Management", function () {
        it("should allow owner to change signer", async function () {
            await paymaster.setSigner(user.address);
            expect(await paymaster.verifyingSigner()).to.equal(user.address);
        });

        it("should emit SignerChanged event", async function () {
            await expect(paymaster.setSigner(user.address))
                .to.emit(paymaster, "SignerChanged")
                .withArgs(signer.address, user.address);
        });

        it("should reject signer change from non-owner", async function () {
            await expect(
                paymaster.connect(user).setSigner(user.address)
            ).to.be.reverted;
        });

        it("should reject zero address signer", async function () {
            await expect(
                paymaster.setSigner(ethers.ZeroAddress)
            ).to.be.reverted;
        });
    });

    describe("Hash Computation", function () {
        it("should compute a consistent hash", async function () {
            const userOp = {
                sender: user.address,
                nonce: 0n,
                initCode: "0x",
                callData: "0x",
                accountGasLimits: ethers.zeroPadValue(ethers.toBeHex((200000n << 128n) | 100000n), 32),
                preVerificationGas: 50000n,
                gasFees: ethers.zeroPadValue(ethers.toBeHex((1000000000n << 128n) | 1000000000n), 32),
                paymasterAndData: "0x",
                signature: "0x",
            };

            const hash1 = await paymaster.getHash(userOp, 100, 0);
            const hash2 = await paymaster.getHash(userOp, 100, 0);

            expect(hash1).to.equal(hash2);
        });
    });

    describe("Deposit Management", function () {
        it("should allow owner to withdraw", async function () {
            const balanceBefore = await ethers.provider.getBalance(owner.address);
            await paymaster.withdrawTo(owner.address, ethers.parseEther("0.5"));
            const balanceAfter = await ethers.provider.getBalance(owner.address);
            expect(balanceAfter).to.be.greaterThan(balanceBefore);
        });
    });
});
