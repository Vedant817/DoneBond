// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Script } from "forge-std/Script.sol";
import { DoneBondRegistry } from "../src/DoneBondRegistry.sol";

/// @notice Broadcasts an immutable DoneBondRegistry deployment using a key supplied at runtime.
contract DeployDoneBondRegistry is Script {
    /// @notice Deploys from Foundry's configured signer using the nonzero `VERIFIER_ADDRESS`.
    function run() external returns (DoneBondRegistry registry) {
        address verifier = vm.envAddress("VERIFIER_ADDRESS");
        vm.startBroadcast();
        registry = new DoneBondRegistry(verifier);
        vm.stopBroadcast();
    }
}
