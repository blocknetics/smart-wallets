// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../paymasters/TokenPaymaster.sol";

/**
 * @title MockOracle
 * @notice Configurable price oracle for testing TokenPaymaster.
 * @dev Returns a preset token-per-ETH exchange rate.
 */
contract MockOracle is IOracle {
    /// @notice How many token-units equal 1 ETH worth
    uint256 public price;

    constructor(uint256 _price) {
        price = _price;
    }

    /**
     * @notice Set the price (for testing).
     * @param _price New exchange rate.
     */
    function setPrice(uint256 _price) external {
        price = _price;
    }

    /// @inheritdoc IOracle
    function getTokenValueOfEth(uint256 ethAmount) external view override returns (uint256) {
        return (ethAmount * price) / 1 ether;
    }
}
