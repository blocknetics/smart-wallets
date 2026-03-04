const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Integration — Full ERC-4337 Flow", function () {
    let entryPoint, factory, account;
    let owner, beneficiary;

    beforeEach(async function () {
        [owner, beneficiary] = await ethers.getSigners();

        // Deploy infrastructure
        const EntryPointSimulator = await ethers.getContractFactory("EntryPointSimulator");
        entryPoint = await EntryPointSimulator.deploy();

        const SmartAccountFactory = await ethers.getContractFactory("SmartAccountFactory");
        factory = await SmartAccountFactory.deploy(await entryPoint.getAddress());

        // Create account
        await factory.createAccount(owner.address, 0);
        const accountAddress = await factory.computeAddress(owner.address, 0);
        account = await ethers.getContractAt("SmartAccount", accountAddress);

        // Fund account
        await owner.sendTransaction({ to: accountAddress, value: ethers.parseEther("2") });
    });

    describe("End-to-End UserOp Flow", function () {
        it("should execute a UserOp: account sends ETH via EntryPoint", async function () {
            const accountAddr = await account.getAddress();
            const epAddr = await entryPoint.getAddress();

            // Encode execute(beneficiary, 0.5 ETH, 0x)
            const iface = new ethers.Interface([
                "function execute(address target, uint256 value, bytes data)",
            ]);
            const callData = iface.encodeFunctionData("execute", [
                beneficiary.address,
                ethers.parseEther("0.5"),
                "0x",
            ]);

            // Build UserOp
            const userOp = {
                sender: accountAddr,
                nonce: 0n,
                initCode: "0x",
                callData: callData,
                accountGasLimits: ethers.zeroPadValue(ethers.toBeHex((200000n << 128n) | 200000n), 32),
                preVerificationGas: 50000n,
                gasFees: ethers.zeroPadValue(ethers.toBeHex((1000000000n << 128n) | 1000000000n), 32),
                paymasterAndData: "0x",
                signature: "0x",
            };

            // Get hash and sign
            const userOpHash = await entryPoint.getUserOpHash(userOp);
            userOp.signature = await owner.signMessage(ethers.getBytes(userOpHash));

            // Track beneficiary balance before
            const balBefore = await ethers.provider.getBalance(beneficiary.address);

            // Submit UserOp through EntryPoint
            const tx = await entryPoint.handleOps([userOp], owner.address);
            await tx.wait();

            // Verify beneficiary received ETH
            const balAfter = await ethers.provider.getBalance(beneficiary.address);
            expect(balAfter - balBefore).to.equal(ethers.parseEther("0.5"));
        });

        it("should execute a batch UserOp via EntryPoint", async function () {
            const accountAddr = await account.getAddress();

            // Encode executeBatch
            const iface = new ethers.Interface([
                "function executeBatch((address target, uint256 value, bytes data)[] calls)",
            ]);
            const calls = [
                { target: beneficiary.address, value: ethers.parseEther("0.1"), data: "0x" },
                { target: beneficiary.address, value: ethers.parseEther("0.2"), data: "0x" },
            ];
            const callData = iface.encodeFunctionData("executeBatch", [calls]);

            const userOp = {
                sender: accountAddr,
                nonce: 0n,
                initCode: "0x",
                callData: callData,
                accountGasLimits: ethers.zeroPadValue(ethers.toBeHex((200000n << 128n) | 300000n), 32),
                preVerificationGas: 50000n,
                gasFees: ethers.zeroPadValue(ethers.toBeHex((1000000000n << 128n) | 1000000000n), 32),
                paymasterAndData: "0x",
                signature: "0x",
            };

            const userOpHash = await entryPoint.getUserOpHash(userOp);
            userOp.signature = await owner.signMessage(ethers.getBytes(userOpHash));

            const balBefore = await ethers.provider.getBalance(beneficiary.address);
            await entryPoint.handleOps([userOp], owner.address);
            const balAfter = await ethers.provider.getBalance(beneficiary.address);

            expect(balAfter - balBefore).to.equal(ethers.parseEther("0.3"));
        });

        it("should reject UserOp with invalid signature", async function () {
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

            // Get hash but sign with wrong key (beneficiary instead of owner)
            const userOpHash = await entryPoint.getUserOpHash(userOp);
            userOp.signature = await beneficiary.signMessage(ethers.getBytes(userOpHash));

            // Should revert because signature is invalid
            await expect(
                entryPoint.handleOps([userOp], owner.address)
            ).to.be.reverted;
        });
    });

    describe("Multiple Operations in Single Bundle", function () {
        it("should handle multiple UserOps in one call", async function () {
            const accountAddr = await account.getAddress();

            // Create two UserOps with sequential nonces
            const ops = [];
            for (let i = 0; i < 2; i++) {
                const iface = new ethers.Interface([
                    "function execute(address target, uint256 value, bytes data)",
                ]);
                const callData = iface.encodeFunctionData("execute", [
                    beneficiary.address,
                    ethers.parseEther("0.1"),
                    "0x",
                ]);

                const userOp = {
                    sender: accountAddr,
                    nonce: BigInt(i),
                    initCode: "0x",
                    callData: callData,
                    accountGasLimits: ethers.zeroPadValue(ethers.toBeHex((200000n << 128n) | 200000n), 32),
                    preVerificationGas: 50000n,
                    gasFees: ethers.zeroPadValue(ethers.toBeHex((1000000000n << 128n) | 1000000000n), 32),
                    paymasterAndData: "0x",
                    signature: "0x",
                };

                const hash = await entryPoint.getUserOpHash(userOp);
                userOp.signature = await owner.signMessage(ethers.getBytes(hash));
                ops.push(userOp);
            }

            const balBefore = await ethers.provider.getBalance(beneficiary.address);
            await entryPoint.handleOps(ops, owner.address);
            const balAfter = await ethers.provider.getBalance(beneficiary.address);

            expect(balAfter - balBefore).to.equal(ethers.parseEther("0.2"));
        });
    });
});
