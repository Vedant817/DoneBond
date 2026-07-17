// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";
import { DoneBondRegistry } from "../src/DoneBondRegistry.sol";

contract ReenteringAssignee {
    DoneBondRegistry internal immutable registry;
    bool public reentryAttempted;
    bool public reentrySucceeded;

    constructor(DoneBondRegistry registry_) {
        registry = registry_;
    }

    function submit(
        uint256 taskId,
        bytes32 evidenceHash,
        bytes32 commitHash,
        uint64 expiry,
        bytes calldata signature
    ) external {
        registry.submitReceipt(taskId, evidenceHash, commitHash, expiry, signature);
    }

    function withdraw() external {
        registry.withdraw();
    }

    receive() external payable {
        reentryAttempted = true;
        (reentrySucceeded,) = address(registry).call(abi.encodeCall(DoneBondRegistry.withdraw, ()));
    }
}

contract RevertingCreator {
    DoneBondRegistry internal immutable registry;

    constructor(DoneBondRegistry registry_) {
        registry = registry_;
    }

    function create(bytes32 taskHash, bytes32 policyHash, address assignee)
        external
        payable
        returns (uint256)
    {
        return registry.createTask{ value: msg.value }(taskHash, policyHash, assignee, 0);
    }

    function cancel(uint256 taskId) external {
        registry.cancelTask(taskId);
    }

    function withdraw() external {
        registry.withdraw();
    }

    receive() external payable {
        revert("reject transfer");
    }
}

contract ForceSender {
    constructor() payable { }

    function force(address payable target) external {
        selfdestruct(target);
    }
}

contract DoneBondRegistryAdversarialTest is Test {
    uint256 internal constant VERIFIER_KEY = 0xA11CE;
    bytes32 internal constant TASK_HASH = keccak256("task");
    bytes32 internal constant POLICY_HASH = keccak256("policy");
    bytes32 internal constant EVIDENCE_HASH = keccak256("evidence");
    bytes32 internal constant COMMIT_HASH = keccak256("commit");

    DoneBondRegistry internal registry;
    address internal creator = makeAddr("creator");

    function setUp() public {
        registry = new DoneBondRegistry(vm.addr(VERIFIER_KEY));
        vm.deal(creator, 10 ether);
    }

    function testReentrantReceiverCannotWithdrawTwice() public {
        ReenteringAssignee receiver = new ReenteringAssignee(registry);
        vm.prank(creator);
        uint256 taskId =
            registry.createTask{ value: 2 ether }(TASK_HASH, POLICY_HASH, address(receiver), 0);
        uint64 expiry = uint64(block.timestamp + 1 hours);
        bytes memory signature = _signature(taskId, EVIDENCE_HASH, COMMIT_HASH, expiry);
        receiver.submit(taskId, EVIDENCE_HASH, COMMIT_HASH, expiry, signature);
        vm.prank(creator);
        registry.approveTask(taskId);

        receiver.withdraw();

        assertTrue(receiver.reentryAttempted());
        assertFalse(receiver.reentrySucceeded());
        assertEq(address(receiver).balance, 2 ether);
        assertEq(registry.withdrawable(address(receiver)), 0);
        assertEq(registry.totalWithdrawable(), 0);
        assertEq(address(registry).balance, 0);
    }

    function testRevertingReceiverPreservesCreditAndAccounting() public {
        RevertingCreator receiver = new RevertingCreator(registry);
        vm.deal(address(receiver), 2 ether);
        uint256 taskId = receiver.create{ value: 2 ether }(TASK_HASH, POLICY_HASH, creator);
        receiver.cancel(taskId);

        vm.expectRevert(DoneBondRegistry.TransferFailed.selector);
        receiver.withdraw();

        assertEq(registry.withdrawable(address(receiver)), 2 ether);
        assertEq(registry.totalWithdrawable(), 2 ether);
        assertEq(address(registry).balance, 2 ether);
    }

    function testForcedNativeCurrencyCreatesOnlyHarmlessSurplus() public {
        vm.prank(creator);
        registry.createTask{ value: 2 ether }(TASK_HASH, POLICY_HASH, creator, 0);
        ForceSender sender = new ForceSender{ value: 1 ether }();
        sender.force(payable(address(registry)));

        assertEq(address(registry).balance, 3 ether);
        assertEq(registry.totalLockedRewards() + registry.totalWithdrawable(), 2 ether);
        assertGe(
            address(registry).balance, registry.totalLockedRewards() + registry.totalWithdrawable()
        );
    }

    function _signature(uint256 taskId, bytes32 evidenceHash, bytes32 commitHash, uint64 expiry)
        internal
        view
        returns (bytes memory)
    {
        bytes32 digest = registry.receiptAttestationDigest(taskId, evidenceHash, commitHash, expiry);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(VERIFIER_KEY, digest);
        return abi.encodePacked(r, s, v);
    }
}
