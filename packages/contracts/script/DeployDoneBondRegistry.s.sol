// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Script } from "forge-std/Script.sol";
import { DoneBondRegistry } from "../src/DoneBondRegistry.sol";

/// @notice Broadcasts an immutable DoneBondRegistry deployment using a key supplied at runtime.
contract DeployDoneBondRegistry is Script {
    /// @notice Deploys using `DEPLOYER_PRIVATE_KEY` and the nonzero `VERIFIER_ADDRESS`.
    function run() external returns (DoneBondRegistry registry) {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address verifier = vm.envAddress("VERIFIER_ADDRESS");
        vm.startBroadcast(deployerPrivateKey);
        registry = new DoneBondRegistry(verifier);
        vm.stopBroadcast();
    }
}
