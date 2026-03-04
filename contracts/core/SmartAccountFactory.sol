// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/utils/Create2.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "./SmartAccount.sol";

/**
 * @title SmartAccountFactory
 * @notice Deploys SmartAccount proxies using CREATE2 for deterministic addresses.
 * @dev The factory deploys an implementation once on construction and uses
 *      ERC-1967 proxies for each new account. The `computeAddress` function
 *      allows anyone to predict the counterfactual address before deployment.
 */
contract SmartAccountFactory {
    SmartAccount public immutable accountImplementation;

    event AccountCreated(address indexed account, address indexed owner, uint256 salt);

    constructor(IEntryPoint entryPoint) {
        accountImplementation = new SmartAccount(entryPoint);
    }

    /**
     * @notice Create a new smart account.
     * @dev Returns the address even if the account already exists.
     *      Uses CREATE2 for deterministic addresses based on owner + salt.
     * @param owner  The owner of the new account.
     * @param salt   A user-chosen salt for address derivation.
     * @return ret   The SmartAccount instance (newly deployed or existing).
     */
    function createAccount(
        address owner,
        uint256 salt
    ) public returns (SmartAccount ret) {
        if (owner == address(0)) revert AccountErrors.ZeroAddress();
        address addr = computeAddress(owner, salt);
        uint256 codeSize = addr.code.length;
        if (codeSize > 0) {
            return SmartAccount(payable(addr));
        }
        ret = SmartAccount(
            payable(
                new ERC1967Proxy{salt: bytes32(salt)}(
                    address(accountImplementation),
                    abi.encodeCall(SmartAccount.initialize, (owner))
                )
            )
        );
        emit AccountCreated(address(ret), owner, salt);
    }

    /**
     * @notice Calculate the counterfactual address of an account.
     * @param owner  The owner of the account.
     * @param salt   The salt used for CREATE2.
     * @return       The predicted address.
     */
    function computeAddress(
        address owner,
        uint256 salt
    ) public view returns (address) {
        return
            Create2.computeAddress(
                bytes32(salt),
                keccak256(
                    abi.encodePacked(
                        type(ERC1967Proxy).creationCode,
                        abi.encode(
                            address(accountImplementation),
                            abi.encodeCall(SmartAccount.initialize, (owner))
                        )
                    )
                )
            );
    }
}
